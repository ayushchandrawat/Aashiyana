
import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, color, collectErrors, MAX_SHORT } from '../middleware/validate.js';
import { normalizeQuickLinkUrl } from '../../public/utils/quick-link-url.js';
import { dataUrlContentMatches } from '../utils/file-signature.js';

const log = createLogger('QuickLinks');

const router = express.Router();

const VISIBILITY_VALUES = ['all', 'private'];

const MAX_ICON_DATA_LENGTH = 128 * 1024;

const MAX_QUICK_LINKS = 24;

const ICON_DATA_RE = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i;

function iconData(value) {
  if (value === undefined || value === null || value === '') return { value: null, error: null };
  if (typeof value !== 'string') return { value: null, error: 'Icon must be a data URL string.' };
  if (value.length > MAX_ICON_DATA_LENGTH) return { value: null, error: 'Icon image is too large.' };
  if (!ICON_DATA_RE.test(value)) return { value: null, error: 'Icon must be PNG, JPEG, or WebP.' };

  if (!dataUrlContentMatches(value)) return { value: null, error: 'Icon content does not match its image type.' };
  return { value, error: null };
}

const ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_ICON_NAME_LENGTH = 48;

function iconName(value) {
  if (value === undefined || value === null || value === '') return { value: null, error: null };
  if (typeof value !== 'string') return { value: null, error: 'Icon name must be a string.' };
  const trimmed = value.trim();
  if (!trimmed) return { value: null, error: null };
  if (trimmed.length > MAX_ICON_NAME_LENGTH) return { value: null, error: 'Icon name is too long.' };
  if (!ICON_NAME_RE.test(trimmed)) {
    return { value: null, error: 'Icon name must contain only lowercase letters, digits, and hyphens.' };
  }
  return { value: trimmed, error: null };
}

const VISIBLE_WHERE = "(q.visibility = 'all' OR q.created_by = @me)";

const SELECT_COLUMNS = `
  q.id, q.name, q.url, q.icon_data, q.icon_name, q.color, q.visibility,
  q.created_by, q.position, q.created_at, q.updated_at`;

function mayEdit(row, userId, isAdmin) {
  if (row.created_by === userId) return true;
  return row.visibility === 'all' && isAdmin === true;
}

export function listQuickLinksFor(userId, isAdmin = false) {
  return db.get().prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM quick_links q
    WHERE ${VISIBLE_WHERE}
    ORDER BY q.position, q.id
  `).all({ me: userId }).map((row) => ({ ...row, can_edit: mayEdit(row, userId, isAdmin) }));
}

function actingUser(req) {
  return req.authUserId || req.session?.userId || null;
}

function actingIsAdmin(req) {
  return req.authRole === 'admin';
}

function urlErrorMessage(reason) {
  switch (reason) {
    case 'empty':    return 'Address is required.';
    case 'too-long': return 'Address is too long.';
    case 'protocol': return 'Address must start with http:// or https://.';
    default:         return 'Address must be a valid URL.';
  }
}

router.get('/', (req, res) => {
  try {
    res.json({ data: listQuickLinksFor(actingUser(req), actingIsAdmin(req)) });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * POST /api/v1/quick-links
 * Body: { name, url, icon_data?, icon_name?, color?, visibility? }
 * Response: { data: QuickLink }
 */
router.post('/', (req, res) => {
  try {
    const me = actingUser(req);
    const vName  = str(req.body.name, 'Name', { max: MAX_SHORT });
    const vColor = color(req.body.color || null, 'Color');
    const vIcon  = iconData(req.body.icon_data);
    const vGlyph = iconName(req.body.icon_name);
    const errors = collectErrors([vName, vColor, vIcon, vGlyph]);

    const parsedUrl = normalizeQuickLinkUrl(req.body.url);
    if (!parsedUrl.ok) errors.push(urlErrorMessage(parsedUrl.reason));

    const visibility = VISIBILITY_VALUES.includes(req.body.visibility) ? req.body.visibility : 'all';
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });



    const { total } = db.get().prepare('SELECT COUNT(*) AS total FROM quick_links').get();
    if (total >= MAX_QUICK_LINKS) {
      return res.status(400).json({ error: `At most ${MAX_QUICK_LINKS} quick links can be created.`, code: 400 });
    }


    // Reihenfolge nicht verschieben.
    const next = db.get().prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM quick_links').get().pos;

    const result = db.get().prepare(`
      INSERT INTO quick_links (name, url, icon_data, icon_name, color, visibility, created_by, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(vName.value, parsedUrl.url, vIcon.value, vGlyph.value, vColor.value, visibility, me, next);

    const row = db.get().prepare(`SELECT ${SELECT_COLUMNS} FROM quick_links q WHERE q.id = ?`)
      .get(result.lastInsertRowid);
    res.status(201).json({ data: row });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

router.put('/order', (req, res) => {
  try {
    const me = actingUser(req);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
    if (!ids) return res.status(400).json({ error: 'ids muss ein Array sein', code: 400 });

    const visible = new Set(listQuickLinksFor(me).map((s) => s.id));
    const ordered = ids.filter((id) => visible.has(id));

    db.transaction(() => {
      const stmt = db.get().prepare('UPDATE quick_links SET position = ? WHERE id = ?');
      ordered.forEach((id, index) => stmt.run(index, id));
    });

    res.json({ data: listQuickLinksFor(me, actingIsAdmin(req)) });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * PUT /api/v1/quick-links/:id
 * Body: { name?, url?, icon_data?, icon_name?, color?, visibility? }
 * Response: { data: QuickLink }
 */
router.put('/:id', (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    const row = db.get().prepare('SELECT * FROM quick_links WHERE id = ?').get(id);


    if (!row || (row.visibility === 'private' && row.created_by !== actingUser(req))) {
      return res.status(404).json({ error: 'Schnellzugriff nicht gefunden', code: 404 });
    }
    if (!mayEdit(row, actingUser(req), actingIsAdmin(req))) return res.status(403).json({ error: 'Keine Berechtigung', code: 403 });

    const vName  = req.body.name !== undefined ? str(req.body.name, 'Name', { max: MAX_SHORT }) : { value: row.name, error: null };
    const vColor = req.body.color !== undefined ? color(req.body.color || null, 'Color') : { value: row.color, error: null };
    const vIcon  = req.body.icon_data !== undefined ? iconData(req.body.icon_data) : { value: row.icon_data, error: null };
    const vGlyph = req.body.icon_name !== undefined ? iconName(req.body.icon_name) : { value: row.icon_name, error: null };
    const errors = collectErrors([vName, vColor, vIcon, vGlyph]);

    let url = row.url;
    if (req.body.url !== undefined) {
      const parsed = normalizeQuickLinkUrl(req.body.url);
      if (!parsed.ok) errors.push(urlErrorMessage(parsed.reason));
      else url = parsed.url;
    }
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const visibility = req.body.visibility !== undefined && VISIBILITY_VALUES.includes(req.body.visibility)
      ? req.body.visibility
      : row.visibility;

    db.get().prepare(`
      UPDATE quick_links
      SET name = ?, url = ?, icon_data = ?, icon_name = ?, color = ?, visibility = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(vName.value, url, vIcon.value, vGlyph.value, vColor.value, visibility, id);

    res.json({ data: db.get().prepare(`SELECT ${SELECT_COLUMNS} FROM quick_links q WHERE q.id = ?`).get(id) });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * DELETE /api/v1/quick-links/:id
 * Response: 204
 */
router.delete('/:id', (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    const row = db.get().prepare('SELECT * FROM quick_links WHERE id = ?').get(id);
    if (!row || (row.visibility === 'private' && row.created_by !== actingUser(req))) {
      return res.status(404).json({ error: 'Schnellzugriff nicht gefunden', code: 404 });
    }
    if (!mayEdit(row, actingUser(req), actingIsAdmin(req))) return res.status(403).json({ error: 'Keine Berechtigung', code: 403 });

    db.get().prepare('DELETE FROM quick_links WHERE id = ?').run(id);
    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

export default router;
export { VISIBILITY_VALUES, MAX_ICON_DATA_LENGTH, MAX_QUICK_LINKS };
