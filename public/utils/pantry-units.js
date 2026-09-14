
export const PANTRY_UNITS = Object.freeze([
  'pcs', 'g', 'kg', 'ml', 'l', 'pkg', 'can', 'bottle', 'jar', 'bag',
]);

export const DEFAULT_PANTRY_UNIT = 'pcs';

export const PANTRY_UNIT_STEP = Object.freeze({
  pcs: 1, g: 100, kg: 0.5, ml: 100, l: 0.5,
  pkg: 1, can: 1, bottle: 1, jar: 1, bag: 1,
});

/** Schrittweite einer Einheit; unbekannte Einheiten schreiten um 1. */
export function pantryUnitStep(unit) {
  return PANTRY_UNIT_STEP[normalizePantryUnit(unit)] ?? 1;
}

export const MAX_PANTRY_QUANTITY = 1_000_000;

const UNIT_SET = new Set(PANTRY_UNITS);

export function normalizePantryUnit(value) {
  const key = String(value ?? '').trim();
  return UNIT_SET.has(key) ? key : DEFAULT_PANTRY_UNIT;
}

export function normalizePantryQuantity(value, { fallback = 1 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PANTRY_QUANTITY, Math.max(0, Math.round(n * 100) / 100));
}
