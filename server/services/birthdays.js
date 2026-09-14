import { formatDateKey, resolveHouseholdFormats, translate } from '../utils/i18n.js';
import { householdTimeZone, localToUTC, todayKey } from '../utils/timezone.js';
import { OUTBOUND_SOURCES, markEventOutbound, queueEventDeletion } from './calendar-outbound.js';

const BIRTHDAY_COLOR = '#E11D48';
const BIRTHDAY_RRULE = 'FREQ=YEARLY;INTERVAL=1';




//









const AUTHORED_FIELDS = ['title', 'description', 'start_datetime'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function leapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizedMonthDay(birthDate, year) {
  const [, monthStr, dayStr] = String(birthDate).split('-');
  const month = parseInt(monthStr, 10);
  let day = parseInt(dayStr, 10);
  if (month === 2 && day === 29 && !leapYear(year)) day = 28;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function normalizedNameDay(nameDay, year) {
  const [monthStr, dayStr] = String(nameDay).split('-');
  const month = parseInt(monthStr, 10);
  let day = parseInt(dayStr, 10);
  if (month === 2 && day === 29 && !leapYear(year)) day = 28;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function nextBirthdayDate(birthDate, today = todayKey(null)) {
  const year = parseInt(String(today).slice(0, 4), 10);
  const thisYear = normalizedMonthDay(birthDate, year);
  return thisYear >= today ? thisYear : normalizedMonthDay(birthDate, year + 1);
}

function nextBirthdayAge(birthDate, today = todayKey(null)) {
  const next = nextBirthdayDate(birthDate, today);
  return parseInt(next.slice(0, 4), 10) - parseInt(String(birthDate).slice(0, 4), 10);
}

function daysUntilBirthday(birthDate, today = todayKey(null)) {
  const next = nextBirthdayDate(birthDate, today);
  const keyUtc = (key) => Date.UTC(
    parseInt(key.slice(0, 4), 10),
    parseInt(key.slice(5, 7), 10) - 1,
    parseInt(key.slice(8, 10), 10),
  );
  return Math.round((keyUtc(next) - keyUtc(String(today).slice(0, 10))) / 86400000);
}

function nextNameDayDate(nameDay, today = todayKey(null)) {
  if (!nameDay) return null;
  const year = parseInt(String(today).slice(0, 4), 10);
  const thisYear = normalizedNameDay(nameDay, year);
  return thisYear >= today ? thisYear : normalizedNameDay(nameDay, year + 1);
}

function daysUntilNameDay(nameDay, today = todayKey(null)) {
  const next = nextNameDayDate(nameDay, today);
  if (!next) return null;
  const keyUtc = (key) => Date.UTC(
    parseInt(key.slice(0, 4), 10),
    parseInt(key.slice(5, 7), 10) - 1,
    parseInt(key.slice(8, 10), 10),
  );
  return Math.round((keyUtc(next) - keyUtc(String(today).slice(0, 10))) / 86400000);
}

function getOffsetMinutes(birthday) {
  if (birthday.reminder_offset === 'custom') {
    const amount = parseInt(birthday.reminder_custom_amount, 10) || 1;
    const unit = birthday.reminder_custom_unit || 'days';
    if (unit === 'weeks') return amount * 10080;
    if (unit === 'days') return amount * 1440;
    if (unit === 'hours') return amount * 60;
    return amount;
  }
  return parseInt(birthday.reminder_offset, 10) || 0;
}




function birthdayReminderAt(birthDate, offsetMin = 0, today = todayKey(null), tz = householdTimeZone(null)) {
  const next = nextBirthdayDate(birthDate, today);
  const baseTime = new Date(localToUTC(`${next}T12:00:00`, tz)).getTime();
  return new Date(baseTime - (offsetMin || 0) * 60000).toISOString();
}







//


// Haushalts abweicht.
function eventTitle(name, locale) {
  return translate(locale, 'birthdays.calendarEventTitle', { name });
}

function eventDescription(name, birthDate, locale, dateFormat) {
  return birthDate
    ? translate(locale, 'birthdays.calendarEventDescription', {
        name,
        date: formatDateKey(birthDate, dateFormat),
      })
    : translate(locale, 'birthdays.calendarEventDescriptionNoDate', { name });
}

function nameDayEventTitle(name, locale) {
  return translate(locale, 'birthdays.nameDayCalendarEventTitle', { name });
}

function nameDayEventDescription(name, locale) {
  return translate(locale, 'birthdays.nameDayCalendarEventDescription', { name });
}

function deleteCalendarEvent(database, eventId) {
  const event = database.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId);
  if (event) queueEventDeletion(event, database);
  database.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId);
}

function syncBirthdayCalendarEvent(database, birthday, kind = 'birthday') {
  const isNameDay = kind === 'name_day';
  const eventIdField = isNameDay ? 'name_day_calendar_event_id' : 'calendar_event_id';
  const linkedEventId = birthday[eventIdField];
  const sourceDate = isNameDay
    ? (birthday.name_day ? `2000-${birthday.name_day}` : null)
    : birthday.birth_date;



  if (!sourceDate || birthday.reminder_offset === '') {
    if (linkedEventId) {
      database.prepare(`
        DELETE FROM reminders
        WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
      `).run(linkedEventId, birthday.created_by);
      deleteCalendarEvent(database, linkedEventId);
      database.prepare(`UPDATE birthdays SET ${eventIdField} = NULL WHERE id = ?`).run(birthday.id);
    }
    return null;
  }

  const { locale, dateFormat } = resolveHouseholdFormats(database);
  const payload = {
    title: isNameDay ? nameDayEventTitle(birthday.name, locale) : eventTitle(birthday.name, locale),
    description: isNameDay
      ? nameDayEventDescription(birthday.name, locale)
      : eventDescription(birthday.name, birthday.birth_date, locale, dateFormat),
    start_datetime: sourceDate,
    end_datetime: null,
    all_day: 1,
    location: null,
    color: BIRTHDAY_COLOR,
    icon: isNameDay ? 'balloon' : 'cake',
    assigned_to: null,
    recurrence_rule: BIRTHDAY_RRULE,
    created_by: birthday.created_by,
  };

  if (linkedEventId) {
    const existing = database.prepare('SELECT * FROM calendar_events WHERE id = ?').get(linkedEventId);
    if (existing) {







      //







      const mirrored = OUTBOUND_SOURCES.includes(existing.external_source) && !!existing.external_calendar_id;

      if (mirrored) {
















        database.prepare(`
          UPDATE calendar_events
          SET title = ?, description = ?, start_datetime = ?,
              end_datetime = CASE WHEN end_datetime IS NULL THEN NULL ELSE ? END
          WHERE id = ?
        `).run(
          payload.title,
          payload.description,
          payload.start_datetime,
          payload.start_datetime,
          linkedEventId,
        );






        const authoredChanged = AUTHORED_FIELDS.some((f) => existing[f] !== payload[f]);
        if (authoredChanged) {
          database.prepare(
            'UPDATE calendar_events SET outbound_dirty = 1, outbound_attempts = 0 WHERE id = ?'
          ).run(linkedEventId);
        }
      } else {
        database.prepare(`
          UPDATE calendar_events
          SET title = ?, description = ?, start_datetime = ?, end_datetime = ?, all_day = ?,
              location = ?, color = ?, icon = ?, assigned_to = ?, recurrence_rule = ?, created_by = ?
          WHERE id = ?
        `).run(
          payload.title,
          payload.description,
          payload.start_datetime,
          payload.end_datetime,
          payload.all_day,
          payload.location,
          payload.color,
          payload.icon,
          payload.assigned_to,
          payload.recurrence_rule,
          payload.created_by,
          linkedEventId,
        );
      }
      return linkedEventId;
    }
  }

  const result = database.prepare(`
    INSERT INTO calendar_events
      (title, description, start_datetime, end_datetime, all_day, location, color,
       icon, assigned_to, created_by, recurrence_rule, external_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local')
  `).run(
    payload.title,
    payload.description,
    payload.start_datetime,
    payload.end_datetime,
    payload.all_day,
    payload.location,
    payload.color,
    payload.icon,
    payload.assigned_to,
    payload.created_by,
    payload.recurrence_rule,
  );

  database.prepare(`UPDATE birthdays SET ${eventIdField} = ? WHERE id = ?`)
    .run(result.lastInsertRowid, birthday.id);
  return result.lastInsertRowid;
}

function syncBirthdayReminder(database, birthday, from = new Date(), kind = 'birthday') {
  const isNameDay = kind === 'name_day';
  const eventId = isNameDay ? birthday.name_day_calendar_event_id : birthday.calendar_event_id;
  const sourceDate = isNameDay ? `2000-${birthday.name_day}` : birthday.birth_date;
  if (!eventId || (isNameDay && !birthday.name_day)) return null;
  const today = todayKey(database, from);
  const tz    = householdTimeZone(database);

  if (birthday.reminder_offset === '') {
    database.prepare(`
      DELETE FROM reminders
      WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
    `).run(eventId, birthday.created_by);
    return null;
  }

  const offsetMin = getOffsetMinutes(birthday);
  const desired = birthdayReminderAt(sourceDate, offsetMin, today, tz);
  const existing = database.prepare(`
    SELECT * FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
    ORDER BY created_at DESC
  `).all(eventId, birthday.created_by);



  // Suche nichts, loeschte alles und legte dieselbe Erinnerung unverworfen neu




  const current = existing.find((row) => row.remind_at === desired && row.dismissed === 0)
    ?? existing.find((row) => row.remind_at === desired);
  if (current) return current.id;

  database.prepare(`
    DELETE FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
  `).run(eventId, birthday.created_by);

  const result = database.prepare(`
    INSERT INTO reminders (entity_type, entity_id, remind_at, created_by)
    VALUES ('event', ?, ?, ?)
  `).run(eventId, desired, birthday.created_by);

  return result.lastInsertRowid;
}

function syncBirthdayArtifacts(database, birthday, from = new Date()) {
  const calendarEventId = syncBirthdayCalendarEvent(database, birthday);
  let refreshed = { ...birthday, calendar_event_id: calendarEventId };
  syncBirthdayReminder(database, refreshed, from);
  const nameDayCalendarEventId = syncBirthdayCalendarEvent(database, refreshed, 'name_day');
  refreshed = { ...refreshed, name_day_calendar_event_id: nameDayCalendarEventId };
  syncBirthdayReminder(database, refreshed, from, 'name_day');
  return refreshed;
}

function deleteBirthdayArtifacts(database, birthday) {
  for (const eventId of [birthday.calendar_event_id, birthday.name_day_calendar_event_id]) {
    if (!eventId) continue;
    database.prepare(`
      DELETE FROM reminders
      WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
    `).run(eventId, birthday.created_by);
    deleteCalendarEvent(database, eventId);
  }
}

function retitleBirthdayEvents(database) {
  const { locale, dateFormat } = resolveHouseholdFormats(database);
  const rows = database.prepare(`
    SELECT b.name, b.birth_date, 'birthday' AS event_kind,
           e.id, e.title, e.description, e.external_source, e.external_calendar_id
    FROM birthdays b
    JOIN calendar_events e ON e.id = b.calendar_event_id
    UNION ALL
    SELECT b.name, NULL AS birth_date, 'name_day' AS event_kind,
           e.id, e.title, e.description, e.external_source, e.external_calendar_id
    FROM birthdays b
    JOIN calendar_events e ON e.id = b.name_day_calendar_event_id
  `).all();

  const update = database.prepare(
    'UPDATE calendar_events SET title = ?, description = ? WHERE id = ?'
  );


  const markDirty = database.prepare(
    'UPDATE calendar_events SET outbound_dirty = 1, outbound_attempts = 0 WHERE id = ?'
  );

  let changed = 0;
  for (const row of rows) {
    const title = row.event_kind === 'name_day'
      ? nameDayEventTitle(row.name, locale)
      : eventTitle(row.name, locale);
    const description = row.event_kind === 'name_day'
      ? nameDayEventDescription(row.name, locale)
      : eventDescription(row.name, row.birth_date, locale, dateFormat);
    if (title === row.title && description === (row.description ?? null)) continue;

    update.run(title, description, row.id);
    changed++;

    if (OUTBOUND_SOURCES.includes(row.external_source) && row.external_calendar_id) {
      markDirty.run(row.id);
    }
  }
  return changed;
}

function hydrateBirthday(database, row, from = new Date()) {
  const today = todayKey(database, from);
  const next_birthday = nextBirthdayDate(row.birth_date, today);
  return {
    ...row,
    next_birthday,
    next_age: nextBirthdayAge(row.birth_date, today),
    days_until: daysUntilBirthday(row.birth_date, today),
    next_name_day: row.name_day ? nextNameDayDate(row.name_day, today) : null,
    name_day_days_until: row.name_day ? daysUntilNameDay(row.name_day, today) : null,
  };
}

function hydrateBirthdayOccurrences(database, row, from = new Date()) {
  const birthday = hydrateBirthday(database, row, from);
  const occurrences = [{
    ...birthday,
    kind: 'birthday',
    next_date: birthday.next_birthday,
  }];
  if (birthday.name_day && birthday.next_name_day) {
    occurrences.push({
      ...birthday,
      kind: 'name_day',
      next_date: birthday.next_name_day,
      days_until: birthday.name_day_days_until,
      next_age: null,
    });
  }
  return occurrences;
}

function syncAllBirthdayReminders(database, userId, from = new Date()) {
  const birthdays = database.prepare(`
    SELECT * FROM birthdays WHERE created_by = ? ORDER BY birth_date ASC
  `).all(userId);
  birthdays.forEach((birthday) => syncBirthdayArtifacts(database, birthday, from));
}

function listBirthdayImportCandidates(database) {
  const rows = database.prepare(`
    SELECT c.id, c.name, c.birthday,
           EXISTS(SELECT 1 FROM birthdays b WHERE b.contact_id = c.id) AS already_imported
    FROM contacts c
    WHERE NOT EXISTS (
      SELECT 1 FROM housekeeping_workers hw WHERE hw.user_id = c.family_user_id
    )
    ORDER BY c.name COLLATE NOCASE ASC
  `).all();

  const withBirthday = [];
  const withoutBirthday = [];
  for (const r of rows) {
    if (r.birthday && String(r.birthday).trim()) {
      withBirthday.push({
        id: r.id,
        name: r.name,
        birthday: r.birthday,
        already_imported: r.already_imported === 1,
      });
    } else {
      withoutBirthday.push({ id: r.id, name: r.name });
    }
  }
  return { withBirthday, withoutBirthday };
}

function importBirthdaysFromContacts(database, contactIds, userId, from = new Date()) {
  let imported = 0;
  let skipped = 0;

  const getContact = database.prepare('SELECT id, name, birthday FROM contacts WHERE id = ?');
  const alreadyLinked = database.prepare('SELECT 1 FROM birthdays WHERE contact_id = ?');
  const insert = database.prepare(`
    INSERT INTO birthdays (name, birth_date, created_by, contact_id, reminder_offset)
    VALUES (?, ?, ?, ?, NULL)
  `);
  const load = database.prepare('SELECT * FROM birthdays WHERE id = ?');

  for (const rawId of contactIds) {
    const id = parseInt(rawId, 10);
    if (!Number.isInteger(id)) { skipped++; continue; }

    const contact = getContact.get(id);
    if (!contact || !contact.birthday || !String(contact.birthday).trim()) { skipped++; continue; }
    if (alreadyLinked.get(id)) { skipped++; continue; }

    const newId = insert.run(contact.name, contact.birthday, userId, id).lastInsertRowid;
    syncBirthdayArtifacts(database, load.get(newId), from);
    imported++;
  }

  return { imported, skipped };
}

export {
  BIRTHDAY_COLOR,
  BIRTHDAY_RRULE,
  birthdayReminderAt,
  daysUntilBirthday,
  daysUntilNameDay,
  deleteBirthdayArtifacts,
  eventDescription,
  eventTitle,
  hydrateBirthday,
  hydrateBirthdayOccurrences,
  importBirthdaysFromContacts,
  listBirthdayImportCandidates,
  nextBirthdayAge,
  nextBirthdayDate,
  nextNameDayDate,
  retitleBirthdayEvents,
  syncAllBirthdayReminders,
  syncBirthdayArtifacts,
};
