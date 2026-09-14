


const BOUNDARY = /[\p{L}\p{N}_]/u;

export function splitMentions(text, users) {
  const raw = String(text ?? '');
  const list = (Array.isArray(users) ? users : [])
    .filter((u) => u && u.display_name)

    .sort((a, b) => String(b.display_name).length - String(a.display_name).length);

  const segments = [];
  let plain = '';
  let i = 0;

  const flush = () => {
    if (plain) segments.push({ type: 'text', text: plain });
    plain = '';
  };

  while (i < raw.length) {
    const isAt = raw[i] === '@';
    const boundaryOk = i === 0 || !BOUNDARY.test(raw[i - 1]);
    if (!isAt || !boundaryOk) {
      plain += raw[i];
      i += 1;
      continue;
    }

    const rest = raw.slice(i + 1);
    const hit = list.find((u) => {
      const name = String(u.display_name);
      if (rest.slice(0, name.length).toLowerCase() !== name.toLowerCase()) return false;


      const after = rest[name.length];
      return after === undefined || !BOUNDARY.test(after);
    });

    if (!hit) {
      plain += raw[i];
      i += 1;
      continue;
    }

    flush();
    const typed = raw.slice(i, i + 1 + String(hit.display_name).length);
    segments.push({ type: 'mention', text: typed, user: hit });
    i += typed.length;
  }

  flush();
  return segments;
}

export function mentionedUserIds(text, users) {
  const ids = [];
  for (const segment of splitMentions(text, users)) {
    if (segment.type !== 'mention') continue;
    if (!ids.includes(segment.user.id)) ids.push(segment.user.id);
  }
  return ids;
}

export function applyMention(text, caret, displayName) {
  const value = String(text ?? '');
  const name = String(displayName ?? '');
  if (!name) return null;

  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && BOUNDARY.test(upto[at - 1])) return null;

  const before = value.slice(0, at);
  const afterAt = value.slice(at + 1);





  // Leerzeichen darin vorkommt.
  let getippt = 0;
  while (getippt < name.length && getippt < afterAt.length
    && afterAt[getippt].toLowerCase() === name[getippt].toLowerCase()) getippt += 1;



  // hinaus, damit ein eigenstaendiges Wort dahinter stehen bleibt.
  const rest = value.slice(caret);
  const bisWortende = (caret - (at + 1)) + rest.search(/[^\p{L}\p{N}_]|$/u);
  const consumed = Math.max(getippt, bisWortende);
  const after = value.slice(at + 1 + consumed);
  const inserted = `@${name}${after === '' || BOUNDARY.test(after[0]) ? ' ' : ''}`;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}
