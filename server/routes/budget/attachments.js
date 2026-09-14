
import * as db from '../../db.js';
import { documentLinksFor, loadDocumentLinks, replaceDocumentLinks } from '../../services/document-links.js';

const TABLE = { table: 'budget_entry_attachments', ownerColumn: 'entry_id' };

/**
 * Belege einer einzelnen Buchung.
 * @param {number} entryId
 * @param {number} userId
 * @returns {object[]}
 */
export function attachmentsFor(entryId, userId) {
  return documentLinksFor(db.get(), { ...TABLE, ownerId: entryId, userId });
}

export function withAttachments(entries, userId) {
  const byEntry = loadDocumentLinks(db.get(), { ...TABLE, ownerIds: entries.map((e) => e.id), userId });
  return entries.map((entry) => ({ ...entry, attachments: byEntry.get(entry.id) || [] }));
}

export function replaceAttachments(entryId, rawDocumentIds, userId) {
  replaceDocumentLinks(db.get(), { ...TABLE, ownerId: entryId, documentIds: rawDocumentIds, userId });
}
