
import { nextOccurrence, parseRRule, matchesRRuleByday } from './recurrence.js';
import { hasExplicitZone, localToUTC, utcToWall } from '../utils/timezone.js';

const DEFAULT_EXPANSION_ITERATIONS = 1000;
export const MAX_EXPANSION_ITERATIONS = 100000;


export const ASSIGNED_USERS_SQL = `(
  SELECT json_group_array(json_object(
    'id', u.id, 'display_name', u.display_name, 'color', u.avatar_color,
    'avatar_data', u.avatar_data
  ))
  FROM event_assignments ea JOIN users u ON u.id = ea.user_id
  WHERE ea.event_id = e.id
) AS assigned_users_json`;

export const SOURCE_CALENDAR_JOIN = `LEFT JOIN external_calendars src ON src.id = COALESCE(
  (SELECT tm.id FROM external_calendars tm
    WHERE tm.source = e.external_source AND tm.external_id = e.outbound_move_to),
  e.calendar_ref_id,
  (SELECT tg.id FROM external_calendars tg
    WHERE tg.source = 'google' AND tg.external_id = e.target_google_calendar_id),
  (SELECT tc.id FROM external_calendars tc
    WHERE tc.source = 'caldav' AND tc.external_id = e.target_caldav_calendar_url)
)`;

export const SOURCE_CALENDAR_COLUMNS = `src.id    AS source_calendar_ref_id,
  src.name  AS source_calendar_name,
  src.color AS source_calendar_color`;

export function loadEventExceptions(d, eventIds) {
  const map = new Map();
  if (!eventIds || eventIds.length === 0) return map;
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = d.prepare(
    `SELECT event_id, exception_date FROM calendar_event_exceptions WHERE event_id IN (${placeholders})`
  ).all(...eventIds);
  for (const row of rows) {
    if (!map.has(row.event_id)) map.set(row.event_id, new Set());
    map.get(row.event_id).add(row.exception_date);
  }
  return map;
}

// --------------------------------------------------------

// innerhalb [from, to] generieren (inklusive beider Grenzen).
// --------------------------------------------------------

export function expandRecurringEvents(
  events,
  from,
  to,
  exceptionsByEvent = null,
  {
    includeRecurrenceIdentity = false, maxIterations = DEFAULT_EXPANSION_ITERATIONS,
    maxOccurrencesPerSeries = null, occurrenceFilter = null,
  } = {},
) {
  const result = [];
  const iterationLimit = Number.isInteger(maxIterations) && maxIterations > 0
    ? Math.min(maxIterations, MAX_EXPANSION_ITERATIONS)
    : DEFAULT_EXPANSION_ITERATIONS;
  const occurrenceLimit = Number.isInteger(maxOccurrencesPerSeries) && maxOccurrencesPerSeries > 0
    ? Math.min(maxOccurrencesPerSeries, iterationLimit)
    : Infinity;

  for (const event of events) {
    if (!event.recurrence_rule) {
      result.push(event);
      continue;
    }


    const startMs    = new Date(event.start_datetime).getTime();
    const endMs      = event.end_datetime ? new Date(event.end_datetime).getTime() : null;
    const durationMs = endMs !== null ? endMs - startMs : null;
    // Duration in days for all-day events (for date-only end calculation)
    const isAllDay     = !!event.all_day;
    const durationDays = isAllDay && durationMs !== null ? Math.round(durationMs / 86400000) : 0;


    const timeSuffix = event.start_datetime.slice(10);

    // DST-korrekte Expansion: bei bekannter TZID (CalDAV/Apple-Serie) pro Vorkommen




    const wall = (event.tzid && !isAllDay) ? utcToWall(event.start_datetime, event.tzid) : null;
    const tzAware = wall && wall.date === event.start_datetime.slice(0, 10);
    // Einmal bestimmt, an beide Stellen gereicht: Filter UND Berechnung muessen

    const zonenUnsicher = !!event.tzid && !tzAware;

    const lokalRechnen = zonenUnsicher && !!wall && !isAllDay;



    // kurzen Monat wuerde damit festgeschrieben (#978).
    const seriesStartUtc = event.start_datetime.slice(0, 10);
    const seriesStart = lokalRechnen ? wall.date : seriesStartUtc;

    const instantFuer = (tag) => (lokalRechnen
      ? localToUTC(`${tag}T${wall.time}`, event.tzid)
      : (tzAware ? localToUTC(`${tag}T${wall.time}`, event.tzid) : tag + timeSuffix));
    const utcTagFuer = (tag) => (lokalRechnen ? String(instantFuer(tag)).slice(0, 10) : tag);

    let currentDate = seriesStart;
    let iterations  = 0;
    const exceptions = exceptionsByEvent?.get(event.id) ?? null; // ausgenommene Instanz-Daten (#489)



    const maxCount   = parseRRule(event.recurrence_rule)?.count ?? null;
    let   occurrence = 0;
    let accepted = 0;

    while (currentDate <= to && iterations < iterationLimit) {
      iterations++;






      // #513).
      //

      // damit verbrauchte jeder uebersprungene Wochentag ein Vorkommen:





      // Vorkommen still zu verlieren.
      if (!matchesRRuleByday(currentDate, event.recurrence_rule, { utcDiffersFromLocal: lokalRechnen ? false : zonenUnsicher })) {
        const next = nextOccurrence(currentDate, event.recurrence_rule, { anchor: seriesStart, utcDiffersFromLocal: lokalRechnen ? false : zonenUnsicher });
        if (!next || next <= currentDate) break;
        currentDate = next;
        continue;
      }

      if (maxCount !== null && occurrence >= maxCount) break;
      occurrence++;


      // Import abgelegt worden (#985).
      if (exceptions?.has(utcTagFuer(currentDate))) {
        const next = nextOccurrence(currentDate, event.recurrence_rule, { anchor: seriesStart, utcDiffersFromLocal: lokalRechnen ? false : zonenUnsicher });
        if (!next || next <= currentDate) break;
        currentDate = next;
        continue;
      }

      // For multi-day events, check if the instance end reaches into [from, to]
      let instanceEnd = currentDate;
      if (isAllDay && durationDays > 0) {
        const d = new Date(currentDate + 'T00:00:00');
        d.setDate(d.getDate() + durationDays);
        instanceEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      if (currentDate >= from || instanceEnd >= from) {
        const newStart = instantFuer(currentDate);
        let newEnd = event.end_datetime;
        if (durationMs !== null) {
          if (isAllDay) {
            // Keep date-only format for all-day events
            const d = new Date(currentDate + 'T00:00:00');
            d.setDate(d.getDate() + durationDays);
            newEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          } else {
            const endDate = new Date(new Date(newStart).getTime() + durationMs);
            if (hasExplicitZone(newStart)) {
              newEnd = endDate.toISOString().replace('.000Z', 'Z');
            } else {
              const p = n => String(n).padStart(2, '0');
              newEnd = `${endDate.getFullYear()}-${p(endDate.getMonth() + 1)}-${p(endDate.getDate())}T${p(endDate.getHours())}:${p(endDate.getMinutes())}`;
            }
          }
        }

        const instance = {
          ...event,
          start_datetime:       newStart,
          end_datetime:         newEnd,


          //




          // dann etwas anderes. `utcTagFuer(currentDate)` haelt die urspruengliche
          // Bedeutung fest.
          //



          // `RECURRENCE-ID;TZID=Asia/Tokyo:20260108T080000`. Als lokaler Tag gelesen
          // traefe derselbe Wert das erste Vorkommen.
          //

          // oben ebenfalls im UTC-Raum nachgeschlagen
          // (`exceptions?.has(utcTagFuer(currentDate))`).
          ...(includeRecurrenceIdentity ? { recurrence_identity: utcTagFuer(currentDate) } : {}),
          is_recurring_instance: utcTagFuer(currentDate) !== seriesStartUtc ? 1 : 0,





          //




          // Zaehler steht hier ohnehin, weil COUNT ihn braucht.
          is_series_start: occurrence === 1 ? 1 : 0,
        };
        // Upcoming readers count only eligible results. Historical instances,
        // EXDATEs and instances rejected by the reader must not fill the cap.
        if (!occurrenceFilter || occurrenceFilter(instance)) {
          result.push(instance);
          accepted++;
          if (accepted >= occurrenceLimit) break;
        }
      }

      const next = nextOccurrence(currentDate, event.recurrence_rule, { anchor: seriesStart, utcDiffersFromLocal: lokalRechnen ? false : zonenUnsicher });
      if (!next || next <= currentDate) break;
      currentDate = next;
    }
  }

  return result.sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
}
