// --------------------------------------------------------

//






// --------------------------------------------------------

import { rruleLine } from '../services/recurrence.js';
import { vtimezoneFor } from './vtimezone.js';


//



// Verwaltet heisst deshalb beides - ersetzen UND entfernen.
const MANAGED_VEVENT = new Set([
  'SUMMARY', 'DESCRIPTION', 'LOCATION', 'DTSTART', 'DTEND', 'RRULE', 'COLOR',
]);


//




const MANAGED_VTODO = new Set([
  'SUMMARY', 'DESCRIPTION', 'DUE', 'PRIORITY', 'STATUS', 'COMPLETED', 'PERCENT-COMPLETE',
  'CATEGORIES',
]);


const LIST_VALUED = new Set(['CATEGORIES']);


// ihre Parameter deshalb selbst mitbringen: { value, params }.
const PARAMETRIC = new Set(['DTSTART', 'DTEND', 'DUE']);

export function unfoldICS(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/** Zeilen > 75 Oktette falten, damit strenge Server das Objekt annehmen. */
export function foldICSLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts = [];
  let start = 0;
  while (start < bytes.length) {


    let end = Math.min(start + (parts.length === 0 ? 75 : 74), bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push((parts.length === 0 ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n');
}

function propertyName(line) {
  const cut = line.search(/[;:]/);
  return (cut === -1 ? line : line.slice(0, cut)).toUpperCase();
}

function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildLines(name, value) {
  if (value === null || value === undefined || value === '') return [];
  if (PARAMETRIC.has(name)) {
    const { value: v, params = '' } = value;
    if (!v) return [];
    return [`${name}${params}:${v}`];
  }



  if (LIST_VALUED.has(name)) {
    const items = (Array.isArray(value) ? value : [value])
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
    if (!items.length) return [];   // leere Liste = Property entfernen
    return [`${name}:${items.map(escapeText).join(',')}`];
  }
  if (name === 'RRULE') {
    return [rruleLine(value)];
  }
  return [`${name}:${escapeText(value)}`];
}

function patchICSComponent(icsText, uid, fields, component, managed) {
  const lines = unfoldICS(icsText).split('\n');
  const begin = `BEGIN:${component}`;
  const end   = `END:${component}`;


  const blocks = [];
  let current = null;
  lines.forEach((line, index) => {
    const trimmed = line.trim().toUpperCase();
    if (trimmed === begin) {
      current = { start: index, end: -1 };
    } else if (trimmed === end && current) {
      current.end = index;
      blocks.push(current);
      current = null;
    }
  });

  const target = blocks.find((block) => {
    let uidMatch = false;
    let isOverride = false;
    for (let i = block.start + 1; i < block.end; i++) {
      const name = propertyName(lines[i]);
      if (name === 'UID' && lines[i].slice(lines[i].indexOf(':') + 1).trim() === uid) uidMatch = true;
      if (name === 'RECURRENCE-ID') isOverride = true;
    }
    return uidMatch && !isOverride;
  });
  if (!target) return null;

  const replacements = new Map();
  for (const [name, value] of Object.entries(fields)) {
    const upper = name.toUpperCase();
    if (managed.has(upper)) replacements.set(upper, buildLines(upper, value));
  }




  let insertAt = target.end;
  for (let i = target.start + 1; i < target.end; i++) {
    if (lines[i].trim().toUpperCase().startsWith('BEGIN:')) { insertAt = i; break; }
  }

  const out = [];
  const written = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (i === insertAt) {

      for (const [name, replacement] of replacements) {
        if (!written.has(name) && replacement.length) {
          out.push(...replacement);
          written.add(name);
        }
      }
      if (!written.has('SEQUENCE')) {
        out.push('SEQUENCE:1');
        written.add('SEQUENCE');
      }
    }

    const inTarget = i > target.start && i < target.end;
    if (!inTarget) {
      out.push(lines[i]);
      continue;
    }

    const name = propertyName(lines[i]);

    if (name === 'DTSTAMP') {
      out.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
      written.add('DTSTAMP');
      continue;
    }

    if (name === 'SEQUENCE') {
      const n = parseInt(lines[i].slice(lines[i].indexOf(':') + 1), 10);
      out.push(`SEQUENCE:${Number.isFinite(n) ? n + 1 : 1}`);
      written.add('SEQUENCE');
      continue;
    }

    if (replacements.has(name)) {
      // Erste Fundstelle ersetzen, weitere Duplikate fallen weg.
      if (!written.has(name)) {
        out.push(...replacements.get(name));
        written.add(name);
      }
      continue;
    }

    out.push(lines[i]);
  }

  return out.map(foldICSLine).join('\r\n');
}

function anchorFloatingOccurrenceIds(lines, uid, tzid) {
  const isFloating = (line) => {
    const head = line.slice(0, line.indexOf(':'));
    if (/TZID=/i.test(head) || /VALUE=DATE/i.test(head)) return false;

    return !/Z(?:,|$)/.test(line.slice(line.indexOf(':') + 1).trim());
  };

  const out = [...lines];
  let start = -1;
  let uidMatch = false;
  lines.forEach((line, i) => {
    const trimmed = line.trim().toUpperCase();
    if (trimmed === 'BEGIN:VEVENT') { start = i; uidMatch = false; return; }
    if (start < 0) return;
    if (propertyName(line) === 'UID') {
      uidMatch = line.slice(line.indexOf(':') + 1).trim() === uid;
      return;
    }
    if (trimmed === 'END:VEVENT') { start = -1; return; }
    const name = propertyName(line);
    if (!uidMatch || (name !== 'EXDATE' && name !== 'RECURRENCE-ID')) return;
    if (!isFloating(line)) return;
    const colon = line.indexOf(':');
    out[i] = `${line.slice(0, colon)};TZID=${tzid}${line.slice(colon)}`;
  });
  return out;
}

export function ensureVTimezone(icsText, tzid, year = null) {
  if (!tzid) return String(icsText);
  const lines = unfoldICS(icsText).split('\n');




  let inVTimezone = false;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VTIMEZONE') { inVTimezone = true; continue; }
    if (upper === 'END:VTIMEZONE') { inVTimezone = false; continue; }
    if (inVTimezone && upper.startsWith('TZID:')
      && line.trim().slice(5).trim() === tzid) return String(icsText);
  }




  //







  // passiert; im Produktivcode blieb er stehen.
  const resolvedYear = Number.isInteger(year) ? year : new Date().getUTCFullYear();

  const block = vtimezoneFor(tzid, resolvedYear).map(foldICSLine);


  let at = lines.findIndex((l) => /^BEGIN:(?!VCALENDAR)/i.test(l.trim()));
  if (at < 0) at = Math.max(lines.length - 1, 0); // nur END:VCALENDAR uebrig

  return [...lines.slice(0, at), ...block, ...lines.slice(at)]
    .map(foldICSLine).join('\r\n');
}

export function patchICSEvent(icsText, uid, fields = {}, { tzid = null } = {}) {
  const patched = patchICSComponent(icsText, uid, fields, 'VEVENT', MANAGED_VEVENT);
  if (patched === null) return null;



  // mehr (#938).
  const anchored = tzid
    ? anchorFloatingOccurrenceIds(unfoldICS(patched).split('\n'), uid, tzid)
      .map(foldICSLine).join('\r\n')
    : patched;



  const year = Number.parseInt(String(fields?.DTSTART?.value || '').slice(0, 4), 10);
  return ensureVTimezone(anchored, tzid, Number.isInteger(year) ? year : null);
}

export function patchICSTodo(icsText, uid, fields = {}) {
  return patchICSComponent(icsText, uid, fields, 'VTODO', MANAGED_VTODO);
}

export function countVEvents(icsText) {
  const matches = unfoldICS(icsText).match(/^BEGIN:VEVENT\s*$/gim);
  return matches ? matches.length : 0;
}
