
import { esc } from '/utils/html.js';
import { isSoloHousehold } from '/utils/household.js';
import { getReadableTextColor, AVATAR_FALLBACK_COLOR } from '/utils/color.js';

export function withWho(sealEl, user) {
  if (!sealEl || !user || isSoloHousehold()) return sealEl;

  const pair = document.createElement('span');
  pair.className = 'seal-pair';
  pair.appendChild(sealEl);
  pair.insertAdjacentHTML('beforeend', whoMarkHtml(user));
  return pair;
}

export function whoMark(user) {
  if (!user || isSoloHousehold()) return '';
  return whoMarkHtml(user);
}

function whoMarkHtml(user) {
  const name = user.display_name ?? '';
  const color = user.avatar_color ?? user.color ?? AVATAR_FALLBACK_COLOR;
  const initials = name.split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 2);
  const inner = user.avatar_data
    ? `<img src="${esc(user.avatar_data)}" alt="" loading="lazy">`
    : esc(initials);
  return `<span class="seal-pair__who"
    style="background-color:${esc(color)};color:${getReadableTextColor(color)}">
    <span class="sr-only">${esc(name)}</span><span aria-hidden="true">${inner}</span>
  </span>`;
}
