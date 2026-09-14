


const CORE_URL     = '/vendor/libphonenumber/core.min.mjs';
const METADATA_URL = '/vendor/libphonenumber/metadata.min.json';

// Memoisierte Lib-Instanz: { parse, AsYouType, isPossible, metadata } oder null.
let _lib = null;
// Laufendes Lade-Promise (verhindert parallele Doppel-Ladung).
let _loading = null;

export async function loadPhoneLib() {
  if (_lib) return _lib;
  if (!_loading) {
    _loading = (async () => {
      try {
        const [mod, metaRes] = await Promise.all([
          import(CORE_URL),
          fetch(METADATA_URL),
        ]);
        const metadata = await metaRes.json();
        _lib = {
          parse:      mod.parsePhoneNumberFromString,
          AsYouType:  mod.AsYouType,
          isPossible: mod.isPossiblePhoneNumber,
          metadata,
        };
        return _lib;
      } catch {
        // Bewusst still: Anzeige degradiert zum Rohwert, kein User-sichtbarer Fehler.
        _loading = null;
        return null;
      }
    })();
  }
  return _loading;
}

export function __primePhoneLib(lib) {
  _lib = lib || null;
  _loading = null;
}

function tryParse(lib, value, defaultCountry) {
  if (!lib || !value || typeof value !== 'string') return null;
  try {
    const parsed = lib.parse(value, defaultCountry || undefined, lib.metadata);
    return parsed || null;
  } catch {
    return null;
  }
}

function makeFormatter(lib) {
  return {
    /** national bei gleichem Land, sonst international; sonst Rohwert. */
    display(value, defaultCountry) {
      const raw = String(value ?? '');
      if (!raw.trim()) return raw;
      const parsed = tryParse(lib, raw, defaultCountry);
      if (!parsed) return raw;
      try {
        return (defaultCountry && parsed.country === defaultCountry)
          ? parsed.formatNational()
          : parsed.formatInternational();
      } catch {
        return raw;
      }
    },
    tel(value, defaultCountry) {
      const raw = String(value ?? '');
      const parsed = tryParse(lib, raw, defaultCountry);
      if (parsed && parsed.number) return `tel:${parsed.number}`; // .number = E.164
      const dialable = raw.replace(/[^\d+*#]/g, '');
      return `tel:${dialable || raw}`;
    },
    plausible(value, defaultCountry) {
      const raw = String(value ?? '');
      if (!raw.trim()) return true;
      try {
        return lib.isPossible(raw, defaultCountry || undefined, lib.metadata);
      } catch {
        return true;
      }
    },
  };
}

export async function getPhoneFormatter() {
  const lib = await loadPhoneLib();
  return lib ? makeFormatter(lib) : null;
}

export async function formatPhoneDisplay(value, defaultCountry) {
  const fmt = await getPhoneFormatter();
  return fmt ? fmt.display(value, defaultCountry) : String(value ?? '');
}

export async function toTelHref(value, defaultCountry) {
  const fmt = await getPhoneFormatter();
  if (fmt) return fmt.tel(value, defaultCountry);
  const raw = String(value ?? '');
  const dialable = raw.replace(/[^\d+*#]/g, '');
  return `tel:${dialable || raw}`;
}

export async function isPlausiblePhone(value, defaultCountry) {
  const fmt = await getPhoneFormatter();
  return fmt ? fmt.plausible(value, defaultCountry) : true;
}

export async function createAsYouType(defaultCountry) {
  const lib = await loadPhoneLib();
  if (!lib) return null;
  try {
    return new lib.AsYouType(defaultCountry || undefined, lib.metadata);
  } catch {
    return null;
  }
}

export function countryFromRegion(region) {
  if (!region || typeof region !== 'string') return null;
  const parts = region.split('-');
  const cc = parts[parts.length - 1];
  return /^[A-Za-z]{2}$/.test(cc) ? cc.toUpperCase() : null;
}
