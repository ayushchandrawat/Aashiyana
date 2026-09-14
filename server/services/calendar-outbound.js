// --------------------------------------------------------

//



// Absicht erst vorgemerkt und dann vom Sync abgearbeitet (at-least-once):
//


//   Umzug   → calendar_events.outbound_move_to
//




//



// --------------------------------------------------------

import { createLogger } from '../logger.js';
import * as db from '../db.js';

const log = createLogger('CalendarOutbound');


// belastet ein dauerhaft unschreibbares Event (Kalender entzogen, Konto getauscht)

export const MAX_OUTBOUND_ATTEMPTS = 5;



export const OUTBOUND_SOURCES = ['google', 'caldav', 'apple'];



export const MIRRORED_FIELDS = [
  'title', 'description', 'location', 'color',
  'all_day', 'start_datetime', 'end_datetime', 'recurrence_rule',
];

export function mirroredFieldsChanged(before, after) {
  return MIRRORED_FIELDS.some((f) => before?.[f] !== after[f]);
}

export function classifyOutboundError(err) {
  const status = err?.code ?? err?.response?.status ?? err?.status;
  if (status === 404 || status === 410) return 'settled';
  if (status === 400) return 'permanent';
  return 'retry';
}

export function outboundFailureAction(err, attempts) {
  const kind = classifyOutboundError(err);
  if (kind === 'settled') return 'settled';
  if (kind === 'permanent' || attempts + 1 >= MAX_OUTBOUND_ATTEMPTS) return 'give-up';
  return 'retry';
}

// --------------------------------------------------------

// --------------------------------------------------------

export function queueDeletion({ source, calendarExternalId, eventExternalId, objectUrl = null }, database = null) {
  if (!source || !eventExternalId) return false;
  if (!calendarExternalId && !objectUrl) return false;

  (database || db.get()).prepare(`
    INSERT INTO calendar_pending_deletions (source, calendar_external_id, event_external_id, object_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source, calendar_external_id, event_external_id)
      DO UPDATE SET object_url = COALESCE(excluded.object_url, object_url)
  `).run(source, calendarExternalId || '', eventExternalId, objectUrl);
  return true;
}

export function pendingDeletions(source) {
  return db.get().prepare(`
    SELECT id, calendar_external_id, event_external_id, object_url, attempts
    FROM calendar_pending_deletions
    WHERE source = ?
    ORDER BY id
  `).all(source);
}

export function pendingDeletionCount(source) {
  return db.get().prepare(
    'SELECT COUNT(*) AS c FROM calendar_pending_deletions WHERE source = ?'
  ).get(source).c;
}

export function hasPendingDeletion(source, eventExternalId) {
  return !!db.get().prepare(
    'SELECT 1 FROM calendar_pending_deletions WHERE source = ? AND event_external_id = ?'
  ).get(source, eventExternalId);
}

export function pendingDeletionUids(source) {
  try {
    return new Set(
      db.get().prepare(
        'SELECT event_external_id FROM calendar_pending_deletions WHERE source = ?'
      ).all(source).map((r) => r.event_external_id)
    );
  } catch (err) {
    log.warn(`Pending deletions are not readable (${err.message}); treating them as none.`);
    return new Set();
  }
}

export function dropDeletion(id) {
  db.get().prepare('DELETE FROM calendar_pending_deletions WHERE id = ?').run(id);
}

export function failDeletion(id, err) {
  db.get().prepare(
    'UPDATE calendar_pending_deletions SET attempts = attempts + 1, last_error = ? WHERE id = ?'
  ).run(String(err?.message || err).slice(0, 500), id);
}

export function recordDeletionObjectUrl(id, objectUrl) {
  if (!objectUrl) return;
  db.get().prepare('UPDATE calendar_pending_deletions SET object_url = ? WHERE id = ?').run(objectUrl, id);
}

export function handleDeletionError(err, row, provider) {
  const action = outboundFailureAction(err, row.attempts);
  if (action === 'settled') {
    dropDeletion(row.id);
    return true;
  }
  const attempts = row.attempts + 1;
  failDeletion(row.id, err);
  if (action === 'give-up') {
    log.error(`[${provider}] Giving up on remote deletion of ${row.event_external_id} after ${attempts} attempt(s):`, err.message);
    dropDeletion(row.id);
    return true;
  }
  log.warn(`[${provider}] Remote deletion failed for ${row.event_external_id} (attempt ${attempts}):`, err.message);
  return false;
}

// --------------------------------------------------------

// --------------------------------------------------------

export function markOutbound(eventId, { dirty = false, moveTo = null, cancelMove = false } = {}) {
  if (!dirty && !moveTo && !cancelMove) return false;
  const row = db.get().prepare(`
    UPDATE calendar_events
    SET outbound_dirty    = CASE WHEN ? THEN 1 ELSE outbound_dirty END,
        outbound_move_to  = CASE WHEN ? THEN NULL ELSE COALESCE(?, outbound_move_to) END,
        outbound_attempts = 0
    WHERE id = ?
    RETURNING outbound_dirty, outbound_move_to
  `).get(dirty ? 1 : 0, cancelMove ? 1 : 0, moveTo, eventId);
  return !!(row && (row.outbound_dirty || row.outbound_move_to));
}

export function pendingUpdates(source) {
  return db.get().prepare(`
    SELECT * FROM calendar_events
    WHERE (outbound_dirty = 1 OR outbound_move_to IS NOT NULL)
      AND external_source = ? AND external_calendar_id IS NOT NULL
    ORDER BY id
  `).all(source);
}

export function pendingUpdateCount(source) {
  return db.get().prepare(`
    SELECT COUNT(*) AS c FROM calendar_events
    WHERE (outbound_dirty = 1 OR outbound_move_to IS NOT NULL)
      AND external_source = ? AND external_calendar_id IS NOT NULL
  `).get(source).c;
}

/** Alles erledigt: Push und Umzug. */
export function clearOutbound(eventId) {
  db.get().prepare(`
    UPDATE calendar_events
    SET outbound_dirty = 0, outbound_move_to = NULL, outbound_attempts = 0
    WHERE id = ?
  `).run(eventId);
}

export function clearOutboundMove(eventId) {
  db.get().prepare(
    'UPDATE calendar_events SET outbound_move_to = NULL, outbound_attempts = 0 WHERE id = ?'
  ).run(eventId);
}

export function failOutbound(eventId) {
  db.get().prepare(
    'UPDATE calendar_events SET outbound_attempts = outbound_attempts + 1 WHERE id = ?'
  ).run(eventId);
}

export function handleUpdateError(err, event, what, provider, giveUp = clearOutbound) {
  const action = outboundFailureAction(err, event.outbound_attempts);
  if (action === 'settled') {
    log.warn(`[${provider}] Event ${event.external_calendar_id} no longer exists at the provider, dropping outbound ${what}.`);
    clearOutbound(event.id);
    return;
  }
  if (action === 'give-up') {

    log.error(`[${provider}] Giving up on outbound ${what} of event ${event.id} after ${event.outbound_attempts + 1} attempt(s):`, err.message);
    giveUp(event.id);
    return;
  }
  const attempts = event.outbound_attempts + 1;
  failOutbound(event.id);
  log.warn(`[${provider}] Outbound ${what} failed for event ${event.id} (attempt ${attempts}):`, err.message);
}

function targetFieldFor(source) {
  if (source === 'google') return 'target_google_calendar_id';
  if (source === 'caldav') return 'target_caldav_calendar_url';
  return null;
}

function currentCalendarId(event) {
  if (!event.calendar_ref_id) return null;
  return db.get().prepare('SELECT external_id FROM external_calendars WHERE id = ? AND source = ?')
    .get(event.calendar_ref_id, event.external_source)?.external_id ?? null;
}

export function reloadEvent(eventId) {
  return db.get().prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId) ?? null;
}

export function settleOutbound(sent, handledMoveTo = null, requested = sent) {
  const now = reloadEvent(sent.id);
  if (!now) return;
  const edited = mirroredFieldsChanged(sent, now);
  let nextMove = (now.outbound_move_to ?? null) !== handledMoveTo ? now.outbound_move_to : null;









  const targetField = targetFieldFor(now.external_source);
  const retargeted  = handledMoveTo && now[targetField] !== requested[targetField];
  if (targetField && (nextMove || retargeted)) {
    const target  = now[targetField] || null;
    const current = currentCalendarId(now) ?? handledMoveTo;
    nextMove = target && target !== current ? target : null;
  }
  if (!edited && !nextMove) {
    clearOutbound(sent.id);
    return;
  }
  db.get().prepare(`
    UPDATE calendar_events
    SET outbound_dirty = ?, outbound_move_to = ?, outbound_attempts = 0
    WHERE id = ?
  `).run(edited ? 1 : 0, nextMove, sent.id);
}

export function recordObjectUrl(eventId, objectUrl) {
  if (!objectUrl) return;
  db.get().prepare('UPDATE calendar_events SET external_object_url = ? WHERE id = ?').run(objectUrl, eventId);
}

// --------------------------------------------------------

// --------------------------------------------------------

function cfg(key) {
  return db.get().prepare('SELECT value FROM sync_config WHERE key = ?').get(key)?.value ?? null;
}

function calendarExternalId(event, database = null) {
  if (event.calendar_ref_id) {
    const row = (database || db.get()).prepare(
      'SELECT external_id FROM external_calendars WHERE id = ? AND source = ?'
    ).get(event.calendar_ref_id, event.external_source);
    if (row?.external_id) return row.external_id;
  }


  if (event.external_source === 'google') return event.target_google_calendar_id || null;
  if (event.external_source === 'caldav') return event.target_caldav_calendar_url || null;
  return null;
}

function acceptsOutbound(source) {
  if (source === 'google') return !!cfg('google_refresh_token') && cfg('google_readonly') !== '1';
  if (source === 'caldav') {
    return !!db.get().prepare('SELECT 1 FROM caldav_accounts LIMIT 1').get();
  }
  if (source === 'apple') {
    return !!(cfg('apple_caldav_url') || process.env.APPLE_CALDAV_URL);
  }
  return false;
}

export function queueEventDeletion(event, database = null) {
  if (!event || !OUTBOUND_SOURCES.includes(event.external_source)) return false;
  if (!event.external_calendar_id) return false;
  if (!acceptsOutbound(event.external_source)) return false;

  const calId = calendarExternalId(event, database);

  if (!calId && !event.external_object_url) {
    log.warn(`No remote calendar known for event ${event.id}, deletion at the provider skipped.`);
    return false;
  }

  return queueDeletion({
    source:             event.external_source,
    calendarExternalId: calId,
    eventExternalId:    event.external_calendar_id,
    objectUrl:          event.external_object_url || null,
  }, database);
}

export function markEventOutbound(before, after) {
  if (!after || !OUTBOUND_SOURCES.includes(after.external_source)) return false;
  if (!after.external_calendar_id) return false;

  const dirty = mirroredFieldsChanged(before, after);

  const targetField = targetFieldFor(after.external_source);

  let moveTo     = null;
  let cancelMove = false;
  if (targetField) {
    const target   = after[targetField] || null;
    const previous = before?.[targetField] || null;
    const current  = currentCalendarId(after);
    if (target && target !== previous && current) {




      if (target === current) cancelMove = true;
      else moveTo = target;
    }
  }





  // lohnt dann trotzdem nicht, deshalb false.
  if (!acceptsOutbound(after.external_source)) {
    if (cancelMove) markOutbound(after.id, { cancelMove });
    return false;
  }

  if (!dirty && !moveTo && !cancelMove) return false;
  return markOutbound(after.id, { dirty, moveTo, cancelMove });
}

export async function flushOutbound() {
  const total = { deleted: 0, updated: 0 };

  const providers = [
    { source: 'google', load: () => import('./google-calendar.js') },
    { source: 'caldav', load: () => import('./caldav-sync.js') },
    { source: 'apple',  load: () => import('./apple-calendar.js') },
  ];

  for (const { source, load } of providers) {
    if (pendingDeletionCount(source) === 0 && pendingUpdateCount(source) === 0) continue;
    try {
      const mod = await load();
      const res = await mod.flushOutbound();
      total.deleted += res?.deleted ?? 0;
      total.updated += res?.updated ?? 0;
    } catch (err) {
      log.warn(`[${source}] Immediate outbound attempt failed: ${err.message}`);
    }
  }
  return total;
}
