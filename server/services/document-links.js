
import { documentVisibleSql, filterVisibleDocumentIds } from './document-access.js';
import { assertDocumentsNotDeleting } from './document-deletion-lock.js';

const DOCUMENT_COLUMNS = 'd.name, d.original_name, d.mime_type, d.file_size';

export function loadDocumentLinks(database, { table, ownerColumn, ownerIds, userId, extraColumns = [] }) {
  const ids = [...new Set((ownerIds || []).filter((id) => Number.isInteger(id) && id > 0))];
  const byOwner = new Map();
  if (!ids.length) return byOwner;

  const placeholders = ids.map(() => '?').join(', ');
  const extra = extraColumns.length ? `, ${extraColumns.map((c) => `a.${c}`).join(', ')}` : '';
  const rows = database.prepare(`
    SELECT a.${ownerColumn} AS ownerId, a.id, a.document_id, a.created_at${extra}, ${DOCUMENT_COLUMNS}
    FROM ${table} a
    JOIN family_documents d ON d.id = a.document_id
    WHERE a.${ownerColumn} IN (${placeholders}) AND ${documentVisibleSql('d')}
    ORDER BY a.id ASC
  `).all(...ids, { userId });

  for (const { ownerId, ...attachment } of rows) {
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId).push(attachment);
  }
  return byOwner;
}

/**
 * Belege eines einzelnen Datensatzes.
 * @returns {object[]}
 */
export function documentLinksFor(database, { table, ownerColumn, ownerId, userId, extraColumns }) {
  return loadDocumentLinks(database, { table, ownerColumn, ownerIds: [ownerId], userId, extraColumns })
    .get(ownerId) || [];
}

export function replaceDocumentLinks(database, { table, ownerColumn, ownerId, documentIds, userId, extraValues = {} }) {
  const wanted = assertDocumentLinkTargetsAvailable(database, documentIds, userId);

  const visibleExisting = database.prepare(`
    SELECT a.document_id
    FROM ${table} a
    JOIN family_documents d ON d.id = a.document_id
    WHERE a.${ownerColumn} = @ownerId AND ${documentVisibleSql('d')}
  `).all({ ownerId, userId }).map((row) => row.document_id);

  const keep = new Set(wanted);
  const remove = visibleExisting.filter((id) => !keep.has(id));

  const extraNames = Object.keys(extraValues);
  const columns = [ownerColumn, 'document_id', 'created_by', ...extraNames];
  const insert = database.prepare(`
    INSERT OR IGNORE INTO ${table} (${columns.join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
  `);
  const drop = database.prepare(
    `DELETE FROM ${table} WHERE ${ownerColumn} = ? AND document_id = ?`
  );

  database.transaction(() => {
    for (const documentId of remove) drop.run(ownerId, documentId);
    for (const documentId of wanted) {
      insert.run(ownerId, documentId, userId, ...extraNames.map((name) => extraValues[name]));
    }
  })();
}

export function assertDocumentLinkTargetsAvailable(database, documentIds, userId) {
  const visibleIds = filterVisibleDocumentIds(
    database,
    Array.isArray(documentIds) ? documentIds : [],
    userId,
  );
  assertDocumentsNotDeleting(visibleIds);
  return visibleIds;
}

export function visibleDocumentRef(database, rawId, userId) {
  return assertDocumentLinkTargetsAvailable(database, [rawId], userId)[0] ?? null;
}
