
export const SUPPORTED_LOCALES = ['de', 'en', 'es', 'fr', 'it', 'sv', 'el', 'ru', 'tr', 'zh', 'ja', 'ar', 'hi', 'pt', 'uk', 'pl', 'nl', 'cs', 'vi', 'hu', 'ko', 'id', 'fa', 'fil'];
const FALLBACK_LOCALE = 'en';
const RTL_LOCALES = ['ar', 'fa'];
const STORAGE_KEY = 'aashiyana-installer-locale';

let translations = {};
let fallbackTranslations = {};
let activeLocale = FALLBACK_LOCALE;

function storedLocale() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && SUPPORTED_LOCALES.includes(v) ? v : null;
  } catch { return null; }
}

/** Gemerkte Wahl > Browsersprache > Englisch, analog public/i18n.js:31-34. */
export function resolveLocale(languages = navigator.languages || [navigator.language]) {
  const stored = storedLocale();
  if (stored) return stored;
  for (const tag of languages) {
    const base = (tag || '').split('-')[0].toLowerCase();
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return FALLBACK_LOCALE;
}

async function loadLocale(locale) {
  const resp = await fetch(`/locales/${locale}.json`);
  if (!resp.ok) throw new Error(`Failed to load locale: ${locale}`);
  return resp.json();
}

export async function initInstallerI18n() {
  activeLocale = resolveLocale();
  fallbackTranslations = await loadLocale(FALLBACK_LOCALE).catch(() => ({}));
  if (activeLocale === FALLBACK_LOCALE) {
    translations = fallbackTranslations;
  } else {
    try {
      translations = await loadLocale(activeLocale);
    } catch {
      translations = fallbackTranslations;
      activeLocale = FALLBACK_LOCALE;
    }
  }
  document.documentElement.lang = activeLocale;
  document.documentElement.dir = RTL_LOCALES.includes(activeLocale) ? 'rtl' : 'ltr';
  return activeLocale;
}

export function getLocale() {
  return activeLocale;
}

export async function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return activeLocale;
  if (locale === FALLBACK_LOCALE) {
    translations = fallbackTranslations;
  } else {
    try {
      translations = await loadLocale(locale);
    } catch {
      translations = fallbackTranslations;
      locale = FALLBACK_LOCALE;
    }
  }
  activeLocale = locale;
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
  document.documentElement.lang = activeLocale;
  document.documentElement.dir = RTL_LOCALES.includes(activeLocale) ? 'rtl' : 'ltr';
  return activeLocale;
}

function resolve(obj, key) {
  return key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

export function t(key, params = {}) {
  let str = resolve(translations, key) ?? resolve(fallbackTranslations, key) ?? key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replaceAll(`{{${k}}}`, String(v));
  }
  return str;
}

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}

export function applyRich(el, key, slots = {}) {
  const str = t(key);
  const frag = document.createDocumentFragment();
  const re = /\{\{(\w+)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(str.slice(last, m.index)));
    const slot = slots[m[1]];


    if (slot != null) frag.appendChild(typeof slot === 'string' ? document.createTextNode(slot) : slot);
    last = re.lastIndex;
  }
  if (last < str.length) frag.appendChild(document.createTextNode(str.slice(last)));
  el.replaceChildren(frag);
}
