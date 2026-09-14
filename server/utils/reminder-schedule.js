
const REMINDER_TIME = '09:00';

export const REMINDER_TIME_SUFFIX = `T${REMINDER_TIME}`;


function dateKey(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function parseDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Date must be in YYYY-MM-DD format.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (dateKey(date) !== value) throw new Error('Date is invalid.');
  return date;
}

export function reminderDateBefore(dueDateKey, offsetDays) {
  const date = parseDateKey(dueDateKey);
  date.setUTCDate(date.getUTCDate() - Math.max(0, Number(offsetDays) || 0));
  return `${dateKey(date)}T${REMINDER_TIME}`;
}

export function reminderIsInThePast(remindAt, now = new Date()) {
  return new Date(`${remindAt}Z`).getTime() <= now.getTime();
}
