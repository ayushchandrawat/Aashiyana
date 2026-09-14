
const REWARD_TX = `
  INSERT INTO reward_ledger (user_id, delta, type, reason, task_id, redemption_id, created_by)
  VALUES (@user_id, @delta, @type, @reason, @task_id, @redemption_id, @created_by)
`;

/** Aktueller Punktestand eines Mitglieds (Summe aller Ledger-Buchungen). */
export function getBalance(d, userId) {
  const row = d.prepare('SELECT COALESCE(SUM(delta), 0) AS bal FROM reward_ledger WHERE user_id = ?').get(userId);
  return row?.bal ?? 0;
}

/** IDs aller aktiv teilnehmenden Mitglieder. */
function enrolledIds(d) {
  return new Set(
    d.prepare('SELECT user_id FROM reward_participants WHERE enabled = 1').all().map((r) => r.user_id),
  );
}

/** Nimmt ein Mitglied aktiv am Punkte-System teil? */
export function isEnrolled(d, userId) {
  if (!userId) return false;
  const row = d.prepare('SELECT enabled FROM reward_participants WHERE user_id = ?').get(userId);
  return !!row && row.enabled === 1;
}

export function rewardTargets(d, taskId, actingUserId) {
  const enrolled = enrolledIds(d);
  const assignees = d.prepare('SELECT user_id FROM task_assignments WHERE task_id = ?')
    .all(taskId).map((r) => r.user_id);
  const targets = assignees.filter((id) => enrolled.has(id));
  if (targets.length) return targets;
  if (actingUserId && enrolled.has(actingUserId)) return [actingUserId];
  return [];
}

export function awardForCompletion(d, taskId, actingUserId) {
  const task = d.prepare('SELECT id, points, title FROM tasks WHERE id = ?').get(taskId);
  if (!task || !Number.isInteger(task.points) || task.points <= 0) return;
  const targets = rewardTargets(d, taskId, actingUserId);
  if (!targets.length) return;
  const ins = d.prepare(`INSERT OR IGNORE INTO ${'reward_ledger'} (user_id, delta, type, reason, task_id, created_by)
    VALUES (?, ?, 'earn', ?, ?, ?)`);
  for (const uid of targets) {
    ins.run(uid, task.points, task.title || null, taskId, actingUserId || null);
  }
}

export function reverseTaskEarnings(d, taskId) {
  d.prepare("DELETE FROM reward_ledger WHERE task_id = ? AND type = 'earn'").run(taskId);
}

export function syncTaskRewards(d, taskId, oldStatus, newStatus, actingUserId) {
  const wasDone = oldStatus === 'done';
  const isDone = newStatus === 'done';
  if (isDone && !wasDone) awardForCompletion(d, taskId, actingUserId);
  else if (wasDone && !isDone) reverseTaskEarnings(d, taskId);
}

/** Freie Buchung (Bonus/Korrektur/Reversal) — vom Route-Handler genutzt. */
export function postLedger(d, { userId, delta, type, reason = null, taskId = null, redemptionId = null, createdBy = null }) {
  return d.prepare(REWARD_TX).run({
    user_id: userId,
    delta,
    type,
    reason,
    task_id: taskId,
    redemption_id: redemptionId,
    created_by: createdBy,
  });
}
