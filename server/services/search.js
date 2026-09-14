import { visibilityWhere } from './visibility.js';

import {
  expandRecurringEvents, loadEventExceptions,
} from './calendar-events.js';
import { eventProjectionSql, resolveProjectedEventRows } from './calendar-event-reader.js';

export const SEARCH_LIMIT = 5;

function eszettVariants(token) {
  return new Set([
    token,
    token.replace(/ß/g, 'ss').replace(/ẞ/g, 'ss'),
    token.replace(/ss/gi, 'ß'),
  ]);
}

export function buildMatchQuery(q) {
  const tokens = String(q || '')
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]+/gu, ''))
    .filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t) => {
    const clause = [...eszettVariants(t)]
      .map((v) => `"${v.replace(/"/g, '""')}"*`)
      .join(' OR ');
    return clause.includes(' OR ') ? `(${clause})` : clause;
  }).join(' AND ');
}

const BUCKET_MODULE = Object.freeze({
  tasks: 'tasks',
  events: 'calendar',
  notes: 'notes',
  contacts: 'contacts',
  items: 'shopping',
  meds: 'health',
  activities: 'health',
  waste: 'waste',
});

export const SEARCH_MODULES = Object.freeze([...new Set(Object.values(BUCKET_MODULE))]);

export function emptySearchResults() {
  return Object.fromEntries(Object.keys(BUCKET_MODULE).map((k) => [k, []]));
}

/**
 * Resolves event search hits through the same linked-occurrence contract as
 * calendar reads. When a display window is supplied, recurring master hits are
 * represented by their first occurrence in that window, preserving the
 * calendar-search behavior without expanding one FTS hit into many results.
 */
export function resolveEventSearchRows(database, rows, from = null, to = null, options = {}) {
  const recurringIds = rows.filter((row) => row.recurrence_rule).map((row) => row.id);
  const exceptions = loadEventExceptions(database, recurringIds);
  const displayRows = rows.map((row) => {
    if (!row.recurrence_rule || !from || !to) return row;
    return expandRecurringEvents(
      [row],
      from,
      to,
      exceptions,
      { includeRecurrenceIdentity: true },
    )[0] || row;
  });
  return resolveProjectedEventRows(database, displayRows, options)
    .sort((a, b) => String(a.start_datetime).localeCompare(String(b.start_datetime)));
}

export function runSearch(database, q, userId, { hiddenModules = null } = {}) {
  const match = buildMatchQuery(q);
  if (!match) return emptySearchResults();
  const limit = SEARCH_LIMIT;




  const results = emptySearchResults();
  const allows = (bucket) => !hiddenModules?.has(BUCKET_MODULE[bucket]);

  if (allows('tasks')) results.tasks = database.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.due_date
    FROM search_index s
    JOIN tasks t ON t.id = s.entity_id
    WHERE s.entity = 'task' AND s.search_index MATCH @match
      AND t.parent_task_id IS NULL
      AND (t.created_by = @userId OR t.assigned_to = @userId)
    ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END,
             t.due_date ASC NULLS LAST
    LIMIT @limit
  `).all({ match, userId, limit });








  // routes/calendar/read.js, damit globale und Kalender-Suche fuers gleiche



  if (allows('events')) {
    const eventRows = resolveEventSearchRows(database, database.prepare(`
      SELECT ${eventProjectionSql(database)}
      FROM search_index s
      JOIN calendar_events e ON e.id = s.entity_id
      WHERE s.entity = 'event' AND s.search_index MATCH @match
        AND (
          e.external_source <> 'ics'
          OR e.subscription_id IN (
            SELECT id FROM ics_subscriptions WHERE shared = 1 OR created_by = @userId
          )
        )
        AND ${visibilityWhere('e', 'event_assignments', 'event_id', '@userId')}
      ORDER BY e.start_datetime ASC
      LIMIT @limit
    `).all({ match, userId, limit }), null, null, { lightweight: true });
    // Preserve the compact global-search payload. The resolver-capable
    // projection supplies linked inheritance without loading attachment bodies
    // or unrelated sync metadata into this result bucket.
    results.events = eventRows.map((event) => ({
      id: event.id,
      title: event.title,
      start_datetime: event.start_datetime,
      all_day: event.all_day,
      ...(event.is_occurrence_override ? {
        series_id: event.series_id,
        recurrence_id: event.recurrence_id,
        is_occurrence_override: true,
        assignment_owner_id: event.assignment_owner_id,
        attachment_owner_id: event.attachment_owner_id,
        reminder_owner_id: event.reminder_owner_id,
        reminder_anchor_start: event.reminder_anchor_start,
      } : {}),
    }));
  }

  if (allows('notes')) results.notes = database.prepare(`
    SELECT n.id, n.title, n.content
    FROM search_index s
    JOIN notes n ON n.id = s.entity_id
    WHERE s.entity = 'note' AND s.search_index MATCH @match
      AND n.created_by = @userId
    ORDER BY n.pinned DESC, n.updated_at DESC
    LIMIT @limit
  `).all({ match, userId, limit });

  if (allows('contacts')) results.contacts = database.prepare(`
    SELECT c.id, c.name AS title
    FROM search_index s
    JOIN contacts c ON c.id = s.entity_id
    WHERE s.entity = 'contact' AND s.search_index MATCH @match
    ORDER BY c.name ASC
    LIMIT @limit
  `).all({ match, limit });

  if (allows('items')) results.items = database.prepare(`
    SELECT i.id, i.name AS title, i.list_id
    FROM search_index s
    JOIN shopping_items i ON i.id = s.entity_id
    WHERE s.entity = 'item' AND s.search_index MATCH @match
    ORDER BY i.name ASC
    LIMIT @limit
  `).all({ match, limit });

  // Health: Medikamente — Treffer auf Name/Dosistext, Sichtbarkeits-Scoping.
  if (allows('meds')) results.meds = database.prepare(`
    SELECT m.id, m.name AS title, m.dosage_text, m.active
    FROM search_index s
    JOIN medications m ON m.id = s.entity_id
    WHERE s.entity = 'medication' AND s.search_index MATCH @match
      AND (m.user_id = @userId OR m.visibility = 'family')
    ORDER BY m.active DESC, m.name ASC
    LIMIT @limit
  `).all({ match, userId, limit });


  if (allows('activities')) results.activities = database.prepare(`
    SELECT a.id, a.type AS title, a.note, a.performed_at
    FROM search_index s
    JOIN health_activities a ON a.id = s.entity_id
    WHERE s.entity = 'activity' AND s.search_index MATCH @match
      AND (a.user_id = @userId OR a.visibility = 'family')
    ORDER BY a.performed_at DESC
    LIMIT @limit
  `).all({ match, userId, limit });


  // waste-domain.js berechneten, potenziell unbegrenzten Termine (siehe dortige
  // Migrationsnotiz). Kein Besitzer-Filter (Haushaltseigentum, wie Kontakte),

  if (allows('waste')) results.waste = database.prepare(`
    SELECT wt.id, wt.name AS title, wt.icon, wt.color
    FROM search_index s
    JOIN waste_types wt ON wt.id = s.entity_id
    WHERE s.entity = 'waste_type' AND s.search_index MATCH @match
      AND wt.archived = 0
    ORDER BY wt.sort_order ASC, wt.name ASC
    LIMIT @limit
  `).all({ match, limit });

  return results;
}
