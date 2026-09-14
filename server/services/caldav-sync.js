
import { createLogger } from '../logger.js';
const log = createLogger('CalDAV');

import * as db from '../db.js';
import { upsertExternalCalendar } from './external-calendars.js';
import { assignDefaultToEvent } from './sync-assignment.js';
import { pruneDeletedEvents, countMirroredEvents, deleteMirroredEvents } from './calendar-prune.js';
import * as outbound from './calendar-outbound.js';
import { processPendingDeletions, processPendingUpdates, flushAccount } from './caldav-outbound.js';
import { detachAccountRows } from './caldav-todo-outbound.js';
import { runSerialized } from '../utils/sync-lock.js';
import { toICSDatetime, escapeICSText } from '../utils/ics-format.js';
import { eventDateTimeFields } from '../utils/ics-datetime.js';
import { vtimezoneFor } from '../utils/vtimezone.js';
import { householdTimeZone } from '../utils/timezone.js';
import { createCalDAVClient, supportsComponent } from '../utils/caldav-client.js';
import { rruleLine } from './recurrence.js';
import { nearestIcalColorName } from '../utils/ical-color.js';
import { outboundEvent } from './outbound-dtstart.js';

// Reused functions from apple-calendar.js
import {
  parseICS,
  formatICSDate,
  tzLocalToUTC,
  applyDuration,
  normalizeRecurrenceOverrides
} from './ics-parser.js';



export { toICSDatetime };

function buildCalDAVICS(event, householdZone = null) {
  const uid  = `oikos-${event.id}@oikos.local`;
  const now  = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');




  // importiertes DTSTART bleibt unberuehrt (#756).
  const when = eventDateTimeFields(outboundEvent(event), householdZone);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aashiyana//CalDAV Sync//EN',
  ];


  if (when.tzid) lines.push(...vtimezoneFor(when.tzid, Number(String(event.start_datetime).slice(0, 4))));
  lines.push(
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeICSText(event.title)}`,
    `DTSTART${when.dtstart.params}:${when.dtstart.value}`,
    `DTEND${when.dtend.params}:${when.dtend.value}`,
  );

  if (event.description)     lines.push(`DESCRIPTION:${escapeICSText(event.description)}`);
  if (event.location)        lines.push(`LOCATION:${escapeICSText(event.location)}`);


  const colorName = nearestIcalColorName(event.color);
  if (colorName) lines.push(`COLOR:${colorName}`);

  if (event.recurrence_rule) {
    lines.push(rruleLine(event.recurrence_rule));
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// --------------------------------------------------------
// Helper Functions
// --------------------------------------------------------

function normalizeCalColor(c) {
  if (!c) return null;
  if (/^#[0-9a-fA-F]{8}$/.test(c)) return c.slice(0, 7); // strip alpha
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return null;
}

// --------------------------------------------------------
// Credentials Helpers
// --------------------------------------------------------

function getAccountById(accountId) {
  return db.get().prepare('SELECT * FROM caldav_accounts WHERE id = ?').get(accountId);
}

function getAllAccounts() {
  return db.get().prepare('SELECT * FROM caldav_accounts').all();
}

// --------------------------------------------------------
// Connection Testing
// --------------------------------------------------------

function eventCalendars(calendars) {
  return (calendars || []).filter(cal => supportsComponent(cal, 'VEVENT'));
}

async function testConnection(caldavUrl, username, password, { createClient } = {}) {
  try {
    const makeClient = createClient || createCalDAVClient;
    const client = await makeClient({ caldav_url: caldavUrl, username, password });

    const calendars = await client.fetchCalendars();
    if (!calendars.length) {
      throw new Error('Connected, but no calendars found.');
    }

    return { ok: true, calendars };
  } catch (err) {
    log.error('Connection test failed:', err.message);
    throw new Error(`CalDAV connection failed: ${err.message}`);
  }
}

// --------------------------------------------------------
// Account Management
// --------------------------------------------------------

async function addAccount(name, caldavUrl, username, password, { createClient } = {}) {
  // Validate inputs
  if (!name || !caldavUrl || !username || !password) {
    throw new Error('All fields required: name, caldavUrl, username, password');
  }



  const { calendars } = await testConnection(caldavUrl, username, password, { createClient });

  // Check for duplicate
  const existing = db.get().prepare(
    'SELECT id FROM caldav_accounts WHERE caldav_url = ? AND username = ?'
  ).get(caldavUrl, username);

  if (existing) {
    throw new Error('Account with this URL and username already exists.');
  }

  // Warn if DB_ENCRYPTION_KEY not set
  if (!process.env.DB_ENCRYPTION_KEY) {
    log.warn('WARNING: DB_ENCRYPTION_KEY is not set - CalDAV credentials will be stored unencrypted.');
  }

  // Insert account
  const result = db.get().prepare(`
    INSERT INTO caldav_accounts (name, caldav_url, username, password)
    VALUES (?, ?, ?, ?)
  `).run(name, caldavUrl, username, password);

  const accountId = result.lastInsertRowid;





  // Termine man einzeln wieder loswerden musste. Wer verbindet, waehlt danach

  const calendarData = [];
  for (const cal of eventCalendars(calendars)) {
    const calColor = normalizeCalColor(cal.calendarColor) || '#4A90E2';
    const calName = cal.displayName || 'Unnamed Calendar';

    db.get().prepare(`
      INSERT INTO caldav_calendar_selection (account_id, calendar_url, calendar_name, calendar_color, enabled)
      VALUES (?, ?, ?, ?, 0)
    `).run(accountId, cal.url, calName, calColor);

    calendarData.push({ url: cal.url, name: calName, color: calColor, enabled: false });
  }

  log.info(`Added CalDAV account "${name}" with ${calendarData.length} calendars.`);

  return { accountId, calendars: calendarData };
}

function listAccounts() {
  const accounts = db.get().prepare(`
    SELECT id, name, caldav_url, username, created_at, last_sync
    FROM caldav_accounts
    ORDER BY created_at DESC
  `).all();

  // Do NOT return password (security)
  return accounts.map(acc => ({
    id: acc.id,
    name: acc.name,
    caldavUrl: acc.caldav_url,
    username: acc.username,
    createdAt: acc.created_at,
    lastSync: acc.last_sync,


    eventCount: countAccountEvents(acc.id),
  }));
}

async function updateAccount(accountId, { name, caldavUrl, username, password, createClient }) {
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found.`);
  }

  // If credentials changed, test connection
  const credentialsChanged =
    (caldavUrl && caldavUrl !== account.caldav_url) ||
    (username && username !== account.username) ||
    (password && password !== account.password);

  if (credentialsChanged) {
    const testUrl = caldavUrl || account.caldav_url;
    const testUser = username || account.username;
    const testPwd = password || account.password;

    const { calendars } = await testConnection(testUrl, testUser, testPwd, { createClient });

    // If credentials changed, refresh calendar list
    if (calendars) {



      const previous = new Map(
        db.get().prepare('SELECT calendar_url, enabled FROM caldav_calendar_selection WHERE account_id = ?')
          .all(accountId).map((row) => [row.calendar_url, row.enabled === 1])
      );

      // Delete old selections
      db.get().prepare('DELETE FROM caldav_calendar_selection WHERE account_id = ?').run(accountId);

      // Insert new selections
      for (const cal of eventCalendars(calendars)) {
        const calColor = normalizeCalColor(cal.calendarColor) || '#4A90E2';
        const calName = cal.displayName || 'Unnamed Calendar';

        db.get().prepare(`
          INSERT INTO caldav_calendar_selection (account_id, calendar_url, calendar_name, calendar_color, enabled)
          VALUES (?, ?, ?, ?, ?)
        `).run(accountId, cal.url, calName, calColor, (previous.get(cal.url) ?? false) ? 1 : 0);
      }
    }
  }

  // Update account
  const updates = [];
  const values = [];

  if (name) { updates.push('name = ?'); values.push(name); }
  if (caldavUrl) { updates.push('caldav_url = ?'); values.push(caldavUrl); }
  if (username) { updates.push('username = ?'); values.push(username); }
  if (password) { updates.push('password = ?'); values.push(password); }

  if (updates.length === 0) {
    throw new Error('No fields to update.');
  }

  values.push(accountId);

  db.get().prepare(`
    UPDATE caldav_accounts SET ${updates.join(', ')} WHERE id = ?
  `).run(...values);

  log.info(`Updated CalDAV account ${accountId}.`);

  return { success: true };
}

function deleteAccount(accountId, { deleteEvents = false } = {}) {
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found.`);
  }










  const calendarUrls = accountCalendarUrls(accountId);

  const { detached, removed } = db.get().transaction(() => {


    // ausdruecklich gewaehlte.
    const cleared = deleteEvents ? deleteMirroredEvents(db.get(), calendarUrls) : 0;
    const rows = detachAccountRows(accountId);
    db.get().prepare('DELETE FROM caldav_accounts WHERE id = ?').run(accountId);
    return { detached: rows, removed: cleared };
  })();

  log.info(
    `Deleted CalDAV account ${accountId} ("${account.name}"), detached ${detached} mirrored row(s).`
    + (removed ? `, ${removed} mirrored event(s) removed` : '')
  );

  return { success: true, removed };
}

// --------------------------------------------------------
// Calendar Selection
// --------------------------------------------------------

async function getCalendars(accountId, { refresh = false, createClient } = {}) {
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found.`);
  }

  if (!refresh) {
    // Return from DB
    const calendars = db.get().prepare(`
      SELECT calendar_url, calendar_name, calendar_color, enabled
      FROM caldav_calendar_selection
      WHERE account_id = ?
      ORDER BY calendar_name
    `).all(accountId);


    const assigneeMap = new Map(
      db.get().prepare(`SELECT external_id, default_assignee_user_id FROM external_calendars WHERE source = 'caldav'`)
        .all().map((r) => [r.external_id, r.default_assignee_user_id])
    );

    return calendars.map(cal => ({
      calendarUrl: cal.calendar_url,
      calendarName: cal.calendar_name,
      calendarColor: cal.calendar_color,
      enabled: cal.enabled === 1,
      default_assignee_user_id: assigneeMap.get(cal.calendar_url) ?? null,
      synced: assigneeMap.has(cal.calendar_url),



      eventCount: countMirroredEvents(db.get(), [cal.calendar_url]),
    }));
  }

  // Refresh from server
  const { calendars } = await testConnection(
    account.caldav_url, account.username, account.password, { createClient }
  );





  // seinen Terminen (#732). Deshalb den Stand je calendar_url vorher sichern

  const previous = new Map(
    db.get().prepare('SELECT calendar_url, enabled FROM caldav_calendar_selection WHERE account_id = ?')
      .all(accountId).map((row) => [row.calendar_url, row.enabled === 1])
  );

  db.get().prepare('DELETE FROM caldav_calendar_selection WHERE account_id = ?').run(accountId);

  const result = [];
  for (const cal of eventCalendars(calendars)) {
    const calColor = normalizeCalColor(cal.calendarColor) || '#4A90E2';
    const calName = cal.displayName || 'Unnamed Calendar';
    // Bekannter Kalender behaelt seinen Stand, ein neu gemeldeter kommt

    const enabled = previous.get(cal.url) ?? false;

    db.get().prepare(`
      INSERT INTO caldav_calendar_selection (account_id, calendar_url, calendar_name, calendar_color, enabled)
      VALUES (?, ?, ?, ?, ?)
    `).run(accountId, cal.url, calName, calColor, enabled ? 1 : 0);

    result.push({
      calendarUrl: cal.url,
      calendarName: calName,
      calendarColor: calColor,
      enabled,
    });
  }

  log.info(`Refreshed calendars for account ${accountId}.`);

  return result;
}

function updateCalendarSelection(accountId, calendarUrl, enabled, { deleteEvents = false } = {}) {
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found.`);
  }

  const enabledValue = enabled ? 1 : 0;

  const result = db.get().prepare(`
    UPDATE caldav_calendar_selection
    SET enabled = ?
    WHERE account_id = ? AND calendar_url = ?
  `).run(enabledValue, accountId, calendarUrl);

  if (result.changes === 0) {
    throw new Error(`Calendar not found for account ${accountId}.`);
  }

  const removed = (!enabled && deleteEvents)
    ? deleteMirroredEvents(db.get(), [calendarUrl])
    : 0;

  log.info(`Calendar selection updated: account ${accountId}, calendar ${calendarUrl}, enabled=${enabled}`
    + (removed ? `, ${removed} mirrored event(s) removed` : ''));

  return { success: true, removed };
}

function accountCalendarUrls(accountId) {
  return db.get().prepare(
    'SELECT calendar_url FROM caldav_calendar_selection WHERE account_id = ?'
  ).all(accountId).map((r) => r.calendar_url);
}

function countAccountEvents(accountId) {
  return countMirroredEvents(db.get(), accountCalendarUrls(accountId));
}

// --------------------------------------------------------
// Sync
// --------------------------------------------------------





const YIELD_EVERY = 50;

const defaultClientFactory = createCalDAVClient;

async function sync(opts = {}) {
  return runSerialized('caldav', 'sync', () => runSync(opts));
}

async function runSync({ createClient } = {}) {
  const accounts = getAllAccounts();

  if (accounts.length === 0) {
    log.debug('No CalDAV accounts configured.');
    return { success: true, syncedAccounts: 0, syncedEvents: 0 };
  }

  // Client-Factory injizierbar (Tests), Default = echter tsdav-Client.
  const makeClient = createClient || defaultClientFactory;

  let totalSyncedEvents = 0;



  let totalChangedEvents = 0;
  let successfulAccounts = 0;



  const conn = db.get();
  const selExistingEvent = conn.prepare(
    `SELECT id, outbound_dirty FROM calendar_events WHERE external_calendar_id = ? AND external_source = 'caldav'`
  );

  const pendingDeletionUids = outbound.pendingDeletionUids('caldav');






  // beiden abgeleiteten Spalten wiederholen ihren SET-Ausdruck, damit eine


  //




  const updEvent = conn.prepare(`
    UPDATE calendar_events
    SET title = ?, description = ?, start_datetime = ?, end_datetime = ?,
        all_day = ?, location = ?, recurrence_rule = ?, tzid = ?,
        color = CASE WHEN color_modified = 0 THEN ? ELSE color END,
        calendar_ref_id = ?,
        external_object_url = COALESCE(?, external_object_url)
    WHERE id = ?
      AND (   title               IS NOT ?
           OR description         IS NOT ?
           OR start_datetime      IS NOT ?
           OR end_datetime        IS NOT ?
           OR all_day             IS NOT ?
           OR location            IS NOT ?
           OR recurrence_rule     IS NOT ?
           OR tzid                IS NOT ?
           OR color               IS NOT CASE WHEN color_modified = 0 THEN ? ELSE color END
           OR calendar_ref_id     IS NOT ?
           OR external_object_url IS NOT COALESCE(?, external_object_url)
          )
  `);
  const insEvent = conn.prepare(`
    INSERT INTO calendar_events
      (title, description, start_datetime, end_datetime, all_day,
       location, color, external_calendar_id, external_source, recurrence_rule, tzid, calendar_ref_id, created_by,
       external_object_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'caldav', ?, ?, ?, ?, ?)
  `);
  // EXDATE-Ausnahmen der Serie (#489/#549). Additiv (INSERT OR IGNORE): entfernt
  // keine lokal vom Nutzer ausgenommenen Einzeltermine.
  const insException = conn.prepare(
    'INSERT OR IGNORE INTO calendar_event_exceptions (event_id, exception_date) VALUES (?, ?)'
  );

  const ownerRow = conn.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  const createdBy = ownerRow ? ownerRow.id : 1;

  for (const account of accounts) {
    try {
      log.debug(`Syncing CalDAV account ${account.id} ("${account.name}")...`);

      // Create tsdav client (oder injizierte Test-Factory)
      const client = await makeClient(account);

      // Get enabled calendars for this account
      const enabledCalendars = db.get().prepare(`
        SELECT calendar_url, calendar_name, calendar_color
        FROM caldav_calendar_selection
        WHERE account_id = ? AND enabled = 1
      `).all(account.id);

      if (enabledCalendars.length === 0) {
        log.debug(`Account ${account.id}: no enabled calendars, skipping.`);
        continue;
      }

      // Fetch all calendars from server
      const serverCalendars = await client.fetchCalendars();

      // Inbound sync: CalDAV → Aashiyana
      let accountEventCount = 0;
      let accountChangedCount = 0;
      let processedObjects = 0;



      const fetchedCalendars = [];
      const accountUids = new Set();


      const objectIndex   = new Map();
      const calendarsByUrl = new Map();
      const ownCalendarUrls = new Set();

      for (const selCal of enabledCalendars) {
        // Find matching calendar from server
        const serverCal = serverCalendars.find(sc => sc.url === selCal.calendar_url);

        if (!serverCal) {
          log.warn(`Calendar ${selCal.calendar_url} not found on server, disabling.`);
          db.get().prepare(`
            UPDATE caldav_calendar_selection SET enabled = 0
            WHERE account_id = ? AND calendar_url = ?
          `).run(account.id, selCal.calendar_url);
          continue;
        }








        if (!supportsComponent(serverCal, 'VEVENT')) {
          log.warn(`Calendar ${selCal.calendar_name} does not accept events, disabling.`);
          db.get().prepare(`
            UPDATE caldav_calendar_selection SET enabled = 0
            WHERE account_id = ? AND calendar_url = ?
          `).run(account.id, selCal.calendar_url);
          continue;
        }

        // Fetch calendar objects
        let calObjects;
        try {
          calObjects = await client.fetchCalendarObjects({ calendar: serverCal });
        } catch (err) {
          log.error(`Failed to fetch calendar objects from ${selCal.calendar_name}:`, err.message);
          continue;
        }
        calendarsByUrl.set(selCal.calendar_url, serverCal);
        ownCalendarUrls.add(selCal.calendar_url);

        // Upsert external calendar metadata
        const calRefId = upsertExternalCalendar('caldav', selCal.calendar_url, selCal.calendar_name, selCal.calendar_color);

        const calDefaultAssignee = db.get()
          .prepare('SELECT default_assignee_user_id FROM external_calendars WHERE id = ?')
          .get(calRefId)?.default_assignee_user_id ?? null;

        // Parse and upsert events
        const calendarUids = new Set();
        fetchedCalendars.push({ calRefId, calendarName: selCal.calendar_name, calendarUids });

        for (const obj of calObjects) {




          const parsed = normalizeRecurrenceOverrides(parseICS(obj.data || '', {
            onSkip: ({ uid, reason }) =>
              log.warn(`Skipped VEVENT (${reason}) uid=${uid ?? '(none)'} at ${obj.url ?? '(unknown URL)'}`),
          }));
          if (!parsed.length && !String(obj.data || '').includes('BEGIN:VEVENT')) {
            log.warn(`Calendar object without any VEVENT at ${obj.url ?? '(unknown URL)'}`);
          }

          for (const ev of parsed) {
            try {
              calendarUids.add(ev.uid);
              accountUids.add(ev.uid);


              if (obj.url) {
                objectIndex.set(ev.uid, {
                  url: obj.url, etag: obj.etag, data: obj.data, calendarUrl: selCal.calendar_url,
                });
              }







              const evColor = ev.color ?? null;



              if (pendingDeletionUids.has(ev.uid)) continue;

              const existing = selExistingEvent.get(ev.uid);



              if (existing?.outbound_dirty) {
                accountEventCount++;
                continue;
              }

              let eventId;


              let changed = false;
              if (existing) {




                const values = [
                  ev.summary, ev.description, ev.dtstart, ev.dtend,
                  ev.allDay ? 1 : 0, ev.location, ev.rrule, ev.tzid ?? null, evColor, calRefId,
                  obj.url ?? null,
                ];
                changed = updEvent.run(...values, existing.id, ...values).changes > 0;
                eventId = existing.id;
              } else {
                // Insert
                const inserted = insEvent.run(
                  ev.summary, ev.description, ev.dtstart, ev.dtend,
                  ev.allDay ? 1 : 0, ev.location, evColor, ev.uid, ev.rrule, ev.tzid ?? null, calRefId, createdBy,
                  obj.url ?? null
                );
                eventId = Number(inserted.lastInsertRowid);
                changed = true;

                assignDefaultToEvent(db.get(), eventId, calDefaultAssignee);
              }

              // EXDATE + ersetzte Override-Termine als Instanz-Ausnahmen ablegen,



              if (ev.rrule && Array.isArray(ev.exdates)) {
                for (const exDate of ev.exdates) {
                  if (insException.run(eventId, exDate).changes > 0) changed = true;
                }
              }

              accountEventCount++;
              if (changed) accountChangedCount++;
            } catch (err) {
              log.error(`Failed to upsert event UID ${ev.uid}:`, err.message);
            }
          }



          if (++processedObjects % YIELD_EVERY === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        }
      }



      let deletedCount = 0;
      for (const { calRefId, calendarName, calendarUids } of fetchedCalendars) {
        try {
          const removed = pruneDeletedEvents(db.get(), {
            calRefId, calendarUids, accountUids, source: 'caldav', calendarName,
          });
          if (removed > 0) {
            log.info(`Calendar "${calendarName}": removed ${removed} event(s) deleted on the server.`);
            deletedCount += removed;
          }
        } catch (err) {
          log.error(`Failed to prune deleted events for calendar "${calendarName}":`, err.message);
        }
      }




      try {
        const removed = await processPendingDeletions(client, 'caldav', objectIndex, ownCalendarUrls);
        if (removed) log.info(`${removed} pending deletion(s) applied on the server.`);
        const pushed = await processPendingUpdates(client, 'caldav', objectIndex, calendarsByUrl);
        if (pushed) log.info(`${pushed} local change(s) pushed to the server.`);
      } catch (err) {
        log.error(`Outbound changes failed for account ${account.id}:`, err.message);
      }

      // Outbound sync: Aashiyana → CalDAV (events with target_caldav_account_id)
      const localEvents = db.get().prepare(`
        SELECT * FROM calendar_events
        WHERE external_source = 'local' AND target_caldav_account_id = ?
      `).all(account.id);


      const householdZone = householdTimeZone(db.get());

      for (const event of localEvents) {
        try {
          // Find target calendar
          const targetCal = serverCalendars.find(sc => sc.url === event.target_caldav_calendar_url);

          if (!targetCal) {
            log.warn(`Target calendar ${event.target_caldav_calendar_url} not found, skipping event ${event.id}.`);
            continue;
          }

          const uid     = `oikos-${event.id}@oikos.local`;
          const icsData = buildCalDAVICS(event, householdZone);

          // Upload to CalDAV
          await client.createCalendarObject({
            calendar: targetCal,
            filename: `${uid}.ics`,
            iCalString: icsData,
          });




          const objectUrl = `${String(targetCal.url).replace(/\/?$/, '/')}${uid}.ics`;
          const calRefId  = upsertExternalCalendar(
            'caldav', event.target_caldav_calendar_url,
            targetCal.displayName || event.target_caldav_calendar_url, null
          );







          db.get().prepare(`
            UPDATE calendar_events
            SET external_source = 'caldav', external_calendar_id = ?,
                external_object_url = ?, calendar_ref_id = ?,
                color_modified = CASE WHEN color IS NOT NULL THEN 1 ELSE color_modified END
            WHERE id = ?
          `).run(uid, objectUrl, calRefId, event.id);

          accountEventCount++;
          accountChangedCount++;
        } catch (err) {
          log.error(`Failed to upload event ${event.id} to CalDAV:`, err.message);
        }
      }

      // Update last_sync for account
      db.get().prepare(`
        UPDATE caldav_accounts SET last_sync = ? WHERE id = ?
      `).run(new Date().toISOString(), account.id);


      accountChangedCount += deletedCount;

      totalSyncedEvents  += accountEventCount;
      totalChangedEvents += accountChangedCount;
      successfulAccounts++;

      log.debug(
        `Account ${account.id} sync complete: ${accountEventCount} events seen, ` +
        `${accountChangedCount} changed` +
        `${deletedCount > 0 ? ` (${deletedCount} deleted)` : ''}.`
      );

    } catch (err) {
      log.error(`Sync failed for account ${account.id}:`, err.message);
      // Continue with next account (don't abort entire sync)
    }
  }





  const summary = `CalDAV sync complete: ${successfulAccounts}/${accounts.length} accounts, `
    + `${totalSyncedEvents} events seen, ${totalChangedEvents} changed.`;
  if (totalChangedEvents > 0) log.info(summary);
  else log.debug(summary);

  return { success: true, syncedAccounts: successfulAccounts, syncedEvents: totalSyncedEvents };
}

async function flushOutbound(opts = {}) {
  return runSerialized('caldav', 'flush', () => runFlushOutbound(opts));
}

async function runFlushOutbound({ createClient } = {}) {
  const idle = { deleted: 0, updated: 0 };
  const deletions = outbound.pendingDeletions('caldav');
  const updates   = outbound.pendingUpdates('caldav');
  if (!deletions.length && !updates.length) return idle;

  const conn = db.get();
  const accountForCalendar = conn.prepare(
    'SELECT account_id FROM caldav_calendar_selection WHERE calendar_url = ? LIMIT 1'
  );
  const calendarForRef = conn.prepare(
    `SELECT external_id FROM external_calendars WHERE id = ? AND source = 'caldav'`
  );


  const buckets = new Map();
  const bucket = (accountId) => {
    if (!buckets.has(accountId)) buckets.set(accountId, { deletions: [], updates: [], needsCalendars: false });
    return buckets.get(accountId);
  };

  for (const row of deletions) {
    if (!row.object_url) continue;
    const accountId = accountForCalendar.get(row.calendar_external_id)?.account_id;
    if (accountId) bucket(accountId).deletions.push(row);
  }

  for (const event of updates) {
    const calendarUrl = (event.calendar_ref_id ? calendarForRef.get(event.calendar_ref_id)?.external_id : null)
      || event.target_caldav_calendar_url || null;
    if (!calendarUrl || !event.external_object_url) continue;
    const accountId = accountForCalendar.get(calendarUrl)?.account_id;
    if (!accountId) continue;
    const b = bucket(accountId);
    b.updates.push({ ...event, __calendarUrl: calendarUrl });
    if (event.outbound_move_to) b.needsCalendars = true;
  }

  if (buckets.size === 0) return idle;

  const makeClient = createClient || defaultClientFactory;
  const total = { deleted: 0, updated: 0 };
  for (const [accountId, work] of buckets) {
    const account = getAccountById(accountId);
    if (!account) continue;
    try {
      const client = await makeClient(account);
      const res = await flushAccount(client, 'caldav', work);
      total.deleted += res.deleted;
      total.updated += res.updated;
    } catch (err) {

      log.warn(`Immediate outbound attempt failed for account ${accountId}: ${err.message}`);
    }
  }
  return total;
}

function getStatus() {
  const accounts = getAllAccounts();

  const accountStatus = accounts.map(acc => {
    const calendarCount = db.get().prepare(
      'SELECT COUNT(*) as count FROM caldav_calendar_selection WHERE account_id = ? AND enabled = 1'
    ).get(acc.id).count;

    return {
      id: acc.id,
      name: acc.name,
      caldavUrl: acc.caldav_url,
      username: acc.username,
      lastSync: acc.last_sync,
      enabledCalendars: calendarCount,
    };
  });

  const totalCalendars = db.get().prepare(
    'SELECT COUNT(*) as count FROM caldav_calendar_selection WHERE enabled = 1'
  ).get().count;

  return {
    accounts: accountStatus,
    totalAccounts: accounts.length,
    totalEnabledCalendars: totalCalendars,
  };
}

// --------------------------------------------------------
// Exports
// --------------------------------------------------------

export {
  addAccount,
  listAccounts,
  updateAccount,
  deleteAccount,
  getCalendars,
  updateCalendarSelection,
  countAccountEvents,
  sync,
  flushOutbound,
  getStatus
};



// dafuer nachzustellen.
export const __test = { buildCalDAVICS };
