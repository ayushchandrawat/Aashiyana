
const TZ_SUFFIX = /[zZ]|[+-]\d{2}:?\d{2}$/;

export function parseRemindAtAsUtc(value) {
  return new Date(TZ_SUFFIX.test(value) ? value : `${value}Z`);
}

export function parseOffsetMsFromReminder(task, reminder) {
  if (!task?.due_date || !reminder?.remind_at) return null;
  const due = task.due_time
    ? new Date(`${task.due_date}T${task.due_time}`)
    : new Date(`${task.due_date}T23:59:59`);
  const remind = parseRemindAtAsUtc(reminder.remind_at);
  if (Number.isNaN(due.getTime()) || Number.isNaN(remind.getTime())) return null;
  return due.getTime() - remind.getTime();
}

const PRESET_MAP = new Map([
  [0, 'offset_at_time'],
  [15 * 60 * 1000, 'offset_15m'],
  [60 * 60 * 1000, 'offset_1h'],
  [24 * 60 * 60 * 1000, 'offset_1d'],
  [2 * 24 * 60 * 60 * 1000, 'offset_2d'],
  [7 * 24 * 60 * 60 * 1000, 'offset_1w'],
  [14 * 24 * 60 * 60 * 1000, 'offset_2w'],
]);

export function resolveReminderPreset(task, reminder) {
  const offset = parseOffsetMsFromReminder(task, reminder);
  if (offset === null) return { preset: 'offset_15m', amount: '15', unit: 'minutes' };
  if (PRESET_MAP.has(offset)) return { preset: PRESET_MAP.get(offset), amount: '1', unit: 'days' };
  const minutes = Math.round(offset / 60000);
  if (minutes > 0) return { preset: 'offset_custom', amount: String(minutes), unit: 'minutes' };
  return { preset: 'offset_at_time', amount: '1', unit: 'days' };
}
