
const DAY_MAP = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };





// ausrechnen laesst).
const BYDAY_TOKEN_RE = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;







const ORDINAL_BYDAY_VALUES = new Set([-1, 1, 2, 3, 4]);

function parseRRule(rule) {
  if (!rule) return null;
  // Strip "RRULE:" prefix if present (ICS stores rules as "RRULE:FREQ=...")
  const raw = rule.startsWith('RRULE:') ? rule.slice(6) : rule;
  const parts = {};
  for (const segment of raw.split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    parts[segment.slice(0, eq).toUpperCase()] = segment.slice(eq + 1);
  }

  const freq     = parts.FREQ ?? null;
  const freqRaw  = String(freq ?? '').toUpperCase();
  const interval = parseInt(parts.INTERVAL ?? '1', 10) || 1;
  // Jedes Token einzeln lesen: ein waagerechtes Ordinal-Praefix ("2MO") faellt




  const byDayEntries = (parts.BYDAY ?? '').split(',')
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean)
    .map((tok) => {
      const m = BYDAY_TOKEN_RE.exec(tok);
      if (!m) return null;
      return { ordinal: m[1] ? parseInt(m[1], 10) : null, weekday: DAY_MAP[m[2]] };
    })
    .filter((e) => e !== null);
  const byday = byDayEntries.filter((e) => e.ordinal === null).map((e) => e.weekday);




  let bydayOrdinal = null;
  if (freqRaw === 'MONTHLY' && byDayEntries.length === 1 && byDayEntries[0].ordinal !== null
    && ORDINAL_BYDAY_VALUES.has(byDayEntries[0].ordinal)) {
    bydayOrdinal = { ordinal: byDayEntries[0].ordinal, weekday: byDayEntries[0].weekday };
  }
  const until    = parts.UNTIL ? parseUntilDate(parts.UNTIL) : null;



  const countRaw = parts.COUNT ? parseInt(parts.COUNT, 10) : null;
  const count    = Number.isInteger(countRaw) && countRaw > 0 ? countRaw : null;






  //

  // gelesene, aber falsch gerechnete Angabe verschiebt Termine still, waehrend



  const bymonthday = freqRaw === 'MONTHLY' && String(parts.BYMONTHDAY ?? '').trim() === '-1'
    ? -1
    : null;

  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;

  return { freq, interval, byday, until, count, bymonthday, bydayOrdinal };
}

function nthWeekdayOfMonth(year, month, weekday, ordinal) {
  if (ordinal === -1) {
    const lastDate = new Date(Date.UTC(year, month + 1, 0));
    const diff = (lastDate.getUTCDay() - weekday + 7) % 7;
    return lastDate.getUTCDate() - diff;
  }
  const firstDate = new Date(Date.UTC(year, month, 1));
  const diff = (weekday - firstDate.getUTCDay() + 7) % 7;
  return 1 + diff + (ordinal - 1) * 7;
}

function isNthWeekdayOfMonth(day, weekday, ordinal) {
  if (day.getUTCDay() !== weekday) return false;
  return day.getUTCDate() === nthWeekdayOfMonth(day.getUTCFullYear(), day.getUTCMonth(), weekday, ordinal);
}

function monthDayFor(bymonthday, lastDay, fallbackDay) {
  if (bymonthday === -1) return lastDay;
  return Math.min(Math.max(fallbackDay, 1), lastDay);
}

function parseUntilDate(str) {
  // Akzeptiert YYYYMMDD oder YYYYMMDDTHHmmssZ
  const clean = str.replace(/[TZ]/g, '');
  const y = parseInt(clean.slice(0, 4), 10);
  const m = parseInt(clean.slice(4, 6), 10) - 1;
  const d = parseInt(clean.slice(6, 8), 10);
  return new Date(Date.UTC(y, m, d));
}

function nextOccurrence(baseDateStr, rrule, {
  anchor = null, fromArbitraryDate = false, utcDiffersFromLocal = false,
} = {}) {
  const parsed = parseRRule(rrule);
  if (!parsed || !baseDateStr) return null;

  const base = new Date(baseDateStr + 'T00:00:00Z');
  if (isNaN(base.getTime())) return null;



  const anchorDate = anchor ? new Date(anchor + 'T00:00:00Z') : null;
  const anchorDay = anchorDate && !isNaN(anchorDate.getTime()) ? anchorDate.getUTCDate() : null;

  const { freq, interval, byday, until } = parsed;
  const next = new Date(base);

  if (freq === 'DAILY' && byday.length === 0) {
    next.setUTCDate(next.getUTCDate() + interval);

  } else if (freq === 'WEEKLY' || (freq === 'DAILY' && byday.length > 0)) {
    if (byday.length === 0) {

      next.setUTCDate(next.getUTCDate() + 7 * interval);
    } else {


      // Apple/iOS serialisiert "jeden Werktag" so (#549).
      const weekInterval = freq === 'WEEKLY' ? interval : 1;

      const currentDay = base.getUTCDay();
      const sorted = [...byday].sort((a, b) => {
        const da = (a - currentDay + 7) % 7 || 7;
        const db = (b - currentDay + 7) % 7 || 7;
        return da - db;
      });

      let daysUntil = (sorted[0] - currentDay + 7) % 7;
      if (daysUntil === 0) {

        daysUntil = 7 * weekInterval;
      } else if ((sorted[0] + 6) % 7 < (currentDay + 6) % 7) {

        daysUntil += 7 * (weekInterval - 1);
      }
      next.setUTCDate(next.getUTCDate() + daysUntil);
    }

  } else if (freq === 'MONTHLY') {

    //








    //



    //











    //





    const year  = base.getUTCFullYear();
    let   month = base.getUTCMonth() + interval;
    let targetDay;
    if (parsed.bydayOrdinal) {




      const { weekday, ordinal } = parsed.bydayOrdinal;
      if (!fromArbitraryDate && !utcDiffersFromLocal) {
        const targetInBaseMonth = nthWeekdayOfMonth(year, base.getUTCMonth(), weekday, ordinal);
        if (base.getUTCDate() < targetInBaseMonth) month = base.getUTCMonth();
      }
      targetDay = nthWeekdayOfMonth(year, month, weekday, ordinal);
    } else {




      if (parsed.bymonthday === -1 && !fromArbitraryDate && !utcDiffersFromLocal) {
        const letzterImBasismonat = new Date(Date.UTC(year, base.getUTCMonth() + 1, 0)).getUTCDate();
        if (base.getUTCDate() < letzterImBasismonat) month = base.getUTCMonth();
      }
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();








      //





      const wirksam = utcDiffersFromLocal ? null : parsed.bymonthday;
      targetDay = monthDayFor(wirksam, lastDay, anchorDay ?? base.getUTCDate());
    }
    next.setTime(Date.UTC(year, month, targetDay));

  } else if (freq === 'YEARLY') {






    const targetMonth = anchorDay !== null ? anchorDate.getUTCMonth() : base.getUTCMonth();
    const year        = base.getUTCFullYear() + interval;
    const lastDay     = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();

    const targetDay = monthDayFor(parsed.bymonthday, lastDay, anchorDay ?? base.getUTCDate());
    next.setTime(Date.UTC(year, targetMonth, targetDay));
  }


  if (until && next > until) return null;

  return next.toISOString().slice(0, 10); // YYYY-MM-DD
}

const CATCH_UP_STEPS = 2000;

function fastForward(fromKey, parsed, notBeforeKey) {
  const { freq, interval, byday, bydayOrdinal } = parsed;



  if (byday.length || bydayOrdinal) return fromKey;

  const from = new Date(`${fromKey}T00:00:00Z`);
  const to   = new Date(`${notBeforeKey}T00:00:00Z`);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) return fromKey;
  if ((freq === 'MONTHLY' || freq === 'YEARLY') && from.getUTCDate() > 28) return fromKey;

  const days = Math.floor((to - from) / 86400000);
  let steps;
  if (freq === 'DAILY')       steps = Math.floor(days / interval);
  else if (freq === 'WEEKLY')  steps = Math.floor(days / (7 * interval));
  else {


    const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12
      + (to.getUTCMonth() - from.getUTCMonth());
    steps = Math.floor(months / (freq === 'YEARLY' ? 12 * interval : interval));
  }
  // Einen Schritt Sicherheitsabstand - siehe oben.
  steps -= 1;
  if (!Number.isFinite(steps) || steps <= 0) return fromKey;

  const jumped = new Date(from);
  if (freq === 'DAILY')        jumped.setUTCDate(jumped.getUTCDate() + steps * interval);
  else if (freq === 'WEEKLY')  jumped.setUTCDate(jumped.getUTCDate() + steps * 7 * interval);
  else if (freq === 'MONTHLY') jumped.setUTCMonth(jumped.getUTCMonth() + steps * interval);
  else                          jumped.setUTCFullYear(jumped.getUTCFullYear() + steps * interval);

  const key = jumped.toISOString().slice(0, 10);



  return key > notBeforeKey || key < fromKey ? fromKey : key;
}

function nextOccurrenceAfter(baseDateStr, rrule, notBeforeStr, { seriesStart = null } = {}) {
  const parsed = parseRRule(rrule);
  if (!parsed) return null;

  const lastAllowed = seriesStart ? lastOccurrenceOf(seriesStart, parsed) : null;

  if (lastAllowed && notBeforeStr && lastAllowed < notBeforeStr) return null;

  const start = notBeforeStr ? fastForward(baseDateStr, parsed, notBeforeStr) : baseDateStr;
  let current = nextOccurrence(start, rrule, { anchor: seriesStart });
  // Vergleich per lexikografischem YYYY-MM-DD-String (Format ist fix, daher sicher).
  let guard = 0;





  // Antworten auf dieselbe Frage, je nachdem wer fragt. `seriesStartFor` laeuft

  while (
    current
    && guard++ < CATCH_UP_STEPS
    && ((notBeforeStr && current < notBeforeStr) || !matchesRRuleByday(current, rrule))
  ) {
    current = nextOccurrence(current, rrule, { anchor: seriesStart });
  }




  if (current && !matchesRRuleByday(current, rrule)) return null;
  if (current && lastAllowed && current > lastAllowed) return null;
  return current;
}

function lastOccurrenceOf(seriesStart, parsed) {
  const { freq, interval, byday, count, bymonthday, bydayOrdinal } = parsed;







  // ebenfalls unbegrenzt gelassen.
  if (!count || byday.length) return null;

  const start = new Date(`${String(seriesStart).slice(0, 10)}T00:00:00Z`);
  if (isNaN(start.getTime())) return null;

  if (bydayOrdinal) {
    const { weekday, ordinal } = bydayOrdinal;






    // liegen"-Pruefung oben, nur umgekehrt geprueft.
    const targetInStartMonth = nthWeekdayOfMonth(start.getUTCFullYear(), start.getUTCMonth(), weekday, ordinal);
    const firstMonth = start.getUTCDate() <= targetInStartMonth ? start.getUTCMonth() : start.getUTCMonth() + 1;
    const zielMonat = firstMonth + (count - 1) * interval;
    const zielTag = nthWeekdayOfMonth(start.getUTCFullYear(), zielMonat, weekday, ordinal);
    return new Date(Date.UTC(start.getUTCFullYear(), zielMonat, zielTag)).toISOString().slice(0, 10);
  }

  if (bymonthday === -1) {





    const erstes = new Date(Date.UTC(
      start.getUTCFullYear(), start.getUTCMonth() + 1, 0
    )).toISOString().slice(0, 10);
    if (count === 1) return erstes;
    const zielMonat = start.getUTCMonth() + (count - 1) * interval;
    const letzter = new Date(Date.UTC(start.getUTCFullYear(), zielMonat + 1, 0));
    return letzter.toISOString().slice(0, 10);
  }

  if ((freq === 'MONTHLY' || freq === 'YEARLY') && start.getUTCDate() > 28) return null;

  const steps = count - 1;
  const last = new Date(start);
  if (freq === 'DAILY')        last.setUTCDate(last.getUTCDate() + steps * interval);
  else if (freq === 'WEEKLY')  last.setUTCDate(last.getUTCDate() + steps * 7 * interval);
  else if (freq === 'MONTHLY') last.setUTCMonth(last.getUTCMonth() + steps * interval);
  else if (freq === 'YEARLY')  last.setUTCFullYear(last.getUTCFullYear() + steps * interval);
  else return null;

  return last.toISOString().slice(0, 10);
}

function nextDueAfterCompletion({ anchorDate, rule, completedOn, fromCompletion = false }) {
  if (fromCompletion) {
    return completedOn ? nextOccurrence(completedOn, rule, { fromArbitraryDate: true }) : null;
  }
  return nextOccurrenceAfter(anchorDate, rule, completedOn);
}

function matchesRRuleByday(dateStr, rrule, { utcDiffersFromLocal = false } = {}) {
  const parsed = parseRRule(rrule);
  if (!parsed) return true;
  const day = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(day.getTime())) return true;






  //







  if (parsed.bymonthday === -1 && !utcDiffersFromLocal) {
    const letzter = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
    if (day.getUTCDate() !== letzter) return false;
  }




  if (parsed.bydayOrdinal && !utcDiffersFromLocal) {
    if (!isNthWeekdayOfMonth(day, parsed.bydayOrdinal.weekday, parsed.bydayOrdinal.ordinal)) return false;
  }

  if (parsed.byday.length === 0) return true;
  return parsed.byday.includes(day.getUTCDay());
}


export function rruleValue(rule) {
  return String(rule ?? '').replace(/^RRULE:/i, '');
}

export function rruleLine(rule) {
  return `RRULE:${rruleValue(rule)}`;
}

function hasAnyOccurrence(dateKey, rrule, { utcDiffersFromLocal = false } = {}) {
  if (!dateKey || !rrule) return true;
  const tag = String(dateKey).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag)) return true;
  const parsed = parseRRule(rrule);


  // Montag" der Serie liegen.
  if (parsed?.bymonthday !== -1 && !parsed?.bydayOrdinal) return true;
  return seriesStartFor(tag, rrule, { utcDiffersFromLocal }) !== tag
    || matchesRRuleByday(tag, rrule, { utcDiffersFromLocal });
}

function seriesStartFor(dateKey, rrule, { utcDiffersFromLocal = false } = {}) {
  if (!dateKey || !rrule) return dateKey;
  const tag = String(dateKey).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag)) return dateKey;


  // einfaches BYDAY-Muster nicht trifft, bleibt ausdruecklich stehen: Apple




  const parsedForStart = parseRRule(rrule);
  if (parsedForStart?.bymonthday !== -1 && !parsedForStart?.bydayOrdinal) return dateKey;
  if (matchesRRuleByday(tag, rrule, { utcDiffersFromLocal })) return dateKey;







  //



  // stehen - lieber unveraendert als erfunden.
  let kandidat = tag;
  for (let i = 0; i < 120; i++) {
    const next = nextOccurrence(kandidat, rrule, { anchor: tag });
    if (!next || next <= kandidat) return dateKey;
    kandidat = next;
    if (matchesRRuleByday(kandidat, rrule, { utcDiffersFromLocal })) return String(dateKey).replace(tag, kandidat);
  }
  return dateKey;
}

export {
  parseRRule, nextOccurrence, nextOccurrenceAfter, nextDueAfterCompletion, matchesRRuleByday,
  seriesStartFor, hasAnyOccurrence,
};
