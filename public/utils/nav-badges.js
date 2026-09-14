

const badges = new Map();



const MAX_VISIBLE = 99;

export const BIRTHDAY_BADGE_DAYS = 3;

function iconWrap(navItem) {
  const existing = navItem.querySelector('.nav-item__icon-wrap');
  if (existing) return existing;

  const wrap = document.createElement('span');
  wrap.className = 'nav-item__icon-wrap';
  const icon = navItem.querySelector('.nav-item__icon');
  if (icon) {
    icon.replaceWith(wrap);
    wrap.appendChild(icon);
  } else {
    navItem.prepend(wrap);
  }
  return wrap;
}

const NAV_SCOPES = '.nav-sidebar, .nav-bottom';

function navTargets(route) {
  return [...document.querySelectorAll(NAV_SCOPES)]
    .flatMap((scope) => [...scope.querySelectorAll(`[data-route="${route}"]`)]);
}

function paint(route, entry) {
  navTargets(route).forEach((navItem) => {
    navItem.querySelectorAll('.nav-badge').forEach((el) => el.remove());

    const label = entry?.label?.(entry.count ?? 0);
    if (label) navItem.setAttribute('aria-label', label);

    if (!entry || !(entry.count > 0)) return;

    const badge = document.createElement('span');






    badge.className = `nav-badge${entry.tone ? ` nav-badge--${entry.tone}` : ''}`;

    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = entry.count > MAX_VISIBLE ? `${MAX_VISIBLE}+` : String(entry.count);
    iconWrap(navItem).appendChild(badge);
  });
}

export function setNavBadge(route, count, label, tone) {
  const entry = { count: Number(count) || 0, label, tone };
  badges.set(route, entry);
  paint(route, entry);
}

export function applyNavBadges() {
  for (const [route, entry] of badges) paint(route, entry);
}

/** Welche Routen gerade eine gemerkte Zahl tragen. */
export function navBadgeRoutes() {
  return [...badges.keys()];
}

export function resetNavBadges() {
  badges.clear();
}

export function moduleCountsFrom(data, { isAdmin = false, shoppingVisible = false } = {}) {
  const openDoses = Math.max(0, (data?.health?.dosesTotal ?? 0)
    - (data?.health?.dosesTaken ?? 0) - (data?.health?.dosesSkipped ?? 0));
  const counts = {
    tasks: data?.openTaskCount ?? 0,
    shopping: data?.shoppingOpenCount ?? 0,
    rewards: isAdmin ? (data?.rewards?.pending ?? 0) : 0,
    health: openDoses,
  };
  counts.kitchen = shoppingVisible ? counts.shopping : 0;
  return counts;
}

export function navBadgeCountsFrom(data) {
  return {
    '/tasks': data?.overdueTaskCount ?? 0,
    '/birthdays': data?.birthdaySoonCount ?? 0,
  };
}
