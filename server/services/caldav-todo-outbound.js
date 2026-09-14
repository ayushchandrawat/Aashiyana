// --------------------------------------------------------

//




//


//



// (at-least-once).
//


//






//



//


// --------------------------------------------------------

import { createLogger } from '../logger.js';
import * as db from '../db.js';
import { outboundFailureAction } from './calendar-outbound.js';
import { patchICSTodo } from '../utils/ics-patch.js';
import { createCalDAVClient, collectionUrlOf } from '../utils/caldav-client.js';
import { householdTimeZone, localToUTC } from '../utils/timezone.js';
import { loadTags } from '../utils/task-tags.js';
import { runSerialized } from '../utils/sync-lock.js';

const log = createLogger('CalDAV-Todo-Outbound');

// --------------------------------------------------------
// Module
//



// unbekannter Name kommt nie bis zum Statement.
// --------------------------------------------------------

export const MODULES = {
  tasks: {
    table: 'tasks',



    //




    mirrored: ['title', 'description', 'priority', 'status', 'due_date', 'due_time', 'tags_key'],
    icsFields: icsFieldsForTask,
    labelOf: (row) => row.title,
  },
  shopping: {
    table: 'shopping_items',
    mirrored: ['name', 'is_checked'],
    icsFields: icsFieldsForShoppingItem,
    labelOf: (row) => row.name,
  },
};

function moduleDef(module) {
  const def = MODULES[module];
  if (!def) throw new Error(`Unknown VTODO module "${module}".`);
  return def;
}

// --------------------------------------------------------
// Feld-Abbildung Aashiyana → VTODO
// --------------------------------------------------------

function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function priorityToVtodo(priority) {
  switch (priority) {
    case 'urgent': return '1';
    case 'high':   return '2';
    case 'medium': return '5';
    case 'low':    return '9';
    default:       return null; // 'none' → Property entfernen
  }
}

export function dueField(date, time, tz = householdTimeZone(null)) {
  if (!date) return null; // Property entfernen
  const day = String(date).slice(0, 10);
  if (!time) return { value: day.replace(/-/g, ''), params: ';VALUE=DATE' };

  const utc = localToUTC(`${day}T${String(time).slice(0, 5)}:00`, tz);
  return { value: utc.replace(/[-:]/g, '').replace(/\.\d{3}/, ''), params: '' };
}

function completionFields(done, inProgress, hadCompleted) {
  if (!done) {
    return {
      STATUS:              inProgress ? 'IN-PROCESS' : 'NEEDS-ACTION',
      COMPLETED:           null,
      'PERCENT-COMPLETE':  null,
    };
  }
  const fields = { STATUS: 'COMPLETED', 'PERCENT-COMPLETE': '100' };
  if (!hadCompleted) fields.COMPLETED = utcStamp();
  return fields;
}

export function icsFieldsForTask(task, hadCompleted = false, tz = householdTimeZone(null)) {
  const fields = {
    SUMMARY:     task.title,
    DESCRIPTION: task.description || null,
    DUE:         dueField(task.due_date, task.due_time, tz),
    PRIORITY:    priorityToVtodo(task.priority),
    ...completionFields(task.status === 'done', task.status === 'in_progress', hadCompleted),
  };
  if (Array.isArray(task.tags)) fields.CATEGORIES = task.tags;
  return fields;
}

/** VTODO-Properties eines lokalen Einkaufspostens. */
export function icsFieldsForShoppingItem(item, hadCompleted = false) {
  return {
    SUMMARY: item.name,
    ...completionFields(!!item.is_checked, false, hadCompleted),
  };
}

function hasCompleted(icsText) {
  return /^COMPLETED[;:]/im.test(String(icsText || ''));
}

// --------------------------------------------------------

// --------------------------------------------------------

function accountExists(accountId) {
  return !!db.get().prepare('SELECT 1 FROM caldav_accounts WHERE id = ?').get(accountId);
}

function isMirrored(row) {
  if (!row || row.external_source !== 'caldav') return false;
  if (!row.external_uid || !row.external_account_id) return false;
  return accountExists(row.external_account_id);
}

export function detachAccountRows(accountId) {
  let detached = 0;
  for (const def of Object.values(MODULES)) {
    detached += db.get().prepare(`
      UPDATE ${def.table}
         SET external_source     = 'local',
             external_uid        = NULL,
             external_account_id = NULL,
             external_object_url = NULL,
             outbound_dirty      = 0,
             outbound_attempts   = 0
       WHERE external_source = 'caldav' AND external_account_id = ?
    `).run(accountId).changes;
  }
  return detached;
}

export function queueTodoDeletion(module, row) {
  moduleDef(module);
  if (!isMirrored(row)) return false;

  db.get().prepare(`
    INSERT INTO caldav_todo_pending_deletions (account_id, module, uid, object_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, module, uid)
      DO UPDATE SET object_url = COALESCE(excluded.object_url, object_url)
  `).run(row.external_account_id, module, row.external_uid, row.external_object_url || null);
  return true;
}

export function queueTodoDeletions(module, rows) {
  let queued = 0;
  for (const row of rows || []) {
    if (queueTodoDeletion(module, row)) queued++;
  }
  return queued;
}

export function pendingDeletions(accountId, module) {
  return db.get().prepare(`
    SELECT id, uid, object_url, attempts
    FROM caldav_todo_pending_deletions
    WHERE account_id = ? AND module = ?
    ORDER BY id
  `).all(accountId, module);
}

export function pendingDeletionUids(accountId, module) {
  try {
    return new Set(
      db.get().prepare(
        'SELECT uid FROM caldav_todo_pending_deletions WHERE account_id = ? AND module = ?'
      ).all(accountId, module).map((r) => r.uid)
    );
  } catch (err) {
    log.warn(`Pending deletions are not readable (${err.message}); treating them as none.`);
    return new Set();
  }
}

function dropDeletion(id) {
  db.get().prepare('DELETE FROM caldav_todo_pending_deletions WHERE id = ?').run(id);
}

function failDeletion(id, err) {
  db.get().prepare(
    'UPDATE caldav_todo_pending_deletions SET attempts = attempts + 1, last_error = ? WHERE id = ?'
  ).run(String(err?.message || err).slice(0, 500), id);
}

// --------------------------------------------------------

// --------------------------------------------------------

export function mirroredFieldsChanged(module, before, after) {
  return moduleDef(module).mirrored.some((f) => before?.[f] !== after?.[f]);
}

export function markTodoOutbound(module, before, after) {
  const def = moduleDef(module);
  if (!isMirrored(after)) return false;
  if (!mirroredFieldsChanged(module, before, after)) return false;

  db.get().prepare(
    `UPDATE ${def.table} SET outbound_dirty = 1, outbound_attempts = 0 WHERE id = ?`
  ).run(after.id);
  return true;
}

export function pendingUpdates(accountId, module) {
  const def = moduleDef(module);
  return db.get().prepare(`
    SELECT * FROM ${def.table}
    WHERE outbound_dirty = 1 AND external_source = 'caldav' AND external_account_id = ?
    ORDER BY id
  `).all(accountId);
}

export function pendingUpdateUids(accountId, module) {
  const def = moduleDef(module);
  try {
    return new Set(
      db.get().prepare(`
        SELECT external_uid FROM ${def.table}
        WHERE outbound_dirty = 1 AND external_source = 'caldav' AND external_account_id = ?
      `).all(accountId).map((r) => r.external_uid)
    );
  } catch (err) {
    log.warn(`Pending updates are not readable (${err.message}); treating them as none.`);
    return new Set();
  }
}

function clearOutbound(module, id) {
  const def = moduleDef(module);
  db.get().prepare(
    `UPDATE ${def.table} SET outbound_dirty = 0, outbound_attempts = 0 WHERE id = ?`
  ).run(id);
}

function failOutbound(module, id) {
  const def = moduleDef(module);
  db.get().prepare(
    `UPDATE ${def.table} SET outbound_attempts = outbound_attempts + 1 WHERE id = ?`
  ).run(id);
}

function reloadRow(module, id) {
  const def = moduleDef(module);
  const row = db.get().prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(id) ?? null;
  if (row && module === 'tasks') row.tags = loadTags(db.get(), row.id);
  return row;
}

// --------------------------------------------------------
// Vormerkung: Anlegen (#695)
// --------------------------------------------------------

export function todoUidFor(module, id) {
  return `aashiyana-${module === 'shopping' ? 'item' : 'task'}-${id}@aashiyana.local`;
}

export function buildTodoICS(module, row, uid) {
  const def = moduleDef(module);
  const skeleton = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aashiyana//CalDAV Sync//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp()}`,
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');

  return patchICSTodo(skeleton, uid, def.icsFields(row, false, householdTimeZone(db.get())));
}

export function pendingCreations(accountId, module = 'tasks') {
  const def = moduleDef(module);
  if (module !== 'tasks') return [];
  return db.get().prepare(`
    SELECT * FROM ${def.table}
     WHERE external_source          = 'local'
       AND target_caldav_account_id = ?
       AND target_caldav_list_url IS NOT NULL
       AND parent_task_id IS NULL
     ORDER BY id
  `).all(accountId);
}

export function pendingShoppingCreations(listId) {
  return db.get().prepare(`
    SELECT * FROM shopping_items
     WHERE external_source = 'local'
       AND list_id         = ?
     ORDER BY id
  `).all(listId);
}

function accountsWithPendingShoppingCreations() {
  try {
    return db.get().prepare(`
      SELECT DISTINCT sel.account_id AS account_id
        FROM caldav_reminder_selection sel
        JOIN shopping_items i ON i.list_id = sel.target_list_id
       WHERE sel.enabled = 1
         AND sel.target_module = 'shopping'
         AND sel.target_list_id IS NOT NULL
         AND i.external_source = 'local'
    `).all().map((r) => r.account_id).filter(Boolean);
  } catch (err) {
    log.warn(`Pending shopping creations are not readable (${err.message}); treating them as none.`);
    return [];
  }
}

/** Konten mit wartenden Uploads. */
function accountsWithPendingCreations() {
  try {
    return db.get().prepare(`
      SELECT DISTINCT target_caldav_account_id AS account_id FROM tasks
       WHERE external_source = 'local' AND target_caldav_account_id IS NOT NULL
    `).all().map((r) => r.account_id).filter(Boolean);
  } catch (err) {

    // Sofortversuch scheitern zu lassen.
    log.warn(`Pending creations are not readable (${err.message}); treating them as none.`);
    return [];
  }
}

function clearCreationTarget(id) {
  db.get().prepare(
    'UPDATE tasks SET target_caldav_account_id = NULL, target_caldav_list_url = NULL WHERE id = ?'
  ).run(id);
}

async function uploadNewTodo(client, collection, module, row, accountId) {
  const def = moduleDef(module);
  const uid = todoUidFor(module, row.id);
  const ics = buildTodoICS(module, row, uid);
  if (!ics) return false;

  await client.createCalendarObject({
    calendar:   collection,
    filename:   `${uid}.ics`,
    iCalString: ics,
  });

  const objectUrl = `${String(collection.url).replace(/\/?$/, '/')}${uid}.ics`;
  db.get().prepare(`
    UPDATE ${def.table}
       SET external_source     = 'caldav',
           external_uid        = ?,
           external_account_id = ?,
           external_object_url = ?,
           outbound_dirty      = 0,
           outbound_attempts   = 0
     WHERE id = ?
  `).run(uid, accountId, objectUrl, row.id);
  return true;
}

export async function processPendingCreations(client, accountId, module, listsByUrl) {
  const rows = pendingCreations(accountId, module);
  if (rows.length === 0) return 0;

  let done = 0;
  for (const row of rows) {
    const collection = listsByUrl.get(row.target_caldav_list_url);
    if (!collection) {



      log.warn(`Reminder list ${row.target_caldav_list_url} is not available, keeping task ${row.id} local.`);
      clearCreationTarget(row.id);
      continue;
    }

    const fresh = reloadRow(module, row.id);
    if (!fresh) continue;

    try {
      if (await uploadNewTodo(client, collection, module, fresh, accountId)) {
        clearCreationTarget(fresh.id);
        done++;
      } else {
        log.error(`Could not build a VTODO for task ${fresh.id}, keeping it local.`);
        clearCreationTarget(fresh.id);
      }
    } catch (err) {



      log.warn(`Could not upload task ${fresh.id} to ${row.target_caldav_list_url}: ${err.message}`);
    }
  }
  return done;
}

export async function processPendingShoppingCreations(client, accountId, targets, listsByUrl) {
  let done = 0;
  for (const { listUrl, targetListId } of targets) {
    if (!targetListId) continue;
    const collection = listsByUrl.get(listUrl);
    if (!collection) continue;

    for (const row of pendingShoppingCreations(targetListId)) {
      const fresh = reloadRow('shopping', row.id);
      if (!fresh) continue;

      try {
        if (await uploadNewTodo(client, collection, 'shopping', fresh, accountId)) done++;
        else log.error(`Could not build a VTODO for shopping item ${fresh.id}, keeping it local.`);
      } catch (err) {

        log.warn(`Could not upload shopping item ${fresh.id} to ${listUrl}: ${err.message}`);
      }
    }
  }
  return done;
}

// --------------------------------------------------------

// --------------------------------------------------------

export async function processPendingDeletions(client, accountId, module, objectIndex, complete = false) {
  const rows = pendingDeletions(accountId, module);
  if (rows.length === 0) return 0;

  let done = 0;
  for (const row of rows) {
    const known = objectIndex.get(row.uid);
    const url   = row.object_url || known?.url || null;

    if (!url) {
      if (complete) {
        log.info(`VTODO ${row.uid} is no longer on the server, dropping the pending deletion.`);
        dropDeletion(row.id);
        done++;
      }
      continue;
    }

    try {
      await client.deleteCalendarObject({ calendarObject: { url, etag: known?.etag } });
      dropDeletion(row.id);
      done++;
    } catch (err) {
      const action = outboundFailureAction(err, row.attempts);
      if (action === 'settled') {
        dropDeletion(row.id);
        done++;
        continue;
      }
      failDeletion(row.id, err);
      if (action === 'give-up') {
        log.error(`Giving up on remote deletion of VTODO ${row.uid} after ${row.attempts + 1} attempt(s):`, err.message);
        dropDeletion(row.id);
        done++;
        continue;
      }
      log.warn(`Remote deletion failed for VTODO ${row.uid} (attempt ${row.attempts + 1}):`, err.message);
    }
  }
  return done;
}

export async function processPendingUpdates(client, accountId, module, objectIndex) {
  const def  = moduleDef(module);
  const rows = pendingUpdates(accountId, module);
  if (rows.length === 0) return 0;

  let done = 0;
  for (const row of rows) {
    const known = objectIndex.get(row.external_uid);
    const url   = row.external_object_url || known?.url || null;



    if (!url) continue;

    if (!known?.data) {
      log.warn(`No source object for ${def.table} row ${row.id} in this run, deferring its update.`);
      continue;
    }



    const fresh = reloadRow(module, row.id);
    if (!fresh) continue;

    const patched = patchICSTodo(
      known.data, row.external_uid, def.icsFields(fresh, hasCompleted(known.data), householdTimeZone(db.get()))
    );
    if (!patched) {
      log.warn(`VTODO ${row.external_uid} has no editable component in its calendar object, dropping its update.`);
      clearOutbound(module, row.id);
      continue;
    }

    try {
      await client.updateCalendarObject({ calendarObject: { url, etag: known.etag, data: patched } });
      clearOutbound(module, row.id);
      done++;
    } catch (err) {
      const action = outboundFailureAction(err, row.outbound_attempts);
      if (action === 'settled') {
        log.warn(`VTODO ${row.external_uid} no longer exists on the server, dropping its update.`);
        clearOutbound(module, row.id);
        continue;
      }
      if (action === 'give-up') {
        log.error(`Giving up on the outbound update of "${def.labelOf(row)}" after ${row.outbound_attempts + 1} attempt(s):`, err.message);
        clearOutbound(module, row.id);
        continue;
      }
      failOutbound(module, row.id);
      log.warn(`Outbound update failed for "${def.labelOf(row)}" (attempt ${row.outbound_attempts + 1}):`, err.message);
    }
  }
  return done;
}

// --------------------------------------------------------

// --------------------------------------------------------

/** Konten mit offener ausgehender Arbeit, samt Modul. */
function accountsWithPendingWork() {
  const buckets = new Map();
  const add = (accountId, module) => {
    if (!accountId) return;
    if (!buckets.has(accountId)) buckets.set(accountId, new Set());
    buckets.get(accountId).add(module);
  };

  for (const row of db.get().prepare(
    'SELECT DISTINCT account_id, module FROM caldav_todo_pending_deletions'
  ).all()) {
    add(row.account_id, row.module);
  }
  for (const [module, def] of Object.entries(MODULES)) {
    for (const row of db.get().prepare(`
      SELECT DISTINCT external_account_id AS account_id FROM ${def.table}
      WHERE outbound_dirty = 1 AND external_source = 'caldav'
    `).all()) {
      add(row.account_id, module);
    }
  }
  for (const accountId of accountsWithPendingCreations()) add(accountId, 'tasks');
  for (const accountId of accountsWithPendingShoppingCreations()) add(accountId, 'shopping');
  return buckets;
}

async function taskListsOf(client, accountId) {
  const selected = db.get().prepare(`
    SELECT list_url FROM caldav_reminder_selection
     WHERE account_id = ? AND enabled = 1 AND target_module = 'tasks'
  `).all(accountId).map((r) => r.list_url);
  if (!selected.length) return new Map();

  const allowed = new Set(selected);
  const calendars = await client.fetchCalendars();
  return new Map(
    (calendars || []).filter((c) => allowed.has(c.url)).map((c) => [c.url, c])
  );
}

function shoppingSelectionsOf(accountId) {
  return db.get().prepare(`
    SELECT list_url, target_list_id FROM caldav_reminder_selection
     WHERE account_id = ? AND enabled = 1 AND target_module = 'shopping'
       AND target_list_id IS NOT NULL
  `).all(accountId).map((r) => ({ listUrl: r.list_url, targetListId: r.target_list_id }));
}

async function collectionsForTargets(client, targets) {
  const allowed   = new Set(targets.map((tgt) => tgt.listUrl));
  const calendars = await client.fetchCalendars();
  return new Map((calendars || []).filter((c) => allowed.has(c.url)).map((c) => [c.url, c]));
}

async function fetchObjectsByUrl(client, wanted) {
  const index = new Map();
  if (!wanted.length) return index;

  const byCollection = new Map();
  for (const item of wanted) {
    const collection = collectionUrlOf(item.url);
    if (!collection) continue;
    if (!byCollection.has(collection)) byCollection.set(collection, []);
    byCollection.get(collection).push(item);
  }

  for (const [collection, items] of byCollection) {
    try {
      const objects = await client.fetchCalendarObjects({
        calendar:   { url: collection },
        objectUrls: items.map((i) => i.url),
      });
      for (const obj of objects || []) {
        const match = items.find((i) => i.url === obj.url) || (items.length === 1 ? items[0] : null);
        if (!match) continue;
        index.set(match.uid, { url: obj.url || match.url, etag: obj.etag, data: obj.data });
      }
    } catch (err) {

      log.warn(`Could not fetch VTODO objects from ${collection} for the immediate attempt: ${err.message}`);
    }
  }
  return index;
}

export async function flushOutbound(opts = {}) {
  return runSerialized('caldav-todo', 'flush', () => runFlushOutbound(opts));
}

async function runFlushOutbound({ createClient } = {}) {
  const total  = { deleted: 0, updated: 0, created: 0 };
  const work   = accountsWithPendingWork();
  if (work.size === 0) return total;

  const makeClient = createClient || createCalDAVClient;

  for (const [accountId, modules] of work) {
    const account = db.get().prepare('SELECT * FROM caldav_accounts WHERE id = ?').get(accountId);
    if (!account) continue;

    try {
      const client = await makeClient(account);

      for (const module of modules) {
        const wanted = [
          ...pendingDeletions(accountId, module)
            .filter((r) => r.object_url)
            .map((r) => ({ uid: r.uid, url: r.object_url })),
          ...pendingUpdates(accountId, module)
            .filter((r) => r.external_object_url)
            .map((r) => ({ uid: r.external_uid, url: r.external_object_url })),
        ];

        const objectIndex = await fetchObjectsByUrl(client, wanted);




        total.deleted += await processPendingDeletions(client, accountId, module, objectIndex, false);
        total.updated += await processPendingUpdates(client, accountId, module, objectIndex);



        // wenn wirklich etwas wartet.
        if (module === 'tasks' && pendingCreations(accountId, module).length) {
          total.created += await processPendingCreations(
            client, accountId, module, await taskListsOf(client, accountId)
          );
        }
        if (module === 'shopping') {
          const targets = shoppingSelectionsOf(accountId)
            .filter((tgt) => pendingShoppingCreations(tgt.targetListId).length);
          if (targets.length) {
            total.created += await processPendingShoppingCreations(
              client, accountId, targets, await collectionsForTargets(client, targets)
            );
          }
        }
      }
    } catch (err) {
      log.warn(`[Account ${accountId}] Immediate outbound attempt failed: ${err.message}`);
    }
  }
  return total;
}
