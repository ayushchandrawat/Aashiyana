// --------------------------------------------------------

//



//



// --------------------------------------------------------

import { createLogger } from '../logger.js';
const log = createLogger('CalendarPrune');

export function pruneDeletedEvents(database, {
  calRefId,
  calendarUids,
  accountUids = calendarUids,
  source = 'caldav',
  calendarName = null,
} = {}) {
  const localEvents = database.prepare(`
    SELECT id, external_calendar_id FROM calendar_events
    WHERE calendar_ref_id = ? AND external_source = ?
  `).all(calRefId, source);

  const stale = localEvents.filter(ev => !accountUids.has(ev.external_calendar_id));
  if (stale.length === 0) return 0;

  if (calendarUids.size === 0) {
    const label = calendarName ? `"${calendarName}"` : `ref ${calRefId}`;
    log.warn(
      `Calendar ${label}: server returned no events, but ${stale.length} exist locally. ` +
      `Skipping deletion — assuming a fetch error rather than an emptied calendar.`
    );
    return 0;
  }

  const del = database.prepare('DELETE FROM calendar_events WHERE id = ?');
  for (const ev of stale) del.run(ev.id);

  return stale.length;
}

// --------------------------------------------------------

//




//





// Datenverlust bei allen anderen Clients derselben Familie.
// --------------------------------------------------------

function calendarRefIds(database, externalIds) {
  if (!externalIds.length) return [];
  const marks = externalIds.map(() => '?').join(',');
  return database.prepare(
    `SELECT id FROM external_calendars WHERE source IN ('caldav','apple') AND external_id IN (${marks})`
  ).all(...externalIds).map((r) => r.id);
}

export function countMirroredEvents(database, externalIds) {
  const refIds = calendarRefIds(database, externalIds);
  if (!refIds.length) return 0;
  const marks = refIds.map(() => '?').join(',');
  return database.prepare(
    `SELECT COUNT(*) AS n FROM calendar_events
     WHERE calendar_ref_id IN (${marks}) AND external_source IN ('caldav','apple')`
  ).get(...refIds).n;
}

export function deleteMirroredEvents(database, externalIds) {
  const refIds = calendarRefIds(database, externalIds);
  if (!refIds.length) return 0;
  const marks = refIds.map(() => '?').join(',');
  const result = database.prepare(
    `DELETE FROM calendar_events
     WHERE calendar_ref_id IN (${marks}) AND external_source IN ('caldav','apple')`
  ).run(...refIds);
  const removed = Number(result.changes) || 0;
  if (removed) log.info(`Removed ${removed} mirrored event(s) on user request.`);
  return removed;
}

// --------------------------------------------------------

//





//

// Kalenderzuordnung gerade das, was fehlt. Lokale Termine (`external_source = 'local'`)

//


// --------------------------------------------------------

export function countSourceEvents(database, source) {
  return database.prepare(
    'SELECT COUNT(*) AS n FROM calendar_events WHERE external_source = ?'
  ).get(source).n;
}

export function deleteSourceEvents(database, source) {
  const result = database.prepare(
    'DELETE FROM calendar_events WHERE external_source = ?'
  ).run(source);
  const removed = Number(result.changes) || 0;
  if (removed) log.info(`Removed ${removed} mirrored ${source} event(s) on user request.`);
  return removed;
}
