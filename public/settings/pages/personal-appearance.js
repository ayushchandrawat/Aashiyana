import {
  getLocale,
  getSupportedLocales,
  setLocale,
  t,
} from '/i18n.js';
import { esc } from '/utils/html.js';
import { appendCurrencyOptions, persistCurrencySelection } from '/settings/currency.js';
import { getPreferences, savePreferences } from '/settings/preferences-cache.js';
import { toggleRowHtml } from '/settings/components.js';
import { isWallModeEnabled, setWallModeEnabled } from '/utils/wall-mode.js';
import { setDisplayTimeZone } from '/utils/timezone.js';
import {
  CUSTOM_REGION,
  REGION_CODES,
  REGION_PRESETS,
  detectRegion,
  resolveRegion,
  regionLabel,
  numberLocaleFor,
} from '/settings/region-presets.js';

const DATE_FORMATS = [
  ['mdy', 'MM/DD/YYYY'],
  ['dmy', 'DD.MM.YYYY'],
  ['dmy_slash', 'DD/MM/YYYY'],
  ['ymd', 'YYYY-MM-DD'],
  ['mdy_dot', 'MM.DD.YYYY'],
  ['ymd_dot', 'YYYY.MM.DD'],
  ['ymd_slash', 'YYYY/MM/DD'],
];

function safeStorageGet(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function currentTheme() {
  return safeStorageGet('aashiyana-theme', 'system') || 'system';
}

function formatOptions(selected) {
  return DATE_FORMATS.map(([value, label]) => (
    `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`
  )).join('');
}

function timeZoneOptions(selected, effective) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = []; }



  if (selected && !zones.includes(selected)) zones = [...zones, selected].sort();

  const auto = `<option value=""${selected ? '' : ' selected'}>`
    + `${esc(t('settings.timezoneAuto', { zone: effective || 'UTC' }))}</option>`;

  // UTC von Hand davor. `Intl.supportedValuesOf('timeZone')` fuehrt WEDER `UTC`





  const utc = `<option value="UTC"${selected === 'UTC' ? ' selected' : ''}>UTC</option>`;

  const groups = new Map();
  for (const zone of zones) {
    if (zone === 'UTC') continue; // steht schon oben
    const area = zone.includes('/') ? zone.slice(0, zone.indexOf('/')) : 'Other';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(zone);
  }
  const body = [...groups.entries()].map(([area, list]) => {
    const opts = list.map((zone) => {


      // bleibt, behaelt seine restlichen Schraegstriche

      const label = (zone.includes('/') ? zone.slice(zone.indexOf('/') + 1) : zone).replace(/_/g, ' ');
      return `<option value="${esc(zone)}"${zone === selected ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    return `<optgroup label="${esc(area)}">${opts}</optgroup>`;
  }).join('');

  return auto + utc + body;
}

function regionOptions(selectedRegion) {
  const locale = getLocale();





  const presets = [...REGION_CODES]
    .map((code) => ({ code, label: regionLabel(code, locale) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale))
    .map(({ code, label }) => (
      `<option value="${esc(code)}"${selectedRegion === code ? ' selected' : ''}>${esc(label)}</option>`
    )).join('');
  const custom = `<option value="${CUSTOM_REGION}"${selectedRegion === CUSTOM_REGION ? ' selected' : ''}>${t('settings.regionCustom')}</option>`;
  return presets + custom;
}

function localeLabel(locale) {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'language' }).of(locale) || locale;
  } catch {
    return locale;
  }
}

function localeOptions() {
  const storedLocale = safeStorageGet('aashiyana-locale');
  return [
    `<option value="system"${storedLocale ? '' : ' selected'}>${t('settings.localeSystem')}</option>`,
    ...getSupportedLocales().map((locale) => (
      `<option value="${esc(locale)}"${storedLocale === locale ? ' selected' : ''}>${esc(localeLabel(locale))}</option>`
    )),
  ].join('');
}

function dataLanguageOptions(selected, auto_) {
  const auto = t('settings.dataLanguageAuto', { language: localeLabel(auto_) });
  return [
    `<option value=""${selected ? '' : ' selected'}>${esc(auto)}</option>`,
    ...getSupportedLocales().map((locale) => (
      `<option value="${esc(locale)}"${selected === locale ? ' selected' : ''}>${esc(localeLabel(locale))}</option>`
    )),
  ].join('');
}

function showError(element, message) {
  if (!element) return;
  element.textContent = message || t('common.errorGeneric');
  element.hidden = false;
}

function clearError(element) {
  if (!element) return;
  element.textContent = '';
  element.hidden = true;
}

function renderLoadError(container) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <div class="settings-card">
      <p class="form-error" role="alert">${t('settings.loadError')}</p>
      <div class="settings-form-actions">
        <button type="button" class="btn btn--secondary" id="appearance-retry">${t('settings.retry')}</button>
      </div>
    </div>
  `);
}

function renderPage(container, preferences, isAdmin) {
  const theme = currentTheme();
  const activeRegion = resolveRegion(preferences);
  const customHidden = isAdmin && activeRegion !== CUSTOM_REGION;
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.sectionDesign')}</h2>
      <div class="settings-card">
        <div class="theme-toggle" id="theme-toggle">
          <button class="theme-toggle__btn ${theme === 'system' ? 'theme-toggle__btn--active' : ''}" type="button" data-theme-value="system" aria-label="${t('settings.themeSysLabel')}" aria-pressed="${theme === 'system'}">
            <i data-lucide="monitor" class="icon-md" aria-hidden="true"></i>
            ${t('settings.themeSystem')}
          </button>
          <button class="theme-toggle__btn ${theme === 'light' ? 'theme-toggle__btn--active' : ''}" type="button" data-theme-value="light" aria-label="${t('settings.themeLightLabel')}" aria-pressed="${theme === 'light'}">
            <i data-lucide="sun" class="icon-md" aria-hidden="true"></i>
            ${t('settings.themeLight')}
          </button>
          <button class="theme-toggle__btn ${theme === 'dark' ? 'theme-toggle__btn--active' : ''}" type="button" data-theme-value="dark" aria-label="${t('settings.themeDarkLabel')}" aria-pressed="${theme === 'dark'}">
            <i data-lucide="moon" class="icon-md" aria-hidden="true"></i>
            ${t('settings.themeDark')}
          </button>
        </div>
      </div>
      <!-- DER WAND-MODUS WOHNT HIER UND NICHT IM ANPASSEN-PANEL.
           Er ist wie Theme und Sprache GERÃ„TELOKAL (localStorage) - das
           Anpassen-Panel schreibt dagegen die haushaltweite Widget-Konfiguration
           auf den Server. Ein gerÃ¤telokaler Schalter dort wÃ¤re eine zweite
           Speicher-Semantik im selben Panel; und der Anpassen-Modus bearbeitet
           das Raster, wÃ¤hrend dieser Schalter eine Betriebsart wÃ¤hlt. -->
      <div class="settings-card">
        ${toggleRowHtml({
          label: t('settings.wallModeLabel'),
          checked: isWallModeEnabled(),
          icon: 'tablet',
          attrs: { id: 'wall-mode-toggle', 'aria-describedby': 'wall-mode-hint' },
        })}
        <p class="form-hint" id="wall-mode-hint">${t('settings.wallModeHint')}</p>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.languageTitle')}</h2>
      <div class="settings-card">
        <div class="form-group">
          <label class="form-label" for="locale-select">${t('settings.localeLabel')}</label>
          <select class="form-input locale-picker__select" id="locale-select" aria-describedby="locale-error">
            ${localeOptions()}
          </select>
        </div>
        <div id="locale-error" class="form-error" role="alert" hidden></div>
      </div>
      <!-- Eigene Karte, nicht angehÃ¤ngt an die Sprachauswahl darÃ¼ber: als
           Nachbar im selben Block lÃ¤se sich der Hinweis wie die ErklÃ¤rung der
           Anzeigesprache - und beide sagen etwas GegensÃ¤tzliches aus. -->
      <div class="settings-card">
        ${isAdmin ? `
        <p class="form-hint" id="data-language-hint">${t('settings.dataLanguageHint')}</p>
        <div class="form-group">
          <label class="form-label" for="data-language-select">${t('settings.dataLanguageLabel')}</label>
          <select class="form-input" id="data-language-select" aria-describedby="data-language-hint data-language-error">
            ${dataLanguageOptions(preferences.language, preferences.language_auto)}
          </select>
        </div>
        <div id="data-language-error" class="form-error" role="alert" hidden></div>` : `
        <p class="form-hint">${t('settings.dataLanguageAdminOnly')}</p>`}
      </div>
    </section>

    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.regionTitle')}</h2>
      ${isAdmin ? `
      <div class="settings-card">
        <p class="form-hint" id="region-hint">${t('settings.regionHint')}</p>
        <div class="form-group">
          <label class="form-label" for="region-select">${t('settings.regionLabel')}</label>
          <select class="form-input" id="region-select" aria-describedby="region-hint region-error">
            ${regionOptions(activeRegion)}
          </select>
        </div>
        <div id="region-error" class="form-error" role="alert" hidden></div>
        <!-- Die Waehrung stand bis
             ausgeblendet ist, solange eine Region-Voreinstellung genau passt.
             Das ergab eine Falle mit Ansage: sichtbar wurde das Feld erst, WENN
             man die Waehrung schon einmal geaendert hatte (dann passt kein
             Preset mehr und die Karte klappt auf) - wer sie suchte, fand sie
             also nie. Der Wegweiser aus den Modul-Optionen fuehrte genau
             dorthin, wo nichts zu sehen war.

             Sie steht jetzt hier, weil sie kein Format ist: Datum und Uhrzeit
             sagen, WIE ein Wert dasteht, und folgen dem Ort. Die Waehrung folgt
             dem Geld, und das ist nicht dasselbe - ein Haushalt kann sehr wohl
             deutsche Formate und ein Konto in Dollar haben. Die Region belegt
             sie weiterhin vor; das bleibt der bequeme Weg, nur nicht mehr der
             einzige. -->
        <div class="form-group">
          <label class="form-label" for="currency-select">${t('settings.currencyLabel')}</label>
          <select class="form-input" id="currency-select" aria-describedby="currency-hint currency-error"></select>
        </div>
        <p class="form-hint" id="currency-hint">${t('settings.currencyHint')}</p>
        <div id="currency-error" class="form-error" role="alert" hidden></div>
      </div>` : `
      <div class="settings-card">
        <p class="form-hint">${t('settings.regionAdminOnly')}</p>
      </div>`}
      <!-- Eigene Karte, nicht in den Formatblock darunter: die Zeitzone ist
           keine Formatierung. Datum und Uhrzeit dort Ã¤ndern nur, WIE ein Wert
           dasteht; die Zone Ã¤ndert, WELCHER Tag "heute" ist, wann Erinnerungen
           auslÃ¶sen und mit welcher Uhrzeit ein Termin bei Google ankommt. -->
      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.timezoneTitle')}</h3>
        ${isAdmin ? `
        <p class="form-hint" id="timezone-hint">${t('settings.timezoneHint')}</p>
        <div class="form-group">
          <label class="form-label" for="timezone-select">${t('settings.timezoneLabel')}</label>
          <select class="form-input" id="timezone-select" aria-describedby="timezone-hint timezone-error">
            ${timeZoneOptions(preferences.timezone, preferences.timezone_effective)}
          </select>
        </div>
        <div id="timezone-error" class="form-error" role="alert" hidden></div>` : `
        <p class="form-hint">${t('settings.timezoneAdminOnly')}</p>
        <p class="form-hint">${esc(t('settings.timezoneAuto', { zone: preferences.timezone_effective || 'UTC' }))}</p>`}
      </div>
      <div class="settings-card" id="custom-formats"${customHidden ? ' hidden' : ''}>
        <p class="form-hint" id="formats-household-hint">${t('settings.formatsHouseholdHint')}</p>
        <div class="form-group">
          <label class="form-label" for="date-format-select">${t('settings.dateFormatLabel')}</label>
          <select class="form-input" id="date-format-select" aria-describedby="formats-household-hint date-format-error">
            ${formatOptions(preferences.date_format)}
          </select>
        </div>
        <div id="date-format-error" class="form-error" role="alert" hidden></div>
        <div class="form-group">
          <label class="form-label" for="time-format-select">${t('settings.timeFormatLabel')}</label>
          <select class="form-input" id="time-format-select" aria-describedby="formats-household-hint time-format-error">
            <option value="24h"${preferences.time_format === '24h' ? ' selected' : ''}>24 ${t('settings.timeFormatHours')}</option>
            <option value="12h"${preferences.time_format === '12h' ? ' selected' : ''}>AM/PM</option>
          </select>
        </div>
        <div id="time-format-error" class="form-error" role="alert" hidden></div>
      </div>
    </section>
  `);
}

function applyTheme(value) {
  safeStorageSet('aashiyana-theme', value);
  if (window.aashiyana?.applyTheme) {
    try {
      window.aashiyana.applyTheme(value);
      return;
    } catch {
      // Fall back to applying the theme directly when router storage fails.
    }
  }

  if (value === 'dark' || value === 'light') {
    document.documentElement.setAttribute('data-theme', value);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}




function applyNumberLocale({ region, currency, date_format, time_format }) {
  const numberLocale = numberLocaleFor({ region, currency, date_format, time_format });
  if (numberLocale) {
    safeStorageSet('aashiyana-number-locale', numberLocale);
  } else {
    safeStorageRemove('aashiyana-number-locale');
  }
}


function readFormatState(container) {
  return {
    region: container.querySelector('#region-select')?.value,
    currency: container.querySelector('#currency-select')?.value,
    date_format: container.querySelector('#date-format-select')?.value,
    time_format: container.querySelector('#time-format-select')?.value,
  };
}



function applyCustomVisibility(container, region) {
  const customBlock = container.querySelector('#custom-formats');
  if (customBlock) customBlock.hidden = region !== CUSTOM_REGION;
}

function syncRegionSelect(container, { mayHide = true, region = null } = {}) {
  const regionSelect = container.querySelector('#region-select');
  if (!regionSelect) return;
  regionSelect.value = region ?? detectRegion({
    currency: container.querySelector('#currency-select')?.value,
    date_format: container.querySelector('#date-format-select')?.value,
    time_format: container.querySelector('#time-format-select')?.value,
  });




  if (mayHide || regionSelect.value === CUSTOM_REGION) {
    applyCustomVisibility(container, regionSelect.value);
  }
}

async function refreshDataLanguageOptions(container) {
  const select = container.querySelector('#data-language-select');
  if (!select) return;
  const preferences = await getPreferences();
  select.replaceChildren();
  select.insertAdjacentHTML('beforeend', dataLanguageOptions(
    preferences.language || null,
    preferences.language_auto || 'en',
  ));
}

function bindEvents(container, user) {
  const themeToggle = container.querySelector('#theme-toggle');
  themeToggle?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-value]');
    if (!button) return;
    applyTheme(button.dataset.themeValue);
    themeToggle.querySelectorAll('.theme-toggle__btn').forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle('theme-toggle__btn--active', active);
      candidate.setAttribute('aria-pressed', String(active));
    });
  });




  const wallToggle = container.querySelector('#wall-mode-toggle');
  wallToggle?.addEventListener('change', () => {
    setWallModeEnabled(wallToggle.checked);
    window.aashiyana?.showToast(
      wallToggle.checked
        ? t('settings.wallModeOn', { page: t('nav.dashboard') })
        : t('settings.wallModeOff'),
      'success',
    );
  });

  const localeSelect = container.querySelector('#locale-select');
  localeSelect?.addEventListener('change', async () => {
    const errorElement = container.querySelector('#locale-error');
    clearError(errorElement);
    localeSelect.disabled = true;
    try {
      if (localeSelect.value === 'system') {
        safeStorageRemove('aashiyana-locale');
        location.reload();
        return;
      }
      const locale = localeSelect.value;
      await setLocale(locale);
      await render(container, { user });
    } catch (error) {
      showError(errorElement, error.message);
    } finally {
      if (localeSelect.isConnected) localeSelect.disabled = false;
    }
  });





  const dataLanguageSelect = container.querySelector('#data-language-select');
  let persistedDataLanguage = dataLanguageSelect?.value ?? '';
  dataLanguageSelect?.addEventListener('change', async () => {
    const errorElement = container.querySelector('#data-language-error');
    clearError(errorElement);
    dataLanguageSelect.disabled = true;
    try {
      await savePreferences({ language: dataLanguageSelect.value || null });
      persistedDataLanguage = dataLanguageSelect.value;


      // gespeicherte "Benutzerdefiniert"-Wahl im Region-Block wieder zuklappen.
      await refreshDataLanguageOptions(container);
      window.aashiyana?.showToast(t('settings.dataLanguageSaved'), 'success');
    } catch (error) {


      dataLanguageSelect.value = persistedDataLanguage;
      showError(errorElement, error.message);
    } finally {
      if (dataLanguageSelect.isConnected) dataLanguageSelect.disabled = false;
    }
  });

  const timezoneSelect = container.querySelector('#timezone-select');
  timezoneSelect?.addEventListener('change', async () => {
    const errorElement = container.querySelector('#timezone-error');
    clearError(errorElement);
    timezoneSelect.disabled = true;
    try {
      const saved = await savePreferences({ timezone: timezoneSelect.value || null });





      timezoneSelect.replaceChildren();
      timezoneSelect.insertAdjacentHTML(
        'beforeend', timeZoneOptions(saved?.data?.timezone, saved?.data?.timezone_effective)
      );


      // bereits gezeichneten Uhrzeiten bis zum naechsten Seitenwechsel stehen.
      setDisplayTimeZone(saved?.data?.timezone ?? null);
      window.dispatchEvent(new CustomEvent('timezone-changed', {
        detail: { timezone: saved?.data?.timezone ?? null },
      }));
      window.aashiyana?.showToast(t('settings.timezoneSaved'), 'success');
    } catch (error) {
      showError(errorElement, error.message);
    } finally {
      if (timezoneSelect.isConnected) timezoneSelect.disabled = false;
    }
  });

  const regionSelect = container.querySelector('#region-select');
  regionSelect?.addEventListener('change', async () => {
    if (regionSelect.value === CUSTOM_REGION) {
      applyCustomVisibility(container, CUSTOM_REGION);
      return;
    }
    const preset = REGION_PRESETS[regionSelect.value];
    if (!preset) return;
    const errorElement = container.querySelector('#region-error');
    clearError(errorElement);
    regionSelect.disabled = true;





    // Fehlermeldung heilt - also erst gar nicht zulassen.
    const currencyDuringRegion = container.querySelector('#currency-select');
    if (currencyDuringRegion) currencyDuringRegion.disabled = true;
    try {
      await savePreferences({
        currency: preset.currency,
        date_format: preset.date_format,
        time_format: preset.time_format,


        region: regionSelect.value,
      });
      const currencySelect = container.querySelector('#currency-select');
      if (currencySelect) currencySelect.value = preset.currency;
      const dateSelect = container.querySelector('#date-format-select');
      if (dateSelect) dateSelect.value = preset.date_format;
      const timeSelect = container.querySelector('#time-format-select');
      if (timeSelect) timeSelect.value = preset.time_format;
      safeStorageSet('aashiyana-date-format', preset.date_format);
      safeStorageSet('aashiyana-time-format', preset.time_format);
      applyNumberLocale({
        region: regionSelect.value,
        currency: preset.currency,
        date_format: preset.date_format,
        time_format: preset.time_format,
      });
      window.dispatchEvent(new CustomEvent('date-format-changed', {
        detail: { dateFormat: preset.date_format },
      }));
      window.dispatchEvent(new CustomEvent('time-format-changed', {
        detail: { timeFormat: preset.time_format },
      }));
      applyCustomVisibility(container, regionSelect.value);


      await refreshDataLanguageOptions(container).catch(() => {});
      window.aashiyana?.showToast(t('settings.regionSaved'), 'success');
    } catch (error) {
      showError(errorElement, error.message);
    } finally {
      if (regionSelect.isConnected) regionSelect.disabled = false;
      if (currencyDuringRegion?.isConnected) currencyDuringRegion.disabled = false;
    }
  });

  const currencySelect = container.querySelector('#currency-select');
  let persistedCurrency = currencySelect?.value;
  currencySelect?.addEventListener('change', async () => {
    if (currencySelect.disabled) return;
    const errorElement = container.querySelector('#currency-error');
    clearError(errorElement);
    try {
      await persistCurrencySelection(
        currencySelect,
        persistedCurrency,
        () => savePreferences({ currency: currencySelect.value }),
      );
      persistedCurrency = currencySelect.value;






      // vom regionalen Format aendern lassen (#934).
      //


      // Datum und Uhrzeit bleiben dabei unangetastet.
      const regionBefore = container.querySelector('#region-select')?.value;
      const derived = detectRegion({
        currency: currencySelect.value,
        date_format: container.querySelector('#date-format-select')?.value,
        time_format: container.querySelector('#time-format-select')?.value,
      });
      syncRegionSelect(container, { region: derived === regionBefore ? regionBefore : CUSTOM_REGION });
      applyNumberLocale(readFormatState(container));
      window.aashiyana?.showToast(t('settings.currencySaved'), 'success');
    } catch (error) {
      showError(errorElement, error.message);
    }
  });

  const dateFormatSelect = container.querySelector('#date-format-select');
  dateFormatSelect?.addEventListener('change', async () => {
    const errorElement = container.querySelector('#date-format-error');
    clearError(errorElement);
    dateFormatSelect.disabled = true;
    try {
      await savePreferences({ date_format: dateFormatSelect.value });
      safeStorageSet('aashiyana-date-format', dateFormatSelect.value);
      window.dispatchEvent(new CustomEvent('date-format-changed', {
        detail: { dateFormat: dateFormatSelect.value },
      }));
      syncRegionSelect(container, { mayHide: false });
      applyNumberLocale(readFormatState(container));
      window.aashiyana?.showToast(t('settings.dateFormatSavedToast'), 'success');
    } catch (error) {
      showError(errorElement, error.message);
    } finally {
      dateFormatSelect.disabled = false;
    }
  });

  const timeFormatSelect = container.querySelector('#time-format-select');
  timeFormatSelect?.addEventListener('change', async () => {
    const errorElement = container.querySelector('#time-format-error');
    clearError(errorElement);
    timeFormatSelect.disabled = true;
    try {
      await savePreferences({ time_format: timeFormatSelect.value });
      safeStorageSet('aashiyana-time-format', timeFormatSelect.value);
      window.dispatchEvent(new CustomEvent('time-format-changed', {
        detail: { timeFormat: timeFormatSelect.value },
      }));
      syncRegionSelect(container, { mayHide: false });
      applyNumberLocale(readFormatState(container));
      window.aashiyana?.showToast(t('settings.timeFormatSavedToast'), 'success');
    } catch (error) {
      showError(errorElement, error.message);
    } finally {
      timeFormatSelect.disabled = false;
    }
  });
}

export async function render(container, { user }) {
  try {
    const loaded = await getPreferences();
    const preferences = {
      currency: loaded.currency || 'INR',
      date_format: loaded.date_format || 'dmy',
      time_format: loaded.time_format || '24h',
      region: loaded.region || null,
      language: loaded.language || null,
      language_auto: loaded.language_auto || 'en',
      // Beide Zonen-Felder gehoeren hier durchgereicht: renderPage() liest sie



      timezone: loaded.timezone || null,
      timezone_effective: loaded.timezone_effective || null,
    };

    safeStorageSet('aashiyana-date-format', preferences.date_format);
    safeStorageSet('aashiyana-time-format', preferences.time_format);
    setDisplayTimeZone(preferences.timezone);
    applyNumberLocale(preferences);
    const isAdmin = user?.role === 'admin';
    renderPage(container, preferences, isAdmin);
    if (isAdmin) {
      appendCurrencyOptions(container.querySelector('#currency-select'), preferences.currency);
    }
    bindEvents(container, user);
    window.lucide?.createIcons({ el: container });
  } catch {
    renderLoadError(container);
    container.querySelector('#appearance-retry')?.addEventListener('click', () => {
      render(container, { user });
    });
  }
}

