
import { randomBytes } from 'node:crypto';
import { resolveHouseholdFormats, translate } from '../utils/i18n.js';
import { escapeICSText, foldLine } from './ics-export.js';
import { projectFutureCycles } from '../../public/utils/health-cycle.js';
import { todayKey } from '../utils/timezone.js';

function pad(n) { return String(n).padStart(2, '0'); }

function formatUTCStamp(now) {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
         `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function formatDateValue(dateKey) {
  return dateKey.replace(/-/g, '');
}



// Modul braucht sonst keine weitere Datumsarithmetik aus health-cycle.js.
function addDaysDateKey(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function buildSpanVEvent({ uid, start, end, summary }, dtstamp) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}@aashiyana`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${formatDateValue(start)}`,
    `DTEND;VALUE=DATE:${addDaysDateKey(end, 1)}`,
    `SUMMARY:${escapeICSText(summary)}`,
    'END:VEVENT',
  ];
  return lines.map(foldLine);
}

function buildDayVEvent({ uid, date, summary }, dtstamp) {
  return buildSpanVEvent({ uid, start: date, end: date, summary }, dtstamp);
}

function buildCycleFeed(conn, userId, now = new Date()) {
  const periods = conn.prepare(
    `SELECT id, start_date, end_date FROM cycle_periods WHERE user_id = ? ORDER BY start_date ASC`
  ).all(userId);
  const settings = conn.prepare(`SELECT * FROM cycle_settings WHERE user_id = ?`).get(userId) || {};




  const { locale } = resolveHouseholdFormats(conn);
  const dtstamp = formatUTCStamp(now);

  const out = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aashiyana//Cycle Feed//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICSText(translate(locale, 'health.cycle.ics.calendarName'))}`,
  ];

  for (const p of periods) {
    out.push(...buildSpanVEvent({
      uid: `cycle-period-${p.id}`,
      start: p.start_date,
      end: p.end_date || p.start_date,
      summary: translate(locale, 'health.cycle.ics.periodSummary'),
    }, dtstamp));
  }

  const projected = projectFutureCycles(periods, settings, todayKey(conn, now));
  for (const cyc of projected) {
    out.push(...buildSpanVEvent({
      uid: `cycle-period-predicted-${userId}-${cyc.start}`,
      start: cyc.start,
      end: cyc.end,
      summary: translate(locale, 'health.cycle.ics.predictedPeriodSummary'),
    }, dtstamp));

    if (settings.track_fertility === undefined ? true : !!settings.track_fertility) {
      out.push(...buildSpanVEvent({
        uid: `cycle-fertile-predicted-${userId}-${cyc.start}`,
        start: cyc.fertileStart,
        end: cyc.fertileEnd,
        summary: translate(locale, 'health.cycle.ics.fertileWindowSummary'),
      }, dtstamp));
      out.push(...buildDayVEvent({
        uid: `cycle-ovulation-predicted-${userId}-${cyc.start}`,
        date: cyc.ovulation,
        summary: translate(locale, 'health.cycle.ics.ovulationSummary'),
      }, dtstamp));
    }
  }

  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}

function getFeedToken(conn, userId) {
  const row = conn.prepare(`SELECT cycle_feed_token AS t FROM users WHERE id = ?`).get(userId);
  return row?.t ?? null;
}

function regenerateFeedToken(conn, userId) {
  const token = randomBytes(32).toString('base64url');
  conn.prepare(`UPDATE users SET cycle_feed_token = ? WHERE id = ?`).run(token, userId);
  return token;
}

function clearFeedToken(conn, userId) {
  conn.prepare(`UPDATE users SET cycle_feed_token = NULL WHERE id = ?`).run(userId);
}





function findUserIdByFeedToken(conn, token) {
  if (!token) return null;
  const row = conn.prepare(`SELECT id FROM users WHERE cycle_feed_token = ?`).get(token);
  return row?.id ?? null;
}

export {
  buildCycleFeed,
  getFeedToken, regenerateFeedToken, clearFeedToken, findUserIdByFeedToken,
};
