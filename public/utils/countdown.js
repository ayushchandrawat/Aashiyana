

export const COUNTDOWN_EXACT_DAYS = 30;

export function countdownRank(days) {
  const d = Math.trunc(Number(days) || 0);
  if (d < 0) return 'overdue';
  if (d <= 1) return 'now';
  if (d <= COUNTDOWN_EXACT_DAYS) return 'soon';
  return 'later';
}

export const COUNTDOWN_WEEKS_UNTIL = 60;

export const COUNTDOWN_MONTHS_UNTIL = 364;





const DAYS_PER_MONTH = 30.44;
const DAYS_PER_YEAR = 365.25;

export function daysBetweenDateKeys(fromKey, toKey) {
  const from = parseKey(fromKey);
  const to = parseKey(toKey);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 86400000);
}

function parseKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? '').slice(0, 10));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function countdownPhrase(days) {
  const raw = Math.trunc(Number(days) || 0);




  if (raw < 0) return { key: 'dashboard.countdownOverdue', count: -raw };
  const d = Math.max(0, raw);
  if (d === 0) return { key: 'common.today' };
  if (d === 1) return { key: 'common.tomorrow' };
  if (d <= COUNTDOWN_EXACT_DAYS) return { key: 'dashboard.daysLeft', count: d };
  if (d <= COUNTDOWN_WEEKS_UNTIL) return { key: 'dashboard.countdownWeeks', count: Math.round(d / 7) };
  if (d <= COUNTDOWN_MONTHS_UNTIL) {
    return { key: 'dashboard.countdownMonths', count: Math.round(d / DAYS_PER_MONTH) };
  }

  // „ca. 0 Jahre" herauskommen.
  return { key: 'dashboard.countdownYears', count: Math.max(1, Math.round(d / DAYS_PER_YEAR)) };
}
