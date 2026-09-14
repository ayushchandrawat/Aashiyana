
import { parseLocalDateKey, addLocalDays } from '/utils/date.js';

// Wochentags-Konvention der days_mask: Bit 0 = Montag … Bit 6 = Sonntag.

export const WEEKDAY_COUNT = 7;

export function weekdayIndex(dateKey) {
  const d = parseLocalDateKey(dateKey);
  return (d.getDay() + 6) % 7;
}

export function daysMaskMatches(mask, weekdayIdx) {
  if (mask === null || mask === undefined || mask === '') return true;
  return (Number(mask) & (1 << weekdayIdx)) !== 0;
}

export function daysMaskToIndices(mask) {
  const out = [];
  for (let i = 0; i < WEEKDAY_COUNT; i++) {
    if (daysMaskMatches(mask, i)) out.push(i);
  }
  return out;
}

export function indicesToDaysMask(indices) {
  const set = new Set((Array.isArray(indices) ? indices : []).map(Number));
  if (set.size === 0 || set.size >= WEEKDAY_COUNT) return null;
  let mask = 0;
  for (const i of set) {
    if (i >= 0 && i < WEEKDAY_COUNT) mask |= (1 << i);
  }
  return mask === 0 ? null : mask;
}

export function computeDueDoses(schedules, range = {}) {
  const { from, to } = range;
  if (!from || !to || from > to) return [];
  const list = Array.isArray(schedules) ? schedules : [];
  const doses = [];

  let dateKey = from;
  let guard = 0;
  while (dateKey <= to && guard < 1000) {
    const wd = weekdayIndex(dateKey);
    for (const s of list) {
      if (!s) continue;
      if (s.active === 0 || s.active === false) continue;
      if (s.start_date && dateKey < s.start_date) continue;
      if (s.end_date && dateKey > s.end_date) continue;
      if (!daysMaskMatches(s.days_mask, wd)) continue;
      const time = s.time_of_day || '00:00';
      doses.push({
        scheduleId: s.id ?? null,
        medicationId: s.medication_id ?? null,
        date: dateKey,
        time,
        scheduledAt: `${dateKey}T${time}`,
        dose_qty: s.dose_qty ?? null,
      });
    }
    dateKey = addLocalDays(dateKey, 1);
    guard += 1;
  }

  doses.sort((a, b) => {
    if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt < b.scheduledAt ? -1 : 1;
    return (a.scheduleId || 0) - (b.scheduleId || 0);
  });
  return doses;
}

export function scheduledLogs(logs) {
  return (Array.isArray(logs) ? logs : []).filter((l) => l && l.scheduled_at);
}

export function computeAdherence(logs, planned) {
  const list = Array.isArray(logs) ? logs : [];
  const taken = list.filter((l) => l && l.status === 'taken').length;
  const skipped = list.filter((l) => l && l.status === 'skipped').length;
  const pending = list.filter((l) => l && l.status === 'pending').length;

  const plannedCount = Number.isFinite(planned) && planned >= 0 ? planned : (taken + skipped);

  const denom = Math.max(plannedCount, taken);
  const rate = denom > 0 ? taken / denom : null;

  return { taken, skipped, pending, planned: plannedCount, rate };
}

// ---- Bedarfsmedikation (#700) ----

export function parseLogInstant(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const [, y, mo, d, h, mi, s] = local;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toLocalStamp(value = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    + `T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function prnDoseState(med, logs, now = new Date()) {
  const hours = med && med.min_interval_hours != null && Number.isFinite(Number(med.min_interval_hours))
    ? Number(med.min_interval_hours)
    : null;
  const intervalHours = hours !== null && hours > 0 ? hours : null;



  let lastTakenAt = null;
  for (const entry of (Array.isArray(logs) ? logs : [])) {
    if (!entry || entry.status !== 'taken') continue;
    const at = parseLogInstant(entry.taken_at || entry.scheduled_at || entry.created_at);
    if (!at) continue;
    if (!lastTakenAt || at > lastTakenAt) lastTakenAt = at;
  }

  if (!lastTakenAt || intervalHours === null) {
    return { lastTakenAt, nextAllowedAt: null, remainingMs: 0, allowed: true, intervalHours };
  }

  const nextAllowedAt = new Date(lastTakenAt.getTime() + intervalHours * 3600 * 1000);
  const remainingMs = Math.max(0, nextAllowedAt.getTime() - now.getTime());
  return { lastTakenAt, nextAllowedAt, remainingMs, allowed: remainingMs === 0, intervalHours };
}

export function splitRemaining(ms) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export function refillState(med) {
  const rawStock = med && med.stock_qty != null ? Number(med.stock_qty) : null;
  const threshold = med && med.refill_threshold != null && Number.isFinite(Number(med.refill_threshold))
    ? Number(med.refill_threshold)
    : null;

  if (rawStock === null || !Number.isFinite(rawStock)) {
    return { level: 'none', stock: null, threshold, below: false };
  }
  if (rawStock <= 0) {
    return { level: 'out', stock: rawStock, threshold, below: true };
  }
  if (threshold !== null && rawStock <= threshold) {
    return { level: 'low', stock: rawStock, threshold, below: true };
  }
  return { level: 'ok', stock: rawStock, threshold, below: false };
}
