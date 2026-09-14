import crypto from 'node:crypto';
import * as dbModule from '../db.js';
import { createLogger } from '../logger.js';

const log = createLogger('Invites');
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days





const PUBLIC_COLUMNS = `id, email, username, display_name, role, family_role,
  permissions, created_by, expires_at, accepted_at, accepted_user_id, revoked_at,
  created_at`;

export function createInviteService({ db, now = () => Date.now() } = {}) {
  const getDb = () => (db || dbModule.get());

  function hash(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }


  function stamp() {
    return new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function createInvite({
    email = null, username = null, displayName = null,
    role = 'member', familyRole = 'other', createdBy = null, permissions = null,
  } = {}) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = now() + INVITE_TTL_MS;
    const info = getDb().prepare(`
      INSERT INTO invites (token_hash, email, username, display_name, role,
                           family_role, permissions, created_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(hash(token), email, username, displayName, role, familyRole,
           permissions, createdBy, expiresAt);
    return { token, id: Number(info.lastInsertRowid), expiresAt };
  }

  function verifyToken(token) {
    if (!token) return null;
    const row = getDb().prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM invites WHERE token_hash = ?`
    ).get(hash(token));
    if (!row) return null;                    // unbekannt
    if (row.expires_at <= now()) return null; // abgelaufen
    if (row.accepted_at) return null;
    if (row.revoked_at) return null;          // widerrufen
    return row;
  }

  function markAccepted(token, userId) {
    const info = getDb().prepare(`
      UPDATE invites SET accepted_at = ?, accepted_user_id = ?
      WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL
        AND expires_at > ?
    `).run(stamp(), userId, hash(token), now());
    return info.changes;
  }

  function revoke(id) {
    const info = getDb().prepare(`
      UPDATE invites SET revoked_at = ?
      WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL
    `).run(stamp(), id);
    return info.changes;
  }

  function listOpen() {
    return getDb().prepare(`
      SELECT ${PUBLIC_COLUMNS} FROM invites
      WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC, id DESC
    `).all(now());
  }

  function cleanupExpired() {
    const info = getDb().prepare(
      'DELETE FROM invites WHERE expires_at <= ? AND accepted_at IS NULL AND revoked_at IS NULL'
    ).run(now());
    if (info.changes) log.info(`Cleaned up ${info.changes} expired invite(s)`);
    return info.changes;
  }

  return { createInvite, verifyToken, markAccepted, revoke, listOpen, cleanupExpired };
}

export const inviteService = createInviteService();
