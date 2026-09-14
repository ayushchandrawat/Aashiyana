
import { reminderDateBefore } from '../utils/reminder-schedule.js';
import { todayKey } from '../utils/timezone.js';
import { resolvePermissions } from '../permissions.js';
import { createLogger } from '../logger.js';
import { predictCycle } from '../../public/utils/health-cycle.js';
import { healthCycleViews } from '../routes/preferences.js';

const log = createLogger('CycleReminders');

function cycleTabEnabled(database, userId) {
  return healthCycleViews(userId).health_cycle_effective;
}

function lacksHealth(database, userId) {
  const user = database.prepare('SELECT id, role, family_role FROM users WHERE id = ?').get(userId);
  if (!user) return true;
  return resolvePermissions(database, user).modules.health === 'none';
}

function dropAnchorAndReminder(database, userId, kind, entityType) {
  const anchor = database.prepare('SELECT id FROM cycle_reminder_anchors WHERE user_id = ? AND kind = ?').get(userId, kind);
  if (!anchor) return;
  database.prepare('DELETE FROM reminders WHERE entity_type = ? AND entity_id = ?').run(entityType, anchor.id);
  database.prepare('DELETE FROM cycle_reminder_anchors WHERE id = ?').run(anchor.id);
}

function upsertCycleReminder(database, userId, kind, entityType, targetDate, offsetDays, today) {
  const remindAt = reminderDateBefore(targetDate, offsetDays);

  const existingAnchor = database.prepare(
    'SELECT id, anchor_date FROM cycle_reminder_anchors WHERE user_id = ? AND kind = ?'
  ).get(userId, kind);
  if (existingAnchor && existingAnchor.anchor_date !== targetDate) {
    database.prepare('DELETE FROM reminders WHERE entity_type = ? AND entity_id = ?').run(entityType, existingAnchor.id);
    database.prepare('DELETE FROM cycle_reminder_anchors WHERE id = ?').run(existingAnchor.id);
  }




  if (targetDate < today) return;

  const anchorId = database.prepare(`
    INSERT INTO cycle_reminder_anchors (user_id, anchor_date, kind) VALUES (?, ?, ?)
    ON CONFLICT(user_id, anchor_date, kind) DO UPDATE SET anchor_date = excluded.anchor_date
    RETURNING id
  `).get(userId, targetDate, kind).id;

  const existingReminder = database.prepare(
    'SELECT id, remind_at FROM reminders WHERE entity_type = ? AND entity_id = ?'
  ).get(entityType, anchorId);
  if (existingReminder) {


    // immer wieder raus.
    if (existingReminder.remind_at === remindAt) return;
    database.prepare('DELETE FROM reminders WHERE id = ?').run(existingReminder.id);
  }
  database.prepare(`
    INSERT INTO reminders (entity_type, entity_id, remind_at, created_by) VALUES (?, ?, ?, ?)
  `).run(entityType, anchorId, remindAt, userId);
}

function syncPeriodReminder(database, userId, settings, today) {
  const daysBefore = settings?.remind_period_days_before;
  if (daysBefore == null) {
    dropAnchorAndReminder(database, userId, 'period_predicted', 'cycle_period');
    return;
  }

  const periods = database.prepare('SELECT * FROM cycle_periods WHERE user_id = ? ORDER BY start_date ASC').all(userId);
  const prediction = predictCycle(periods, settings, today);
  if (!prediction.hasData || prediction.isPregnant || !prediction.nextStart) {
    dropAnchorAndReminder(database, userId, 'period_predicted', 'cycle_period');
    return;
  }

  upsertCycleReminder(database, userId, 'period_predicted', 'cycle_period', prediction.nextStart, daysBefore, today);
}

function syncLogNudgeReminder(database, userId, settings, today) {
  if (!settings?.remind_log_daily) {
    dropAnchorAndReminder(database, userId, 'log_nudge', 'cycle_log_nudge');
    return;
  }

  const hasLogToday = database.prepare('SELECT 1 FROM cycle_day_logs WHERE user_id = ? AND log_date = ?').get(userId, today);
  if (hasLogToday) {
    dropAnchorAndReminder(database, userId, 'log_nudge', 'cycle_log_nudge');
    return;
  }

  upsertCycleReminder(database, userId, 'log_nudge', 'cycle_log_nudge', today, 0, today);
}

export function syncCycleRemindersForUser(database, userId, now = new Date()) {





  database.transaction(() => {
    if (lacksHealth(database, userId) || !cycleTabEnabled(database, userId)) {
      dropAnchorAndReminder(database, userId, 'period_predicted', 'cycle_period');
      dropAnchorAndReminder(database, userId, 'log_nudge', 'cycle_log_nudge');
      return;
    }

    const today = todayKey(database, now);
    const settings = database.prepare('SELECT * FROM cycle_settings WHERE user_id = ?').get(userId) || {};
    syncPeriodReminder(database, userId, settings, today);
    syncLogNudgeReminder(database, userId, settings, today);
  })();
}

export function syncAllCycleReminders(database, now = new Date()) {
  const withSettings = database.prepare(`
    SELECT user_id FROM cycle_settings WHERE remind_period_days_before IS NOT NULL OR remind_log_daily = 1
  `).all();




  const withAnchors = database.prepare('SELECT user_id FROM cycle_reminder_anchors GROUP BY user_id').all();
  const candidateIds = new Set([...withSettings.map((r) => r.user_id), ...withAnchors.map((r) => r.user_id)]);
  for (const userId of candidateIds) {
    try {
      syncCycleRemindersForUser(database, userId, now);
    } catch (err) {
      log.error(`Cycle reminder sync failed for user ${userId}:`, err?.message || err);
    }
  }
}
