import * as dbModule from '../db.js';

const HOUSEHOLD_MEMBER_SQL = `
  NOT EXISTS (SELECT 1 FROM housekeeping_workers hw WHERE hw.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM split_expense_guest_users g WHERE g.user_id = u.id)
`;

function singleAddress(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;


  // Empfaenger-Header weitere Header.
  if (/[,;\s]/.test(raw)) return null;
  const at = raw.indexOf('@');
  if (at <= 0 || raw.indexOf('@', at + 1) !== -1) return null;
  return raw;
}

export function memberEmail(userId, { db } = {}) {
  const database = db || dbModule.get();
  const row = database.prepare(`
    SELECT email FROM contacts
    WHERE family_user_id = ? AND email IS NOT NULL AND email != ''
    LIMIT 1
  `).get(userId);
  return singleAddress(row?.email);
}

export function isHouseholdMember(userId, { db } = {}) {
  const database = db || dbModule.get();
  return Boolean(database.prepare(`
    SELECT 1 FROM users u WHERE u.id = ? AND ${HOUSEHOLD_MEMBER_SQL}
  `).get(userId));
}

export function listEmailableMembers({ db } = {}) {
  const database = db || dbModule.get();
  return database.prepare(`
    SELECT u.id, u.display_name, c.email
    FROM users u
    JOIN contacts c ON c.family_user_id = u.id
    WHERE c.email IS NOT NULL AND c.email != '' AND ${HOUSEHOLD_MEMBER_SQL}
    ORDER BY u.display_name COLLATE NOCASE ASC
  `).all()
    .map((row) => ({ ...row, email: singleAddress(row.email) }))
    .filter((row) => row.email !== null);
}
