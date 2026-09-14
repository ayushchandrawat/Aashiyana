
import nodeFetch from 'node-fetch';
import { createLogger } from '../logger.js';
import * as db from '../db.js';
import { resolveHouseholdLocale } from '../utils/i18n.js';

const log = createLogger('Holidays');

const BASE_URL          = 'https://openholidaysapi.org';
const FETCH_TIMEOUT_MS  = 15_000;
const SYNC_YEARS_BACK   = 1;
const SYNC_YEARS_AHEAD  = 2;
const THROTTLE_MS       = 30 * 24 * 60 * 60 * 1000;



// SYNC_INTERVAL_MINUTES (Voreinstellung 15) ein neuer Anlauf.
const LANGUAGE_RETRY_MS = 60 * 60 * 1000;

// Injizierbare fetch-Implementierung (Default: node-fetch). Nur Tests

let fetchImpl = nodeFetch;
function __setFetchImpl(fn) { fetchImpl = fn ?? nodeFetch; }

// --------------------------------------------------------
// API-Abfragen
// --------------------------------------------------------

async function apiFetch(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getCountries() {





  let raw = [];
  try {
    raw = await apiFetch('/Countries');
  } catch (err) {
    log.warn(`Fetch /Countries failed (${err.message}) - serving the locally computed countries only`);
    raw = [];
  }
  const apiCountries = (raw ?? []).map((c) => ({
    isoCode: c.isoCode,
    name: resolveName(c.name),
  }));
  const apiCodes = new Set(apiCountries.map((c) => c.isoCode));
  const local = Object.keys(LOCAL_COUNTRIES)
    .filter((isoCode) => !apiCodes.has(isoCode))
    .map((isoCode) => ({ isoCode, name: LOCAL_COUNTRIES[isoCode].name, schoolHolidays: false }));
  return [...apiCountries, ...local].sort((a, b) => a.name.localeCompare(b.name));
}

async function getSubdivisions(countryIsoCode) {
  if (countryIsoCode === 'GB') return GB_SUBDIVISIONS.slice();
  const raw = await apiFetch(`/Subdivisions?countryIsoCode=${encodeURIComponent(countryIsoCode)}`);
  return (raw ?? []).map((s) => ({
    isoCode: s.isoCode ?? s.code,
    name: resolveName(s.name) || s.shortName || s.isoCode || s.code,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function getGroups(countryIsoCode, subdivisionCode) {
  // GB hat keine Schulferien-Gruppen (kein Datenanbieter, siehe getCountries)


  if (countryIsoCode === 'GB') return [];
  const raw = await apiFetch(`/Subdivisions?countryIsoCode=${encodeURIComponent(countryIsoCode)}`);
  const match = (raw ?? []).find((s) => (s.code ?? s.isoCode) === subdivisionCode);
  const groups = Array.isArray(match?.groups) ? match.groups : [];
  return groups
    .map((g) => ({
      code: g.code ?? g.isoCode,
      name: resolveName(g.name) || g.shortName || g.code || g.isoCode,
    }))
    .filter((g) => g.code)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveName(nameArr, preferLang = 'EN') {
  if (!Array.isArray(nameArr) || nameArr.length === 0) return '';
  const pick = (lang) => nameArr.find((n) => n.language === lang);
  return (pick(preferLang) ?? pick('EN') ?? nameArr[0]).text ?? '';
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

// --------------------------------------------------------
// Lokal berechnete Feiertage (#965)
//
// OpenHolidays deckt 36 Laender ab, ueberwiegend Europa plus BR/MX/ZA - kein








//




// aufgenommen: monderechnete Feiertage (z. B. islamische Feste - Mondsichtung,
// keine Formel), jahresweise dekretierte Bruecktage (Argentinien u. a.) und



// Einstellungen fuer genau diesen Fall.
// --------------------------------------------------------

const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n === -1) {
    const last = utcDate(year, month + 1, 0);
    const diff = (last.getUTCDay() - weekday + 7) % 7;
    return addDays(last, -diff);
  }
  const first = utcDate(year, month, 1);
  const diff = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, diff + (n - 1) * 7);
}

function lastMondayOnOrBefore(year, month, maxDay) {
  const d = utcDate(year, month, maxDay);
  const diff = (d.getUTCDay() - MON + 7) % 7;
  return addDays(d, -diff);
}

/** US-Beobachtungsregel: Samstag -> Freitag davor, Sonntag -> Montag danach. */
function usObserved(date) {
  const dow = date.getUTCDay();
  if (dow === SAT) return addDays(date, -1);
  if (dow === SUN) return addDays(date, 1);
  return date;
}

function sundayToMonday(date) {
  return date.getUTCDay() === SUN ? addDays(date, 1) : date;
}

function mondayised(date) {
  const dow = date.getUTCDay();
  if (dow !== SAT && dow !== SUN) return date;
  return addDays(date, (MON - dow + 7) % 7);
}

const PAIR_SHIFT_DAYS = {
  [MON]: [0, 0], [TUE]: [0, 0], [WED]: [0, 0], [THU]: [0, 0],
  [FRI]: [0, 2], [SAT]: [2, 2], [SUN]: [2, 0],
};

function mondayisedPair(day1Date) {
  const [off1, off2] = PAIR_SHIFT_DAYS[day1Date.getUTCDay()];
  return [addDays(day1Date, off1), addDays(day1Date, 1 + off2)];
}

function resolveLocalName(names, langCode) {
  if (typeof names === 'string') return names;
  const lang = String(langCode || '').toUpperCase();
  return names[lang] ?? names.EN ?? Object.values(names)[0];
}

function resolveRuleDate(rule, year) {
  switch (rule.type) {
    case 'fixed': return utcDate(year, rule.month, rule.day);
    case 'nth': return nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n);
    case 'lastMondayOnOrBefore': return lastMondayOnOrBefore(year, rule.month, rule.maxDay);
    case 'easter': return addDays(easterSunday(year), rule.offset);
    case 'table': {
      const raw = rule.dates[year];
      if (!raw) return null;
      const [m, d] = raw.split('-').map(Number);
      return utcDate(year, m, d);
    }
    default: throw new Error(`Unbekannter Regeltyp: ${rule.type}`);
  }
}

function applyObservance(date, observance) {
  switch (observance) {
    case 'us': return usObserved(date);
    case 'sundayToMonday': return sundayToMonday(date);
    case 'mondayised': return mondayised(date);
    default: return date;
  }
}

function expandCountryEntries(entries, year, langCode) {
  const out = [];
  for (const entry of entries) {
    if (entry.rule.type === 'pair') {
      const day1 = utcDate(year, entry.rule.month, entry.rule.day1);
      const [d1, d2] = mondayisedPair(day1);
      out.push([d1, entry.names[0]], [d2, entry.names[1]]);
      continue;
    }
    const base = resolveRuleDate(entry.rule, year);
    if (!base) continue;
    out.push([applyObservance(base, entry.observance), entry.names]);
  }
  return out
    .map(([date, names]) => {
      const iso = formatIsoDate(date);
      return { startDate: iso, endDate: iso, name: resolveLocalName(names, langCode) };
    })
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}

// ---- Brasilien ---------------------------------------------------------



// veraendert hat.
const BR_PUBLIC_HOLIDAYS = [
  { names: { PT: 'Confraternização Universal', EN: 'Universal Brotherhood Day' }, rule: { type: 'fixed', month: 1, day: 1 } },
  { names: { PT: 'Sexta-feira Santa', EN: 'Good Friday' }, rule: { type: 'easter', offset: -2 } },
  { names: { PT: 'Tiradentes', EN: 'Tiradentes Day' }, rule: { type: 'fixed', month: 4, day: 21 } },
  { names: { PT: 'Dia do Trabalho', EN: 'Labour Day' }, rule: { type: 'fixed', month: 5, day: 1 } },
  { names: { PT: 'Independência do Brasil', EN: 'Independence Day' }, rule: { type: 'fixed', month: 9, day: 7 } },
  { names: { PT: 'Nossa Senhora Aparecida', EN: 'Our Lady of Aparecida' }, rule: { type: 'fixed', month: 10, day: 12 } },
  { names: { PT: 'Finados', EN: "All Souls' Day" }, rule: { type: 'fixed', month: 11, day: 2 } },
  { names: { PT: 'Proclamação da República', EN: 'Republic Proclamation Day' }, rule: { type: 'fixed', month: 11, day: 15 } },
  { names: { PT: 'Dia Nacional de Zumbi e da Consciência Negra', EN: 'National Zumbi and Black Consciousness Day' }, rule: { type: 'fixed', month: 11, day: 20 } },
  { names: { PT: 'Natal', EN: 'Christmas Day' }, rule: { type: 'fixed', month: 12, day: 25 } },
];

// ---- USA ------------------------------------------------------------
// 11 Bundesfeiertage. Beobachtungsregel per Executive-Order-Praxis (OPM):
// Samstag -> Freitag davor, Sonntag -> Montag danach; die "n-ter Wochentag"-
// Feiertage fallen konstruktionsbedingt nie aufs Wochenende. Nur EN-Namen -
// bewusst dokumentierte Einschraenkung, siehe PR-Beschreibung.
const US_PUBLIC_HOLIDAYS = [
  { names: "New Year's Day", rule: { type: 'fixed', month: 1, day: 1 }, observance: 'us' },
  { names: 'Martin Luther King, Jr. Day', rule: { type: 'nth', month: 1, weekday: MON, n: 3 } },
  { names: "Washington's Birthday", rule: { type: 'nth', month: 2, weekday: MON, n: 3 } },
  { names: 'Memorial Day', rule: { type: 'nth', month: 5, weekday: MON, n: -1 } },
  { names: 'Juneteenth National Independence Day', rule: { type: 'fixed', month: 6, day: 19 }, observance: 'us' },
  { names: 'Independence Day', rule: { type: 'fixed', month: 7, day: 4 }, observance: 'us' },
  { names: 'Labor Day', rule: { type: 'nth', month: 9, weekday: MON, n: 1 } },
  { names: 'Columbus Day', rule: { type: 'nth', month: 10, weekday: MON, n: 2 } },
  { names: 'Veterans Day', rule: { type: 'fixed', month: 11, day: 11 }, observance: 'us' },
  { names: 'Thanksgiving Day', rule: { type: 'nth', month: 11, weekday: THU, n: 4 } },
  { names: 'Christmas Day', rule: { type: 'fixed', month: 12, day: 25 }, observance: 'us' },
];

// ---- Kanada -----------------------------------------------------------
// 10 landesweite gesetzliche Feiertage (fuer bundesrechtlich geregelte
// Arbeitsverhaeltnisse - der ueblich zitierte Referenzsatz). EN+FR-Namen,


//
// BEOBACHTUNG NUR SONNTAG->MONTAG (sundayToMonday oben), UNABHAENGIG PRO TAG -



// unveraenderte Boxing Day - auf denselben Montag (26.12.2022): zwei Zeilen,





// Victoria Day per Sonderregel (lastMondayOnOrBefore).
const CA_PUBLIC_HOLIDAYS = [
  { names: { EN: "New Year's Day", FR: "Jour de l'An" }, rule: { type: 'fixed', month: 1, day: 1 }, observance: 'sundayToMonday' },
  { names: { EN: 'Good Friday', FR: 'Vendredi saint' }, rule: { type: 'easter', offset: -2 } },
  { names: { EN: 'Victoria Day', FR: 'Fête de la Reine' }, rule: { type: 'lastMondayOnOrBefore', month: 5, maxDay: 24 } },
  { names: { EN: 'Canada Day', FR: 'Fête du Canada' }, rule: { type: 'fixed', month: 7, day: 1 }, observance: 'sundayToMonday' },
  { names: { EN: 'Labour Day', FR: 'Fête du Travail' }, rule: { type: 'nth', month: 9, weekday: MON, n: 1 } },
  { names: { EN: 'National Day for Truth and Reconciliation', FR: 'Journée nationale de la vérité et de la réconciliation' }, rule: { type: 'fixed', month: 9, day: 30 } },
  { names: { EN: 'Thanksgiving', FR: 'Action de grâce' }, rule: { type: 'nth', month: 10, weekday: MON, n: 2 } },
  { names: { EN: 'Remembrance Day', FR: 'Jour du Souvenir' }, rule: { type: 'fixed', month: 11, day: 11 }, observance: 'sundayToMonday' },
  { names: { EN: 'Christmas Day', FR: 'Noël' }, rule: { type: 'fixed', month: 12, day: 25 }, observance: 'sundayToMonday' },
  { names: { EN: 'Boxing Day', FR: 'Lendemain de Noël' }, rule: { type: 'fixed', month: 12, day: 26 }, observance: 'sundayToMonday' },
];

// ---- Vereinigtes Koenigreich --------------------------------------------





// Auswahl dafuer; ohne gewaehlte Subdivision gilt England & Wales.
const GB_ENGLAND_WALES_HOLIDAYS = [
  { names: "New Year's Day", rule: { type: 'fixed', month: 1, day: 1 }, observance: 'mondayised' },
  { names: 'Good Friday', rule: { type: 'easter', offset: -2 } },
  { names: 'Easter Monday', rule: { type: 'easter', offset: 1 } },
  { names: 'Early May Bank Holiday', rule: { type: 'nth', month: 5, weekday: MON, n: 1 } },
  { names: 'Spring Bank Holiday', rule: { type: 'nth', month: 5, weekday: MON, n: -1 } },
  { names: 'Summer Bank Holiday', rule: { type: 'nth', month: 8, weekday: MON, n: -1 } },
  { names: ['Christmas Day', 'Boxing Day'], rule: { type: 'pair', month: 12, day1: 25 } },
];

const GB_SCOTLAND_HOLIDAYS = [

  { names: ["New Year's Day", '2nd January'], rule: { type: 'pair', month: 1, day1: 1 } },
  { names: 'Good Friday', rule: { type: 'easter', offset: -2 } },
  { names: 'Early May Bank Holiday', rule: { type: 'nth', month: 5, weekday: MON, n: 1 } },
  { names: 'Spring Bank Holiday', rule: { type: 'nth', month: 5, weekday: MON, n: -1 } },


  { names: 'Summer Bank Holiday', rule: { type: 'nth', month: 8, weekday: MON, n: 1 } },







  { names: "St Andrew's Day", rule: { type: 'fixed', month: 11, day: 30 }, observance: 'mondayised' },
  { names: ['Christmas Day', 'Boxing Day'], rule: { type: 'pair', month: 12, day1: 25 } },
];

const GB_NORTHERN_IRELAND_HOLIDAYS = [
  ...GB_ENGLAND_WALES_HOLIDAYS.slice(0, -1),
  { names: "St Patrick's Day", rule: { type: 'fixed', month: 3, day: 17 }, observance: 'mondayised' },
  { names: 'Battle of the Boyne (Orangemen’s Day)', rule: { type: 'fixed', month: 7, day: 12 }, observance: 'mondayised' },
  ...GB_ENGLAND_WALES_HOLIDAYS.slice(-1),
];

const GB_SUBDIVISIONS = [
  { isoCode: 'GB-ENG', name: 'England and Wales' },
  { isoCode: 'GB-NIR', name: 'Northern Ireland' },
  { isoCode: 'GB-SCT', name: 'Scotland' },
];

function gbHolidaysFor(subdivision) {
  if (subdivision === 'GB-SCT') return GB_SCOTLAND_HOLIDAYS;
  if (subdivision === 'GB-NIR') return GB_NORTHERN_IRELAND_HOLIDAYS;
  return GB_ENGLAND_WALES_HOLIDAYS;
}

// ---- Australien ---------------------------------------------------------

// Bundesgesetz dafuer, jeder Bundesstaat erlaesst seine eigene Ersatztag-
// Regel (siehe #965-Recherche) - ein erfundenes bundesweites Ausweichdatum

// Bundesstaat variieren (Queen's/King's Birthday, Labour Day), bleiben aussen

const AU_PUBLIC_HOLIDAYS = [
  { names: "New Year's Day", rule: { type: 'fixed', month: 1, day: 1 } },
  { names: 'Australia Day', rule: { type: 'fixed', month: 1, day: 26 } },
  { names: 'Good Friday', rule: { type: 'easter', offset: -2 } },
  { names: 'Easter Monday', rule: { type: 'easter', offset: 1 } },
  { names: 'Anzac Day', rule: { type: 'fixed', month: 4, day: 25 } },
  { names: 'Christmas Day', rule: { type: 'fixed', month: 12, day: 25 } },
  { names: 'Boxing Day', rule: { type: 'fixed', month: 12, day: 26 } },
];

// ---- Neuseeland -----------------------------------------------------------
// "Mondayisation" seit Holidays (Full Recognition of Waitangi Day and ANZAC
// Day) Amendment Act 2013 fuer sechs feste Termine (Neujahr/2. Januar als
// Paar, Waitangi, Anzac, Weihnachten/Boxing Day als Paar) - King's Birthday,


//




// 2052 liefert resolveRuleDate() bewusst `null` statt zu raten.
const NZ_MATARIKI_DATES = {
  2022: '06-24', 2023: '07-14', 2024: '06-28', 2025: '06-20', 2026: '07-10',
  2027: '06-25', 2028: '07-14', 2029: '07-06', 2030: '06-21', 2031: '07-11',
  2032: '07-02', 2033: '06-24', 2034: '07-07', 2035: '06-29', 2036: '07-18',
  2037: '07-10', 2038: '06-25', 2039: '07-15', 2040: '07-06', 2041: '07-19',
  2042: '07-11', 2043: '07-03', 2044: '06-24', 2045: '07-07', 2046: '06-29',
  2047: '07-19', 2048: '07-03', 2049: '06-25', 2050: '07-15', 2051: '06-30',
  2052: '06-21',
};

const NZ_PUBLIC_HOLIDAYS = [
  { names: ["New Year's Day", 'Day after New Year’s Day'], rule: { type: 'pair', month: 1, day1: 1 } },
  { names: 'Waitangi Day', rule: { type: 'fixed', month: 2, day: 6 }, observance: 'mondayised' },
  { names: 'Good Friday', rule: { type: 'easter', offset: -2 } },
  { names: 'Easter Monday', rule: { type: 'easter', offset: 1 } },
  { names: 'Anzac Day', rule: { type: 'fixed', month: 4, day: 25 }, observance: 'mondayised' },
  { names: "King's Birthday", rule: { type: 'nth', month: 6, weekday: MON, n: 1 } },
  { names: 'Matariki', rule: { type: 'table', dates: NZ_MATARIKI_DATES } },
  { names: 'Labour Day', rule: { type: 'nth', month: 10, weekday: MON, n: 4 } },
  { names: ['Christmas Day', 'Boxing Day'], rule: { type: 'pair', month: 12, day1: 25 } },
];

const LOCAL_COUNTRIES = {
  BR: { name: 'Brazil', holidays: () => BR_PUBLIC_HOLIDAYS },
  US: { name: 'United States', holidays: () => US_PUBLIC_HOLIDAYS },
  CA: { name: 'Canada', holidays: () => CA_PUBLIC_HOLIDAYS },
  GB: { name: 'United Kingdom', holidays: (subdivision) => gbHolidaysFor(subdivision) },
  AU: { name: 'Australia', holidays: () => AU_PUBLIC_HOLIDAYS },
  NZ: { name: 'New Zealand', holidays: () => NZ_PUBLIC_HOLIDAYS },
};

function localHolidayFallback(country, type, year, langCode, subdivision) {
  if (type !== 'public') return [];
  const local = LOCAL_COUNTRIES[country];
  if (!local) return [];
  return expandCountryEntries(local.holidays(subdivision), year, langCode);
}

// --------------------------------------------------------
// Sync-Logik
// --------------------------------------------------------

function finishEmpty(fetchFailed, country, type, year) {
  if (fetchFailed) return { count: 0, failed: true };
  db.get().prepare('DELETE FROM holiday_cache WHERE type = ? AND country = ? AND year = ?')
    .run(type, country, year);
  return { count: 0, failed: false };
}

async function syncYearAndType(country, subdivision, year, type, langCode) {
  const from = `${year}-01-01`;
  const to   = `${year}-12-31`;
  const endpoint = type === 'public' ? 'PublicHolidays' : 'SchoolHolidays';










  let params = `countryIsoCode=${encodeURIComponent(country)}&validFrom=${from}&validTo=${to}`;
  if (subdivision) params += `&subdivisionCode=${encodeURIComponent(subdivision)}`;

  let holidays;
  let fetchFailed = false;






  // Voraus bekannten sinnlosen Abrufs abhaengig zu machen. Schulferien nehmen

  // Antwort bleibt dort die ehrliche Auskunft.
  if (type === 'public' && LOCAL_COUNTRIES[country]) {
    holidays = localHolidayFallback(country, type, year, langCode, subdivision);
  } else {
    try {
      holidays = await apiFetch(`/${endpoint}?${params}`);



      // leeren Bereich RAEUMT, waere daraus Datenverlust geworden: der Cache



      if (!Array.isArray(holidays)) {
        log.warn(`Fetch ${endpoint} ${country}/${subdivision ?? '-'}/${year}: unexpected response shape (${typeof holidays})`);
        fetchFailed = true;
      }
    } catch (err) {
      log.warn(`Fetch ${endpoint} ${country}/${subdivision ?? '-'}/${year}: ${err.message}`);
      fetchFailed = true;
      holidays = localHolidayFallback(country, type, year, langCode, subdivision);
    }
  }

  if (!Array.isArray(holidays) || holidays.length === 0) {
    holidays = localHolidayFallback(country, type, year, langCode, subdivision);
  }
  if (!Array.isArray(holidays) || holidays.length === 0) return finishEmpty(fetchFailed, country, type, year);








  // Insel-Ausnahmen werden verworfen. (#434)
  holidays = holidays.filter((h) => !(Array.isArray(h.tags) && h.tags.includes('Exception')));
  if (holidays.length === 0) return finishEmpty(fetchFailed, country, type, year);

  const insert = db.get().prepare(`
    INSERT INTO holiday_cache (type, country, subdivision, start_date, end_date, name, year, group_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.get().transaction((rows) => {
    for (const h of rows) {
      const name = typeof h.name === 'string'
        ? h.name
        : resolveName(h.name, langCode);
      // Schulferien-Gruppe (z. B. CH-BE-VS), falls die Subdivision mehrere


      const groupCode = Array.isArray(h.groups) && h.groups.length > 0
        ? (h.groups[0].code ?? h.groups[0].isoCode ?? null)
        : null;
      insert.run(type, country, subdivision ?? null, h.startDate, h.endDate, name, year, groupCode);
    }
  });





  db.get().prepare(
    'DELETE FROM holiday_cache WHERE type = ? AND country = ? AND year = ?'
  ).run(type, country, year);

  insertAll(holidays);
  return { count: holidays.length, failed: false };
}

let laufenderSync = Promise.resolve();

async function sync(force = false) {
  const dran = laufenderSync.then(() => syncNow(force), () => syncNow(force));


  laufenderSync = dran.then(() => {}, () => {});
  return dran;
}

async function syncNow(force = false) {
  const country     = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_country'").get()?.value;
  const subdivision = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_subdivision'").get()?.value ?? null;
  const showPublic  = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_show_public'").get()?.value === '1';
  const showSchool  = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_show_school'").get()?.value === '1';

  if (!country) {
    log.debug('No holiday country configured – skipping sync.');
    return { synced: 0 };
  }

  if (!showPublic && !showSchool) {
    log.debug('Both holiday layers disabled – skipping sync.');
    return { synced: 0 };
  }





  // Synchronisierung" verspricht (#946). Feiertage SIND selbst erzeugte


  // Darlehensraten und Benachrichtigungen ihre Sprache holen.
  const langCode = resolveHouseholdLocale(db.get()).toUpperCase();




  //






  const scope = [langCode, country, subdivision ?? '', showPublic ? 'P' : '', showSchool ? 'S' : ''].join('|');
  const lastScope = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync_scope'").get()?.value ?? null;
  const scopeChanged = lastScope !== scope;







  const retryAfterStr = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_retry_after'").get()?.value;
  const retryScope    = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_retry_scope'").get()?.value;
  const repairOpen    = Boolean(retryAfterStr) && retryScope === scope;
  if (!force && repairOpen) {
    const retryAfter = new Date(retryAfterStr);
    if (!Number.isNaN(retryAfter.getTime()) && Date.now() < retryAfter.getTime()) {
      log.debug('Holiday repair is still on hold – skipping automatic sync.');
      return { synced: 0 };
    }
  }


  //



  // `scopeChanged` ohnehin wahr. Eine zusaetzliche `!repairOpen`-Bedingung stand


  const lastSyncStr = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync'").get()?.value;
  if (!force && !scopeChanged && lastSyncStr) {
    const lastSyncDate = new Date(lastSyncStr);
    if (!Number.isNaN(lastSyncDate.getTime()) && Date.now() - lastSyncDate.getTime() < THROTTLE_MS) {
      log.debug('Holidays synced recently – skipping automatic sync.');
      return { synced: 0 };
    }
  }

  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - SYNC_YEARS_BACK; y <= currentYear + SYNC_YEARS_AHEAD; y++) {
    years.push(y);
  }







  //
  // Sie zu loeschen waere konsistent gewesen, haette aber alte Jahre leer





  if (scopeChanged) {
    const imCache = db.get().prepare('SELECT DISTINCT year FROM holiday_cache WHERE country = ? ORDER BY year').all(country);
    for (const { year } of imCache) {
      if (!years.includes(year)) years.push(year);
    }
  }

  let total = 0;
  let anyFailed = false;
  for (const year of years) {
    for (const type of [showPublic && 'public', showSchool && 'school'].filter(Boolean)) {
      const res = await syncYearAndType(country, subdivision, year, type, langCode);
      total += res.count;
      anyFailed ||= res.failed;
    }
  }

  const now = new Date().toISOString();
  const remember = db.get().prepare(`
    INSERT INTO sync_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                   updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  `);
  remember.run('holiday_last_sync', now);





  // zugeht (#839).
  const forget = db.get().prepare('DELETE FROM sync_config WHERE key = ?');
  if (anyFailed) {

    // Teilfehlschlag steht der Cache GEMISCHT da - einige Bereiche neu, andere




    // Dauerschleife steht die Reparaturmarke.
    forget.run('holiday_last_sync_scope');
    remember.run('holiday_retry_after', new Date(Date.now() + LANGUAGE_RETRY_MS).toISOString());
    remember.run('holiday_retry_scope', scope);
  } else {
    remember.run('holiday_last_sync_scope', scope);
    forget.run('holiday_retry_after');
    forget.run('holiday_retry_scope');
  }





  const wo = `${country}${subdivision ? '/' + subdivision : ''}`;
  if (anyFailed) log.warn(`Holiday sync INCOMPLETE: ${total} entries for ${wo} - some requests failed, the next run retries`);
  else log.info(`Holiday sync complete: ${total} entries for ${wo}`);
  return { synced: total, lastSync: now, incomplete: anyFailed };
}

function mergeOverlappingByName(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.type}\x00${r.name}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  const out = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));
    let cur = null;
    for (const r of group) {

      if (cur && r.start_date <= cur.end_date) {
        if (r.end_date > cur.end_date) cur.end_date = r.end_date;
        cur.id = Math.min(cur.id, r.id);
      } else {
        cur = { ...r };
        out.push(cur);
      }
    }
  }

  out.sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));
  return out;
}

function getForRange(from, to) {
  const country     = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_country'").get()?.value;
  const subdivision = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_subdivision'").get()?.value ?? null;
  const group       = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_group'").get()?.value || null;
  const showPublic  = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_show_public'").get()?.value === '1';
  const showSchool  = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_show_school'").get()?.value === '1';
  const pubColor    = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_public_color'").get()?.value ?? '#FF3B30';
  const schColor    = db.get().prepare("SELECT value FROM sync_config WHERE key='holiday_school_color'").get()?.value ?? '#34C759';

  if (!country || (!showPublic && !showSchool)) return [];

  const types = [];
  if (showPublic) types.push('public');
  if (showSchool) types.push('school');

  const placeholders = types.map(() => '?').join(', ');






  const groupClause = group ? 'AND (group_code IS NULL OR group_code = ?)' : '';
  const groupArgs   = group ? [group] : [];




  // Cache-Bestand nie sauber neu synchronisiert wurde. (#434)
  const rows = db.get().prepare(`
    SELECT MIN(id) AS id, type, start_date, end_date, name
    FROM holiday_cache
    WHERE country = ?
      AND (subdivision IS NULL OR subdivision = ? OR subdivision = '')
      ${groupClause}
      AND type IN (${placeholders})
      AND start_date <= ?
      AND end_date   >= ?
    GROUP BY type, start_date, end_date, name
    ORDER BY start_date ASC
  `).all(country, subdivision ?? '', ...groupArgs, ...types, to, from);

  // OpenHolidays modelliert innerhalb EINER Subdivision teils mehrere
  // gleichnamige Schulferien-Varianten mit abweichenden Datumsbereichen –


  // unterschiedliche Start-/Enddaten, daher greifen weder der sync-seitige




  // Ferientage) bleiben bewusst getrennt. (#434)
  const merged = mergeOverlappingByName(rows);

  return merged.map((r) => ({
    ...r,
    color: r.type === 'public' ? pubColor : schColor,
  }));
}

export { sync, getCountries, getSubdivisions, getGroups, getForRange, __setFetchImpl };

// Reine Regel-Engine fuer #965: hand-verifizierte Jahres-Fixtures (siehe
// test-holidays.js) laufen direkt hierueber statt ueber sync()'s begrenztes

// 2028 (Samstag -> Silvester 2027) unabhaengig vom aktuellen Kalenderjahr

export const __test = { localHolidayFallback, expandCountryEntries, LOCAL_COUNTRIES };
