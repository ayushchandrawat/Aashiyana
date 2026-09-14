
/**
 * Schneidet HTML-Kommentare heraus, bis nichts mehr uebrig bleibt.
 * @param {string} src
 * @returns {string}
 */
export function withoutHtmlComments(src) {
  let out = src;
  let previous;
  do {
    previous = out;
    out = out.replace(/<!--[\s\S]*?-->/g, '');
  } while (out !== previous);
  return out;
}

export function withoutBlockComments(src) {
  let out = src;
  let previous;
  do {
    previous = out;
    out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  } while (out !== previous);
  return out;
}

export function withoutCommentsKeepingLines(src) {
  let out = src;
  let previous;
  do {
    previous = out;
    out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  } while (out !== previous);
  return out.split('\n').map((z) => z.replace(/(^|[^:\\])\/\/.*$/, '$1')).join('\n');
}
