
import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import * as v from '../middleware/validate.js';
import { syncAllBirthdayReminders } from '../services/birthdays.js';
import { fanOutEventReminders, eventAuthorId } from '../services/event-reminder-fanout.js';
import { deniedModules } from '../permissions.js';
import { tokenAllows } from '../scopes.js';

const log    = createLogger('Reminders');
const router = express.Router();

const VALID_ENTITY_TYPES = ['task', 'event', 'subscription', 'inventory_item', 'inventory_tracked_date', 'pantry_item', 'cycle_period', 'cycle_log_nudge', 'schedule_entry', 'schedule_extra_entry', 'waste_pickup'];

function syncEventFanout(entityType, entityId, userId) {
  if (entityType !== 'event') return;
  try {
    if (eventAuthorId(db.get(), entityId) !== userId) return;
    fanOutEventReminders(db.get(), entityId, userId);
  } catch (err) {




    log.error('Error fanning out event reminders:', err.message);
  }
}

const DERIVED_ENTITY_TYPES = ['pantry_item', 'cycle_period', 'cycle_log_nudge', 'schedule_entry', 'schedule_extra_entry', 'waste_pickup'];

const ORIGIN_MODULE = Object.freeze({
  task:                   'tasks',
  event:                  'calendar',
  subscription:           'budget',
  inventory_item:         'inventory',
  inventory_tracked_date: 'inventory',
  pantry_item:            'pantry',
  cycle_period:           'health',
  cycle_log_nudge:        'health',
  schedule_entry:         'schedule',
  schedule_extra_entry:   'schedule',
  waste_pickup:           'waste',
});

function mayTouchOrigin(req, entityType, access = 'read') {
  const moduleKey = ORIGIN_MODULE[entityType];

  if (!moduleKey) return false;
  if (deniedModules(req.sessionModuleAccess).has(moduleKey)) return false;
  return tokenAllows(req.authScopes, moduleKey, access);
}

function readableOrigins(req) {
  return Object.keys(ORIGIN_MODULE).filter((type) => mayTouchOrigin(req, type, 'read'));
}

const SETTABLE_ENTITY_TYPES = VALID_ENTITY_TYPES.filter((t) => !DERIVED_ENTITY_TYPES.includes(t));

function derivedTypeError(entityType) {
  return `Reminders for ${entityType} are derived from the item itself and cannot be set here.`;
}


const MAX_REMINDERS_PER_ENTITY = 5;

// --------------------------------------------------------
// GET /api/v1/reminders/pending


// Response: { data: Reminder[] }
// --------------------------------------------------------
router.get('/pending', (req, res) => {
  try {
    const userId = req.authUserId || req.session.userId;
    const now    = new Date().toISOString();
    syncAllBirthdayReminders(db.get(), userId, new Date());



    const origins = readableOrigins(req);
    if (!origins.length) return res.json({ data: [] });

    const rows = db.get().prepare(`
      SELECT
        r.*,
        CASE r.entity_type
          WHEN 'task'  THEN (SELECT title FROM tasks           WHERE id = r.entity_id)
          WHEN 'event' THEN (SELECT title FROM calendar_events WHERE id = r.entity_id)
          WHEN 'subscription' THEN (SELECT name FROM budget_subscriptions WHERE id = r.entity_id)
          WHEN 'inventory_item' THEN (SELECT name FROM inventory_items WHERE id = r.entity_id)
          WHEN 'inventory_tracked_date' THEN (
            SELECT ii.name || ' · ' || d.label
            FROM inventory_item_dates d JOIN inventory_items ii ON ii.id = d.item_id
            WHERE d.id = r.entity_id
          )
          WHEN 'pantry_item' THEN (SELECT name FROM pantry_items WHERE id = r.entity_id)
          WHEN 'cycle_period' THEN (SELECT anchor_date FROM cycle_reminder_anchors WHERE id = r.entity_id)
          WHEN 'cycle_log_nudge' THEN (SELECT anchor_date FROM cycle_reminder_anchors WHERE id = r.entity_id)
          WHEN 'schedule_entry' THEN (
            SELECT t.name FROM schedule_reminder_entries e JOIN schedule_shift_types t ON t.id = e.shift_type_id
            WHERE e.id = r.entity_id
          )
          WHEN 'schedule_extra_entry' THEN (
            SELECT t.name FROM schedule_extra_shifts e JOIN schedule_shift_types t ON t.id = e.shift_type_id
            WHERE e.id = r.entity_id
          )
          WHEN 'waste_pickup' THEN (
            SELECT t.name FROM waste_reminder_entries e JOIN waste_types t ON t.id = e.type_id
            WHERE e.id = r.entity_id
          )
        END AS entity_title
      FROM reminders r
      WHERE r.created_by  = ?
        AND r.dismissed   = 0
        AND r.remind_at  <= ?
        AND r.entity_type IN (${origins.map(() => '?').join(', ')})
      ORDER BY r.remind_at ASC
    `).all(userId, now, ...origins);

    res.json({ data: rows });
  } catch (err) {
    log.error('Error loading due reminders:', err.message);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/reminders/all?entity_type=event&entity_id=5


// nutzen weiterhin den Single-Endpoint (GET /).
// Response: { data: Reminder[] }
// --------------------------------------------------------
router.get('/all', (req, res) => {
  try {
    const userId     = req.authUserId || req.session.userId;
    const entityType = req.query.entity_type;
    const entityId   = parseInt(req.query.entity_id, 10);

    if (!VALID_ENTITY_TYPES.includes(entityType) || !entityId) {
      return res.status(400).json({ error: 'entity_type und entity_id sind erforderlich.', code: 400 });
    }
    if (!mayTouchOrigin(req, entityType)) {
      return res.status(403).json({ error: 'You do not have access to this module.', code: 403 });
    }

    const rows = db.get().prepare(`
      SELECT * FROM reminders
      WHERE entity_type = ? AND entity_id = ? AND created_by = ? AND dismissed = 0
      ORDER BY remind_at ASC
    `).all(entityType, entityId, userId);

    res.json({ data: rows });
  } catch (err) {
    log.error('Error loading reminders:', err.message);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/reminders?entity_type=task&entity_id=5

// Response: { data: Reminder | null }
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const userId      = req.authUserId || req.session.userId;
    const entityType  = req.query.entity_type;
    const entityId    = parseInt(req.query.entity_id, 10);

    if (!VALID_ENTITY_TYPES.includes(entityType) || !entityId) {
      return res.status(400).json({ error: 'entity_type und entity_id sind erforderlich.', code: 400 });
    }
    if (!mayTouchOrigin(req, entityType)) {
      return res.status(403).json({ error: 'You do not have access to this module.', code: 403 });
    }

    const row = db.get().prepare(`
      SELECT * FROM reminders
      WHERE entity_type = ? AND entity_id = ? AND created_by = ? AND dismissed = 0
      ORDER BY created_at DESC LIMIT 1
    `).get(entityType, entityId, userId);

    res.json({ data: row || null });
  } catch (err) {
    log.error('Error loading reminder:', err.message);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/reminders

// Body: { entity_type, entity_id, remind_at }
// Response: { data: Reminder }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const userId = req.authUserId || req.session.userId;
    const { entity_type, entity_id, remind_at } = req.body;

    const errors = v.collectErrors([
      v.id(entity_id,          'entity_id'),
      v.datetime(remind_at,    'remind_at', true),
    ]);





    if (!entity_type || !SETTABLE_ENTITY_TYPES.includes(entity_type)) {
      errors.push(DERIVED_ENTITY_TYPES.includes(entity_type)
        ? derivedTypeError(entity_type)
        : `entity_type must be one of: ${SETTABLE_ENTITY_TYPES.join(', ')}.`);
    }

    if (errors.length) {
      return res.status(400).json({ error: errors.join(' '), code: 400 });
    }
    if (!mayTouchOrigin(req, entity_type, 'write')) {
      return res.status(403).json({ error: 'You do not have access to this module.', code: 403 });
    }

    const entityId = parseInt(entity_id, 10);


    db.get().prepare(`
      DELETE FROM reminders
      WHERE entity_type = ? AND entity_id = ? AND created_by = ?
    `).run(entity_type, entityId, userId);

    const result = db.get().prepare(`
      INSERT INTO reminders (entity_type, entity_id, remind_at, created_by)
      VALUES (?, ?, ?, ?)
    `).run(entity_type, entityId, remind_at, userId);

    syncEventFanout(entity_type, entityId, userId);

    const row = db.get().prepare('SELECT * FROM reminders WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: row });
  } catch (err) {
    log.error('Error creating reminder:', err.message);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/reminders?entity_type=event&entity_id=5

// Body: { remind_ats: string[] } (dedupliziert, max. MAX_REMINDERS_PER_ENTITY)
// Response: { data: Reminder[] }
// --------------------------------------------------------
router.put('/', (req, res) => {
  try {
    const userId     = req.authUserId || req.session.userId;
    const entityType = req.query.entity_type;
    const entityId   = parseInt(req.query.entity_id, 10);
    const remindAts  = req.body?.remind_ats;

    if (!VALID_ENTITY_TYPES.includes(entityType) || !entityId) {
      return res.status(400).json({ error: 'entity_type und entity_id sind erforderlich.', code: 400 });
    }





    if (DERIVED_ENTITY_TYPES.includes(entityType)) {
      return res.status(400).json({ error: derivedTypeError(entityType), code: 400 });
    }
    if (!mayTouchOrigin(req, entityType, 'write')) {
      return res.status(403).json({ error: 'You do not have access to this module.', code: 403 });
    }
    if (!Array.isArray(remindAts)) {
      return res.status(400).json({ error: 'remind_ats muss ein Array sein.', code: 400 });
    }

    // Duplikate entfernen, jeden Eintrag als Datetime validieren, Cap anwenden.
    const unique = [...new Set(remindAts)];
    const errors = v.collectErrors(unique.map((value, i) => v.datetime(value, `remind_ats[${i}]`, true)));
    if (errors.length) {
      return res.status(400).json({ error: errors.join(' '), code: 400 });
    }
    if (unique.length > MAX_REMINDERS_PER_ENTITY) {
      return res.status(400).json({ error: `Maximal ${MAX_REMINDERS_PER_ENTITY} Erinnerungen je Eintrag.`, code: 400 });
    }

    const replace = db.get().transaction((values) => {
      db.get().prepare(`
        DELETE FROM reminders
        WHERE entity_type = ? AND entity_id = ? AND created_by = ?
      `).run(entityType, entityId, userId);

      const insert = db.get().prepare(`
        INSERT INTO reminders (entity_type, entity_id, remind_at, created_by)
        VALUES (?, ?, ?, ?)
      `);
      for (const remindAt of values) {
        insert.run(entityType, entityId, remindAt, userId);
      }
    });
    replace(unique);
    syncEventFanout(entityType, entityId, userId);

    const rows = db.get().prepare(`
      SELECT * FROM reminders
      WHERE entity_type = ? AND entity_id = ? AND created_by = ? AND dismissed = 0
      ORDER BY remind_at ASC
    `).all(entityType, entityId, userId);

    res.json({ data: rows });
  } catch (err) {
    log.error('Error setting reminders:', err.message);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/reminders/:id/dismiss

// Response: { data: { id } }
// --------------------------------------------------------
router.patch('/:id/dismiss', (req, res) => {
  try {
    const userId     = req.authUserId || req.session.userId;
    const reminderId = parseInt(req.params.id, 10);

    if (!reminderId) {
      return res.status(400).json({ error: 'Ungültige Erinnerungs-ID.', code: 400 });
    }

    const reminder = db.get().prepare(
      'SELECT * FROM reminders WHERE id = ? AND created_by = ?'
    ).get(reminderId, userId);

    if (!reminder) {
      return res.status(404).json({ error: 'Erinnerung nicht gefunden.', code: 404 });
    }



    if (!mayTouchOrigin(req, reminder.entity_type, 'write')) {
      return res.status(403).json({ error: 'You do not have access to this module.', code: 403 });
    }

    db.get().prepare('UPDATE reminders SET dismissed = 1 WHERE id = ?').run(reminderId);
    res.json({ data: { id: reminderId } });
  } catch (err) {
    log.error('Error dismissing reminder:', err.message);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/reminders/:id

// Response: 204 No Content
// --------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const userId     = req.authUserId || req.session.userId;
    const reminderId = parseInt(req.params.id, 10);

    if (!reminderId) {
      return res.status(400).json({ error: 'Ungültige Erinnerungs-ID.', code: 400 });
    }

    const reminder = db.get().prepare(
      'SELECT id, entity_type, entity_id FROM reminders WHERE id = ? AND created_by = ?'
    ).get(reminderId, userId);

    if (!reminder) {
      return res.status(404).json({ error: 'Erinnerung nicht gefunden.', code: 404 });
    }
    if (!mayTouchOrigin(req, reminder.entity_type, 'write')) {
      return res.status(403).json({ error: 'You do not have access to this module.', code: 403 });
    }

    // Hintertuer mit exakt derselben folgenlosen Wirkung.
    if (DERIVED_ENTITY_TYPES.includes(reminder.entity_type)) {
      return res.status(400).json({ error: derivedTypeError(reminder.entity_type), code: 400 });
    }

    db.get().prepare('DELETE FROM reminders WHERE id = ?').run(reminderId);
    syncEventFanout(reminder.entity_type, reminder.entity_id, userId);
    res.status(204).end();
  } catch (err) {
    log.error('Error deleting reminder:', err.message);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/reminders?entity_type=task&entity_id=5

// Response: 204 No Content
// --------------------------------------------------------
router.delete('/', (req, res) => {
  try {
    const userId     = req.authUserId || req.session.userId;
    const entityType = req.query.entity_type;
    const entityId   = parseInt(req.query.entity_id, 10);

    if (!VALID_ENTITY_TYPES.includes(entityType) || !entityId) {
      return res.status(400).json({ error: 'entity_type und entity_id sind erforderlich.', code: 400 });
    }
    if (!mayTouchOrigin(req, entityType, 'write')) {
      return res.status(403).json({ error: 'You do not have access to this module.', code: 403 });
    }





    // Zeile bestehen bleibt.
    if (DERIVED_ENTITY_TYPES.includes(entityType)) {
      return res.status(400).json({ error: derivedTypeError(entityType), code: 400 });
    }

    db.get().prepare(`
      DELETE FROM reminders
      WHERE entity_type = ? AND entity_id = ? AND created_by = ?
    `).run(entityType, entityId, userId);
    syncEventFanout(entityType, entityId, userId);

    res.status(204).end();
  } catch (err) {
    log.error('Error deleting reminders:', err.message);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

export default router;
