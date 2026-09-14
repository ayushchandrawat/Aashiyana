
import { visibilityWhere } from './visibility.js';

const CHAIN_CTE = `
  WITH RECURSIVE chain(id, origin, depth) AS (
    SELECT id, recurrence_origin_id, 0 FROM tasks WHERE id = @task
    UNION ALL
    SELECT t.id, t.recurrence_origin_id, c.depth + 1
      FROM tasks t JOIN chain c ON t.id = c.origin
     WHERE c.depth < 1000
  )
`;

export function seriesRootOf(d, taskId) {
  const row = d.prepare(`${CHAIN_CTE} SELECT id FROM chain ORDER BY depth DESC LIMIT 1`)
    .get({ task: taskId });
  return row?.id ?? taskId;
}

export function recordCompletion(d, taskId, actingUserId) {
  const task = d.prepare('SELECT id, parent_task_id, recurrence_origin_id FROM tasks WHERE id = ?').get(taskId);
  if (!task || task.parent_task_id) return;








  const inherited = task.recurrence_origin_id
    ? d.prepare('SELECT series_id FROM task_completions WHERE task_id = ?').get(task.recurrence_origin_id)
    : null;

  d.prepare(`
    INSERT OR IGNORE INTO task_completions (task_id, series_id, user_id)
    VALUES (?, ?, ?)
  `).run(taskId, inherited?.series_id ?? seriesRootOf(d, taskId), actingUserId || null);
}

export function revokeCompletion(d, taskId) {
  d.prepare('DELETE FROM task_completions WHERE task_id = ?').run(taskId);
}

export function syncTaskCompletion(d, taskId, oldStatus, newStatus, actingUserId) {
  const wasDone = oldStatus === 'done';
  const isDone = newStatus === 'done';
  if (isDone && !wasDone) recordCompletion(d, taskId, actingUserId);
  else if (wasDone && !isDone) revokeCompletion(d, taskId);
}

const VISIBLE_SQL = visibilityWhere('t', 'task_assignments', 'task_id', '@me');

/** Spalten, die beide Lesepfade teilen. */
const SELECT_SQL = `
  SELECT c.id, c.task_id, c.series_id, c.completed_at,
         c.user_id,
         u.display_name  AS user_name,
         u.avatar_color  AS user_color,
         u.avatar_data   AS user_avatar,
         t.title, t.category, t.points, t.is_recurring, t.visibility
    FROM task_completions c
    JOIN tasks t ON t.id = c.task_id
    LEFT JOIN users u ON u.id = c.user_id
`;

export function completionFeed(d, { me, limit = 50, userId = null, beforeAt = null, beforeId = null }) {
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const where = [VISIBLE_SQL];
  const params = { me, size };

  if (userId != null) { where.push('c.user_id = @user_id'); params.user_id = userId; }
  if (beforeAt) {
    where.push('(c.completed_at < @before_at OR (c.completed_at = @before_at AND c.id < @before_id))');
    params.before_at = beforeAt;
    params.before_id = Number(beforeId) || 0;
  }



  const rows = d.prepare(`
    ${SELECT_SQL}
    WHERE ${where.join(' AND ')}
    ORDER BY c.completed_at DESC, c.id DESC
    LIMIT @size + 1
  `).all(params);

  const hasMore = rows.length > size;
  return { entries: hasMore ? rows.slice(0, size) : rows, hasMore };
}

export function seriesHistory(d, { me, taskId, limit = 20 }) {
  const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return d.prepare(`
    ${CHAIN_CTE}
    ${SELECT_SQL}
    WHERE (
      c.task_id   IN (SELECT id FROM chain)
      OR c.series_id IN (SELECT id FROM chain)
      OR c.series_id IN (SELECT series_id FROM task_completions WHERE task_id IN (SELECT id FROM chain))
    ) AND ${VISIBLE_SQL}
    ORDER BY c.completed_at DESC, c.id DESC
    LIMIT @size
  `).all({ me, task: taskId, size });
}
