// --------------------------------------------------------
// Formatierung ausgehender iCalendar-Werte.

// --------------------------------------------------------

export function toICSDatetime(dt) {
  if (!dt) return '';
  if (!dt.includes('T')) return dt.replace(/-/g, '') + 'T000000';
  const [datePart, rest] = dt.split('T');
  const dateStr = datePart.replace(/-/g, '');
  const m = rest.match(/^(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return `${dateStr}T000000`;
  const ss = m[3] || '00';
  const tz = (m[4] || '').replace(':', '');
  return `${dateStr}T${m[1]}${m[2]}${ss}${tz}`;
}

/** RFC 5545 §3.3.11: Backslash, Semikolon, Komma und Zeilenumbruch maskieren. */
export function escapeICSText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
