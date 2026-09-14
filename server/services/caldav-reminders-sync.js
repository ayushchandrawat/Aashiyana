
import { createLogger } from '../logger.js';
const log = createLogger('CalDAV-Reminders');

import * as db from '../db.js';
import { parseVTODO } from './ics-parser.js';
import { createCalDAVClient, supportsComponent } from '../utils/caldav-client.js';
import { householdTimeZone, utcToWall } from '../utils/timezone.js';
import { setItemTags, setTags } from '../utils/task-tags.js';
import * as todoOutbound from './caldav-todo-outbound.js';
import { runSerialized } from '../utils/sync-lock.js';

// --------------------------------------------------------
// Pure Mapping Helpers
// --------------------------------------------------------

function mapVtodoPriority(p, current = null) {
  const band = p == null ? 'none'
    : p >= 1 && p <= 4 ? 'high'
    : p === 5          ? 'medium'
    : p >= 6 && p <= 9 ? 'low'
    : 'none';

  if (band === 'high' && current === 'urgent') return 'urgent';
  return band;
}






const LOCAL_OPEN_STATES = new Set(['in_progress']);

function mapVtodoStatus(todo, current = null) {
  if (todo.completed) return 'done';
  if (todo.status === 'in-process') return 'in_progress';
  return LOCAL_OPEN_STATES.has(current) ? current : 'open';
}

function splitDue(due, tz = householdTimeZone(null)) {
  if (!due) return { date: null, time: null };
  if (due.length === 10) return { date: due, time: null };

  if (due.endsWith('Z')) {
    const wall = utcToWall(due, tz);
    if (wall) return { date: wall.date, time: wall.time.slice(0, 5) };
  }
  return { date: due.slice(0, 10), time: due.slice(11, 16) || null };
}

// --------------------------------------------------------
// Account Helpers (shared caldav_accounts)
// --------------------------------------------------------

function getAccountById(accountId) {
  return db.get().prepare('SELECT * FROM caldav_accounts WHERE id = ?').get(accountId);
}

function getAllAccounts() {
  return db.get().prepare('SELECT * FROM caldav_accounts').all();
}

function isReminderCollection(cal) {
  return supportsComponent(cal, 'VTODO');
}

const VTODO_FILTERS = [{
  'comp-filter': {
    _attributes: { name: 'VCALENDAR' },
    'comp-filter': { _attributes: { name: 'VTODO' } },
  },
}];

const createClient = createCalDAVClient;

// --------------------------------------------------------
// Reminder-List Discovery & Selection
// --------------------------------------------------------

async function getReminderLists(accountId, { refresh = false, createClient: makeClient } = {}) {
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found.`);
  }







  if (!refresh && account.reminders_discovered_at) {
    const rows = db.get().prepare(`
      SELECT list_url, list_name, target_module, enabled
      FROM caldav_reminder_selection
      WHERE account_id = ?
      ORDER BY list_name
    `).all(accountId);

    return rows.map(r => ({
      listUrl:      r.list_url,
      listName:     r.list_name,
      targetModule: r.target_module,
      enabled:      r.enabled === 1,
    }));
  }

  // Refresh from server, preserving existing enabled/target_module settings
  const client    = await (makeClient || createClient)(account);
  const calendars = await client.fetchCalendars();
  const lists     = calendars.filter(isReminderCollection);

  const result = [];
  for (const cal of lists) {
    const name     = cal.displayName || 'Reminders';
    const existing = db.get().prepare(
      'SELECT target_module, enabled FROM caldav_reminder_selection WHERE account_id = ? AND list_url = ?'
    ).get(accountId, cal.url);

    const targetModule = existing ? existing.target_module : 'tasks';
    const enabled      = existing ? existing.enabled : 0;

    db.get().prepare(`
      INSERT INTO caldav_reminder_selection (account_id, list_url, list_name, target_module, enabled)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, list_url) DO UPDATE SET list_name = excluded.list_name
    `).run(accountId, cal.url, name, targetModule, enabled);

    result.push({ listUrl: cal.url, listName: name, targetModule, enabled: enabled === 1 });
  }

  db.get().prepare(`
    UPDATE caldav_accounts
       SET reminders_discovered_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?
  `).run(accountId);

  log.info(`Discovered ${result.length} reminder list(s) for account ${accountId}.`);
  return result;
}

function ensureShoppingList(sel) {
  if (sel.target_list_id) {
    const existing = db.get().prepare('SELECT id FROM shopping_lists WHERE id = ?').get(sel.target_list_id);
    if (existing) return sel.target_list_id;
  }
  const owner     = db.get().prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  const createdBy = owner ? owner.id : 1;
  const row       = db.get().prepare('INSERT INTO shopping_lists (name, created_by) VALUES (?, ?)').run(sel.list_name, createdBy);
  const id        = row.lastInsertRowid;
  db.get().prepare('UPDATE caldav_reminder_selection SET target_list_id = ? WHERE id = ?').run(id, sel.id);
  sel.target_list_id = id;
  return id;
}

function updateReminderSelection(accountId, listUrl, { enabled, targetModule } = {}) {
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found.`);
  }

  const sel = db.get().prepare(
    'SELECT * FROM caldav_reminder_selection WHERE account_id = ? AND list_url = ?'
  ).get(accountId, listUrl);
  if (!sel) {
    throw new Error(`Reminder list not found for account ${accountId}.`);
  }

  const newModule = targetModule || sel.target_module;
  if (newModule !== 'tasks' && newModule !== 'shopping') {
    throw new Error('Invalid target module (expected "tasks" or "shopping").');
  }
  const newEnabled = enabled === undefined ? sel.enabled : (enabled ? 1 : 0);

  let targetListId = sel.target_list_id;
  if (newModule === 'shopping' && newEnabled === 1) {
    targetListId = ensureShoppingList(sel);
  }

  db.get().prepare(`
    UPDATE caldav_reminder_selection
    SET enabled = ?, target_module = ?, target_list_id = ?
    WHERE account_id = ? AND list_url = ?
  `).run(newEnabled, newModule, targetListId, accountId, listUrl);

  log.info(`Reminder selection updated: account ${accountId}, list ${listUrl}, module=${newModule}, enabled=${newEnabled}`);
  return { success: true };
}

// --------------------------------------------------------
// Upsert Helpers (Inbound: Server → Aashiyana)
// --------------------------------------------------------




// entwerten darf.
function upsertTask(todo, accountId, createdBy, objectUrl = null) {
  const { date, time } = splitDue(todo.due, householdTimeZone(db.get()));

  const existing = db.get().prepare(
    `SELECT id, priority, status FROM tasks WHERE external_uid = ? AND external_source = 'caldav' AND external_account_id = ?`
  ).get(todo.uid, accountId);

  const priority = mapVtodoPriority(todo.priority, existing?.priority);
  const status   = mapVtodoStatus(todo, existing?.status);

  let taskId;
  if (existing) {
    db.get().prepare(`
      UPDATE tasks
      SET title = ?, description = ?, priority = ?, status = ?, due_date = ?, due_time = ?,
          external_object_url = COALESCE(?, external_object_url)
      WHERE id = ?
    `).run(todo.summary, todo.description, priority, status, date, time, objectUrl, existing.id);
    taskId = existing.id;
  } else {
    // category bleibt beim Spalten-Default 'misc' (v114) - VTODO kennt keine

    const row = db.get().prepare(`
      INSERT INTO tasks
        (title, description, priority, status, due_date, due_time, created_by, external_uid, external_source, external_account_id, external_object_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'caldav', ?, ?)
    `).run(todo.summary, todo.description, priority, status, date, time, createdBy, todo.uid, accountId, objectUrl);
    taskId = row.lastInsertRowid;
  }




  setTags(db.get(), taskId, todo.tags);
  return taskId;
}

function applyTaskRelations(seen) {
  const idByUid = new Map([...seen].map(([uid, entry]) => [uid, entry.taskId]));

  // Beide Richtungen auf dieselbe Aussage bringen: Kind -> Elternteil.
  const parentUidOf = new Map();
  for (const [uid, entry] of seen) {
    if (entry.parentUid && idByUid.has(entry.parentUid)) parentUidOf.set(uid, entry.parentUid);
  }
  for (const [uid, entry] of seen) {
    for (const childUid of entry.childUids || []) {

      if (idByUid.has(childUid) && !parentUidOf.has(childUid)) parentUidOf.set(childUid, uid);
    }
  }

  const rootOf = (uid) => {
    const path = new Set([uid]);
    let current = parentUidOf.get(uid);
    while (current && parentUidOf.has(current)) {
      if (path.has(current)) return null;      // Zyklus: lieber flach als falsch
      path.add(current);
      current = parentUidOf.get(current);
    }
    return current && current !== uid ? current : null;
  };

  const update = db.get().prepare('UPDATE tasks SET parent_task_id = ? WHERE id = ? AND parent_task_id IS NOT ?');
  for (const [uid, entry] of seen) {
    const rootUid = parentUidOf.has(uid) ? rootOf(uid) : null;
    const parentId = rootUid ? idByUid.get(rootUid) ?? null : null;


    update.run(parentId, entry.taskId, parentId);
  }
}

function upsertShoppingItem(sel, todo, accountId, objectUrl = null) {
  const listId    = ensureShoppingList(sel);
  const isChecked = todo.completed ? 1 : 0;

  const existing = db.get().prepare(
    `SELECT id FROM shopping_items WHERE external_uid = ? AND external_source = 'caldav' AND external_account_id = ?`
  ).get(todo.uid, accountId);

  let itemId;
  if (existing) {
    db.get().prepare(`
      UPDATE shopping_items
      SET name = ?, is_checked = ?, list_id = ?, external_object_url = COALESCE(?, external_object_url)
      WHERE id = ?
    `).run(todo.summary, isChecked, listId, objectUrl, existing.id);
    itemId = existing.id;
  } else {


    const row = db.get().prepare(`
      INSERT INTO shopping_items
        (list_id, name, is_checked, external_uid, external_source, external_account_id, external_object_url)
      VALUES (?, ?, ?, ?, 'caldav', ?, ?)
    `).run(listId, todo.summary, isChecked, todo.uid, accountId, objectUrl);
    itemId = row.lastInsertRowid;
  }





  setItemTags(db.get(), itemId, todo.tags);
}



const PRUNABLE_TABLES = new Set(['tasks', 'shopping_items']);

export function pruneRemoved(database, table, accountId, seenUids) {
  if (!PRUNABLE_TABLES.has(table)) {
    throw new Error(`pruneRemoved: refusing to prune unknown table "${table}".`);
  }

  const uids = [...new Set(seenUids)];

  if (uids.length === 0) {
    const remaining = database.prepare(
      `SELECT COUNT(*) AS count FROM ${table}
       WHERE external_source = 'caldav' AND external_account_id = ?`
    ).get(accountId).count;

    if (remaining > 0) {
      log.warn(
        `Account ${accountId}: server returned no reminders, but ${remaining} ${table} row(s) ` +
        `exist locally. Skipping deletion — assuming a fetch error rather than an emptied list.`
      );
    }
    return 0;
  }

  const placeholders = uids.map(() => '?').join(',');
  const result = database.prepare(
    `DELETE FROM ${table}
     WHERE external_source = 'caldav' AND external_account_id = ?
       AND external_uid NOT IN (${placeholders})`
  ).run(accountId, ...uids);

  return result.changes;
}

// --------------------------------------------------------

// --------------------------------------------------------

async function sync(opts = {}) {
  return runSerialized('caldav-todo', 'sync', () => runSync(opts));
}

async function runSync({ createClient: makeClient } = {}) {
  const accounts = getAllAccounts();
  if (accounts.length === 0) {
    return { success: true, syncedAccounts: 0, syncedItems: 0 };
  }

  // Client-Factory injizierbar (Tests), Default = echter tsdav-Client.
  const clientFactory = makeClient || createClient;

  let totalItems       = 0;
  let totalPushed      = 0;
  let successfulAccounts = 0;

  for (const account of accounts) {
    try {
      const enabledLists = db.get().prepare(`
        SELECT * FROM caldav_reminder_selection WHERE account_id = ? AND enabled = 1
      `).all(account.id);

      if (enabledLists.length === 0) continue;

      const client     = await clientFactory(account);
      const serverCals  = await client.fetchCalendars();
      const owner       = db.get().prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
      const createdBy   = owner ? owner.id : 1;

      const seenByModule = { tasks: [], shopping: [] };




      const incompleteModules = new Set();




      const pendingByModule = {
        tasks: {
          deleted: todoOutbound.pendingDeletionUids(account.id, 'tasks'),
          dirty:   todoOutbound.pendingUpdateUids(account.id, 'tasks'),
        },
        shopping: {
          deleted: todoOutbound.pendingDeletionUids(account.id, 'shopping'),
          dirty:   todoOutbound.pendingUpdateUids(account.id, 'shopping'),
        },
      };


      const objectsByModule = { tasks: new Map(), shopping: new Map() };


      const taskRelations = new Map();

      for (const sel of enabledLists) {
        const module = sel.target_module === 'shopping' ? 'shopping' : 'tasks';
        const serverCal = serverCals.find(c => c.url === sel.list_url);
        if (!serverCal) {
          log.warn(`Reminder list ${sel.list_url} not found on server, disabling.`);
          db.get().prepare('UPDATE caldav_reminder_selection SET enabled = 0 WHERE id = ?').run(sel.id);
          incompleteModules.add(module);
          continue;
        }

        let objects;
        try {
          objects = await client.fetchCalendarObjects({ calendar: serverCal, filters: VTODO_FILTERS });
        } catch (err) {
          log.error(`Failed to fetch VTODOs from "${sel.list_name}":`, err.message);
          incompleteModules.add(module);
          continue;
        }

        for (const obj of objects) {
          const todos = parseVTODO(obj.data || '');
          for (const todo of todos) {
            try {
              if (obj.url) {
                objectsByModule[module].set(todo.uid, {
                  url: obj.url, etag: obj.etag, data: obj.data,
                });
              }


              seenByModule[module].push(todo.uid);



              if (pendingByModule[module].deleted.has(todo.uid)) continue;


              if (pendingByModule[module].dirty.has(todo.uid)) continue;

              if (module === 'shopping') {
                upsertShoppingItem(sel, todo, account.id, obj.url || null);
              } else {
                const taskId = upsertTask(todo, account.id, createdBy, obj.url || null);
                taskRelations.set(todo.uid, {
                  taskId,
                  parentUid: todo.parentUid || null,
                  childUids: todo.childUids || [],
                });
              }
              totalItems++;
            } catch (err) {
              log.error(`Failed to upsert VTODO ${todo.uid}:`, err.message);
            }
          }
        }
      }



      if (taskRelations.size > 0) {
        try {
          applyTaskRelations(taskRelations);
        } catch (err) {
          log.error(`Failed to apply VTODO relations for account ${account.id}:`, err.message);
        }
      }

      // Prune locally-stored caldav items that vanished remotely.

      const hasTasks    = enabledLists.some(s => s.target_module === 'tasks');
      const hasShopping = enabledLists.some(s => s.target_module === 'shopping');

      if (hasTasks) {
        if (incompleteModules.has('tasks')) {
          log.warn(`Account ${account.id}: a reminder list could not be fetched, skipping task deletion.`);
        } else {
          pruneRemoved(db.get(), 'tasks', account.id, seenByModule.tasks);
        }
      }

      if (hasShopping) {
        if (incompleteModules.has('shopping')) {
          log.warn(`Account ${account.id}: a reminder list could not be fetched, skipping shopping deletion.`);
        } else {
          pruneRemoved(db.get(), 'shopping_items', account.id, seenByModule.shopping);
        }
      }




      //



      for (const module of ['tasks', 'shopping']) {
        const complete = !incompleteModules.has(module);
        try {
          const removed = await todoOutbound.processPendingDeletions(
            client, account.id, module, objectsByModule[module], complete
          );
          const pushed = await todoOutbound.processPendingUpdates(
            client, account.id, module, objectsByModule[module]
          );
          totalPushed += pushed;
          if (removed) log.info(`${removed} pending VTODO deletion(s) applied on the server.`);
          if (pushed)  log.info(`${pushed} local VTODO change(s) pushed to the server.`);
        } catch (err) {
          log.error(`Outbound VTODO changes failed for account ${account.id} (${module}):`, err.message);
        }
      }






      try {
        const taskLists = new Map(
          enabledLists
            .filter((s) => s.target_module !== 'shopping')
            .map((s) => [s.list_url, serverCals.find((c) => c.url === s.list_url)])
            .filter(([, cal]) => cal)
        );
        const created = await todoOutbound.processPendingCreations(
          client, account.id, 'tasks', taskLists
        );
        totalPushed += created;
        if (created) log.info(`${created} locally created task(s) uploaded to the server.`);
      } catch (err) {
        log.error(`Uploading local tasks failed for account ${account.id}:`, err.message);
      }



      // reicht sie hier hinein.
      try {
        const shoppingSelections = enabledLists.filter((s) => s.target_module === 'shopping');
        const shoppingLists = new Map(
          shoppingSelections
            .map((s) => [s.list_url, serverCals.find((c) => c.url === s.list_url)])
            .filter(([, cal]) => cal)
        );
        const created = await todoOutbound.processPendingShoppingCreations(
          client,
          account.id,
          shoppingSelections.map((s) => ({ listUrl: s.list_url, targetListId: s.target_list_id })),
          shoppingLists
        );
        totalPushed += created;
        if (created) log.info(`${created} locally created shopping item(s) uploaded to the server.`);
      } catch (err) {
        log.error(`Uploading local shopping items failed for account ${account.id}:`, err.message);
      }

      db.get().prepare('UPDATE caldav_accounts SET last_sync = ? WHERE id = ?')
        .run(new Date().toISOString(), account.id);
      successfulAccounts++;
    } catch (err) {
      log.error(`Reminders sync failed for account ${account.id}:`, err.message);
    }
  }

  log.info(`CalDAV reminders sync complete: ${successfulAccounts}/${accounts.length} accounts, ${totalItems} items.`);
  return {
    success: true,
    syncedAccounts: successfulAccounts,
    syncedItems: totalItems,
    pushedItems: totalPushed,
  };
}

function getStatus() {
  const accounts = getAllAccounts();

  const accountStatus = accounts.map(acc => {
    const enabledLists = db.get().prepare(
      'SELECT COUNT(*) AS c FROM caldav_reminder_selection WHERE account_id = ? AND enabled = 1'
    ).get(acc.id).c;
    return {
      id:           acc.id,
      name:         acc.name,
      lastSync:     acc.last_sync,
      enabledLists,
    };
  });

  const totalEnabledLists = db.get().prepare(
    'SELECT COUNT(*) AS c FROM caldav_reminder_selection WHERE enabled = 1'
  ).get().c;

  return {
    accounts: accountStatus,
    totalAccounts: accounts.length,
    totalEnabledLists,
  };
}

// --------------------------------------------------------
// Exports
// --------------------------------------------------------

export {
  mapVtodoPriority,
  mapVtodoStatus,
  splitDue,
  applyTaskRelations,
  getReminderLists,
  updateReminderSelection,
  sync,
  getStatus,
};
