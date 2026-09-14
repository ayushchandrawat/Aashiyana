



import { zonedFields } from './utils/timezone.js';

const SUPPORTED_LOCALES = ['de', 'en', 'es', 'fr', 'it', 'sv', 'el', 'ru', 'tr', 'zh', 'ja', 'ar', 'hi', 'pt', 'uk', 'pl', 'nl', 'cs', 'vi', 'hu', 'ko', 'id', 'fa', 'fil'];
const RTL_LOCALES = new Set(['ar', 'fa']);
const DEFAULT_LOCALE = 'de';
const STORAGE_KEY = 'aashiyana-locale';
const DATE_FORMAT_KEY = 'aashiyana-date-format';
const TIME_FORMAT_KEY = 'aashiyana-time-format';
const NUMBER_LOCALE_KEY = 'aashiyana-number-locale';
const DEFAULT_DATE_FORMAT = 'dmy';
const DEFAULT_TIME_FORMAT = '24h';
const VALID_TIME_FORMATS = ['24h', '12h'];

let currentLocale = DEFAULT_LOCALE;
let translations = {};
let fallbackTranslations = {};
/** Third-party bundles: moduleId -> { defaultLocale, trees: { [locale]: nested } } */
let extensionLocaleStore = Object.create(null);
let i18nReady = false;
let resolveI18nReady;
const i18nReadyPromise = new Promise((resolve) => {
  resolveI18nReady = resolve;
});

function applyDocumentLocale(locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

/** Resolve locale: manual override > navigator.language > English > default */
function resolveLocale() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;

  const browserLocales = navigator.languages || [navigator.language];
  for (const tag of browserLocales) {
    const base = tag.split('-')[0].toLowerCase();
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return 'en';
}

/** Lade eine Locale-JSON-Datei */
async function loadLocale(locale) {
  const resp = await fetch(`/locales/${locale}.json`);
  if (!resp.ok) throw new Error(`Failed to load locale: ${locale}`);
  return resp.json();
}

/** Initialisierung - einmal beim App-Start aufrufen */
export async function initI18n() {
  currentLocale = resolveLocale();
  fallbackTranslations = await loadLocale(DEFAULT_LOCALE);
  if (currentLocale !== DEFAULT_LOCALE) {
    try {
      translations = await loadLocale(currentLocale);
    } catch {
      translations = fallbackTranslations;
      currentLocale = DEFAULT_LOCALE;
    }
  } else {
    translations = fallbackTranslations;
  }
  applyDocumentLocale(currentLocale);
  i18nReady = true;
  resolveI18nReady();
  window.dispatchEvent(new CustomEvent('i18n-ready', { detail: { locale: currentLocale } }));
}

export function whenI18nReady() {
  return i18nReady ? Promise.resolve() : i18nReadyPromise;
}

export async function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  localStorage.setItem(STORAGE_KEY, locale);
  currentLocale = locale;
  _numberFormatCache.clear();
  const loaded = locale === DEFAULT_LOCALE
    ? fallbackTranslations
    : await loadLocale(locale);
  if (currentLocale !== locale) return;
  translations = loaded;
  applyDocumentLocale(locale);
  window.dispatchEvent(new CustomEvent('locale-changed', { detail: { locale } }));
}

function resolve(obj, key) {
  return key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

const pluralRulesCache = new Map();

function pluralCategory(locale, count) {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    pluralRulesCache.set(locale, rules);
  }
  return rules.select(count);
}

function resolvePluralKey(key, count) {
  const category = pluralCategory(currentLocale, count);
  for (const candidate of [`${key}_${category}`, `${key}_other`, key]) {
    const extHit = resolveExtensionTranslation(candidate);
    if (typeof extHit === 'string') return extHit;
    const hit = resolve(translations, candidate)
      ?? resolve(fallbackTranslations, candidate);
    if (hit != null) return hit;
  }
  return key;
}

export function t(key, params = {}) {
  let str;
  if (typeof params.count === 'number') {
    str = resolvePluralKey(key, params.count);
  } else {
    const extHit = resolveExtensionTranslation(key);
    str = extHit
      ?? resolve(translations, key)
      ?? resolve(fallbackTranslations, key)
      ?? key;
  }
  return str.replace(/\{\{(\w+)\}\}/g, (placeholder, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
  ));
}

const VALID_DATE_FORMATS = ['mdy', 'dmy', 'ymd', 'mdy_dot', 'dmy_dot', 'dmy_slash', 'ymd_dot', 'ymd_slash'];

function getDateFormatPreference() {
  const stored = localStorage.getItem(DATE_FORMAT_KEY);
  return VALID_DATE_FORMATS.includes(stored) ? stored : DEFAULT_DATE_FORMAT;
}

export function getDateFormat() {
  return getDateFormatPreference();
}

function getTimeFormatPreference() {
  const stored = localStorage.getItem(TIME_FORMAT_KEY);
  return VALID_TIME_FORMATS.includes(stored) ? stored : DEFAULT_TIME_FORMAT;
}

export function getTimeFormat() {
  return getTimeFormatPreference();
}

export function timeSuffix() {
  return getTimeFormatPreference() === '12h' ? '' : t('calendar.timeSuffix');
}

function formatDateParts(date) {
  const f = zonedFields(date);
  if (!f) return '';
  const year = f.year;
  const month = String(f.month).padStart(2, '0');
  const day = String(f.day).padStart(2, '0');
  switch (getDateFormatPreference()) {
    case 'dmy': return `${day}.${month}.${year}`;
    case 'mdy_dot': return `${month}.${day}.${year}`;
    case 'dmy_dot': return `${day}.${month}.${year}`;
    case 'dmy_slash': return `${day}/${month}/${year}`;
    case 'ymd': return `${year}-${month}-${day}`;
    case 'ymd_dot': return `${year}.${month}.${day}`;
    case 'ymd_slash': return `${year}/${month}/${day}`;
    default: return `${month}/${day}/${year}`;
  }
}

/** Aktuelle Locale abfragen */
export function getLocale() {
  return currentLocale;
}

/** Core fallback chain for extension modules (UI locale -> module default -> en -> de). */
export const EXTENSION_LOCALE_FALLBACKS = ['en', DEFAULT_LOCALE];

export function nestFlatLocaleDict(flatDict) {
  const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
  const moduleRoot = Object.create(null);
  for (const [key, value] of Object.entries(flatDict || {})) {
    if (typeof value !== 'string') continue;
    const parts = String(key).trim().split('.');
    if (parts.some((p) => !p || DANGEROUS.has(p))) continue;
    let node = moduleRoot;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!Object.prototype.hasOwnProperty.call(node, parts[i]) || typeof node[parts[i]] !== 'object') {
        node[parts[i]] = Object.create(null);
      }
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }
  return moduleRoot;
}

function extensionLocaleChain(moduleDefault, locale = currentLocale) {
  return [...new Set([locale, moduleDefault, ...EXTENSION_LOCALE_FALLBACKS].filter(Boolean))];
}

function resolveExtensionTranslation(key, locale = currentLocale) {
  if (!key.startsWith('extensions.')) return undefined;
  const rest = key.slice('extensions.'.length);
  const dot = rest.indexOf('.');
  if (dot <= 0) return undefined;
  const moduleId = rest.slice(0, dot);
  const subKey = rest.slice(dot + 1);
  const store = extensionLocaleStore[moduleId];
  if (!store) return undefined;
  for (const loc of extensionLocaleChain(store.defaultLocale, locale)) {
    const tree = store.trees[loc];
    if (!tree) continue;
    const hit = resolve(tree, subKey);
    if (typeof hit === 'string') return hit;
  }
  return undefined;
}

/**
 * Third-party module locale bundles. Pass every shipped locales/{code}.json tree;
 * lookup walks UI locale -> module defaultLocale -> en -> de.
 */
export function setExtensionLocaleBundles(moduleId, { defaultLocale = 'en', trees = {} } = {}) {
  extensionLocaleStore[moduleId] = {
    defaultLocale,
    trees: trees && typeof trees === 'object' ? trees : {},
  };
}

export function clearExtensionLocaleBundles(moduleId) {
  delete extensionLocaleStore[moduleId];
}

/** @deprecated Use setExtensionLocaleBundles — kept for tests and single-locale shortcuts. */
export function registerExtensionTranslations(moduleId, flatDict) {
  setExtensionLocaleBundles(moduleId, {
    defaultLocale: 'en',
    trees: { en: nestFlatLocaleDict(flatDict) },
  });
}

export function unregisterExtensionTranslations(moduleId) {
  clearExtensionLocaleBundles(moduleId);
}

export function clearExtensionTranslations() {
  extensionLocaleStore = Object.create(null);
}

export { resolveExtensionTranslation, extensionLocaleChain };

export function getFormatLocale() {
  let stored = null;
  try {
    stored = localStorage.getItem(NUMBER_LOCALE_KEY);
  } catch {
    stored = null;
  }
  return stored && /^[a-z]{2,3}-[A-Z]{2}$/.test(stored) ? stored : currentLocale;
}

// Gecachte Intl.NumberFormat-Instanzen je (Format-Locale × Options). Die




const _numberFormatCache = new Map();

export function getNumberFormat(options = {}) {
  const locale = getFormatLocale();
  const key = `${locale}\u0000${JSON.stringify(options)}`;
  let fmt = _numberFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, options);
    _numberFormatCache.set(key, fmt);
  }
  return fmt;
}

export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

/** Datum locale-aware formatieren */
export function formatDate(date) {
  if (date == null) return '';
  return formatDateParts(date);
}

export function formatDayMonth(date) {
  if (date == null) return '';
  const f = zonedFields(date);
  if (!f) return '';
  const month = String(f.month).padStart(2, '0');
  const day = String(f.day).padStart(2, '0');
  switch (getDateFormatPreference()) {
    case 'dmy': return `${day}.${month}.`;
    case 'mdy_dot': return `${month}.${day}.`;
    case 'dmy_dot': return `${day}.${month}.`;
    case 'dmy_slash': return `${day}/${month}`;
    case 'ymd': return `${month}-${day}`;
    case 'ymd_dot': return `${month}.${day}.`;
    case 'ymd_slash': return `${month}/${day}`;
    default: return `${month}/${day}`;
  }
}

export function dateInputPlaceholder() {
  switch (getDateFormatPreference()) {
    case 'dmy': return 'DD.MM.YYYY';
    case 'mdy_dot': return 'MM.DD.YYYY';
    case 'dmy_dot': return 'DD.MM.YYYY';
    case 'dmy_slash': return 'DD/MM/YYYY';
    case 'ymd': return 'YYYY-MM-DD';
    case 'ymd_dot': return 'YYYY.MM.DD';
    case 'ymd_slash': return 'YYYY/MM/DD';
    default: return 'MM/DD/YYYY';
  }
}

export function formatDateInput(date) {
  if (!date) return '';
  return formatDate(date);
}

export function parseDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return isValidDateParts(isoMatch[1], isoMatch[2], isoMatch[3]) ? raw : '';

  if (/^\d{8}$/.test(raw)) {
    const pref = getDateFormatPreference();
    let year, month, day;
    if (pref.startsWith('ymd')) {
      year = raw.slice(0, 4); month = raw.slice(4, 6); day = raw.slice(6, 8);
    } else if (pref.startsWith('dmy')) {
      day = raw.slice(0, 2); month = raw.slice(2, 4); year = raw.slice(4, 8);
    } else {
      month = raw.slice(0, 2); day = raw.slice(2, 4); year = raw.slice(4, 8);
    }
    if (!isValidDateParts(year, month, day)) return '';
    return `${year}-${month}-${day}`;
  }

  const ymdSeparatorMatch = raw.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (ymdSeparatorMatch && getDateFormatPreference().startsWith('ymd')) {
    const [, year, month, day] = ymdSeparatorMatch;
    if (!isValidDateParts(year, month, day)) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!slashMatch) return '';

  const [, first, second, year] = slashMatch;
  const [month, day] = getDateFormatPreference().startsWith('dmy')
    ? [second, first]
    : [first, second];

  if (!isValidDateParts(year, month, day)) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isDateInputValid(value) {
  const raw = String(value || '').trim();
  return !raw || !!parseDateInput(raw);
}

function isValidDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}



const _timeFormatCache = new Map();

function hourMinuteFormat() {
  let fmt = _timeFormatCache.get(currentLocale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(currentLocale, {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
    });
    _timeFormatCache.set(currentLocale, fmt);
  }
  return fmt;
}

/** Uhrzeit locale-aware formatieren */
export function formatTime(date) {
  if (date == null) return '';




  // ihren Offset.
  const wall = typeof date === 'string' && !/\d{4}-\d{2}-\d{2}/.test(date)
    ? toTimeParts(date) : null;
  const f = wall ? { ...wall, second: 0 } : zonedFields(date);
  if (!f) return '';
  if (getTimeFormatPreference() === '12h') {
    const displayHour = f.hour % 12 || 12;
    return `${displayHour}:${String(f.minute).padStart(2, '0')} ${f.hour >= 12 ? 'PM' : 'AM'}`;
  }





  return hourMinuteFormat().format(Date.UTC(f.year ?? 2000, (f.month ?? 1) - 1, f.day ?? 1, f.hour, f.minute, f.second));
}

function toTimeParts(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return { hour: value.getHours(), minute: value.getMinutes() };
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{1,2}$/.test(raw)) {
    const hour = Number(raw);
    return (hour >= 0 && hour <= 23) ? { hour, minute: 0 } : null;
  }




  const sepMatch = raw.match(/^(\d{1,2})[:.,hH](\d{2})$/);
  if (sepMatch) {
    const hour = Number(sepMatch[1]);
    const minute = Number(sepMatch[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return { hour, minute };
    }
    return null;
  }



  // (930 → 09:30, 0930 → 09:30, 1345 → 13:45). Vierstellige Werte kollidieren

  if (/^\d{3,4}$/.test(raw)) {
    const hour = Number(raw.slice(0, -2));
    const minute = Number(raw.slice(-2));
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return { hour, minute };
    }
    return null;
  }

  const ampmMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minute = Number(ampmMatch[2] ?? 0);
    const meridiem = ampmMatch[3].toLowerCase();
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute >= 60) return null;
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return { hour, minute };
  }

  return null;
}

export function formatTimeInput(value) {
  const parts = toTimeParts(value);
  if (!parts) return '';
  const hour = String(parts.hour).padStart(2, '0');
  const minute = String(parts.minute).padStart(2, '0');
  if (getTimeFormatPreference() === '12h') {
    const isPm = parts.hour >= 12;
    const displayHour = parts.hour % 12 || 12;
    return `${displayHour}:${minute} ${isPm ? 'PM' : 'AM'}`;
  }
  return `${hour}:${minute}`;
}

export function parseTimeInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = toTimeParts(raw);
  if (!parts) return '';
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function isTimeInputValid(value) {
  return !String(value || '').trim() || !!parseTimeInput(value);
}

export function timeInputPlaceholder() {
  return getTimeFormatPreference() === '12h' ? 'h:mm AM/PM' : 'HH:MM';
}
