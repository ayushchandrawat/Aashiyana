
import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as db from './db.js';
import { generateToken, csrfMiddleware } from './middleware/csrf.js';
import { collectErrors, date as validateDate, str, MAX_SHORT, MAX_TITLE } from './middleware/validate.js';
import { createLogger } from './logger.js';
import { memberEmail } from './services/member-email.js';
import { deleteBirthdayArtifacts, syncBirthdayArtifacts } from './services/birthdays.js';
import * as oidcClient from 'openid-client';
import {
  isOidcEnabled,
  isOidcSignupAllowed,
  isPasswordLoginEnabled as passwordLoginAllowedByEnv,
  isSsoOnlyAccount,
  OIDC_PASSWORD_SENTINEL,
  getConfig as getOidcConfig,
} from './services/oidc.js';
import { emailService as defaultEmailService } from './services/email.js';
import { passwordResetService as defaultResetService } from './services/password-reset.js';
import { inviteService as defaultInviteService } from './services/invites.js';
import { parseScopes, serializeScopes, normalizeScopes } from './scopes.js';
import { hashPassword, normalizePassword, verifyPassword } from './utils/password.js';
import {
  resolvePermissions, buildSessionModuleAccess, clientPermissions,
  invitePresetPermissions, isValidInvitePreset, writeSubjectPermissions,
  INVITE_PRESET_DEFAULT,
} from './permissions.js';
import { requireAdmin } from './middleware/require-admin.js';
import * as twoFactor from './services/two-factor.js';

const log = createLogger('Auth');
const router = express.Router();





const { version: APP_VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
);


const API_TOKEN_PREFIX = 'aashiyana_';
const FAMILY_ROLES = ['dad', 'mom', 'parent', 'child', 'grandparent', 'relative', 'other'];

const DUMMY_PASSWORD_HASH = '$2b$12$invalidhashfortimingprotection000000000000000000000';
const MAX_AVATAR_DATA_LENGTH = 768 * 1024;
const HOUSEHOLD_SIZE_SQL = `
  SELECT COUNT(*) AS n FROM users
  WHERE NOT EXISTS (SELECT 1 FROM split_expense_guest_users sg WHERE sg.user_id = users.id)
`;

function householdSize(database) {
  return database.prepare(HOUSEHOLD_SIZE_SQL).get()?.n ?? 1;
}

const CURRENT_ONBOARDING_VERSION = 1;

const USER_PUBLIC_COLUMNS = `
  id,
  username,
  display_name,
  avatar_color,
  avatar_data,
  role,
  family_role,
  onboarding_version,
  changelog_seen_version,
  changelog_seen_latest,
  CASE WHEN EXISTS (
    SELECT 1 FROM split_expense_guest_users sg WHERE sg.user_id = users.id
  ) THEN 'split_guest' ELSE 'family' END AS access_scope,
  created_at,
  (SELECT phone FROM contacts WHERE contacts.family_user_id = users.id LIMIT 1) AS phone,
  (SELECT email FROM contacts WHERE contacts.family_user_id = users.id LIMIT 1) AS email,
  (SELECT birth_date FROM birthdays WHERE birthdays.family_user_id = users.id LIMIT 1) AS birth_date
`;

// --------------------------------------------------------
// Session-Store (better-sqlite3, gleiche DB-Instanz wie App)
// Eigene Implementierung - kein connect-sqlite3 (nutzt sqlite3-Bindings,

// --------------------------------------------------------
class BetterSQLiteStore extends session.Store {
  constructor() {
    super();
    // Tabelle anlegen falls nicht vorhanden
    db.get().exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid        TEXT PRIMARY KEY,
        sess       TEXT NOT NULL,
        expired_at INTEGER NOT NULL
      )
    `);

    setInterval(() => {
      db.get().prepare('DELETE FROM sessions WHERE expired_at <= ?').run(Date.now());
    }, 15 * 60_000).unref();
  }

  get(sid, callback) {
    try {
      const row = db.get()
        .prepare('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?')
        .get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiredAt = Date.now() + ttl;
      db.get()
        .prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(sess), expiredAt);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiredAt = Date.now() + ttl;
      db.get()
        .prepare('UPDATE sessions SET expired_at = ? WHERE sid = ?')
        .run(expiredAt, sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

const sessionStore = new BetterSQLiteStore();

if (!process.env.SESSION_SECRET) {
  throw new Error('[Auth] SESSION_SECRET must be set in .env. Run: node setup.js');
}

if (process.env.SESSION_SECRET.startsWith('REPLACE_WITH_')) {
  throw new Error(
    '[Auth] SESSION_SECRET is still the placeholder from .env.example ' +
    `(${process.env.SESSION_SECRET}). That value is published in this ` +
    'repository, so anyone who can reach this instance could forge a session ' +
    'cookie and sign in as any user. Generate a real one with ' +
    '`openssl rand -base64 48` and put it in .env. Everyone will have to sign ' +
    'in again once - nothing else is lost.'
  );
}

// Session-Cookie-Name. Legacy „Oikos"-Installationen nutzten `oikos.sid`; der



// `aashiyana.sid` weitergereicht werden (siehe sessionMiddleware unten).
const SESSION_COOKIE = 'aashiyana.sid';
const LEGACY_SESSION_COOKIE = 'oikos.sid';

const expressSession = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: SESSION_COOKIE,
  cookie: {
    httpOnly: true,
    // secure=false by default; set SESSION_SECURE=true when behind an HTTPS reverse proxy
    secure: process.env.SESSION_SECURE === 'true',
    // lax (not strict): Safari ITP blocks strict cookies on certain navigations
    // (e.g. reverse proxy, direct URL entry), causing 401 on login. Lax is safe
    // because CSRF is protected by the double-submit token and HTTPS secure flag.
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 Tage in ms
  },
});

function sessionMiddleware(req, res, next) {
  const header = req.headers.cookie;
  if (header && header.includes(`${LEGACY_SESSION_COOKIE}=`) && !header.includes(`${SESSION_COOKIE}=`)) {
    const match = header.match(/(?:^|;\s*)oikos\.sid=([^;]+)/);
    if (match) {
      const legacyValue = match[1];


      req.headers.cookie = `${header}; ${SESSION_COOKIE}=${legacyValue}`;


      //    Sonst sendet express-session bei read-only-Requests (/auth/me, /version),


      res.cookie(SESSION_COOKIE, legacyValue, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.SESSION_SECURE === 'true',
        maxAge: 1000 * 60 * 60 * 24 * 7,
        path: '/',
        encode: (v) => v, // Wert ist bereits kodiert → kein Doppel-Encoding
      });

      res.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' });
    }
  }
  return expressSession(req, res, next);
}

// --------------------------------------------------------

// --------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Login-Versuche. Bitte warte kurz.', code: 429 },
});


// skipSuccessfulRequests). /forgot-password antwortet aus Anti-Enumeration-

// ein bekannter Account unbegrenzt Reset-Mails/Token erzeugen.
const passwordResetLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte warte kurz.', code: 429 },
});






const twoFactorLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Versuche. Bitte warte kurz.', code: 429 },
});


const TWO_FACTOR_WINDOW_MS = 5 * 60 * 1000;

function hashApiToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function extractApiToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-api-key'] || req.headers['api-key'] || '').trim();
}

function publicApiToken(row) {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    created_by: row.created_by,
    creator_name: row.creator_name,
    subject_user_id: row.effective_subject_user_id ?? row.subject_user_id ?? row.created_by,
    subject_name: row.subject_name ?? row.creator_name,
    scopes: parseScopes(row.scopes),
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  };
}

function requestTokenScopes(req) {
  const token = extractApiToken(req);
  if (!token) return undefined;
  const row = db.get().prepare(`
    SELECT scopes FROM api_tokens
    WHERE token_hash = ?
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  `).get(hashApiToken(token));
  if (!row) return undefined;
  return parseScopes(row.scopes);
}









// schon am Router-Eingang: gescopte Tokens erreichen keine Auth-Route. Ungescopte

// dieses Routers registriert sein.
router.use((req, res, next) => {
  const scopes = requestTokenScopes(req);
  if (scopes != null) {
    return res.status(403).json({ error: 'Token scope does not permit this operation.', code: 403 });
  }
  next();
});

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_color: row.avatar_color,
    avatar_data: row.avatar_data ?? null,
    role: row.role,
    family_role: row.family_role,
    access_scope: row.access_scope ?? 'family',
    phone: row.phone ?? null,
    email: row.email ?? null,
    birth_date: row.birth_date ?? null,
    created_at: row.created_at,



    onboarding_pending: row.onboarding_version < CURRENT_ONBOARDING_VERSION,

    // sie haengen an USER_PUBLIC_COLUMNS, also traegt jede Abfrage sie mit.


    changelog_seen: {
      version: row.changelog_seen_version ?? null,
      latest: row.changelog_seen_latest ?? null,
    },

    // publicUser-Pfade behalten ihre bisherige Feldmenge.
    ...(row.is_worker !== undefined && { is_worker: Boolean(row.is_worker) }),



    ...(row.sso_only !== undefined && { sso_only: Boolean(row.sso_only) }),
  };
}

function validateMemberProfileFields(body) {
  const vPhone = body.phone !== undefined
    ? str(body.phone, 'Phone number', { max: MAX_SHORT, required: false })
    : { value: undefined, error: null };
  const vEmail = body.email !== undefined
    ? str(body.email, 'Email', { max: MAX_TITLE, required: false })
    : { value: undefined, error: null };
  const vBirthDate = body.birth_date !== undefined
    ? validateDate(body.birth_date, 'Birthday date')
    : { value: undefined, error: null };
  return {
    values: {
      phone: vPhone.value,
      email: vEmail.value,
      birth_date: vBirthDate.value,
    },
    errors: collectErrors([vPhone, vEmail, vBirthDate]),
  };
}

function syncFamilyMemberArtifacts(database, userId, {
  displayName,
  phone = undefined,
  email = undefined,
  birthDate = undefined,
  avatarData = undefined,
  actorUserId,
} = {}) {
  const user = database.prepare('SELECT id, display_name, avatar_data FROM users WHERE id = ?').get(userId);
  if (!user) return;
  const name = displayName || user.display_name;
  const photo = avatarData !== undefined ? avatarData : user.avatar_data;

  const contact = database.prepare('SELECT * FROM contacts WHERE family_user_id = ?').get(userId);
  if (contact) {
    database.prepare(`
      UPDATE contacts
      SET name = ?,
          category = COALESCE(category, 'misc'),
          phone = ?,
          email = ?
      WHERE id = ?
    `).run(
      name,
      phone !== undefined ? phone : contact.phone,
      email !== undefined ? email : contact.email,
      contact.id,
    );





    if (contact.name !== name) {
      database.prepare(`
        UPDATE contacts
        SET first_name = NULL, last_name = NULL, middle_name = NULL,
            name_prefix = NULL, name_suffix = NULL
        WHERE id = ?
      `).run(contact.id);
    }
  } else {
    database.prepare(`
      INSERT INTO contacts (name, category, phone, email, family_user_id)
      VALUES (?, 'misc', ?, ?, ?)
    `).run(name, phone ?? null, email ?? null, userId);
  }

  const birthday = database.prepare('SELECT * FROM birthdays WHERE family_user_id = ?').get(userId);
  if (birthDate === null) {
    if (birthday) {
      deleteBirthdayArtifacts(database, birthday);
      database.prepare('DELETE FROM birthdays WHERE id = ?').run(birthday.id);
    }
    return;
  }

  if (birthday) {
    database.prepare(`
      UPDATE birthdays
      SET name = ?,
          birth_date = COALESCE(?, birth_date),
          photo_data = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(name, birthDate ?? null, photo ?? null, birthday.id);
    const updated = database.prepare('SELECT * FROM birthdays WHERE id = ?').get(birthday.id);
    syncBirthdayArtifacts(database, updated);
    return;
  }

  if (birthDate) {
    const result = database.prepare(`
      INSERT INTO birthdays (name, birth_date, photo_data, created_by, family_user_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, birthDate, photo ?? null, actorUserId || userId, userId);
    const created = database.prepare('SELECT * FROM birthdays WHERE id = ?').get(result.lastInsertRowid);
    syncBirthdayArtifacts(database, created);
  }
}

function normalizeAvatarData(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return { error: 'Avatar image must be a data URL string.' };
  if (value.length > MAX_AVATAR_DATA_LENGTH) {
    return { error: 'Avatar image is too large.' };
  }
  if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) {
    return { error: 'Avatar image must be PNG, JPEG, or WebP.' };
  }
  return value;
}

function assertAdminWouldRemain(targetUserId, nextRole) {
  if (nextRole === 'admin') return null;
  const current = db.get().prepare('SELECT role FROM users WHERE id = ?').get(targetUserId);
  if (!current || current.role !== 'admin') return null;
  const row = db.get().prepare('SELECT COUNT(*) AS count FROM users WHERE role = ? AND id != ?').get('admin', targetUserId);
  return row.count > 0 ? null : 'At least one system admin must remain.';
}

function assertSsoAdminWouldRemain(targetUserId, nextRole) {


  if (passwordLoginAllowedByEnv() || !isOidcEnabled()) return null;
  if (nextRole === 'admin') return null;

  const current = db.get()
    .prepare('SELECT role, oidc_sub FROM users WHERE id = ?').get(targetUserId);
  if (!current || current.role !== 'admin' || !current.oidc_sub) return null;

  const other = db.get().prepare(`
    SELECT 1 FROM users
    WHERE oidc_sub IS NOT NULL AND role = 'admin' AND id != ?
    LIMIT 1
  `).get(targetUserId);
  if (other) return null;

  return 'This is the last administrator linked to SSO. Removing that link would switch password '
    + 'login back on for the whole household. Link another administrator first.';
}

function updateUserRoleSessions(userId, role) {
  const allSessions = db.get().prepare('SELECT sid, sess FROM sessions').all();
  const updateSession = db.get().prepare('UPDATE sessions SET sess = ? WHERE sid = ?');
  for (const row of allSessions) {
    try {
      const sess = JSON.parse(row.sess);
      if (sess.userId === userId) {
        sess.role = role;
        updateSession.run(JSON.stringify(sess), row.sid);
      }
    } catch { /* ignore malformed session */ }
  }
}

function invalidateUserSessions(userId, exceptSid) {
  const allSessions = db.get().prepare('SELECT sid, sess FROM sessions').all();
  for (const row of allSessions) {
    if (row.sid === exceptSid) continue;
    try {
      const sess = JSON.parse(row.sess);
      if (sess.userId === userId) {
        db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(row.sid);
      }
    } catch { /* ignore malformed session */ }
  }
}

function authenticateApiToken(req) {
  const token = extractApiToken(req);
  if (!token) return null;

  const tokenHash = hashApiToken(token);
  const row = db.get().prepare(`
    SELECT t.*,
      subject.id AS effective_subject_user_id,
      subject.role, subject.username, subject.display_name, subject.avatar_color,
      subject.avatar_data, subject.family_role,
      creator.display_name AS creator_name,
      subject.display_name AS subject_name
    FROM api_tokens t
    JOIN users subject ON subject.id = COALESCE(t.subject_user_id, t.created_by)
    JOIN users creator ON creator.id = t.created_by
    WHERE t.token_hash = ?
      AND t.revoked_at IS NULL
      AND (t.expires_at IS NULL OR t.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  `).get(tokenHash);
  if (!row) return null;

  db.get().prepare(`
    UPDATE api_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?
  `).run(row.id);

  req.apiToken = publicApiToken(row);
  req.user = {
    id: row.effective_subject_user_id,
    username: row.username,
    display_name: row.display_name,
    avatar_color: row.avatar_color,
    avatar_data: row.avatar_data,
    role: row.role,
    family_role: row.family_role,
  };
  return row;
}

// --------------------------------------------------------
// Auth-Guard Middleware
// --------------------------------------------------------

function applyRoleModuleAccess(req) {




  req.sessionModuleAccess = null;
  if (req.authRole === 'admin') return;
  try {
    const user = db.get()
      .prepare('SELECT id, role, family_role FROM users WHERE id = ?')
      .get(req.authUserId);
    if (user) {
      req.sessionModuleAccess = buildSessionModuleAccess(resolvePermissions(db.get(), user));
    }
  } catch (err) {
    log.error('Permission resolution failed:', err.message);
  }
}

function requireAuth(req, res, next) {
  const apiToken = authenticateApiToken(req);
  if (apiToken) {
    req.authMethod = 'api_token';
    req.authUserId = apiToken.effective_subject_user_id ?? apiToken.subject_user_id ?? apiToken.created_by;
    req.authRole = apiToken.role;
    // null = kein Scoping (voller rollenbasierter Zugriff, Legacy-Token).
    req.authScopes = parseScopes(apiToken.scopes);
    applyRoleModuleAccess(req);
    return next();
  }

  if (req.session && req.session.userId) {
    req.authMethod = 'session';
    req.authUserId = req.session.userId;
    req.authRole = req.session.role;
    // Interaktive Sessions kennen kein Token-Scoping.
    req.authScopes = null;
    applyRoleModuleAccess(req);
    return next();
  }
  res.status(401).json({ error: 'Not authenticated.', code: 401 });
}


function setupAuthSession(req, res, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId    = user.id;
      req.session.role      = user.role;
      req.session.csrfToken = generateToken();
      res.cookie('csrf-token', req.session.csrfToken, {
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.SESSION_SECURE === 'true',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });
      resolve();
    });
  });
}

function loginPayload(req, user) {
  return {
    user: {
      id:           user.id,
      username:     user.username,
      display_name: user.display_name,
      avatar_color: user.avatar_color,
      avatar_data:  user.avatar_data,
      role:         user.role,
      family_role:  user.family_role,
      access_scope: db.get().prepare('SELECT 1 FROM split_expense_guest_users WHERE user_id = ?').get(user.id) ? 'split_guest' : 'family',


      onboarding_pending: user.onboarding_version < CURRENT_ONBOARDING_VERSION,




      // Kommentar darueber davor warnt.
      changelog_seen: {
        version: user.changelog_seen_version ?? null,
        latest: user.changelog_seen_latest ?? null,
      },
    },
    permissions: clientPermissions(db.get(), user),



    // Familienfelder.
    householdSize: householdSize(db.get()),
    csrfToken: req.session.csrfToken,
  };
}

// --------------------------------------------------------
function sanitizeOidcUsername(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 64)
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned.length >= 3 ? cleaned : null;
}

export function findOrCreateOidcUser(database, claims) {
  const { sub, iss, email, email_verified, name, preferred_username, username: usernameClaim } = claims;



  const provider = iss || process.env.OIDC_ISSUER || null;


  const existing = database.prepare('SELECT * FROM users WHERE oidc_sub = ?').get(sub);
  if (existing) return existing;






  //    sicherheitshalber neuer Account.
  const trustMissingVerified = process.env.OIDC_TRUST_EMAIL_WITHOUT_VERIFIED_CLAIM === 'true';
  if (email && (email_verified === true || (trustMissingVerified && email_verified !== false))) {
    const matches = database.prepare(`
      SELECT DISTINCT u.id
      FROM users u
      JOIN contacts c ON c.family_user_id = u.id
      LEFT JOIN contact_emails ce ON ce.contact_id = c.id
      WHERE u.oidc_sub IS NULL
        AND (lower(c.email) = lower(?) OR lower(ce.value) = lower(?))
    `).all(email, email);

    if (matches.length === 1) {
      database.prepare(
        'UPDATE users SET oidc_sub = ?, oidc_provider = ? WHERE id = ?',
      ).run(sub, provider, matches[0].id);
      return database.prepare('SELECT * FROM users WHERE id = ?').get(matches[0].id);
    }
  }






  if (!isOidcSignupAllowed()) return null;

  // 4. Eindeutigen username ableiten (Kollision mit bestehenden Usernamen vermeiden).
  //    Reihenfolge: preferred_username (Standard-Claim) → username (non-standard,



  const base = sanitizeOidcUsername(preferred_username)
    ?? sanitizeOidcUsername(usernameClaim)
    ?? sanitizeOidcUsername(sub)
    ?? 'oidc-user';
  let username = base;
  for (let n = 1; database.prepare('SELECT 1 FROM users WHERE username = ?').get(username); n++) {
    const suffix = `-${n}`;
    username = base.slice(0, 64 - suffix.length) + suffix;
  }

  const display_name = (name || preferred_username || usernameClaim || email || username).slice(0, 128);
  const avatar_color = avatarColors[Math.floor(Math.random() * avatarColors.length)];


  const result = database.prepare(`
    INSERT INTO users (username, display_name, password_hash, avatar_color, role, oidc_sub, oidc_provider)
    VALUES (?, ?, ?, ?, 'member', ?, ?)
  `).run(username, display_name, OIDC_PASSWORD_SENTINEL, avatar_color, sub, provider);

  return database.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

export function linkOidcAccount(database, userId, { sub, iss }) {
  const user = database.prepare('SELECT id, oidc_sub FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, reason: 'user_gone' };



  if (user.oidc_sub) {
    return user.oidc_sub === sub ? { ok: true } : { ok: false, reason: 'already_linked' };
  }


  // Zeilenreihenfolge, wer sich damit anmeldet.
  const taken = database.prepare('SELECT id FROM users WHERE oidc_sub = ?').get(sub);
  if (taken) return { ok: false, reason: 'sub_taken' };

  database.prepare('UPDATE users SET oidc_sub = ?, oidc_provider = ? WHERE id = ?')
    .run(sub, iss || process.env.OIDC_ISSUER || null, userId);
  return { ok: true };
}

export function unlinkOidcAccount(database, userId) {
  const user = database
    .prepare('SELECT id, oidc_sub, password_hash FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, reason: 'user_gone' };
  if (!user.oidc_sub) return { ok: false, reason: 'not_linked' };
  if (isSsoOnlyAccount(user.password_hash)) return { ok: false, reason: 'no_password' };



  // Regel null verknuepfte Admins, faellt fail-open und macht Anmeldeformular,



  //



  if (!passwordLoginAllowedByEnv() && isOidcEnabled()) {
    const self = database.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (self?.role === 'admin') {
      const otherAdmin = database.prepare(`
        SELECT 1 FROM users
        WHERE oidc_sub IS NOT NULL AND role = 'admin' AND id != ?
        LIMIT 1
      `).get(userId);
      if (!otherAdmin) return { ok: false, reason: 'last_sso_admin' };
    }
  }

  database.prepare('UPDATE users SET oidc_sub = NULL, oidc_provider = NULL WHERE id = ?').run(userId);
  return { ok: true };
}

// --------------------------------------------------------
// Routen
// --------------------------------------------------------

const avatarColors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#FF2D55'];

export function isPasswordLoginEnabled(database = null) {


  if (passwordLoginAllowedByEnv()) return true;
  let hasLinkedSsoAccount = true;
  try {
    const db_ = database || db.get();



    // dessen Konto mangels eindeutiger verifizierter Adresse nie verknuepft


    // aufmachen koennte.
    hasLinkedSsoAccount = !!db_
      .prepare("SELECT 1 FROM users WHERE oidc_sub IS NOT NULL AND role = 'admin' LIMIT 1").get();
  } catch (err) {

    log.warn('SSO-Verknuepfungspruefung fehlgeschlagen:', err?.message || err);
    return true;
  }
  return passwordLoginAllowedByEnv({ hasLinkedSsoAccount });
}

function isSplitExpenseGuest(userId, database = null) {
  try {
    return !!(database || db.get())
      .prepare('SELECT 1 FROM split_expense_guest_users WHERE user_id = ?').get(userId);
  } catch {

    return false;
  }
}

export function hasSplitExpenseGuests(database = null) {
  try {
    return !!(database || db.get())
      .prepare('SELECT 1 FROM split_expense_guest_users LIMIT 1').get();
  } catch {

    return false;
  }
}

/**
 * POST /api/v1/auth/login
 * Body: { username: string, password: string }
 * Response: { user: { id, username, display_name, avatar_color, role, family_role } }
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.', code: 400 });
    }

    if (username.length > 64 || password.length > 1024) {
      return res.status(400).json({ error: 'Input is too long.', code: 400 });
    }

    const user = db.get().prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {



      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      log.warn('Login failed', { ip: req.ip, username, reason: 'user_not_found' });
      return res.status(401).json({ error: 'Invalid credentials.', code: 401 });
    }

    const { valid, needsRehash } = await verifyPassword(password, user.password_hash);
    if (!valid) {
      log.warn('Login failed', { ip: req.ip, username, reason: 'invalid_password' });
      return res.status(401).json({ error: 'Invalid credentials.', code: 401 });
    }



    if (needsRehash) {
      try {
        const migrated = await hashPassword(password);
        db.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(migrated, user.id);
        log.info('Password hash migrated to NFC', { userId: user.id });
      } catch (rehashErr) {
        log.error('Password hash migration failed:', rehashErr.message);
      }
    }

    const isStaff = db.get().prepare('SELECT 1 FROM housekeeping_workers WHERE user_id = ?').get(user.id);
    if (isStaff) {
      log.warn('Login blocked for housekeeping staff account', { ip: req.ip, username });
      return res.status(403).json({ error: 'This account cannot sign in.', code: 403 });
    }




    //




    // unbrauchbar gemacht, samt der bereits bestehenden.
    //




    if (!isPasswordLoginEnabled() && !isSplitExpenseGuest(user.id)) {
      log.warn('Login rejected: password login is disabled', { ip: req.ip, username });
      return res.status(403).json({ error: 'Password login is disabled.', code: 403 });
    }






    if (twoFactor.isEnabled(db.get(), user.id)) {
      req.session.pendingTwoFactor = { userId: user.id, expiresAt: Date.now() + TWO_FACTOR_WINDOW_MS };
      return res.json({
        twoFactorRequired: true,
        recoveryAvailable: twoFactor.getStatus(db.get(), user.id).recovery_remaining > 0,
      });
    }

    try {
      await setupAuthSession(req, res, user);
      res.json(loginPayload(req, user));
    } catch (sessionErr) {
      log.error('Session regeneration failed:', sessionErr);
      res.status(500).json({ error: 'Internal server error.', code: 500 });
    }
  } catch (err) {
    log.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export function buildResetRoutes(targetRouter, {
  database = null,
  emailService = defaultEmailService,
  resetService = defaultResetService,
  baseUrl = process.env.BASE_URL || '',
  limiter = passwordResetLimiter,
} = {}) {
  const getDb = () => (database || db.get());

  function resolveUser(identifier) {
    const id = String(identifier || '').trim();
    if (!id) return null;
    const byName = getDb().prepare('SELECT id FROM users WHERE username = ?').get(id);
    if (byName) return byName.id;
    const byEmail = getDb().prepare(
      'SELECT family_user_id AS id FROM contacts WHERE email = ? AND family_user_id IS NOT NULL LIMIT 1'
    ).get(id);
    return byEmail?.id ?? null;
  }

  function hasResettablePassword(userId) {
    const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    return !!row && !isSsoOnlyAccount(row.password_hash);
  }



  // eine Antwort behaelt.
  const emailFor = (userId) => memberEmail(userId, { db: getDb() });

  targetRouter.post('/forgot-password', limiter, async (req, res) => {
    try {
      const { identifier } = req.body || {};
      const userId = resolveUser(identifier);
      // Anti-enumeration: identical response regardless of outcome. Deshalb


      // verraten, welche Konten per SSO gefuehrt werden.
      if (userId && (isPasswordLoginEnabled(getDb()) || isSplitExpenseGuest(userId, getDb()))
          && hasResettablePassword(userId)
          && emailService.isConfigured()) {
        const to = emailFor(userId);
        // Reset links MUST use an explicitly configured, trusted origin.
        // Never derive it from the request Host header (password-reset
        // poisoning: a forged Host would point the victim's token at an
        // attacker-controlled domain).
        const origin = String(baseUrl || '').trim().replace(/\/$/, '');
        if (to && origin) {
          const { token } = resetService.createToken(userId);
          const link = `${origin}/reset-password?token=${token}`;
          await emailService.sendMail({
            to,
            subject: 'Reset your Aashiyana password',
            text: `Open this link to choose a new password (valid for 1 hour): ${link}`,
            html: `<p>Open this link to choose a new password (valid for 1 hour):</p>`
              + `<p><a href="${link}">${link}</a></p>`,
          }).catch((err) => log.error('Reset mail failed:', err.message));
        } else if (to && !origin) {
          log.warn('BASE_URL not configured; password-reset link not sent.');
        }
      }
      res.json({ data: { ok: true } });
    } catch (err) {
      log.error('forgot-password error:', err.message);
      // Still return generic success to avoid leaking failures.
      res.json({ data: { ok: true } });
    }
  });

  targetRouter.post('/reset-password', limiter, async (req, res) => {
    try {
      const { token, password } = req.body || {};
      if (!token || !password) {
        return res.status(400).json({ error: 'Token and password are required.', code: 400 });
      }
      if (normalizePassword(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.', code: 400 });
      }
      const userId = resetService.verifyToken(token);
      if (!userId) {
        return res.status(400).json({ error: 'Invalid or expired token.', code: 400 });
      }





      if ((!isPasswordLoginEnabled(getDb()) && !isSplitExpenseGuest(userId, getDb()))
          || !hasResettablePassword(userId)) {
        resetService.consumeToken(token);
        return res.status(400).json({ error: 'Invalid or expired token.', code: 400 });
      }
      const hash = await hashPassword(password);
      getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
      resetService.consumeToken(token);
      // Best-effort: invalidate existing sessions for this user.
      try {
        const rows = getDb().prepare('SELECT sid, sess FROM sessions').all();
        for (const r of rows) {
          try { if (JSON.parse(r.sess)?.userId === userId) getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(r.sid); }
          catch { /* ignore malformed session rows */ }
        }
      } catch { /* sessions table may not exist in tests */ }
      res.json({ data: { ok: true } });
    } catch (err) {
      log.error('reset-password error:', err.message);
      res.status(500).json({ error: 'Internal server error.', code: 500 });
    }
  });
}

buildResetRoutes(router);

export function buildInviteRoutes(targetRouter, {
  database = null,
  emailService = defaultEmailService,
  inviteService = defaultInviteService,
  baseUrl = process.env.BASE_URL || '',
  limiter = passwordResetLimiter,
} = {}) {
  const getDb = () => (database || db.get());

  targetRouter.post('/invites', requireAuth, requireAdmin, csrfMiddleware, async (req, res) => {
    try {
      const body = req.body || {};
      const username = String(body.username || '').trim();
      const displayName = String(body.display_name || '').trim();
      const email = String(body.email || '').trim();
      const familyRole = String(body.family_role || 'other').trim();
      const sendEmail = body.send_email === true || body.send_email === 'true';
      const role = body.system_admin === true || body.system_admin === 'true' ? 'admin' : 'member';




      // er seit v74 ist.
      const preset = body.permission_preset === undefined
        ? INVITE_PRESET_DEFAULT
        : String(body.permission_preset || '').trim();

      if (username && !/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
        return res.status(400).json({ error: 'Username must be 3-64 characters long and may only contain letters, numbers, dots, hyphens, and underscores.', code: 400 });
      }
      if (displayName.length > 128) {
        return res.status(400).json({ error: 'Display name may be at most 128 characters long.', code: 400 });
      }
      if (!FAMILY_ROLES.includes(familyRole)) {
        return res.status(400).json({ error: 'Invalid family role.', code: 400 });
      }
      if (!isValidInvitePreset(preset)) {
        return res.status(400).json({ error: 'Invalid permission preset.', code: 400 });
      }


      if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email address.', code: 400 });
      }
      if (sendEmail && !email) {
        return res.status(400).json({ error: 'An email address is required to send the invitation.', code: 400 });
      }
      if (username && getDb().prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
        return res.status(409).json({ error: 'Username is already taken.', code: 409 });
      }




      const presetPermissions = invitePresetPermissions(preset);
      const { token } = inviteService.createInvite({
        email: email || null,
        username: username || null,
        displayName: displayName || null,
        role,
        familyRole,
        permissions: presetPermissions ? JSON.stringify(presetPermissions) : null,
        createdBy: req.authUserId,
      });

      const invite = inviteService.verifyToken(token);

      let emailSent = false;
      if (sendEmail) {


        // Admin-UI dagegen selbst aus location.origin.
        const origin = String(baseUrl || '').trim().replace(/\/$/, '');
        if (!origin) {
          log.warn('BASE_URL not configured; invite mail not sent.');
        } else if (!emailService.isConfigured()) {
          log.warn('Email not configured; invite mail not sent.');
        } else {
          const link = `${origin}/join?token=${token}`;
          try {
            await emailService.sendMail({
              to: email,
              subject: 'You have been invited to Aashiyana',
              text: `Open this link to set up your account (valid for 7 days): ${link}`,
              html: '<p>Open this link to set up your account (valid for 7 days):</p>'
                + `<p><a href="${link}">${link}</a></p>`,
            });
            emailSent = true;
          } catch (mailErr) {


            log.error('Invite mail failed:', mailErr.message);
          }
        }
      }




      res.status(201).json({ data: { invite, token, email_sent: emailSent } });
    } catch (err) {
      log.error('Invite creation error:', err.message);
      res.status(500).json({ error: 'Internal server error.', code: 500 });
    }
  });

  targetRouter.get('/invites', requireAuth, requireAdmin, (_req, res) => {
    try {
      res.json({ data: { invites: inviteService.listOpen() } });
    } catch (err) {
      log.error('Invite list error:', err.message);
      res.status(500).json({ error: 'Internal server error.', code: 500 });
    }
  });

  targetRouter.delete('/invites/:id', requireAuth, requireAdmin, csrfMiddleware, (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid invite ID.', code: 400 });
      }
      if (inviteService.revoke(id) === 0) {
        return res.status(404).json({ error: 'Invite not found.', code: 404 });
      }
      res.json({ data: { ok: true } });
    } catch (err) {
      log.error('Invite revocation error:', err.message);
      res.status(500).json({ error: 'Internal server error.', code: 500 });
    }
  });

  targetRouter.get('/invites/preview', limiter, (req, res) => {
    try {
      const invite = inviteService.verifyToken(String(req.query.token || ''));
      if (!invite) return res.json({ data: { valid: false } });
      res.json({




        data: {
          valid: true,
          display_name: invite.display_name,
          username: invite.username,
          password_required: isPasswordLoginEnabled(getDb()),
        },
      });
    } catch (err) {
      log.error('Invite preview error:', err.message);
      res.status(500).json({ error: 'Internal server error.', code: 500 });
    }
  });

  targetRouter.post('/invites/accept', limiter, async (req, res) => {
    try {
      const { token, password } = req.body || {};
      if (!token) {
        return res.status(400).json({ error: 'Token and password are required.', code: 400 });
      }


      // sagt, welche E-Mail-Adresse dieser Einladung anhaengt.
      const invite = inviteService.verifyToken(token);
      if (!invite) {
        return res.status(400).json({ error: 'Invalid or expired token.', code: 400 });
      }






      // SSO-Anmeldung es findet.
      const ssoOnly = !isPasswordLoginEnabled(getDb());
      if (ssoOnly) {






        // unerreichbar.
        const linkError = assertSsoOnlyAllowed(true, '', { email: invite.email });
        if (linkError) {
          return res.status(400).json({
            error: `${linkError} Ask for a new invitation.`,
            code: 400,
          });
        }
      } else {
        if (!password) {
          return res.status(400).json({ error: 'Token and password are required.', code: 400 });
        }
        if (normalizePassword(password).length < 8) {
          return res.status(400).json({ error: 'Password must be at least 8 characters long.', code: 400 });
        }
      }





      const username = String(invite.username || req.body.username || '').trim();
      const displayName = String(invite.display_name || req.body.display_name || '').trim() || username;

      if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
        return res.status(400).json({ error: 'Username must be 3-64 characters long and may only contain letters, numbers, dots, hyphens, and underscores.', code: 400 });
      }
      if (displayName.length > 128) {
        return res.status(400).json({ error: 'Display name may be at most 128 characters long.', code: 400 });
      }

      const hash = ssoOnly ? OIDC_PASSWORD_SENTINEL : await hashPassword(password);
      const avatarColor = avatarColors[crypto.randomInt(avatarColors.length)];

      const ACCEPT_LOST = Symbol('accept_lost');
      try {
        getDb().transaction(() => {
          const created = getDb().prepare(`
            INSERT INTO users (username, display_name, password_hash, avatar_color, role, family_role)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(username, displayName, hash, avatarColor, invite.role, invite.family_role);
          const newUserId = Number(created.lastInsertRowid);






          if (invite.permissions) {
            let parsed = null;
            try {
              parsed = JSON.parse(invite.permissions);
            } catch {


              // die engste bekannte Vorlage angewandt.
              log.error('Invite permissions unreadable; falling back to the restricted preset.');
              parsed = invitePresetPermissions('restricted');
            }
            writeSubjectPermissions(getDb(), 'user', newUserId, parsed);
          }
          syncFamilyMemberArtifacts(getDb(), newUserId, {
            displayName,


            email: invite.email || undefined,
            actorUserId: newUserId,
          });


          if (inviteService.markAccepted(token, newUserId) === 0) throw ACCEPT_LOST;
        })();
      } catch (txErr) {
        if (txErr === ACCEPT_LOST) {
          return res.status(400).json({ error: 'Invalid or expired token.', code: 400 });
        }
        throw txErr;
      }

      res.status(201).json({ data: { ok: true, username } });
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'Username is already taken.', code: 409 });
      }
      log.error('Invite accept error:', err.message);
      res.status(500).json({ error: 'Internal server error.', code: 500 });
    }
  });
}

buildInviteRoutes(router);

/**
 * POST /api/v1/auth/logout
 * Response: { ok: true }
 */
router.post('/logout', requireAuth, csrfMiddleware, (req, res) => {
  if (req.authMethod === 'api_token') {
    return res.json({ ok: true });
  }
  req.session.destroy((err) => {
    if (err) {
      log.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed.', code: 500 });
    }
    res.clearCookie(SESSION_COOKIE);
    res.clearCookie(LEGACY_SESSION_COOKIE);
    res.json({ ok: true });
  });
});

router.get('/oidc/config', (_req, res) => {
  const passwordLoginEnabled = isPasswordLoginEnabled();
  res.json({
    enabled: isOidcEnabled(),
    password_login_enabled: passwordLoginEnabled,
    guest_password_login_enabled: !passwordLoginEnabled && hasSplitExpenseGuests(),
  });
});

async function beginOidcFlow(req, config, extra = {}) {
  const state         = oidcClient.randomState();
  const nonce         = oidcClient.randomNonce();
  const codeVerifier  = oidcClient.randomPKCECodeVerifier();
  const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);

  req.session.oidc = { state, nonce, codeVerifier, ...extra };

  await new Promise((resolve, reject) =>
    req.session.save(err => (err ? reject(err) : resolve()))
  );

  return oidcClient.buildAuthorizationUrl(config, {
    redirect_uri:          process.env.OIDC_REDIRECT_URI,
    scope:                 'openid email profile',
    state,
    nonce,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  }).href;
}

router.get('/oidc/start', async (req, res) => {
  try {
    const config = await getOidcConfig();
    if (!config) {
      return res.status(404).json({ error: 'OIDC is not configured.', code: 404 });
    }
    res.redirect(await beginOidcFlow(req, config));
  } catch (err) {
    log.error('OIDC start error:', err);
    res.status(500).json({ error: 'OIDC initialization failed.', code: 500 });
  }
});

router.get('/oidc/link', requireAuth, (req, res) => {
  const user = db.get()
    .prepare('SELECT oidc_sub, oidc_provider, password_hash FROM users WHERE id = ?')
    .get(req.authUserId);
  if (!user) return res.status(404).json({ error: 'User not found.', code: 404 });

  res.json({
    enabled:    isOidcEnabled(),
    linked:     !!user.oidc_sub,
    provider:   user.oidc_provider ?? null,


    can_unlink: !!user.oidc_sub && !isSsoOnlyAccount(user.password_hash),
  });
});

router.post('/oidc/link/start', requireAuth, csrfMiddleware, async (req, res) => {
  try {
    const config = await getOidcConfig();
    if (!config) return res.status(404).json({ error: 'OIDC is not configured.', code: 404 });

    const user = db.get().prepare('SELECT oidc_sub FROM users WHERE id = ?').get(req.authUserId);
    if (user?.oidc_sub) {
      return res.status(409).json({ error: 'Account is already linked.', code: 409 });
    }

    res.json({ url: await beginOidcFlow(req, config, { linkUserId: req.authUserId }) });
  } catch (err) {
    log.error('OIDC link start error:', err);
    res.status(500).json({ error: 'OIDC initialization failed.', code: 500 });
  }
});

router.delete('/oidc/link', requireAuth, csrfMiddleware, (req, res) => {
  const result = unlinkOidcAccount(db.get(), req.authUserId);
  if (result.ok) return res.json({ ok: true });

  if (result.reason === 'user_gone')   return res.status(404).json({ error: 'User not found.', code: 404 });
  if (result.reason === 'not_linked')  return res.status(409).json({ error: 'Account is not linked.', code: 409 });
  if (result.reason === 'last_sso_admin') return res.status(409).json({
    error: 'This is the last administrator linked to SSO. Unlinking it would switch password login '
      + 'back on for the whole household. Link another administrator first.',
    code: 409,
  });
  return res.status(409).json({
    error: 'Set a password before unlinking - it is currently the only way into this account.',
    code:  409,
  });
});

router.get('/oidc/callback', async (req, res) => {
  try {
    const config = await getOidcConfig();
    if (!config) return res.redirect('/login?error=oidc_not_configured');

    // Einmalig konsumieren — verhindert Wiederverwendung von state/nonce/verifier
    const stored = req.session.oidc;
    delete req.session.oidc;

    if (!stored?.state) {
      log.warn('OIDC callback: kein Session-State (abgelaufen oder nicht initiiert)');
      return res.redirect('/login?error=oidc_state_mismatch');
    }



    const currentUrl = new URL(req.originalUrl, process.env.OIDC_REDIRECT_URI);



    const tokens = await oidcClient.authorizationCodeGrant(config, currentUrl, {
      expectedState:    stored.state,
      expectedNonce:    stored.nonce,
      pkceCodeVerifier: stored.codeVerifier,
    });


    const claims   = tokens.claims();
    const userinfo = await oidcClient.fetchUserInfo(config, tokens.access_token, claims.sub);





    // der state.
    if (stored.linkUserId) {
      const result = linkOidcAccount(db.get(), stored.linkUserId, {
        sub: claims.sub,
        iss: claims.iss,
      });
      if (!result.ok) {
        log.warn(`OIDC link rejected for user ${stored.linkUserId}: ${result.reason}`);
      }
      return res.redirect(result.ok
        ? '/settings/personal/account?oidc_linked=1'
        : `/settings/personal/account?oidc_link_error=${result.reason}`);
    }

    const user = findOrCreateOidcUser(db.get(), {
      sub:                claims.sub,


      iss:                claims.iss,
      email:              userinfo.email,

      email_verified:     userinfo.email_verified ?? claims.email_verified,
      name:               userinfo.name,
      preferred_username: userinfo.preferred_username,

      username:           userinfo.username ?? claims.username,
    });


    // Redirect, weil die Anmeldeseite sonst „SSO-Anmeldung fehlgeschlagen"


    // seinem Passwort statt bei seinem Admin.
    if (!user) {
      log.warn(`OIDC signup blocked (OIDC_ALLOW_SIGNUP=false): sub=${claims.sub}`);
      return res.redirect('/login?error=oidc_signup_disabled');
    }


    //







    //


    if (twoFactor.isEnabled(db.get(), user.id)) {
      req.session.pendingTwoFactor = { userId: user.id, expiresAt: Date.now() + TWO_FACTOR_WINDOW_MS };
      return res.redirect('/login?two_factor=1');
    }

    await setupAuthSession(req, res, user);

    res.redirect('/');
  } catch (err) {
    log.error('OIDC callback error:', err);
    res.redirect('/login?error=oidc_failed');
  }
});

/**
 * POST /api/v1/auth/setup
 * First-run bootstrap: creates the first admin when no users exist.
 * Returns 403 if any user already exists.
 * Body: { username: string, display_name: string, password: string }
 * Response: { user: { id, username, display_name, avatar_color, role } }
 */
router.post('/setup', loginLimiter, async (req, res) => {
  try {
    const { count } = db.get().prepare('SELECT COUNT(*) as count FROM users').get();
    if (count > 0) {
      if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not found.', code: 404 });
      }
      return res.status(403).json({ error: 'Setup has already been completed.', code: 403 });
    }

    const username = (req.body.username || '').trim();
    const display_name = (req.body.display_name || '').trim();
    const { password } = req.body;

    if (!username || !display_name || !password) {
      return res.status(400).json({ error: 'Username, display name, and password are required.', code: 400 });
    }
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-64 characters long and may only contain letters, numbers, dots, hyphens, and underscores.', code: 400 });
    }
    if (display_name.length > 128) {
      return res.status(400).json({ error: 'Display name may be at most 128 characters long.', code: 400 });
    }
    if (normalizePassword(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.', code: 400 });
    }

    const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];
    const hash = await hashPassword(password);

    const SETUP_DONE = Symbol('setup_done');
    let result;
    try {
      result = db.transaction(() => {
        const { count: liveCount } = db.get().prepare('SELECT COUNT(*) as count FROM users').get();
        if (liveCount > 0) throw SETUP_DONE;
        const created = db.get()
          .prepare('INSERT INTO users (username, display_name, password_hash, avatar_color, role) VALUES (?, ?, ?, ?, ?)')
          .run(username, display_name, hash, avatarColor, 'admin');
        syncFamilyMemberArtifacts(db.get(), created.lastInsertRowid, {
          displayName: display_name,
          actorUserId: created.lastInsertRowid,
        });
        return created;
      });
    } catch (txErr) {
      if (txErr === SETUP_DONE) {
        return res.status(403).json({ error: 'Setup has already been completed.', code: 403 });
      }
      throw txErr;
    }
    const createdUser = db.get().prepare(`SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(result.lastInsertRowid);

    res.status(201).json({
      user: publicUser(createdUser),
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Username is already taken.', code: 409 });
    }
    log.error('Setup error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * GET /api/v1/auth/me
 * Response: { user: { id, username, display_name, avatar_color, role } }
 */
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = db.get()
      .prepare(`SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = ?`)
      .get(req.authUserId);

    if (!user) {
      if (req.authMethod === 'session' && typeof req.session.destroy === 'function') {
        req.session.destroy(() => {});
      }
      return res.status(401).json({ error: 'User not found.', code: 401 });
    }

    if (req.authMethod === 'api_token') {
      return res.json({
        user: publicUser(user),
        permissions: clientPermissions(db.get(), user),
        householdSize: householdSize(db.get()),
      });
    }

    // CSRF-Token erneuern falls vorhanden (wichtig fuer iOS-PWA-Resume:


    if (!req.session.csrfToken) {
      req.session.csrfToken = generateToken();
    }
    res.cookie('csrf-token', req.session.csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.SESSION_SECURE !== 'false',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });

    res.json({
      user: publicUser(user),
      permissions: clientPermissions(db.get(), user),
      householdSize: householdSize(db.get()),
      csrfToken: req.session.csrfToken,
    });
  } catch (err) {
    log.error('/me error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/onboarding-seen', requireAuth, csrfMiddleware, (req, res) => {
  try {
    db.get().prepare('UPDATE users SET onboarding_version = ? WHERE id = ?')
      .run(CURRENT_ONBOARDING_VERSION, req.authUserId);
    res.json({ ok: true });
  } catch (err) {
    log.error('/onboarding-seen error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/changelog-seen', requireAuth, csrfMiddleware, (req, res) => {
  try {
    const latest = String(req.body?.latest || '').trim();
    if (latest && latest.length > 64) {
      return res.status(400).json({ error: 'Invalid version.', code: 400 });
    }
    db.get().prepare(`
      UPDATE users
         SET changelog_seen_version = ?,
             changelog_seen_latest  = COALESCE(NULLIF(?, ''), changelog_seen_latest)
       WHERE id = ?
    `).run(APP_VERSION, latest, req.authUserId);
    res.json({ data: { version: APP_VERSION, latest: latest || null } });
  } catch (err) {
    log.error('/changelog-seen error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// Zwei-Faktor-Anmeldung (#672)
// --------------------------------------------------------

function consumePendingTwoFactor(req) {
  const pending = req.session?.pendingTwoFactor;
  if (!pending) return null;
  if (!pending.expiresAt || pending.expiresAt < Date.now()) {
    delete req.session.pendingTwoFactor;
    return null;
  }
  return pending;
}

router.post('/2fa/verify', twoFactorLimiter, async (req, res) => {
  try {
    const pending = consumePendingTwoFactor(req);
    if (!pending) {
      return res.status(401).json({ error: 'No pending sign-in.', code: 401 });
    }

    const code = String(req.body?.code || '');
    if (code.length > 64) {
      return res.status(400).json({ error: 'Input is too long.', code: 400 });
    }

    const result = twoFactor.verifySecondFactor(db.get(), pending.userId, code);
    if (!result.valid) {
      log.warn('Second factor failed', { ip: req.ip, userId: pending.userId });
      return res.status(401).json({ error: 'Invalid code.', code: 401 });
    }

    const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(pending.userId);
    if (!user) {
      delete req.session.pendingTwoFactor;
      return res.status(401).json({ error: 'Invalid credentials.', code: 401 });
    }




    await setupAuthSession(req, res, user);
    log.info('Second factor accepted', { userId: user.id, method: result.method });

    res.json({
      ...loginPayload(req, user),
      twoFactorMethod: result.method,
      recoveryRemaining: result.recovery_remaining,
    });
  } catch (err) {
    log.error('Second factor error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.get('/2fa', requireAuth, (req, res) => {
  try {
    res.json({ data: twoFactor.getStatus(db.get(), req.authUserId) });
  } catch (err) {
    log.error('2FA status error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/2fa/setup', requireAuth, csrfMiddleware, (req, res) => {
  try {
    const user = db.get().prepare('SELECT id, username FROM users WHERE id = ?').get(req.authUserId);
    if (!user) return res.status(401).json({ error: 'User not found.', code: 401 });

    const { secret, uri, qr } = twoFactor.beginSetup(db.get(), user);
    res.json({ data: { secret, uri, qr } });
  } catch (err) {
    if (err.code === 'already_enabled') {
      return res.status(409).json({ error: err.message, code: 409 });
    }
    log.error('2FA setup error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/2fa/enable', requireAuth, csrfMiddleware, twoFactorLimiter, (req, res) => {
  try {
    const code = String(req.body?.code || '');
    if (code.length > 64) return res.status(400).json({ error: 'Input is too long.', code: 400 });

    const { recovery_codes: codes } = twoFactor.confirmSetup(db.get(), req.authUserId, code);



    invalidateUserSessions(req.authUserId, req.sessionID);

    res.json({ data: { recovery_codes: codes } });
  } catch (err) {
    if (err.code === 'invalid_code') {
      return res.status(400).json({ error: err.message, code: 400, reason: 'invalid_code' });
    }
    if (err.code === 'no_pending_setup' || err.code === 'already_enabled') {
      return res.status(409).json({ error: err.message, code: 409, reason: err.code });
    }
    log.error('2FA enable error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/2fa/disable', requireAuth, csrfMiddleware, twoFactorLimiter, (req, res) => {
  try {
    if (!twoFactor.isEnabled(db.get(), req.authUserId)) {
      return res.status(409).json({ error: 'Two-factor authentication is not enabled.', code: 409, reason: 'not_enabled' });
    }
    if (twoFactor.isRequiredForHousehold(db.get())) {
      return res.status(403).json({ error: 'Two-factor authentication is required for this household.', code: 403, reason: 'required' });
    }

    const code = String(req.body?.code || '');
    if (code.length > 64) return res.status(400).json({ error: 'Input is too long.', code: 400 });

    const result = twoFactor.verifySecondFactor(db.get(), req.authUserId, code);
    if (!result.valid) {
      log.warn('2FA disable rejected', { ip: req.ip, userId: req.authUserId });
      return res.status(400).json({ error: 'Invalid code.', code: 400, reason: 'invalid_code' });
    }

    twoFactor.disable(db.get(), req.authUserId);
    res.json({ data: twoFactor.getStatus(db.get(), req.authUserId) });
  } catch (err) {
    log.error('2FA disable error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/2fa/recovery-codes', requireAuth, csrfMiddleware, twoFactorLimiter, (req, res) => {
  try {
    if (!twoFactor.isEnabled(db.get(), req.authUserId)) {
      return res.status(409).json({ error: 'Two-factor authentication is not enabled.', code: 409, reason: 'not_enabled' });
    }
    const code = String(req.body?.code || '');
    if (code.length > 64) return res.status(400).json({ error: 'Input is too long.', code: 400 });

    const result = twoFactor.verifySecondFactor(db.get(), req.authUserId, code);
    if (!result.valid) {
      return res.status(400).json({ error: 'Invalid code.', code: 400, reason: 'invalid_code' });
    }

    const { recovery_codes: codes } = twoFactor.regenerateRecoveryCodes(db.get(), req.authUserId);
    res.json({ data: { recovery_codes: codes } });
  } catch (err) {
    log.error('2FA recovery codes error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.get('/2fa/overview', requireAuth, requireAdmin, (_req, res) => {
  try {
    res.json({ data: twoFactor.householdOverview(db.get()), required: twoFactor.isRequiredForHousehold(db.get()) });
  } catch (err) {
    log.error('2FA overview error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.put('/2fa/require', requireAuth, requireAdmin, csrfMiddleware, (req, res) => {
  try {
    const required = req.body?.required === true || req.body?.required === '1';
    twoFactor.setRequiredForHousehold(db.get(), required);
    log.info('Household two-factor requirement changed', { userId: req.authUserId, required });
    res.json({ data: { required: twoFactor.isRequiredForHousehold(db.get()) } });
  } catch (err) {
    log.error('2FA requirement error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.get('/users', requireAuth, (req, res) => {
  try {
    // is_worker markiert Konten der Haushaltshilfe (housekeeping_workers),






    //





    const isAdmin = req.authRole === 'admin';
    const users = isAdmin
      ? db.get().prepare(`
          SELECT ${USER_PUBLIC_COLUMNS},
                 EXISTS(SELECT 1 FROM housekeeping_workers hw WHERE hw.user_id = users.id) AS is_worker,
                 (password_hash = ?) AS sso_only
          FROM users
          ORDER BY display_name
        `).all(OIDC_PASSWORD_SENTINEL)
      : db.get().prepare(`
          SELECT ${USER_PUBLIC_COLUMNS},
                 EXISTS(SELECT 1 FROM housekeeping_workers hw WHERE hw.user_id = users.id) AS is_worker
          FROM users
          ORDER BY display_name
        `).all();
    res.json({ data: users.map(publicUser) });
  } catch (err) {
    log.error('Users error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.get('/api-tokens', requireAuth, requireAdmin, (req, res) => {
  try {
    const rows = db.get().prepare(`
      SELECT t.*, creator.display_name AS creator_name,
        subject.id AS effective_subject_user_id,
        subject.display_name AS subject_name
      FROM api_tokens t
      LEFT JOIN users creator ON creator.id = t.created_by
      LEFT JOIN users subject ON subject.id = COALESCE(t.subject_user_id, t.created_by)
      ORDER BY t.created_at DESC
    `).all();
    const subjects = db.get().prepare(`
      SELECT u.id, u.username, u.display_name
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM split_expense_guest_users sg WHERE sg.user_id = u.id
      )
      ORDER BY u.display_name
    `).all();
    res.json({ data: rows.map(publicApiToken), subjects });
  } catch (err) {
    log.error('API token list error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/api-tokens', requireAuth, requireAdmin, csrfMiddleware, (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const expiresAt = req.body.expires_at ? String(req.body.expires_at).trim() : null;

    if (!name) return res.status(400).json({ error: 'Token name is required.', code: 400 });
    if (name.length > 100) return res.status(400).json({ error: 'Token name may be at most 100 characters long.', code: 400 });
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      return res.status(400).json({ error: 'expires_at must be a valid ISO date/time.', code: 400 });
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Expiration date must be in the future.', code: 400 });
    }




    let serializedScopes = null;
    if (req.body.scopes !== undefined && req.body.scopes !== null) {
      if (!Array.isArray(req.body.scopes)) {
        return res.status(400).json({ error: 'scopes must be an array of "module:read"/"module:write" strings.', code: 400 });
      }
      const normalized = normalizeScopes(req.body.scopes);
      if (normalized.length !== req.body.scopes.length) {
        return res.status(400).json({ error: 'scopes contains unknown or duplicate entries.', code: 400 });
      }
      if (normalized.length === 0) {
        return res.status(400).json({ error: 'Provide at least one scope, or omit scopes for full access.', code: 400 });
      }
      serializedScopes = serializeScopes(normalized);
    }

    const token = API_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashApiToken(token);
    const tokenPrefix = token.slice(0, 12);
    const normalizedExpiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
    let subjectUserId = req.authUserId;
    if (req.body.subject_user_id !== undefined && req.body.subject_user_id !== null) {
      subjectUserId = Number(req.body.subject_user_id);
      if (!Number.isSafeInteger(subjectUserId) || subjectUserId < 1) {
        return res.status(400).json({ error: 'subject_user_id must be a valid user ID.', code: 400 });
      }
    }
    const subject = db.get().prepare(`
      SELECT u.id,
        EXISTS(SELECT 1 FROM split_expense_guest_users sg WHERE sg.user_id = u.id) AS is_split_guest
      FROM users u WHERE u.id = ?
    `).get(subjectUserId);
    if (!subject) return res.status(400).json({ error: 'Token subject user was not found.', code: 400 });
    if (subject.is_split_guest) {
      return res.status(400).json({ error: 'A split-expense guest cannot be an API token subject.', code: 400 });
    }

    const result = db.get().prepare(`
      INSERT INTO api_tokens (name, token_hash, token_prefix, created_by, subject_user_id, expires_at, scopes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, tokenHash, tokenPrefix, req.authUserId, subjectUserId, normalizedExpiresAt, serializedScopes);

    const row = db.get().prepare(`
      SELECT t.*, creator.display_name AS creator_name,
        subject.id AS effective_subject_user_id,
        subject.display_name AS subject_name
      FROM api_tokens t
      LEFT JOIN users creator ON creator.id = t.created_by
      LEFT JOIN users subject ON subject.id = COALESCE(t.subject_user_id, t.created_by)
      WHERE t.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ data: publicApiToken(row), token });
  } catch (err) {
    log.error('API token creation error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.delete('/api-tokens/:id', requireAuth, requireAdmin, csrfMiddleware, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid token ID.', code: 400 });

    const result = db.get().prepare(`
      UPDATE api_tokens
      SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      WHERE id = ?
    `).run(id);

    if (result.changes === 0) return res.status(404).json({ error: 'API token not found.', code: 404 });
    res.json({ ok: true });
  } catch (err) {
    log.error('API token revocation error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

function adminUserRow(userId) {
  return db.get()
    .prepare(`SELECT ${USER_PUBLIC_COLUMNS}, (password_hash = ?) AS sso_only FROM users WHERE id = ?`)
    .get(OIDC_PASSWORD_SENTINEL, userId);
}

function assertSsoOnlyAllowed(ssoOnly, password, { linked = false, email = null, excludeUserId = null } = {}) {
  if (!ssoOnly) return null;
  if (!isOidcEnabled()) {
    return 'An account without a password requires OIDC to be configured.';
  }
  if (password) {
    return 'An account without a password cannot be given a password at the same time.';
  }








  if (linked) return null;
  const address = String(email || '').trim();
  if (!address) {
    return 'An account without a password needs an email address, so the first SSO sign-in can link it.';
  }


  //






  const clash = db.get().prepare(`
    SELECT 1
    FROM users u
    JOIN contacts c ON c.family_user_id = u.id
    LEFT JOIN contact_emails ce ON ce.contact_id = c.id
    WHERE u.id IS NOT ?
      AND u.oidc_sub IS NULL
      AND (lower(c.email) = lower(?) OR lower(ce.value) = lower(?))
    LIMIT 1
  `).get(excludeUserId, address, address);
  if (clash) {
    return 'This email address already belongs to another member, so SSO could not tell the accounts apart.';
  }
  return null;
}

router.post('/users', requireAuth, requireAdmin, csrfMiddleware, async (req, res) => {
  try {
    const {
      username,
      display_name,
      password,
      sso_only,
      avatar_color = avatarColors[crypto.randomInt(avatarColors.length)],
      avatar_data,
      family_role = 'other',
      system_admin = req.body.role === 'admin',
    } = req.body;
    const role = system_admin === true || system_admin === 'true' ? 'admin' : 'member';
    const ssoOnly = sso_only === true || sso_only === 'true';

    if (!username || !display_name || (!ssoOnly && !password)) {
      return res.status(400).json({ error: 'Username, display name, and password are required.', code: 400 });
    }

    if (!ssoOnly && normalizePassword(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.', code: 400 });
    }

    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-64 characters long and may only contain letters, numbers, dots, hyphens, and underscores.', code: 400 });
    }

    if (display_name.length > 128) {
      return res.status(400).json({ error: 'Display name may be at most 128 characters long.', code: 400 });
    }

    if (!FAMILY_ROLES.includes(family_role)) {
      return res.status(400).json({ error: 'Invalid family role.', code: 400 });
    }

    const normalizedAvatarData = normalizeAvatarData(avatar_data);
    if (normalizedAvatarData?.error) {
      return res.status(400).json({ error: normalizedAvatarData.error, code: 400 });
    }
    const memberFields = validateMemberProfileFields(req.body);
    if (memberFields.errors.length) {
      return res.status(400).json({ error: memberFields.errors.join(' '), code: 400 });
    }



    const ssoOnlyError = assertSsoOnlyAllowed(ssoOnly, password, { email: memberFields.values.email });
    if (ssoOnlyError) return res.status(400).json({ error: ssoOnlyError, code: 400 });

    const hash = ssoOnly ? OIDC_PASSWORD_SENTINEL : await hashPassword(password);

    const result = db.transaction(() => {
      const created = db.get()
        .prepare(`
          INSERT INTO users (username, display_name, password_hash, avatar_color, avatar_data, role, family_role)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(username, display_name, hash, avatar_color, normalizedAvatarData ?? null, role, family_role);
      syncFamilyMemberArtifacts(db.get(), created.lastInsertRowid, {
        displayName: display_name,
        phone: memberFields.values.phone,
        email: memberFields.values.email,
        birthDate: memberFields.values.birth_date,
        avatarData: normalizedAvatarData ?? null,
        actorUserId: req.authUserId,
      });
      return created;
    });

    const createdUser = adminUserRow(result.lastInsertRowid);

    res.status(201).json({
      user: publicUser(createdUser),
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Username is already taken.', code: 409 });
    }
    log.error('User creation error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.patch('/users/:id', requireAuth, requireAdmin, csrfMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user ID.', code: 400 });

    const existing = db.get().prepare(`SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(userId);
    if (!existing) return res.status(404).json({ error: 'User not found.', code: 404 });

    const username = req.body.username !== undefined ? String(req.body.username || '').trim() : existing.username;
    const displayName = req.body.display_name !== undefined ? String(req.body.display_name || '').trim() : existing.display_name;
    const avatarColor = req.body.avatar_color !== undefined ? String(req.body.avatar_color || '').trim() : existing.avatar_color;
    const familyRole = req.body.family_role !== undefined ? String(req.body.family_role || '').trim() : existing.family_role;
    const nextRole = req.body.system_admin !== undefined
      ? (req.body.system_admin === true || req.body.system_admin === 'true' ? 'admin' : 'member')
      : existing.role;
    const avatarData = req.body.avatar_data !== undefined
      ? normalizeAvatarData(req.body.avatar_data)
      : existing.avatar_data;

    if (!username || !displayName) {
      return res.status(400).json({ error: 'Username and display name are required.', code: 400 });
    }
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-64 characters long and may only contain letters, numbers, dots, hyphens, and underscores.', code: 400 });
    }
    if (displayName.length > 128) {
      return res.status(400).json({ error: 'Display name may be at most 128 characters long.', code: 400 });
    }
    if (!FAMILY_ROLES.includes(familyRole)) {
      return res.status(400).json({ error: 'Invalid family role.', code: 400 });
    }
    if (avatarData?.error) {
      return res.status(400).json({ error: avatarData.error, code: 400 });
    }
    const memberFields = validateMemberProfileFields(req.body);
    if (memberFields.errors.length) {
      return res.status(400).json({ error: memberFields.errors.join(' '), code: 400 });
    }

    const newPassword = req.body.password !== undefined ? String(req.body.password) : '';
    if (newPassword && normalizePassword(newPassword).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.', code: 400 });
    }


    const ssoOnly = req.body.sso_only !== undefined
      ? (req.body.sso_only === true || req.body.sso_only === 'true')
      : null;


    const linkedRow = db.get().prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId);
    const effectiveEmail = memberFields.values.email !== undefined
      ? memberFields.values.email
      : existing.email;
    const ssoOnlyError = assertSsoOnlyAllowed(ssoOnly === true, newPassword, {
      linked: !!linkedRow?.oidc_sub,
      email: effectiveEmail,
      excludeUserId: userId,
    });
    if (ssoOnlyError) return res.status(400).json({ error: ssoOnlyError, code: 400 });



    // Zugang, den jemand kennt.
    const existingHash = db.get().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId)?.password_hash;
    if (ssoOnly === false && isSsoOnlyAccount(existingHash) && !newPassword) {
      return res.status(400).json({ error: 'Turning off SSO-only requires setting a password.', code: 400 });
    }

    const adminError = assertAdminWouldRemain(userId, nextRole);
    if (adminError) return res.status(400).json({ error: adminError, code: 400 });



    const ssoAdminError = assertSsoAdminWouldRemain(userId, nextRole);
    if (ssoAdminError) return res.status(400).json({ error: ssoAdminError, code: 400 });







    const alreadySsoOnly = isSsoOnlyAccount(existingHash);
    const newPasswordHash = (ssoOnly === true && !alreadySsoOnly)
      ? OIDC_PASSWORD_SENTINEL
      : (newPassword ? await hashPassword(newPassword) : null);

    db.transaction(() => {
      db.get().prepare(`
        UPDATE users
        SET username = ?, display_name = ?, avatar_color = ?, avatar_data = ?, role = ?, family_role = ?
        WHERE id = ?
      `).run(username, displayName, avatarColor || '#007AFF', avatarData ?? null, nextRole, familyRole, userId);

      if (newPasswordHash) {
        db.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, userId);
      }

      syncFamilyMemberArtifacts(db.get(), userId, {
        displayName,
        phone: memberFields.values.phone,
        email: memberFields.values.email,
        birthDate: memberFields.values.birth_date,
        avatarData: avatarData ?? null,
        actorUserId: req.authUserId,
      });
    });

    if (newPasswordHash) {
      invalidateUserSessions(userId, req.sessionID);
    }

    if (nextRole !== existing.role) {
      updateUserRoleSessions(userId, nextRole);
      if (userId === req.authUserId && req.session) req.session.role = nextRole;
    }

    const updated = adminUserRow(userId);
    res.json({ user: publicUser(updated) });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Username is already taken.', code: 409 });
    }
    log.error('User update error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * PATCH /api/v1/auth/me/profile
 * Updates the current user's profile picture and basic profile fields.
 */
router.patch('/me/profile', requireAuth, csrfMiddleware, (req, res) => {
  try {
    const existing = db.get().prepare(`SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(req.authUserId);
    if (!existing) return res.status(404).json({ error: 'User not found.', code: 404 });

    const displayName = req.body.display_name !== undefined ? String(req.body.display_name || '').trim() : existing.display_name;
    const avatarColor = req.body.avatar_color !== undefined ? String(req.body.avatar_color || '').trim() : existing.avatar_color;
    const avatarData = req.body.avatar_data !== undefined
      ? normalizeAvatarData(req.body.avatar_data)
      : existing.avatar_data;
    const memberFields = validateMemberProfileFields(req.body);

    if (!displayName) return res.status(400).json({ error: 'Display name is required.', code: 400 });
    if (displayName.length > 128) {
      return res.status(400).json({ error: 'Display name may be at most 128 characters long.', code: 400 });
    }
    if (avatarData?.error) {
      return res.status(400).json({ error: avatarData.error, code: 400 });
    }
    if (memberFields.errors.length) {
      return res.status(400).json({ error: memberFields.errors.join(' '), code: 400 });
    }

    db.transaction(() => {
      db.get().prepare(`
        UPDATE users
        SET display_name = ?, avatar_color = ?, avatar_data = ?
        WHERE id = ?
      `).run(displayName, avatarColor || '#007AFF', avatarData ?? null, req.authUserId);
      syncFamilyMemberArtifacts(db.get(), req.authUserId, {
        displayName,
        phone: memberFields.values.phone,
        email: memberFields.values.email,
        birthDate: memberFields.values.birth_date,
        avatarData: avatarData ?? null,
        actorUserId: req.authUserId,
      });
    });

    const updated = db.get().prepare(`SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(req.authUserId);
    res.json({ user: publicUser(updated) });
  } catch (err) {
    log.error('Profile update error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.patch('/me/password', requireAuth, csrfMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new password are required.', code: 400 });
    }
    if (normalizePassword(new_password).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.', code: 400 });
    }

    const user = db.get().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.authUserId);
    if (!user) return res.status(404).json({ error: 'User not found.', code: 404 });

    const { valid } = await verifyPassword(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.', code: 401 });

    const hash = await hashPassword(new_password);
    db.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.authUserId);

    invalidateUserSessions(req.authUserId, req.sessionID);

    res.json({ ok: true });
  } catch (err) {
    log.error('Password change error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.delete('/users/:id', requireAuth, requireAdmin, csrfMiddleware, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    if (userId === req.authUserId) {
      return res.status(400).json({ error: 'You cannot delete your own account.', code: 400 });
    }


    // (#847). `null` = das Konto bleibt gar keine Rolle uebrig.
    const ssoAdminError = assertSsoAdminWouldRemain(userId, null);
    if (ssoAdminError) return res.status(400).json({ error: ssoAdminError, code: 400 });

    const result = db.transaction(() => {
      const birthday = db.get().prepare('SELECT * FROM birthdays WHERE family_user_id = ?').get(userId);
      if (birthday) deleteBirthdayArtifacts(db.get(), birthday);

      db.get().prepare('UPDATE ics_subscriptions SET default_assignee_user_id = NULL WHERE default_assignee_user_id = ?').run(userId);
      db.get().prepare('UPDATE external_calendars SET default_assignee_user_id = NULL WHERE default_assignee_user_id = ?').run(userId);
      // Schichtplan (Migration 189): schedule_patterns→pattern_days, schedule_overrides

      // ihre schedule_custom_field_values-Zeilen nicht - polymorph, kein echter


      const patternIds = db.get().prepare('SELECT id FROM schedule_patterns WHERE user_id = ?').all(userId).map((row) => row.id);
      if (patternIds.length) {
        const dayIds = db.get().prepare(`SELECT id FROM schedule_pattern_days WHERE pattern_id IN (${patternIds.map(() => '?').join(',')})`).all(...patternIds).map((row) => row.id);
        if (dayIds.length) db.get().prepare(`DELETE FROM schedule_custom_field_values WHERE entry_type='pattern_day' AND entry_id IN (${dayIds.map(() => '?').join(',')})`).run(...dayIds);
      }
      db.get().prepare(`DELETE FROM schedule_custom_field_values WHERE entry_type='override' AND entry_id IN (SELECT id FROM schedule_overrides WHERE user_id=?)`).run(userId);
      db.get().prepare(`DELETE FROM schedule_custom_field_values WHERE entry_type='extra_shift' AND entry_id IN (SELECT id FROM schedule_extra_shifts WHERE user_id=?)`).run(userId);
      return db.get().prepare('DELETE FROM users WHERE id = ?').run(userId);
    });

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found.', code: 404 });
    }


    const allSessions = db.get().prepare('SELECT sid, sess FROM sessions').all();
    for (const row of allSessions) {
      try {
        const sess = JSON.parse(row.sess);
        if (sess.userId === userId) {
          db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(row.sid);
        }
      } catch { /* ignore malformed session */ }
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('User deletion error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

setInterval(() => {
  try { defaultResetService.cleanupExpired(); } catch { /* best effort */ }


  try { defaultInviteService.cleanupExpired(); } catch { /* best effort */ }
}, 60 * 60_000).unref();

export { router, sessionMiddleware, requireAuth, requireAdmin, syncFamilyMemberArtifacts, normalizeAvatarData };
