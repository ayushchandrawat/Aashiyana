
import express from 'express';
import * as db from '../../db.js';
import { log, VISIBILITIES, viewerId, badRequest } from './helpers.js';

const router = express.Router();



const FLAT_SCOPES = Object.freeze({
  meds:       { table: 'medications',        column: 'user_id' },
  labs:       { table: 'health_lab_reports', column: 'user_id' },
  activities: { table: 'health_activities',  column: 'user_id' },
});

// Vitalwerte tragen ihre Voreinstellung JE METRIK: wer den Blutdruck teilen





// harmlose Ausgang.
const VITAL_PREFIX = 'vital:';
const VITAL_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;

export function isValidScopeKey(key) {
  const s = String(key || '');
  if (s.startsWith(VITAL_PREFIX)) return VITAL_TYPE_PATTERN.test(s.slice(VITAL_PREFIX.length));
  return Object.prototype.hasOwnProperty.call(FLAT_SCOPES, s);
}

export function defaultVisibilityFor(database, userId, scopeKey) {
  if (!userId || !scopeKey) return 'private';
  try {
    const row = database.prepare(
      'SELECT visibility FROM health_visibility_defaults WHERE user_id = ? AND scope_key = ?'
    ).get(userId, scopeKey);
    return row?.visibility === 'family' ? 'family' : 'private';
  } catch (err) {


    log.error('Reading the visibility default failed:', err.message);
    return 'private';
  }
}

export function vitalScopeKey(type) {
  return `${VITAL_PREFIX}${String(type || '')}`;
}

router.get('/visibility-defaults', (req, res) => {
  try {
    const rows = db.get().prepare(
      'SELECT scope_key, visibility FROM health_visibility_defaults WHERE user_id = ?'
    ).all(viewerId(req));
    const defaults = {};
    for (const r of rows) defaults[r.scope_key] = r.visibility;
    res.json({ data: { defaults } });
  } catch (err) {
    log.error('Error loading visibility defaults:', err.message);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.put('/visibility-defaults', (req, res) => {
  try {
    const viewer = viewerId(req);
    const input = req.body?.defaults;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return badRequest(res, ['defaults must be an object.']);
    }
    const entries = Object.entries(input);
    for (const [key, visibility] of entries) {
      if (!isValidScopeKey(key)) return badRequest(res, [`Unknown scope: ${key}`]);
      if (!VISIBILITIES.includes(visibility)) return badRequest(res, [`Invalid visibility: ${visibility}`]);
    }
    const database = db.get();
    const del = database.prepare('DELETE FROM health_visibility_defaults WHERE user_id = ? AND scope_key = ?');
    const set = database.prepare(`
      INSERT INTO health_visibility_defaults (user_id, scope_key, visibility)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, scope_key) DO UPDATE SET
        visibility = excluded.visibility,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    `);
    database.transaction(() => {
      for (const [key, visibility] of entries) {
        if (visibility === 'family') set.run(viewer, key, visibility);
        else del.run(viewer, key);
      }
    })();
    const rows = database.prepare(
      'SELECT scope_key, visibility FROM health_visibility_defaults WHERE user_id = ?'
    ).all(viewer);
    const defaults = {};
    for (const r of rows) defaults[r.scope_key] = r.visibility;
    res.json({ data: { defaults } });
  } catch (err) {
    log.error('Error saving visibility defaults:', err.message);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.patch('/visibility-defaults/apply', (req, res) => {
  try {
    const viewer = viewerId(req);
    const scope = String(req.body?.scope || '');
    const visibility = req.body?.visibility;
    if (!isValidScopeKey(scope)) return badRequest(res, [`Unknown scope: ${scope}`]);
    if (!VISIBILITIES.includes(visibility)) return badRequest(res, ['visibility is required.']);

    const database = db.get();
    let updated = 0;
    if (scope.startsWith(VITAL_PREFIX)) {
      updated = database.prepare(
        'UPDATE health_vitals SET visibility = ? WHERE user_id = ? AND type = ?'
      ).run(visibility, viewer, scope.slice(VITAL_PREFIX.length)).changes;
    } else {
      const target = FLAT_SCOPES[scope];
      updated = database.prepare(
        `UPDATE ${target.table} SET visibility = ? WHERE ${target.column} = ?`
      ).run(visibility, viewer).changes;
    }
    res.json({ data: { updated: Number(updated) } });
  } catch (err) {
    log.error('Error applying visibility to existing entries:', err.message);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
