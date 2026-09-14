
import { composeDisplayName, normalizeNameParts } from './contact-name.js';

function unescapeVCard(s) {
  return String(s || '').replace(/\\([\\,;nN])/g, (_, ch) =>
    (ch === 'n' || ch === 'N') ? '\n' : ch
  );
}

function splitUnescaped(value, separator) {
  const parts = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) {
      current += ch + value[i + 1];
      i++;
    } else if (ch === separator) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function isQuotedPrintable(params) {
  return /(?:^|;)ENCODING=(?:QUOTED-PRINTABLE|QP)(?:;|$)/i.test(params || '');
}

function charsetOf(params) {
  const m = /(?:^|;)CHARSET=([^;]+)/i.exec(params || '');
  return (m ? m[1].trim() : '') || 'utf-8';
}

function decodeQuotedPrintable(value, charset) {
  const joined = String(value == null ? '' : value).replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.substr(i + 1, 2))) {
      bytes.push(parseInt(joined.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  const octets = Uint8Array.from(bytes);
  try {
    return new TextDecoder(charset || 'utf-8').decode(octets);
  } catch {
    return new TextDecoder('utf-8').decode(octets);
  }
}

function unfoldVCard(text) {
  const lines = String(text || '').split(/\r?\n/);
  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const colon = line.indexOf(':');
    const head = colon === -1 ? line : line.slice(0, colon);
    if (isQuotedPrintable(head)) {
      while (/=[ \t]*$/.test(line) && i + 1 < lines.length) {
        line = line.replace(/=[ \t]*$/, '') + lines[i + 1];
        i++;
      }
    }
    merged.push(line);
  }
  return merged.join('\n').replace(/\r?\n[ \t]/g, '');
}

export function parseBirthdayValue(value) {
  if (!value) return null;


  const cleaned = String(value).replace(/[^\d-]/g, '');

  // ISO (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  // Kompakt (YYYYMMDD)
  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }

  // Nur Jahr
  if (/^\d{4}$/.test(cleaned)) return `${cleaned}-01-01`;

  return null;
}

export function splitVCards(text) {
  const src = String(text || '');
  const matches = src.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi);
  if (matches && matches.length) return matches;
  return src.trim() ? [src] : [];
}

export function parseVCard(text, opts = {}) {
  const { resolveCategory, fallbackCategory = 'misc' } = opts;

  // Quoted-Printable-Soft-Line-Breaks (vCard 2.1) + Folding (RFC 6350) entfalten.
  const unfolded = unfoldVCard(text);


  const getField = (prop) => {
    const re = new RegExp(`^${prop}(;[^:]*)?:(.*)$`, 'im');
    const m = re.exec(unfolded);
    if (!m) return null;
    return { params: m[1] ? m[1].slice(1) : '', value: m[2].trim() };
  };



  // literale `=` in normalen Werten (URLs, Notizen) unangetastet bleiben.
  const getRaw = (prop) => {
    const f = getField(prop);
    if (!f) return null;
    return isQuotedPrintable(f.params)
      ? decodeQuotedPrintable(f.value, charsetOf(f.params))
      : f.value;
  };

  const get = (prop) => {
    const raw = getRaw(prop);
    return raw === null ? null : unescapeVCard(raw);
  };

  // Strukturierte N-Komponenten erhalten (#535). An *unescapten* Semikola

  // spiegelt server/services/cardav-sync.js#splitVCardValue.
  const nRaw = getRaw('N');
  const nParts = nRaw ? splitUnescaped(nRaw, ';').map(unescapeVCard) : [];
  const nameParts = normalizeNameParts({
    lastName:   nParts[0],
    firstName:  nParts[1],
    middleName: nParts[2],
    namePrefix: nParts[3],
    nameSuffix: nParts[4],
  });


  const name = composeDisplayName(nameParts) || get('FN') || null;
  const phone = get('TEL') || null;
  const email = get('EMAIL') || null;

  // ADR: ;;street;city;region;postal;country
  const adrRaw = get('ADR');
  let address = null;
  if (adrRaw) {
    const parts = adrRaw.split(';').map((p) => p.trim()).filter(Boolean);
    address = parts.join(', ') || null;
  }

  const notes = get('NOTE') || null;
  const birthday = parseBirthdayValue(get('BDAY'));
  const catRaw = get('CATEGORIES') || '';
  const category = (resolveCategory && resolveCategory(catRaw)) || fallbackCategory;

  return { name, ...nameParts, phone, email, address, notes, birthday, category };
}

export function parseVCards(text, opts = {}) {
  return splitVCards(text).map((card) => parseVCard(card, opts));
}
