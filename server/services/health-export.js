
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  s = s.replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s}"`;
}

export function toCsv(header, rows) {
  const head = (header || []).map(csvCell).join(',');
  const body = (rows || []).map((r) => (r || []).map(csvCell).join(',')).join('\n');
  return body ? `${head}\n${body}` : head;
}

const VITALS_HEADER = ['measured_at', 'type', 'value_num', 'value_num2', 'value_num3', 'unit', 'note', 'visibility'];
const ACTIVITIES_HEADER = ['performed_at', 'type', 'duration_min', 'distance_km', 'intensity', 'calories', 'note', 'visibility'];
const LABS_HEADER = ['report_date', 'lab_name', 'analyte', 'value_num', 'unit', 'ref_low', 'ref_high', 'flag', 'visibility', 'note'];
const MED_LOGS_HEADER = ['scheduled_at', 'medication', 'status', 'taken_at', 'dose_qty', 'note'];
const CYCLE_HEADER = ['start_date', 'end_date', 'period_length_days', 'cycle_length_days', 'note', 'visibility'];

function daySpan(aKey, bKey, inclusive = false) {
  if (!aKey || !bKey) return '';
  const a = Date.parse(`${String(aKey).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(bKey).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return '';
  return Math.round((b - a) / 86400000) + (inclusive ? 1 : 0);
}

/** Vitalwerte-Zeilen → CSV. */
export function vitalsToCsv(rows) {
  return toCsv(VITALS_HEADER, (rows || []).map((r) => VITALS_HEADER.map((k) => r[k])));
}

export function activitiesToCsv(rows) {
  return toCsv(ACTIVITIES_HEADER, (rows || []).map((r) => ACTIVITIES_HEADER.map((k) => r[k])));
}

export function labsToCsv(reports) {
  const rows = [];
  for (const report of (reports || [])) {
    const results = Array.isArray(report.results) ? report.results : [];
    if (!results.length) {
      rows.push([report.report_date, report.lab_name, '', '', '', '', '', '', report.visibility, report.note]);
      continue;
    }
    for (const r of results) {
      rows.push([
        report.report_date, report.lab_name, r.analyte, r.value_num, r.unit,
        r.ref_low, r.ref_high, r.flag, report.visibility, report.note,
      ]);
    }
  }
  return toCsv(LABS_HEADER, rows);
}

/**
 * Medikamenten-Dosis-Logs → CSV.
 * @param {Array<Object>} logs - Log-Zeilen mit `medication_name`.
 */
export function medLogsToCsv(logs) {
  return toCsv(MED_LOGS_HEADER, (logs || []).map((l) => [
    l.scheduled_at, l.medication_name, l.status, l.taken_at, l.dose_qty, l.note,
  ]));
}

export function cycleToCsv(periods) {
  const list = periods || [];
  const rows = list.map((p, i) => {
    const next = list[i + 1];
    return [
      p.start_date,
      p.end_date || '',
      p.end_date ? daySpan(p.start_date, p.end_date, true) : '',
      next ? daySpan(p.start_date, next.start_date) : '',
      p.note,
      p.visibility,
    ];
  });
  return toCsv(CYCLE_HEADER, rows);
}

export const HEALTH_EXPORT_HEADERS = Object.freeze({
  vitals: VITALS_HEADER,
  activities: ACTIVITIES_HEADER,
  labs: LABS_HEADER,
  medLogs: MED_LOGS_HEADER,
  cycle: CYCLE_HEADER,
});
