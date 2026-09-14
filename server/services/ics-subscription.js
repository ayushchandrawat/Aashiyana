
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { createLogger } from '../logger.js';
import * as db from '../db.js';
import { assignDefaultToEvent } from './sync-assignment.js';
import { parseICS, expandRRULE, normalizeRecurrenceOverrides } from './ics-parser.js';
import { isBlockedAddress, readPrivateNetworkOptIn, createGuardedLookup } from '../utils/ssrf.js';
import { safeRequest } from '../utils/http.js';

const log = createLogger('ICS');

const SYNC_WINDOW_PAST_MONTHS   = 6;
const SYNC_WINDOW_FUTURE_MONTHS = 12;
const MAX_RESPONSE_BYTES        = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS          = 15_000;

const ENV_ALLOW_PRIVATE_NETWORK = 'ICS_SUBSCRIPTION_ALLOW_PRIVATE_NETWORK';

const syncingNow = new Set();

function isPrivateNetworkAllowed() {
  return readPrivateNetworkOptIn(ENV_ALLOW_PRIVATE_NETWORK);
}

function normalizeUrl(raw) {
  const allowPrivate = isPrivateNetworkAllowed();
  const url = new URL(raw.replace(/^webcal:\/\//i, 'https://'));
  const allowed = allowPrivate ? ['https:', 'http:'] : ['https:'];
  if (!allowed.includes(url.protocol)) {
    throw new Error(allowPrivate
      ? 'Only http://, https:// and webcal:// URLs are allowed.'
      : 'Only https:// and webcal:// URLs are allowed.');
  }
  return url.href;
}

/**
 * `allowPrivateNetwork` defaults to this module's own opt-in
 * (ICS_SUBSCRIPTION_ALLOW_PRIVATE_NETWORK) but can be swapped for another
 * module's - waste-url-source.js passes its own WASTE_SOURCE_ALLOW_PRIVATE_NETWORK
 * check here instead of keeping a second copy of this whole function.
 */
async function checkSSRF(urlStr, allowPrivateNetwork = isPrivateNetworkAllowed) {
  if (allowPrivateNetwork()) return;
  const hostname = new URL(urlStr).hostname;

  const host = hostname.replace(/^\[|\]$/g, '');


  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error(`URL resolves to a private IP address: ${host}`);
    return;
  }
  const v4 = await dns.resolve4(hostname).catch(() => []);
  const v6 = await dns.resolve6(hostname).catch(() => []);
  for (const addr of [...v4, ...v6]) {
    if (isBlockedAddress(addr)) {
      throw new Error(`URL resolves to a private IP address: ${addr}`);
    }
  }
}

async function fetchAndParse(urlRaw, etag, lastModified) {
  const url = normalizeUrl(urlRaw);
  await checkSSRF(url);

  const headers = {};
  if (etag)         headers['If-None-Match']     = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);



  const reqOpts = { headers, signal: controller.signal };
  if (!isPrivateNetworkAllowed()) reqOpts.lookup = createGuardedLookup();
  let res;
  try {
    res = await safeRequest(url, reqOpts);
  } finally { clearTimeout(timer); }

  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const cl = parseInt(res.headers.get('content-length') || '0', 10);
  if (cl > MAX_RESPONSE_BYTES) throw new Error('ICS file exceeds the 10 MB limit.');

  let body = '', received = 0;
  for await (const chunk of res.body) {
    received += chunk.length;
    if (received > MAX_RESPONSE_BYTES) throw new Error('ICS file exceeds the 10 MB limit.');
    body += chunk.toString();
  }

  return {
    events:          parseICS(body),
    newEtag:         res.headers.get('etag') || null,
    newLastModified: res.headers.get('last-modified') || null,
    notModified:     false,
  };
}

function syncWindow() {
  const now = new Date();
  const past = new Date(now); past.setMonth(past.getMonth() - SYNC_WINDOW_PAST_MONTHS);
  const future = new Date(now); future.setMonth(future.getMonth() + SYNC_WINDOW_FUTURE_MONTHS);
  return { windowStart: past.toISOString().slice(0, 10), windowEnd: future.toISOString().slice(0, 10) };
}

async function syncOne(sub) {
  if (syncingNow.has(sub.id)) {
    log.info(`Subscription ${sub.id} is already syncing - skipped.`);
    return;
  }
  syncingNow.add(sub.id);
  try {
    let result;
    try { result = await fetchAndParse(sub.url, sub.etag, sub.last_modified); }
    catch (err) {
      log.warn(`Subscription ${sub.id} (${sub.name}): fetch failed - ${err.message}`);
      return;
    }

    if (result.notModified) {
      db.get().prepare(`UPDATE ics_subscriptions SET last_sync = ? WHERE id = ?`)
        .run(new Date().toISOString(), sub.id);
      return;
    }

    const { events, newEtag, newLastModified } = result;
    const { windowStart, windowEnd } = syncWindow();
    const owner    = db.get().prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
    const createdBy = sub.created_by ?? owner?.id;
    if (!createdBy) { log.warn('No user found.'); return; }




    const normalized = normalizeRecurrenceOverrides(events);
    const flatEvents = [];
    for (const ev of normalized) {
      if (ev.rrule) {
        flatEvents.push(...expandRRULE(ev, windowStart, windowEnd));
      } else if (ev.dtstart >= windowStart && ev.dtstart <= windowEnd) {
        flatEvents.push(ev);
      }
    }

    const seenUids = new Set(flatEvents.map((e) => e.uid));



    // Wiederkehren nach manuellem Entfernen).
    const existingUids = new Set(
      db.get().prepare('SELECT external_calendar_id FROM calendar_events WHERE subscription_id = ?')
        .all(sub.id).map((r) => r.external_calendar_id)
    );





    // changes und total_changes() unsichtbar.
    const findExisting = db.get().prepare(`
      SELECT id FROM calendar_events
      WHERE subscription_id = ? AND external_calendar_id = ?
    `);

    const insertEvent = db.get().prepare(`
      INSERT INTO calendar_events
        (title, description, start_datetime, end_datetime, all_day, location,
         color, external_calendar_id, external_source, subscription_id, recurrence_rule, user_modified, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ics', ?, ?, 0, ?)
    `);







    const updateEvent = db.get().prepare(`
      UPDATE calendar_events
      SET title = ?, description = ?, start_datetime = ?, end_datetime = ?,
          all_day = ?, location = ?, color = ?
      WHERE id = ? AND user_modified = 0
        AND (   title          IS NOT ?
             OR description    IS NOT ?
             OR start_datetime IS NOT ?
             OR end_datetime   IS NOT ?
             OR all_day        IS NOT ?
             OR location       IS NOT ?
             OR color          IS NOT ?
            )
    `);

    const deleteStale = db.get().prepare(`
      DELETE FROM calendar_events
      WHERE subscription_id = ?
        AND external_calendar_id NOT IN (SELECT value FROM json_each(?))
        AND user_modified = 0
    `);




    let changedEvents = 0;

    db.get().transaction(() => {
      for (const ev of flatEvents) {
        try {




          const color    = ev.color ?? null;
          const existing = findExisting.get(sub.id, ev.uid);
          if (existing) {

            const values = [
              ev.summary, ev.description, ev.dtstart, ev.dtend,
              ev.allDay ? 1 : 0, ev.location, color,
            ];
            changedEvents += updateEvent.run(...values, existing.id, ...values).changes;
          } else {
            insertEvent.run(ev.summary, ev.description, ev.dtstart, ev.dtend,
              ev.allDay ? 1 : 0, ev.location, color, ev.uid, sub.id, ev.rrule, createdBy);
            changedEvents++;
          }
        } catch (err) { log.error(`Upsert UID ${ev.uid}: ${err.message}`); }
      }
      changedEvents += deleteStale.run(sub.id, JSON.stringify([...seenUids])).changes;

      // #459: neu importierte Termine der Standard-Person zuweisen.
      if (sub.default_assignee_user_id) {
        for (const ev of flatEvents) {
          if (existingUids.has(ev.uid)) continue;
          const row = db.get().prepare(
            'SELECT id FROM calendar_events WHERE subscription_id = ? AND external_calendar_id = ?'
          ).get(sub.id, ev.uid);
          if (row) assignDefaultToEvent(db.get(), row.id, sub.default_assignee_user_id);
        }
      }

      db.get().prepare(`UPDATE ics_subscriptions SET last_sync = ?, etag = ?, last_modified = ? WHERE id = ?`)
        .run(new Date().toISOString(), newEtag, newLastModified, sub.id);
    })();



    const summary = `Subscription ${sub.id} (${sub.name}): ${flatEvents.length} events seen, ${changedEvents} changed.`;
    if (changedEvents > 0) log.info(summary);
    else log.debug(summary);
  } finally { syncingNow.delete(sub.id); }
}

async function sync(subscriptionId) {
  const subs = subscriptionId
    ? db.get().prepare('SELECT * FROM ics_subscriptions WHERE id = ?').all(subscriptionId)
    : db.get().prepare('SELECT * FROM ics_subscriptions').all();
  for (const sub of subs) {
    try { await syncOne(sub); }
    catch (err) { log.error(`Subscription ${sub.id} sync failed: ${err.message}`); }
  }
}

function getAll(userId) {
  return db.get().prepare(`
    SELECT * FROM ics_subscriptions WHERE shared = 1 OR created_by = ? ORDER BY name ASC
  `).all(userId);
}

function toLocalRRule(raw) {
  if (!raw) return null;
  const body  = String(raw).replace(/^RRULE:/i, '');
  const parts = {};
  for (const seg of body.split(';')) {
    const eq = seg.indexOf('=');
    if (eq === -1) continue;
    parts[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1).toUpperCase();
  }
  const freq = parts.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  let rule = `FREQ=${freq}`;
  const interval = parseInt(parts.INTERVAL ?? '1', 10);
  if (Number.isInteger(interval) && interval > 1 && interval < 100) rule += `;INTERVAL=${interval}`;
  if (parts.BYDAY) {
    const days = parts.BYDAY.split(',')
      .map((d) => d.trim())
      .filter((d) => /^(MO|TU|WE|TH|FR|SA|SU)$/.test(d));
    if (days.length) rule += `;BYDAY=${days.join(',')}`;
  }





  if (freq === 'MONTHLY' && String(parts.BYMONTHDAY ?? '').trim() === '-1') rule += ';BYMONTHDAY=-1';
  const count = parts.COUNT ? parseInt(parts.COUNT, 10) : null;
  if (Number.isInteger(count) && count > 0) {
    rule += `;COUNT=${count}`;
  } else if (parts.UNTIL) {
    const m = /^(\d{8})(T\d{6}Z)?/.exec(parts.UNTIL);
    if (m) rule += `;UNTIL=${m[1]}${m[2] || ''}`;
  }
  return rule;
}

async function importToLocal(userId, { ics, url, color } = {}) {
  let rawEvents;
  if (typeof ics === 'string' && ics.trim()) {
    rawEvents = parseICS(ics);
  } else if (typeof url === 'string' && url.trim()) {
    const result = await fetchAndParse(url, null, null);
    rawEvents = result.events || [];
  } else {
    throw new Error('Either an ICS file or a URL is required.');
  }


  rawEvents = normalizeRecurrenceOverrides(rawEvents);






  const fallbackColor = color || '#007AFF';
  const insert = db.get().prepare(`
    INSERT INTO calendar_events
      (title, description, start_datetime, end_datetime, all_day, location,
       color, external_calendar_id, external_source, subscription_id,
       recurrence_rule, user_modified, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL, ?, 0, ?)
  `);
  const existsStmt = db.get().prepare(`
    SELECT 1 FROM calendar_events
    WHERE created_by = ? AND subscription_id IS NULL AND external_calendar_id = ?
    LIMIT 1
  `);

  // lokal ausgenommene Einzeltermine (#489), matcht per Instanz-Datum.
  const insertException = db.get().prepare(
    'INSERT OR IGNORE INTO calendar_event_exceptions (event_id, exception_date) VALUES (?, ?)'
  );

  let imported = 0;
  let skipped  = 0;
  const total  = rawEvents.length;

  db.get().transaction(() => {
    for (const ev of rawEvents) {
      if (!ev.dtstart) { skipped++; continue; }
      if (ev.uid && existsStmt.get(userId, ev.uid)) { skipped++; continue; }
      try {
        const localRule = toLocalRRule(ev.rrule);
        const info = insert.run(
          ev.summary, ev.description, ev.dtstart, ev.dtend,
          ev.allDay ? 1 : 0, ev.location, ev.color || fallbackColor,
          ev.uid || null, localRule, userId,
        );

        if (localRule && Array.isArray(ev.exdates) && ev.exdates.length) {
          const eventId = Number(info.lastInsertRowid);
          for (const exDate of ev.exdates) insertException.run(eventId, exDate);
        }
        imported++;
      } catch (err) {
        log.error(`Import UID ${ev.uid}: ${err.message}`);
        skipped++;
      }
    }
  })();

  log.info(`Imported ${imported}/${total} events for user ${userId} (${skipped} skipped).`);
  return { imported, skipped, total };
}

async function create(userId, { name, url, color, shared, default_assignee_user_id = null }) {
  const normalizedUrl = normalizeUrl(url);
  await checkSSRF(normalizedUrl);


  const subId = db.get().prepare(
    `INSERT INTO ics_subscriptions (name,url,color,shared,created_by,default_assignee_user_id)
     VALUES (?,?,?,?,?,?)`
  ).run(name, normalizedUrl, color, shared ? 1 : 0, userId, default_assignee_user_id).lastInsertRowid;
  const newSub = db.get().prepare('SELECT * FROM ics_subscriptions WHERE id = ?').get(subId);
  let syncError = null;
  try { await syncOne(newSub); } catch (err) { syncError = err.message; }
  return { sub: newSub, syncError };
}

function update(userId, subId, fields, isAdmin) {
  const sub = db.get().prepare('SELECT * FROM ics_subscriptions WHERE id = ?').get(subId);
  if (!sub) return null;
  if (!isAdmin && sub.created_by !== userId) throw new Error('Not authorized.');
  const name   = fields.name   !== undefined ? fields.name   : sub.name;
  const color  = fields.color  !== undefined ? fields.color  : sub.color;
  const shared = fields.shared !== undefined ? (fields.shared ? 1 : 0) : sub.shared;
  const assignee = fields.default_assignee_user_id !== undefined
    ? fields.default_assignee_user_id
    : sub.default_assignee_user_id;
  db.get().prepare(`UPDATE ics_subscriptions SET name = ?, color = ?, shared = ?, default_assignee_user_id = ? WHERE id = ?`)
    .run(name, color, shared, assignee, subId);
  return db.get().prepare('SELECT * FROM ics_subscriptions WHERE id = ?').get(subId);
}

function remove(userId, subId, isAdmin) {
  const sub = db.get().prepare('SELECT * FROM ics_subscriptions WHERE id = ?').get(subId);
  if (!sub) return false;
  if (!isAdmin && sub.created_by !== userId) throw new Error('Not authorized.');
  db.get().prepare('DELETE FROM ics_subscriptions WHERE id = ?').run(subId);
  return true;
}

export { sync, getAll, create, update, remove, importToLocal, toLocalRRule, fetchAndParse, normalizeUrl, checkSSRF, isPrivateNetworkAllowed };
