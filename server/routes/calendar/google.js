/**
 * Modul: Kalender (Calendar) - Google-Sync + Standard-Zuweisung
 * OAuth, Sync, Kalenderauswahl, Nur-lesen, external-calendars (#459).
 */

import { createLogger } from '../../logger.js';
import express from 'express';
import * as db from '../../db.js';
import * as googleCalendar from '../../services/google-calendar.js';
import { requireAdmin } from '../../auth.js';
import {
  applyDefaultAssigneesToExisting,
  backfillCandidatesToken,
  listBackfillCandidates,
} from '../../services/sync-assignment.js';

const log = createLogger('Calendar');
const router = express.Router();

// --------------------------------------------------------
// Google Calendar Sync-Routen

// --------------------------------------------------------

/**
 * GET /api/v1/calendar/google/auth
 * Admin only. Leitet zum Google OAuth-Consent-Screen weiter.
 */
router.get('/google/auth', requireAdmin, (req, res) => {
  try {
    const url = googleCalendar.getAuthUrl(req.session);
    if (!url) return res.status(503).json({ error: 'Google nicht konfiguriert.', code: 503 });
    res.redirect(url);
  } catch (err) {
    log.error('', err);
    res.status(503).json({ error: err.message, code: 503 });
  }
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code, error, state } = req.query;
    if (error) return res.redirect('/settings?sync_error=google');
    if (!code)  return res.status(400).json({ error: 'Kein Code erhalten.', code: 400 });

    // OAuth CSRF-Schutz: state-Parameter validieren
    if (!state || !req.session.googleOAuthState || state !== req.session.googleOAuthState) {
      log.error('OAuth state mismatch');
      return res.redirect('/settings?sync_error=google');
    }
    delete req.session.googleOAuthState;

    await googleCalendar.handleCallback(code);
    await googleCalendar.sync();

    res.redirect('/settings?sync_ok=google');
  } catch (err) {
    log.error('', err);
    res.redirect('/settings?sync_error=google');
  }
});

/**
 * POST /api/v1/calendar/google/sync
 * Manueller Sync-Trigger.
 * Response: { ok: true, lastSync: string }
 */
router.post('/google/sync', requireAdmin, async (req, res) => {
  try {
    await googleCalendar.sync();
    const { lastSync } = googleCalendar.getStatus();
    res.json({ ok: true, lastSync });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

/**
 * GET /api/v1/calendar/google/status
 * Response: { configured, connected, lastSync }
 */
router.get('/google/status', (req, res) => {
  try {
    res.json(googleCalendar.getStatus());
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

router.get('/google/calendars', requireAdmin, async (req, res) => {
  try {
    const data = await googleCalendar.listCalendars();
    res.json({ data });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

router.patch('/google/calendars', requireAdmin, async (req, res) => {
  const { calendarId, enabled } = req.body;
  if (!calendarId || typeof calendarId !== 'string' || calendarId.trim().length === 0) {
    return res.status(400).json({ error: 'calendarId fehlt oder ist ungültig.', code: 400 });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled muss ein Boolean sein.', code: 400 });
  }
  try {
    googleCalendar.setCalendarEnabled(calendarId, enabled);
    await googleCalendar.sync();
    const { lastSync } = googleCalendar.getStatus();
    res.json({ ok: true, lastSync });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

function knownCalendarName(source, externalId) {
  if (source === 'caldav') {
    return db.get().prepare(
      'SELECT calendar_name AS name FROM caldav_calendar_selection WHERE calendar_url = ? LIMIT 1'
    ).get(externalId)?.name ?? null;
  }
  if (source === 'google') {
    return db.get().prepare(
      'SELECT name FROM google_calendar_selection WHERE calendar_id = ?'
    ).get(externalId)?.name ?? null;
  }
  return null;
}

router.patch('/external-calendars', requireAdmin, (req, res) => {
  try {
    const { source, external_id } = req.body;
    if (!['google', 'apple', 'caldav'].includes(source)) {
      return res.status(400).json({ error: 'source muss google, apple oder caldav sein.', code: 400 });
    }
    if (typeof external_id !== 'string' || external_id.trim().length === 0) {
      return res.status(400).json({ error: 'external_id fehlt oder ist ungültig.', code: 400 });
    }
    const raw = req.body.default_assignee_user_id;
    const assignee = (raw === null || raw === undefined || raw === '') ? null : Number(raw);
    if (assignee !== null && !Number.isInteger(assignee)) {
      return res.status(400).json({ error: 'default_assignee_user_id muss eine Zahl oder null sein.', code: 400 });
    }
    if (assignee !== null && !db.get().prepare('SELECT 1 FROM users WHERE id = ?').get(assignee)) {
      return res.status(400).json({ error: 'Unbekannte Nutzer-ID.', code: 400 });
    }

    const result = db.get().prepare(
      'UPDATE external_calendars SET default_assignee_user_id = ? WHERE source = ? AND external_id = ?'
    ).run(assignee, source, external_id);

    if (result.changes === 0) {
      const name = knownCalendarName(source, external_id);
      if (!name) {
        return res.status(404).json({ error: 'Kalender noch nicht synchronisiert.', code: 404 });
      }


      db.get().prepare(`
        INSERT INTO external_calendars (source, external_id, name, color, default_assignee_user_id)
        VALUES (?, ?, ?, NULL, ?)
      `).run(source, external_id, name, assignee);
    }
    res.json({ data: { source, external_id, default_assignee_user_id: assignee } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

router.get('/external-calendars/default-assignee-backfill', requireAdmin, (req, res) => {
  try {
    const candidates = listBackfillCandidates(db.get());
    res.json({ data: { count: candidates.length, token: backfillCandidatesToken(candidates) } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

router.post('/external-calendars/default-assignee-backfill', requireAdmin, async (req, res) => {
  try {
    const expected = req.body?.expected_count;
    if (!Number.isInteger(expected) || expected < 0) {
      return res.status(400).json({ error: 'expected_count fehlt oder ist ungültig.', code: 400 });
    }
    const expectedToken = req.body?.expected_token;
    if (expectedToken !== undefined && expectedToken !== null
      && (typeof expectedToken !== 'string' || !/^[0-9a-f]{64}$/.test(expectedToken))) {
      return res.status(400).json({ error: 'expected_token ist ungültig.', code: 400 });
    }


    // Happen neue Kandidaten dazukommen.
    const candidates = listBackfillCandidates(db.get());
    const token = backfillCandidatesToken(candidates);
    if (candidates.length !== expected || (expectedToken && expectedToken !== token)) {
      return res.status(409).json({
        error: 'Die Termine haben sich seit der Zählung geändert.', code: 409, data: { count: candidates.length, token },
      });
    }
    res.json({ data: { assigned: await applyDefaultAssigneesToExisting(db.get(), candidates) } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

router.delete('/google/disconnect', requireAdmin, (req, res) => {
  try {
    const { removed } = googleCalendar.disconnect({
      deleteEvents: req.query.deleteEvents === 'true',
    });
    res.json({ ok: true, removed });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

router.delete('/google/mirrored-events', requireAdmin, (req, res) => {
  try {
    res.json({ data: { removed: googleCalendar.clearMirroredEvents() } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

router.put('/google/readonly', requireAdmin, (req, res) => {
  const { readonly } = req.body;
  if (typeof readonly !== 'boolean') {
    return res.status(400).json({ error: 'readonly muss ein Boolean sein.', code: 400 });
  }
  try {
    googleCalendar.setReadonly(readonly);
    res.json({ data: { readonly } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

export default router;
