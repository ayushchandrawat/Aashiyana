
import crypto from 'node:crypto';
import * as db from '../db.js';

const HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 255;

const TTL_HOURS = 24;

const IN_FLIGHT_TIMEOUT_SECONDS = 60;

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

function fingerprint(req) {
  const body = req.body === undefined ? null : req.body;
  return crypto.createHash('sha256')
    .update(`${req.method}\n${req.path}\n${canonicalize(body)}`)
    .digest('hex');
}

function purgeExpired(conn) {
  conn.prepare(
    `DELETE FROM idempotency_keys WHERE created_at < datetime('now', ?)`,
  ).run(`-${TTL_HOURS} hours`);
}

function idempotencyMiddleware(req, res, next) {
  const key = req.get(HEADER);


  // abgewiesen statt still durchgewunken.
  if (key === undefined || req.method !== 'POST') return next();

  const trimmed = key.trim();
  if (!trimmed || trimmed.length > MAX_KEY_LENGTH || /[^\x20-\x7E]/.test(trimmed)) {
    return res.status(400).json({
      error: `Idempotency-Key must be printable ASCII, 1 to ${MAX_KEY_LENGTH} characters.`,
      code: 400,
    });
  }

  const userId = req.authUserId;
  if (!userId) return next();

  const conn = db.get();
  const hash = fingerprint(req);
  let recordId = null;

  try {
    purgeExpired(conn);





    const insert = conn.prepare(`
      INSERT INTO idempotency_keys (user_id, key, method, path, request_hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO NOTHING
    `).run(userId, trimmed, req.method, req.path, hash);

    if (insert.changes === 0) {
      const existing = conn.prepare(
        'SELECT * FROM idempotency_keys WHERE user_id = ? AND key = ?',
      ).get(userId, trimmed);



      if (!existing) return next();

      if (existing.request_hash !== hash) {
        return res.status(409).json({
          error: 'This Idempotency-Key was already used for a different request.',
          code: 409,
        });
      }

      if (existing.status === null) {
        const stale = conn.prepare(
          `SELECT created_at < datetime('now', ?) AS stale FROM idempotency_keys WHERE id = ?`,
        ).get(`-${IN_FLIGHT_TIMEOUT_SECONDS} seconds`, existing.id);

        if (!stale?.stale) {
          return res.status(409).json({
            error: 'A request with this Idempotency-Key is still in progress.',
            code: 409,
          });
        }






        conn.prepare(`UPDATE idempotency_keys SET created_at = datetime('now') WHERE id = ?`)
          .run(existing.id);
        recordId = existing.id;
      } else {
        res.setHeader('Idempotent-Replayed', 'true');
        return res.status(existing.status).json(JSON.parse(existing.response_body));
      }
    } else {
      recordId = insert.lastInsertRowid;
    }
  } catch {


    return next();
  }

  const originalJson = res.json.bind(res);
  let captured = false;





  res.json = (body) => {
    if (!captured) {
      captured = true;
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          db.get().prepare(`
            UPDATE idempotency_keys
               SET status = ?, response_body = ?, completed_at = datetime('now')
             WHERE id = ?
          `).run(res.statusCode, JSON.stringify(body ?? null), recordId);
        } else {



          db.get().prepare('DELETE FROM idempotency_keys WHERE id = ?').run(recordId);
        }
      } catch { /* siehe oben: Antwort geht vor */ }
    }
    return originalJson(body);
  };

  // Antworten ohne JSON-Rumpf (Downloads, `sendStatus`, abgebrochene


  res.on('finish', () => {
    if (captured) return;
    try {
      db.get().prepare('DELETE FROM idempotency_keys WHERE id = ? AND status IS NULL').run(recordId);
    } catch { /* best effort */ }
  });

  return next();
}

export default idempotencyMiddleware;
export { canonicalize, fingerprint, TTL_HOURS, IN_FLIGHT_TIMEOUT_SECONDS, MAX_KEY_LENGTH };
