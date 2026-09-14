
import express from 'express';

import { createLogger } from '../../logger.js';
import * as googleCalendar from '../../services/google-calendar.js';
import * as caldavSync from '../../services/caldav-sync.js';
import * as outlookCalendar from '../../services/outlook-calendar.js';

const log = createLogger('Calendar');
const router = express.Router();

async function listGoogleTargets() {
  if (!googleCalendar.getStatus().connected) return [];
  const calendars = await googleCalendar.listCalendars();
  return calendars
    .filter((cal) => cal.enabled && cal.writable)
    .map((cal) => ({
      id: cal.id,
      summary: cal.summary || cal.id,
      defaultAssigneeUserId: cal.default_assignee_user_id ?? null,
    }));
}

async function listCaldavTargets() {
  const targets = [];
  for (const account of caldavSync.listAccounts()) {

    try {
      const calendars = await caldavSync.getCalendars(account.id);
      for (const cal of calendars.filter((c) => c.enabled)) {
        targets.push({
          accountId: account.id,
          accountName: account.name,
          calendarUrl: cal.calendarUrl,
          calendarName: cal.calendarName || cal.calendarUrl,
          defaultAssigneeUserId: cal.default_assignee_user_id ?? null,
        });
      }
    } catch (err) {
      log.warn(`Sync targets: skipping CalDAV account ${account.id}:`, err);
    }
  }
  return targets;
}

function listOutlookTargets() {
  const targets = [];
  for (const account of outlookCalendar.listAccounts()) {
    for (const cal of outlookCalendar.listCalendarSelection(account.id)) {
      if (!cal.enabled || !cal.canEdit) continue;
      targets.push({
        accountId: account.id,
        accountName: account.name,
        calendarId: cal.calendarId,
        calendarName: cal.calendarName || cal.calendarId,
      });
    }
  }
  return targets;
}

router.get('/sync-targets', async (req, res) => {
  try {
    const [google, caldav] = await Promise.all([
      listGoogleTargets().catch((err) => {
        log.warn('Sync targets: Google list failed:', err);
        return [];
      }),
      listCaldavTargets().catch((err) => {
        log.warn('Sync targets: CalDAV list failed:', err);
        return [];
      }),
    ]);
    let outlook = [];
    try {
      outlook = listOutlookTargets();
    } catch (err) {
      log.warn('Sync targets: Outlook list failed:', err);
    }
    res.json({ data: { google, caldav, outlook } });
  } catch (err) {
    log.error('Sync target list failed:', err);
    res.status(500).json({ error: 'Failed to list sync targets.', code: 500 });
  }
});

export default router;
