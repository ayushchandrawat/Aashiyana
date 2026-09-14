



//

//   currency    ∈ CURRENCY_CODES        (public/utils/currency-codes.js)
//   date_format ∈ DATE_FORMATS          (public/settings/pages/personal-appearance.js)
//   time_format ∈ { '24h', '12h' }
// (per test/test-region-presets.js abgesichert).

export const CUSTOM_REGION = 'custom';

export const REGION_PRESETS = {
  'de-DE': { currency: 'EUR', date_format: 'dmy', time_format: '24h' },
  'de-AT': { currency: 'EUR', date_format: 'dmy', time_format: '24h' },
  'de-CH': { currency: 'CHF', date_format: 'dmy', time_format: '24h' },
  'en-US': { currency: 'USD', date_format: 'mdy', time_format: '12h' },
  'en-GB': { currency: 'GBP', date_format: 'dmy_slash', time_format: '24h' },
  'en-CA': { currency: 'CAD', date_format: 'ymd', time_format: '12h' },
  'en-AU': { currency: 'AUD', date_format: 'dmy_slash', time_format: '12h' },
  'en-NZ': { currency: 'NZD', date_format: 'dmy_slash', time_format: '12h' },
  'en-PH': { currency: 'PHP', date_format: 'mdy', time_format: '12h' },
  'fil-PH': { currency: 'PHP', date_format: 'mdy', time_format: '12h' },
  'es-ES': { currency: 'EUR', date_format: 'dmy_slash', time_format: '24h' },
  'es-CL': { currency: 'CLP', date_format: 'dmy_slash', time_format: '24h' },





  'es-MX': { currency: 'MXN', date_format: 'dmy_slash', time_format: '12h' },
  'es-AR': { currency: 'ARS', date_format: 'dmy_slash', time_format: '12h' },
  'es-BO': { currency: 'BOB', date_format: 'dmy_slash', time_format: '12h' },
  'es-CO': { currency: 'COP', date_format: 'dmy_slash', time_format: '12h' },
  'es-CR': { currency: 'CRC', date_format: 'dmy_slash', time_format: '12h' },
  'es-CU': { currency: 'CUP', date_format: 'dmy_slash', time_format: '12h' },
  'es-DO': { currency: 'DOP', date_format: 'dmy_slash', time_format: '12h' },
  'es-EC': { currency: 'USD', date_format: 'dmy_slash', time_format: '12h' },
  'es-GT': { currency: 'GTQ', date_format: 'dmy_slash', time_format: '12h' },
  'es-HN': { currency: 'HNL', date_format: 'dmy_slash', time_format: '12h' },
  'es-NI': { currency: 'NIO', date_format: 'dmy_slash', time_format: '12h' },
  'es-PA': { currency: 'PAB', date_format: 'mdy', time_format: '12h' },
  'es-PE': { currency: 'PEN', date_format: 'dmy_slash', time_format: '12h' },
  'es-PY': { currency: 'PYG', date_format: 'dmy_slash', time_format: '12h' },
  'es-SV': { currency: 'USD', date_format: 'dmy_slash', time_format: '12h' },
  'es-UY': { currency: 'UYU', date_format: 'dmy_slash', time_format: '12h' },
  'es-VE': { currency: 'VES', date_format: 'dmy_slash', time_format: '12h' },
  'fr-CA': { currency: 'CAD', date_format: 'ymd', time_format: '24h' },
  'fr-HT': { currency: 'HTG', date_format: 'dmy_slash', time_format: '24h' },
  'nl-SR': { currency: 'SRD', date_format: 'dmy_slash', time_format: '24h' },
  'en-BZ': { currency: 'BZD', date_format: 'dmy_slash', time_format: '24h' },
  'en-JM': { currency: 'JMD', date_format: 'dmy_slash', time_format: '12h' },
  'en-TT': { currency: 'TTD', date_format: 'dmy_slash', time_format: '12h' },
  'en-BS': { currency: 'BSD', date_format: 'dmy_slash', time_format: '12h' },
  'en-BB': { currency: 'BBD', date_format: 'dmy_slash', time_format: '12h' },
  'en-GY': { currency: 'GYD', date_format: 'dmy_slash', time_format: '12h' },



  'en-AG': { currency: 'XCD', date_format: 'dmy_slash', time_format: '12h' },
  'en-DM': { currency: 'XCD', date_format: 'dmy_slash', time_format: '12h' },
  'en-GD': { currency: 'XCD', date_format: 'dmy_slash', time_format: '12h' },
  'en-KN': { currency: 'XCD', date_format: 'dmy_slash', time_format: '12h' },
  'en-LC': { currency: 'XCD', date_format: 'dmy_slash', time_format: '12h' },
  'en-VC': { currency: 'XCD', date_format: 'dmy_slash', time_format: '12h' },
  'fr-FR': { currency: 'EUR', date_format: 'dmy_slash', time_format: '24h' },
  'it-IT': { currency: 'EUR', date_format: 'dmy_slash', time_format: '24h' },
  'sv-SE': { currency: 'SEK', date_format: 'ymd', time_format: '24h' },
  'pl-PL': { currency: 'PLN', date_format: 'dmy', time_format: '24h' },
  'cs-CZ': { currency: 'CZK', date_format: 'dmy', time_format: '24h' },
  'uk-UA': { currency: 'UAH', date_format: 'dmy', time_format: '24h' },
  'ru-RU': { currency: 'RUB', date_format: 'dmy', time_format: '24h' },
  'be-BY': { currency: 'BYN', date_format: 'dmy', time_format: '24h' },
  'tr-TR': { currency: 'TRY', date_format: 'dmy', time_format: '24h' },
  'zh-CN': { currency: 'CNY', date_format: 'ymd', time_format: '24h' },
  'ja-JP': { currency: 'JPY', date_format: 'ymd', time_format: '24h' },
  'hi-IN': { currency: 'INR', date_format: 'dmy_slash', time_format: '12h' },
  'pt-PT': { currency: 'EUR', date_format: 'dmy_slash', time_format: '24h' },
  'pt-BR': { currency: 'BRL', date_format: 'dmy_slash', time_format: '24h' },
  'nl-NL': { currency: 'EUR', date_format: 'dmy', time_format: '24h' },
  'ar-AE': { currency: 'AED', date_format: 'dmy_slash', time_format: '12h' },
  'ar-SA': { currency: 'SAR', date_format: 'dmy_slash', time_format: '12h' },
  'ko-KR': { currency: 'KRW', date_format: 'ymd', time_format: '12h' },
  'id-ID': { currency: 'IDR', date_format: 'dmy', time_format: '24h' },
  'ms-MY': { currency: 'MYR', date_format: 'dmy_slash', time_format: '12h' },



  'he-IL': { currency: 'ILS', date_format: 'dmy', time_format: '24h' },
  'fa-IR': { currency: 'IRR', date_format: 'ymd', time_format: '24h' },
  // #297: drei ausgelieferte Sprachen hatten keine einzige Region - wer die App



  // Schaetzung - zweimal ueberrascht das:
  //   el-GR laeuft auf 12h (2:30 μ.μ.), obwohl ganz Europa ringsum 24h schreibt,

  //   ueberhaupt auf `ymd_dot`.
  'el-GR': { currency: 'EUR', date_format: 'dmy_slash', time_format: '12h' },
  'hu-HU': { currency: 'HUF', date_format: 'ymd_dot', time_format: '24h' },
  'vi-VN': { currency: 'VND', date_format: 'dmy_slash', time_format: '24h' },
};

export const REGION_CODES = Object.keys(REGION_PRESETS);


// entspricht, sonst CUSTOM_REGION. Mehrere Regionen teilen dasselbe Triple


export function detectRegion({ currency, date_format, time_format } = {}) {
  for (const [code, preset] of Object.entries(REGION_PRESETS)) {
    if (
      preset.currency === currency
      && preset.date_format === date_format
      && preset.time_format === time_format
    ) {
      return code;
    }
  }
  return CUSTOM_REGION;
}




// gespeichertes `region`-Feld liefert detectRegion() immer den ersten Treffer




export function resolveRegion({ region, currency, date_format, time_format } = {}) {
  const preset = region ? REGION_PRESETS[region] : undefined;
  if (
    preset
    && preset.currency === currency
    && preset.date_format === date_format
    && preset.time_format === time_format
  ) {
    return region;
  }
  return detectRegion({ currency, date_format, time_format });
}


// (z. B. "de-CH" → Tausender-Apostroph + Punkt-Dezimaltrenner: 123'456.78).



export function numberLocaleFor(prefs = {}) {
  const region = resolveRegion(prefs);
  return REGION_CODES.includes(region) ? region : '';
}

// Lokalisierter Anzeigename eines Regions-Codes (z. B. "de-DE" → "Deutsch (Deutschland)").

export function regionLabel(code, locale) {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'language' });
    return names.of(code) || code;
  } catch {
    return code;
  }
}
