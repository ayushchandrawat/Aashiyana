const AT_RULES_WITH_RULES = /^@(?:media|supports|container|layer|scope)\b/;

export function* eachRule(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = [];
  let index = 0;
  let start = 0;

  while (index < src.length) {
    const char = src[index];

    if (char === '}') {
      at.pop();
      index += 1;
      start = index;
      continue;
    }

    if (char !== '{') {
      index += 1;
      continue;
    }

    const preamble = src.slice(start, index).trim().replace(/\s+/g, ' ');

    if (AT_RULES_WITH_RULES.test(preamble)) {
      at.push(preamble);
      index += 1;
      start = index;
      continue;
    }


    // passenden schliessenden Klammer springen, damit verschachtelte

    let depth = 1;
    let end = index + 1;
    while (end < src.length && depth > 0) {
      if (src[end] === '{') depth += 1;
      else if (src[end] === '}') depth -= 1;
      end += 1;
    }
    if (preamble && !preamble.startsWith('@keyframes')) {
      yield { selector: preamble, body: src.slice(index + 1, end - 1), at: [...at] };
    }
    index = end;
    start = index;
  }
}
