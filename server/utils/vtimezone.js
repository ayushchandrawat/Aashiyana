
import { utcToWall } from './timezone.js';

function pad(n) { return String(n).padStart(2, '0'); }





// generiertes VTIMEZONE, damit der Abonnent pro Vorkommen korrekt lokal → UTC rechnet.

// UTC-Instant (…Z) → ICS-Basic-Format der lokalen Wanduhrzeit ('YYYYMMDDTHHMMSS').
export function formatWall(iso, tzid) {
  const w = utcToWall(iso, tzid);
  if (!w) return null;
  return w.date.replace(/-/g, '') + 'T' + w.time.replace(/:/g, '');
}


function tzOffsetMinutes(utcMs, tzid) {
  const w = utcToWall(new Date(utcMs).toISOString(), tzid);
  if (!w) return 0;
  const [Y, Mo, D] = w.date.split('-').map(Number);
  const [H, Mi, S] = w.time.split(':').map(Number);
  return Math.round((Date.UTC(Y, Mo - 1, D, H, Mi, S) - utcMs) / 60000);
}

function fmtOffset(min) {
  const a = Math.abs(min);
  return (min < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + pad(a % 60);
}

function tzNameAt(utcMs, tzid) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tzid, timeZoneName: 'short', hour12: false })
      .formatToParts(new Date(utcMs));
    const p = parts.find((x) => x.type === 'timeZoneName');

    return p && !/^GMT|^UTC/.test(p.value) ? p.value : null;
  } catch { return null; }
}


function findTransitions(year, tzid) {
  const DAY = 86400000;
  const end = Date.UTC(year + 1, 0, 1);
  const out = [];
  let prevMs = Date.UTC(year, 0, 1);
  let prevOff = tzOffsetMinutes(prevMs, tzid);
  for (let t = prevMs + DAY; t <= end; t += DAY) {
    const off = tzOffsetMinutes(t, tzid);
    if (off !== prevOff) {
      let lo = prevMs, hi = t;
      while (hi - lo > 60000) {
        const mid = lo + Math.floor((hi - lo) / 120000) * 60000; // minutengenaue Mitte
        if (tzOffsetMinutes(mid, tzid) === prevOff) lo = mid; else hi = mid;
      }
      out.push({ instant: hi, offsetBefore: prevOff, offsetAfter: off });
    }
    prevMs = t; prevOff = off;
  }
  return out;
}


function bydayOf(d) {
  const dow = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getUTCDay()];
  const dom = d.getUTCDate();
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const nth = dom + 7 > daysInMonth ? -1 : Math.ceil(dom / 7);
  return `${nth}${dow}`;
}


//





// Wochen eine Stunde daneben.
//






function buildVTimezone(tzid, year) {
  const transitions = findTransitions(year, tzid);
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tzid}`];
  if (transitions.length === 0) {
    // Keine Sommerzeit: einzelne STANDARD-Komponente mit festem Offset.
    const off = tzOffsetMinutes(Date.UTC(year, 0, 1), tzid);
    const name = tzNameAt(Date.UTC(year, 0, 1), tzid);
    lines.push('BEGIN:STANDARD', `TZOFFSETFROM:${fmtOffset(off)}`, `TZOFFSETTO:${fmtOffset(off)}`);
    if (name) lines.push(`TZNAME:${name}`);
    lines.push('DTSTART:19700101T000000', 'END:STANDARD');
  } else {
    for (const tr of transitions) {
      const isDst = tr.offsetAfter > tr.offsetBefore; // Sprung nach vorne → Sommerzeit beginnt

      const onset = new Date(tr.instant + tr.offsetBefore * 60000);
      const name = tzNameAt(tr.instant, tzid);
      lines.push(
        isDst ? 'BEGIN:DAYLIGHT' : 'BEGIN:STANDARD',
        `TZOFFSETFROM:${fmtOffset(tr.offsetBefore)}`,
        `TZOFFSETTO:${fmtOffset(tr.offsetAfter)}`,
      );
      if (name) lines.push(`TZNAME:${name}`);
      lines.push(
        `DTSTART:${onset.getUTCFullYear()}${pad(onset.getUTCMonth() + 1)}${pad(onset.getUTCDate())}` +
          `T${pad(onset.getUTCHours())}${pad(onset.getUTCMinutes())}${pad(onset.getUTCSeconds())}`,
        `RRULE:FREQ=YEARLY;BYMONTH=${onset.getUTCMonth() + 1};BYDAY=${bydayOf(onset)}`,
        isDst ? 'END:DAYLIGHT' : 'END:STANDARD',
      );
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}



// Minutentakt - deshalb einmal rechnen und behalten.
const vtimezoneCache = new Map();
export function vtimezoneFor(tzid, year) {
  const key = `${tzid}|${year}`;
  let lines = vtimezoneCache.get(key);
  if (!lines) { lines = buildVTimezone(tzid, year); vtimezoneCache.set(key, lines); }
  return lines;
}
