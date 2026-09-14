
import {
  toLocalDateKey,
  parseLocalDateKey,
  addLocalDays,
  startOfLocalWeekKey,
  todayKey,
} from '/utils/date.js';

// --------------------------------------------------------
// Metrik-Definitionen
// --------------------------------------------------------



export const MOOD_SCALE = Object.freeze([
  { value: 1, icon: 'frown', labelKey: 'health.vitals.mood.veryBad' },
  { value: 2, icon: 'annoyed', labelKey: 'health.vitals.mood.bad' },
  { value: 3, icon: 'meh', labelKey: 'health.vitals.mood.okay' },
  { value: 4, icon: 'smile', labelKey: 'health.vitals.mood.good' },
  { value: 5, icon: 'laugh', labelKey: 'health.vitals.mood.veryGood' },
]);

export const MOOD_MIN = MOOD_SCALE[0].value;
export const MOOD_MAX = MOOD_SCALE[MOOD_SCALE.length - 1].value;


// value_num2, value_num3). Blutdruck belegt drei (Systole/Diastole/Puls),


//







export const VITAL_METRICS = Object.freeze([
  {
    type: 'bp',
    icon: 'heart-pulse',
    labelKey: 'health.vitals.metric.bp',
    channels: ['value_num', 'value_num2', 'value_num3'],
    channelLabelKeys: [
      'health.vitals.channel.systolic',
      'health.vitals.channel.diastolic',
      'health.vitals.channel.pulse',
    ],
    units: ['mmHg'],
    format: 'pair',
  },
  {
    type: 'glucose',
    icon: 'droplet',
    labelKey: 'health.vitals.metric.glucose',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.glucose'],
    units: ['mg/dL', 'mmol/L'],
  },
  {
    type: 'weight',
    icon: 'scale',
    labelKey: 'health.vitals.metric.weight',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.weight'],
    units: ['kg', 'lb'],
  },




  // eigenes Vorhaben, keine Eigenschaft der Metrik.
  {
    type: 'height',
    icon: 'ruler',
    labelKey: 'health.vitals.metric.height',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.height'],
    units: ['cm', 'in'],
  },
  {
    type: 'head_circumference',
    icon: 'circle-dot',
    labelKey: 'health.vitals.metric.headCircumference',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.headCircumference'],
    units: ['cm', 'in'],
  },
  {
    type: 'spo2',
    icon: 'activity',
    labelKey: 'health.vitals.metric.spo2',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.spo2'],
    units: ['%'],
  },
  {
    type: 'temp',
    icon: 'thermometer',
    labelKey: 'health.vitals.metric.temp',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.temp'],
    units: ['°C', '°F'],
  },






  {
    type: 'sleep',
    icon: 'moon',
    labelKey: 'health.vitals.metric.sleep',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.sleep'],
    units: ['h'],
    format: 'duration',
  },










  {
    type: 'mood',
    icon: 'smile',
    labelKey: 'health.vitals.metric.mood',
    channels: ['value_num'],
    channelLabelKeys: ['health.vitals.metric.mood'],
    units: [],
    format: 'scale',
    domain: { min: MOOD_MIN, max: MOOD_MAX },
  },
]);

export function moodStep(value) {


  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.min(MOOD_MAX, Math.max(MOOD_MIN, Math.round(n)));
  return MOOD_SCALE.find((s) => s.value === rounded) || null;
}

/** Dezimalstunden in ganze Stunden + Minuten. 7.5 -> { hours: 7, minutes: 30 }. */
export function splitDuration(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;

  // „7 h 60 min" herauskommen.
  const totalMinutes = Math.round(n * 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export function durationToHours(hours, minutes) {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) return null;
  return Math.round((h * 60 + m)) / 60;
}

export const VITAL_TYPES = Object.freeze(VITAL_METRICS.map((m) => m.type));

export function vitalMetric(type) {
  return VITAL_METRICS.find((m) => m.type === type) || null;
}

const CHANNEL_KEYS = ['value_num', 'value_num2', 'value_num3'];

function dateKeyOf(measuredAt) {
  return String(measuredAt).slice(0, 10);
}

function toFiniteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildVitalBuckets(range, anchorKey, weekStartsOn = 1) {
  const anchor = anchorKey || todayKey();

  if (range === 'year') {
    const year = parseLocalDateKey(anchor).getFullYear();
    const buckets = [];
    for (let m = 0; m < 12; m++) {
      const first = toLocalDateKey(new Date(year, m, 1));
      buckets.push({ key: first.slice(0, 7), date: first, gran: 'month' });
    }
    return { buckets, from: buckets[0].date, to: toLocalDateKey(new Date(year, 11, 31)), gran: 'month' };
  }

  if (range === 'week') {
    const start = startOfLocalWeekKey(anchor, weekStartsOn);
    const buckets = [];
    for (let i = 0; i < 7; i++) {
      const d = addLocalDays(start, i);
      buckets.push({ key: d, date: d, gran: 'day' });
    }
    return { buckets, from: start, to: buckets[6].date, gran: 'day' };
  }

  // month (Default)
  const d = parseLocalDateKey(anchor);
  const year = d.getFullYear();
  const month = d.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const buckets = [];
  for (let i = 1; i <= days; i++) {
    const key = toLocalDateKey(new Date(year, month, i));
    buckets.push({ key, date: key, gran: 'day' });
  }
  return { buckets, from: buckets[0].date, to: buckets[days - 1].date, gran: 'day' };
}

export function computeVitalSeries(rows, opts = {}) {
  const { type, range = 'month', anchor, weekStartsOn = 1 } = opts;
  const metric = vitalMetric(type);
  const channels = metric ? metric.channels : ['value_num'];

  const typeRows = (Array.isArray(rows) ? rows : []).filter((r) => r && r.type === type);



  const sorted = [...typeRows].sort((a, b) => {
    const ka = String(a.measured_at);
    const kb = String(b.measured_at);
    if (ka === kb) return (b.id || 0) - (a.id || 0);
    return ka < kb ? 1 : -1;
  });
  const latest = sorted[0] || null;
  const previous = sorted[1] || null;

  const deltas = { value_num: null, value_num2: null, value_num3: null };
  if (latest && previous) {
    for (const key of CHANNEL_KEYS) {
      const cur = toFiniteOrNull(latest[key]);
      const prev = toFiniteOrNull(previous[key]);
      if (cur !== null && prev !== null) deltas[key] = cur - prev;
    }
  }

  // Zeitraum-Serie: Buckets aufbauen und Messungen einsortieren.
  const { buckets, from, to, gran } = buildVitalBuckets(range, anchor, weekStartsOn);
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const acc = buckets.map(() => ({
    count: 0,
    sums: { value_num: 0, value_num2: 0, value_num3: 0 },
    counts: { value_num: 0, value_num2: 0, value_num3: 0 },
  }));

  for (const row of typeRows) {
    const dk = dateKeyOf(row.measured_at);
    if (dk < from || dk > to) continue;
    const bucketKey = gran === 'month' ? dk.slice(0, 7) : dk;
    const i = index.get(bucketKey);
    if (i === undefined) continue;
    acc[i].count += 1;
    for (const key of CHANNEL_KEYS) {
      const val = toFiniteOrNull(row[key]);
      if (val !== null) { acc[i].sums[key] += val; acc[i].counts[key] += 1; }
    }
  }

  const points = buckets.map((b, i) => {
    const a = acc[i];
    const avg = (key) => (a.counts[key] > 0 ? a.sums[key] / a.counts[key] : null);
    return {
      key: b.key,
      date: b.date,
      count: a.count,
      value_num: avg('value_num'),
      value_num2: avg('value_num2'),
      value_num3: avg('value_num3'),
    };
  });

  return {
    type,
    range,
    from,
    to,
    gran,
    channels,
    points,
    hasData: points.some((p) => p.count > 0),
    latest,
    previous,
    deltas,
  };
}
