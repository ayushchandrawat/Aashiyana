
import { reminderDateBefore, reminderIsInThePast, REMINDER_TIME_SUFFIX } from '../utils/reminder-schedule.js';
import { todayKey } from '../utils/timezone.js';
import { resolvePermissions } from '../permissions.js';
import { createLogger } from '../logger.js';

const log = createLogger('PantryReminders');

export const EXPIRY_REMINDER_OFFSET_DAYS = 7;

export function syncPantryExpiryReminder(
  database, item, now = new Date(), access = null, { clampToNextMorning = false, today: givenToday = null } = {},
) {
  const drop = () => database.prepare(`
    DELETE FROM reminders WHERE entity_type = 'pantry_item' AND entity_id = ?
  `).run(item.id);

  if (!item.expires_on || !item.created_by || Number(item.quantity) <= 0) {
    drop();
    return;
  }





  // fragen jetzt dieselbe Stelle.
  //


  const { disabled, allowed } = access ?? { disabled: pantryDisabled(database), allowed: null };
  if (disabled || creatorLacksPantry(database, item.created_by, allowed)) {
    drop();
    return;
  }








  let remindAt;
  try {
    remindAt = reminderDateBefore(item.expires_on, EXPIRY_REMINDER_OFFSET_DAYS);
  } catch {
    log.warn(`Pantry item ${item.id} has an unusable best-before date (${item.expires_on}) - no reminder.`);
    drop();
    return;
  }

  const existing = database.prepare(`
    SELECT id, remind_at FROM reminders WHERE entity_type = 'pantry_item' AND entity_id = ?
  `).get(item.id);



  // Intl.DateTimeFormat-Konstruktionen - dieselbe Kostenklasse, fuer die
  // `access` schon gebatcht wird.
  const today = givenToday ?? todayKey(database, now);




  // anderen: nichts weiter unten darf eine solche Meldung retten.
  if (item.expires_on < today) {
    drop();
    return;
  }

  if (clampToNextMorning) {
    if (reminderIsInThePast(remindAt, now)) {
      const soonest = earliestUsefulReminder(today, item.expires_on, now);

      if (existing && existing.remind_at <= soonest
          && existing.remind_at.slice(0, 10) <= item.expires_on) return;




      remindAt = soonest;
    } else if (existing?.remind_at === remindAt) {





      return;
    }
  } else {
    if (remindAt.slice(0, 10) < today) {





      if (existing) drop();
      return;
    }
    if (existing?.remind_at === remindAt) return;
  }

  drop();
  database.prepare(`
    INSERT INTO reminders (entity_type, entity_id, remind_at, created_by)
    VALUES ('pantry_item', ?, ?, ?)
  `).run(item.id, remindAt, item.created_by);
}

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function earliestUsefulReminder(today, expiresOn, now) {
  const todayMorning = `${today}${REMINDER_TIME_SUFFIX}`;
  if (!reminderIsInThePast(todayMorning, now)) return todayMorning;

  const tomorrow = addDays(today, 1);
  if (tomorrow <= expiresOn) return `${tomorrow}${REMINDER_TIME_SUFFIX}`;
  return todayMorning;
}

function pantryDisabled(database) {
  const row = database.prepare("SELECT value FROM sync_config WHERE key = 'disabled_modules'").get();
  if (!row?.value) return false;
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) && parsed.includes('pantry');
  } catch {
    return false;
  }
}

function creatorLacksPantry(database, userId, allowed = null) {


  // Einzelweg sagte fuer dieselbe ID NEIN (kein Nutzer -> keine Meldung), und


  if (allowed) return !allowed.has(userId);
  const user = database.prepare('SELECT id, role, family_role FROM users WHERE id = ?').get(userId);
  if (!user) return true;
  return resolvePermissions(database, user).modules.pantry === 'none';
}

export function resolvePantryAccess(database) {
  const disabled = pantryDisabled(database);
  return { disabled, allowed: disabled ? new Set() : usersWithPantry(database) };
}

function usersWithPantry(database) {
  const users = database.prepare('SELECT id, role, family_role FROM users').all();
  const allowed = new Set();
  for (const user of users) {
    if (resolvePermissions(database, user).modules.pantry !== 'none') allowed.add(user.id);
  }
  return allowed;
}

export function syncAllPantryExpiryReminders(database, now = new Date()) {







  if (pantryDisabled(database)) {
    database.prepare("DELETE FROM reminders WHERE entity_type = 'pantry_item'").run();
    return;
  }
  const anyCandidate = database.prepare(
    'SELECT 1 FROM pantry_items WHERE expires_on IS NOT NULL LIMIT 1'
  ).get();
  const anyReminder = database.prepare(
    "SELECT 1 FROM reminders WHERE entity_type = 'pantry_item' LIMIT 1"
  ).get();
  if (!anyCandidate && !anyReminder) return;

  const allowed = usersWithPantry(database);


  if (!allowed.size) {
    database.prepare("DELETE FROM reminders WHERE entity_type = 'pantry_item'").run();
    return;
  }


  // jeder einzelne Artikel dieselbe sync_config-Zeile erneut ab.
  const access = { disabled: false, allowed };



  // dasselbe tun, sonst verhalten sich zwei Formen derselben Sperre verschieden.
  //



  const allowedList = [...allowed];
  const IS_ALLOWED = `AND created_by IN (${allowedList.map(() => '?').join(', ')})`;












  const today = todayKey(database, now);

  const QUALIFIES = `
    expires_on IS NOT NULL AND date(expires_on) = expires_on AND expires_on >= ?
    AND quantity > 0
    ${IS_ALLOWED}
  `;
  const QUALIFIES_PARAMS = [today, ...allowedList];




  database.prepare(`
    DELETE FROM reminders
    WHERE entity_type = 'pantry_item'
      AND entity_id NOT IN (SELECT id FROM pantry_items WHERE ${QUALIFIES})
  `).run(...QUALIFIES_PARAMS);


  // der Ergebnismenge.
  //



  // scheitern - bei hundert Artikeln rund 144.000 sinnlose Statements am Tag.


  // Mal im Baum steht.
  const missing = database.prepare(`
    SELECT id, quantity, expires_on, created_by FROM pantry_items
    WHERE ${QUALIFIES}
      AND date(expires_on, ?) >= date(?)
      AND id NOT IN (SELECT entity_id FROM reminders WHERE entity_type = 'pantry_item')
  `).all(...QUALIFIES_PARAMS, `-${EXPIRY_REMINDER_OFFSET_DAYS} days`, today);




  for (const item of missing) {
    try {
      syncPantryExpiryReminder(database, item, now, access, { today });
    } catch (err) {
      log.error(`Pantry reminder sync failed for item ${item.id}:`, err?.message || err);
    }
  }






  //










  const stale = database.prepare(`
    SELECT r.id, r.remind_at, p.expires_on
    FROM reminders r JOIN pantry_items p ON p.id = r.entity_id
    WHERE r.entity_type = 'pantry_item' AND r.pushed_at IS NULL AND r.dismissed = 0
      AND (

        -- wirklich veraltet.
        (date(p.expires_on, ?) >= ? AND date(p.expires_on, ?) || ? <> r.remind_at)


        OR substr(r.remind_at, 1, 10) > p.expires_on
      )
  `).all(
    `-${EXPIRY_REMINDER_OFFSET_DAYS} days`, today,
    `-${EXPIRY_REMINDER_OFFSET_DAYS} days`, REMINDER_TIME_SUFFIX,
  );

  const retime = database.prepare('UPDATE reminders SET remind_at = ? WHERE id = ?');
  for (const row of stale) {
    let target;
    try {
      target = reminderDateBefore(row.expires_on, EXPIRY_REMINDER_OFFSET_DAYS);
    } catch {


      continue;
    }


    if (target === row.remind_at) continue;

    if (reminderIsInThePast(target, now)) {
      const soonest = earliestUsefulReminder(today, row.expires_on, now);




      if (row.remind_at <= soonest && row.remind_at.slice(0, 10) <= row.expires_on) continue;




      retime.run(soonest, row.id);
      continue;
    }
    retime.run(target, row.id);
  }
}

