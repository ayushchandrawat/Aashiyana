import { t, formatDate } from '/i18n.js';

export function localizeBirthdayEvent(ev) {
  if (!ev || !ev.birthday_name) return ev;
  const name = ev.birthday_name;
  if (ev.birthday_event_kind === 'name_day') {
    return {
      ...ev,
      title: t('birthdays.nameDayCalendarEventTitle', { name }),
      description: t('birthdays.nameDayCalendarEventDescription', { name }),
    };
  }
  return {
    ...ev,
    title: t('birthdays.calendarEventTitle', { name }),
    description: ev.birthday_date
      ? t('birthdays.calendarEventDescription', { name, date: formatDate(ev.birthday_date) })
      : t('birthdays.calendarEventDescriptionNoDate', { name }),
  };
}
