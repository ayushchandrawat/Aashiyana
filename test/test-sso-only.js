import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createPasswordResetService } from '../server/services/password-reset.js';
import {
  isPasswordLoginEnabled,
  passwordLoginWarning,
  isSsoOnlyAccount,
  OIDC_PASSWORD_SENTINEL,
} from '../server/services/oidc.js';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';

const OIDC_ENV = {
  OIDC_ISSUER: 'https://idp.example/',
  OIDC_CLIENT_ID: 'aashiyana',
  OIDC_CLIENT_SECRET: 'shh',
  OIDC_REDIRECT_URI: 'https://home.example/api/v1/auth/oidc/callback',
};

function withEnv(vars, fn) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      (value) => { restore(); return value; },
      (err) => { restore(); throw err; },
    );
  }
  restore();
  return result;
}

const withOidc = (extra, fn) => withEnv({ ...OIDC_ENV, ...extra }, fn);
const withoutOidc = (extra, fn) => withEnv({
  OIDC_ISSUER: undefined, OIDC_CLIENT_ID: undefined,
  OIDC_CLIENT_SECRET: undefined, OIDC_REDIRECT_URI: undefined, ...extra,
}, fn);

// ─── Der Schalter selbst ─────────────────────────────────────────────────────

test('ohne den Schalter bleibt die Passwort-Anmeldung an', () => {
  withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: undefined }, () => {
    assert.equal(isPasswordLoginEnabled(), true);
  });
});

test('AUTH_ALLOW_PASSWORD_LOGIN=false schaltet sie ab, wenn OIDC konfiguriert ist', () => {
  withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, () => {
    assert.equal(isPasswordLoginEnabled(), false);
  });
});

test('nur der ausdrueckliche Wert "false" schaltet ab', () => {


  for (const value of ['true', '1', 'no', 'FALSE', '']) {
    withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: value }, () => {
      assert.equal(isPasswordLoginEnabled(), true, `"${value}" darf nicht abschalten`);
    });
  }
});

test('ohne OIDC wird der Schalter ignoriert, statt alle auszusperren', () => {


  withoutOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, () => {
    assert.equal(isPasswordLoginEnabled(), true);
  });
});

test('ein unvollstaendig konfiguriertes OIDC zaehlt nicht als konfiguriert', () => {

  withOidc({ OIDC_CLIENT_SECRET: undefined, AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, () => {
    assert.equal(isPasswordLoginEnabled(), true);
  });
});

test('der ignorierte Schalter meldet sich, statt still zu versagen', () => {
  withoutOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, () => {
    const warning = passwordLoginWarning();
    assert.ok(warning, 'ohne Warnung glaubt der Betreiber, das Formular sei zu');
    assert.match(warning, /AUTH_ALLOW_PASSWORD_LOGIN/);
    assert.match(warning, /OIDC_ISSUER/, 'die Meldung muss sagen, was fehlt');
  });
});

test('wo der Schalter greift oder gar nicht gesetzt ist, warnt nichts', () => {
  withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, () => {
    assert.equal(passwordLoginWarning(), null);
  });
  withoutOidc({ AUTH_ALLOW_PASSWORD_LOGIN: undefined }, () => {
    assert.equal(passwordLoginWarning(), null);
  });
});

test('ohne ein verknuepftes SSO-Konto bleibt die Anmeldung offen', () => {




  // dass jemand hindurchkommt.
  withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, () => {
    assert.equal(isPasswordLoginEnabled({ hasLinkedSsoAccount: false }), true);
    assert.equal(isPasswordLoginEnabled({ hasLinkedSsoAccount: true }), false);
  });
});

test('der Default nimmt eine Verknuepfung an, laesst den Schalter also greifen', () => {


  withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, () => {
    assert.equal(isPasswordLoginEnabled(), false);
  });
});

// ─── Der Platzhalter ─────────────────────────────────────────────────────────

test('der Platzhalter erkennt genau sich selbst', () => {
  assert.equal(isSsoOnlyAccount(OIDC_PASSWORD_SENTINEL), true);
  assert.equal(isSsoOnlyAccount('$2b$12$echterhash'), false);
  assert.equal(isSsoOnlyAccount(null), false);
  assert.equal(isSsoOnlyAccount(undefined), false);
  assert.equal(isSsoOnlyAccount(''), false);
});

test('der Platzhalter steht an genau einer Stelle', () => {


  // gegen den anderen zufaellig gelingen.
  assert.equal(OIDC_PASSWORD_SENTINEL, '$oidc$');
});

// ─── Passwort-Reset ──────────────────────────────────────────────────────────

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL DEFAULT 'x', oidc_sub TEXT, role TEXT NOT NULL DEFAULT 'member');
    CREATE TABLE password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE UNIQUE INDEX idx_password_resets_hash ON password_resets(token_hash);
    CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_user_id INTEGER, email TEXT);
    CREATE TABLE split_expense_guest_users (user_id INTEGER PRIMARY KEY);
  `);


  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1,'alice','$2b$12$fakehash')").run();



  // genau seine WIRKUNG.
  db.prepare('INSERT INTO users (id, username, password_hash, oidc_sub, role) VALUES (2,?,?,?,?)')
    .run('sso', OIDC_PASSWORD_SENTINEL, 'sub-linked-847', 'admin');
  db.prepare("INSERT INTO contacts (family_user_id, email) VALUES (1, 'alice@test')").run();
  db.prepare("INSERT INTO contacts (family_user_id, email) VALUES (2, 'sso@test')").run();


  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (3,'gast','$2b$12$fakehash')").run();
  db.prepare('INSERT INTO split_expense_guest_users (user_id) VALUES (3)').run();
  db.prepare("INSERT INTO contacts (family_user_id, email) VALUES (3, 'gast@test')").run();
  return db;
}

async function makeAuthApp(db) {
  const { buildResetRoutes } = await import('../server/auth.js');
  const sent = [];
  const app = express();
  app.use(express.json());
  const router = express.Router();
  buildResetRoutes(router, {
    database: db,
    emailService: { isConfigured: () => true, sendMail: async (m) => { sent.push(m); } },
    resetService: createPasswordResetService({ db }),
    baseUrl: 'https://oikos.test',
    limiter: (_req, _res, next) => next(),
  });
  app.use('/auth', router);
  return { app, sent };
}

async function callJson(app, method, path, body) {
  const { createServer } = await import('node:http');
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  server.close();
  return { status: res.status, json };
}

test('ein Konto ohne Passwort bekommt keinen Reset-Link', async () => {




  const db = makeDb();
  const { app, sent } = await makeAuthApp(db);
  const { status, json } = await callJson(app, 'POST', '/auth/forgot-password', { identifier: 'sso' });
  assert.equal(status, 200, 'die Antwort bleibt generisch');
  assert.equal(json.data.ok, true);
  assert.equal(sent.length, 0, 'es darf keine Mail rausgehen');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM password_resets').get().c, 0,
    'und erst recht kein Token entstehen');
});

test('das Konto mit Passwort bekommt seinen Reset-Link weiterhin', async () => {

  // ist.
  const db = makeDb();
  const { app, sent } = await makeAuthApp(db);
  await callJson(app, 'POST', '/auth/forgot-password', { identifier: 'alice' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'alice@test');
});

test('auch ueber die E-Mail-Adresse fuehrt kein Weg zum Reset eines SSO-Kontos', async () => {

  // haengt, ist kein Riegel.
  const db = makeDb();
  const { app, sent } = await makeAuthApp(db);
  await callJson(app, 'POST', '/auth/forgot-password', { identifier: 'sso@test' });
  assert.equal(sent.length, 0);
});

test('mit abgeschalteter Passwort-Anmeldung geht ueberhaupt keine Reset-Mail raus', async () => {
  const db = makeDb();
  const { app, sent } = await makeAuthApp(db);
  await withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, async () => {
    const { status, json } = await callJson(app, 'POST', '/auth/forgot-password', { identifier: 'alice' });
    assert.equal(status, 200, 'die Antwort bleibt generisch - der Zustand ist nicht abfragbar');
    assert.equal(json.data.ok, true);
    assert.equal(sent.length, 0);
  });
});

test('ein bereits ausgestellter Token laeuft ins Leere, wenn das Konto auf SSO wechselt', async () => {



  // ueberholen.
  const db = makeDb();
  const { app, sent } = await makeAuthApp(db);
  await callJson(app, 'POST', '/auth/forgot-password', { identifier: 'alice' });
  const token = sent[0].html.match(/token=([a-f0-9]+)/)[1];

  db.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(OIDC_PASSWORD_SENTINEL);

  const { status } = await callJson(app, 'POST', '/auth/reset-password', { token, password: 'brandnewpw' });
  assert.equal(status, 400, 'derselbe Grund wie ein ungueltiger Token, damit der Unterschied nichts verraet');
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id = 1').get().password_hash,
    OIDC_PASSWORD_SENTINEL, 'der Platzhalter muss stehen bleiben');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM password_resets').get().c, 0,
    'der Token wird verbraucht, nicht liegengelassen');
});

test('ein ausgestellter Token laeuft ins Leere, wenn die Passwort-Anmeldung abgeschaltet wird', async () => {
  const db = makeDb();
  const { app, sent } = await makeAuthApp(db);
  await callJson(app, 'POST', '/auth/forgot-password', { identifier: 'alice' });
  const token = sent[0].html.match(/token=([a-f0-9]+)/)[1];
  const before = db.prepare('SELECT password_hash FROM users WHERE id = 1').get().password_hash;

  await withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, async () => {
    const { status } = await callJson(app, 'POST', '/auth/reset-password', { token, password: 'brandnewpw' });
    assert.equal(status, 400);
  });
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id = 1').get().password_hash, before,
    'das bestehende Passwort bleibt unangetastet');
});

test('ein Gast aus den geteilten Ausgaben behaelt seinen Reset', async () => {




  const db = makeDb();
  const { app, sent } = await makeAuthApp(db);
  await withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, async () => {
    await callJson(app, 'POST', '/auth/forgot-password', { identifier: 'gast' });
  });
  assert.equal(sent.length, 1, 'der Gast muss seinen Link bekommen');
  assert.equal(sent[0].to, 'gast@test');
});

test('das Haushaltsmitglied bekommt im selben Zustand keinen', async () => {

  // durchgeht.
  const db = makeDb();
  const { app, sent } = await makeAuthApp(db);
  await withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, async () => {
    await callJson(app, 'POST', '/auth/forgot-password', { identifier: 'alice' });
  });
  assert.equal(sent.length, 0);
});

test('auch der zweite Fail-open-Zustand meldet sich beim Start', () => {



  withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, () => {
    const warning = passwordLoginWarning({ hasLinkedSsoAccount: false });
    assert.ok(warning, 'ohne Warnung ist der Zustand von aussen nicht erkennbar');
    assert.match(warning, /no account is linked/);
    assert.equal(passwordLoginWarning({ hasLinkedSsoAccount: true }), null,
      'greift der Riegel wirklich, gibt es nichts zu melden');
  });
});

test('erst ein verknuepfter ADMINISTRATOR schliesst den Passwort-Weg', () => {





  // aufmachen koennte.
  //




  const start = authSrc.indexOf('function isPasswordLoginEnabled(database');
  assert.ok(start > 0, 'die Funktion ist nicht mehr auffindbar');
  const body = authSrc.slice(start, authSrc.indexOf('\n}', start));
  assert.match(body, /oidc_sub IS NOT NULL AND role = 'admin'/,
    'die Bedingung fragt nach irgendeinem verknuepften Konto statt nach einem Admin');
});

test('der letzte SSO-Administrator kann seine Verknuepfung nicht loesen', () => {

  // ganzen Haushalts zurueck: null verknuepfte Admins, fail-open, und


  const start = authSrc.indexOf('export function unlinkOidcAccount');
  const body = authSrc.slice(start, authSrc.indexOf('\n}', start));
  assert.match(body, /last_sso_admin/);
  assert.match(body, /role = 'admin' AND id != \?/,
    'geprueft werden muss, ob ein ANDERER verknuepfter Admin bleibt');
});

test('der letzte SSO-Administrator faellt auf keinem der drei Wege weg', () => {



  // (Review zu #849, Runde 5).
  assert.match(authSrc, /function assertSsoAdminWouldRemain/,
    'die Frage steht nicht an einer Stelle');
  const calls = (authSrc.match(/assertSsoAdminWouldRemain\(/g) || []).length;
  assert.ok(calls >= 3, `die Frage wird nur ${calls - 1}x gestellt, gebraucht werden PATCH und DELETE`);

  const unlink = authSrc.slice(authSrc.indexOf('export function unlinkOidcAccount'));
  assert.match(unlink.slice(0, unlink.indexOf('\n}')), /last_sso_admin/);
});

// ─── Die Regeln an ihren Quellen ─────────────────────────────────────────────
//




import { readFileSync } from 'node:fs';

const authSrc = readFileSync(new URL('../server/auth.js', import.meta.url), 'utf8');

test('die Anmelderoute selbst haelt den Riegel, nicht nur die Anmeldeseite', () => {

  // Bitte: `curl` auf /login umgeht sie vollstaendig.
  const login = authSrc.slice(authSrc.indexOf("router.post('/login'"));
  const body = login.slice(0, login.indexOf("router.post('/logout'"));
  assert.match(body, /isPasswordLoginEnabled\(\)/,
    'POST /login prueft den Schalter nicht');
  assert.match(body, /status\(403\)/, 'und weist nicht ab');
});

test('ein Konto ohne Passwort verlangt ausdrueckliche Zustimmung, kein fehlendes Feld', () => {


  assert.match(authSrc, /function assertSsoOnlyAllowed/);
  assert.match(authSrc, /An account without a password requires OIDC to be configured/,
    'ohne SSO waere so ein Konto tot');
  assert.match(authSrc, /cannot be given a password at the same time/,
    'Passwort und sso_only zugleich muss der Server abweisen statt zu raten');
});

test('der Rueckweg aus SSO-only verlangt ein Passwort', () => {


  assert.match(authSrc, /Turning off SSO-only requires setting a password/);
});

test('was Anlegen und Aendern zurueckgeben, traegt sso_only mit', () => {






  const bodies = {};
  for (const route of ["router.post('/users'", "router.patch('/users/:id'"]) {
    const start = authSrc.indexOf(route);
    assert.ok(start > 0, `${route} nicht gefunden`);
    bodies[route] = authSrc.slice(start, authSrc.indexOf('router.', start + 10));
  }
  for (const [route, body] of Object.entries(bodies)) {
    assert.match(body, /adminUserRow\(/,
      `${route} liest die Antwort nicht ueber adminUserRow - sso_only fehlt darin`);
  }
  assert.match(authSrc, /function adminUserRow[\s\S]{0,400}sso_only/,
    'adminUserRow selektiert das Flag nicht mit');
});

test('kein Weg legt ein Konto an, das seinen Zugang sofort verliert', () => {



  // Erreichbarkeitspruefung.
  assert.match(authSrc, /const ssoOnly = !isPasswordLoginEnabled\(getDb\(\)\)/,
    'die Einladungsannahme fragt den Schalter nicht');




  assert.match(authSrc, /assertSsoOnlyAllowed\(true, '', \{ email: invite\.email \}\)/,
    'die Einladungsannahme umgeht die Erreichbarkeitspruefung');
  assert.match(authSrc, /Ask for a new invitation/,
    'die Absage muss sagen, wie es weitergeht - die Einladung bleibt stehen');
  assert.match(authSrc, /password_required: isPasswordLoginEnabled/,
    'die Vorschau sagt der /join-Seite nicht, ob sie nach einem Passwort fragen soll');
});

test('ein Konto ohne Passwort muss erreichbar bleiben', () => {




  assert.match(authSrc, /needs an email address, so the first SSO sign-in can link it/);
  assert.match(authSrc, /already belongs to another member/,
    'zwei Konten mit derselben Adresse verknuepft der Server bewusst gar nicht');
});

test('nur ein echter Wechsel schreibt den Platzhalter und meldet ab', () => {


  // Mitglied auf allen Geraeten ab.
  assert.match(authSrc, /const alreadySsoOnly = isSsoOnlyAccount\(existingHash\)/);
  assert.match(authSrc, /ssoOnly === true && !alreadySsoOnly/);
});

test('die Sichtbarkeit von sso_only haengt am geltenden Zugang, nicht an der Session', () => {



  const users = authSrc.slice(authSrc.indexOf("router.get('/users'"));
  const body = users.slice(0, users.indexOf("router.get('/api-tokens'"));
  assert.match(body, /const isAdmin = req\.authRole === 'admin'/);
  assert.doesNotMatch(body, /req\.session\?\.role/,
    'die Session ist hier die falsche Quelle');
});

test('die Doppelpruefung der Adresse folgt exakt dem Linker', () => {




  const start = authSrc.indexOf('function assertSsoOnlyAllowed');
  const body = authSrc.slice(start, authSrc.indexOf('\n}', start));
  assert.match(body, /lower\(c\.email\) = lower\(\?\) OR lower\(ce\.value\) = lower\(\?\)/,
    'die Clash-Pruefung kennt weder lower() noch die Zweitadressen');
  assert.match(body, /LEFT JOIN contact_emails/);
});

test('der Reset wird nicht beworben, wenn es kein Passwort mehr gibt', () => {


  //




  // Regel.
  const index = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');


  const start = index.indexOf('passwordResetEnabled = isPasswordLoginEnabled');
  assert.ok(start > 0, 'die Berechnung ist nicht mehr auffindbar');
  const expr = index.slice(start, index.indexOf(';', start));
  assert.match(expr, /hasResettable/,
    'die Reset-Faehigkeit haengt nicht davon ab, ob es ueberhaupt ein Passwort gibt');
  assert.match(index, /password_hash != \?/,
    '/version prueft nicht, ob ueberhaupt ein Konto ein Passwort hat');
});

test('die Anmeldeseite behaelt einen Weg fuer Gastkonten', () => {



  const login = readFileSync(new URL('../public/pages/login.js', import.meta.url), 'utf8');
  assert.match(login, /show-password-form/,
    'es gibt keinen Weg, das Formular hervorzuholen');
  assert.match(login, /guestPasswordLogin/);

  // nichts einzublenden.
  assert.match(login, /id="auth-form" novalidate \$\{!passwordLoginEnabled \? 'hidden' : ''\}/);
});

test('nur die Absage wegen abgeschalteter Anmeldung zeichnet neu', () => {



  const login = readFileSync(new URL('../public/pages/login.js', import.meta.url), 'utf8');
  assert.match(login, /err\.status === 403 && \/password login is disabled\/i\.test/);
  assert.match(login, /accountCannotSignIn/,
    'die andere 403-Absage braucht eine eigene Meldung, kein "Verbindungsproblem"');
});

test('der neue Schalter erreicht auch ein Unraid-Deployment', () => {
  const xml = readFileSync(new URL('../templates/aashiyana.xml', import.meta.url), 'utf8');
  assert.match(xml, /Name="AUTH_ALLOW_PASSWORD_LOGIN"/,
    'ohne Eintrag ist die Variable dort aus der Oberflaeche nicht erreichbar');
});

test('die Anmeldeseite fragt beide Wege in EINEM Aufruf ab', () => {

  // Grund, warum die Anmeldeseite haengt.
  const login = readFileSync(new URL('../public/pages/login.js', import.meta.url), 'utf8');
  assert.match(login, /password_login_enabled/,
    'die Seite liest die Angabe nicht');
  assert.match(login, /!\(ssoEnabled && oidc\?\.password_login_enabled === false\)/,
    'ohne die Kopplung an ssoEnabled kann die Seite ganz ohne Weg hinein enden');
  assert.equal((login.match(/fetch\('\/api\/v1\/auth\/oidc\/config'/g) || []).length, 1);
});


//





// unterscheiden.

const { hasSplitExpenseGuests } = await import('../server/auth.js');

test('mit einem Gast in den geteilten Ausgaben lautet die Antwort ja', () => {
  assert.equal(hasSplitExpenseGuests(makeDb()), true);
});

test('ohne einen einzigen Gast lautet sie nein', () => {
  const db = makeDb();
  db.exec('DELETE FROM split_expense_guest_users');
  assert.equal(hasSplitExpenseGuests(db), false);


  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0);
});

test('ein Schema ohne die Tabelle sperrt niemanden aus, es hat nur keine Gaeste', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
  assert.equal(hasSplitExpenseGuests(db), false);
});



async function configFor(db) {
  const [{ router }, { _setTestDatabase, _resetTestDatabase }] = await Promise.all([
    import('../server/auth.js'),
    import('../server/db.js'),
  ]);
  _setTestDatabase(db);
  try {
    const app = express();
    app.use('/auth', router);
    const { json } = await callJson(app, 'GET', '/auth/oidc/config');
    return json;
  } finally {
    _resetTestDatabase();
  }
}

test('bei gesperrtem Passwort-Login und vorhandenem Gast bietet der Server den Gast-Weg an', async () => {
  const db = makeDb();
  await withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, async () => {
    const cfg = await configFor(db);
    assert.equal(cfg.password_login_enabled, false, 'der Riegel muss greifen, sonst prueft der Test nichts');
    assert.equal(cfg.guest_password_login_enabled, true);
  });
});

test('derselbe Haushalt ohne Gaeste bekommt den Weg NICHT angeboten (#962)', async () => {
  const db = makeDb();
  db.exec('DELETE FROM split_expense_guest_users');
  await withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'false' }, async () => {
    const cfg = await configFor(db);
    assert.equal(cfg.password_login_enabled, false);
    assert.equal(cfg.guest_password_login_enabled, false);
  });
});

test('steht der Passwort-Login offen, ist die Gast-Frage gegenstandslos', async () => {



  const db = makeDb();
  await withOidc({ AUTH_ALLOW_PASSWORD_LOGIN: 'true' }, async () => {
    const cfg = await configFor(db);
    assert.equal(cfg.password_login_enabled, true);
    assert.equal(cfg.guest_password_login_enabled, false,
      'obwohl es einen Gast gibt - die Antwort haengt an der Anzeigefrage, nicht am Datenbestand');
  });
});

test('die Anmeldeseite zeigt den Gast-Knopf nur unter dieser Antwort', () => {


  const loginSrc = readFileSync(new URL('../public/pages/login.js', import.meta.url), 'utf8');
  const flag = loginSrc.match(/const guestPasswordLoginEnabled = ([^;]+);/);
  assert.ok(flag, 'login.js leitet das Flag nicht aus der Server-Antwort ab');
  assert.match(flag[1], /guest_password_login_enabled/,
    'das Flag muss aus dem Feld des Servers kommen, nicht aus einer zweiten Herleitung');



  const block = loginSrc.match(/\$\{guestPasswordLoginEnabled \? `([\s\S]*?)` : ''\}/);
  assert.ok(block, 'der Gast-Knopf haengt an keiner Bedingung');
  assert.match(block[1], /id="show-password-form"/,
    'die Bedingung umschliesst nicht den Gast-Knopf');
});
