
const STORAGE_KEY = 'aashiyana-timezone';

const _formatterCache = new Map();

let _cachedZone;

export function isValidTimeZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch { return false; }
}

export function displayTimeZone() {
  if (_cachedZone !== undefined) return _cachedZone;
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { stored = null; }
  _cachedZone = isValidTimeZone(stored) ? stored : null;
  return _cachedZone;
}

export function setDisplayTimeZone(zone) {
  const next = isValidTimeZone(zone) ? zone : null;
  _cachedZone = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* privater Modus o.ä.: der Prozess-Cache oben trägt die Sitzung */ }
}

export function _resetDisplayTimeZoneCache() {
  _cachedZone = undefined;
}

export function hasExplicitZone(value) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(String(value ?? ''));
}

export function isDateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function isInstant(value) {
  if (value instanceof Date) return true;
  if (typeof value === 'number') return true;
  return typeof value === 'string' && hasExplicitZone(value);
}

function formatterFor(zone) {
  let fmt = _formatterCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    _formatterCache.set(zone, fmt);
  }
  return fmt;
}

export function zonedFields(value) {
  if (value === null || value === undefined || value === '') return null;




  if (typeof value === 'string' && !hasExplicitZone(value)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
    if (m) {
      return {
        year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
        hour: Number(m[4] ?? 0), minute: Number(m[5] ?? 0), second: Number(m[6] ?? 0),
      };
    }
    // Kein erkanntes Muster (z. B. 'March 3, 2026'): unten als Instant versuchen.
  }

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const zone = displayTimeZone();
  if (!zone) {
    return {
      year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
      hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
    };
  }

  const parts = formatterFor(zone).formatToParts(d);
  const g = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };



  const hour = g('hour');
  return {
    year: g('year'), month: g('month'), day: g('day'),
    hour: hour === 24 ? 0 : hour, minute: g('minute'), second: g('second'),
  };
}

const pad2 = (n) => String(n).padStart(2, '0');

export function zonedDateKey(value) {
  const f = zonedFields(value);
  return f ? `${f.year}-${pad2(f.month)}-${pad2(f.day)}` : '';
}

export function zonedTimeKey(value) {
  const f = zonedFields(value);
  return f ? `${pad2(f.hour)}:${pad2(f.minute)}` : '';
}

export function todayKey(now = new Date()) {
  return zonedDateKey(now);
}

export function nowFields(now = new Date()) {
  return zonedFields(now);
}

export function zonedUTCProxy(value) {
  const f = zonedFields(value);
  if (!f) return null;
  return new Date(Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second));
}

export function zonedWeekday(value) {
  const f = zonedFields(value);
  if (!f) return null;
  return new Date(Date.UTC(f.year, f.month - 1, f.day)).getUTCDay();
}
