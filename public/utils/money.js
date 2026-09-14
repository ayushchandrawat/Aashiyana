
import { getNumberFormat } from '/i18n.js';
import { REGION_CODES } from '/settings/region-presets.js';
import { asciiDigit, asciiSeparator } from '/utils/digits.js';

export const MONEY_ROLES = ['flow', 'total', 'balance', 'plain'];

export function formatMoney(amount, currency) {
  return getNumberFormat({ style: 'currency', currency }).format(Number(amount) || 0);
}

export function formatMoneyAxis(amount, currency) {
  return getNumberFormat({
    style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

export function currencyFractionDigits(currency) {
  try {

    return getNumberFormat({ style: 'currency', currency }).resolvedOptions().minimumFractionDigits;
  } catch {
    return 2;
  }
}

export function amountPlaceholder(currency) {
  const digits = currencyFractionDigits(currency);
  return getNumberFormat({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(0);
}

function smallestUnit(digits) {
  return digits === 0 ? 1 : 10 ** -digits;
}

export function fitsCurrencyGrid(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return false;
  return Number(value.toFixed(currencyFractionDigits(currency))) === value;
}

export function smallestUnitLabel(currency) {
  const digits = currencyFractionDigits(currency);
  return smallestUnit(digits).toFixed(digits);
}

export function amountIsSavable(value, currency, { original = null, originalCurrency = null } = {}) {
  if (fitsCurrencyGrid(value, currency)) return true;
  if (original == null) return false;
  if (originalCurrency != null && originalCurrency !== currency) return false;
  return Number(original) === Number(value);
}

export function amountStep(currency, currentValue) {
  const digits = currencyFractionDigits(currency);
  if (currentValue !== '' && currentValue != null && Number.isFinite(Number(currentValue))) {
    if (!fitsCurrencyGrid(currentValue, currency)) return 'any';
  }
  return smallestUnit(digits).toFixed(digits);
}

export function amountMin(currency, currentValue) {
  const digits = currencyFractionDigits(currency);
  const smallest = smallestUnit(digits);
  const value = Math.abs(Number(currentValue));
  if (Number.isFinite(value) && value > 0 && value < smallest) return String(value);
  return smallest.toFixed(digits);
}

let _separators = null;
function numberSeparators() {
  if (_separators) return _separators;
  const found = new Set();
  for (const code of REGION_CODES) {
    try {
      const dec = new Intl.NumberFormat(code, { minimumFractionDigits: 1 })
        .formatToParts(1.5).find((part) => part.type === 'decimal')?.value;
      const grp = new Intl.NumberFormat(code, { useGrouping: true })
        .formatToParts(1234).find((part) => part.type === 'group')?.value;
      for (const sep of [dec, grp]) if (sep && !/\s/.test(sep)) found.add(sep);
    } catch { /* ungueltiger Regionscode: uebergehen, die Liste bleibt gueltig */ }
  }
  _separators = found;
  return _separators;
}

export function breaksOffAtSeparator(rest) {





  const [erstes, zweites] = [...String(rest ?? '')];
  if (!erstes || !zweites) return false;
  return numberSeparators().has(erstes) && /\p{Nd}/u.test(zweites);
}

function escapeForRegExp(text) {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toDecimalString(value, { freeText = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';




  const plain = getNumberFormat({ useGrouping: false, maximumFractionDigits: 0 });
  const digits = new Map();
  for (let i = 0; i < 10; i += 1) digits.set(plain.format(i), String(i));

  const parts = getNumberFormat({ useGrouping: false, minimumFractionDigits: 1 }).formatToParts(1.5);
  const decimalSep = parts.find((part) => part.type === 'decimal')?.value ?? '.';
  const groupSep = getNumberFormat({ useGrouping: true, maximumFractionDigits: 0 })
    .formatToParts(1234).find((part) => part.type === 'group')?.value;


  //






  // laengst, mit derselben Datei.
  let normalized = '';
  //





  for (const char of raw) {
    normalized += digits.get(char)
      ?? (/\p{Nd}/u.test(char) ? asciiDigit(char) ?? char : char);
  }



  //








  // raus. Zwischen den beiden Schritten stimmt beides.
  if (groupSep && groupSep !== decimalSep) {
    const escaped = escapeForRegExp(groupSep);




    const bereich = freeText
      ? (normalized.match(new RegExp(`^\\d+(?:[${escaped}${escapeForRegExp(decimalSep)}]\\d+)*`))?.[0] ?? '')
      : normalized;
    if (new RegExp(`${escaped}\\d{3}(?!\\d)`).test(bereich)) return '';
  }





  // Fehler erscheint.
  //




  let out = '';
  for (const char of normalized) {
    out += char === decimalSep ? '.' : (asciiSeparator(char) ?? char);
  }
  return out;
}

export function toStoredNumber(value, { maximumFractionDigits = 2 } = {}) {
  return getNumberFormat({ useGrouping: false, maximumFractionDigits }).format(value);
}

export function centsToAmountInput(cents, currency) {
  const digits = currencyFractionDigits(currency);
  return getNumberFormat({
    useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number(cents) / 10 ** digits);
}

export function amountInputToCents(text, currency) {
  const norm = toDecimalString(text);
  if (!/^\d+(\.\d+)?$/.test(norm)) return null;
  const digits = currencyFractionDigits(currency);
  const cents = Math.round(Number(norm) * 10 ** digits);
  return Number.isFinite(cents) ? cents : null;
}

export function applyAmountFormat(input, currency, { required = false } = {}) {
  if (!input) return;
  input.placeholder = amountPlaceholder(currency);
  input.step = amountStep(currency);
  if (required) input.min = amountMin(currency);
}

export function formatSignedAmount(amount, { currency, role, tone, block } = {}) {
  const value = Number(amount) || 0;



  const signDisplay = role === 'flow'
    ? 'exceptZero'
    : 'auto';

  const magnitude = (role === 'total' || role === 'plain') ? Math.abs(value) : value;
  const text = getNumberFormat({ style: 'currency', currency, signDisplay }).format(magnitude);

  const resolvedTone = resolveTone(value, role, tone);
  return { text, tone: resolvedTone, className: block ? `${block}--${resolvedTone}` : '' };
}

function resolveTone(value, role, tone) {
  if (role === 'plain') return 'neutral';
  if (role === 'total') return tone || 'neutral';

  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}
