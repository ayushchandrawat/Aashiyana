
import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';
import { str, oneOf, num, date, id as idParam, collectErrors, MAX_TITLE, MAX_TEXT, MAX_SHORT } from '../middleware/validate.js';
import { normalizePantryUnit, normalizePantryQuantity } from '../../public/utils/pantry-units.js';
import { syncPantryExpiryReminder, resolvePantryAccess } from '../services/pantry-reminders.js';
import { todayKey as householdToday } from '../utils/timezone.js';

const log = createLogger('Pantry');
const router = express.Router();

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function loadLocations() {
  return db.get().prepare('SELECT * FROM pantry_locations ORDER BY sort_order ASC, id ASC').all();
}

function loadCategories() {
  return db.get().prepare('SELECT * FROM shopping_categories ORDER BY sort_order ASC').all();
}

function validCategoryNames() {
  return loadCategories().map((c) => c.name);
}

function getItem(itemId) {
  return db.get().prepare('SELECT * FROM pantry_items WHERE id = ?').get(itemId);
}

function syncReminder(item, access = null, today = null) {



  // Vergangenheits-Riegel in server/services/pantry-reminders.js.
  syncPantryExpiryReminder(db.get(), item, new Date(), access, { clampToNextMorning: true, today });
}

function loadItems() {
  return db.get().prepare(`
    SELECT pi.*, pl.name AS location_name, pl.icon AS location_icon
    FROM pantry_items pi
    LEFT JOIN pantry_locations pl ON pl.id = pi.location_id
    ORDER BY
      CASE WHEN pi.location_id IS NULL THEN 1 ELSE 0 END,
      pl.sort_order ASC,
      pi.name COLLATE NOCASE ASC,
      pi.id ASC
  `).all();
}

function validateItemFields(body, { partial = false, current = null } = {}) {
  const values = {};
  const results = [];

  if (!partial || body.name !== undefined) {
    const vName = str(body.name, 'Name', { max: MAX_TITLE });
    results.push(vName);
    values.name = vName.value;
  }

  if (!partial || body.quantity !== undefined) {
    const vQty = num(body.quantity, 'Menge');
    results.push(vQty);
    if (vQty.value !== null && vQty.value < 0) {
      results.push({ error: 'Menge darf nicht negativ sein.' });
    }


    const fallbackQty = partial ? Number(current?.quantity ?? 1) : 1;
    values.quantity = vQty.value === null
      ? normalizePantryQuantity(fallbackQty, { fallback: 1 })
      : normalizePantryQuantity(vQty.value, { fallback: 1 });
  }

  // Einheit normalisiert statt validiert - siehe pantry-units.js.
  if (!partial || body.unit !== undefined) {
    values.unit = normalizePantryUnit(body.unit ?? current?.unit);
  }

  if (!partial || body.location_id !== undefined) {
    if (body.location_id === null || body.location_id === '' || body.location_id === undefined) {
      values.location_id = null;
    } else {
      const vLoc = idParam(body.location_id, 'Lagerort');
      results.push(vLoc);
      if (vLoc.value !== null) {
        const exists = db.get().prepare('SELECT id FROM pantry_locations WHERE id = ?').get(vLoc.value);
        if (!exists) results.push({ error: 'Lagerort nicht gefunden.' });
      }
      values.location_id = vLoc.value;
    }
  }

  if (!partial || body.category !== undefined) {
    const names = validCategoryNames();
    const fallback = current?.category ?? names[names.length - 1] ?? 'Sonstiges';
    const requested = body.category || fallback;
    const vCat = oneOf(requested, names, 'Kategorie');
    results.push(vCat);
    values.category = vCat.value ?? fallback;
  }

  if (!partial || body.expires_on !== undefined) {
    const vExp = date(body.expires_on, 'Mindesthaltbarkeitsdatum');
    results.push(vExp);
    values.expires_on = vExp.value;
  }

  if (!partial || body.min_quantity !== undefined) {
    if (body.min_quantity === null || body.min_quantity === '' || body.min_quantity === undefined) {
      values.min_quantity = null;
    } else {
      const vMin = num(body.min_quantity, 'Mindestbestand');
      results.push(vMin);
      if (vMin.value !== null && vMin.value < 0) {
        results.push({ error: 'Mindestbestand darf nicht negativ sein.' });
      }
      values.min_quantity = vMin.value === null ? null : normalizePantryQuantity(vMin.value, { fallback: 0 });
    }
  }

  if (!partial || body.notes !== undefined) {
    const vNotes = str(body.notes, 'Notiz', { max: MAX_TEXT, required: false });
    results.push(vNotes);
    values.notes = vNotes.value;
  }

  return { values, errors: collectErrors(results) };
}

// --------------------------------------------------------
// GET /api/v1/pantry/locations

// Response: { data: PantryLocation[] }
// --------------------------------------------------------
router.get('/locations', (_req, res) => {
  try {
    res.json({ data: loadLocations() });
  } catch (err) {
    log.error('GET /locations error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/pantry/locations
// Body: { name, icon? }
// Response: { data: PantryLocation }
// --------------------------------------------------------
router.post('/locations', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_SHORT });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const existing = db.get()
      .prepare('SELECT id FROM pantry_locations WHERE name = ? COLLATE NOCASE')
      .get(vName.value);
    if (existing) return res.status(409).json({ error: 'Storage location already exists.', code: 409 });

    const vIcon = str(req.body.icon, 'Icon', { max: MAX_SHORT, required: false });
    if (vIcon.error) return res.status(400).json({ error: vIcon.error, code: 400 });

    const maxOrder = db.get()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM pantry_locations')
      .get().m;

    const result = db.get()
      .prepare('INSERT INTO pantry_locations (name, icon, sort_order) VALUES (?, ?, ?)')
      .run(vName.value, vIcon.value ?? 'package', maxOrder + 1);

    res.status(201).json({
      data: db.get().prepare('SELECT * FROM pantry_locations WHERE id = ?').get(result.lastInsertRowid),
    });
  } catch (err) {
    log.error('POST /locations error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/pantry/locations/reorder

// Response: { data: PantryLocation[] }
// --------------------------------------------------------
router.patch('/locations/reorder', (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0)
      return res.status(400).json({ error: 'order must be a non-empty array of IDs.', code: 400 });

    const update = db.get().prepare('UPDATE pantry_locations SET sort_order = ? WHERE id = ?');
    db.get().transaction(() => {
      order.forEach((locId, idx) => update.run(idx, locId));
    })();

    res.json({ data: loadLocations() });
  } catch (err) {
    log.error('PATCH /locations/reorder error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/pantry/locations/:locId
// Body: { name?, icon? }
// Response: { data: PantryLocation }
// --------------------------------------------------------
router.put('/locations/:locId', (req, res) => {
  try {
    const vId = idParam(req.params.locId, 'Lagerort-ID');
    if (vId.error) return res.status(400).json({ error: vId.error, code: 400 });

    const loc = db.get().prepare('SELECT * FROM pantry_locations WHERE id = ?').get(vId.value);
    if (!loc) return res.status(404).json({ error: 'Storage location not found.', code: 404 });

    const vName = str(req.body.name, 'Name', { max: MAX_SHORT });
    const vIcon = str(req.body.icon, 'Icon', { max: MAX_SHORT, required: false });
    const errors = collectErrors([vName, vIcon]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const conflict = db.get()
      .prepare('SELECT id FROM pantry_locations WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(vName.value, loc.id);
    if (conflict) return res.status(409).json({ error: 'Storage location already exists.', code: 409 });

    db.get()
      .prepare('UPDATE pantry_locations SET name = ?, icon = ? WHERE id = ?')
      .run(vName.value, vIcon.value ?? loc.icon, loc.id);

    res.json({ data: db.get().prepare('SELECT * FROM pantry_locations WHERE id = ?').get(loc.id) });
  } catch (err) {
    log.error('PUT /locations/:locId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/pantry/locations/:locId


// Response: { ok: true, orphaned: number }
// --------------------------------------------------------
router.delete('/locations/:locId', (req, res) => {
  try {
    const vId = idParam(req.params.locId, 'Lagerort-ID');
    if (vId.error) return res.status(400).json({ error: vId.error, code: 400 });

    const loc = db.get().prepare('SELECT * FROM pantry_locations WHERE id = ?').get(vId.value);
    if (!loc) return res.status(404).json({ error: 'Storage location not found.', code: 404 });

    const total = db.get().prepare('SELECT COUNT(*) AS c FROM pantry_locations').get().c;
    if (total <= 1) return res.status(400).json({ error: 'The last storage location cannot be deleted.', code: 400 });

    const orphaned = db.get()
      .prepare('SELECT COUNT(*) AS c FROM pantry_items WHERE location_id = ?')
      .get(loc.id).c;

    db.get().prepare('DELETE FROM pantry_locations WHERE id = ?').run(loc.id);

    res.json({ ok: true, orphaned });
  } catch (err) {
    log.error('DELETE /locations/:locId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/pantry/import-shopping

// Body: { list_id, items: [{ shopping_item_id, quantity?, unit?, location_id?, expires_on? }] }
//



// entfernen.
// Response: { data: { added, merged, skipped } }
// --------------------------------------------------------
router.post('/import-shopping', (req, res) => {
  try {
    const vList = idParam(req.body.list_id, 'Listen-ID');
    if (vList.error) return res.status(400).json({ error: vList.error, code: 400 });

    const list = db.get().prepare('SELECT id FROM shopping_lists WHERE id = ?').get(vList.value);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const entries = Array.isArray(req.body.items) ? req.body.items : [];
    if (!entries.length) return res.json({ data: { added: 0, merged: 0, skipped: 0 } });

    const checked = db.get()
      .prepare('SELECT * FROM shopping_items WHERE list_id = ? AND is_checked = 1')
      .all(vList.value);
    const checkedById = new Map(checked.map((i) => [i.id, i]));

    const userId = req.authUserId || req.session.userId;
    const categoryNames = validCategoryNames();
    const fallbackCategory = categoryNames[categoryNames.length - 1] ?? 'Sonstiges';




    // dieselbe Antwort geben.
    const access = resolvePantryAccess(db.get());

    // eine sync_config-Abfrage plus zwei Intl.DateTimeFormat-Konstruktionen,

    const today = householdToday(db.get());

    const result = db.get().transaction(() => {
      const findMatch = db.get().prepare(`
        SELECT id, quantity FROM pantry_items
        WHERE name = ? COLLATE NOCASE
          AND unit = ?
          AND location_id IS ?
          AND expires_on IS ?
        LIMIT 1
      `);
      const bump = db.get().prepare('UPDATE pantry_items SET quantity = ? WHERE id = ?');
      const insert = db.get().prepare(`
        INSERT INTO pantry_items (name, quantity, unit, location_id, category, expires_on, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      let added = 0, merged = 0, skipped = 0;

      for (const entry of entries) {
        const source = checkedById.get(Number(entry?.shopping_item_id));

        if (!source) { skipped += 1; continue; }

        const quantity = normalizePantryQuantity(entry.quantity, { fallback: 1 });
        const unit = normalizePantryUnit(entry.unit);
        const locationId = entry.location_id ? Number(entry.location_id) || null : null;





        //






        // ohnehin kennt.
        const expiresOn = date(entry.expires_on, 'Mindesthaltbarkeitsdatum').value;
        const category = categoryNames.includes(source.category) ? source.category : fallbackCategory;

        // Gleicher Name, gleiche Einheit, gleicher Ort UND gleiches MHD →


        const match = findMatch.get(source.name, unit, locationId, expiresOn);
        if (match) {
          bump.run(normalizePantryQuantity(Number(match.quantity) + quantity, { fallback: quantity }), match.id);


          syncReminder(getItem(match.id), access, today);
          merged += 1;
        } else {
          const inserted = insert.run(source.name, quantity, unit, locationId, category, expiresOn, userId);
          syncReminder(getItem(inserted.lastInsertRowid), access, today);
          added += 1;
        }
      }

      return { added, merged, skipped };
    })();

    res.json({ data: result });
  } catch (err) {
    log.error('POST /import-shopping error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/pantry



// Response: { data: PantryItem[], locations: [], categories: [] }
// --------------------------------------------------------
router.get('/', (_req, res) => {
  try {
    res.json({ data: loadItems(), locations: loadLocations(), categories: loadCategories() });
  } catch (err) {
    log.error('GET / error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/pantry
// Body: { name, quantity?, unit?, location_id?, category?, expires_on?, min_quantity?, notes? }
// Response: { data: PantryItem }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const { values, errors } = validateItemFields(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });




    const created = db.get().transaction(() => {
      const result = db.get().prepare(`
        INSERT INTO pantry_items
          (name, quantity, unit, location_id, category, expires_on, min_quantity, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        values.name, values.quantity, values.unit, values.location_id,
        values.category, values.expires_on, values.min_quantity, values.notes,
        req.authUserId || req.session.userId
      );
      const item = getItem(result.lastInsertRowid);
      syncReminder(item);
      return item;
    })();

    res.status(201).json({ data: created });
  } catch (err) {
    log.error('POST / error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/pantry/:itemId

// Response: { data: PantryItem }
// --------------------------------------------------------
router.put('/:itemId', (req, res) => {
  try {
    const vId = idParam(req.params.itemId, 'Artikel-ID');
    if (vId.error) return res.status(400).json({ error: vId.error, code: 400 });

    const item = getItem(vId.value);
    if (!item) return res.status(404).json({ error: 'Item not found.', code: 404 });

    const { values, errors } = validateItemFields(req.body, { current: item });
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const updated = db.get().transaction(() => {
      db.get().prepare(`
        UPDATE pantry_items
        SET name = ?, quantity = ?, unit = ?, location_id = ?, category = ?,
            expires_on = ?, min_quantity = ?, notes = ?
        WHERE id = ?
      `).run(
        values.name, values.quantity, values.unit, values.location_id,
        values.category, values.expires_on, values.min_quantity, values.notes, item.id
      );
      const fresh = getItem(item.id);
      syncReminder(fresh);
      return fresh;
    })();

    res.json({ data: updated });
  } catch (err) {
    log.error('PUT /:itemId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/pantry/:itemId


// Response: { data: PantryItem }
// --------------------------------------------------------
router.patch('/:itemId', (req, res) => {
  try {
    const vId = idParam(req.params.itemId, 'Artikel-ID');
    if (vId.error) return res.status(400).json({ error: vId.error, code: 400 });

    const item = getItem(vId.value);
    if (!item) return res.status(404).json({ error: 'Item not found.', code: 404 });

    const { values, errors } = validateItemFields(req.body, { partial: true, current: item });
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });



    const fields = Object.keys(values);
    if (!fields.length) return res.json({ data: item });

    const updated = db.get().transaction(() => {
      db.get().prepare(`
        UPDATE pantry_items SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?
      `).run(...fields.map((f) => values[f]), item.id);



      const fresh = getItem(item.id);
      syncReminder(fresh);
      return fresh;
    })();

    res.json({ data: updated });
  } catch (err) {
    log.error('PATCH /:itemId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/pantry/:itemId
// Response: 204
// --------------------------------------------------------
router.delete('/:itemId', (req, res) => {
  try {
    const vId = idParam(req.params.itemId, 'Artikel-ID');
    if (vId.error) return res.status(400).json({ error: vId.error, code: 400 });

    const removed = db.get().transaction(() => {
      const result = db.get().prepare('DELETE FROM pantry_items WHERE id = ?').run(vId.value);
      if (result.changes === 0) return false;




      db.get().prepare("DELETE FROM reminders WHERE entity_type = 'pantry_item' AND entity_id = ?").run(vId.value);
      return true;
    })();
    if (!removed) return res.status(404).json({ error: 'Item not found.', code: 404 });

    res.status(204).end();
  } catch (err) {
    log.error('DELETE /:itemId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
