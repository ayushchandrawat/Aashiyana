
import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, oneOf, url, date, collectErrors, MAX_TITLE, MAX_SHORT, MAX_TEXT } from '../middleware/validate.js';
import { aggregateMealIngredients } from '../services/shopping-import.js';
import { loadItemTagsFor } from '../utils/task-tags.js';
import {
  flushOutbound, markTodoOutbound, queueTodoDeletions,
} from '../services/caldav-todo-outbound.js';
import rateLimit from 'express-rate-limit';
import { emailService as defaultEmailService } from '../services/email.js';
import { memberEmail, isHouseholdMember, listEmailableMembers } from '../services/member-email.js';
import { buildShoppingListMail } from '../services/shopping-mail.js';
import { householdTimeZone, utcToWall } from '../utils/timezone.js';

const log = createLogger('Shopping');

const router  = express.Router();

const sendListLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many send requests. Please wait a moment.', code: 429 },
});

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function mirroredItems(where, ...params) {
  return db.get().prepare(
    `SELECT * FROM shopping_items WHERE ${where} AND external_source = 'caldav'`
  ).all(...params);
}

function pushToCalDAV(what) {
  flushOutbound().catch((err) => log.warn(`${what} vorgemerkt, Sofortversuch fehlgeschlagen:`, err.message));
}

function loadCategories() {
  return db.get().prepare('SELECT * FROM shopping_categories ORDER BY sort_order ASC').all();
}

function validCategoryNames() {
  return loadCategories().map((c) => c.name);
}

function loadListItems(listId, categories) {
  const categoryOrder = categories.map((c, i) => `WHEN '${c.name.replace(/'/g, "''")}' THEN ${i}`).join(' ');
  const items = db.get().prepare(`
    SELECT * FROM shopping_items
    WHERE list_id = ?
    ORDER BY
      CASE category ${categoryOrder} ELSE ${categories.length} END,
      is_checked ASC,
      sort_order ASC,
      created_at ASC
  `).all(listId);



  const tagMap = loadItemTagsFor(db.get(), items.map((i) => i.id));
  for (const item of items) item.tags = tagMap.get(item.id) ?? [];
  return items;
}

// --------------------------------------------------------




// --------------------------------------------------------

function listVersion(listId) {
  return db.get()
    .prepare('SELECT version FROM shopping_list_changes WHERE list_id = ?')
    .get(listId)?.version ?? null;
}

function withListChange(listId, write) {
  const before = listVersion(listId);
  const result = write();
  return { result, list_change: { list_id: Number(listId), before, after: listVersion(listId) } };
}

// --------------------------------------------------------
// GET /api/v1/shopping/versions

// Response: { data: [{ list_id, version }] }
// --------------------------------------------------------
router.get('/versions', (_req, res) => {
  try {
    const rows = db.get()
      .prepare('SELECT list_id, version FROM shopping_list_changes ORDER BY list_id')
      .all();
    res.json({ data: rows });
  } catch (err) {
    log.error('GET /versions error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping/categories

// Response: { data: ShoppingCategory[] }
// --------------------------------------------------------
router.get('/categories', (_req, res) => {
  try {
    res.json({ data: loadCategories() });
  } catch (err) {
    log.error('GET /categories error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/categories
// Neue Kategorie erstellen.
// Body: { name }
// Response: { data: ShoppingCategory }
// --------------------------------------------------------
router.post('/categories', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_SHORT });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const existing = db.get()
      .prepare('SELECT id FROM shopping_categories WHERE name = ? COLLATE NOCASE')
      .get(vName.value);
    if (existing) return res.status(409).json({ error: 'Category already exists.', code: 409 });

    const maxOrder = db.get()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM shopping_categories')
      .get().m;

    const result = db.get()
      .prepare('INSERT INTO shopping_categories (name, icon, sort_order) VALUES (?, ?, ?)')
      .run(vName.value, 'tag', maxOrder + 1);

    const cat = db.get()
      .prepare('SELECT * FROM shopping_categories WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ data: cat });
  } catch (err) {
    log.error('POST /categories error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/shopping/categories/:catId
// Kategorie umbenennen.
// Body: { name }
// Response: { data: ShoppingCategory }
// --------------------------------------------------------
router.put('/categories/:catId', (req, res) => {
  try {
    const cat = db.get()
      .prepare('SELECT * FROM shopping_categories WHERE id = ?')
      .get(req.params.catId);
    if (!cat) return res.status(404).json({ error: 'Category not found.', code: 404 });

    const vName = str(req.body.name, 'Name', { max: MAX_SHORT });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const conflict = db.get()
      .prepare('SELECT id FROM shopping_categories WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(vName.value, cat.id);
    if (conflict) return res.status(409).json({ error: 'Category already exists.', code: 409 });


    db.get().transaction(() => {
      db.get()
        .prepare('UPDATE shopping_items SET category = ? WHERE category = ?')
        .run(vName.value, cat.name);
      db.get()
        .prepare('UPDATE shopping_categories SET name = ? WHERE id = ?')
        .run(vName.value, cat.id);
    })();

    const updated = db.get()
      .prepare('SELECT * FROM shopping_categories WHERE id = ?')
      .get(cat.id);
    res.json({ data: updated });
  } catch (err) {
    log.error('PUT /categories/:catId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/categories/:catId


// Response: { ok: true }
// --------------------------------------------------------
router.delete('/categories/:catId', (req, res) => {
  try {
    const cat = db.get()
      .prepare('SELECT * FROM shopping_categories WHERE id = ?')
      .get(req.params.catId);
    if (!cat) return res.status(404).json({ error: 'Category not found.', code: 404 });

    const total = db.get()
      .prepare('SELECT COUNT(*) AS c FROM shopping_categories')
      .get().c;
    if (total <= 1) return res.status(400).json({ error: 'The last category cannot be deleted.', code: 400 });

    // Fallback-Kategorie: erste andere Kategorie nach sort_order
    const fallback = db.get()
      .prepare('SELECT name FROM shopping_categories WHERE id != ? ORDER BY sort_order ASC LIMIT 1')
      .get(cat.id);

    db.get().transaction(() => {



      // niemand hergestellt hat.
      //





      const listen = db.get()
        .prepare('SELECT DISTINCT list_id FROM shopping_items WHERE category = ?')
        .all(cat.name);
      const maxIn = db.get().prepare(
        'SELECT COALESCE(MAX(sort_order), 0) AS m FROM shopping_items WHERE list_id = ? AND category = ?'
      );
      const move = db.get().prepare(
        'UPDATE shopping_items SET category = ?, sort_order = sort_order + ? WHERE category = ? AND list_id = ?'
      );
      for (const { list_id: listId } of listen) {
        move.run(fallback.name, maxIn.get(listId, fallback.name).m, cat.name, listId);
      }
      db.get()
        .prepare('DELETE FROM shopping_categories WHERE id = ?')
        .run(cat.id);
    })();

    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /categories/:catId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/shopping/categories/reorder


// Response: { data: ShoppingCategory[] }
// --------------------------------------------------------
router.patch('/categories/reorder', (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0)
      return res.status(400).json({ error: 'order muss ein nicht-leeres Array von IDs sein.', code: 400 });

    const update = db.get().prepare('UPDATE shopping_categories SET sort_order = ? WHERE id = ?');
    db.get().transaction(() => {
      order.forEach((id, idx) => update.run(idx, id));
    })();

    res.json({ data: loadCategories() });
  } catch (err) {
    log.error('PATCH /categories/reorder error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping/send-recipients

// Response: { data: [{ id, display_name }] }
//





// deshalb dieselbe Funktion.
//


// --------------------------------------------------------
router.get('/send-recipients', (req, res) => {
  try {
    void req;
    const members = listEmailableMembers({ db: db.get() })
      .map(({ id, display_name }) => ({ id, display_name }));
    res.json({ data: members });
  } catch (err) {
    log.error('GET /send-recipients error:', err.message);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping/suggestions?q=…

// Response: { data: { name, category, quantity }[] }
//







//

// Haushalt kauft dieselbe Handvoll Artikel immer wieder - die zuletzt
// eingekauften stehen oben, statt hinter allem, was zufaellig frueher im
// Alphabet liegt.
// --------------------------------------------------------
router.get('/suggestions', (req, res) => {
  try {
    const q = (req.query.q ?? '').trim();
    if (q.length < 1) return res.json({ data: [] });

    const names = db.get().prepare(`
      SELECT name, MAX(created_at) AS latest, MAX(id) AS latest_id FROM shopping_items
      WHERE name LIKE ? COLLATE NOCASE
      GROUP BY name
      ORDER BY latest DESC, latest_id DESC
      LIMIT 8
    `).all(`${q}%`);

    const mostRecent = db.get().prepare(`
      SELECT category, quantity FROM shopping_items
      WHERE name = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);
    const data = names.map((r) => {
      const recent = mostRecent.get(r.name);
      return { name: r.name, category: recent?.category ?? null, quantity: recent?.quantity ?? null };
    });

    res.json({ data });
  } catch (err) {
    log.error('suggestions error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/shopping/items/:itemId
// --------------------------------------------------------
// Laeden (#1003) - eine verwaltete Liste, kein Freitext.
//



// --------------------------------------------------------

// GET /api/v1/shopping/stores  -> { data: Store[] }
router.get('/stores', (_req, res) => {
  try {
    const stores = db.get().prepare('SELECT * FROM shopping_stores ORDER BY name COLLATE NOCASE ASC').all();
    res.json({ data: stores });
  } catch (err) {
    log.error('GET /stores error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

// POST /api/v1/shopping/stores  Body: { name }
router.post('/stores', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_SHORT });
    const errors = collectErrors([vName]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });



    const vorhanden = db.get().prepare('SELECT * FROM shopping_stores WHERE name = ? COLLATE NOCASE').get(vName.value);
    if (vorhanden) return res.status(200).json({ data: vorhanden });

    const result = db.get().prepare(
      'INSERT INTO shopping_stores (name, created_by) VALUES (?, ?)'
    ).run(vName.value, req.authUserId || req.session.userId);
    res.status(201).json({ data: db.get().prepare('SELECT * FROM shopping_stores WHERE id = ?').get(result.lastInsertRowid) });
  } catch (err) {
    log.error('POST /stores error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

// PUT /api/v1/shopping/stores/:id  Body: { name }
//




router.put('/stores/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid store ID.', code: 400 });
    const store = db.get().prepare('SELECT * FROM shopping_stores WHERE id = ?').get(id);
    if (!store) return res.status(404).json({ error: 'Store not found.', code: 404 });

    const vName = str(req.body.name, 'Name', { max: MAX_SHORT });
    const errors = collectErrors([vName]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const kollision = db.get().prepare(
      'SELECT id FROM shopping_stores WHERE name = ? COLLATE NOCASE AND id != ?'
    ).get(vName.value, id);
    if (kollision) return res.status(409).json({ error: 'Diesen Laden gibt es schon.', code: 409 });

    db.get().prepare('UPDATE shopping_stores SET name = ? WHERE id = ?').run(vName.value, id);
    res.json({ data: db.get().prepare('SELECT * FROM shopping_stores WHERE id = ?').get(id) });
  } catch (err) {
    log.error('PUT /stores/:id error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

// DELETE /api/v1/shopping/stores/:id
router.delete('/stores/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid store ID.', code: 400 });
    const store = db.get().prepare('SELECT id FROM shopping_stores WHERE id = ?').get(id);
    if (!store) return res.status(404).json({ error: 'Store not found.', code: 404 });


    db.get().prepare('DELETE FROM shopping_stores WHERE id = ?').run(id);
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /stores/:id error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

// --------------------------------------------------------
// Artikel aktualisieren (is_checked, name, quantity, category, notes, url).
// Body: { is_checked?, name?, quantity?, category?, notes?, url? }
// Response: { data: ShoppingItem }
// --------------------------------------------------------
router.patch('/items/:itemId', (req, res) => {
  try {
    const item = db.get()
      .prepare('SELECT * FROM shopping_items WHERE id = ?')
      .get(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found.', code: 404 });

    const {
      is_checked = item.is_checked,
      name       = item.name,
      quantity   = item.quantity,
      category   = item.category,
      notes      = item.notes,
      url: urlVal = item.url,
    } = req.body;

    const priceGiven = req.body.price_cents !== undefined;
    let priceCents = item.price_cents;
    if (priceGiven) {
      const roh = req.body.price_cents;
      if (roh === null || roh === '') priceCents = null;
      else {
        const n = Number(roh);


        if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
          return res.status(400).json({ error: 'price_cents muss eine ganze Zahl in Cent zwischen 0 und 100000000 sein.', code: 400 });
        }
        priceCents = n;
      }
    }

    const storeGiven = req.body.store_id !== undefined;
    let storeId = item.store_id;
    if (storeGiven) {
      const roh = req.body.store_id;
      if (roh === null || roh === '') storeId = null;
      else {
        const n = Number(roh);
        if (!Number.isInteger(n) || n <= 0) {
          return res.status(400).json({ error: 'store_id muss eine Laden-ID sein.', code: 400 });
        }



        if (!db.get().prepare('SELECT 1 FROM shopping_stores WHERE id = ?').get(n)) {
          return res.status(400).json({ error: 'Unbekannter Laden.', code: 400 });
        }
        storeId = n;
      }
    }

    if (!name?.trim()) return res.status(400).json({ error: 'name darf nicht leer sein.', code: 400 });

    const validNames = validCategoryNames();
    if (category && !validNames.includes(category))
      return res.status(400).json({ error: 'Invalid category.', code: 400 });


    const vNotes = str(notes, 'Notiz', { max: MAX_TEXT, required: false });
    const vUrl   = url(urlVal, 'URL');
    const fieldErrors = collectErrors([vNotes, vUrl]);
    if (fieldErrors.length) return res.status(400).json({ error: fieldErrors.join(' '), code: 400 });

    const { list_change } = withListChange(item.list_id, () => {
      db.get().prepare(`
        UPDATE shopping_items
        SET is_checked = ?, name = ?, quantity = ?, category = ?, notes = ?, url = ?,
            price_cents = ?, store_id = ?
        WHERE id = ?
      `).run(is_checked ? 1 : 0, name.trim(), quantity ?? null, category, vNotes.value, vUrl.value,
        priceCents ?? null, storeId ?? null, req.params.itemId);




      if (category !== item.category) {
        db.get().prepare(`
          UPDATE shopping_items SET sort_order = COALESCE((
            SELECT MAX(sort_order) FROM shopping_items
             WHERE list_id = ? AND category = ? AND id != ?
          ), 0) + 1 WHERE id = ?
        `).run(item.list_id, category, item.id, item.id);
      }
    });

    const updated = db.get()
      .prepare('SELECT * FROM shopping_items WHERE id = ?')
      .get(req.params.itemId);


    // CalDAV-Server nach (#617).
    const pending = markTodoOutbound('shopping', item, updated);

    res.json({ data: updated, list_change });

    if (pending) pushToCalDAV('Änderung');
  } catch (err) {
    log.error('PATCH items/:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/items/undo-transfer


// Response: { data: { removed: number } }
//


//







//




//



// --------------------------------------------------------
router.post('/items/undo-transfer', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(Number).filter(Number.isInteger)
      : [];
    if (!ids.length) return res.json({ data: { removed: 0 } });

    const removed = db.get().transaction(() => {
      const findItem = db.get()
        .prepare('SELECT id, name, added_from_meal FROM shopping_items WHERE id = ?');
      const deleteItem = db.get().prepare('DELETE FROM shopping_items WHERE id = ?');
      const unmarkIngredient = db.get().prepare(`
        UPDATE meal_ingredients SET on_shopping_list = 0
        WHERE meal_id = ? AND name = ? AND on_shopping_list = 1
      `);

      let count = 0;
      for (const id of ids) {
        const item = findItem.get(id);
        if (!item) continue;
        deleteItem.run(id);
        if (item.added_from_meal) unmarkIngredient.run(item.added_from_meal, item.name);
        count += 1;
      }
      return count;
    })();

    res.json({ data: { removed } });
  } catch (err) {
    log.error('POST /items/undo-transfer error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/items/:itemId

// Response: { ok: true }
// --------------------------------------------------------
router.delete('/items/:itemId', (req, res) => {
  try {
    const item = db.get()
      .prepare('SELECT id, list_id FROM shopping_items WHERE id = ?')
      .get(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found.', code: 404 });

    const queued = queueTodoDeletions('shopping', mirroredItems('id = ?', req.params.itemId));

    const { list_change } = withListChange(item.list_id, () => {
      db.get().prepare('DELETE FROM shopping_items WHERE id = ?').run(item.id);
    });
    res.json({ ok: true, list_change });

    if (queued) pushToCalDAV('Löschung');
  } catch (err) {
    log.error('DELETE items/:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping

// Response: { data: ShoppingList[] }
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const lists = db.get().prepare(`
      SELECT
        sl.*,
        COUNT(si.id)                                          AS item_total,
        SUM(CASE WHEN si.is_checked = 1 THEN 1 ELSE 0 END)   AS item_checked
      FROM shopping_lists sl
      LEFT JOIN shopping_items si ON si.list_id = sl.id
      GROUP BY sl.id
      ORDER BY sl.created_at ASC
    `).all();
    res.json({ data: lists });
  } catch (err) {
    log.error('GET / error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping
// Neue Einkaufsliste erstellen.
// Body: { name }
// Response: { data: ShoppingList }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const result = db.get()
      .prepare('INSERT INTO shopping_lists (name, created_by) VALUES (?, ?)')
      .run(vName.value, req.authUserId || req.session.userId);

    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ data: list });
  } catch (err) {
    log.error('POST / error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/shopping/:listId
// Einkaufsliste umbenennen.
// Body: { name }
// Response: { data: ShoppingList }
// --------------------------------------------------------
router.put('/:listId', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const result = db.get()
      .prepare('UPDATE shopping_lists SET name = ? WHERE id = ?')
      .run(vName.value, req.params.listId);
    if (result.changes === 0)
      return res.status(404).json({ error: 'List not found.', code: 404 });

    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    res.json({ data: list });
  } catch (err) {
    log.error('PUT /:listId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/:listId/duplicate


// Body: { name, resetChecked?, keepQuantities?, keepNotes? }  (die drei Flags

// Response: { data: ShoppingList }
//


// den Flags:
//

















// --------------------------------------------------------
router.post('/:listId/duplicate', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });



    const vName = str(req.body?.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });





    for (const flag of ['resetChecked', 'keepQuantities', 'keepNotes']) {
      const value = req.body?.[flag];
      if (value !== undefined && typeof value !== 'boolean')
        return res.status(400).json({ error: `${flag} must be a boolean.`, code: 400 });
    }

    const resetChecked   = req.body?.resetChecked !== false;
    const keepQuantities = req.body?.keepQuantities !== false;
    const keepNotes      = req.body?.keepNotes !== false;

    const items = db.get()
      .prepare('SELECT * FROM shopping_items WHERE list_id = ?')
      .all(req.params.listId);

    const newList = db.get().transaction(() => {
      const info = db.get()
        .prepare('INSERT INTO shopping_lists (name, created_by) VALUES (?, ?)')
        .run(vName.value, req.authUserId || req.session.userId);
      const newListId = info.lastInsertRowid;

      const insertItem = db.get().prepare(`
        INSERT INTO shopping_items
          (list_id, name, quantity, category, is_checked, notes, url, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        insertItem.run(
          newListId,
          item.name,
          keepQuantities ? item.quantity : null,
          item.category,
          resetChecked ? 0 : item.is_checked,
          keepNotes ? item.notes : null,
          keepNotes ? item.url : null,



          item.sort_order,
        );
      }
      return db.get().prepare('SELECT * FROM shopping_lists WHERE id = ?').get(newListId);
    })();

    res.status(201).json({ data: newList });
  } catch (err) {
    log.error('POST /:listId/duplicate error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/:listId

// Response: { ok: true }
// --------------------------------------------------------
router.delete('/:listId', (req, res) => {
  try {

    // vorgemerkt sein (#617).
    const queued = queueTodoDeletions('shopping', mirroredItems('list_id = ?', req.params.listId));

    const result = db.get()
      .prepare('DELETE FROM shopping_lists WHERE id = ?')
      .run(req.params.listId);
    if (result.changes === 0)
      return res.status(404).json({ error: 'List not found.', code: 404 });
    res.json({ ok: true });

    if (queued) pushToCalDAV('Löschung');
  } catch (err) {
    log.error('DELETE /:listId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping/:listId/items


// gesetzte Reihenfolge (#678).
// Response: { data: ShoppingItem[], list: ShoppingList, categories: ShoppingCategory[] }
// --------------------------------------------------------
router.get('/:listId/items', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const categories = loadCategories();





    res.json({ data: loadListItems(req.params.listId, categories), list, categories, version: listVersion(list.id) });
  } catch (err) {
    log.error('GET /:listId/items error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/shopping/:listId/items/reorder


// Response: { data: ShoppingItem[], categories: ShoppingCategory[] }
//




//



// --------------------------------------------------------
router.patch('/:listId/items/reorder', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT id FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const { category, order } = req.body;
    if (!Array.isArray(order) || order.length === 0)
      return res.status(400).json({ error: 'order muss ein nicht-leeres Array von IDs sein.', code: 400 });

    const ids = order.map(Number);
    if (ids.some((id) => !Number.isInteger(id)))
      return res.status(400).json({ error: 'order darf nur Artikel-IDs enthalten.', code: 400 });
    if (new Set(ids).size !== ids.length)
      return res.status(400).json({ error: 'order darf keine ID doppelt enthalten.', code: 400 });



    if (!category) return res.status(400).json({ error: 'category ist erforderlich.', code: 400 });
    const vCat = oneOf(category, validCategoryNames(), 'Kategorie');
    if (vCat.error) return res.status(400).json({ error: vCat.error, code: 400 });



    const own = db.get()
      .prepare('SELECT id FROM shopping_items WHERE list_id = ? AND category = ?')
      .all(req.params.listId, vCat.value)
      .map((r) => r.id);
    const ownSet = new Set(own);
    if (ids.some((id) => !ownSet.has(id)))
      return res.status(400).json({ error: 'order enthält Artikel außerhalb dieser Liste oder Kategorie.', code: 400 });
    if (ids.length !== own.length)
      return res.status(400).json({ error: 'order muss alle Artikel der Kategorie enthalten.', code: 400 });

    const update = db.get().prepare('UPDATE shopping_items SET sort_order = ? WHERE id = ?');
    const { list_change } = withListChange(req.params.listId, () => {
      db.get().transaction(() => {

        ids.forEach((id, idx) => update.run(idx + 1, id));
      })();
    });

    const categories = loadCategories();
    res.json({ data: loadListItems(req.params.listId, categories), categories, list_change });
  } catch (err) {
    log.error('PATCH /:listId/items/reorder error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/:listId/items

// Body: { name, quantity?, category?, notes?, url? }
// Response: { data: ShoppingItem }
// --------------------------------------------------------
router.post('/:listId/items', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT id FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });







    // letzte; Quick-Add-Client: der NAME via DEFAULT_CATEGORY_NAME; Loesch-



    // direkter API-Aufruf).
    const validNames = validCategoryNames();
    const defaultCat = (validNames.includes('Sonstiges') ? 'Sonstiges' : validNames.at(-1)) ?? 'Sonstiges';
    const requestedCat = req.body.category || defaultCat;

    const vName  = str(req.body.name, 'Name', { max: MAX_TITLE });
    const vQty   = str(req.body.quantity, 'Menge', { max: MAX_SHORT, required: false });
    const vCat   = oneOf(requestedCat, validNames, 'Kategorie');
    const vNotes = str(req.body.notes, 'Notiz', { max: MAX_TEXT, required: false });
    const vUrl   = url(req.body.url, 'URL');
    const errors = collectErrors([vName, vQty, vCat, vNotes, vUrl]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const { result, list_change } = withListChange(req.params.listId, () => db.get().prepare(`
      INSERT INTO shopping_items (list_id, name, quantity, category, notes, url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.listId, vName.value, vQty.value, vCat.value || defaultCat, vNotes.value, vUrl.value));

    const item = db.get()
      .prepare('SELECT * FROM shopping_items WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ data: item, list_change });



    pushToCalDAV('Neuer Einkaufsartikel');
  } catch (err) {
    log.error('POST /:listId/items error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/:listId/send

// Body: { userId: number }   Response: { data: { sent: true, items: number } }
//


// offener Mailversender: beliebiger Text an beliebige Empfaenger, abgeschickt



//


// --------------------------------------------------------
router.post('/:listId/send', sendListLimiter, async (req, res) => {





  const emailService = req.app?.locals?.emailService || defaultEmailService;
  try {
    const list = db.get().prepare('SELECT * FROM shopping_lists WHERE id = ?').get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const userId = Number(req.body?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'A recipient userId is required.', code: 400 });
    }




    // fuer drei verschiedene Aufgaben.







    // welche Konten es gibt.
    if (!isHouseholdMember(userId, { db: db.get() })) {
      return res.status(404).json({ error: 'Recipient not found.', code: 404 });
    }
    const recipient = db.get().prepare('SELECT id, display_name FROM users WHERE id = ?').get(userId);





    // Sprachgrenze. Additiv, also fuer bestehende Aufrufer unveraendert.
    const to = memberEmail(userId, { db: db.get() });
    if (!to) {
      return res.status(422).json({
        error: 'This member has no email address on their contact.', code: 422, reason: 'recipient_no_email',
      });
    }
    if (!emailService.isConfigured()) {
      return res.status(422).json({
        error: 'Email is not configured. Set up SMTP in Settings first.', code: 422, reason: 'smtp_unconfigured',
      });
    }

    const categories = loadCategories();
    const items = loadListItems(req.params.listId, categories);

    // geschickt" ueber der eigenen Einkaufsliste.
    const sender = userId === req.authUserId
      ? null
      : db.get().prepare('SELECT display_name FROM users WHERE id = ?').get(req.authUserId);
    const wall = utcToWall(new Date().toISOString(), householdTimeZone(db.get()));
    const sentAt = wall ? `${wall.date} ${wall.time}` : new Date().toISOString().slice(0, 16).replace('T', ' ');

    let mail;
    try {
      mail = buildShoppingListMail({
        list,
        items,
        categories,
        senderName: sender?.display_name || null,
        sentAt,
      });
    } catch (err) {

      // nichts bewirken kann.
      return res.status(422).json({ error: err.message || 'Nothing to send.', code: 422, reason: 'nothing_open' });
    }

    await emailService.sendMail({
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,


      logLabel: 'shopping list',
    });
    res.json({ data: { sent: true, items: mail.openCount } });
  } catch (err) {
    log.error('POST /:listId/send error:', err.message);
    res.status(502).json({ error: 'The email could not be sent.', code: 502 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/:listId/import-meal-plan

// Body: { from: YYYY-MM-DD, to: YYYY-MM-DD, preview?: boolean }


// Response: { data: { transferred: number, added: number, meals: number, preview?: true } }
// --------------------------------------------------------
router.post('/:listId/import-meal-plan', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT id FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const vFrom = date(req.body.from, 'From date', true);
    const vTo = date(req.body.to, 'To date', true);
    const errors = collectErrors([vFrom, vTo]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });
    if (vFrom.value > vTo.value) {
      return res.status(400).json({ error: 'From date must be before or equal to end date.', code: 400 });
    }

    const ingredients = db.get().prepare(`
      SELECT mi.id, mi.meal_id, mi.name, mi.quantity, mi.category
      FROM meal_ingredients mi
      JOIN meals m ON m.id = mi.meal_id
      WHERE m.date BETWEEN ? AND ?
        AND mi.on_shopping_list = 0
      ORDER BY m.date ASC, mi.id ASC
    `).all(vFrom.value, vTo.value);

    if (!ingredients.length) {
      return res.json({ data: { transferred: 0, added: 0, meals: 0 } });
    }

    const mealCount = new Set(ingredients.map((i) => i.meal_id)).size;
    const aggregated = aggregateMealIngredients(ingredients);




    if (req.body.preview === true) {
      return res.json({ data: { transferred: ingredients.length, added: aggregated.length, meals: mealCount, preview: true } });
    }

    const added = db.get().transaction(() => {
      const insertItem = db.get().prepare(`
        INSERT INTO shopping_items (list_id, name, quantity, category, added_from_meal)
        VALUES (?, ?, ?, ?, ?)
      `);
      const markDone = db.get().prepare('UPDATE meal_ingredients SET on_shopping_list = 1 WHERE id = ?');

      for (const item of aggregated) {
        insertItem.run(req.params.listId, item.name, item.quantity, item.category, item.added_from_meal);
      }
      for (const ingredient of ingredients) {
        markDone.run(ingredient.id);
      }
      return aggregated.length;
    })();

    res.json({ data: { transferred: ingredients.length, added, meals: mealCount } });
  } catch (err) {
    log.error('POST /:listId/import-meal-plan error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/:listId/import-pantry

// Body: { items: [{ pantry_item_id, quantity? }] }
//



//

// dupliziert - zweimal "Milch" hilft im Supermarkt niemandem.
// Response: { data: { added: number, skipped: number, added_ids: number[] } }
//







// --------------------------------------------------------
router.post('/:listId/import-pantry', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT id FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const entries = Array.isArray(req.body.items) ? req.body.items : [];
    if (!entries.length) return res.json({ data: { added: 0, skipped: 0, added_ids: [] } });

    const validNames = validCategoryNames();


    // beiden Routen sollen nicht auseinanderlaufen.
    const defaultCat = (validNames.includes('Sonstiges') ? 'Sonstiges' : validNames.at(-1)) ?? 'Sonstiges';

    const result = db.get().transaction(() => {
      const findPantryItem = db.get().prepare('SELECT name, category FROM pantry_items WHERE id = ?');
      const findDuplicate = db.get().prepare(`
        SELECT id FROM shopping_items
        WHERE list_id = ? AND is_checked = 0 AND name = ? COLLATE NOCASE
        LIMIT 1
      `);
      const insertItem = db.get().prepare(`
        INSERT INTO shopping_items (list_id, name, quantity, category) VALUES (?, ?, ?, ?)
      `);

      let skipped = 0;
      const addedIds = [];

      for (const entry of entries) {
        const pantryItem = findPantryItem.get(Number(entry?.pantry_item_id));
        if (!pantryItem) { skipped += 1; continue; }
        if (findDuplicate.get(req.params.listId, pantryItem.name)) { skipped += 1; continue; }

        const vQty = str(entry.quantity, 'Menge', { max: MAX_SHORT, required: false });
        const category = validNames.includes(pantryItem.category) ? pantryItem.category : defaultCat;
        const info = insertItem.run(req.params.listId, pantryItem.name, vQty.value, category);
        addedIds.push(Number(info.lastInsertRowid));
      }

      return { added: addedIds.length, skipped, added_ids: addedIds };
    })();

    res.json({ data: result });
  } catch (err) {
    log.error('POST /:listId/import-pantry error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/:listId/items/checked


// Response: { deleted: number, list_change }
// --------------------------------------------------------
router.delete('/:listId/items/checked', (req, res) => {
  try {






    let ids = null;
    if (req.body?.ids !== undefined) {
      if (!Array.isArray(req.body.ids) || req.body.ids.length === 0)
        return res.status(400).json({ error: 'ids muss ein nicht-leeres Array von Artikel-IDs sein.', code: 400 });
      ids = req.body.ids.map(Number);
      if (ids.some((id) => !Number.isInteger(id) || id <= 0))
        return res.status(400).json({ error: 'ids darf nur Artikel-IDs enthalten.', code: 400 });
    }
    const scope = ids
      ? { where: `list_id = ? AND is_checked = 1 AND id IN (${ids.map(() => '?').join(',')})`, params: [req.params.listId, ...ids] }
      : { where: 'list_id = ? AND is_checked = 1', params: [req.params.listId] };

    const queued = queueTodoDeletions('shopping', mirroredItems(scope.where, ...scope.params));

    const { result, list_change } = withListChange(req.params.listId, () => db.get().prepare(`
      DELETE FROM shopping_items WHERE ${scope.where}
    `).run(...scope.params));
    res.json({ deleted: result.changes, list_change });

    if (queued) pushToCalDAV('Löschung');
  } catch (err) {
    log.error('DELETE /:listId/items/checked error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});




export const __test = { sendListLimiter };

export default router;
