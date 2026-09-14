
export function decodeHtmlEntities(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => codePoint(parseInt(hex, 16), m))
    .replace(/&#(\d+);/g, (m, dec) => codePoint(parseInt(dec, 10), m))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}



function codePoint(num, original) {
  if (!Number.isInteger(num) || num < 0 || num > 0x10ffff) return original;
  try {
    return String.fromCodePoint(num);
  } catch {
    return original;
  }
}
