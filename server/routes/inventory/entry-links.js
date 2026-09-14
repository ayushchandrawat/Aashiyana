
import * as db from '../../db.js';
import { resolveBudgetMode, budgetDetailsVisibleWhere } from '../../services/budget-visibility.js';

export const ROLES = ['purchase', 'refund', 'instalment', 'maintenance', 'accessory'];

function mode() {
  return resolveBudgetMode(db.get());
}

export function visibleEntry(entryId, userId) {
  const m = mode();
  const clause = budgetDetailsVisibleWhere('be', '?', { mode: m });
  const params = [entryId];
  if (m === 'personal') params.push(userId);
  return db.get().prepare(`SELECT be.* FROM budget_entries be WHERE be.id = ? AND ${clause}`).get(...params);
}

export function linkabilityError(entry) {
  if (entry.recurrence_parent_id != null) {
    return { error: 'Cannot link a generated recurrence instance - link the series entry instead.', code: 400 };
  }
  if (entry.is_pending) {
    return { error: 'Cannot link an expected booking that has not been booked yet.', code: 400 };
  }
  return null;
}

export function entryHasLinks(entryId) {
  return db.get().prepare('SELECT 1 FROM inventory_item_entries WHERE entry_id = ?').get(entryId) != null;
}

export function linkEntry({ itemId, entryId, role, amountShare, userId }) {
  const entry = visibleEntry(entryId, userId);
  if (!entry) return { error: 'Booking not found.', code: 404 };
  const linkError = linkabilityError(entry);
  if (linkError) return linkError;

  const existing = db.get().prepare(`
    SELECT id FROM inventory_item_entries WHERE item_id = ? AND entry_id = ? AND role = ?
  `).get(itemId, entryId, role);
  if (existing) return { error: 'This booking is already linked with this role.', code: 409 };

  db.get().prepare(`
    INSERT INTO inventory_item_entries (item_id, entry_id, role, amount_share, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(itemId, entryId, role, amountShare ?? null, userId);
  return { ok: true };
}

export function unlinkEntry({ itemId, entryId, userId }) {
  const entry = visibleEntry(entryId, userId);
  if (!entry) return { error: 'Booking not found.', code: 404 };
  db.get().prepare('DELETE FROM inventory_item_entries WHERE item_id = ? AND entry_id = ?').run(itemId, entryId);
  return { ok: true };
}

export function loadLinkedEntriesForItems(itemIds, userId) {
  const ids = [...new Set((itemIds || []).filter((id) => Number.isInteger(id) && id > 0))];
  const byItem = new Map();
  if (!ids.length) return byItem;

  const m = mode();
  const visClause = budgetDetailsVisibleWhere('be', '?', { mode: m });
  const placeholders = ids.map(() => '?').join(', ');
  const params = [...ids];
  if (m === 'personal') params.push(userId);

  const rows = db.get().prepare(`
    SELECT iie.item_id AS itemId, iie.id, iie.entry_id, iie.role, iie.amount_share, iie.created_at,
           be.title, be.amount, be.date
    FROM inventory_item_entries iie
    JOIN budget_entries be ON be.id = iie.entry_id
    WHERE iie.item_id IN (${placeholders}) AND be.is_pending = 0 AND ${visClause}
    ORDER BY be.date DESC, iie.id DESC
  `).all(...params);

  for (const { itemId, ...link } of rows) {
    if (!byItem.has(itemId)) byItem.set(itemId, []);
    byItem.get(itemId).push(link);
  }
  return byItem;
}

/** Verknuepfte Buchungen eines einzelnen Gegenstands. */
export function loadLinkedEntries(itemId, userId) {
  return loadLinkedEntriesForItems([itemId], userId).get(itemId) || [];
}

/** Vorzeichenbehaftete Summe ueber die (bereits gebucht/sichtbar gefilterten) Verknuepfungen. */
export function computeTotal(links) {
  return links.reduce((sum, link) => sum + link.amount, 0);
}
