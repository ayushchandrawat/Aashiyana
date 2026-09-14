import { createLogger } from '../logger.js';
import * as dbModule from '../db.js';
import { pushService as defaultPushService } from './push.js';
import { createNotificationChannelStore } from './notification-channels.js';
import { defaultProviders } from './notifications.js';
import { resolveHouseholdLocale, translate } from '../utils/i18n.js';

const log = createLogger('MedicationScheduler');
const APP_NAME = 'Aashiyana';

const FALLBACK_BODY = 'Medication reminder';
const PROVIDER_TIMEOUT_MS = 8_000;

/** Lokaler Datums-Key (YYYY-MM-DD) ohne UTC-Shift. */
function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Lokale Uhrzeit 'HH:MM'. */
function localTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Wochentag-Index (Mo=0…So=6) eines Datums-Keys. */
function weekdayIndex(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

function scheduleDueOnDate(schedule, dateKey) {
  if (schedule.active === 0) return false;
  if (schedule.start_date && dateKey < schedule.start_date) return false;
  if (schedule.end_date && dateKey > schedule.end_date) return false;
  if (schedule.days_mask === null || schedule.days_mask === undefined) return true;
  return (schedule.days_mask & (1 << weekdayIndex(dateKey))) !== 0;
}

async function withTimeout(fn, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function processDueMedications({
  database,
  pushService = defaultPushService,
  channelStore,
  providers = defaultProviders,
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  const activeDb = database || dbModule.get();
  const store = channelStore || createNotificationChannelStore({ db: activeDb });
  const dateKey = localDateKey(now);
  const nowTime = localTime(now);

  const schedules = activeDb.prepare(`
    SELECT s.*, m.user_id AS owner_id, m.name AS med_name, u.display_name AS owner_name
    FROM medication_schedules s
    JOIN medications m ON m.id = s.medication_id
    JOIN users u ON u.id = m.user_id
    WHERE s.active = 1 AND m.active = 1
  `).all();






  const caregiversOf = activeDb.prepare(
    'SELECT caregiver_id FROM health_care_grants WHERE subject_id = ? ORDER BY caregiver_id'
  );

  const findLog = activeDb.prepare(
    'SELECT id FROM medication_logs WHERE medication_id = ? AND schedule_id = ? AND scheduled_at = ?'
  );
  const insertLog = activeDb.prepare(
    'INSERT INTO medication_logs (medication_id, schedule_id, scheduled_at, status, dose_qty) VALUES (?, ?, ?, ?, ?)'
  );

  const counters = { due: 0, created: 0, notified: 0, sent: 0, failed: 0 };
  const newlyDue = [];

  for (const s of schedules) {
    if (!scheduleDueOnDate(s, dateKey)) continue;
    if (s.time_of_day > nowTime) continue;
    const scheduledAt = `${dateKey}T${s.time_of_day}`;
    counters.due += 1;
    if (findLog.get(s.medication_id, s.id, scheduledAt)) continue; // schon erzeugt
    insertLog.run(s.medication_id, s.id, scheduledAt, 'pending', s.dose_qty ?? null);
    counters.created += 1;
    newlyDue.push({
      ownerId: s.owner_id, ownerName: s.owner_name, medName: s.med_name,
      medicationId: s.medication_id, scheduledAt,
    });
  }




  const originTitle = translate(resolveHouseholdLocale(activeDb), 'health.tabs.meds');

  for (const dose of newlyDue) {
    const medBody = dose.medName || FALLBACK_BODY;
    counters.notified += 1;







    const recipients = [{ userId: dose.ownerId, body: medBody }];
    for (const { caregiver_id: caregiverId } of caregiversOf.all(dose.ownerId)) {
      if (caregiverId === dose.ownerId) continue;
      recipients.push({ userId: caregiverId, body: `${dose.ownerName}: ${medBody}` });
    }

    for (const recipient of recipients) {
      const payload = {
        title: originTitle || APP_NAME,
        body: recipient.body,
        url: '/health/meds',
        tag: `medication-${dose.medicationId}-${dose.scheduledAt}`,
        priority: 'default',
      };

      try {
        const sent = await pushService.sendPushToUser(recipient.userId, payload);
        if (sent > 0) counters.sent += 1;
      } catch (err) {
        counters.failed += 1;
        log.error(`Web Push failed for medication ${dose.medicationId}:`, err?.message || err);
      }

      const channels = store.listEnabledChannelsForUser(recipient.userId);
      for (const channel of channels) {
        const provider = providers[channel.provider];
        if (!provider) continue;
        try {
          await withTimeout((signal) => provider.send({ channel, payload, fetchImpl, signal }));
          counters.sent += 1;
        } catch (err) {
          counters.failed += 1;
          log.error(`Channel delivery failed for medication ${dose.medicationId}:`, err?.message || err);
        }
      }
    }
  }

  if (counters.created) log.info(`Created ${counters.created} due medication dose(s).`);
  return counters;
}

export function startScheduler() {
  const run = () => {
    processDueMedications().catch((err) => log.error('Medication scheduler run failed:', err?.message || err));
  };
  setTimeout(run, 15_000).unref();
  setInterval(run, 60_000).unref();
  log.info('Medication scheduler active (every 60s).');
}
