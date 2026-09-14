


import { parseLocalDateKey, todayKey as householdToday } from '/utils/date.js';

export const WARRANTY_ALERT_DAYS = 30;

function pad(n) { return String(n).padStart(2, '0'); }

export function warrantyEndDateKey(item) {
  const purchaseDate = item?.purchase_date;
  const months = item?.warranty_months;
  if (!purchaseDate || months == null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(purchaseDate);
  if (!match) return null;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + Number(months));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function warrantyStatus(item, todayKey = householdToday()) {
  const endDateKey = warrantyEndDateKey(item);
  if (!endDateKey) return null;
  const days = Math.round((parseLocalDateKey(endDateKey) - parseLocalDateKey(todayKey)) / 86_400_000);
  const state = days < 0 ? 'expired' : days <= WARRANTY_ALERT_DAYS ? 'expiring' : 'valid';
  return { state, endDateKey, days };
}

export function hasWarrantyAlert(item, todayKey = householdToday()) {
  const status = warrantyStatus(item, todayKey);
  return !!status && status.state !== 'valid';
}

/**
 * @param {string|null} dateKey - YYYY-MM-DD, oder null/leer
 * @param {string} [todayKey]
 * @returns {{ state: 'valid'|'expiring'|'expired', endDateKey: string, days: number } | null}
 */
export function dateStatus(dateKey, todayKey = householdToday()) {
  if (!dateKey) return null;
  const days = Math.round((parseLocalDateKey(dateKey) - parseLocalDateKey(todayKey)) / 86_400_000);
  const state = days < 0 ? 'expired' : days <= WARRANTY_ALERT_DAYS ? 'expiring' : 'valid';
  return { state, endDateKey: dateKey, days };
}

export function hasUpcomingDeadline(item, todayKey = householdToday()) {
  if (hasWarrantyAlert(item, todayKey)) return true;
  const trackedDates = item?.tracked_dates || [];
  return trackedDates.some((d) => {
    const status = dateStatus(d.date, todayKey);
    return !!status && status.state !== 'valid';
  });
}

export function countUpcomingDeadlines(items, todayKey = householdToday()) {
  return items.filter((item) => hasUpcomingDeadline(item, todayKey)).length;
}
