
export function dictBlock(html, lang) {
  const m = html.match(new RegExp(`\\n\\s*${lang}: \\{\\n([\\s\\S]*?)\\n\\s*\\}`));
  return m ? m[1] : '';
}

export function dictValue(block, key) {
  const m = block.match(new RegExp(`\\b${key}:'((?:[^'\\\\]|\\\\.)*)'`));
  return m ? m[1] : null;
}

export function unescapeJs(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(['"\\])/g, '$1');
}

export function dictKeysMatching(block, pattern) {
  return [...block.matchAll(/(?:^|[{,]\s*)\s*([a-z][a-z0-9_]*)\s*:\s*['"]/gm)]
    .map((m) => m[1])
    .filter((k) => pattern.test(k));
}

export function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&');
}

export function stripTags(s) {
  let out = s;
  let prev;
  do { prev = out; out = out.replace(/<[^>]+>/g, ''); } while (out !== prev);
  return decodeEntities(out).replace(/\s+/g, ' ').trim();
}
