
import { createLogger } from '../logger.js';
const log = createLogger('Apple');

import * as db from '../db.js';
import { assignDefaultToEvent } from './sync-assignment.js';
import { pruneDeletedEvents, countSourceEvents, deleteSourceEvents } from './calendar-prune.js';
import { readSyncOutcome, withSyncOutcome } from './sync-outcome.js';
import { runSerialized } from '../utils/sync-lock.js';
import { unfoldLines, parseICS, formatICSDate, tzLocalToUTC, applyDuration, normalizeRecurrenceOverrides } from './ics-parser.js';
import { decodeHtmlEntities } from '../utils/html-entities.js';
import * as outbound from './calendar-outbound.js';
import { processPendingDeletions, processPendingUpdates, flushAccount } from './caldav-outbound.js';
import { rruleLine } from './recurrence.js';
import { eventDateTimeFields } from '../utils/ics-datetime.js';
import { vtimezoneFor } from '../utils/vtimezone.js';
import { householdTimeZone } from '../utils/timezone.js';
import { createCalDAVClient } from '../utils/caldav-client.js';
import { nearestIcalColorName } from '../utils/ical-color.js';
import { outboundEvent } from './outbound-dtstart.js';

const APPLE_COLOR = '#FC3C44';

function collectLocalOutboundEvents(database) {
  return database.prepare(`
    SELECT e.* FROM calendar_events e
    WHERE e.external_source = 'local' AND e.external_calendar_id IS NULL
      AND e.recurrence_parent_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM calendar_events child
        WHERE child.recurrence_parent_id = e.id
      )
  `).all();
}

// --------------------------------------------------------
// Externe Kalender-Metadaten upserten
// --------------------------------------------------------

function normalizeCalColor(c) {
  if (!c) return null;
  if (/^#[0-9a-fA-F]{8}$/.test(c)) return c.slice(0, 7); // strip alpha
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return null;
}

function upsertExternalCalendar(source, externalId, name, color) {

  // sonst escaped die UI doppelt (z. B. literales "&amp;").
  const row = db.get().prepare(`
    INSERT INTO external_calendars (source, external_id, name, color)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source, external_id) DO UPDATE SET
      name  = excluded.name,
      color = excluded.color
    RETURNING id
  `).get(source, externalId, decodeHtmlEntities(name), color);
  return row.id;
}

// --------------------------------------------------------
// sync_config Helfer
// --------------------------------------------------------

function cfgGet(key) {
  const row = db.get().prepare('SELECT value FROM sync_config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function cfgSet(key, value) {
  db.get().prepare(`
    INSERT INTO sync_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                   updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  `).run(key, value);
}

function cfgDel(key) {
  db.get().prepare('DELETE FROM sync_config WHERE key = ?').run(key);
}

// --------------------------------------------------------

// --------------------------------------------------------

function getCredentials() {
  const url      = cfgGet('apple_caldav_url')      || process.env.APPLE_CALDAV_URL;
  const username = cfgGet('apple_username')         || process.env.APPLE_USERNAME;
  const password = cfgGet('apple_app_password')     || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  if (!url || !username || !password) return null;
  return { url, username, password };
}

function saveCredentials(url, username, password) {

  if (!process.env.DB_ENCRYPTION_KEY) {
    log.warn('WARNING: DB_ENCRYPTION_KEY is not set - CalDAV credentials will be stored unencrypted.');
  }
  cfgSet('apple_caldav_url',  url);
  cfgSet('apple_username',    username);
  cfgSet('apple_app_password', password);
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.deleteEvents] Gespiegelte Termine mitnehmen (#820).
 * @returns {{ removed: number }}
 */
function clearCredentials({ deleteEvents = false } = {}) {

  // stehen bleibt (oder umgekehrt).
  return db.get().transaction(() => {
    const removed = deleteEvents ? clearMirroredEvents() : 0;
    ['apple_caldav_url', 'apple_username', 'apple_app_password', 'apple_last_sync',

     'apple_last_error', 'apple_last_error_at'].forEach(cfgDel);
    log.info('Disconnected.' + (removed ? ` ${removed} mirrored event(s) removed.` : ''));
    return { removed };
  })();
}

function clearMirroredEvents() {
  return deleteSourceEvents(db.get(), 'apple');
}

// --------------------------------------------------------
// Verbindungsstatus
// --------------------------------------------------------

function getStatus() {
  const creds     = getCredentials();
  const configured = !!creds;
  const connected  = !!(cfgGet('apple_caldav_url')); // via UI gespeichert
  const lastSync   = cfgGet('apple_last_sync');



  const mirroredEvents = countSourceEvents(db.get(), 'apple');


  return { configured, connected, lastSync, mirroredEvents, ...readSyncOutcome(db.get(), 'apple') };
}

async function testConnection() {
  const creds = getCredentials();
  if (!creds) throw new Error('[Apple] No credentials configured.');

  const client = await createClient(creds);

  const calendars = await client.fetchCalendars();
  if (!calendars.length) throw new Error('[Apple] Connected, but no calendars found.');
  return { ok: true, calendarCount: calendars.length };
}

// --------------------------------------------------------
// Minimaler ICS-Builder
// --------------------------------------------------------

function buildICS(event, householdZone = null) {
  // UID-Format bewusst auf `oikos-…@oikos.local` belassen (kein Rebrand):


  // bzw. verwaiste Remote-Objekte erzeugen.
  const uid   = `oikos-${event.id}@oikos.local`;
  const now   = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');




  // importiertes DTSTART bleibt unberuehrt (#756).
  const when = eventDateTimeFields(outboundEvent(event), householdZone);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aashiyana//Familienplaner//DE',
  ];

  if (when.tzid) lines.push(...vtimezoneFor(when.tzid, Number(String(event.start_datetime).slice(0, 4))));
  lines.push(
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeICS(event.title)}`,
    `DTSTART${when.dtstart.params}:${when.dtstart.value}`,
    `DTEND${when.dtend.params}:${when.dtend.value}`,
  );

  if (event.description) lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  if (event.location)    lines.push(`LOCATION:${escapeICS(event.location)}`);


  const colorName = nearestIcalColorName(event.color);
  if (colorName) lines.push(`COLOR:${colorName}`);




  // Serie liest. patchICSEvent normalisiert an seiner Stelle genauso.
  if (event.recurrence_rule) {
    lines.push(rruleLine(event.recurrence_rule));
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function escapeICS(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function unescapeICS(str) {
  if (!str) return str;
  return str
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\,/g,  ',')
    .replace(/\\;/g,  ';')
    .replace(/\\\\/g, '\\');
}

// --------------------------------------------------------
// Sync
// --------------------------------------------------------

/**
 * Bidirektionaler CalDAV-Sync mit iCloud.
 * Inbound:  iCloud → lokale DB (Upsert via external_calendar_id = UID)
 * Outbound: lokale Termine (external_source='local', external_calendar_id IS NULL) → iCloud
 */
async function createClient(creds) {
  return createCalDAVClient({ caldav_url: creds.url, username: creds.username, password: creds.password });
}

async function flushOutbound(opts = {}) {
  return runSerialized('apple', 'flush', () => runFlushOutbound(opts));
}

async function runFlushOutbound({ makeClient } = {}) {
  const idle = { deleted: 0, updated: 0 };
  const deletions = outbound.pendingDeletions('apple').filter((r) => r.object_url);
  const updates   = outbound.pendingUpdates('apple').filter((e) => e.external_object_url);
  if (!deletions.length && !updates.length) return idle;

  const creds = getCredentials();
  if (!creds) return idle;

  const calendarForRef = db.get().prepare(
    `SELECT external_id FROM external_calendars WHERE id = ? AND source = 'apple'`
  );
  const withCalendar = updates
    .map((e) => ({ ...e, __calendarUrl: e.calendar_ref_id ? calendarForRef.get(e.calendar_ref_id)?.external_id : null }))
    .filter((e) => e.__calendarUrl);

  try {
    const client = await (makeClient || createClient)(creds);

    return await flushAccount(client, 'apple', {
      deletions, updates: withCalendar, needsCalendars: false,
    });
  } catch (err) {
    log.warn(`Immediate outbound attempt failed: ${err.message}`);
    return idle;
  }
}

async function sync() {
  return runSerialized('apple', 'sync', () => withSyncOutcome(db.get(), 'apple', runSync));
}

async function runSync() {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('[Apple] No credentials configured (neither in DB nor in .env).');
  }

  const client = await createClient(creds);

  const calendars = await client.fetchCalendars();
  if (!calendars.length) {
    log.warn('No calendars found.');
    return;
  }

  // created_by: ersten existierenden User verwenden (nicht hardcoded ID 1)
  const owner = db.get().prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (!owner) {
    log.warn('No user in database - sync skipped.');
    return;
  }
  const createdBy = owner.id;

  // Alle Kalender synchen (inklusive Geburtstags-Kalender)
  const syncCalendars = calendars;

  let totalObjects = 0;



  const fetchedCalendars = [];
  const accountUids = new Set();


  const objectIndex     = new Map();
  const calendarsByUrl  = new Map();
  const ownCalendarUrls = new Set();

  const pendingDeletionUids = outbound.pendingDeletionUids('apple');

  for (const cal of syncCalendars) {
    let calObjects;
    try {
      calObjects = await client.fetchCalendarObjects({ calendar: cal });
    } catch (err) {
      log.warn(`Calendar "${cal.displayName || '(unnamed)'}" is not accessible: ${err.message}`);
      continue;
    }

    totalObjects += calObjects.length;

    // Kalender-Metadaten in external_calendars upserten
    const calColor = normalizeCalColor(cal.calendarColor) || APPLE_COLOR;
    const calName  = cal.displayName || 'Apple Calendar';
    const calRefId = upsertExternalCalendar('apple', cal.url, calName, calColor);

    const calDefaultAssignee = db.get()
      .prepare('SELECT default_assignee_user_id FROM external_calendars WHERE id = ?')
      .get(calRefId)?.default_assignee_user_id ?? null;

    // --------------------------------------------------------
    // Inbound: iCloud → lokal
    // --------------------------------------------------------
    const calendarUids = new Set();
    fetchedCalendars.push({ calRefId, calendarName: calName, calendarUids });

    calendarsByUrl.set(cal.url, cal);
    ownCalendarUrls.add(cal.url);

    for (const obj of calObjects) {



      const parsed = normalizeRecurrenceOverrides(parseICS(obj.data || '', {
        onSkip: ({ uid, reason }) =>
          log.warn(`Skipped VEVENT (${reason}) uid=${uid ?? '(none)'} at ${obj.url ?? '(unknown URL)'}`),
      }));
      for (const ev of parsed) {
        try {
          calendarUids.add(ev.uid);
          accountUids.add(ev.uid);


          if (obj.url) {
            objectIndex.set(ev.uid, {
              url: obj.url, etag: obj.etag, data: obj.data, calendarUrl: cal.url,
            });
          }



          // Lesepfad holt sie als cal_color ueber calendar_ref_id.
          const evColor = ev.color ?? null;



          if (pendingDeletionUids.has(ev.uid)) continue;

          const existing = db.get().prepare(
            `SELECT id, outbound_dirty FROM calendar_events WHERE external_calendar_id = ? AND external_source = 'apple'`
          ).get(ev.uid);



          if (existing?.outbound_dirty) continue;

          let eventId;
          if (existing) {


            //



            db.get().prepare(`
              UPDATE calendar_events
              SET title = ?, description = ?, start_datetime = ?, end_datetime = ?,
                  all_day = ?, location = ?, recurrence_rule = ?, tzid = ?,
                  color = CASE WHEN color_modified = 0 THEN ? ELSE color END,
                  calendar_ref_id = ?,
                  external_object_url = COALESCE(?, external_object_url)
              WHERE id = ?
            `).run(
              ev.summary, ev.description, ev.dtstart, ev.dtend,
              ev.allDay ? 1 : 0, ev.location, ev.rrule, ev.tzid ?? null, evColor, calRefId,
              obj.url ?? null, existing.id
            );
            eventId = existing.id;
          } else {
            const inserted = db.get().prepare(`
              INSERT INTO calendar_events
                (title, description, start_datetime, end_datetime, all_day,
                 location, color, external_calendar_id, external_source, recurrence_rule, tzid, calendar_ref_id, created_by,
                 external_object_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'apple', ?, ?, ?, ?, ?)
            `).run(
              ev.summary, ev.description, ev.dtstart, ev.dtend,
              ev.allDay ? 1 : 0, ev.location, evColor, ev.uid, ev.rrule, ev.tzid ?? null, calRefId, createdBy,
              obj.url ?? null
            );
            eventId = Number(inserted.lastInsertRowid);

            assignDefaultToEvent(db.get(), eventId, calDefaultAssignee);
          }

          // EXDATE + ersetzte Override-Termine als Instanz-Ausnahmen ablegen,

          if (ev.rrule && Array.isArray(ev.exdates) && ev.exdates.length) {
            const insEx = db.get().prepare(
              'INSERT OR IGNORE INTO calendar_event_exceptions (event_id, exception_date) VALUES (?, ?)'
            );
            for (const exDate of ev.exdates) insEx.run(eventId, exDate);
          }
        } catch (err) {
          log.error(`Upsert error for UID ${ev.uid}:`, err.message);
        }
      }
    }
  }

  // --------------------------------------------------------



  // --------------------------------------------------------
  let deletedCount = 0;
  for (const { calRefId, calendarName, calendarUids } of fetchedCalendars) {
    try {
      const removed = pruneDeletedEvents(db.get(), {
        calRefId, calendarUids, accountUids, source: 'apple', calendarName,
      });
      if (removed > 0) {
        log.info(`Calendar "${calendarName}": removed ${removed} event(s) deleted on the server.`);
        deletedCount += removed;
      }
    } catch (err) {
      log.error(`Failed to prune deleted events for calendar "${calendarName}":`, err.message);
    }
  }

  // --------------------------------------------------------



  // --------------------------------------------------------
  try {
    const removed = await processPendingDeletions(client, 'apple', objectIndex, ownCalendarUrls);
    if (removed) log.info(`${removed} pending deletion(s) applied in iCloud.`);
    const pushed = await processPendingUpdates(client, 'apple', objectIndex, calendarsByUrl);
    if (pushed) log.info(`${pushed} local change(s) pushed to iCloud.`);
  } catch (err) {
    log.error('Outbound changes failed:', err.message);
  }

  // --------------------------------------------------------

  // --------------------------------------------------------
  const defaultCal = syncCalendars[0];
  const localEvents = collectLocalOutboundEvents(db.get());


  const householdZone = householdTimeZone(db.get());

  for (const event of localEvents) {
    try {
      const icsData  = buildICS(event, householdZone);
      const uid      = `oikos-${event.id}@oikos.local`;
      const filename = `${uid}.ics`;

      await client.createCalendarObject({
        calendar:     defaultCal,
        filename,
        iCalString:   icsData,
      });




      const objectUrl = `${String(defaultCal.url).replace(/\/?$/, '/')}${filename}`;
      const calRefId  = upsertExternalCalendar(
        'apple', defaultCal.url, defaultCal.displayName || 'Apple Calendar',
        normalizeCalColor(defaultCal.calendarColor) || APPLE_COLOR
      );




      db.get().prepare(`
        UPDATE calendar_events
        SET external_calendar_id = ?, external_source = 'apple',
            external_object_url = ?, calendar_ref_id = ?,
            color_modified = CASE WHEN color IS NOT NULL THEN 1 ELSE color_modified END
        WHERE id = ?
      `).run(uid, objectUrl, calRefId, event.id);
    } catch (err) {
      log.error(`Outbound error for event ${event.id}:`, err.message);
    }
  }

  cfgSet('apple_last_sync', new Date().toISOString());
  log.info(
    `Sync completed - ${totalObjects} objects from ${syncCalendars.length} calendars inbound` +
    `${deletedCount > 0 ? `, ${deletedCount} deleted` : ''}, ${localEvents.length} local → iCloud.`
  );
}

export { sync, flushOutbound, getStatus, saveCredentials, clearCredentials,
         clearMirroredEvents, testConnection };



// dafuer nachzustellen.
export const __test = { buildICS, collectLocalOutboundEvents };
