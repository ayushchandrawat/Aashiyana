
import { createLogger } from '../logger.js';
import express from 'express';
import { hydrateNotesWithCategories } from '../services/note-categories.js';
import * as db from '../db.js';
import { hydrateBirthdayOccurrences } from '../services/birthdays.js';
import { getUpcomingEvents } from '../services/calendar-event-reader.js';
import { taskScopeWhere, taskCategoryWhere, categoryBindings, normalizeCategoryFilter } from '../services/task-scope.js';
import { getCountdowns } from '../services/countdowns.js';
import { listQuickLinksFor } from './quick-links.js';
import { visibilityWhere } from '../services/visibility.js';
import { resolveBudgetMode } from '../services/budget-visibility.js';
import { hiddenModulesFor } from '../permissions.js';
import { householdTimeZone, utcToWall } from '../utils/timezone.js';
import { isAdminUser, serializeEvents } from './calendar/helpers.js';

const log = createLogger('Dashboard');

const DENIED_PAYLOAD = Object.freeze({


  calendar: () => ({ upcomingEvents: [], birthdays: [], birthdayCount: 0, birthdaySoonCount: 0 }),
  tasks: () => ({
    urgentTasks: [], openTaskCount: 0, overdueTaskCount: 0,
    memberTodayTasks: [], tasksDoneToday: 0,
  }),
  meals: () => ({ todayMeals: [] }),
  notes: () => ({ pinnedNotes: [], pinnedNotesCount: 0 }),
  shopping: () => ({ shoppingLists: [], shoppingOpenCount: 0, shoppingOpenLists: 0 }),


  budget: ({ month }) => ({ budget: emptyBudget(month) }),
  rewards: () => ({ rewards: { standings: [], participantCount: 0, pending: 0 } }),
  health: () => ({
    health: {
      hasMeds: false, dosesTotal: 0, dosesTaken: 0, dosesSkipped: 0,
      nextDose: null, lowStockCount: 0,
    },
  }),
  housekeeping: () => ({
    housekeeping: {
      configured: false, present: false, presentSince: null, workerName: null,
      visitsThisMonth: 0, unpaidAmount: 0, lastVisit: null,
    },
  }),
});

function emptyBudget(month) {
  return {
    month,
    income: 0,
    expenses: 0,
    balance: 0,
    entryCount: 0,
    topExpenseCategory: null,
    topExpenseAmount: 0,
    savingsGoal: null,
  };
}

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

const router = express.Router();

router.get('/', (req, res) => {
  try {
  const d = db.get();
  const result = {};
  const userId = req.authUserId || req.session.userId;

  const taskCategories = normalizeCategoryFilter(req.query.tasks_category);
  const taskCategoryFragment = taskCategoryWhere('t', taskCategories, { named: 'cat' });
  const taskCategoryAnd = taskCategoryFragment ? ` AND ${taskCategoryFragment}` : '';
  const taskCategoryBinds = categoryBindings(taskCategories, 'cat');
  const noteCategories = [...new Set(
    (Array.isArray(req.query.notes_category) ? req.query.notes_category : [req.query.notes_category])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  )].slice(0, 50);
  const noteCategoryBinds = Object.fromEntries(noteCategories.map((id, index) => [`note_category_${index}`, id]));

  // Unterselect verhindert, dass erratene IDs fremder persoenlicher Kategorien
  // verraten, an welchen geteilten Notizen sie haengen.
  const noteCategoryAnd = noteCategories.map((_id, index) => `
    AND EXISTS (
      SELECT 1
      FROM note_category_assignments nca
      JOIN note_categories nc ON nc.id = nca.category_id
      WHERE nca.note_id = n.id
        AND nc.id = @note_category_${index}
        AND (nc.scope = 'household' OR nc.owner_user_id = @me)
    )
  `).join('');

  const eventsAssignedTo = req.query.events_scope === 'mine' ? userId : null;
  const includeBirthdays = req.query.events_birthdays !== 'hide';

  const now = new Date();



  // Konvention wie public/utils/health-meds.js: Montag = 0 … Sonntag = 6.
  //








  //

  // HAUSHALTS (sync_config `household_timezone`, Rueckfall `TZ`). Der Unterschied



  // Ableitungen waeren drei Gelegenheiten, an einer Tagesgrenze auseinanderzulaufen.
  const householdWall = utcToWall(now.toISOString(), householdTimeZone(d));
  const todayLocalKey = householdWall?.date
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;


  const localWeekdayIdx = (new Date(`${todayLocalKey}T00:00:00Z`).getUTCDay() + 6) % 7;
  const currentMonth = todayLocalKey.slice(0, 7);
  const deadline48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();





  // Daten erst gelesen und dann weggeworfen.
  //



  const denied = hiddenModulesFor(req, Object.keys(DENIED_PAYLOAD));
  for (const key of denied) Object.assign(result, DENIED_PAYLOAD[key]?.({ month: currentMonth }));
  const allows = (moduleKey) => !denied.has(moduleKey);


  // Geteilte Logik mit /calendar/upcoming: expandiert wiederkehrende Serien,

  if (allows('calendar')) try {
    result.upcomingEvents = serializeEvents(getUpcomingEvents(d, {
      userId, limit: 5, fromToday: true, assignedTo: eventsAssignedTo, includeBirthdays,
    }), { database: d, actorId: userId, isAdmin: isAdminUser(req) });
  } catch (err) {
    log.error('upcomingEvents error:', err.message);
    result.upcomingEvents = [];
  }


  // Faithful translation of the previous JS comparator:
  //   1. overdue (due_sort < now) before not-overdue
  //   2. within a group: earlier due date/time first; undated tasks last (NULLS LAST)
  //   3. ties broken by priority rank (urgent=0..none=4)
  // due_sort = due_date + due_time, falling back to 23:59:59 when only a date is set,
  // and NULL when there is no due_date at all.
  if (allows('tasks')) try {



    const nowIso = `${todayLocalKey}T${householdWall?.time
      ?? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`}`;
    result.urgentTasks = d.prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color,
        ${ASSIGNED_USERS_SQL},
        CASE WHEN t.due_date IS NULL THEN NULL
             ELSE t.due_date || 'T' || COALESCE(t.due_time, '23:59:59')
        END AS __due_sort
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.status != 'done'



        AND t.archived_at IS NULL
        AND ${taskScopeWhere('t', { bind: '@today' })}
        AND ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}${taskCategoryAnd}
      ORDER BY
        CASE WHEN __due_sort IS NOT NULL AND __due_sort < @now THEN 0 ELSE 1 END ASC,
        __due_sort IS NULL ASC,
        __due_sort ASC,
        CASE t.priority
          WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
          WHEN 'low' THEN 3 ELSE 4
        END ASC
      LIMIT 5
    `).all({ now: nowIso, me: userId, today: todayLocalKey, ...taskCategoryBinds }).map(({ __due_sort, ...task }) => addAssignedUsers(task));
  } catch (err) {
    log.error('urgentTasks error:', err.message);
    result.urgentTasks = [];
  }


  //





  if (allows('tasks')) try {
    result.openTaskCount = d.prepare(`
      SELECT COUNT(*) AS n FROM tasks t
      WHERE t.status != 'done' AND t.archived_at IS NULL
        AND ${taskScopeWhere('t', { bind: '@today' })}
        AND ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}${taskCategoryAnd}
    `).get({ me: userId, today: todayLocalKey, ...taskCategoryBinds }).n;
  } catch (err) {
    log.error('openTaskCount error:', err.message);
    result.openTaskCount = null;
  }


  // nicht, ob etwas brennt.
  if (allows('tasks')) try {
    result.overdueTaskCount = d.prepare(`
      SELECT COUNT(*) AS n FROM tasks t
      WHERE t.status != 'done' AND t.archived_at IS NULL
        AND t.due_date IS NOT NULL AND t.due_date < @today
        AND ${taskScopeWhere('t', { bind: '@today' })}
        AND ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}${taskCategoryAnd}
    `).get({ today: todayLocalKey, me: userId, ...taskCategoryBinds }).n;
  } catch (err) {
    log.error('overdueTaskCount error:', err.message);
    result.overdueTaskCount = null;
  }

  if (allows('shopping')) try {
    const row = d.prepare(`
      SELECT COUNT(*) AS items, COUNT(DISTINCT si.list_id) AS lists
      FROM shopping_items si WHERE si.is_checked = 0
    `).get();
    result.shoppingOpenCount = row.items;
    result.shoppingOpenLists = row.lists;
  } catch (err) {
    log.error('shoppingOpenCount error:', err.message);
    result.shoppingOpenCount = null;
    result.shoppingOpenLists = 0;
  }

  // Heutiges Essen (gefiltert nach haushaltweiten Mahlzeit-Typ-Einstellungen)
  if (allows('meals')) try {
    const ALL_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
    const prefRow = d.prepare('SELECT value FROM sync_config WHERE key = ?').get('visible_meal_types');
    const visibleTypes = prefRow
      ? prefRow.value.split(',').filter((t) => ALL_MEAL_TYPES.includes(t))
      : ALL_MEAL_TYPES;
    const placeholders = visibleTypes.map(() => '?').join(', ');
    result.todayMeals = d.prepare(`
      SELECT m.*,


             -- des Providers.
             r.provider_has_image AS recipe_has_image,
             (r.image_data IS NOT NULL) AS recipe_has_own_image
      FROM meals m
      LEFT JOIN recipes r ON r.id = m.recipe_id
      WHERE m.date = ?
        AND m.meal_type IN (${placeholders})
      ORDER BY
        CASE m.meal_type
          WHEN 'breakfast' THEN 0
          WHEN 'lunch'     THEN 1
          WHEN 'dinner'    THEN 2
          WHEN 'snack'     THEN 3
        END
    `).all(todayLocalKey, ...visibleTypes);
  } catch (err) {
    log.error('todayMeals error:', err.message);
    result.todayMeals = [];
  }

  // Neueste Notizen (gepinnte zuerst, dann aktuellste)
  if (allows('notes')) try {
    result.pinnedNotes = d.prepare(`
      SELECT n.*, u.display_name AS author_name, u.avatar_color AS author_color
      FROM notes n
      LEFT JOIN users u ON n.created_by = u.id
      WHERE 1 = 1 ${noteCategoryAnd}
      ORDER BY n.pinned DESC, n.updated_at DESC








      LIMIT 5
    `).all({ me: userId, ...noteCategoryBinds });
    result.pinnedNotes = hydrateNotesWithCategories(d, result.pinnedNotes, userId);
    result.pinnedNotesCount = d.prepare(`
      SELECT COUNT(*) AS n FROM notes n
      WHERE n.pinned = 1 ${noteCategoryAnd}
    `).get({ me: userId, ...noteCategoryBinds }).n;
  } catch (err) {
    log.error('pinnedNotes error:', err.message);
    result.pinnedNotes = [];
    result.pinnedNotesCount = 0;
  }


  if (allows('shopping')) try {
    const lists = d.prepare(`
      SELECT sl.id, sl.name,
        (SELECT COUNT(*) FROM shopping_items si WHERE si.list_id = sl.id AND si.is_checked = 0) AS open_count,
        (SELECT COUNT(*) FROM shopping_items si WHERE si.list_id = sl.id) AS total_count
      FROM shopping_lists sl
      WHERE (SELECT COUNT(*) FROM shopping_items si WHERE si.list_id = sl.id AND si.is_checked = 0) > 0
      ORDER BY sl.updated_at DESC
      LIMIT 3
    `).all();

    for (const list of lists) {
      list.items = d.prepare(`
        SELECT id, name, quantity, is_checked
        FROM shopping_items
        WHERE list_id = ? AND is_checked = 0
        ORDER BY id ASC
        LIMIT 6
      `).all(list.id);
    }
    result.shoppingLists = lists;
  } catch (err) {
    log.error('shoppingLists error:', err.message);
    result.shoppingLists = [];
  }


  try {
    result.users = d.prepare(
      `SELECT id, display_name, avatar_color, avatar_data FROM users u
       WHERE NOT EXISTS (SELECT 1 FROM housekeeping_workers hw WHERE hw.user_id = u.id)
       ORDER BY display_name`
    ).all();
  } catch (err) {
    result.users = [];
  }

  if (allows('calendar')) try {



    // Frontend die neutrale Modul-Toenung (Etappe 4, Critique 2026-08-17).
    const rows = d.prepare(`
      SELECT b.*, u.avatar_color AS family_user_color
        FROM birthdays b
        LEFT JOIN users u ON u.id = b.family_user_id
       ORDER BY b.name COLLATE NOCASE ASC
    `).all();
    const hydrated = rows
      .flatMap((row) => hydrateBirthdayOccurrences(d, row))
      .sort((a, b) => a.days_until - b.days_until
        || a.name.localeCompare(b.name)
        || a.kind.localeCompare(b.kind));

    result.birthdaySoonCount = hydrated.filter((b) => (b.days_until ?? 9999) <= 3).length;

    result.birthdays = hydrated






      .slice(0, 5);
    result.birthdayCount = rows.length;
  } catch (err) {
    log.error('birthdays error:', err.message);
    result.birthdays = [];
    result.birthdayCount = 0;
    result.birthdaySoonCount = 0;
  }





  //






  // Gesamtzahl entsteht in `getCountdowns` hinter demselben Filter, damit
  // Schnitt und Zahl dieselbe Menge meinen.
  try {
    const countdowns = getCountdowns(d, {
      userId,
      todayKey: todayLocalKey,
      hiddenModules: denied,
    });
    result.countdowns = countdowns.items;


    result.countdownTotal = countdowns.total;
  } catch (err) {
    log.error('countdowns error:', err.message);
    result.countdowns = [];
    result.countdownTotal = 0;
  }




  //





  try {
    result.quicklinks = listQuickLinksFor(userId, req.authRole === 'admin');
  } catch (err) {
    log.error('quick links error:', err.message);
    result.quicklinks = [];
  }

  if (allows('budget')) try {
    const from = `${currentMonth}-01`;
    const to = `${currentMonth}-31`;


    const ownerClause = resolveBudgetMode(d) === 'personal' ? ' AND owner_id = ?' : '';
    const ownerParams = ownerClause ? [userId] : [];

    const totals = d.prepare(`
      SELECT
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS expenses,
        SUM(amount) AS balance,
        COUNT(*) AS entry_count
      FROM budget_entries

      -- Uebersicht, Statistik, Plan und Kontostand.
      WHERE date BETWEEN ? AND ?${ownerClause} AND is_pending = 0
    `).get(from, to, ...ownerParams);

    const topExpense = d.prepare(`
      SELECT category, SUM(amount) AS amount
      FROM budget_entries
      WHERE amount < 0 AND date BETWEEN ? AND ?${ownerClause} AND is_pending = 0
      GROUP BY category
      ORDER BY ABS(SUM(amount)) DESC
      LIMIT 1
    `).get(from, to, ...ownerParams);



    let savingsGoal = null;
    try {
      const goalRow = d.prepare("SELECT amount FROM budget_plans WHERE category = '__savings__'").get();
      if (goalRow) savingsGoal = Math.round(goalRow.amount * 100) / 100;
    } catch { /* Tabelle fehlt (Legacy/Test) → kein Sparziel */ }

    result.budget = {
      month: currentMonth,
      income: totals?.income || 0,
      expenses: Math.abs(totals?.expenses || 0),
      balance: totals?.balance || 0,
      entryCount: totals?.entry_count || 0,
      topExpenseCategory: topExpense?.category || null,
      topExpenseAmount: Math.abs(topExpense?.amount || 0),
      savingsGoal,
    };
  } catch (err) {
    log.error('budget error:', err.message);
    result.budget = {
      month: currentMonth,
      income: 0,
      expenses: 0,
      balance: 0,
      entryCount: 0,
      topExpenseCategory: null,
      topExpenseAmount: 0,
    };
  }

  // Belohnungen: Familien-Punktestand (Top 5 aktive Teilnehmer nach Ledger-Saldo)

  if (allows('rewards')) try {
    const MEMBER_FILTER = 'NOT EXISTS (SELECT 1 FROM housekeeping_workers hw WHERE hw.user_id = u.id)';
    const standings = d.prepare(`
      SELECT u.id, u.display_name, u.avatar_color, u.avatar_data, u.family_role,
             COALESCE((SELECT SUM(delta) FROM reward_ledger l WHERE l.user_id = u.id), 0) AS balance
      FROM users u
      JOIN reward_participants rp ON rp.user_id = u.id AND rp.enabled = 1
      WHERE ${MEMBER_FILTER}
      ORDER BY balance DESC, u.display_name COLLATE NOCASE ASC
      LIMIT 5
    `).all();
    const participantCount = d.prepare('SELECT COUNT(*) AS n FROM reward_participants WHERE enabled = 1').get().n;
    const pending = d.prepare("SELECT COUNT(*) AS n FROM reward_redemptions WHERE status = 'pending'").get().n;
    result.rewards = { standings, participantCount, pending };
  } catch (err) {
    log.error('rewards error:', err.message);
    result.rewards = { standings: [], participantCount: 0, pending: 0 };
  }





  // Log-Status), da public/utils/health-meds.js browser-Pfade importiert und serverseitig

  if (allows('health')) try {
    const meds = d.prepare(`
      SELECT id, name, stock_qty, refill_threshold
      FROM medications
      WHERE active = 1 AND user_id = ?
    `).all(userId);
    const scheduleStmt = d.prepare(`
      SELECT time_of_day, days_mask, start_date, end_date
      FROM medication_schedules
      WHERE medication_id = ? AND active = 1
    `);
    const logStmt = d.prepare(`
      SELECT status FROM medication_logs
      WHERE medication_id = ? AND substr(scheduled_at, 1, 10) = ? AND substr(scheduled_at, 12, 5) = ?
      ORDER BY id DESC LIMIT 1
    `);
    let dosesTotal = 0;
    let dosesTaken = 0;
    let dosesSkipped = 0;
    let lowStockCount = 0;
    let nextDose = null;
    for (const med of meds) {
      if (med.stock_qty != null && Number.isFinite(Number(med.stock_qty))) {
        const stock = Number(med.stock_qty);
        const thr = med.refill_threshold != null && Number.isFinite(Number(med.refill_threshold))
          ? Number(med.refill_threshold)
          : null;
        if (stock <= 0 || (thr != null && stock <= thr)) lowStockCount += 1;
      }
      for (const s of scheduleStmt.all(med.id)) {
        if (s.start_date && todayLocalKey < s.start_date) continue;
        if (s.end_date && todayLocalKey > s.end_date) continue;
        const mask = s.days_mask;
        const matches = mask === null || mask === undefined
          ? true
          : (Number(mask) & (1 << localWeekdayIdx)) !== 0;
        if (!matches) continue;
        dosesTotal += 1;
        const time = s.time_of_day || '00:00';
        const logRow = logStmt.get(med.id, todayLocalKey, time);
        if (logRow?.status === 'taken') dosesTaken += 1;
        else if (logRow?.status === 'skipped') dosesSkipped += 1;
        else if (!nextDose || time < nextDose.time) nextDose = { name: med.name, time };
      }
    }
    result.health = {
      hasMeds: meds.length > 0,
      dosesTotal,
      dosesTaken,
      dosesSkipped,
      nextDose,
      lowStockCount,
    };
  } catch (err) {
    log.error('health error:', err.message);
    result.health = { hasMeds: false, dosesTotal: 0, dosesTaken: 0, dosesSkipped: 0, nextDose: null, lowStockCount: 0 };
  }

  // Haushaltshilfe: Anwesenheitsstatus (offene Sitzung), Besuche im laufenden Monat,

  if (allows('housekeeping')) try {
    const openSession = d.prepare(`
      SELECT hws.check_in, u.display_name AS worker_name
      FROM housekeeping_work_sessions hws
      LEFT JOIN housekeeping_workers hw ON hw.id = hws.worker_id
      LEFT JOIN users u ON u.id = hw.user_id
      WHERE hws.check_out IS NULL
      ORDER BY hws.check_in DESC LIMIT 1
    `).get();
    const monthRow = d.prepare(`
      SELECT COUNT(*) AS visits,
             COALESCE(SUM(CASE WHEN paid_at IS NULL THEN daily_rate + COALESCE(extras, 0) ELSE 0 END), 0) AS unpaid
      FROM housekeeping_work_sessions
      WHERE substr(check_in, 1, 7) = ? AND check_out IS NOT NULL
    `).get(currentMonth);
    const lastRow = d.prepare(`
      SELECT check_in FROM housekeeping_work_sessions
      WHERE check_out IS NOT NULL ORDER BY check_in DESC LIMIT 1
    `).get();
    const anyRow = d.prepare('SELECT 1 FROM housekeeping_work_sessions LIMIT 1').get()
      || d.prepare('SELECT 1 FROM housekeeping_workers LIMIT 1').get();
    result.housekeeping = {
      configured: Boolean(anyRow),
      present: Boolean(openSession),
      presentSince: openSession?.check_in || null,
      workerName: openSession?.worker_name || null,
      visitsThisMonth: monthRow?.visits || 0,
      unpaidAmount: monthRow?.unpaid || 0,
      lastVisit: lastRow?.check_in || null,
    };
  } catch (err) {
    log.error('housekeeping error:', err.message);
    result.housekeeping = { configured: false, present: false, presentSince: null, workerName: null, visitsThisMonth: 0, unpaidAmount: 0, lastVisit: null };
  }





  if (allows('tasks')) try {
    result.memberTodayTasks = d.prepare(`
      SELECT ta.user_id AS user_id, COUNT(*) AS open_count
      FROM tasks t JOIN task_assignments ta ON ta.task_id = t.id
      WHERE t.status != 'done' AND t.archived_at IS NULL
        AND t.due_date IS NOT NULL AND t.due_date <= @today
        AND ${taskScopeWhere('t', { bind: '@today' })}
        AND ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}${taskCategoryAnd}
      GROUP BY ta.user_id
    `).all({ today: todayLocalKey, me: userId, ...taskCategoryBinds });
  } catch (err) {
    log.error('memberTodayTasks error:', err.message);
    result.memberTodayTasks = [];
  }




  if (allows('tasks')) try {
    result.tasksDoneToday = d.prepare(`
      SELECT COUNT(*) AS n FROM tasks t
      WHERE t.status = 'done' AND t.archived_at IS NULL
        AND t.due_date = @today
        AND ${taskScopeWhere('t', { bind: '@today' })}
        AND ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}${taskCategoryAnd}
    `).get({ today: todayLocalKey, me: userId, ...taskCategoryBinds }).n;
  } catch (err) {
    log.error('tasksDoneToday error:', err.message);
    result.tasksDoneToday = 0;
  }

  res.json(result);
  } catch (err) {
    log.error('Critical error:', err.message);
    res.status(500).json({ error: 'Dashboard could not be loaded.', code: 500 });
  }
});

export default router;
