
function templateReminders(database, eventId, authorId) {




  return database.prepare(`
    SELECT remind_at FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
    ORDER BY remind_at ASC
  `).all(eventId, authorId).map((r) => r.remind_at);
}

function assigneesOf(database, eventId, exceptUserId) {
  return database.prepare(`
    SELECT user_id FROM event_assignments WHERE event_id = ? AND user_id != ?
  `).all(eventId, exceptUserId).map((r) => r.user_id);
}

export function fanOutEventReminders(
  database,
  eventId,
  authorId,
  { dropDerivedWhenOwn = false } = {},
) {
  const remindAts = templateReminders(database, eventId, authorId);
  const targets   = assigneesOf(database, eventId, authorId);
  if (!targets.length) return 0;

  const ownRow = database.prepare(`
    SELECT 1 FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ? AND assigned_from IS NULL
  `);
  const derivedOf = database.prepare(`
    SELECT remind_at FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ? AND assigned_from = ?
    ORDER BY remind_at ASC
  `);
  const dropDerived = database.prepare(`
    DELETE FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ? AND assigned_from = ?
  `);
  const insert = database.prepare(`
    INSERT INTO reminders (entity_type, entity_id, remind_at, created_by, assigned_from)
    VALUES ('event', ?, ?, ?, ?)
  `);

  const wanted = remindAts.join('|');
  let written = 0;
  for (const userId of targets) {
    if (ownRow.get(eventId, userId)) {
      if (dropDerivedWhenOwn) dropDerived.run(eventId, userId, authorId);
      continue;
    }
    const have = derivedOf.all(eventId, userId, authorId).map((r) => r.remind_at).join('|');
    if (have === wanted) continue;

    dropDerived.run(eventId, userId, authorId);
    for (const remindAt of remindAts) {
      insert.run(eventId, remindAt, userId, authorId);
      written++;
    }
  }
  return written;
}

export function dropInheritedEventReminders(database, eventId, userIds) {
  if (!userIds?.length) return 0;
  const stmt = database.prepare(`
    DELETE FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ? AND assigned_from IS NOT NULL
  `);
  let removed = 0;
  for (const userId of userIds) removed += stmt.run(eventId, userId).changes;
  return removed;
}

export function eventAuthorId(database, eventId) {
  return database.prepare('SELECT created_by FROM calendar_events WHERE id = ?')
    .get(eventId)?.created_by ?? null;
}
