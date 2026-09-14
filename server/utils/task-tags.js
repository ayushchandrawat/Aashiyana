
import { visibilityWhere } from '../services/visibility.js';





export const MAX_TAGS = 32;
export const MAX_TAG_LEN = 64;

export function tagKey(tag) {
  return String(tag).normalize('NFC').toLowerCase();
}

export function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string' ? input.split(',') : [];

  const out  = [];
  const seen = new Set();
  for (const item of raw) {
    if (item === null || item === undefined) continue;
    const tag = String(item).trim().slice(0, MAX_TAG_LEN).trim();
    if (!tag) continue;






    if (tag === '.' || tag === '..') continue;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function tagsKey(tags) {
  return normalizeTags(tags).slice().sort().join('\u0000');
}

// --------------------------------------------------------
// Speicherschicht
//



// parametriert - zwei Kopien liefen beim ersten Sonderfall auseinander.
// --------------------------------------------------------

const STORES = {
  task:     { table: 'task_tags',          fk: 'task_id' },
  shopping: { table: 'shopping_item_tags', fk: 'item_id' },
};

/** Tags einer Zeile, alphabetisch. */
function load(database, { table, fk }, id) {
  return database
    .prepare(`SELECT tag FROM ${table} WHERE ${fk} = ? ORDER BY tag COLLATE NOCASE ASC`)
    .all(id)
    .map((r) => r.tag);
}

function loadFor(database, { table, fk }, ids) {
  const map = new Map();
  if (!ids?.length) return map;

  const placeholders = ids.map(() => '?').join(',');
  const rows = database.prepare(`
    SELECT ${fk} AS owner_id, tag FROM ${table}
    WHERE ${fk} IN (${placeholders})
    ORDER BY tag COLLATE NOCASE ASC
  `).all(...ids);

  for (const { owner_id, tag } of rows) {
    if (!map.has(owner_id)) map.set(owner_id, []);
    map.get(owner_id).push(tag);
  }
  return map;
}

function set(database, { table, fk }, id, tags) {
  const normalized = normalizeTags(tags);
  database.prepare(`DELETE FROM ${table} WHERE ${fk} = ?`).run(id);
  const ins = database.prepare(
    `INSERT OR IGNORE INTO ${table} (${fk}, tag, tag_key) VALUES (?, ?, ?)`);
  for (const tag of normalized) ins.run(id, tag, tagKey(tag));
  return normalized;
}

/** Tags einer Aufgabe, alphabetisch. */
export function loadTags(database, taskId) {
  return load(database, STORES.task, taskId);
}

export function loadTagsFor(database, taskIds) {
  return loadFor(database, STORES.task, taskIds);
}

export function setTags(database, taskId, tags) {
  return set(database, STORES.task, taskId, tags);
}

/** Tags eines Einkaufspostens, alphabetisch. */
export function loadItemTags(database, itemId) {
  return load(database, STORES.shopping, itemId);
}

export function loadItemTagsFor(database, itemIds) {
  return loadFor(database, STORES.shopping, itemIds);
}

export function setItemTags(database, itemId, tags) {
  return set(database, STORES.shopping, itemId, tags);
}

export function allTags(database, me = null) {
  return database.prepare(`
    SELECT MIN(tt.tag) AS tag, COUNT(*) AS count
    FROM task_tags tt
    JOIN tasks t ON t.id = tt.task_id
    WHERE ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}
    GROUP BY tt.tag_key
    ORDER BY count DESC, tag COLLATE NOCASE ASC
  `).all({ me });
}

// --------------------------------------------------------

//





//




// --------------------------------------------------------

export function taskIdsWithTag(database, tag, me = null) {
  return database.prepare(`
    SELECT DISTINCT t.id AS id
    FROM task_tags tt
    JOIN tasks t ON t.id = tt.task_id
    WHERE tt.tag_key = ?
      AND ${visibilityWhere('t', 'task_assignments', 'task_id', '@me')}
    ORDER BY t.id
  `).all(tagKey(tag), { me }).map((r) => r.id);
}

export function mutateTags(database, taskIds, mutate) {
  const changed = [];
  for (const id of taskIds) {
    const before = loadTags(database, id);
    const after  = normalizeTags(mutate(before));


    if (before.length === after.length && before.every((v, i) => v === after[i])) continue;
    setTags(database, id, after);
    changed.push({ id, before, after });
  }
  return changed;
}

export function renameTag(database, { from, to, me = null, ids = null }) {
  const fromKey = tagKey(from);
  const toKey   = tagKey(to);



  const targets = ids ?? [...new Set([
    ...taskIdsWithTag(database, from, me),
    ...taskIdsWithTag(database, to, me),
  ])];
  return mutateTags(database, targets, (tags) =>
    tags.map((tag) => {
      const key = tagKey(tag);
      return key === fromKey || key === toKey ? to : tag;
    }));
}

export function removeTagEverywhere(database, { tag, me = null, ids = null }) {
  const key = tagKey(tag);
  return mutateTags(database, ids ?? taskIdsWithTag(database, tag, me), (tags) =>
    tags.filter((existing) => tagKey(existing) !== key));
}

export function applyTagChanges(database, { taskIds, add = [], remove = [] }) {
  const removeKeys = new Set(normalizeTags(remove).map(tagKey));
  const addList    = normalizeTags(add);
  return mutateTags(database, taskIds, (tags) =>
    [...tags.filter((tag) => !removeKeys.has(tagKey(tag))), ...addList]);
}
