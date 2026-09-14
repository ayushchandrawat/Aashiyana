
import { localToUTC, householdTimeZone, todayKey, shiftDateKey, utcToWall } from '../utils/timezone.js';
import { resolvePermissions } from '../permissions.js';
import { createLogger } from '../logger.js';
import { scheduleData } from './schedule.js';

const log = createLogger('ScheduleReminders');





const REMINDER_WINDOW_DAYS = 7;

function pad(n) { return String(n).padStart(2, '0'); }

function toNaiveUTC(isoWithZ) {

  // server/utils/reminder-schedule.js); localToUTC() liefert ein 'Z'-Suffix,

  // Offset zu tragen.
  return isoWithZ.replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
}

function subtractMinutes(naiveUTC, minutes) {
  const d = new Date(`${naiveUTC}Z`);
  d.setUTCMinutes(d.getUTCMinutes() - Math.max(0, Number(minutes) || 0));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function offsetMinutesAt(utcMs, tzid) {
  const wall = utcToWall(new Date(utcMs).toISOString(), tzid);
  if (!wall) return null;
  return (Date.parse(`${wall.date}T${wall.time}Z`) - utcMs) / 60000;
}

function localToUTCPrecise(localStr, tzid) {
  const naiveMs = Date.parse(`${localStr}Z`);
  if (Number.isNaN(naiveMs)) return localToUTC(localStr, tzid);

  const o1 = offsetMinutesAt(naiveMs, tzid);
  if (o1 == null) return localToUTC(localStr, tzid);
  const guessA = naiveMs - o1 * 60000;

  const o2 = offsetMinutesAt(guessA, tzid);
  if (o2 == null) return localToUTC(localStr, tzid);
  if (o2 === o1) return new Date(guessA).toISOString().replace('.000Z', 'Z');

  const guessB = naiveMs - o2 * 60000;
  const o3 = offsetMinutesAt(guessB, tzid);
  if (o3 === o2) return new Date(guessB).toISOString().replace('.000Z', 'Z');



  const gapMinutes = Math.abs(o2 - o1);
  return new Date(guessA + gapMinutes * 60000).toISOString().replace('.000Z', 'Z');
}

function shiftReminderAt(dateKey, startTime, offsetMinutes, tz) {
  const utc = toNaiveUTC(localToUTCPrecise(`${dateKey}T${startTime}:00`, tz));
  return subtractMinutes(utc, offsetMinutes);
}

function scheduleDisabled(database) {
  const row = database.prepare("SELECT value FROM sync_config WHERE key = 'disabled_modules'").get();
  if (!row?.value) return false;
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) && parsed.includes('schedule');
  } catch {
    return false;
  }
}

function lacksSchedule(database, userId) {
  const user = database.prepare('SELECT id, role, family_role FROM users WHERE id = ?').get(userId);
  if (!user) return true;
  return resolvePermissions(database, user).modules.schedule === 'none';
}

function syncExtraRemindersForUser(database, userId, entries, tz, now) {
  const qualifying = entries.filter((e) => e.source === 'extra' && e.shift_type?.start_time && e.shift_type?.end_time && e.reminder_offset_minutes != null);
  const qualifyingIds = new Set(qualifying.map((e) => e.extra_id));

  const existing = database.prepare(`SELECT id, entity_id, remind_at FROM reminders WHERE entity_type = 'schedule_extra_entry' AND created_by = ?`).all(userId);
  for (const row of existing) {
    if (!qualifyingIds.has(row.entity_id)) database.prepare('DELETE FROM reminders WHERE id = ?').run(row.id);
  }
  const byExtraId = new Map(existing.map((row) => [row.entity_id, row]));

  for (const entry of qualifying) {
    const remindAt = shiftReminderAt(entry.date_key, entry.shift_type.start_time, entry.reminder_offset_minutes, tz);
    const current = byExtraId.get(entry.extra_id);
    if (current) {
      if (current.remind_at === remindAt) continue;
      database.prepare('DELETE FROM reminders WHERE id = ?').run(current.id);
    }
    if (`${remindAt}Z` > isoNow(now)) {
      database.prepare(`INSERT INTO reminders (entity_type, entity_id, remind_at, created_by) VALUES ('schedule_extra_entry', ?, ?, ?)`).run(entry.extra_id, remindAt, userId);
    }
  }
}

function dropExtraReminders(database, userId) {
  database.prepare(`DELETE FROM reminders WHERE entity_type = 'schedule_extra_entry' AND created_by = ?`).run(userId);
}

function sweepStrandedReminders(database, userId) {
  database.prepare(`
    DELETE FROM reminders WHERE entity_type = 'schedule_entry' AND created_by = ?
      AND NOT EXISTS (SELECT 1 FROM schedule_reminder_entries e WHERE e.id = reminders.entity_id)
  `).run(userId);
  database.prepare(`
    DELETE FROM reminders WHERE entity_type = 'schedule_extra_entry' AND created_by = ?
      AND NOT EXISTS (SELECT 1 FROM schedule_extra_shifts s WHERE s.id = reminders.entity_id)
  `).run(userId);
}

function syncScheduleRemindersForUser(database, userId, now = new Date()) {


  // (scheduleDisabled/lacksSchedule unten) oder normal durchlaeuft: beide

  // verwaiste Zeile nie finden.
  sweepStrandedReminders(database, userId);

  const dropPrimary = () => {
    // Anker zuerst abfragen, dann beides loeschen - reminders.entity_id
    // traegt keinen echten Fremdschluessel auf schedule_reminder_entries

    const anchors = database.prepare('SELECT id FROM schedule_reminder_entries WHERE user_id = ?').all(userId);
    if (anchors.length) {
      const ids = anchors.map((a) => a.id);
      database.prepare(`DELETE FROM reminders WHERE entity_type = 'schedule_entry' AND entity_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }
    database.prepare('DELETE FROM schedule_reminder_entries WHERE user_id = ?').run(userId);
  };

  if (scheduleDisabled(database) || lacksSchedule(database, userId)) {
    dropPrimary();
    dropExtraReminders(database, userId);
    return;
  }

  const tz = householdTimeZone(database);
  const today = todayKey(database, now);
  const to = shiftDateKey(today, REMINDER_WINDOW_DAYS);
  const { entries } = scheduleData(today, to, userId);

  // Extras werden UNABHAENGIG vom haushaltweiten Vorlauf synchronisiert (siehe
  // syncExtraRemindersForUser oben) - immer, gleich ob der primaere Pfad unten
  // ueberhaupt laeuft.
  syncExtraRemindersForUser(database, userId, entries, tz, now);

  const user = database.prepare('SELECT id, schedule_reminder_offset_minutes FROM users WHERE id = ?').get(userId);
  const offsetMinutes = user?.schedule_reminder_offset_minutes;
  if (offsetMinutes == null) {
    dropPrimary();
    return;
  }








  // Eintraege am selben Datum liefern (Stundenplan) - der Schluessel traegt




  const qualifying = entries.filter((e) => e.source !== 'extra' && e.shift_type?.start_time && e.shift_type?.end_time);
  const slotKey = (dateKey, patternDayId) => `${dateKey}:${patternDayId ?? ''}`;
  const qualifyingBySlot = new Map(qualifying.map((e) => [slotKey(e.date_key, e.pattern_day_id), e]));



  // Zeit-Schicht, Musters geaendert, eine Klasse verschwunden, ...), geht

  // JEDER Zeile eine frische pattern_day_id (server/routes/schedule.js's



  // Absichtlich keine DB-Kaskade dafuer (siehe Migration 188's Kommentar).
  const existingAnchors = database.prepare('SELECT id, date_key, shift_type_id, pattern_day_id FROM schedule_reminder_entries WHERE user_id = ?').all(userId);
  for (const anchor of existingAnchors) {
    const entry = qualifyingBySlot.get(slotKey(anchor.date_key, anchor.pattern_day_id));
    if (!entry || entry.shift_type_id !== anchor.shift_type_id) {
      database.prepare(`DELETE FROM reminders WHERE entity_type = 'schedule_entry' AND entity_id = ?`).run(anchor.id);
      database.prepare('DELETE FROM schedule_reminder_entries WHERE id = ?').run(anchor.id);
    }
  }

  const upsertAnchor = database.prepare(`
    INSERT INTO schedule_reminder_entries (user_id, date_key, shift_type_id, pattern_day_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, date_key, COALESCE(pattern_day_id, 0)) DO UPDATE SET shift_type_id = excluded.shift_type_id
    RETURNING id
  `);

  for (const entry of qualifying) {
    const anchorId = upsertAnchor.get(userId, entry.date_key, entry.shift_type_id, entry.pattern_day_id).id;
    const remindAt = shiftReminderAt(entry.date_key, entry.shift_type.start_time, offsetMinutes, tz);

    const existing = database.prepare(`
      SELECT id, remind_at FROM reminders WHERE entity_type = 'schedule_entry' AND entity_id = ?
    `).get(anchorId);

    if (existing) {


      // dieselbe Meldung ginge immer wieder raus.
      if (existing.remind_at !== remindAt) {
        database.prepare('DELETE FROM reminders WHERE id = ?').run(existing.id);
        // Kein Neuanlegen fuer einen inzwischen verstrichenen Zielzeitpunkt -
        // eine verschobene Schicht, deren neuer Vorlauf schon hinter uns liegt,
        // bekommt keine Meldung mehr nachgereicht.
        if (`${remindAt}Z` > isoNow(now)) {
          database.prepare(`
            INSERT INTO reminders (entity_type, entity_id, remind_at, created_by) VALUES ('schedule_entry', ?, ?, ?)
          `).run(anchorId, remindAt, userId);
        }
      }
      continue;
    }




    // ungeklemmten Fall, ohne dessen Frischware-Sonderregel.
    if (`${remindAt}Z` > isoNow(now)) {
      database.prepare(`
        INSERT INTO reminders (entity_type, entity_id, remind_at, created_by) VALUES ('schedule_entry', ?, ?, ?)
      `).run(anchorId, remindAt, userId);
    }
  }
}

function isoNow(now) {
  return now.toISOString();
}

export function syncAllScheduleReminders(database, now = new Date()) {
  const users = database.prepare(`
    SELECT id FROM users WHERE schedule_reminder_offset_minutes IS NOT NULL
  `).all();

  // einer frueheren Einstellung tragen (Modul zwischenzeitlich gesperrt,
  // Berechtigung entzogen) - drop() in syncScheduleRemindersForUser() raeumt

  const anyAnchor = database.prepare('SELECT user_id FROM schedule_reminder_entries GROUP BY user_id').all();

  // Nutzer ohne eigenen users.schedule_reminder_offset_minutes taucht sonst

  const anyExtraOffset = database.prepare('SELECT DISTINCT user_id FROM schedule_extra_shifts WHERE reminder_offset_minutes IS NOT NULL').all();
  const anyExtraReminder = database.prepare(`SELECT DISTINCT created_by AS user_id FROM reminders WHERE entity_type = 'schedule_extra_entry'`).all();
  const candidateIds = new Set([...users.map((u) => u.id), ...anyAnchor.map((a) => a.user_id), ...anyExtraOffset.map((r) => r.user_id), ...anyExtraReminder.map((r) => r.user_id)]);
  for (const userId of candidateIds) {
    try {
      syncScheduleRemindersForUser(database, userId, now);
    } catch (err) {
      log.error(`Schedule reminder sync failed for user ${userId}:`, err?.message || err);
    }
  }
}

export { syncScheduleRemindersForUser };
