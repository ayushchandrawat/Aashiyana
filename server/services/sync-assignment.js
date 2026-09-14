import { createHash } from 'node:crypto';
import { setEventAssignments } from '../routes/calendar/helpers.js';

// --------------------------------------------------------

//




// --------------------------------------------------------

export function assignDefaultToEvent(d, eventId, userId) {
  if (!eventId || !userId) return;

  const exists = d.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
  if (!exists) return;

  d.prepare('UPDATE calendar_events SET assigned_to = ? WHERE id = ? AND assigned_to IS NULL')
    .run(userId, eventId);
  d.prepare('INSERT OR IGNORE INTO event_assignments (event_id, user_id) VALUES (?, ?)')
    .run(eventId, userId);
}

// --------------------------------------------------------
// Nachtragen auf bereits importierte Termine (#1154).
//






//
// Geltungsbereich: jeder Kalender aller Konten (external_calendars, also



//



//

// sein. Ein lokal abgekoppeltes Vorkommen (retireLegacyInstances setzt


//







//






// Umbauten danach tragen created_at unveraendert mit.
//




// --------------------------------------------------------

const UNASSIGNED_MAPPED_EVENTS = `
  FROM calendar_events e
  JOIN external_calendars ec ON ec.id = e.calendar_ref_id
  JOIN users u ON u.id = ec.default_assignee_user_id
  WHERE e.external_source = ec.source
    AND e.target_google_calendar_id IS NULL
    AND e.target_caldav_calendar_url IS NULL
    AND COALESCE(e.external_calendar_id, '') <> ('oikos-' || e.id || '@oikos.local')
    AND NOT (e.external_source = 'google' AND e.created_at < COALESCE(
      (SELECT applied_at FROM schema_migrations WHERE version = 47), ''))
    AND e.assigned_to IS NULL
    AND NOT EXISTS (SELECT 1 FROM event_assignments ea WHERE ea.event_id = e.id)
`;

const BACKFILL_BATCH_SIZE = 50;

export function listBackfillCandidates(d) {
  return d.prepare(
    `SELECT e.id AS eventId, ec.default_assignee_user_id AS userId ${UNASSIGNED_MAPPED_EVENTS} ORDER BY e.id`
  ).all();
}

export function backfillCandidatesToken(candidates) {
  const hash = createHash('sha256');
  for (const { eventId, userId } of candidates) hash.update(`${eventId}:${userId};`);
  return hash.digest('hex');
}

export async function applyDefaultAssigneesToExisting(
  d,
  candidates = listBackfillCandidates(d),
  { batchSize = BACKFILL_BATCH_SIZE, now = new Date() } = {},
) {
  const nowIso = now.toISOString();
  const stillEligible = d.prepare(`
    SELECT ec.default_assignee_user_id AS userId,
           e.created_by AS authorId, e.attachment_document_id AS documentId
    ${UNASSIGNED_MAPPED_EVENTS}
      AND e.id = ?
  `);
  const setPrimary = d.prepare(
    'UPDATE calendar_events SET assigned_to = ? WHERE id = ? AND assigned_to IS NULL'
  );
  const addAssignment = d.prepare(
    'INSERT OR IGNORE INTO event_assignments (event_id, user_id) VALUES (?, ?)'
  );
  const hasFutureTemplate = d.prepare(`
    SELECT 1 FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ? AND remind_at > ?
  `);
  const settlePastInherited = d.prepare(`
    UPDATE reminders SET dismissed = 1
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
      AND assigned_from IS NOT NULL AND remind_at <= ?
  `);

  let assigned = 0;
  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize);
    assigned += d.transaction(() => {
      let written = 0;
      for (const { eventId, userId } of batch) {
        const row = stillEligible.get(eventId);
        if (!row || row.userId !== userId) continue;
        setPrimary.run(userId, eventId);
        if (row.documentId || (row.authorId !== null && hasFutureTemplate.get(eventId, row.authorId, nowIso))) {
          setEventAssignments(d, eventId, [userId]);
          settlePastInherited.run(eventId, userId, nowIso);
        } else {
          addAssignment.run(eventId, userId);
        }
        written += 1;
      }
      return written;
    })();
    if (start + batchSize < candidates.length) await new Promise((resolve) => setImmediate(resolve));
  }
  return assigned;
}
