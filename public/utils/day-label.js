
import { t, getLocale, formatDate } from '/i18n.js';
import { todayKey, addLocalDays } from '/utils/date.js';
import { zonedUTCProxy } from '/utils/timezone.js';

export function historyDayLabel(dayKey) {
  const today = todayKey();
  if (dayKey === today) return t('common.today');
  if (dayKey === addLocalDays(today, -1)) return t('common.yesterday');
  const proxy = zonedUTCProxy(`${dayKey}T12:00:00`);
  if (!proxy) return formatDate(dayKey);
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(proxy);
}
