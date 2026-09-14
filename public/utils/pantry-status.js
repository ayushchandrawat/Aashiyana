


import { addLocalDays, parseLocalDateKey, todayKey as householdToday } from '/utils/date.js';

export const EXPIRY_SOON_DAYS = 7;

export const PANTRY_FILTERS = Object.freeze(['expired', 'soon', 'low']);

export function pantryItemStatus(item, todayKey = householdToday()) {
  const quantity = Number(item?.quantity ?? 0);
  const min = item?.min_quantity == null ? null : Number(item.min_quantity);

  const out = quantity <= 0;


  const low = !out && min !== null && Number.isFinite(min) && quantity <= min;

  let expiry = null;
  const expiresOn = item?.expires_on || null;
  if (expiresOn) {
    // Reiner Stringvergleich: YYYY-MM-DD ist lexikografisch = chronologisch.
    if (expiresOn < todayKey) expiry = 'expired';
    else if (expiresOn <= addLocalDays(todayKey, EXPIRY_SOON_DAYS)) expiry = 'soon';
  }

  return { out, low, expiry };
}

export function daysUntil(dateKey, todayKey = householdToday()) {
  const from = parseLocalDateKey(todayKey);
  const to = parseLocalDateKey(dateKey);


  return Math.round((to - from) / 86_400_000);
}

export function matchesPantryFilter(item, filter, todayKey = householdToday()) {
  if (!filter || filter === 'all') return true;
  const status = pantryItemStatus(item, todayKey);
  if (filter === 'expired') return status.expiry === 'expired';
  if (filter === 'soon') return status.expiry === 'soon';
  if (filter === 'low') return status.low || status.out;
  return true;
}

export function pantryFilterCounts(items, todayKey = householdToday()) {
  const counts = { expired: 0, soon: 0, low: 0 };
  for (const item of items) {
    const status = pantryItemStatus(item, todayKey);
    if (status.expiry === 'expired') counts.expired += 1;
    if (status.expiry === 'soon') counts.soon += 1;
    if (status.low || status.out) counts.low += 1;
  }
  return counts;
}
