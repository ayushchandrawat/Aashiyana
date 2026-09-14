
import { addLocalDays, startOfLocalWeekKey, todayKey } from '/utils/date.js';

// --------------------------------------------------------
// Preset-Definitionen (Trainingsarten)
// --------------------------------------------------------




export const ACTIVITY_TYPES = Object.freeze([
  { value: 'running',  labelKey: 'health.activity.type.running',  icon: 'footprints' },
  { value: 'cycling',  labelKey: 'health.activity.type.cycling',  icon: 'bike' },
  { value: 'swimming', labelKey: 'health.activity.type.swimming', icon: 'waves' },
  { value: 'strength', labelKey: 'health.activity.type.strength', icon: 'dumbbell' },
  { value: 'yoga',     labelKey: 'health.activity.type.yoga',     icon: 'flower' },
  { value: 'walking',  labelKey: 'health.activity.type.walking',  icon: 'move' },
  { value: 'other',    labelKey: 'health.activity.type.other',    icon: 'activity' },
]);

export const ACTIVITY_TYPE_VALUES = Object.freeze(ACTIVITY_TYPES.map((a) => a.value));

export function activityType(value) {
  return ACTIVITY_TYPES.find((a) => a.value === value) || null;
}

function dateKeyOf(performedAt) {
  return String(performedAt ?? '').slice(0, 10);
}

function toFiniteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function weekSummary(activities, opts = {}) {
  const { anchor, weekStartsOn = 1 } = opts;
  const start = startOfLocalWeekKey(anchor || todayKey(), weekStartsOn);

  const buckets = [];
  const index = new Map();
  for (let i = 0; i < 7; i++) {
    const d = addLocalDays(start, i);
    buckets.push({ key: d, date: d, index: i, durationMin: 0, count: 0 });
    index.set(d, i);
  }
  const from = start;
  const to = buckets[6].date;

  const list = Array.isArray(activities) ? activities : [];
  for (const a of list) {
    if (!a) continue;
    const i = index.get(dateKeyOf(a.performed_at));
    if (i === undefined) continue;
    const dur = toFiniteOrNull(a.duration_min);
    if (dur !== null) buckets[i].durationMin += dur;
    buckets[i].count += 1;
  }

  return { buckets, from, to };
}

export function activityTotals(activities) {
  const list = Array.isArray(activities) ? activities : [];
  let count = 0;
  let durationMin = 0;
  let distanceKm = 0;
  let calories = 0;
  for (const a of list) {
    if (!a) continue;
    count += 1;
    const dur = toFiniteOrNull(a.duration_min);
    if (dur !== null) durationMin += dur;
    const dist = toFiniteOrNull(a.distance_km);
    if (dist !== null) distanceKm += dist;
    const cal = toFiniteOrNull(a.calories);
    if (cal !== null) calories += cal;
  }
  return { count, durationMin, distanceKm, calories };
}
