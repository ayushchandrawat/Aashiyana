


//








// identisch auf.
import { addLocalDays, startOfLocalWeekKey, todayKey as householdToday } from './date.js';

// --------------------------------------------------------
// Preset-Definitionen
// --------------------------------------------------------


export const FLOW_LEVELS = Object.freeze([
  { value: 'spotting', labelKey: 'health.cycle.flow.spotting', rank: 1 },
  { value: 'light',    labelKey: 'health.cycle.flow.light',    rank: 2 },
  { value: 'medium',   labelKey: 'health.cycle.flow.medium',   rank: 3 },
  { value: 'heavy',    labelKey: 'health.cycle.flow.heavy',    rank: 4 },
]);

export const FLOW_VALUES = Object.freeze(FLOW_LEVELS.map((f) => f.value));

export function flowLevel(value) {
  return FLOW_LEVELS.find((f) => f.value === value) || null;
}

// Symptome (Mehrfachauswahl je Tag, seit Phase 2 mit optionaler 1-3-
// Intensitaet je Auswahl). Icon = Lucide-Name. `hasIntensity` steht an jedem


export const SYMPTOM_TYPES = Object.freeze([
  { value: 'cramps',        labelKey: 'health.cycle.symptom.cramps',        icon: 'zap',            hasIntensity: true },
  { value: 'headache',      labelKey: 'health.cycle.symptom.headache',      icon: 'brain',           hasIntensity: true },
  { value: 'backache',      labelKey: 'health.cycle.symptom.backache',      icon: 'move-vertical',   hasIntensity: true },
  { value: 'bloating',      labelKey: 'health.cycle.symptom.bloating',      icon: 'circle-dot',      hasIntensity: true },
  { value: 'tender_breasts', labelKey: 'health.cycle.symptom.tenderBreasts', icon: 'heart',          hasIntensity: true },
  { value: 'acne',          labelKey: 'health.cycle.symptom.acne',          icon: 'sparkle',         hasIntensity: true },
  { value: 'fatigue',       labelKey: 'health.cycle.symptom.fatigue',       icon: 'battery-low',     hasIntensity: true },
  { value: 'nausea',        labelKey: 'health.cycle.symptom.nausea',        icon: 'thermometer',     hasIntensity: true },
  { value: 'cravings',      labelKey: 'health.cycle.symptom.cravings',      icon: 'cookie',          hasIntensity: true },
  { value: 'insomnia',      labelKey: 'health.cycle.symptom.insomnia',      icon: 'moon',            hasIntensity: true },
  { value: 'constipation',  labelKey: 'health.cycle.symptom.constipation',  icon: 'circle-dashed',   hasIntensity: true },
  { value: 'diarrhea',      labelKey: 'health.cycle.symptom.diarrhea',      icon: 'droplets',        hasIntensity: true },
  { value: 'joint_pain',    labelKey: 'health.cycle.symptom.jointPain',     icon: 'bone',             hasIntensity: true },
  { value: 'dizziness',     labelKey: 'health.cycle.symptom.dizziness',     icon: 'waves',            hasIntensity: true },
  { value: 'hot_flashes',   labelKey: 'health.cycle.symptom.hotFlashes',    icon: 'thermometer-sun',  hasIntensity: true },
  { value: 'swelling',      labelKey: 'health.cycle.symptom.swelling',      icon: 'glass-water',      hasIntensity: true },
  { value: 'libido_change', labelKey: 'health.cycle.symptom.libidoChange',  icon: 'flame',            hasIntensity: true },
  { value: 'discharge_change', labelKey: 'health.cycle.symptom.dischargeChange', icon: 'droplet',     hasIntensity: true },
  { value: 'appetite_change', labelKey: 'health.cycle.symptom.appetiteChange', icon: 'utensils',      hasIntensity: true },
  { value: 'concentration_difficulty', labelKey: 'health.cycle.symptom.concentrationDifficulty', icon: 'brain-circuit', hasIntensity: true },
]);

export const SYMPTOM_VALUES = Object.freeze(SYMPTOM_TYPES.map((s) => s.value));

// Abstufung einer Symptom-Auswahl (1-3, optional). Kein 4./5. Grad - drei


// "kein Medizinprodukt" in docs/SPEC.md).
export const INTENSITY_LEVELS = Object.freeze([
  { value: 1, labelKey: 'health.cycle.intensity.mild' },
  { value: 2, labelKey: 'health.cycle.intensity.moderate' },
  { value: 3, labelKey: 'health.cycle.intensity.severe' },
]);

export function symptomIntensityLabelKey(intensity) {
  const level = INTENSITY_LEVELS.find((l) => l.value === Number(intensity));
  return level ? level.labelKey : null;
}

const SYMPTOM_KEY_RE = /^[a-z0-9_]{1,32}$/;

export function normalizeSymptomEntries(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  const list = typeof raw === 'string' ? raw.split(',') : (Array.isArray(raw) ? raw : []);
  const byKey = new Map();
  for (const item of list) {
    const isObj = item !== null && typeof item === 'object';
    const key = String(isObj ? (item.key ?? '') : item).trim().toLowerCase();
    if (!SYMPTOM_KEY_RE.test(key)) continue;
    const n = isObj ? Number(item.intensity) : NaN;
    const intensity = Number.isInteger(n) && n >= 1 && n <= 3 ? n : null;
    byKey.set(key, { key, intensity });
  }
  return [...byKey.values()];
}

export function symptomType(value) {
  return SYMPTOM_TYPES.find((s) => s.value === value) || null;
}

// Stimmung (Einfachauswahl je Tag).
export const MOOD_TYPES = Object.freeze([
  { value: 'great',     labelKey: 'health.cycle.mood.great',     icon: 'smile' },
  { value: 'good',      labelKey: 'health.cycle.mood.good',      icon: 'smile-plus' },
  { value: 'neutral',   labelKey: 'health.cycle.mood.neutral',   icon: 'meh' },
  { value: 'sensitive', labelKey: 'health.cycle.mood.sensitive', icon: 'cloud-drizzle' },
  { value: 'sad',       labelKey: 'health.cycle.mood.sad',       icon: 'frown' },
  { value: 'irritable', labelKey: 'health.cycle.mood.irritable', icon: 'flame' },
  { value: 'anxious',   labelKey: 'health.cycle.mood.anxious',   icon: 'wind' },
]);

export const MOOD_VALUES = Object.freeze(MOOD_TYPES.map((m) => m.value));

export function moodType(value) {
  return MOOD_TYPES.find((m) => m.value === value) || null;
}


export const PHASE = Object.freeze({
  MENSTRUATION: 'menstruation',
  FOLLICULAR: 'follicular',
  FERTILE: 'fertile',
  OVULATION: 'ovulation',
  LUTEAL: 'luteal',
});


const DEFAULT_CYCLE = 28;
const DEFAULT_PERIOD = 5;
const DEFAULT_LUTEAL = 14;
const FERTILE_WINDOW_DAYS = 6; // Eisprungtag + 5 Tage davor
const MAX_HISTORY = 6;


export const MIN_HISTORY_GAPS = 3;
const GESTATION_DAYS = 280;

// Allgemein ueblicher Zykluslaenge-Bereich (Phase 4d), Standardliteratur (z.B.
// ACOG-nahe Quellen) - bewusst ZUSAETZLICH zum SELBSTBEZUEGLICHEN `regular`/


// allgemein ueblichen Bereich" vs. "ist DEIN Zyklus fuer DICH konsistent").
export const TYPICAL_CYCLE_RANGE = Object.freeze({ min: 24, max: 38 });

export function isTypicalCycleLength(days) {
  return Number.isFinite(days) && days >= TYPICAL_CYCLE_RANGE.min && days <= TYPICAL_CYCLE_RANGE.max;
}

// --------------------------------------------------------
// Datums-Helfer (YYYY-MM-DD, ohne UTC-Shift-Fallen)
// --------------------------------------------------------

function dayKey(value) {
  return String(value ?? '').slice(0, 10);
}

/** Ganzzahlige Tagesdifferenz b − a (beide YYYY-MM-DD). */
export function daysBetween(aKey, bKey) {
  const a = Date.parse(`${dayKey(aKey)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(bKey)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function numOrNull(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function mean(nums) {
  const list = nums.filter((n) => Number.isFinite(n));
  if (!list.length) return null;
  return list.reduce((s, n) => s + n, 0) / list.length;
}

// --------------------------------------------------------
// Historie: Sortierung & Kennzahlen
// --------------------------------------------------------

export function sortPeriodsAsc(periods) {
  return [...(periods || [])]
    .filter((p) => p && p.start_date)
    .sort((a, b) => {
      const ka = dayKey(a.start_date);
      const kb = dayKey(b.start_date);
      if (ka === kb) return (a.id || 0) - (b.id || 0);
      return ka < kb ? -1 : 1;
    });
}

export function cycleGaps(periods) {
  const asc = sortPeriodsAsc(periods);
  const gaps = [];
  for (let i = 1; i < asc.length; i += 1) {
    const gap = daysBetween(asc[i - 1].start_date, asc[i].start_date);
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  return gaps;
}

export function cycleLengthTrend(periods) {
  const asc = sortPeriodsAsc(periods);
  const trend = [];
  for (let i = 1; i < asc.length; i += 1) {
    const days = daysBetween(asc[i - 1].start_date, asc[i].start_date);
    if (Number.isFinite(days) && days > 0) trend.push({ date: dayKey(asc[i].start_date), days });
  }
  return trend;
}

export function periodLengths(periods) {
  return sortPeriodsAsc(periods)
    .filter((p) => p.end_date)
    .map((p) => daysBetween(p.start_date, p.end_date) + 1)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 15);
}

export function cycleStats(periods, settings = {}) {
  const asc = sortPeriodsAsc(periods);
  const gaps = cycleGaps(asc).slice(-MAX_HISTORY);
  const lengths = periodLengths(asc).slice(-MAX_HISTORY);






  const derivedCycle = gaps.length >= MIN_HISTORY_GAPS ? clampInt(mean(gaps), 15, 60) : null;
  const derivedPeriod = lengths.length >= MIN_HISTORY_GAPS ? clampInt(mean(lengths), 1, 15) : null;



  const settingCycle = clampInt(numOrNull(settings.cycle_length_avg), 15, 60);
  const settingPeriod = clampInt(numOrNull(settings.period_length_avg), 1, 15);
  const luteal = clampInt(numOrNull(settings.luteal_length), 8, 18) ?? DEFAULT_LUTEAL;

  const avgCycle = settingCycle ?? derivedCycle ?? DEFAULT_CYCLE;
  const avgPeriod = settingPeriod ?? derivedPeriod ?? DEFAULT_PERIOD;

  const minCycle = gaps.length ? Math.min(...gaps) : null;
  const maxCycle = gaps.length ? Math.max(...gaps) : null;
  const variation = minCycle != null ? maxCycle - minCycle : null;

  const regular = gaps.length >= 2 ? variation <= 7 : null;

  return {
    count: asc.length,
    avgCycle,
    avgPeriod,
    lutealLength: luteal,
    minCycle,
    maxCycle,
    variation,
    regular,
    trackFertility: settings.track_fertility === undefined ? true : !!settings.track_fertility,
    source: settingCycle ? 'settings' : (derivedCycle ? 'history' : (gaps.length > 0 ? 'insufficient_history' : 'default')),
  };
}

// --------------------------------------------------------
// Schwangerschaft
// --------------------------------------------------------

export function pregnancyInfo(settings = {}, todayKey = householdToday()) {
  const active = !!(settings.pregnancy_mode === 1 || settings.pregnancy_mode === true);
  const dueRaw = settings.pregnancy_due_date ? dayKey(settings.pregnancy_due_date) : null;
  const hasDue = !!dueRaw && !Number.isNaN(Date.parse(`${dueRaw}T00:00:00Z`));
  const today = dayKey(todayKey);

  if (!active || !hasDue) {
    return { active, dueDate: hasDue ? dueRaw : null, hasDue };
  }

  const lmpDate = addLocalDays(dueRaw, -GESTATION_DAYS);
  const daysUntilDue = daysBetween(today, dueRaw);

  const gestationalDays = Math.max(0, Math.min(GESTATION_DAYS, GESTATION_DAYS - daysUntilDue));
  const gestWeeks = Math.floor(gestationalDays / 7);
  const gestDays = gestationalDays % 7;
  // Trimester: 1 = SSW 0–13, 2 = SSW 14–27, 3 = ab SSW 28.
  const trimester = gestWeeks < 14 ? 1 : (gestWeeks < 28 ? 2 : 3);
  const overdue = daysUntilDue < 0;

  return {
    active,
    dueDate: dueRaw,
    hasDue,
    lmpDate,
    daysUntilDue,
    gestationalDays,
    gestWeeks,
    gestDays,
    trimester,
    overdue,
    progress: Math.max(0, Math.min(1, gestationalDays / GESTATION_DAYS)),
  };
}

// --------------------------------------------------------

// --------------------------------------------------------


// (Fruchtbarkeitsbewusstsein-Praxis, nicht klinisch normiert - siehe
// "kein Medizinprodukt" in docs/SPEC.md). Sechs Tage Basislinie, drei Tage

const TEMP_SHIFT_THRESHOLD_C = 0.2;
const TEMP_BASELINE_READINGS = 6;
const TEMP_SUSTAINED_DAYS = 3;

function toCelsius(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return unit === 'f' ? (n - 32) * 5 / 9 : n;
}

function temperatureReadings(dayLogs, sinceKey = null) {
  const since = sinceKey ? dayKey(sinceKey) : null;
  return (dayLogs || [])
    .filter((l) => l && l.basal_temp != null && (!since || dayKey(l.log_date) >= since))
    .map((l) => ({ date: dayKey(l.log_date), celsius: toCelsius(l.basal_temp, l.basal_temp_unit) }))
    .filter((r) => r.celsius != null)
    .sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
}

export function bbtSeries(dayLogs) {
  return temperatureReadings(dayLogs);
}

function reconstructCycles(periods, settings = {}) {
  const asc = sortPeriodsAsc(periods);
  if (!asc.length) return [];
  const stats = cycleStats(asc, settings);
  return asc.map((p, i) => {
    const cycleStart = dayKey(p.start_date);
    const nextStart = i + 1 < asc.length ? dayKey(asc[i + 1].start_date) : addLocalDays(cycleStart, stats.avgCycle);
    const mensEnd = p.end_date ? dayKey(p.end_date) : addLocalDays(cycleStart, stats.avgPeriod - 1);
    const lutealStart = addLocalDays(nextStart, -stats.lutealLength);
    return { cycleStart, nextStart, mensEnd, lutealStart };
  });
}

function classifyDayPhase(cyc, dateKey) {
  if (daysBetween(cyc.cycleStart, dateKey) >= 0 && daysBetween(dateKey, cyc.mensEnd) >= 0) return PHASE.MENSTRUATION;
  if (daysBetween(cyc.lutealStart, dateKey) >= 0) return PHASE.LUTEAL;
  return 'other';
}

export function symptomFrequencyByPhase(dayLogs, periods, settings = {}) {
  const cycles = reconstructCycles(periods, settings);
  if (!cycles.length) return [];

  function phaseFor(dateKey) {
    const cyc = cycles.find((c) => daysBetween(c.cycleStart, dateKey) >= 0 && daysBetween(dateKey, c.nextStart) > 0);
    return cyc ? classifyDayPhase(cyc, dateKey) : null;
  }

  const counts = new Map();
  for (const log of (dayLogs || [])) {
    if (!log?.log_date) continue;
    const phase = phaseFor(dayKey(log.log_date));
    if (!phase) continue;
    for (const entry of normalizeSymptomEntries(log.symptoms)) {
      const c = counts.get(entry.key) || { key: entry.key, [PHASE.MENSTRUATION]: 0, [PHASE.LUTEAL]: 0, other: 0, total: 0, _intensities: [] };
      c[phase] += 1;
      c.total += 1;
      if (entry.intensity != null) c._intensities.push(entry.intensity);
      counts.set(entry.key, c);
    }
  }


  // bleibt von "mild" unterscheidbar.
  return [...counts.values()]
    .map(({ _intensities, ...c }) => ({ ...c, avgIntensity: mean(_intensities) }))
    .sort((a, b) => b.total - a.total);
}

export function symptomIntensityTrend(dayLogs, symptomKey) {
  const out = [];
  for (const log of (dayLogs || [])) {
    if (!log?.log_date) continue;
    for (const entry of normalizeSymptomEntries(log.symptoms)) {
      if (entry.key === symptomKey && entry.intensity != null) {
        out.push({ date: dayKey(log.log_date), intensity: entry.intensity });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
}

export function symptomCyclePattern(dayLogs, periods, settings = {}, symptomKey, maxCycles = 6) {
  const allCycles = reconstructCycles(periods, settings);
  if (!allCycles.length) return { cycles: [], occurredCount: 0, totalCount: 0, mostCommonPhase: null, typicalDaysBeforePeriod: null };

  // Juengster Zyklus zuerst, auf maxCycles gedeckelt.
  const recent = [...allCycles].reverse().slice(0, maxCycles);


  // ausgeschlossene Eingabe) haetten sonst denselben String-Schluessel und
  // teilten sich dieselbe occurredOnDays-Liste.
  const occByCycle = new Map(recent.map((c) => [c, []]));
  const phaseCounts = { [PHASE.MENSTRUATION]: 0, [PHASE.LUTEAL]: 0, other: 0 };

  for (const log of (dayLogs || [])) {
    if (!log?.log_date) continue;
    const dateKey = dayKey(log.log_date);
    const cyc = recent.find((c) => daysBetween(c.cycleStart, dateKey) >= 0 && daysBetween(dateKey, c.nextStart) > 0);
    if (!cyc) continue;
    const hasSymptom = normalizeSymptomEntries(log.symptoms).some((e) => e.key === symptomKey);
    if (!hasSymptom) continue;
    occByCycle.get(cyc).push(daysBetween(cyc.cycleStart, dateKey) + 1);
    phaseCounts[classifyDayPhase(cyc, dateKey)] += 1;
  }

  const cycles = recent.map((c) => {
    const cycleLength = daysBetween(c.cycleStart, c.nextStart);
    const phaseByDay = Array.from({ length: cycleLength }, (_, i) => classifyDayPhase(c, addLocalDays(c.cycleStart, i)));
    return {
      cycleStart: c.cycleStart,
      cycleLength,
      occurredOnDays: occByCycle.get(c).sort((a, b) => a - b),
      phaseByDay,
    };
  });

  const occurredCount = cycles.filter((c) => c.occurredOnDays.length > 0).length;
  const maxPhaseCount = Math.max(...Object.values(phaseCounts));
  const mostCommonPhase = maxPhaseCount > 0
    ? [PHASE.MENSTRUATION, PHASE.LUTEAL, 'other'].find((k) => phaseCounts[k] === maxPhaseCount)
    : null;








  const lutealDaysBeforeCounts = new Map();
  for (const c of cycles) {
    for (const day of c.occurredOnDays) {
      if (c.phaseByDay[day - 1] !== PHASE.LUTEAL) continue;
      const daysBefore = c.cycleLength - day + 1;
      lutealDaysBeforeCounts.set(daysBefore, (lutealDaysBeforeCounts.get(daysBefore) || 0) + 1);
    }
  }
  let typicalDaysBeforePeriod = null;
  let bestCount = 1;
  for (const [daysBefore, count] of lutealDaysBeforeCounts) {
    if (count > bestCount) { bestCount = count; typicalDaysBeforePeriod = daysBefore; }
  }

  return { cycles, occurredCount, totalCount: cycles.length, mostCommonPhase, typicalDaysBeforePeriod };
}







const LIKELIHOOD_THRESHOLD = 0.5;

const MIN_ELIGIBLE_CYCLES_FOR_DAY = 2;

export function predictSymptomLikelihood(dayLogs, periods, settings = {}, symptomKey, todayKey = householdToday()) {
  const asc = sortPeriodsAsc(periods);
  if (!asc.length) return { likelyDates: [], todayCycleDay: 0, isLikelyToday: false };

  const lastStart = dayKey(asc[asc.length - 1].start_date);
  const todayCycleDay = daysBetween(lastStart, dayKey(todayKey)) + 1;

  const pattern = symptomCyclePattern(dayLogs, periods, settings, symptomKey);
  if (pattern.totalCount < MIN_HISTORY_GAPS) {
    return { likelyDates: [], todayCycleDay, isLikelyToday: false };
  }

  const maxDay = Math.max(...pattern.cycles.map((c) => c.cycleLength));
  const likelyDayNumbers = [];
  for (let day = 1; day <= maxDay; day++) {
    const eligible = pattern.cycles.filter((c) => c.cycleLength >= day);
    if (eligible.length < MIN_ELIGIBLE_CYCLES_FOR_DAY) continue;
    const hits = eligible.filter((c) => c.occurredOnDays.includes(day)).length;
    if (hits / eligible.length >= LIKELIHOOD_THRESHOLD) likelyDayNumbers.push(day);
  }

  const likelyDates = likelyDayNumbers.map((day) => addLocalDays(lastStart, day - 1));
  const isLikelyToday = likelyDayNumbers.includes(todayCycleDay);

  return { likelyDates, todayCycleDay, isLikelyToday };
}

export function detectTemperatureShift(dayLogs, cycleStart) {
  const readings = temperatureReadings(dayLogs, cycleStart);

  if (readings.length < TEMP_BASELINE_READINGS + TEMP_SUSTAINED_DAYS) return null;

  for (let i = TEMP_BASELINE_READINGS; i <= readings.length - TEMP_SUSTAINED_DAYS; i += 1) {
    const baseline = mean(readings.slice(i - TEMP_BASELINE_READINGS, i).map((r) => r.celsius));
    if (baseline == null) continue;
    const threshold = baseline + TEMP_SHIFT_THRESHOLD_C;
    const sustained = readings.slice(i, i + TEMP_SUSTAINED_DAYS).every((r) => r.celsius >= threshold);
    if (sustained) return readings[i].date;
  }
  return null;
}

// --------------------------------------------------------
// Vorhersage
// --------------------------------------------------------

export function predictCycle(periods, settings = {}, todayKey = householdToday(), dayLogs = []) {
  const asc = sortPeriodsAsc(periods);
  const stats = cycleStats(asc, settings);
  const today = dayKey(todayKey);
  const pregnancy = pregnancyInfo(settings, today);




  // der Schwangerschaft nahtlos weiterrechnet.
  if (pregnancy.active) {
    return { hasData: !!asc.length, isPregnant: true, pregnancy, stats, trackFertility: false };
  }

  if (!asc.length) {
    return { hasData: false, isPregnant: false, pregnancy, stats, trackFertility: stats.trackFertility };
  }


  const past = asc.filter((p) => daysBetween(p.start_date, today) >= 0);
  const anchor = (past.length ? past[past.length - 1] : asc[asc.length - 1]);
  const lastStart = dayKey(anchor.start_date);

  const { avgCycle, avgPeriod, lutealLength } = stats;
  const cycleDay = daysBetween(lastStart, today) + 1; // Tag 1 = Starttag

  const nextStart = addLocalDays(lastStart, avgCycle);
  const daysUntilNext = daysBetween(today, nextStart);

  // Aktuelle Blutungsphase: laufende (end offen → avgPeriod) oder abgeschlossene
  // Episode, die „heute" abdeckt.
  const inLoggedPeriod = asc.some((p) => {
    const s = dayKey(p.start_date);
    const e = p.end_date ? dayKey(p.end_date) : addLocalDays(s, avgPeriod - 1);
    return daysBetween(s, today) >= 0 && daysBetween(today, e) >= 0;
  });

  const trackFertility = stats.trackFertility;
  let ovulationDate = addLocalDays(nextStart, -lutealLength);
  let ovulationConfirmed = false;
  if (trackFertility) {
    const confirmed = detectTemperatureShift(dayLogs, lastStart);
    if (confirmed) { ovulationDate = confirmed; ovulationConfirmed = true; }
  }
  const fertileStart = addLocalDays(ovulationDate, -(FERTILE_WINDOW_DAYS - 1));
  const fertileEnd = ovulationDate;


  let phase = PHASE.FOLLICULAR;
  if (inLoggedPeriod || (cycleDay >= 1 && cycleDay <= avgPeriod)) {
    phase = PHASE.MENSTRUATION;
  } else if (trackFertility && daysBetween(today, ovulationDate) === 0) {
    phase = PHASE.OVULATION;
  } else if (trackFertility && daysBetween(fertileStart, today) >= 0 && daysBetween(today, fertileEnd) >= 0) {
    phase = PHASE.FERTILE;
  } else if (daysBetween(ovulationDate, today) > 0) {
    phase = PHASE.LUTEAL;
  } else {
    phase = PHASE.FOLLICULAR;
  }

  return {
    hasData: true,
    isPregnant: false,
    pregnancy,
    stats,
    trackFertility,
    lastStart,
    cycleDay,
    avgCycle,
    avgPeriod,
    lutealLength,
    nextStart,
    daysUntilNext,
    ovulationDate: trackFertility ? ovulationDate : null,
    ovulationConfirmed: trackFertility ? ovulationConfirmed : false,
    fertileStart: trackFertility ? fertileStart : null,
    fertileEnd: trackFertility ? fertileEnd : null,
    daysUntilOvulation: trackFertility ? daysBetween(today, ovulationDate) : null,
    phase,
    inLoggedPeriod,
    isPredictedOverdue: daysUntilNext < 0,
  };
}

// --------------------------------------------------------
// Monatskalender
// --------------------------------------------------------

function loggedPeriodPhase(dateKey, periodsAsc, avgPeriod) {
  return periodsAsc.some((p) => {
    const s = dayKey(p.start_date);
    const e = p.end_date ? dayKey(p.end_date) : addLocalDays(s, avgPeriod - 1);
    return daysBetween(s, dateKey) >= 0 && daysBetween(dateKey, e) >= 0;
  });
}

export function projectFutureCycles(periods, settings = {}, todayKey = householdToday()) {
  const asc = sortPeriodsAsc(periods);
  if (!asc.length || pregnancyInfo(settings, todayKey).active) return [];

  const stats = cycleStats(asc, settings);
  const lastStart = dayKey(asc[asc.length - 1].start_date);
  const projected = [];
  for (let k = 1; k <= 3; k += 1) {
    const start = addLocalDays(lastStart, stats.avgCycle * k);
    const ovulation = addLocalDays(start, -stats.lutealLength);
    projected.push({
      start,
      end: addLocalDays(start, stats.avgPeriod - 1),
      ovulation,
      fertileStart: addLocalDays(ovulation, -(FERTILE_WINDOW_DAYS - 1)),
      fertileEnd: ovulation,
    });
  }
  return projected;
}

export function buildCycleCalendar(anchorKey, { periods = [], logs = [], settings = {}, todayKey = householdToday(), weekStartsOn = 1 } = {}) {
  const asc = sortPeriodsAsc(periods);
  const stats = cycleStats(asc, settings);
  const { avgPeriod, trackFertility } = stats;
  const today = dayKey(todayKey);

  const logByDate = new Map();
  for (const l of (logs || [])) {
    if (l && l.log_date) logByDate.set(dayKey(l.log_date), l);
  }


  // dieselbe Projektion wie projectFutureCycles() (Phase 5 braucht denselben

  const projected = projectFutureCycles(asc, settings, today);

  const anchor = dayKey(anchorKey);
  const monthStr = anchor.slice(0, 7); // YYYY-MM
  const firstOfMonth = `${monthStr}-01`;
  const gridStart = startOfLocalWeekKey(firstOfMonth, weekStartsOn);

  const cell = (dateKey) => {
    const inMonth = dateKey.slice(0, 7) === monthStr;
    const log = logByDate.get(dateKey) || null;

    let phase = null;
    let predicted = false;
    if (loggedPeriodPhase(dateKey, asc, avgPeriod)) {
      phase = PHASE.MENSTRUATION;
    } else {
      for (const c of projected) {
        if (daysBetween(c.start, dateKey) >= 0 && daysBetween(dateKey, c.end) >= 0) { phase = PHASE.MENSTRUATION; predicted = true; break; }
        if (trackFertility && daysBetween(c.ovulation, dateKey) === 0) { phase = PHASE.OVULATION; predicted = true; break; }
        if (trackFertility && daysBetween(c.fertileStart, dateKey) >= 0 && daysBetween(dateKey, c.fertileEnd) >= 0) { phase = PHASE.FERTILE; predicted = true; break; }
      }
    }

    return {
      dateKey,
      day: Number(dateKey.slice(8, 10)),
      inMonth,
      isToday: dateKey === today,
      isFuture: daysBetween(today, dateKey) > 0,
      phase,
      predicted,
      flow: log?.flow || null,



      hasLog: !!log && !!(log.flow || log.symptoms?.length || log.mood || log.note),
    };
  };

  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const row = [];
    for (let d = 0; d < 7; d += 1) {
      row.push(cell(addLocalDays(gridStart, w * 7 + d)));
    }
    weeks.push(row);
  }
  return { month: monthStr, weeks };
}

// --------------------------------------------------------

// --------------------------------------------------------

export function cycleRing(prediction) {
  if (!prediction || !prediction.hasData) return null;

  if (prediction.isPregnant) return null;
  const total = prediction.avgCycle;
  const seg = (fromDay, toDay) => ({
    start: Math.max(0, (fromDay - 1) / total),
    end: Math.min(1, toDay / total),
  });

  const segments = [];
  // Menstruation: Tag 1..avgPeriod.
  const m = seg(1, prediction.avgPeriod);
  segments.push({ phase: PHASE.MENSTRUATION, start: m.start, end: m.end });

  let ovulationFrac = null;
  if (prediction.trackFertility) {



    // kalendarische Position, obwohl ein Messwert etwas anderes belegt.
    let ovDay = total - prediction.lutealLength;
    if (prediction.ovulationConfirmed && prediction.lastStart && prediction.ovulationDate) {
      ovDay = daysBetween(prediction.lastStart, prediction.ovulationDate) + 1;
    }
    const fStart = ovDay - (FERTILE_WINDOW_DAYS - 1);
    const f = seg(fStart, ovDay);
    if (f.end > f.start) segments.push({ phase: PHASE.FERTILE, start: f.start, end: f.end });
    const o = seg(ovDay, ovDay);
    segments.push({ phase: PHASE.OVULATION, start: o.start, end: o.end });
    ovulationFrac = (ovDay - 0.5) / total;
  }

  const clampedDay = Math.min(Math.max(prediction.cycleDay, 1), total);
  const currentFrac = (clampedDay - 0.5) / total;

  return { total, segments, ovulationFrac, currentFrac, ovulationConfirmed: !!prediction.ovulationConfirmed };
}
