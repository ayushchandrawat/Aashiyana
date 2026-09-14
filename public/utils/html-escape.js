
const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_RE = /[&<>"']/g;

export function esc(str) {
  if (str == null) return '';
  return String(str).replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
}
