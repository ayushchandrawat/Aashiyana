
import { hasAnyOccurrence, nextOccurrenceAfter, seriesStartFor } from './recurrence.js';
import { loadEventExceptions } from './calendar-events.js';
import { eventProjectionSql, resolveProjectedEventRows } from './calendar-event-reader.js';
import { visibilityWhere } from './visibility.js';
import { householdTimeZone, utcToWall } from '../utils/timezone.js';


// currency-codes, ...), immer fuer abhaengigkeitsfreie geteilte Regeln.
import { resolveEventColorOrNull } from '../../public/utils/event-color.js';




const DEFAULT_LIMIT = 5;

export const DEFAULT_OVERDUE_GRACE_DAYS = 7;




const MAX_EXCEPTION_SKIPS = 50;

export function daysBetween(fromKey, toKey) {
  const from = parseKey(fromKey);
  const to = parseKey(toKey);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 86400000);
}

function parseKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? '').slice(0, 10));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** `dateKey` um `days` Tage verschoben, wieder als YYYY-MM-DD. */
function shiftKey(dateKey, days) {
  const ms = parseKey(dateKey);
  if (ms === null) return null;
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

function eventStartDateKey(event, tz) {
  const raw = String(event.start_datetime ?? '');
  const key = event.all_day || raw.length <= 10
    ? raw.slice(0, 10)
    : (utcToWall(raw, tz)?.date ?? raw.slice(0, 10));
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

export function nextEventDate(event, todayKey, exceptions = null, { graceDays = 0, tz = householdTimeZone(null) } = {}) {
  const startKey = eventStartDateKey(event, tz);
  if (!startKey) return null;
  if (!event.recurrence_rule) {
    const floor = graceDays > 0 ? shiftKey(todayKey, -graceDays) : todayKey;
    return floor && startKey >= floor ? startKey : null;
  }







  //






  // vorher gefragt.







  // beantworten zwei Stellen dieselbe Frage verschieden.
  const wandUhr = event.tzid ? utcToWall(String(event.start_datetime ?? ''), event.tzid) : null;
  const zonenUnsicher = !!event.tzid
    && !(wandUhr && wandUhr.date === String(event.start_datetime ?? '').slice(0, 10));

  if (!hasAnyOccurrence(startKey, event.recurrence_rule, { utcDiffersFromLocal: zonenUnsicher })) return null;
  const ersterTreffer = seriesStartFor(startKey, event.recurrence_rule, { utcDiffersFromLocal: zonenUnsicher });
  let candidate = ersterTreffer >= todayKey
    ? ersterTreffer
    : nextOccurrenceAfter(ersterTreffer, event.recurrence_rule, todayKey, { seriesStart: startKey });

  let skips = 0;
  while (candidate && exceptions?.has(candidate) && skips++ < MAX_EXCEPTION_SKIPS) {
    candidate = nextOccurrenceAfter(candidate, event.recurrence_rule, candidate, { seriesStart: startKey });
  }




  if (!candidate || candidate < todayKey) return null;
  return candidate;
}

function disabledModules(d) {
  const row = d.prepare("SELECT value FROM sync_config WHERE key = 'disabled_modules'").get();
  if (!row?.value) return new Set();
  try {
    const parsed = JSON.parse(row.value);
    return new Set(Array.isArray(parsed) ? parsed.filter((m) => typeof m === 'string') : []);
  } catch {
    return new Set();
  }
}

function overdueGraceDays(d) {
  const row = d.prepare("SELECT value FROM sync_config WHERE key = 'countdown_grace_days'").get();
  const parsed = Number(row?.value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_OVERDUE_GRACE_DAYS;
}

export function getCountdowns(d, {
  userId = null, todayKey, hiddenModules = null, limit = DEFAULT_LIMIT,
} = {}) {
  const hidden = new Set([...disabledModules(d), ...(hiddenModules ?? [])]);
  const graceDays = overdueGraceDays(d);
  const items = [
    ...(hidden.has('calendar') ? [] : eventCountdowns(d, userId, todayKey, graceDays)),
    ...(hidden.has('tasks') ? [] : taskCountdowns(d, userId, todayKey, graceDays)),
  ];

  const sorted = items


    // Aufrufen nicht wackelt.
    .sort((a, b) => a.days_until - b.days_until
      || a.title.localeCompare(b.title)
      || a.source.localeCompare(b.source));

  return { items: sorted.slice(0, limit), total: sorted.length };
}

function eventCountdowns(d, userId, todayKey, graceDays) {


  const tz = householdTimeZone(d);
  const rows = d.prepare(`
    SELECT ${eventProjectionSql(d)},


           -- Kachel zeigt eine Kante, keine Personenliste.
           --




           -- (assignees.find(...) ?? assignees[0]); ohne dieselbe Ruecknahme

           COALESCE(u.avatar_color, (
             SELECT u2.avatar_color FROM event_assignments ea
             JOIN users u2 ON u2.id = ea.user_id
             WHERE ea.event_id = e.id
             ORDER BY ea.user_id
             LIMIT 1
           )) AS assigned_color,
           COALESCE(ec.color, isub.color) AS cal_color
    FROM calendar_events e
    LEFT JOIN users u ON u.id = e.assigned_to
    LEFT JOIN external_calendars ec ON ec.id = e.calendar_ref_id
    LEFT JOIN ics_subscriptions isub ON isub.id = e.subscription_id
    WHERE e.countdown = 1
      AND ${visibilityWhere('e', 'event_assignments', 'event_id')}
  `).all(userId, userId);

  const exceptionsByEvent = loadEventExceptions(
    d,
    rows.filter((e) => e.recurrence_rule).map((e) => e.id),
  );
  const resolvedRows = resolveProjectedEventRows(d, rows, { lightweight: true });

  const out = [];
  for (const row of resolvedRows) {
    // A linked replacement is one concrete displayed occurrence. Resolution
    // intentionally inherits the master's RRULE for identity and presentation,
    // but the countdown must not expand that rule again from the moved DTSTART.
    const countdownEvent = row.is_occurrence_override
      ? { ...row, recurrence_rule: null }
      : row;
    const date = nextEventDate(countdownEvent, todayKey, exceptionsByEvent.get(row.id) ?? null, {
      graceDays, tz,
    });
    if (!date) continue;
    const days = daysBetween(todayKey, date);


    // wieder aufgehoben.
    if (days === null || days < -graceDays) continue;
    out.push({
      source: 'event',
      id: row.id,
      title: row.title,
      date,
      days_until: days,
      icon: row.icon || 'calendar',




      color: resolveEventColorOrNull({
        color: row.color,
        assigned_to: row.assigned_to,
        assigned_users: row.assigned_color ? [{ id: row.assigned_to, color: row.assigned_color }] : [],
        cal_color: row.cal_color,
      }),
      recurring: Boolean(row.recurrence_rule),
      ...(row.is_occurrence_override ? {
        series_id: row.series_id,
        recurrence_id: row.recurrence_id,
        is_occurrence_override: true,
        assignment_owner_id: row.assignment_owner_id,
        attachment_owner_id: row.attachment_owner_id,
        reminder_owner_id: row.reminder_owner_id,
        reminder_anchor_start: row.reminder_anchor_start,
      } : {}),
    });
  }
  return out;
}

function taskCountdowns(d, userId, todayKey, graceDays) {




  //



  // sie laufen nicht ab.
  const floor = shiftKey(todayKey, -graceDays) ?? todayKey;
  const rows = d.prepare(`
    SELECT t.id, t.title, t.due_date, t.is_recurring, t.recurrence_from_completion
    FROM tasks t
    WHERE t.countdown = 1
      AND t.status != 'done'
      AND t.archived_at IS NULL
      AND t.due_date IS NOT NULL
      AND t.due_date >= CASE WHEN t.is_recurring = 1 THEN @today ELSE @floor END
      AND ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}
  `).all({ today: todayKey, floor, me: userId });

  const out = [];
  for (const row of rows) {
    const days = daysBetween(todayKey, row.due_date);
    if (days === null || days < -graceDays) continue;
    out.push({
      source: 'task',
      id: row.id,
      title: row.title,
      date: row.due_date,
      days_until: days,
      icon: 'check-square',
      color: null,
      recurring: Boolean(row.is_recurring),
    });
  }
  return out;
}
