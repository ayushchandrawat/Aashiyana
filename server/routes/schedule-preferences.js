
import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';
import { syncScheduleRemindersForUser } from '../services/schedule-reminders.js';

const log = createLogger('Schedule');
const router = express.Router();

const MAX_OFFSET_MINUTES = 24 * 60;

// eine Falscheingabe.
const MAX_WEEKLY_HOURS = 168;

function getUserId(req) {
  const candidates = [req.authUserId, req.user?.id, req.session?.userId];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

// GET /api/v1/schedule/preferences → eigener Vorlauf + eigene Wochenstunden +

// Erinnerung aus, 40 Stunden, Verfolgung an)
router.get('/', (req, res) => {
  try {
    const row = db.get().prepare(
      'SELECT schedule_reminder_offset_minutes AS m, schedule_weekly_hours AS h, schedule_overtime_enabled AS o FROM users WHERE id = ?'
    ).get(getUserId(req));
    res.json({ data: { reminderOffsetMinutes: row?.m ?? null, weeklyHours: row?.h ?? null, overtimeEnabled: row?.o !== 0 } });
  } catch (err) {
    log.error('GET /schedule/preferences error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// PUT /api/v1/schedule/preferences { reminderOffsetMinutes?, weeklyHours?, overtimeEnabled? }


router.put('/', (req, res) => {
  try {
    const userId = getUserId(req);
    const current = db.get().prepare(
      'SELECT schedule_reminder_offset_minutes AS m, schedule_weekly_hours AS h, schedule_overtime_enabled AS o FROM users WHERE id = ?'
    ).get(userId);

    let offsetMinutes = current?.m ?? null;
    if ('reminderOffsetMinutes' in (req.body ?? {})) {
      const raw = req.body.reminderOffsetMinutes;
      if (raw === null || raw === undefined) {
        offsetMinutes = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > MAX_OFFSET_MINUTES) {
          return res.status(400).json({ error: `reminderOffsetMinutes must be an integer between 0 and ${MAX_OFFSET_MINUTES}, or null.`, code: 400 });
        }
        offsetMinutes = n;
      }
    }

    let weeklyHours = current?.h ?? null;
    if ('weeklyHours' in (req.body ?? {})) {
      const raw = req.body.weeklyHours;
      if (raw === null || raw === undefined) {
        weeklyHours = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > MAX_WEEKLY_HOURS) {
          return res.status(400).json({ error: `weeklyHours must be an integer between 1 and ${MAX_WEEKLY_HOURS}, or null.`, code: 400 });
        }
        weeklyHours = n;
      }
    }




    let overtimeEnabled = current?.o !== 0;
    if ('overtimeEnabled' in (req.body ?? {})) {
      const raw = req.body.overtimeEnabled;
      if (typeof raw !== 'boolean') {
        return res.status(400).json({ error: 'overtimeEnabled must be a boolean.', code: 400 });
      }
      overtimeEnabled = raw;
    }

    db.get().prepare('UPDATE users SET schedule_reminder_offset_minutes = ?, schedule_weekly_hours = ?, schedule_overtime_enabled = ? WHERE id = ?')
      .run(offsetMinutes, weeklyHours, overtimeEnabled ? 1 : 0, userId);
    // Sofort wirksam statt erst beim naechsten periodischen Lauf - gleiche


    syncScheduleRemindersForUser(db.get(), userId);
    res.json({ data: { reminderOffsetMinutes: offsetMinutes, weeklyHours, overtimeEnabled } });
  } catch (err) {
    log.error('PUT /schedule/preferences error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
