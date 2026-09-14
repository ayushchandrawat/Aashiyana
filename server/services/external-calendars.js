// --------------------------------------------------------

//





// --------------------------------------------------------

import * as db from '../db.js';
import { decodeHtmlEntities } from '../utils/html-entities.js';

export function upsertExternalCalendar(source, externalId, name, color) {

  // sonst escaped die UI doppelt (z. B. literales "&amp;").
  const row = db.get().prepare(`
    INSERT INTO external_calendars (source, external_id, name, color)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source, external_id) DO UPDATE SET
      name  = excluded.name,
      color = excluded.color
    RETURNING id
  `).get(source, externalId, decodeHtmlEntities(name), color);
  return row.id;
}
