
function toFiniteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateKeyOf(date) {
  return String(date ?? '').slice(0, 10);
}


export const LAB_FLAGS = Object.freeze(['low', 'normal', 'high']);

export function deriveFlag(value, refLow, refHigh) {
  const v = toFiniteOrNull(value);
  if (v === null) return null;
  const low = toFiniteOrNull(refLow);
  const high = toFiniteOrNull(refHigh);
  if (low !== null && v < low) return 'low';
  if (high !== null && v > high) return 'high';
  if (low !== null || high !== null) return 'normal';
  return null;
}

export function summarizeReport(report) {
  const results = report && Array.isArray(report.results) ? report.results : [];
  const total = results.length;
  const abnormal = results.filter((r) => r && r.flag && r.flag !== 'normal').length;
  return { total, abnormal, hasAbnormal: abnormal > 0 };
}

export function analyteNames(reports) {
  const seen = new Map(); // lowercase → Original-Schreibweise (erstes Auftreten)
  const list = Array.isArray(reports) ? reports : [];
  for (const rep of list) {
    const results = rep && Array.isArray(rep.results) ? rep.results : [];
    for (const r of results) {
      const raw = r && r.analyte != null ? String(r.analyte).trim() : '';
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!seen.has(key)) seen.set(key, raw);
    }
  }
  return [...seen.values()];
}

export function analyteTrend(reports, analyteName) {
  const name = String(analyteName ?? '').trim().toLowerCase();
  if (!name) return [];
  const list = Array.isArray(reports) ? reports : [];
  const points = [];

  for (const rep of list) {
    if (!rep) continue;
    const results = Array.isArray(rep.results) ? rep.results : [];
    const match = results.find(
      (r) => r && String(r.analyte ?? '').trim().toLowerCase() === name
    );
    if (!match) continue;
    const value = toFiniteOrNull(match.value_num);
    if (value === null) continue;
    points.push({
      reportId: rep.id ?? null,
      date: dateKeyOf(rep.report_date),
      value,
      unit: match.unit ?? null,
      flag: match.flag ?? null,
      refLow: toFiniteOrNull(match.ref_low),
      refHigh: toFiniteOrNull(match.ref_high),
    });
  }

  points.sort((a, b) => {
    if (a.date === b.date) return (a.reportId || 0) - (b.reportId || 0);
    return a.date < b.date ? -1 : 1;
  });
  return points;
}
