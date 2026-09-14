
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = fileURLToPath(new URL('../../public/locales/', import.meta.url));



const REFERENCE_LOCALE = 'de';



// ("Birthday: <Name>") - ein Bestandshaushalt erlebt so keinen stillen Wechsel.
const DEFAULT_LOCALE = 'en';

const LOCALE_FILE_RE = /^([a-z]{2})\.json$/;

let supportedLocales = null;
const localeCache = new Map();

export function getSupportedLocales() {
  if (supportedLocales) return supportedLocales;
  try {
    supportedLocales = readdirSync(LOCALES_DIR)
      .map((file) => file.match(LOCALE_FILE_RE)?.[1])
      .filter(Boolean)
      .sort();
  } catch {
    supportedLocales = [DEFAULT_LOCALE];
  }
  if (!supportedLocales.length) supportedLocales = [DEFAULT_LOCALE];
  return supportedLocales;
}

export function isSupportedLocale(locale) {
  return typeof locale === 'string' && getSupportedLocales().includes(locale);
}

function loadLocale(locale) {
  if (localeCache.has(locale)) return localeCache.get(locale);
  let data = null;
  if (isSupportedLocale(locale)) {
    try {
      data = JSON.parse(readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf8'));
    } catch {
      data = null;
    }
  }
  localeCache.set(locale, data);
  return data;
}

function resolveKey(obj, key) {
  return key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

export function translate(locale, key, params = {}) {
  const chain = [isSupportedLocale(locale) ? locale : DEFAULT_LOCALE, DEFAULT_LOCALE, REFERENCE_LOCALE];

  let str;
  for (const candidate of chain) {
    const hit = resolveKey(loadLocale(candidate), key);



    if (typeof hit === 'string') { str = hit; break; }
  }
  if (str === undefined) return key;











  return str.replace(/\{\{(\w+)\}\}/g, (placeholder, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
  ));
}

const VALID_DATE_FORMATS = ['mdy', 'dmy', 'ymd', 'mdy_dot', 'dmy_dot', 'dmy_slash', 'ymd_dot', 'ymd_slash'];

export function formatDateKey(dateKey, dateFormat = 'dmy') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ''));
  if (!match) return '';
  const [, year, month, day] = match;
  switch (VALID_DATE_FORMATS.includes(dateFormat) ? dateFormat : 'dmy') {
    case 'mdy':       return `${month}/${day}/${year}`;
    case 'mdy_dot':   return `${month}.${day}.${year}`;
    case 'dmy_dot':   return `${day}.${month}.${year}`;
    case 'dmy_slash': return `${day}/${month}/${year}`;
    case 'ymd':       return `${year}-${month}-${day}`;
    case 'ymd_dot':   return `${year}.${month}.${day}`;
    case 'ymd_slash': return `${year}/${month}/${day}`;
    default:          return `${day}.${month}.${year}`;
  }
}

function cfgValue(database, key) {
  try {
    return database.prepare('SELECT value FROM sync_config WHERE key = ?').get(key)?.value ?? null;
  } catch {
    return null;
  }
}

export function resolveHouseholdLocale(database, { ignoreExplicit = false } = {}) {
  if (!ignoreExplicit) {
    const explicit = cfgValue(database, 'language');
    if (isSupportedLocale(explicit)) return explicit;
  }

  const regionLanguage = /^([a-z]{2,3})-[A-Z]{2}$/.exec(cfgValue(database, 'region') ?? '')?.[1];
  if (isSupportedLocale(regionLanguage)) return regionLanguage;

  return DEFAULT_LOCALE;
}

export function resolveHouseholdFormats(database) {
  const dateFormat = cfgValue(database, 'date_format');
  return {
    locale: resolveHouseholdLocale(database),
    dateFormat: VALID_DATE_FORMATS.includes(dateFormat) ? dateFormat : 'dmy',
    currency: cfgValue(database, 'currency') || 'EUR',
  };
}

export function formatMoney(amount, { locale, currency, region = null }) {
  const numberLocale = /^[a-z]{2,3}-[A-Z]{2}$/.test(region ?? '') ? region : locale;
  try {
    return new Intl.NumberFormat(numberLocale, { style: 'currency', currency }).format(amount);
  } catch {
    return String(amount);
  }
}

export function householdRegion(database) {
  const region = cfgValue(database, 'region');
  return /^[a-z]{2,3}-[A-Z]{2}$/.test(region ?? '') ? region : null;
}

export { DEFAULT_LOCALE, REFERENCE_LOCALE };
