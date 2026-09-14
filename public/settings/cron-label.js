
import { t, formatTime, getLocale } from '/i18n.js';

const NUMBER = /^\d+$/;
const STEP = /^\*\/(\d+)$/;


const WEEKDAY_NAMES = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function parseWeekday(field) {
  if (NUMBER.test(field)) {
    const value = Number(field);
    return value >= 0 && value <= 7 ? value % 7 : null;
  }
  const named = WEEKDAY_NAMES[field.slice(0, 3).toLowerCase()];
  return named ?? null;
}

function timeLabel(hour, minute) {


  const p2 = (n) => String(n).padStart(2, '0');
  return formatTime(`${p2(hour)}:${p2(minute)}`);
}

function weekdayLabel(dow) {

  const date = new Date(2000, 0, 2 + dow);
  return new Intl.DateTimeFormat(getLocale(), { weekday: 'long' }).format(date);
}

export function formatCronSchedule(expression) {
  const fields = String(expression ?? '').trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dom, month, dow] = fields;
  if (month !== '*') return null;

  const stepHour = hour.match(STEP);
  if (stepHour && NUMBER.test(minute) && dom === '*' && dow === '*') {
    const count = Number(stepHour[1]);
    if (count < 1 || count > 23) return null;
    return t('settings.backupSchedulerCronHourly', { count, minute: String(Number(minute)).padStart(2, '0') });
  }

  if (!NUMBER.test(minute) || !NUMBER.test(hour)) return null;
  const time = timeLabel(Number(hour), Number(minute));

  if (dom === '*' && dow === '*') {
    return t('settings.backupSchedulerCronDaily', { time });
  }
  if (dom === '*' && dow !== '*') {
    const weekday = parseWeekday(dow);
    if (weekday == null) return null;
    return t('settings.backupSchedulerCronWeekly', { weekday: weekdayLabel(weekday), time });
  }
  if (dow === '*' && NUMBER.test(dom)) {
    const day = Number(dom);
    if (day < 1 || day > 31) return null;
    return t('settings.backupSchedulerCronMonthly', { day, time });
  }
  return null;
}
