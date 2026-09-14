
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function toE164(value, defaultCountry) {
  if (!value || typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = parsePhoneNumberFromString(value, defaultCountry || undefined);

    if (parsed && parsed.isPossible()) return parsed.number; // .number = E.164
  } catch {
    /* still: nicht parsebar → null, Rohwert-Vergleich bleibt Fallback */
  }
  return null;
}

export function defaultCountryFromConfig(dbConn) {
  try {
    const read = (key) => dbConn.prepare('SELECT value FROM sync_config WHERE key = ?').get(key)?.value;
    const region = read('region');
    const fromRegion = countryFromRegion(region);
    if (fromRegion) return fromRegion;
    const holiday = read('holiday_country');
    return /^[A-Za-z]{2}$/.test(holiday || '') ? String(holiday).toUpperCase() : null;
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
