
import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { documentVisibleSql } from '../services/document-access.js';
import { assertDocumentsNotDeleting, sendDocumentDeletionConflict } from '../services/document-deletion-lock.js';
import { nextDueAfterCompletion } from '../services/recurrence.js';
import { syncTaskRewards } from '../services/rewards.js';
import { completionFeed, seriesHistory, syncTaskCompletion } from '../services/task-completions.js';
import { normalizeCategoryFilter, taskCategoryWhere, taskScopeNeedsToday, taskScopeWhere } from '../services/task-scope.js';
import { normalizeVisibility, visibilityWhere } from '../services/visibility.js';
import {
  flushOutbound, markTodoOutbound, queueTodoDeletion,
} from '../services/caldav-todo-outbound.js';
import { uniqueKey } from '../utils/category-slug.js';
import { toLocalDateKey } from '../../public/utils/date.js';
import { parseSyncTargetValue } from '../../public/utils/sync-target.js';
import { mentionedUserIds } from '../../public/utils/mentions.js';
import { toggleChecklistLine } from '../../public/utils/markdown-checklist.js';
import { resolvePermissions } from '../permissions.js';
import { pushService } from '../services/push.js';
import { todayKey } from '../utils/timezone.js';
import {
  allTags, applyTagChanges, loadTags, loadTagsFor, normalizeTags,
  removeTagEverywhere, renameTag, setTags, tagKey, tagsKey, taskIdsWithTag,
} from '../utils/task-tags.js';
import * as v from '../middleware/validate.js';

const log = createLogger('Tasks');

function pushToCalDAV(what) {
  flushOutbound().catch((err) => log.warn(`${what} vorgemerkt, Sofortversuch fehlgeschlagen:`, err.message));
}

function resolveTaskSyncTarget(value) {
  const parsed = parseSyncTargetValue(value);
  if (parsed === null) {
    return { ok: false, error: 'sync_target: erwartet "caldav:<kontoId>|<url>" oder einen leeren Wert.' };
  }
  if (parsed.kind === 'local') return { ok: true, target: null };
  if (parsed.kind !== 'caldav') {


    return { ok: false, error: 'sync_target: Aufgaben lassen sich nur mit einer CalDAV-Erinnerungsliste abgleichen.' };
  }

  const allowed = db.get().prepare(`
    SELECT 1 FROM caldav_reminder_selection
     WHERE account_id = ? AND list_url = ? AND enabled = 1 AND target_module = 'tasks'
  `).get(parsed.accountId, parsed.calendarUrl);
  if (!allowed) {
    return { ok: false, error: 'sync_target: Diese Erinnerungsliste ist für Aufgaben nicht freigegeben.' };
  }
  return { ok: true, target: { accountId: parsed.accountId, listUrl: parsed.calendarUrl } };
}

const router = express.Router();

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const VALID_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];


// Statusfeld.
const REAL_STATUSES = ['open', 'in_progress', 'done'];






const ARCHIVE_STATUS = 'archived';
const VALID_STATUSES = [...REAL_STATUSES, ARCHIVE_STATUS];

const MAX_POINTS = 10000;
const FALLBACK_CATEGORY = 'misc';

function nowStamp() {
  return new Date().toISOString().slice(0, 19) + 'Z';
}

function setArchived(taskId, archived) {
  const value = archived ? nowStamp() : null;
  db.get().prepare('UPDATE tasks SET archived_at = ? WHERE id = ?').run(value, taskId);
  return value;
}

function loadTaskCategories() {
  return db.get().prepare(
    'SELECT key, name, label_key, sort_order FROM task_categories ORDER BY sort_order ASC, key ASC'
  ).all();
}

function validTaskCategoryKeys() {
  return loadTaskCategories().map((c) => c.key);
}

function taskCategoryInUseCount(key) {
  return db.get().prepare('SELECT COUNT(*) AS n FROM tasks WHERE category = ?').get(key).n;
}

function todayInHouseholdZone() {
  return todayKey(db.get());
}

function clampPoints(val) {
  const n = Math.trunc(Number(val));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_POINTS);
}

function defaultTaskPoints() {
  const row = db.get().prepare("SELECT value FROM sync_config WHERE key = 'tasks_default_points'").get();
  return clampPoints(row?.value);
}










const REBASE_EXCLUDED_STATUS = 'done';

function countRebasableTasks(points) {
  return db.get().prepare(`
    SELECT COUNT(*) AS n FROM tasks
    WHERE points = ? AND parent_task_id IS NULL AND status != ?
  `).get(points, REBASE_EXCLUDED_STATUS).n;
}

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

const ASSIGNED_USERS_SQL = `(
  SELECT json_group_array(json_object(
    'id', u.id, 'display_name', u.display_name, 'color', u.avatar_color,
    'avatar_data', u.avatar_data
  ))
  FROM task_assignments ta JOIN users u ON u.id = ta.user_id
  WHERE ta.task_id = t.id
) AS assigned_users_json`;

function addAssignedUsers(task) {
  task.assigned_users = task.assigned_users_json ? JSON.parse(task.assigned_users_json) : [];
  delete task.assigned_users_json;
  return task;
}

function attachDocumentCounts(tasks, me) {
  if (!tasks.length) return tasks;
  const counts = db.get().prepare(`
    SELECT td.task_id AS id, COUNT(*) AS n
    FROM task_documents td
    JOIN family_documents d ON d.id = td.document_id
    WHERE d.status != 'archived' AND ${DOC_VISIBLE_SQL}
    GROUP BY td.task_id
  `).all({ me });
  const map = new Map(counts.map((r) => [r.id, r.n]));
  for (const task of tasks) task.document_count = map.get(task.id) ?? 0;
  return tasks;
}

function attachTags(tasks) {
  if (!tasks.length) return tasks;
  const map = loadTagsFor(db.get(), tasks.map((t) => t.id));
  for (const task of tasks) task.tags = map.get(task.id) ?? [];
  return tasks;
}

function parseAssignedTo(val) {
  if (Array.isArray(val)) return val.map(Number).filter(Boolean);
  if (val !== null && val !== undefined && val !== '') return [Number(val)].filter(Boolean);
  return [];
}

function setAssignments(d, taskId, userIds) {
  d.prepare('DELETE FROM task_assignments WHERE task_id = ?').run(taskId);
  const ins = d.prepare('INSERT OR IGNORE INTO task_assignments (task_id, user_id) VALUES (?, ?)');
  for (const uid of userIds) ins.run(taskId, uid);
}

function syncHousekeepingPaymentStatus(d, taskId, status) {
  const table = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'housekeeping_work_sessions'").get();
  if (!table) return;
  d.prepare(`
    UPDATE housekeeping_work_sessions
    SET paid_at = CASE
      WHEN ? = 'done' THEN COALESCE(paid_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      ELSE NULL
    END
    WHERE payment_task_id = ?
  `).run(status, taskId);
}




// ein zweiter Weg an dieselbe Zeile: verlaesst sie 'done', setzt


function reopensSettledVisit(d, taskId, fromStatus, toStatus) {
  if (fromStatus !== 'done' || toStatus === 'done') return false;
  const table = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'housekeeping_work_sessions'").get();
  if (!table) return false;
  return !!d.prepare(
    'SELECT 1 FROM housekeeping_work_sessions WHERE payment_task_id = ? AND paid_at IS NOT NULL'
  ).get(taskId);
}

function mayAccessTask(task, me) {
  if (!task) return false;
  if (task.visibility === 'all') return true;
  if (task.created_by === me) return true;
  if (task.visibility === 'assignees') {
    return !!db.get().prepare(
      'SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ?'
    ).get(task.id, me);
  }
  return false;
}

function lockingTask(task) {
  if (!task) return null;
  if (task.locked) return task;
  if (!task.parent_task_id) return null;
  const parent = db.get().prepare('SELECT id, locked, created_by FROM tasks WHERE id = ?')
    .get(task.parent_task_id);
  return parent && parent.locked ? parent : null;
}

function isAdmin(req) { return req.authRole === 'admin' || req.session?.role === 'admin'; }

function mayEditTaskDefinition(task, req) {
  const lock = lockingTask(task);
  if (!lock) return true;
  if (isAdmin(req)) return true;
  return lock.created_by === (req.authUserId || req.session?.userId);
}

const LOCKED_ERROR = { error: 'This task is locked; only its creator and administrators can change it.', code: 403 };

function editableTaskIds(ids, req) {
  if (!ids.length) return ids;
  const rows = db.get().prepare(
    `SELECT id, locked, created_by, parent_task_id FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.filter((id) => {
    const row = byId.get(id);
    return row ? mayEditTaskDefinition(row, req) : true;
  });
}

function sameFieldValue(a, b) {
  return String(a ?? '') === String(b ?? '');
}

function loadSubtasks(taskId, me) {




  const rows = db.get().prepare(`
    SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color,
      u.avatar_data AS assigned_avatar, ${ASSIGNED_USERS_SQL}
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.parent_task_id = ?
      AND ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}
    ORDER BY t.created_at ASC
  `).all(taskId, { me }).map(addAssignedUsers);



  // Zeile schriebe sie still weg.
  return attachTags(rows);
}

function validateTags(value) {
  if (value === undefined || value === null) return {};
  if (Array.isArray(value) || typeof value === 'string') return {};
  return { error: 'tags must be an array or a comma-separated string.' };
}

function validateTaskInput(body, isCreate = true, currentRule = undefined) {
  const ruleUnchanged = !isCreate
    && body.recurrence_rule !== undefined
    && body.recurrence_rule === currentRule;
  return v.collectErrors([
    v.str(body.title,       'title',       { required: isCreate }),
    v.str(body.description, 'description', { required: false, max: v.MAX_TEXT }),
    v.oneOf(body.priority,  VALID_PRIORITIES, 'priority'),
    v.oneOf(body.status,    VALID_STATUSES,   'status'),
    v.oneOf(body.category,  validTaskCategoryKeys(), 'category'),
    v.date(body.start_date, 'start_date'),
    v.date(body.due_date,   'due_date'),
    v.time(body.due_time,   'due_time'),
    ruleUnchanged ? {} : v.rrule(body.recurrence_rule, 'recurrence_rule'),
    v.num(body.points,      'points'),
    validateTags(body.tags),
  ]);
}

// --------------------------------------------------------
// Kategorie-Verwaltung (#494, #357)

// sonst matcht Express „categories" als :id.
// --------------------------------------------------------

// GET /api/v1/tasks/categories → { data: TaskCategory[] }
router.get('/categories', (_req, res) => {
  try {
    res.json({ data: loadTaskCategories() });
  } catch (err) {
    log.error('GET /categories error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks/sync-targets (#695)
// → { data: { caldav: [{ accountId, accountName, listUrl, listName }] } }
//



// Kontenverwaltung bleibt admin-only.
//




// --------------------------------------------------------
router.get('/sync-targets', (_req, res) => {
  try {
    const caldav = db.get().prepare(`
      SELECT s.account_id AS accountId, a.name AS accountName,
             s.list_url   AS listUrl,   s.list_name AS listName
        FROM caldav_reminder_selection s
        JOIN caldav_accounts a ON a.id = s.account_id
       WHERE s.enabled = 1 AND s.target_module = 'tasks'
       ORDER BY a.name, s.list_name
    `).all();
    res.json({ data: { caldav } });
  } catch (err) {
    log.error('GET /sync-targets error:', err);
    res.status(500).json({ error: 'Failed to list sync targets.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks/completions

// Query: limit? (1..200, Default 50), user_id?, before_at? + before_id? (Cursor)
// Response: { data: [Eintrag], has_more, next_cursor }
//

// „completions" als :id.
//




// --------------------------------------------------------
router.get('/completions', (req, res) => {
  try {
    const me = req.authUserId || req.session.userId;
    const { entries, hasMore } = completionFeed(db.get(), {
      me,
      limit: req.query.limit,
      userId: req.query.user_id ? Number(req.query.user_id) : null,
      beforeAt: req.query.before_at || null,
      beforeId: req.query.before_id || null,
    });
    const last = entries[entries.length - 1];
    res.json({
      data: entries,
      has_more: hasMore,


      next_cursor: hasMore && last ? { before_at: last.completed_at, before_id: last.id } : null,
    });
  } catch (err) {
    log.error('GET /completions error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// GET /api/v1/tasks/tags → { data: [{ tag, count }] }





router.get('/tags', (req, res) => {
  try {
    res.json({ data: allTags(db.get(), req.authUserId || req.session.userId) });
  } catch (err) {
    log.error('GET /tags error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

function pushTagChanges(changed, what) {
  if (!changed.length) return;
  const rows = db.get().prepare(
    `SELECT * FROM tasks WHERE id IN (${changed.map(() => '?').join(',')})`
  ).all(...changed.map((c) => c.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  let pending = 0;
  for (const { id, before, after } of changed) {
    const row = byId.get(id);
    if (!row) continue;
    if (markTodoOutbound('tasks',
      { ...row, tags_key: tagsKey(before) },
      { ...row, tags_key: tagsKey(after) })) pending++;
  }
  if (pending) pushToCalDAV(what);
}

function visibleTaskIds(ids, me) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.get().prepare(`
    SELECT t.id AS id FROM tasks t
    WHERE t.id IN (${placeholders})
      AND ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}
  `).all(...ids, { me }).map((r) => r.id);
}




const MAX_BULK_TASKS = 500;

// POST /api/v1/tasks/tags/apply  Body: { ids, add?, remove? }




router.post('/tags/apply', (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length)
      return res.status(400).json({ error: 'ids must be a non-empty array of task IDs.', code: 400 });
    if (ids.length > MAX_BULK_TASKS)
      return res.status(400).json({ error: `At most ${MAX_BULK_TASKS} tasks at a time.`, code: 400 });

    const errors = v.collectErrors([validateTags(req.body.add), validateTags(req.body.remove)]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const add    = normalizeTags(req.body.add ?? []);
    const remove = normalizeTags(req.body.remove ?? []);
    if (!add.length && !remove.length)
      return res.status(400).json({ error: 'Nothing to add or remove.', code: 400 });

    const me = req.authUserId || req.session.userId;




    const targets = visibleTaskIds(ids, me);
    const allowed = editableTaskIds(targets, req);
    const changed = db.get().transaction(() =>
      applyTagChanges(db.get(), { taskIds: allowed, add, remove }))();

    res.json({ data: { updated: changed.length, skipped: targets.length - allowed.length, tags: allTags(db.get(), me) } });
    pushTagChanges(changed, 'Tag-Vergabe');
  } catch (err) {
    log.error('POST /tags/apply error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// PUT /api/v1/tasks/tags/:tag  Body: { name }



router.put('/tags/:tag', (req, res) => {
  try {



    // weiter oben.
    const [to] = normalizeTags([req.body.name ?? '']);
    if (!to) return res.status(400).json({ error: 'name must be a non-empty tag.', code: 400 });

    const me = req.authUserId || req.session.userId;
    if (!taskIdsWithTag(db.get(), req.params.tag, me).length)
      return res.status(404).json({ error: 'Tag not found.', code: 404 });




    // werden durfte.
    const affected = [...new Set([
      ...taskIdsWithTag(db.get(), req.params.tag, me),
      ...taskIdsWithTag(db.get(), to, me),
    ])];
    const allowed = editableTaskIds(affected, req);
    const changed = db.get().transaction(() =>
      renameTag(db.get(), { from: req.params.tag, to, me, ids: allowed }))();

    res.json({ data: { updated: changed.length, skipped: affected.length - allowed.length, tag: to, tags: allTags(db.get(), me) } });
    pushTagChanges(changed, 'Tag-Umbenennung');
  } catch (err) {
    log.error('PUT /tags/:tag error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// DELETE /api/v1/tasks/tags/:tag



router.delete('/tags/:tag', (req, res) => {
  try {
    const me = req.authUserId || req.session.userId;
    const affected = taskIdsWithTag(db.get(), req.params.tag, me);
    if (!affected.length)
      return res.status(404).json({ error: 'Tag not found.', code: 404 });


    const allowed = editableTaskIds(affected, req);
    const changed = db.get().transaction(() =>
      removeTagEverywhere(db.get(), { tag: req.params.tag, me, ids: allowed }))();

    res.json({ data: { updated: changed.length, skipped: affected.length - allowed.length, tags: allTags(db.get(), me) } });
    pushTagChanges(changed, 'Tag-Löschung');
  } catch (err) {
    log.error('DELETE /tags/:tag error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// POST /api/v1/tasks/categories  Body: { name } → { data: TaskCategory }
router.post('/categories', (req, res) => {
  try {
    const vName = v.str(req.body.name, 'Name', { max: v.MAX_SHORT });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const conflict = db.get().prepare(`
      SELECT key FROM task_categories WHERE COALESCE(name, key) = ? COLLATE NOCASE
    `).get(vName.value);
    if (conflict) return res.status(409).json({ error: 'Category already exists.', code: 409, reason: 'category_exists' });

    const maxOrder = db.get().prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM task_categories').get().m;
    const key = uniqueKey(db.get(), 'task_categories', vName.value);
    db.get().prepare(
      'INSERT INTO task_categories (key, name, label_key, sort_order) VALUES (?, ?, NULL, ?)'
    ).run(key, vName.value, maxOrder + 1);

    const cat = db.get().prepare('SELECT key, name, label_key, sort_order FROM task_categories WHERE key = ?').get(key);
    res.status(201).json({ data: cat });
  } catch (err) {
    log.error('POST /categories error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// PATCH /api/v1/tasks/categories/reorder  Body: { order: string[] }
router.patch('/categories/reorder', (req, res) => {
  try {
    const order = Array.isArray(req.body.order) ? req.body.order : [];
    const update = db.get().prepare('UPDATE task_categories SET sort_order = ? WHERE key = ?');
    db.get().transaction(() => order.forEach((key, i) => update.run(i, key)))();
    res.json({ data: loadTaskCategories() });
  } catch (err) {
    log.error('PATCH /categories/reorder error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// PUT /api/v1/tasks/categories/:key  Body: { name } → benennt um (Key bleibt stabil,

router.put('/categories/:key', (req, res) => {
  try {
    const cat = db.get().prepare('SELECT * FROM task_categories WHERE key = ?').get(req.params.key);
    if (!cat) return res.status(404).json({ error: 'Category not found.', code: 404 });

    const vName = v.str(req.body.name, 'Name', { max: v.MAX_SHORT });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const conflict = db.get().prepare(`
      SELECT key FROM task_categories WHERE COALESCE(name, key) = ? COLLATE NOCASE AND key != ?
    `).get(vName.value, cat.key);
    if (conflict) return res.status(409).json({ error: 'Category already exists.', code: 409, reason: 'category_exists' });

    db.get().prepare('UPDATE task_categories SET name = ?, label_key = NULL WHERE key = ?').run(vName.value, cat.key);
    const updated = db.get().prepare('SELECT key, name, label_key, sort_order FROM task_categories WHERE key = ?').get(cat.key);
    res.json({ data: updated });
  } catch (err) {
    log.error('PUT /categories/:key error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});


router.delete('/categories/:key', (req, res) => {
  try {
    const cat = db.get().prepare('SELECT * FROM task_categories WHERE key = ?').get(req.params.key);
    if (!cat) return res.status(404).json({ error: 'Category not found.', code: 404 });

    const inUse = taskCategoryInUseCount(cat.key);
    if (inUse > 0) {
      return res.status(409).json({ error: `Category is in use by ${inUse} task${inUse === 1 ? '' : 's'}.`, code: 409, count: inUse, reason: 'category_in_use' });
    }
    const total = db.get().prepare('SELECT COUNT(*) AS n FROM task_categories').get().n;
    if (total <= 1) return res.status(409).json({ error: 'Cannot delete the last category.', code: 409, reason: 'category_last' });

    db.get().prepare('DELETE FROM task_categories WHERE key = ?').run(cat.key);
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /categories/:key error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks
// Listet Top-Level-Aufgaben mit optionalen Filtern.
// Query-Parameter: status, priority, assigned_to, category, archived

// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const { status, priority, assigned_to, category, tag, include_future, archived } = req.query;

    let sql = `
      SELECT
        t.*,
        u.display_name AS assigned_name,
        u.avatar_color AS assigned_color,
        u.avatar_data AS assigned_avatar,
        ${ASSIGNED_USERS_SQL},



        -- sie mit. loadSubtasks() (Detailansicht) filtert seit jeher richtig -

        -- private Titel und bietet Aktionen darauf an.
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id
           AND ${visibilityWhere('s', 'task_assignments', 'task_id')})                         AS subtask_total,
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.status = 'done'
           AND ${visibilityWhere('s', 'task_assignments', 'task_id')})                         AS subtask_done,
        (SELECT json_group_array(json_object('id', s.id, 'title', s.title, 'status', s.status))
           FROM (SELECT s.id, s.title, s.status FROM tasks s WHERE s.parent_task_id = t.id
                   AND ${visibilityWhere('s', 'task_assignments', 'task_id')}
                 ORDER BY s.created_at ASC) s) AS subtasks
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE ${taskScopeWhere('t', { includeFuture: !!include_future })}
    `;
    const params = [];



    // SELECT-Klausel bindet ihre sechs `me` erst am Ende per unshift davor.
    if (taskScopeNeedsToday({ includeFuture: !!include_future })) params.push(toLocalDateKey());








    const asList = (v) => (v === undefined ? [] : [v].flat().filter((x) => x !== ''));










    //                      Schnitt aus beidem.
    const rawStatuses  = asList(status);
    const statuses     = rawStatuses.filter((s) => s !== ARCHIVE_STATUS);
    const statusArchiv = rawStatuses.includes(ARCHIVE_STATUS);
    const archiveQuery = archived === 'only' ? 'only'
      : (archived === '1' || archived === 'true' ? 'include' : null);

    if (statuses.length && statusArchiv) {
      sql += ` AND (t.status IN (${statuses.map(() => '?').join(', ')}) OR t.archived_at IS NOT NULL)`;
      params.push(...statuses);
    } else {
      if (statuses.length) {
        sql += ` AND t.status IN (${statuses.map(() => '?').join(', ')})`;
        params.push(...statuses);
      }
      if (statusArchiv || archiveQuery === 'only') sql += ' AND t.archived_at IS NOT NULL';
      else if (!archiveQuery)                      sql += ' AND t.archived_at IS NULL';
    }

    const priorities = asList(priority);
    if (priorities.length) {
      sql += ` AND t.priority IN (${priorities.map(() => '?').join(', ')})`;
      params.push(...priorities);
    }

    const assignees = asList(assigned_to).map(Number).filter(Number.isInteger);
    if (assignees.length) {
      sql += ` AND EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = t.id
                             AND ta.user_id IN (${assignees.map(() => '?').join(', ')}))`;
      params.push(...assignees);
    }





    const categories = normalizeCategoryFilter(category);
    const categoryFragment = taskCategoryWhere('t', categories);
    if (categoryFragment) { sql += ` AND ${categoryFragment}`; params.push(...categories); }


    //







    // nach ihm garantiert leer ausging.
    const tagFilters = normalizeTags(tag === undefined ? [] : [tag].flat());
    for (const value of tagFilters) {
      sql += ' AND EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id AND tt.tag_key = ?)';
      params.push(tagKey(value));
    }


    const me = req.authUserId || req.session.userId;
    sql += ` AND ${visibilityWhere('t', 'task_assignments', 'task_id')}`;
    params.push(me, me);






    params.unshift(me, me, me, me, me, me);

    sql += `
      ORDER BY
        CASE t.status WHEN 'done' THEN 1 ELSE 0 END,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        t.due_date ASC NULLS LAST,
        t.created_at DESC
    `;

    const rows = db.get().prepare(sql).all(...params).map(task => ({ ...task, subtasks: JSON.parse(task.subtasks || '[]') })).map(addAssignedUsers);
    res.json({ data: attachTags(attachDocumentCounts(rows, me)) });
  } catch (err) {
    log.error('GET / error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks/:id
// Einzelne Aufgabe mit Subtasks.
// Response: { data: Task & { subtasks: Task[] } }
// --------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const me = req.authUserId || req.session.userId;
    const task = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color,
        u.avatar_data AS assigned_avatar, ${ASSIGNED_USERS_SQL}
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.id = ? AND t.parent_task_id IS NULL
        AND ${visibilityWhere('t', 'task_assignments', 'task_id')}
    `).get(req.params.id, me, me);

    if (!task) return res.status(404).json({ error: 'Task not found.', code: 404 });

    addAssignedUsers(task);
    task.subtasks = loadSubtasks(task.id, me);
    attachDocumentCounts([task], me);






    task.documents = loadTaskDocuments(task.id, me);
    attachTags([task]);
    res.json({ data: task });
  } catch (err) {
    log.error('GET /:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/tasks
// Neue Aufgabe erstellen.
// Body: { title, description?, category?, tags?, priority?, due_date?, due_time?,
//         assigned_to?, parent_task_id? }
// Response: { data: Task }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const errors = validateTaskInput(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const {
      title,
      description     = null,
      category        = FALLBACK_CATEGORY,
      priority        = 'none',
      start_date      = null,
      due_date        = null,
      due_time        = null,
      parent_task_id  = null,
      is_recurring    = 0,
      recurrence_rule = null,
      recurrence_from_completion = 0,
      countdown       = 0,
    } = req.body;



    const points = req.body.points === undefined && !parent_task_id
      ? defaultTaskPoints()
      : clampPoints(req.body.points);
    const visibility = normalizeVisibility(req.body.visibility);



    // mitgeschickter Status schon immer, geschrieben nie - er fiel still weg.

    // Schritte.
    //




    // was abzulegen waere.
    //
    // `!req.body.status` statt `=== undefined`: `v.oneOf` laesst `null` und `''`




    const status = (!req.body.status || req.body.status === ARCHIVE_STATUS)
      ? 'open'
      : req.body.status;








    // eine leere Serie waere unsichtbar. Dieselbe Regel, zwei Bedeutungen.
    //





    const userIds  = parseAssignedTo(req.body.assigned_to);
    const firstUid = userIds[0] ?? null;






    let syncTarget = null;
    if (req.body.sync_target !== undefined && !parent_task_id) {
      const resolved = resolveTaskSyncTarget(req.body.sync_target);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error, code: 400 });
      syncTarget = resolved.target;
    }


    if (parent_task_id) {
      const parent = db.get().prepare('SELECT id, parent_task_id, locked, created_by FROM tasks WHERE id = ?')
        .get(parent_task_id);
      if (!parent) return res.status(404).json({ error: 'Parent task not found.', code: 404 });
      if (parent.parent_task_id)
        return res.status(400).json({ error: 'Maximal 2 Verschachtelungsebenen erlaubt.', code: 400 });


      if (!mayEditTaskDefinition(parent, req)) return res.status(403).json(LOCKED_ERROR);
    }

    const taskId = db.get().transaction(() => {
      const result = db.get().prepare(`
        INSERT INTO tasks
          (title, description, category, priority, status, start_date, due_date, due_time,
           assigned_to, created_by, parent_task_id, is_recurring, recurrence_rule,
           recurrence_from_completion, points, visibility, countdown, locked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        title.trim(), description, category, priority, status,
        start_date, due_date, due_time, firstUid, req.authUserId || req.session.userId, parent_task_id,
        is_recurring ? 1 : 0, recurrence_rule, recurrence_from_completion ? 1 : 0, points, visibility,
        countdown ? 1 : 0, req.body.locked ? 1 : 0
      );
      setAssignments(db.get(), result.lastInsertRowid, userIds);
      if (req.body.tags !== undefined) setTags(db.get(), result.lastInsertRowid, req.body.tags);
      if (syncTarget) {
        db.get().prepare(
          'UPDATE tasks SET target_caldav_account_id = ?, target_caldav_list_url = ? WHERE id = ?'
        ).run(syncTarget.accountId, syncTarget.listUrl, result.lastInsertRowid);
      }



      // gefuellt, haetten Punktekonto und Verlauf zwei Buchhaltungen: dieselbe
      // erledigte Aufgabe zaehlte, je nachdem ob sie erledigt angelegt oder
      // erledigt abgehakt wurde.
      //


      if (status !== 'open') {
        const actingUserId = req.authUserId || req.session.userId;
        const newId = Number(result.lastInsertRowid);
        syncTaskRewards(db.get(), newId, 'open', status, actingUserId);
        syncTaskCompletion(db.get(), newId, 'open', status, actingUserId);


        // entsteht.
        if (status === 'done') {
          spawnRecurrenceFollowup(db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(newId));
        }
      }
      return result.lastInsertRowid;
    })();

    const task = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color,
        u.avatar_data AS assigned_avatar, ${ASSIGNED_USERS_SQL}
      FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.id = ?
    `).get(taskId);

    addAssignedUsers(task);
    attachTags([task]);
    res.status(201).json({ data: task });
    if (syncTarget) pushToCalDAV('Neue Aufgabe');
  } catch (err) {
    log.error('POST / error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/tasks/:id

// Body: { title, description?, category?, tags?, priority?, status?,
//         due_date?, due_time?, assigned_to? }
// Response: { data: Task }
// tags fehlt → bleiben unangetastet; tags: [] → alle entfernt.
// --------------------------------------------------------
router.put('/:id', (req, res) => {
  try {
    const task = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.', code: 404 });

    if (!mayAccessTask(task, req.authUserId || req.session.userId)) {
      return res.status(404).json({ error: 'Task not found.', code: 404 });
    }

    const errors = validateTaskInput(req.body, false, task.recurrence_rule);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const {
      title           = task.title,
      description     = task.description,
      category        = task.category,
      priority        = task.priority,
      start_date      = task.start_date,
      due_date        = task.due_date,
      due_time        = task.due_time,
      is_recurring    = task.is_recurring,
      recurrence_rule = task.recurrence_rule,
      recurrence_from_completion = task.recurrence_from_completion,



      countdown       = task.countdown,
    } = req.body;

    const points = req.body.points !== undefined ? clampPoints(req.body.points) : task.points;
    const visibility = req.body.visibility !== undefined
      ? normalizeVisibility(req.body.visibility, task.visibility)
      : task.visibility;



    const archiveRequested = req.body.status === ARCHIVE_STATUS;
    const status = (req.body.status === undefined || archiveRequested)
      ? task.status
      : req.body.status;
    if (reopensSettledVisit(db.get(), task.id, task.status, status) && req.authRole !== 'admin') {
      return res.status(403).json({ error: 'Permission denied.', code: 403 });
    }

    const assignedBefore = db.get().prepare('SELECT user_id FROM task_assignments WHERE task_id = ?')
      .all(task.id).map((r) => r.user_id);
    const userIds  = req.body.assigned_to !== undefined
      ? parseAssignedTo(req.body.assigned_to)
      : assignedBefore;
    const firstUid = userIds[0] ?? null;


    const lockedRequested = req.body.locked !== undefined ? (req.body.locked ? 1 : 0) : null;
    const locked = lockedRequested ?? task.locked;



    const tagsBefore = loadTags(db.get(), task.id);






    let syncTarget;
    const targetEditable = task.external_source !== 'caldav';
    if (req.body.sync_target !== undefined && targetEditable && !task.parent_task_id) {
      const resolved = resolveTaskSyncTarget(req.body.sync_target);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error, code: 400 });
      syncTarget = resolved.target;
    }


    //


    // Aufgabe zurueck, und "Feld mitgeschickt = Aenderungsversuch" wuerde


    if (!mayEditTaskDefinition(task, req)) {
      const wanted = {
        title: title.trim(), description, category, priority,
        start_date, due_date, due_time,
        is_recurring: is_recurring ? 1 : 0, recurrence_rule,
        recurrence_from_completion: recurrence_from_completion ? 1 : 0,
        countdown: countdown ? 1 : 0, points, visibility,
      };
      let touchesDefinition = Object.keys(wanted).some((k) => !sameFieldValue(wanted[k], task[k]));

      if (req.body.tags !== undefined
          && tagsKey(normalizeTags(req.body.tags)) !== tagsKey(tagsBefore)) touchesDefinition = true;

      if (syncTarget !== undefined
          && (!sameFieldValue(syncTarget?.accountId ?? null, task.target_caldav_account_id)
           || !sameFieldValue(syncTarget?.listUrl   ?? null, task.target_caldav_list_url))) touchesDefinition = true;


      // Aenderung an ihr, kein Umgang mit ihr.
      if (archiveRequested && !task.archived_at) touchesDefinition = true;


      // wuerde, der sie umgehen will.
      if (lockedRequested !== null && lockedRequested !== task.locked) touchesDefinition = true;





      const me = req.authUserId || req.session.userId;
      const othersBefore = assignedBefore.filter((id) => id !== me);
      const othersAfter  = userIds.filter((id) => id !== me);
      if (othersBefore.length !== othersAfter.length
          || othersBefore.some((id) => !othersAfter.includes(id))) touchesDefinition = true;

      if (touchesDefinition) return res.status(403).json(LOCKED_ERROR);
    }




    let pending = false;
    let undone  = 0;
    let updated;
    db.get().transaction(() => {
      db.get().prepare(`
        UPDATE tasks SET
          title = ?, description = ?, category = ?, priority = ?,
          status = ?, start_date = ?, due_date = ?, due_time = ?, assigned_to = ?,
          is_recurring = ?, recurrence_rule = ?, recurrence_from_completion = ?,
          points = ?, visibility = ?, countdown = ?, locked = ?
        WHERE id = ?
      `).run(title.trim(), description, category, priority,
             status, start_date, due_date, due_time, firstUid,
             is_recurring ? 1 : 0, recurrence_rule, recurrence_from_completion ? 1 : 0,
             points, visibility, countdown ? 1 : 0, locked, req.params.id);
      setAssignments(db.get(), task.id, userIds);
      if (req.body.tags !== undefined) setTags(db.get(), task.id, req.body.tags);
      if (syncTarget !== undefined) {
        db.get().prepare(
          'UPDATE tasks SET target_caldav_account_id = ?, target_caldav_list_url = ? WHERE id = ?'
        ).run(syncTarget?.accountId ?? null, syncTarget?.listUrl ?? null, task.id);
      }
      if (archiveRequested && !task.archived_at) setArchived(task.id, true);
      syncHousekeepingPaymentStatus(db.get(), req.params.id, status);

      syncTaskRewards(db.get(), task.id, task.status, status, req.authUserId || req.session.userId);




      syncTaskCompletion(db.get(), task.id, task.status, status, req.authUserId || req.session.userId);



      // Checkbox (#650).
      if (task.status === 'done' && status !== 'done') {
        undone = discardRecurrenceFollowup(task.id);
      }





      updated = db.get().prepare(`
        SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color,
          u.avatar_data AS assigned_avatar, ${ASSIGNED_USERS_SQL}
        FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
        WHERE t.id = ?
      `).get(req.params.id);
      attachTags([updated]);




      pending = markTodoOutbound(
        'tasks',
        { ...task,    tags_key: tagsKey(tagsBefore) },
        { ...updated, tags_key: tagsKey(updated.tags) },
      );




      if (status === 'done' && task.status !== 'done') spawnRecurrenceFollowup(updated);
    })();

    addAssignedUsers(updated);
    updated.subtasks = loadSubtasks(updated.id, req.authUserId || req.session.userId);

    res.json({ data: updated });

    if (pending || undone || syncTarget) pushToCalDAV('Änderung');
  } catch (err) {
    log.error('PUT /:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

function recurrenceFollowupOf(taskId) {
  return db.get().prepare(
    `SELECT * FROM tasks
      WHERE recurrence_origin_id = ? AND parent_task_id IS NULL
      ORDER BY id LIMIT 1`
  ).get(taskId) ?? null;
}

function isFollowupSubtasksTouched(followup) {
  const originTaskId = followup.recurrence_origin_id;
  const originSubtasks = originTaskId
    ? db.get().prepare('SELECT * FROM tasks WHERE parent_task_id = ?').all(originTaskId)
    : [];
  const currentSubtasks = db.get()
    .prepare('SELECT * FROM tasks WHERE parent_task_id = ?')
    .all(followup.id);

  if (currentSubtasks.length !== originSubtasks.length) return true;

  const originDueDate = originTaskId
    ? db.get().prepare('SELECT due_date FROM tasks WHERE id = ?').get(originTaskId)?.due_date
    : null;

  for (const sub of currentSubtasks) {
    if (sub.status !== 'open' || !sub.recurrence_origin_id) return true;
    const origin = originSubtasks.find((o) => o.id === sub.recurrence_origin_id);
    if (!origin) return true;

    if (
      sub.title !== origin.title ||
      (sub.description || '') !== (origin.description || '') ||
      sub.category !== origin.category ||
      sub.priority !== origin.priority ||
      sub.assigned_to !== origin.assigned_to ||
      sub.points !== origin.points ||
      sub.visibility !== origin.visibility ||
      sub.due_time !== origin.due_time
    ) {
      return true;
    }

    const subAnchorDate = originDueDate || origin.due_date;
    const expectedStart = shiftedStartDate(origin.start_date, subAnchorDate, followup.due_date) ?? origin.start_date;
    const expectedDue = origin.due_date
      ? (shiftedStartDate(origin.due_date, subAnchorDate, followup.due_date) ?? followup.due_date)
      : null;

    if (sub.start_date !== expectedStart || sub.due_date !== expectedDue) {
      return true;
    }
  }

  return false;
}

function discardRecurrenceFollowup(taskId) {
  const followup = recurrenceFollowupOf(taskId);
  if (!followup || followup.status !== 'open') return 0;

  if (isFollowupSubtasksTouched(followup) || recurrenceFollowupOf(followup.id)) return 0;



  const queued = queueTodoDeletion('tasks', followup) ? 1 : 0;
  db.get().prepare('DELETE FROM tasks WHERE id = ?').run(followup.id);
  return queued;
}

function shiftedStartDate(startDate, dueDate, nextDue) {
  if (!startDate || !dueDate) return null;
  const lead = Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(lead)) return null;
  return new Date(Date.parse(`${nextDue}T00:00:00Z`) - lead).toISOString().slice(0, 10);
}

function spawnRecurrenceFollowup(task) {
  if (!task?.is_recurring || !task.recurrence_rule || task.parent_task_id) return;

  if (recurrenceFollowupOf(task.id)) return;




  const completedOn = todayInHouseholdZone();
  const nextDate = nextDueAfterCompletion({
    anchorDate: task.due_date,
    rule: task.recurrence_rule,
    completedOn,
    fromCompletion: !!task.recurrence_from_completion,
  });
  if (!nextDate) return;

  const existingAssignments = db.get()
    .prepare('SELECT user_id FROM task_assignments WHERE task_id = ?')
    .all(task.id).map((r) => r.user_id);




  const existingTags = loadTags(db.get(), task.id);


  const existingSubtasks = db.get()
    .prepare('SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY id ASC')
    .all(task.id);

  db.get().transaction(() => {
    const newTask = db.get().prepare(`
      INSERT INTO tasks (title, description, category, priority, status,
        start_date, due_date, due_time, assigned_to, created_by, is_recurring, recurrence_rule,
        points, visibility, recurrence_from_completion, countdown, recurrence_origin_id)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      task.title, task.description, task.category, task.priority,
      shiftedStartDate(task.start_date, task.due_date, nextDate),
      nextDate, task.due_time, task.assigned_to, task.created_by,
      task.recurrence_rule, task.points, task.visibility,



      task.recurrence_from_completion ? 1 : 0,





      task.countdown ? 1 : 0,
      task.id
    );
    setAssignments(db.get(), newTask.lastInsertRowid, existingAssignments);
    setTags(db.get(), newTask.lastInsertRowid, existingTags);

    for (const sub of existingSubtasks) {
      const subAssignments = db.get()
        .prepare('SELECT user_id FROM task_assignments WHERE task_id = ?')
        .all(sub.id).map((r) => r.user_id);
      const subTags = loadTags(db.get(), sub.id);

      const subAnchorDate = task.due_date || sub.due_date;

      const newSub = db.get().prepare(`
        INSERT INTO tasks (title, description, category, priority, status,
          start_date, due_date, due_time, assigned_to, created_by, parent_task_id,
          is_recurring, recurrence_rule, points, visibility, recurrence_origin_id)
        VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
      `).run(
        sub.title, sub.description, sub.category, sub.priority,
        shiftedStartDate(sub.start_date, subAnchorDate, nextDate) ?? sub.start_date,
        sub.due_date ? (shiftedStartDate(sub.due_date, subAnchorDate, nextDate) ?? nextDate) : null,
        sub.due_time, sub.assigned_to, sub.created_by, newTask.lastInsertRowid,
        sub.points, sub.visibility, sub.id
      );
      setAssignments(db.get(), newSub.lastInsertRowid, subAssignments);
      setTags(db.get(), newSub.lastInsertRowid, subTags);
    }
  })();
}

// --------------------------------------------------------
// PATCH /api/v1/tasks/:id/status
// Status einer Aufgabe schnell wechseln (z.B. Swipe-Geste / Checkbox).
// Body: { status: 'open' | 'in_progress' | 'done' | 'archived' }
// Response: { data: { id, status, archived_at } }

// --------------------------------------------------------
router.patch('/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status))
      return res.status(400).json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`, code: 400 });



    const prev = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!prev)
      return res.status(404).json({ error: 'Task not found.', code: 404 });

    // Ablegen ist kein Statuswechsel: kein Punkte-Storno, keine Serien-Bewegung,


    if (status === ARCHIVE_STATUS) {
      const archivedAt = setArchived(req.params.id, true);
      return res.json({ data: { id: Number(req.params.id), status: prev.status, archived_at: archivedAt } });
    }

    if (reopensSettledVisit(db.get(), prev.id, prev.status, status) && req.authRole !== 'admin') {
      return res.status(403).json({ error: 'Permission denied.', code: 403 });
    }







    let pending = false;
    let undone  = 0;
    db.get().transaction(() => {
      db.get().prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, req.params.id);
      pending = markTodoOutbound('tasks', prev, { ...prev, status });

      syncHousekeepingPaymentStatus(db.get(), req.params.id, status);
      // Punkte-Gutschrift/Storno an den Aufgaben-Statuswechsel koppeln.
      syncTaskRewards(db.get(), Number(req.params.id), prev.status, status, req.authUserId || req.session.userId);


      syncTaskCompletion(db.get(), Number(req.params.id), prev.status, status, req.authUserId || req.session.userId);




      if (prev.status === 'done' && status !== 'done') {
        undone = discardRecurrenceFollowup(Number(req.params.id));
      }


      if (status === 'done' && prev.status !== 'done') {
        spawnRecurrenceFollowup(db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
      }
    })();

    res.json({ data: { id: Number(req.params.id), status, archived_at: prev.archived_at } });

    if (pending || undone) pushToCalDAV('Statuswechsel');
  } catch (err) {
    log.error('PATCH /:id/status error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/tasks/:id/archive


// Response: { data: { id, status, archived_at } }
// --------------------------------------------------------
router.patch('/:id/archive', (req, res) => {
  try {


    const task = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.', code: 404 });


    // fremde private Aufgabe abzulegen (Muster aus #769).
    if (!mayAccessTask(task, req.authUserId || req.session.userId)) {
      return res.status(404).json({ error: 'Task not found.', code: 404 });
    }

    if (!mayEditTaskDefinition(task, req)) return res.status(403).json(LOCKED_ERROR);

    if (req.body.archived !== undefined && typeof req.body.archived !== 'boolean')
      return res.status(400).json({ error: 'archived must be a boolean.', code: 400 });


    // genau dort, wo sie beim Ablegen stand.
    const archivedAt = setArchived(task.id, req.body.archived !== false);
    res.json({ data: { id: task.id, status: task.status, archived_at: archivedAt } });
  } catch (err) {
    log.error('PATCH /:id/archive error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.patch('/:id/check', (req, res) => {
  try {
    const id   = parseInt(req.params.id, 10);
    const task = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) return res.status(404).json({ error: 'Task not found.', code: 404 });

    if (!mayAccessTask(task, req.authUserId || req.session.userId)) {
      return res.status(404).json({ error: 'Task not found.', code: 404 });
    }

    const { line, checked, expect } = req.body;
    if (!Number.isInteger(line) || line < 0)
      return res.status(400).json({ error: 'Invalid line number.', code: 400 });
    if (typeof checked !== 'boolean')
      return res.status(400).json({ error: 'Invalid state.', code: 400 });
    if (expect !== undefined && expect !== null && typeof expect !== 'string')
      return res.status(400).json({ error: 'Invalid line check.', code: 400 });

    const result = toggleChecklistLine(task.description, line, checked, expect);
    if (!result.ok) {
      return res.status(409).json({
        error: 'The task has changed in the meantime.',
        code:  409,
        reason: result.reason,
      });
    }




    let pending = false;
    if (result.changed) {
      db.get().transaction(() => {
        db.get().prepare('UPDATE tasks SET description = ? WHERE id = ?').run(result.content, id);



        pending = markTodoOutbound('tasks', task, { ...task, description: result.content });
      })();
    }

    res.json({ data: { id, description: result.content } });

    if (pending) pushToCalDAV('Checklisten-Haken');
  } catch (err) {
    log.error('PATCH /:id/check error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/tasks/:id

// Response: { ok: true }
// --------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {



    // keiner Liste, aber der Fall kostet nichts.
    const victim = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!victim) return res.status(404).json({ error: 'Task not found.', code: 404 });

    if (!mayAccessTask(victim, req.authUserId || req.session.userId)) {
      return res.status(404).json({ error: 'Task not found.', code: 404 });
    }

    if (!mayEditTaskDefinition(victim, req)) return res.status(403).json(LOCKED_ERROR);

    const doomed = db.get().prepare(
      `SELECT * FROM tasks WHERE (id = ? OR parent_task_id = ?) AND external_source = 'caldav'`
    ).all(req.params.id, req.params.id);
    const queued = doomed.reduce((n, row) => n + (queueTodoDeletion('tasks', row) ? 1 : 0), 0);

    const result = db.get().prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Task not found.', code: 404 });
    res.json({ ok: true });

    if (queued) pushToCalDAV('Löschung');
  } catch (err) {
    log.error('DELETE /:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------




// expliziten Freigabe-Eintrag (family_document_access).
// --------------------------------------------------------


const DOC_VISIBLE_SQL = documentVisibleSql('d', 'me');

function findVisibleTask(id, me) {
  return db.get().prepare(`
    SELECT t.id, t.locked, t.created_by, t.parent_task_id FROM tasks t
    WHERE t.id = ? AND ${visibilityWhere('t', 'task_assignments', 'task_id')}
  `).get(id, me, me);
}

function loadTaskDocuments(taskId, me) {
  return db.get().prepare(`
    SELECT d.id, d.name, d.category, d.original_name, d.mime_type, d.file_size,
           d.storage_backend, td.created_at AS linked_at
    FROM task_documents td
    JOIN family_documents d ON d.id = td.document_id
    WHERE td.task_id = @taskId AND d.status != 'archived' AND ${DOC_VISIBLE_SQL}
    ORDER BY d.name COLLATE NOCASE ASC
  `).all({ taskId, me });
}

// --------------------------------------------------------
// GET /api/v1/tasks/:id/completions


// Query: limit? (1..100, Default 20)
// Response: { data: [Eintrag] }
//



// --------------------------------------------------------
router.get('/:id/completions', (req, res) => {
  try {
    const me = req.authUserId || req.session.userId;
    const task = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task || !mayAccessTask(task, me)) {
      return res.status(404).json({ error: 'Task not found.', code: 404 });
    }
    res.json({ data: seriesHistory(db.get(), { me, taskId: Number(req.params.id), limit: req.query.limit }) });
  } catch (err) {
    log.error('GET /:id/completions error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// GET /api/v1/tasks/:id/documents → { data: LinkedDocument[] }
router.get('/:id/documents', (req, res) => {
  try {
    const me = req.authUserId || req.session.userId;
    const task = findVisibleTask(req.params.id, me);
    if (!task) return res.status(404).json({ error: 'Task not found.', code: 404 });
    res.json({ data: loadTaskDocuments(task.id, me) });
  } catch (err) {
    log.error('GET /:id/documents error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// PUT /api/v1/tasks/:id/documents  Body: { document_ids: number[] }



router.put('/:id/documents', (req, res) => {
  try {
    const me = req.authUserId || req.session.userId;
    const task = findVisibleTask(req.params.id, me);
    if (!task) return res.status(404).json({ error: 'Task not found.', code: 404 });


    if (!mayEditTaskDefinition(task, req)) return res.status(403).json(LOCKED_ERROR);

    const requested = Array.isArray(req.body.document_ids)
      ? [...new Set(req.body.document_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      : [];

    const canSee = db.get().prepare(`SELECT 1 FROM family_documents d WHERE d.id = @id AND ${DOC_VISIBLE_SQL}`);
    const visibleIds = requested.filter((id) => canSee.get({ id, me }));
    assertDocumentsNotDeleting(visibleIds);

    db.get().transaction(() => {

      db.get().prepare(`
        DELETE FROM task_documents
        WHERE task_id = @taskId AND document_id IN (
          SELECT d.id FROM family_documents d WHERE ${DOC_VISIBLE_SQL}
        )
      `).run({ taskId: task.id, me });
      const ins = db.get().prepare(
        'INSERT OR IGNORE INTO task_documents (task_id, document_id, created_by) VALUES (?, ?, ?)'
      );
      for (const id of visibleIds) ins.run(task.id, id, me);
    })();

    res.json({ data: loadTaskDocuments(task.id, me) });
  } catch (err) {
    if (sendDocumentDeletionConflict(res, err)) return;
    log.error('PUT /:id/documents error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// Kommentare an Aufgaben (#734)
//




//



// --------------------------------------------------------

function loadTaskComments(taskId) {
  return db.get().prepare(`
    SELECT c.id, c.task_id, c.user_id, c.comment, c.created_at, c.updated_at,
           u.display_name AS author_name, u.avatar_color AS author_color
    FROM task_comments c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ?
    ORDER BY c.id ASC
  `).all(taskId);
}

function notifyMentions(task, comment, authorId, previousComment = '') {





  const users = db.get().prepare(`
    SELECT id, display_name FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM housekeeping_workers hw WHERE hw.user_id = u.id)
  `).all();


  // dieselbe Meldung noch einmal.
  const schon = previousComment ? mentionedUserIds(previousComment, users) : [];
  const ids = mentionedUserIds(comment, users)
    .filter((id) => id !== authorId && !schon.includes(id));
  if (!ids.length) return;

  const author = users.find((u) => u.id === authorId)?.display_name || '';
  for (const id of ids) {
    if (!findVisibleTask(task.id, id)) continue;




    const target = db.get().prepare('SELECT id, role, family_role FROM users WHERE id = ?').get(id);
    if (!target) continue;
    const perms = resolvePermissions(db.get(), target);
    if (!perms.admin && perms.modules?.tasks === 'none') continue;
    pushService.sendPushToUser(id, {
      title: task.title,
      body: `${author}: ${comment}`.slice(0, 300),
      url: `/tasks?open=${task.id}`,
      tag: `task-comment-${task.id}`,
    }).catch((err) => log.warn('Erwähnungs-Push fehlgeschlagen:', err?.message || err));
  }
}

function commentForWrite(req, { allowAdmin = false } = {}) {
  const me = req.authUserId || req.session.userId;
  const found = findVisibleTask(req.params.id, me);
  if (!found) return { error: 404 };


  const task = db.get().prepare('SELECT id, title FROM tasks WHERE id = ?').get(found.id);

  const row = db.get().prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ?')
    .get(req.params.commentId, task.id);
  if (!row) return { error: 404 };

  const mayWrite = row.user_id === me || (allowAdmin && req.authRole === 'admin');
  if (!mayWrite) return { error: 403 };
  return { task, row, me };
}

// GET /api/v1/tasks/:id/comments → { data: Comment[] }
router.get('/:id/comments', (req, res) => {
  try {
    const me = req.authUserId || req.session.userId;
    const task = findVisibleTask(req.params.id, me);
    if (!task) return res.status(404).json({ error: 'Task not found.', code: 404 });
    res.json({ data: loadTaskComments(task.id) });
  } catch (err) {
    log.error('GET /:id/comments error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// POST /api/v1/tasks/:id/comments  Body: { comment }
router.post('/:id/comments', (req, res) => {
  try {
    const me = req.authUserId || req.session.userId;
    const task = db.get().prepare(`
      SELECT t.id, t.title FROM tasks t
      WHERE t.id = ? AND ${visibilityWhere('t', 'task_assignments', 'task_id')}
    `).get(req.params.id, me, me);
    if (!task) return res.status(404).json({ error: 'Task not found.', code: 404 });


    const comment = v.str(req.body.comment, 'comment', { max: v.MAX_TEXT, required: true });
    if (comment.error) return res.status(400).json({ error: comment.error, code: 400 });

    const result = db.get().prepare(
      'INSERT INTO task_comments (task_id, user_id, comment) VALUES (?, ?, ?)'
    ).run(task.id, me, comment.value);

    const row = db.get().prepare(`
      SELECT c.id, c.task_id, c.user_id, c.comment, c.created_at, c.updated_at,
             u.display_name AS author_name, u.avatar_color AS author_color
      FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ data: row });
    notifyMentions(task, row.comment, me);
  } catch (err) {
    log.error('POST /:id/comments error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// PATCH /api/v1/tasks/:id/comments/:commentId  Body: { comment }
router.patch('/:id/comments/:commentId', (req, res) => {
  try {
    const found = commentForWrite(req);
    if (found.error) {
      return res.status(found.error).json({
        error: found.error === 403 ? 'Not authorized.' : 'Comment not found.', code: found.error,
      });
    }

    const comment = v.str(req.body.comment, 'comment', { max: v.MAX_TEXT, required: true });
    if (comment.error) return res.status(400).json({ error: comment.error, code: 400 });

    db.get().prepare(`
      UPDATE task_comments
         SET comment = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?
    `).run(comment.value, found.row.id);

    const row = db.get().prepare(`
      SELECT c.id, c.task_id, c.user_id, c.comment, c.created_at, c.updated_at,
             u.display_name AS author_name, u.avatar_color AS author_color
      FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?
    `).get(found.row.id);
    res.json({ data: row });


    // erfuehre davon.
    notifyMentions(found.task, row.comment, found.me, found.row.comment);
  } catch (err) {
    log.error('PATCH /:id/comments/:commentId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// DELETE /api/v1/tasks/:id/comments/:commentId
router.delete('/:id/comments/:commentId', (req, res) => {
  try {
    const found = commentForWrite(req, { allowAdmin: true });
    if (found.error) {
      return res.status(found.error).json({
        error: found.error === 403 ? 'Not authorized.' : 'Comment not found.', code: found.error,
      });
    }
    db.get().prepare('DELETE FROM task_comments WHERE id = ?').run(found.row.id);
    res.json({ data: { id: found.row.id } });
  } catch (err) {
    log.error('DELETE /:id/comments/:commentId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks/meta/options

// Response: { users, priorities, statuses, categories, tags }
// --------------------------------------------------------
router.get('/meta/options', (req, res) => {
  try {
    const users = db.get().prepare(
      `SELECT id, display_name, avatar_color FROM users u
       WHERE NOT EXISTS (SELECT 1 FROM housekeeping_workers hw WHERE hw.user_id = u.id)
       ORDER BY display_name`
    ).all();
    res.json({
      users,
      priorities: VALID_PRIORITIES,
      statuses: VALID_STATUSES,
      categories: loadTaskCategories(),


      tags: allTags(db.get(), req.authUserId || req.session.userId),
      default_points: defaultTaskPoints(),
    });
  } catch (err) {
    log.error('GET /meta/options error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// Standard-Punkte nachziehen (#578)

// --------------------------------------------------------

// GET /api/v1/tasks/points/affected?points=N



router.get('/points/affected', (req, res) => {
  try {
    if (req.authRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.', code: 403 });
    }
    const points = Number(req.query.points);
    if (!Number.isInteger(points) || points < 0 || points > MAX_POINTS) {
      return res.status(400).json({ error: `points must be an integer between 0 and ${MAX_POINTS}`, code: 400 });
    }
    res.json({ data: { count: countRebasableTasks(points) } });
  } catch (err) {
    log.error('GET /points/affected error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// POST /api/v1/tasks/points/rebase  Body: { from, to } → { data: { updated } }





router.post('/points/rebase', (req, res) => {
  try {
    if (req.authRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.', code: 403 });
    }
    const from = Number(req.body.from);
    const to   = Number(req.body.to);
    const inRange = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_POINTS;
    if (!inRange(from) || !inRange(to)) {
      return res.status(400).json({ error: `from and to must be integers between 0 and ${MAX_POINTS}`, code: 400 });
    }


    if (from === 0) {
      return res.status(400).json({ error: 'from must be greater than 0.', code: 400 });
    }
    if (from === to) return res.json({ data: { updated: 0 } });

    const result = db.get().prepare(`
      UPDATE tasks SET points = ?
      WHERE points = ? AND parent_task_id IS NULL AND status != ?
    `).run(to, from, REBASE_EXCLUDED_STATUS);

    res.json({ data: { updated: result.changes } });
  } catch (err) {
    log.error('POST /points/rebase error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
