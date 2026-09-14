
import { createLogger } from '../logger.js';
const log = createLogger('Google');

import { google } from 'googleapis';
import crypto from 'node:crypto';
import * as db from '../db.js';
import * as outbound from './calendar-outbound.js';
import { decodeHtmlEntities } from '../utils/html-entities.js';
import { nearestColorId } from '../utils/ical-color.js';

import { householdTimeZone } from '../utils/timezone.js';
import { outboundEvent } from './outbound-dtstart.js';
import { assignDefaultToEvent } from './sync-assignment.js';
import { countSourceEvents, deleteSourceEvents } from './calendar-prune.js';
import { readSyncOutcome, withSyncOutcome } from './sync-outcome.js';
import { rruleValue } from './recurrence.js';
import { runSerialized } from '../utils/sync-lock.js';

const GOOGLE_COLOR = '#4285F4';

function upsertExternalCalendar(source, externalId, name, color) {


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
// OAuth2-Client (lazy initialisiert)
// --------------------------------------------------------

function createClient() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('[Google] GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must be set.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
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

function isReadonly() {
  return cfgGet('google_readonly') === '1';
}

function setReadonly(enabled) {
  if (enabled) {
    cfgSet('google_readonly', '1');
  } else {
    cfgDel('google_readonly');
  }
}

function isWritableRole(role) {
  return role === 'owner' || role === 'writer';
}

function isConnected() {
  return !!cfgGet('google_refresh_token');
}

// --------------------------------------------------------



// --------------------------------------------------------

async function loadCalendarMeta(calendar, calendarId, cache) {
  if (cache.has(calendarId)) return cache.get(calendarId);
  let info = null;
  try {
    const meta  = await calendar.calendarList.get({ calendarId });
    const color = meta.data.backgroundColor || GOOGLE_COLOR;
    const name  = meta.data.summaryOverride || meta.data.summary || 'Google Calendar';
    info = {
      role:     meta.data.accessRole ?? null,
      timeZone: meta.data.timeZone || null,
      name,
      color,
      refId:    upsertExternalCalendar('google', calendarId, name, color),
    };
  } catch (err) {
    log.warn(`Calendar metadata is not accessible (${calendarId}):`, err.message);
  }
  cache.set(calendarId, info);
  return info;
}

function currentGoogleCalendarId(event) {
  if (!event.calendar_ref_id) return null;
  const row = db.get().prepare(
    `SELECT external_id FROM external_calendars WHERE id = ? AND source = 'google'`
  ).get(event.calendar_ref_id);
  return row?.external_id || null;
}

function googleCalendarIdForEvent(event) {
  return currentGoogleCalendarId(event) || event.target_google_calendar_id || null;
}

/** Anzahl offener Google-Tombstones. */
function pendingDeletionCount() {
  return outbound.pendingDeletionCount('google');
}

async function processPendingDeletions(calendar) {
  const rows = outbound.pendingDeletions('google');
  if (rows.length === 0) return 0;

  let done = 0;
  for (const row of rows) {
    try {
      await calendar.events.delete({
        calendarId: row.calendar_external_id,
        eventId:    row.event_external_id,
      });
      outbound.dropDeletion(row.id);
      done++;
    } catch (err) {


      if (outbound.handleDeletionError(err, row, 'Google')
          && outbound.classifyOutboundError(err) === 'settled') {
        done++;
      }
    }
  }
  return done;
}

function pendingUpdateCount() {
  return outbound.pendingUpdateCount('google');
}

/**
 * Schiebt lokal bearbeitete, bereits gespiegelte Events zu Google.
 * @param {import('googleapis').calendar_v3.Calendar} calendar
 * @param {Record<string,string>} colorMap
 * @param {Map} metaCache
 * @returns {Promise<number>} erfolgreich gepushte Events
 */
async function processPendingUpdates(calendar, colorMap = {}, metaCache = new Map()) {
  const events = outbound.pendingUpdates('google');
  if (events.length === 0) return 0;

  const clear     = outbound.clearOutbound;
  const clearMove = outbound.clearOutboundMove;







  const applyMove = db.get().prepare(`
    UPDATE calendar_events
    SET calendar_ref_id = ?, external_calendar_id = ?,
        outbound_move_to = CASE WHEN outbound_move_to = ? THEN NULL ELSE outbound_move_to END
    WHERE id = ?
  `);

  const handleError = (err, event, what, giveUp) =>
    outbound.handleUpdateError(err, event, what, 'Google', giveUp);

  let done = 0;
  for (const event of events) {
    let calendarId = googleCalendarIdForEvent(event);
    let eventId    = event.external_calendar_id;
    if (!calendarId) {
      log.warn(`No Google calendar known for event ${event.id}, outbound work skipped.`);
      clear(event.id);
      continue;
    }

    const meta = await loadCalendarMeta(calendar, calendarId, metaCache);
    if (!isWritableRole(meta?.role ?? null)) {
      log.warn(`Calendar ${calendarId} has no writable role (role=${meta?.role ?? null}), skipping outbound work for event ${event.id}.`);
      clear(event.id);
      continue;
    }

    let activeMeta = meta;

    let movedTo = null;


    const moveTo = event.outbound_move_to;
    if (moveTo && moveTo !== calendarId) {
      const destMeta = await loadCalendarMeta(calendar, moveTo, metaCache);
      if (!isWritableRole(destMeta?.role ?? null)) {


        log.warn(`Destination calendar ${moveTo} has no writable role (role=${destMeta?.role ?? null}), keeping event ${event.id} in ${calendarId}.`);
        clearMove(event.id);
      } else {
        try {
          const moved = await calendar.events.move({
            calendarId,
            eventId:     event.external_calendar_id,
            destination: moveTo,
          });
          eventId    = moved?.data?.id || event.external_calendar_id;
          calendarId = moveTo;
          activeMeta = destMeta;
          applyMove.run(destMeta.refId, eventId, moveTo, event.id);
          movedTo = moveTo;
        } catch (err) {



          // Lauf bestehen.
          handleError(err, event, 'move', clearMove);
          continue;
        }
      }
    } else if (moveTo) {
      // Ziel == aktueller Kalender: nichts zu tun (z. B. Umzug bereits erfolgt).
      clearMove(event.id);
    }







    const fresh = outbound.reloadEvent(event.id);
    if (!fresh) continue;



    if (!fresh.outbound_dirty) {
      if (movedTo) {
        outbound.settleOutbound(fresh, movedTo, event);
        done++;
      }
      continue;
    }

    try {
      const gEvent = localEventToGoogle(fresh, colorMap, activeMeta?.timeZone || householdTimeZone(db.get()));
      await calendar.events.patch({ calendarId, eventId, requestBody: gEvent });

      outbound.settleOutbound(fresh, movedTo, event);
      done++;
    } catch (err) {


      handleError(err, fresh, 'update', clear);
    }
  }
  return done;
}

async function flushOutbound() {
  return runSerialized('google', 'flush', runFlushOutbound);
}

async function runFlushOutbound() {
  const idle = { deleted: 0, updated: 0 };
  if (!isConnected() || isReadonly()) return idle;

  const hasDeletions = pendingDeletionCount() > 0;
  const hasUpdates   = pendingUpdateCount() > 0;
  if (!hasDeletions && !hasUpdates) return idle;

  const calendar = google.calendar({ version: 'v3', auth: loadAuthorizedClient() });
  const deleted = hasDeletions ? await processPendingDeletions(calendar) : 0;
  const updated = hasUpdates
    ? await processPendingUpdates(calendar, await fetchEventColorMap(calendar), new Map())
    : 0;
  return { deleted, updated };
}

// --------------------------------------------------------
// Kalenderauswahl (Mehrkalender, Issue #237)
// --------------------------------------------------------

/** Alle bekannten Kalenderauswahl-Zeilen. */
function listSelection() {
  return db.get().prepare(
    'SELECT calendar_id, name, color, enabled, sync_token, last_sync FROM google_calendar_selection'
  ).all();
}

/** IDs der aktuell aktivierten Kalender. */
function enabledCalendarIds() {
  return db.get().prepare(
    'SELECT calendar_id FROM google_calendar_selection WHERE enabled = 1'
  ).all().map((r) => r.calendar_id);
}

function setCalendarEnabled(calendarId, enabled, meta = {}) {
  if (typeof calendarId !== 'string' || calendarId.trim().length === 0) {
    throw new Error('[Google] calendarId fehlt oder ist ungültig.');
  }
  const id = calendarId.trim();
  const flag = enabled ? 1 : 0;

  db.get().prepare(`
    INSERT INTO google_calendar_selection (calendar_id, name, color, enabled)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(calendar_id) DO UPDATE SET
      enabled = excluded.enabled,
      name    = COALESCE(excluded.name, google_calendar_selection.name),
      color   = COALESCE(excluded.color, google_calendar_selection.color)
  `).run(id, meta.name || id, meta.color || null, flag);

  if (!enabled) {
    db.get().prepare(`
      DELETE FROM calendar_events
      WHERE external_source = 'google' AND calendar_ref_id IN (
        SELECT id FROM external_calendars WHERE source = 'google' AND external_id = ?
      )
    `).run(id);
    db.get().prepare(
      'UPDATE google_calendar_selection SET sync_token = NULL, last_sync = NULL WHERE calendar_id = ?'
    ).run(id);
  }
}

/** Per-Kalender-Sync-Token + last_sync nach erfolgreichem Inbound speichern. */
function recordSyncToken(calendarId, token) {
  db.get().prepare(`
    UPDATE google_calendar_selection
    SET sync_token = ?, last_sync = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE calendar_id = ?
  `).run(token, calendarId);
}

function getSyncToken(calendarId) {
  const row = db.get().prepare(
    'SELECT sync_token FROM google_calendar_selection WHERE calendar_id = ?'
  ).get(calendarId);
  return row ? row.sync_token : null;
}

async function listCalendars() {
  const client   = loadAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth: client });
  const enabledSet = new Set(enabledCalendarIds());

  const assigneeMap = new Map(
    db.get().prepare(`SELECT external_id, default_assignee_user_id FROM external_calendars WHERE source = 'google'`)
      .all().map((r) => [r.external_id, r.default_assignee_user_id])
  );

  const items = [];
  let pageToken;
  do {
    const res = await calendar.calendarList.list({ pageToken, maxResults: 250 });
    for (const cal of res.data.items || []) {
      items.push({
        id:              cal.id,
        summary:         cal.summaryOverride || cal.summary || cal.id,
        primary:         !!cal.primary,
        backgroundColor: cal.backgroundColor || GOOGLE_COLOR,
        enabled:         enabledSet.has(cal.id),
        accessRole:      cal.accessRole ?? null,
        writable:        isWritableRole(cal.accessRole),
        default_assignee_user_id: assigneeMap.get(cal.id) ?? null,
        synced:          assigneeMap.has(cal.id),
      });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return items;
}

// --------------------------------------------------------
// Client mit gespeicherten Tokens laden
// --------------------------------------------------------

function loadAuthorizedClient() {
  const accessToken  = cfgGet('google_access_token');
  const refreshToken = cfgGet('google_refresh_token');

  if (!accessToken || !refreshToken) {
    throw new Error('[Google] Not configured - complete OAuth first.');
  }

  const client = createClient();
  client.setCredentials({
    access_token:  accessToken,
    refresh_token: refreshToken,
    expiry_date:   cfgGet('google_token_expiry') ? parseInt(cfgGet('google_token_expiry'), 10) : undefined,
  });

  // Token-Refresh automatisch speichern
  client.on('tokens', (tokens) => {
    if (tokens.access_token) cfgSet('google_access_token', tokens.access_token);
    if (tokens.expiry_date)  cfgSet('google_token_expiry', String(tokens.expiry_date));
  });

  return client;
}

// --------------------------------------------------------

// --------------------------------------------------------

function getAuthUrl(session) {
  const client = createClient();
  const state = crypto.randomBytes(32).toString('hex');
  if (session) session.googleOAuthState = state;
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       ['https://www.googleapis.com/auth/calendar'],
    state,
  });
}

async function handleCallback(code) {
  const client = createClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error('[Google] No refresh token received. Revoke access in your Google account and connect again.');
  }

  cfgSet('google_access_token',  tokens.access_token);
  cfgSet('google_refresh_token', tokens.refresh_token);
  if (tokens.expiry_date) cfgSet('google_token_expiry', String(tokens.expiry_date));

  log.info('OAuth successful - tokens saved.');
}

function getStatus() {
  const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
  const connected  = !!(cfgGet('google_access_token') && cfgGet('google_refresh_token'));
  const lastSync   = cfgGet('google_last_sync');
  return {
    configured,
    connected,
    lastSync,
    selectedCount: enabledCalendarIds().length,
    readonly: isReadonly(),



    mirroredEvents: countSourceEvents(db.get(), 'google'),


    ...readSyncOutcome(db.get(), 'google'),
  };
}

function clearMirroredEvents() {
  return deleteSourceEvents(db.get(), 'google');
}

function disconnect({ deleteEvents = false } = {}) {



  return db.get().transaction(() => {
    const removed = deleteEvents ? clearMirroredEvents() : 0;
    ['google_access_token', 'google_refresh_token', 'google_token_expiry',
     'google_last_sync', 'google_readonly',


     'google_last_error', 'google_last_error_at'].forEach(cfgDel);
    db.get().prepare('DELETE FROM google_calendar_selection').run();


    db.get().prepare(`DELETE FROM calendar_pending_deletions WHERE source = 'google'`).run();
    log.info('Disconnected.' + (removed ? ` ${removed} mirrored event(s) removed.` : ''));
    return { removed };
  })();
}

/**
 * Bidirektionaler Sync.
 * Inbound:  Google → lokale DB (Upsert via external_calendar_id)
 * Outbound: lokale Termine (external_source='local', external_calendar_id IS NULL) → Google
 */
async function sync() {
  return runSerialized('google', 'sync', () => withSyncOutcome(db.get(), 'google', runSync));
}

async function runSync() {
  const client   = loadAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth: client });


  const eventColorMap = await fetchEventColorMap(calendar);

  const calendarIds = enabledCalendarIds();

  const metaCache = new Map();

  // --------------------------------------------------------




  // --------------------------------------------------------
  if (!isReadonly()) {
    const removed = await processPendingDeletions(calendar);
    if (removed) log.info(`${removed} pending deletion(s) applied at Google.`);
    const pushed = await processPendingUpdates(calendar, eventColorMap, metaCache);
    if (pushed) log.info(`${pushed} local change(s) pushed to Google.`);
  }

  // --------------------------------------------------------
  // Inbound: jeder aktivierte Kalender mit eigenem syncToken
  // --------------------------------------------------------
  for (const calendarId of calendarIds) {
    const meta     = await loadCalendarMeta(calendar, calendarId, metaCache);
    const calRefId = meta?.refId ?? null;
    const calColor = meta?.color ?? GOOGLE_COLOR;

    let syncToken    = getSyncToken(calendarId);
    let pageToken    = undefined;
    let newSyncToken = null;

    do {





      const listParams = { calendarId, singleEvents: false, showDeleted: true, pageToken };
      if (syncToken) {
        listParams.syncToken = syncToken;
      } else {




        listParams.timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      }

      let response;
      try {
        response = await calendar.events.list(listParams);
      } catch (err) {
        if (err.code === 410) {
          log.warn(`syncToken invalid (${calendarId}) - full resync.`);
          recordSyncToken(calendarId, null);
          syncToken = null;
          continue;
        }
        throw err;
      }

      upsertGoogleEvents(response.data.items || [], calRefId, calColor, eventColorMap,
        { fullResync: !syncToken, calTimeZone: meta?.timeZone ?? null });
      pageToken    = response.data.nextPageToken;
      newSyncToken = response.data.nextSyncToken || newSyncToken;
    } while (pageToken);

    if (newSyncToken) recordSyncToken(calendarId, newSyncToken);
  }

  // --------------------------------------------------------

  // --------------------------------------------------------
  if (isReadonly()) {
    log.debug('Read-only mode – outbound sync skipped.');
  } else {
    const localEvents = db.get().prepare(`
      SELECT * FROM calendar_events
      WHERE external_source = 'local' AND target_google_calendar_id IS NOT NULL
    `).all();

    const activeIds = new Set(calendarIds);
    for (const event of localEvents) {
      const targetId = event.target_google_calendar_id;
      if (!activeIds.has(targetId)) {
        log.warn(`Target calendar ${targetId} not active, skipping event ${event.id}.`);
        continue;
      }

      const meta = await loadCalendarMeta(calendar, targetId, metaCache);
      const role = meta?.role ?? null;
      if (!isWritableRole(role)) {
        log.warn(`Target calendar ${targetId} has no writable role (role=${role}), skipping event ${event.id}.`);
        continue;
      }
      try {
        const gEvent  = localEventToGoogle(event, eventColorMap, meta?.timeZone || householdTimeZone(db.get()));
        const created = await calendar.events.insert({ calendarId: targetId, requestBody: gEvent });

        // rohen ID als Notnamen.
        const calRefId = meta.refId;




        db.get().prepare(`
          UPDATE calendar_events
          SET external_calendar_id = ?, external_source = 'google', calendar_ref_id = ?,
              color_modified = CASE WHEN color IS NOT NULL THEN 1 ELSE color_modified END
          WHERE id = ?
        `).run(created.data.id, calRefId, event.id);
      } catch (err) {
        log.error(`Outbound error for event ${event.id}:`, err.message);
      }
    }

    // Scheduler-Tick des Standard-Logs.
    const outboundSummary = `Sync completed - ${localEvents.length} candidate local → Google.`;
    if (localEvents.length > 0) log.info(outboundSummary);
    else log.debug(outboundSummary);
  }

  cfgSet('google_last_sync', new Date().toISOString());
}

// Google Calendar uses exclusive end dates for all-day events (RFC 5545).
// A 2-day event Jan 1–2 is stored as end.date = "2026-01-03" (exclusive).
// Subtract 1 day to convert to Aashiyana-style inclusive end date.
function googleAllDayEndToInclusive(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Aashiyana stores inclusive end dates. Add 1 day when sending to Google (exclusive).
function localAllDayEndToExclusive(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// --------------------------------------------------------
// Helfer: Event-Farbpalette (colorId → Hex)
// --------------------------------------------------------



let _eventColorCache = null; // { map: Record<string,string>, ts: number }
const EVENT_COLOR_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchEventColorMap(calendar) {
  if (_eventColorCache && (Date.now() - _eventColorCache.ts) < EVENT_COLOR_TTL_MS) {
    return _eventColorCache.map;
  }
  try {
    const res   = await calendar.colors.get();
    const event = res.data?.event || {};
    const map   = {};
    for (const [id, def] of Object.entries(event)) {
      if (def?.background) map[id] = String(def.background).toUpperCase();
    }
    _eventColorCache = { map, ts: Date.now() };
    return map;
  } catch (err) {
    log.warn('Event color palette not available:', err.message);
    return _eventColorCache?.map || {};
  }
}

// --------------------------------------------------------
// Helfer: Google-Event in lokale DB upserten
// --------------------------------------------------------

function recurrenceRuleOf(item) {
  if (!Array.isArray(item.recurrence)) return null;
  return item.recurrence.find((line) => /^RRULE[:;]/i.test(line)) || null;
}

function exdatesOf(item) {
  if (!Array.isArray(item.recurrence)) return [];
  const dates = [];
  for (const line of item.recurrence) {
    if (!/^EXDATE[:;]/i.test(line)) continue;
    const values = line.slice(line.indexOf(':') + 1).split(',');
    for (const value of values) {
      const digits = value.trim().replace(/[^0-9]/g, '');
      if (digits.length >= 8) {
        dates.push(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`);
      }
    }
  }
  return dates;
}

function originalStartDate(item) {
  const raw = item.originalStartTime?.dateTime || item.originalStartTime?.date || null;
  return raw ? String(raw).slice(0, 10) : null;
}

function upsertGoogleEvents(items, calRefId = null, calColor = GOOGLE_COLOR, colorMap = {}, { fullResync = false, calTimeZone = null } = {}) {








  const del = db.get().prepare(`
    DELETE FROM calendar_events
    WHERE external_calendar_id = ? AND external_source = 'google'
      AND (? IS NULL OR calendar_ref_id IS NULL OR calendar_ref_id = ?)
  `);


  const defaultAssignee = calRefId
    ? db.get().prepare('SELECT default_assignee_user_id FROM external_calendars WHERE id = ?')
        .get(calRefId)?.default_assignee_user_id ?? null
    : null;




  const pendingDeletion = db.get().prepare(
    `SELECT 1 FROM calendar_pending_deletions WHERE source = 'google' AND event_external_id = ?`
  );

  const dropRow = db.get().prepare('DELETE FROM calendar_events WHERE id = ?');


  const insException = db.get().prepare(
    'INSERT OR IGNORE INTO calendar_event_exceptions (event_id, exception_date) VALUES (?, ?)'
  );
  const findLocal = db.get().prepare(
    `SELECT id, start_datetime FROM calendar_events WHERE external_calendar_id = ? AND external_source = 'google'`
  );







  const ownerRow  = db.get().prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  const createdBy = ownerRow ? ownerRow.id : null;
  if (createdBy === null) log.warn('No user in database - new events are not imported.');

  const insertOrUpdate = db.get().transaction((item) => {


    if (item.status === 'cancelled') {


      if (item.recurringEventId) {
        const master = findLocal.get(item.recurringEventId);
        const date   = originalStartDate(item);
        if (master && date) insException.run(master.id, date);
      }
      del.run(item.id, calRefId, calRefId);
      return;
    }


    if (pendingDeletion.get(item.id)) {
      del.run(item.id, null, null);
      return;
    }




    if (item.recurringEventId) {
      const master = findLocal.get(item.recurringEventId);
      const date   = originalStartDate(item);
      if (master && date) insException.run(master.id, date);
    }

    const allDay      = !!(item.start?.date && !item.start?.dateTime);
    const startDt     = allDay ? item.start.date : (item.start?.dateTime || item.start?.date);
    const endDt       = allDay
      ? googleAllDayEndToInclusive(item.end?.date)
      : (item.end?.dateTime || item.end?.date || null);




    // hier nie nachgezogen. Ganztags-Termine tragen keine Zone.
    const tzid        = allDay ? null : (item.start?.timeZone || calTimeZone || null);
    const title       = item.summary || '(kein Titel)';
    const description = item.description || null;
    const location    = item.location    || null;



    const rrule       = recurrenceRuleOf(item);







    //



    const evColor = (item.colorId && colorMap[item.colorId]) || null;

    const existing = db.get().prepare(
      'SELECT id, outbound_dirty FROM calendar_events WHERE external_calendar_id = ? AND external_source = ?'
    ).get(item.id, 'google');





    if (existing?.outbound_dirty) return;

    if (existing) {




      //






      // geschrieben. `IS NOT` statt `<>`, weil der Vergleich NULL-sicher sein



      const values = [
        title, description, startDt, endDt, allDay ? 1 : 0, location, rrule, tzid, evColor, calRefId,
      ];
      db.get().prepare(`
        UPDATE calendar_events
        SET title = ?, description = ?, start_datetime = ?, end_datetime = ?,
            all_day = ?, location = ?, recurrence_rule = ?, tzid = ?,
            color = CASE WHEN color_modified = 0 THEN ? ELSE color END,
            calendar_ref_id = ?
        WHERE id = ?
          AND (   title           IS NOT ?
               OR description     IS NOT ?
               OR start_datetime  IS NOT ?
               OR end_datetime    IS NOT ?
               OR all_day         IS NOT ?
               OR location        IS NOT ?
               OR recurrence_rule IS NOT ?
               OR tzid            IS NOT ?
               OR color           IS NOT CASE WHEN color_modified = 0 THEN ? ELSE color END
               OR calendar_ref_id IS NOT ?
              )
      `).run(...values, existing.id, ...values);
    } else {



      if (createdBy === null) return;
      const inserted = db.get().prepare(`
        INSERT INTO calendar_events
          (title, description, start_datetime, end_datetime, all_day,
           location, color, external_calendar_id, external_source, recurrence_rule, tzid, calendar_ref_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google', ?, ?, ?, ?)
      `).run(title, description, startDt, endDt, allDay ? 1 : 0, location, evColor, item.id, rrule, tzid, calRefId, createdBy);
      assignDefaultToEvent(db.get(), inserted.lastInsertRowid, defaultAssignee);
    }


    if (rrule) {
      const row = findLocal.get(item.id);
      if (row) for (const date of exdatesOf(item)) insException.run(row.id, date);
    }
  });



  const ordered = items.filter(Boolean)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.recurringEventId ? 1 : 0) - (b.item.recurringEventId ? 1 : 0) || a.index - b.index)
    .map((entry) => entry.item);

  for (const item of ordered) {
    try {
      insertOrUpdate(item);
    } catch (err) {
      log.error(`Upsert error for event ${item?.id}:`, err.message);
    }
  }






  if (fullResync) {
    const seen = new Set(ordered.map((item) => item.id));
    for (const item of ordered) {
      if (item.recurringEventId || !recurrenceRuleOf(item)) continue;
      try {
        retireLegacyInstances(item.id, seen);
      } catch (err) {
        log.error(`Could not retire legacy instances of ${item.id}:`, err.message);
      }
    }
  }
}

function retireLegacyInstances(masterExternalId, seen) {
  const master = db.get().prepare(
    `SELECT id FROM calendar_events WHERE external_calendar_id = ? AND external_source = 'google'`
  ).get(masterExternalId);
  if (!master) return;

  const legacy = db.get().prepare(`
    SELECT e.id, e.external_calendar_id, e.start_datetime, e.user_modified,
           (SELECT COUNT(*) FROM event_assignments ea WHERE ea.event_id = e.id) AS assignments
    FROM calendar_events e
    WHERE e.external_source = 'google'
      AND e.external_calendar_id LIKE ? ESCAPE '\\'
      AND e.id <> ?
  `).all(`${masterExternalId.replace(/([%_\\])/g, '\\$1')}\\_%`, master.id);

  const drop     = db.get().prepare('DELETE FROM calendar_events WHERE id = ?');
  const detach   = db.get().prepare(`
    UPDATE calendar_events
    SET external_source = 'local', external_calendar_id = NULL, recurrence_rule = NULL
    WHERE id = ?
  `);
  const insException = db.get().prepare(
    'INSERT OR IGNORE INTO calendar_event_exceptions (event_id, exception_date) VALUES (?, ?)'
  );

  let removed = 0;
  let kept = 0;
  for (const row of legacy) {

    if (seen.has(row.external_calendar_id)) continue;

    if (row.user_modified === 0 && row.assignments === 0) {
      drop.run(row.id);
      removed++;
    } else {
      insException.run(master.id, String(row.start_datetime).slice(0, 10));
      detach.run(row.id);
      kept++;
    }
  }
  if (removed || kept) {
    log.info(
      `Series ${masterExternalId}: ${removed} legacy occurrence(s) folded into the series` +
      `${kept ? `, ${kept} kept as separate event(s) because they carry local edits` : ''}.`
    );
  }
}



// Sekunden, sonst "Bad Request" bzw. bei Wiederholungen "Invalid

function toRfc3339(dt) {
  if (!dt) return dt;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dt) ? `${dt}:00` : dt;
}


// buildRRule liefert UNTIL immer als DATE-TIME (YYYYMMDDTHHMMSSZ).
//   - all-day-Events (start.date):    UNTIL muss DATE sein (YYYYMMDD)
//   - getimte Events (start.dateTime): UNTIL muss UTC DATE-TIME sein
// Andernfalls lehnt Google die Recurrence ab ("Invalid recurrence rule").
function normalizeRecurrenceUntil(rule, allDay) {
  return rule.split(';').map((segment) => {
    const eq = segment.indexOf('=');
    if (eq === -1) return segment;
    if (segment.slice(0, eq).toUpperCase() !== 'UNTIL') return segment;
    const digits   = segment.slice(eq + 1).replace(/\D/g, '');
    const datePart = digits.slice(0, 8);
    if (allDay) return `UNTIL=${datePart}`;
    const timePart = digits.length > 8 ? digits.slice(8, 14).padEnd(6, '0') : '235959';
    return `UNTIL=${datePart}T${timePart}Z`;
  }).join(';');
}

function localEventToGoogle(rawEvent, colorMap = {}, timeZone = householdTimeZone(null)) {


  // unberuehrt (#756). Begruendung in services/outbound-dtstart.js.
  const event = outboundEvent(rawEvent);
  const allDay = !!event.all_day;
  const gEvent = {
    summary:     event.title,
    description: event.description || undefined,
    location:    event.location    || undefined,
  };




  //






  //







  //




  if (event.color) {
    const colorId = nearestColorId(event.color, colorMap);
    if (colorId) gEvent.colorId = colorId;
  } else if (event.color_modified) {
    gEvent.colorId = null;
  }

  if (allDay) {
    const startDate = event.start_datetime.slice(0, 10);
    const endDate   = event.end_datetime ? event.end_datetime.slice(0, 10) : startDate;
    gEvent.start = { date: startDate };
    gEvent.end   = { date: localAllDayEndToExclusive(endDate) };
  } else {

    // timeZone lehnt Google Serien ab ("recurring events: field is required"),




    const startDt = toRfc3339(event.start_datetime);
    const endDt   = toRfc3339(event.end_datetime) || startDt;
    gEvent.start = { dateTime: startDt, timeZone };
    gEvent.end   = { dateTime: endDt,   timeZone };
  }

  if (event.recurrence_rule) {
    gEvent.recurrence = [`RRULE:${normalizeRecurrenceUntil(rruleValue(event.recurrence_rule), allDay)}`];
  }

  return gEvent;
}

export { getAuthUrl, handleCallback, getStatus, disconnect, clearMirroredEvents, sync,
         listCalendars, listSelection, setCalendarEnabled, setReadonly, flushOutbound };
export const __test = {
  localEventToGoogle, googleAllDayEndToInclusive, localAllDayEndToExclusive,
  upsertGoogleEvents, upsertExternalCalendar, setReadonly, isReadonly, isWritableRole,
  listSelection, setCalendarEnabled, recordSyncToken, getSyncToken, enabledCalendarIds,
  fetchEventColorMap, householdTimeZone,
  processPendingDeletions, pendingDeletionCount,
  processPendingUpdates, pendingUpdateCount,
  googleCalendarIdForEvent, currentGoogleCalendarId, loadCalendarMeta,


  queueEventDeletion: outbound.queueEventDeletion,
  markEventOutbound:  outbound.markEventOutbound,
  MIRRORED_FIELDS:    outbound.MIRRORED_FIELDS,
  classifyOutboundError: outbound.classifyOutboundError,
  MAX_OUTBOUND_ATTEMPTS: outbound.MAX_OUTBOUND_ATTEMPTS,
};
