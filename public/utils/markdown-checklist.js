
const CHECKLIST_RE = /^( {0,3}[-*+]\s+\[)([ xX])(\]\s+.*)$/;

export function matchChecklistLine(line) {
  const m = String(line ?? '').match(CHECKLIST_RE);
  if (!m) return null;
  return {
    checked: m[2].toLowerCase() === 'x',
    prefix:  m[1],
    suffix:  m[3],

    // Renderer durch inlineMarkdown() schickt.
    text: m[3].replace(/^\]\s+/, ''),
  };
}

export function splitKeepingLineEndings(content) {
  return String(content ?? '').split(/(\r\n|\n|\r)/);
}

export function toggleChecklistLine(content, line, checked, expect) {
  if (!Number.isInteger(line) || line < 0) return { ok: false, reason: 'out_of_range' };

  const parts = splitKeepingLineEndings(content);
  const at    = line * 2;
  if (at >= parts.length) return { ok: false, reason: 'out_of_range' };

  const current = parts[at];
  if (expect !== undefined && expect !== null && current !== expect) {
    return { ok: false, reason: 'stale' };
  }

  const item = matchChecklistLine(current);
  if (!item) return { ok: false, reason: 'not_a_checklist_line' };




  if (item.checked === checked) return { ok: true, content: String(content ?? ''), changed: false };

  parts[at] = `${item.prefix}${checked ? 'x' : ' '}${item.suffix}`;
  return { ok: true, content: parts.join(''), changed: true };
}
