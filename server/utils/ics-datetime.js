
import { isValidTimeZone } from './timezone.js';
import { formatWall } from './vtimezone.js';
import { toICSDatetime } from './ics-format.js';

export function hasExplicitOffset(value) {
  return /Z$|[+-]\d{2}:?\d{2}$/.test(String(value || ''));
}

export function anchorZone(tz) {
  const zone = String(tz || '').trim();
  if (!zone) return null;
  if (/^(UTC|GMT|Z|Etc\/(UTC|GMT|GMT0|GMT\+0|GMT-0|Zulu|Universal|Greenwich))$/i.test(zone)) return null;
  return isValidTimeZone(zone) ? zone : null;
}

function dateOnly(value) {
  return String(value).slice(0, 10).replace(/-/g, '');
}

function dateOnlyExclusive(value) {
  const d = new Date(String(value).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

export function eventDateTimeFields(event, householdZone = null) {
  const endSource = event.end_datetime || event.start_datetime;


  if (event.all_day) {
    return {
      dtstart: { value: dateOnly(event.start_datetime), params: ';VALUE=DATE' },
      dtend:   { value: dateOnlyExclusive(endSource),   params: ';VALUE=DATE' },
      tzid: null,
    };
  }

  const zoneOfEvent = anchorZone(event.tzid);
  const naive = !hasExplicitOffset(event.start_datetime);







  //


  const wallIn = (zone) => (value) => (hasExplicitOffset(value)
    ? formatWall(value, zone)
    : toICSDatetime(value));



  const utc = (value) => (hasExplicitOffset(value)
    ? toICSDatetime(value)
    : `${toICSDatetime(value)}Z`);


  //    jedes Vorkommen selbst DST-korrekt rechnet. Ein fixes UTC-Suffix liesse


  if (zoneOfEvent && event.recurrence_rule && !naive) {
    const params = `;TZID=${zoneOfEvent}`;
    const wall = wallIn(zoneOfEvent);
    return {
      dtstart: { value: wall(event.start_datetime), params },
      dtend:   { value: wall(endSource),            params },
      tzid: zoneOfEvent,
    };
  }



  if (!naive) {
    return {
      dtstart: { value: utc(event.start_datetime), params: '' },
      dtend:   { value: utc(endSource),            params: '' },
      tzid: null,
    };
  }



  //    floating time aus #938 hinaus.
  const zone = zoneOfEvent || anchorZone(householdZone);
  const params = zone ? `;TZID=${zone}` : '';
  const suffix = zone ? '' : 'Z';
  return {
    dtstart: { value: toICSDatetime(event.start_datetime) + suffix, params },
    dtend:   { value: toICSDatetime(endSource) + suffix,            params },
    tzid: zone,
  };
}
