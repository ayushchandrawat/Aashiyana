
export function documentVisibleSql(alias = 'd', param = 'userId') {
  return `(
    ${alias}.created_by = @${param}
    OR ${alias}.visibility = 'family'
    OR EXISTS (
      SELECT 1 FROM family_document_access a
      WHERE a.document_id = ${alias}.id AND a.user_id = @${param}
    )
  )`;
}

export function filterVisibleDocumentIds(database, ids, userId) {
  const wanted = [...new Set((ids || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0))];
  if (!wanted.length) return [];

  const placeholders = wanted.map(() => '?').join(', ');
  const visible = new Set(database.prepare(`
    SELECT d.id FROM family_documents d
    WHERE d.id IN (${placeholders}) AND ${documentVisibleSql('d')}
  `).all(...wanted, { userId }).map((row) => row.id));

  return wanted.filter((id) => visible.has(id));
}
