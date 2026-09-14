
export const MODULE_FOLDER_KEYS = Object.freeze([
  'budget',
  'tasks',
  'splitExpenses',
  'inventory',
  'housekeeping',
  'calendarItems',
]);

export function isModuleFolderKey(value) {
  return typeof value === 'string' && MODULE_FOLDER_KEYS.includes(value);
}

export function ensureModuleFolder(database, { key = null, name = '' } = {}, actorId) {
  const folderName = typeof name === 'string' ? name.trim() : '';
  const moduleKey = isModuleFolderKey(key) ? key : null;

  if (!moduleKey) {
    if (!folderName) return null;
    return findOrCreateByName(database, folderName, actorId);
  }

  const byKey = database
    .prepare('SELECT id FROM family_document_folders WHERE module_key = ?')
    .get(moduleKey);
  if (byKey) return byKey.id;







  if (folderName) {
    const byName = database



      // ohnehin ein Wurzelordner.
      .prepare('SELECT id, module_key FROM family_document_folders WHERE name = ? COLLATE NOCASE AND parent_id IS NULL')
      .get(folderName);
    if (byName) {



      if (!byName.module_key) {
        database.prepare('UPDATE family_document_folders SET module_key = ? WHERE id = ?')
          .run(moduleKey, byName.id);
      }
      return byName.id;
    }
  }

  const result = database
    .prepare('INSERT INTO family_document_folders (name, module_key, created_by) VALUES (?, ?, ?)')
    .run(folderName || moduleKey, moduleKey, actorId);
  return result.lastInsertRowid;
}

function findOrCreateByName(database, folderName, actorId) {
  const existing = database
    .prepare('SELECT id FROM family_document_folders WHERE name = ? COLLATE NOCASE AND parent_id IS NULL')
    .get(folderName);
  if (existing) return existing.id;
  const result = database
    .prepare('INSERT INTO family_document_folders (name, created_by) VALUES (?, ?)')
    .run(folderName, actorId);
  return result.lastInsertRowid;
}
