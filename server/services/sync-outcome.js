
import { createLogger } from '../logger.js';

const log = createLogger('SyncOutcome');



const MAX_SYNC_ERROR_LENGTH = 500;

const errorKey = (provider) => `${provider}_last_error`;
const errorAtKey = (provider) => `${provider}_last_error_at`;

export function recordSyncOutcome(database, provider, error) {
  try {
    if (!error) {
      database.prepare('DELETE FROM sync_config WHERE key IN (?, ?)')
        .run(errorKey(provider), errorAtKey(provider));
      return;
    }
    const message = String(error?.message || error).slice(0, MAX_SYNC_ERROR_LENGTH);
    const set = database.prepare(`
      INSERT INTO sync_config (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                     updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    `);
    set.run(errorKey(provider), message);
    set.run(errorAtKey(provider), new Date().toISOString());
  } catch (err) {
    log.error(`Failed to record sync outcome for ${provider}:`, err?.message || err);
  }
}

export function readSyncOutcome(database, provider) {
  const get = (key) => database.prepare('SELECT value FROM sync_config WHERE key = ?').get(key)?.value ?? null;
  return { lastError: get(errorKey(provider)), lastErrorAt: get(errorAtKey(provider)) };
}

export async function withSyncOutcome(database, provider, run) {
  try {
    const result = await run();
    recordSyncOutcome(database, provider, null);
    return result;
  } catch (err) {
    recordSyncOutcome(database, provider, err);
    throw err;
  }
}

export { MAX_SYNC_ERROR_LENGTH };
