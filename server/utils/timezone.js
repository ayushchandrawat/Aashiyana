
export function isValidTimeZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch { return false; }
}

export function serverTimeZone() {
  const envTz = (process.env.TZ || '').trim();
  if (envTz && isValidTimeZone(envTz)) return envTz;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch { return 'UTC'; }
}

export function householdTimeZone(database) {
  try {
    const stored = database?.prepare('SELECT value FROM sync_config WHERE key = ?')
      .get('household_timezone')?.value;
    if (isValidTimeZone(stored)) return stored;
  } catch { /* Tabelle fehlt oder DB zu: Rückfall unten */ }
  return serverTimeZone();
}

export function todayKey(database, now = new Date()) {
  const iso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return utcToWall(iso, householdTimeZone(database))?.date ?? iso.slice(0, 10);
}

export function utcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function hasExplicitZone(value) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(String(value ?? ''));
}

export function storedToInstantMs(value, tz) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (hasExplicitZone(raw)) {
    const ms = new Date(raw).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const local = raw.length <= 10 ? `${raw}T00:00:00` : (raw.length === 16 ? `${raw}:00` : raw);
  const ms = new Date(localToUTC(local, tz)).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function shiftDateKey(dateKey, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? '').slice(0, 10));
  if (!m) return dateKey;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysBetweenDateKeys(fromKey, toKey) {
  const parse = (key) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? '').slice(0, 10));
    if (!match) return null;
    const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Date(ms).toISOString().slice(0, 10) === key ? ms : null;
  };
  const from = parse(fromKey);
  const to = parse(toKey);
  return from === null || to === null ? null : Math.round((to - from) / 86400000);
}

export function localToUTC(localStr, tzid) {
  try {
    const fakeUTC = new Date(localStr + 'Z');
    if (isNaN(fakeUTC.getTime())) return localStr;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    }).formatToParts(fakeUTC);
    const get = (type) => {
      const part = parts.find((p) => p.type === type);
      const v = part ? part.value : '0';



      if (type === 'hour' && v === '24') return 0;
      return parseInt(v, 10);
    };
    const asUTC = Date.UTC(
      get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')
    );
    const offsetMs = fakeUTC.getTime() - asUTC;
    return new Date(fakeUTC.getTime() + offsetMs).toISOString().replace('.000Z', 'Z');
  } catch { return localStr; }
}

export function utcToWall(iso, tzid) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d);
    const g = (t) => { const p = parts.find((x) => x.type === t); return p ? p.value : '00'; };
    let hh = g('hour'); if (hh === '24') hh = '00'; // Mitternacht '24' → '00'
    return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${hh}:${g('minute')}:${g('second')}` };
  } catch { return null; }
}
