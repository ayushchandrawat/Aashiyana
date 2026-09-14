import webpushDefault from 'web-push';
import * as dbModule from '../db.js';
import { createLogger } from '../logger.js';

const log = createLogger('Push');

const FALLBACK_SUBJECT = 'mailto:admin@example.com';

const LOCAL_HOSTS = new Set(['localhost', 'localhost.localdomain', '127.0.0.1', '[::1]', '::1']);
const LOCAL_SUFFIXES = ['.local', '.localdomain', '.internal', '.lan', '.home', '.invalid'];

function pushHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}

function isRoutableHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase().replace(/\.$/, '');
  if (LOCAL_HOSTS.has(h)) return false;
  if (LOCAL_SUFFIXES.some((suffix) => h.endsWith(suffix))) return false;
  const dot = h.lastIndexOf('.');
  return dot > 0 && dot < h.length - 1;
}

function normalizeSubject(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  if (value.toLowerCase().startsWith('mailto:')) {
    const address = value.slice('mailto:'.length).trim();
    const at = address.lastIndexOf('@');
    if (at <= 0) return null;
    return isRoutableHost(address.slice(at + 1)) ? `mailto:${address}` : null;
  }


  if (!value.includes('://') && value.includes('@')) {
    return normalizeSubject(`mailto:${value}`);
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return isRoutableHost(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

export function createPushService({ db, webpush = webpushDefault } = {}) {
  const getDb = () => (db || dbModule.get());


  let lastWarnedSubject = null;

  function cfgGet(key) {
    const row = getDb().prepare('SELECT value FROM sync_config WHERE key = ?').get(key);
    return row?.value ?? null;
  }
  function cfgSet(key, value) {
    getDb().prepare(`
      INSERT INTO sync_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  function ensureVapid() {
    let pub  = process.env.VAPID_PUBLIC_KEY  || cfgGet('push_vapid_public');
    let priv = process.env.VAPID_PRIVATE_KEY || cfgGet('push_vapid_private');
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      cfgSet('push_vapid_public', pub);
      cfgSet('push_vapid_private', priv);
    }
    const subject = resolveSubject();
    webpush.setVapidDetails(subject, pub, priv);
    return { publicKey: pub, privateKey: priv, subject };
  }

  function resolveSubject() {
    const candidates = [
      ['VAPID_SUBJECT', process.env.VAPID_SUBJECT],
      ['email_from_address', cfgGet('email_from_address')],
      ['BASE_URL', process.env.BASE_URL],
    ];

    for (const [source, raw] of candidates) {
      const subject = normalizeSubject(raw);
      if (subject) return subject;
      if (raw && String(raw).trim()) {
        log.warn(`Ignoring unusable VAPID subject from ${source} (not routable): ${String(raw).trim()}`);
      }
    }

    if (lastWarnedSubject !== FALLBACK_SUBJECT) {
      lastWarnedSubject = FALLBACK_SUBJECT;
      log.warn(
        `No routable VAPID subject configured, falling back to ${FALLBACK_SUBJECT}. `
        + 'Set VAPID_SUBJECT (mailto: address or https: origin) or BASE_URL - '
        + 'Apple rejects pushes signed with a non-routable subject.',
      );
    }
    return FALLBACK_SUBJECT;
  }

  function getPublicKey() {
    return ensureVapid().publicKey;
  }

  async function sendPushToUser(userId, payload) {
    const { subject } = ensureVapid();
    const subs = getDb().prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
    let sent = 0;
    for (const sub of subs) {
      const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        getDb().prepare('UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?')
          .run(new Date().toISOString(), sub.id);
        sent += 1;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          getDb().prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
          log.info(`Removed gone push subscription ${sub.id} (${pushHost(sub.endpoint)})`);
        } else {

          // abgelehnter Push (z. B. Apple 403 BadJwtToken) nicht diagnostizierbar.


          const jwtRejected = err?.statusCode === 401 || err?.statusCode === 403;
          const parts = [
            `host=${pushHost(sub.endpoint)}`,
            err?.statusCode ? `status=${err.statusCode}` : null,
            err?.body ? `body=${String(err.body).slice(0, 300)}` : null,
            jwtRejected ? `sub=${subject}` : null,
          ].filter(Boolean);
          log.error(`Push send failed (${parts.join(' ')}):`, err?.message || err);
          if (jwtRejected) {
            log.error(
              'The push service rejected the VAPID token. Check that the subject above is a '
              + 'routable mailto: address or https: origin (set VAPID_SUBJECT or BASE_URL).',
            );
          }
        }
      }
    }
    return sent;
  }

  return { getPublicKey, sendPushToUser, ensureVapid };
}

export const pushService = createPushService();
