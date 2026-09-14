
import { computeDueDoses } from '/utils/health-meds.js';
import { addLocalDays } from '/utils/date.js';

function dayKeyOf(value) {
  return String(value || '').slice(0, 10);
}

function logForDose(dose, logs) {
  return (Array.isArray(logs) ? logs : []).find(
    (l) => l && l.schedule_id === dose.scheduleId && l.scheduled_at === dose.scheduledAt,
  ) || null;
}

export function upcomingDoses(schedules, logs, opts = {}) {
  const { today, nowTime = '00:00', limit } = opts;
  if (!today) return [];
  const due = computeDueDoses(schedules, { from: today, to: today });
  const open = due.filter((dose) => {
    if (dose.time < nowTime) return false;
    const log = logForDose(dose, logs);
    return !log || log.status === 'pending';
  });
  return typeof limit === 'number' ? open.slice(0, limit) : open;
}

export function computeAdherenceStreak(schedules, logs, opts = {}) {
  const { today, maxDays = 60 } = opts;
  if (!today) return 0;

  const takenByDay = new Map();
  for (const l of (Array.isArray(logs) ? logs : [])) {
    if (l && l.status === 'taken') {
      const key = dayKeyOf(l.scheduled_at || l.taken_at || l.created_at);
      takenByDay.set(key, (takenByDay.get(key) || 0) + 1);
    }
  }

  let streak = 0;
  let day = today;
  for (let i = 0; i < maxDays; i++) {
    const planned = computeDueDoses(schedules, { from: day, to: day }).length;
    if (planned > 0) {
      const taken = takenByDay.get(day) || 0;
      if (taken >= planned) {
        streak += 1;
      } else if (day !== today) {
        break;
      }

    }
    day = addLocalDays(day, -1);
  }
  return streak;
}
