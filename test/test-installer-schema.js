import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { ENV_SCHEMA } from '../tools/installer/env-schema.js';

const ORIGINAL_KEYS = [
  'SESSION_SECRET', 'DB_ENCRYPTION_KEY', 'WEATHER_LAT',
  'WEATHER_LON', 'WEATHER_CITY', 'WEATHER_UNITS',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
  'APPLE_USERNAME', 'APPLE_APP_SPECIFIC_PASSWORD', 'SYNC_INTERVAL_MINUTES',
];

const GOOGLE_DRIVE_KEYS = [
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REDIRECT_URI',
];

// Outlook-Push via Microsoft Graph: gleiche OAuth-Trias wie Google Calendar.
const OUTLOOK_KEYS = [
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET',
  'MS_REDIRECT_URI',
];


const P5_KEYS = [
  'APPLE_CALDAV_URL', 'SESSION_SECURE', 'TRUST_PROXY',
  'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI',
  'BACKUP_ENABLED', 'BACKUP_SCHEDULE', 'BACKUP_KEEP',
];

const DOCUMENT_STORAGE_KEYS = [
  'DOCUMENT_STORAGE_WEBDAV_ENABLED',
  'DOCUMENT_STORAGE_WEBDAV_URL',
  'DOCUMENT_STORAGE_WEBDAV_USERNAME',
  'DOCUMENT_STORAGE_WEBDAV_PASSWORD',
  'DOCUMENT_STORAGE_WEBDAV_PATH',
];

const DOCUMENT_STORAGE_LOCAL_KEYS = [
  'DOCUMENT_STORAGE_LOCAL_ENABLED',
  'DOCUMENT_STORAGE_LOCAL_PATH',
];

const SUBSCRIPTION_KEYS = ['FIXER_API_KEY'];



const EMAIL_KEYS = [
  'EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT', 'EMAIL_SMTP_SECURE',
  'EMAIL_SMTP_USER', 'EMAIL_SMTP_PASS', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME',
];

const WEBDAV_BACKUP_KEYS = [
  'WEBDAV_BACKUP_ENABLED', 'WEBDAV_BACKUP_URL', 'WEBDAV_BACKUP_USERNAME',
  'WEBDAV_BACKUP_PASSWORD', 'WEBDAV_BACKUP_PATH', 'WEBDAV_BACKUP_KEEP',
];

const WIZARD_EXTRA_KEYS = ['BASE_URL', 'VAPID_SUBJECT'];





const COMPLETENESS_KEYS = [
  'DATA_DIR',
  'DOCUMENT_STORAGE_LOCAL_DIR',
  'DOCUMENT_STORAGE_WEBDAV_ALLOW_PRIVATE_NETWORK',
  'ICS_SUBSCRIPTION_ALLOW_PRIVATE_NETWORK',
  'RECIPE_PROVIDER_ALLOW_PRIVATE_NETWORK',
  'WASTE_SOURCE_ALLOW_PRIVATE_NETWORK',
  'OIDC_TRUST_EMAIL_WITHOUT_VERIFIED_CLAIM',
];


// Storage-Keys: sie gehoert zu keinem Speicher-Backend, sondern gilt fuer jeden
// Upload - Dokumente, Termin-Anhaenge, Belege der Haushaltshilfe.
const UPLOAD_KEYS = ['MAX_UPLOAD_MB'];

// Der Schalter gegen automatische Kontoerstellung per SSO (#654). Eigene Liste


const OIDC_SIGNUP_KEYS = ['OIDC_ALLOW_SIGNUP'];





const PASSWORD_LOGIN_KEYS = ['AUTH_ALLOW_PASSWORD_LOGIN'];

const TOTAL_KEYS = ORIGINAL_KEYS.length + GOOGLE_DRIVE_KEYS.length + OUTLOOK_KEYS.length + 2 + P5_KEYS.length
  + DOCUMENT_STORAGE_KEYS.length + DOCUMENT_STORAGE_LOCAL_KEYS.length
  + SUBSCRIPTION_KEYS.length + EMAIL_KEYS.length + WEBDAV_BACKUP_KEYS.length
  + WIZARD_EXTRA_KEYS.length + COMPLETENESS_KEYS.length + UPLOAD_KEYS.length
  + OIDC_SIGNUP_KEYS.length + PASSWORD_LOGIN_KEYS.length; // + TZ + OIKOS_HTTP_PORT

// ── Regel-Guard: .env.example ⇄ ENV_SCHEMA ⇄ gesendetes env-Objekt ───────────
//





//




const INTENTIONALLY_NOT_IN_INSTALLER = {


  NODE_ENV: 'Vom Image gesetzt (production).',
  PORT: 'Container-interner Port, überall fest 3000. Der Host-Port ist OIKOS_HTTP_PORT.',
  DB_PATH: 'Vom Descriptor auf /data/aashiyana.db gesetzt.',
  BACKUP_DIR:
    'Die App liest diesen Namen selbst (backup-scheduler.js) und meint damit das Ziel IM '
    + 'Container. Ein Host-Pfad in der .env wird dort zu /app/backups, ausserhalb des Mounts - '
    + 'das war
    + 'darf. Der Host-Ordner der Sicherungen wird ueber den Mount gesetzt, nicht hierueber.',
  MODULES_DIR:
    'Dieselbe Regel wie bei BACKUP_DIR: die App liest den Namen selbst (services/modules.js) '
    + 'und meint das Verzeichnis IM Container. Hier ist es sogar schaerfer, weil kein Descriptor '
    + 'die Variable unter environment pinnt - ein Host-Pfad aus der .env erreicht den Container '
    + 'also ungebremst. Wer Module ablegt, setzt den Mount in der Compose-Datei.',
  OIKOS_HTTP_BIND: 'Bindungsadresse für rootless Podman hinter Proxy. Ein falscher Wert macht die App unerreichbar, und der Default ist für jede vom Wizard erzeugte Installation richtig.',
  DMS_ALLOW_PRIVATE_NETWORK:
    'Der einzige *_ALLOW_PRIVATE_NETWORK-Schalter mit Default true (#809): ein DMS ist per '
    + 'Definition selbst gehostet und steht meist im selben LAN oder Docker-Netz, ein Opt-in '
    + 'haette jede Bestandsanbindung beim Update gekappt. Damit ist der Default bereits der '
    + 'Wert, den der Wizard setzen wuerde. Wer ihn umdreht, HAERTET bewusst und fasst die .env '
    + 'ohnehin von Hand an. Eine Checkbox waere hier ausserdem invertiert beschriftet ("private '
    + 'Ziele SPERREN") und damit die einzige im Wizard, die man rueckwaerts liest.',


  VAPID_PUBLIC_KEY: 'Wird bei Erstnutzung automatisch erzeugt; nur VAPID_SUBJECT ist konfigurierbar.',
  VAPID_PRIVATE_KEY: 'Wird bei Erstnutzung automatisch erzeugt.',



  OPENWEATHER_API_KEY: 'Legacy-Wetterprovider; Default ist Open-Meteo ohne Schlüssel.',
  OPENWEATHER_CITY: 'Legacy-Wetterprovider.',
  OPENWEATHER_UNITS: 'Legacy-Wetterprovider.',
  OPENWEATHER_LANG: 'Legacy-Wetterprovider.',







  IMMICH_URL: 'In der App unter Verwaltung → Immich einzurichten; Env ist der deklarative Zweitweg.',





  NOTIFICATION_ALLOW_PRIVATE_NETWORK:
    'SSRF-Opt-in fuer Benachrichtigungskanaele; der Kanal wird in der App angelegt und das '
    + 'Formular nennt den Schalter, wenn es eine private Adresse ablehnt.',
  IMMICH_API_KEY: 'Geheimnis, das in der App gesetzt und dort auch getestet wird.',
  IMMICH_SCREENSAVER_ALBUM_ID: 'Optionale Album-Einschränkung, in der App wählbar.',

  // Betriebs-Feinjustage, keine Installationsentscheidung.
  LOG_LEVEL: 'Betriebs-Feinjustage.',
  ENABLE_API_DOCS: 'Betriebs-Feinjustage.',
  MCP_INTERNAL_BASE_URL: 'Betriebs-Feinjustage.',
  RATE_LIMIT_WINDOW_MS: 'Betriebs-Feinjustage.',
  RATE_LIMIT_MAX_ATTEMPTS: 'Betriebs-Feinjustage.',
  BACKUP_UPLOAD_LIMIT:
    'Betriebs-Feinjustage: Body-Limit fuer den Restore-Upload im Admin-UI, nur beim '
    + 'Zurueckspielen einer ueberdimensionierten Datenbank relevant.',
  DB_ALLOW_NEWER_SCHEMA:
    'Notfallschalter, keine Installationsentscheidung: laesst eine aeltere App auf einer '
    + 'neueren Datenbank starten, obwohl das dabei Geschriebene beim naechsten Update verloren '
    + 'gehen kann. Im Wizard waere er eine Einladung, ihn vorsorglich zu setzen.',
};

function documentedKeys() {
  const src = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

  return [...new Set([...src.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]))].sort();
}

function sentKeys() {
  const src = readFileSync(new URL('../tools/installer/install.html', import.meta.url), 'utf8');
  const fn = src.match(/function buildEnv\(\)\s*\{\s*return\s*\{([\s\S]*?)\n\s*\};/);
  assert.ok(fn, 'buildEnv() in install.html nicht gefunden');
  return new Set([...fn[1].matchAll(/(?:^|[\s,{])([A-Z][A-Z0-9_]*)\s*:/g)].map(m => m[1]));
}

test('jede in .env.example dokumentierte Variable ist im Installer oder bewusst ausgenommen', () => {
  const schema = new Set(ENV_SCHEMA.map(e => e.key));
  const undecided = documentedKeys().filter(
    key => !schema.has(key) && !(key in INTENTIONALLY_NOT_IN_INSTALLER)
  );
  assert.deepEqual(undecided, [],
    'Diese Variablen stehen in .env.example, aber weder im ENV_SCHEMA noch in '
    + 'INTENTIONALLY_NOT_IN_INSTALLER. Entscheide bewusst: ins Schema aufnehmen '
    + `oder mit Begründung ausnehmen. Offen: ${undecided.join(', ')}`);
});

test('die Ausnahmekarte enthält keine Karteileichen und jede Ausnahme trägt eine Begründung', () => {


  const documented = new Set(documentedKeys());
  const schema = new Set(ENV_SCHEMA.map(e => e.key));
  for (const [key, reason] of Object.entries(INTENTIONALLY_NOT_IN_INSTALLER)) {
    assert.ok(documented.has(key), `${key} ist ausgenommen, steht aber nicht (mehr) in .env.example`);
    assert.ok(!schema.has(key), `${key} ist ausgenommen und steht trotzdem im ENV_SCHEMA`);
    assert.ok(typeof reason === 'string' && reason.length > 15, `${key} braucht eine echte Begründung`);
  }
});

// ── Regel-Guard: ENV_SCHEMA ⇄ Portainer-Compose ─────────────────────────────
//




// einzige Passwort-Reset-Mail rausgeht.
//





const NOT_IN_PORTAINER = {
  DATA_DIR:
    'Host-Pfad für einen Bind-Mount. Portainer nutzt das benannte Volume oikos_data '
    + '(Legacy-Slug, damit bestehende Stacks an Ort und Stelle aktualisieren statt ihre '
    + 'Daten zu verwaisen). Als Env durchgereicht wäre der Wert wirkungslos und irreführend.',
  OIKOS_HTTP_PORT:
    'Host-Port, keine App-Variable: die App im Container hört immer auf 3000. '
    + 'Steht deshalb im ports-Mapping (${OIKOS_HTTP_PORT:-3000}:3000), nicht unter environment.',
  DOCUMENT_STORAGE_LOCAL_DIR:
    'Host-Ordner des optionalen Dokument-Mounts. Steht im volumes-Block als Bind-Quelle '
    + '(dort auskommentiert), nicht unter environment - die App liest den Container-Pfad '
    + 'DOCUMENT_STORAGE_LOCAL_PATH.',
};

function portainerSource() {
  return readFileSync(new URL('../docs/docker-compose.portainer.yml', import.meta.url), 'utf8');
}

test('jeder Schema-Key erreicht die Portainer-Compose oder ist begründet ausgenommen', () => {
  const src = portainerSource();
  const missing = ENV_SCHEMA
    .map(e => e.key)
    .filter(key => !new RegExp(`^\\s+- "?${key}=`, 'm').test(src) && !(key in NOT_IN_PORTAINER));
  assert.deepEqual(missing, [],
    'Diese Schema-Keys kommen bei einem Portainer-Deployment nie an. Entweder unter '
    + `environment aufnehmen oder mit Begründung in NOT_IN_PORTAINER: ${missing.join(', ')}`);
});

test('die Portainer-Ausnahmekarte trägt keine Karteileichen', () => {
  const schema = new Set(ENV_SCHEMA.map(e => e.key));
  const src = portainerSource();
  for (const [key, reason] of Object.entries(NOT_IN_PORTAINER)) {
    assert.ok(schema.has(key), `${key} ist ausgenommen, steht aber nicht (mehr) im ENV_SCHEMA`);
    assert.ok(typeof reason === 'string' && reason.length > 40, `${key} braucht eine echte Begründung`);
    assert.doesNotMatch(src, new RegExp(`^\\s+- "?${key}=`, 'm'),
      `${key} ist als Ausnahme geführt und steht trotzdem unter environment`);
  }


  assert.match(src, /\$\{OIKOS_HTTP_PORT:-3000\}:3000/,
    'OIKOS_HTTP_PORT ist als "steht im ports-Mapping" ausgenommen, fehlt dort aber');
  assert.match(src, /\$\{DOCUMENT_STORAGE_LOCAL_DIR:-/,
    'DOCUMENT_STORAGE_LOCAL_DIR ist als "steht im volumes-Block" ausgenommen, fehlt dort aber');
});

test('BASE_URL steht in jedem Deploy-Ziel, das Variablen von Hand aufzählt', () => {



  assert.match(portainerSource(), /^\s+- BASE_URL=\$\{BASE_URL:-\}/m,
    'Portainer-Compose reicht BASE_URL nicht durch');
  const unraid = readFileSync(new URL('../templates/aashiyana.xml', import.meta.url), 'utf8');
  assert.match(unraid, /Target="BASE_URL"/, 'Unraid deklariert BASE_URL nicht');
});

test('jeder Schema-Key ist in .env.example dokumentiert', () => {


  const documented = new Set(documentedKeys());
  const undocumented = ENV_SCHEMA.map(e => e.key).filter(key => !documented.has(key));
  assert.deepEqual(undocumented, [], `Nicht in .env.example dokumentiert: ${undocumented.join(', ')}`);
});

test('jeder Schema-Key landet auch im gesendeten env-Objekt', () => {


  const sent = sentKeys();
  const missing = ENV_SCHEMA.filter(e => e.writeToEnv).map(e => e.key).filter(key => !sent.has(key));
  assert.deepEqual(missing, [],
    `Im ENV_SCHEMA, aber von install.html nie gesendet: ${missing.join(', ')}`);
});

test('das gesendete env-Objekt erfindet keine Keys ausserhalb des Schemas', () => {
  const schema = new Set(ENV_SCHEMA.map(e => e.key));
  const extra = [...sentKeys()].filter(key => !schema.has(key));
  assert.deepEqual(extra, [],
    `install.html sendet Keys ohne Schema-Eintrag (sanitizeEnv wirft sie weg): ${extra.join(', ')}`);
});

test('ENV_SCHEMA enthält alle Original-Keys, TZ, OIKOS_HTTP_PORT, P5, Subscriptions und Dokument-WebDAV', () => {
  assert.equal(ENV_SCHEMA.length, TOTAL_KEYS);
  const keys = ENV_SCHEMA.map(e => e.key);
  for (const k of ORIGINAL_KEYS) {
    assert.ok(keys.includes(k), `Key fehlt: ${k}`);
  }
  for (const k of UPLOAD_KEYS) {
    assert.ok(keys.includes(k), `Key fehlt: ${k}`);
  }
  for (const k of GOOGLE_DRIVE_KEYS) {
    assert.ok(keys.includes(k), `Google-Drive-Key fehlt: ${k}`);
  }
  for (const k of OUTLOOK_KEYS) {
    assert.ok(keys.includes(k), `Outlook-Key fehlt: ${k}`);
  }
  assert.ok(keys.includes('TZ'), 'Key fehlt: TZ');
  assert.ok(keys.includes('OIKOS_HTTP_PORT'), 'Key fehlt: OIKOS_HTTP_PORT');
  for (const k of P5_KEYS) {
    assert.ok(keys.includes(k), `P5-Key fehlt: ${k}`);
  }
  for (const k of SUBSCRIPTION_KEYS) {
    assert.ok(keys.includes(k), `Subscription-Key fehlt: ${k}`);
  }
  for (const k of DOCUMENT_STORAGE_KEYS) {
    assert.ok(keys.includes(k), `Dokument-WebDAV-Key fehlt: ${k}`);
  }
  for (const k of DOCUMENT_STORAGE_LOCAL_KEYS) {
    assert.ok(keys.includes(k), `Dokument-Local-Key fehlt: ${k}`);
  }
  for (const k of [...EMAIL_KEYS, ...WEBDAV_BACKUP_KEYS, ...WIZARD_EXTRA_KEYS]) {
    assert.ok(keys.includes(k), `Wizard-Ausbau-Key fehlt: ${k}`);
  }
});

test('E-Mail/SMTP-Keys sind optional, das Passwort ist ein Secret', () => {
  for (const key of EMAIL_KEYS) {
    const entry = ENV_SCHEMA.find(e => e.key === key);
    assert.ok(entry, `${key} nicht in ENV_SCHEMA`);
    assert.equal(entry.writeToEnv, true, `${key}.writeToEnv ist nicht true`);
    assert.equal(entry.group, 'email', `${key} muss group 'email' haben`);
  }
  const pass = ENV_SCHEMA.find(e => e.key === 'EMAIL_SMTP_PASS');
  assert.equal(pass.secret, true, 'EMAIL_SMTP_PASS muss als Secret markiert sein');
  const secure = ENV_SCHEMA.find(e => e.key === 'EMAIL_SMTP_SECURE');
  assert.equal(secure.default, 'starttls', 'EMAIL_SMTP_SECURE-Default muss starttls sein');
});

test('WebDAV-Backup-Keys sind optional, standardmäßig deaktiviert, Passwort maskiert', () => {
  for (const key of WEBDAV_BACKUP_KEYS) {
    const entry = ENV_SCHEMA.find(e => e.key === key);
    assert.ok(entry, `${key} nicht in ENV_SCHEMA`);
    assert.equal(entry.writeToEnv, true, `${key}.writeToEnv ist nicht true`);
    assert.equal(entry.group, 'backup', `${key} muss group 'backup' haben`);
  }
  const enabled = ENV_SCHEMA.find(e => e.key === 'WEBDAV_BACKUP_ENABLED');
  assert.equal(enabled.default, 'false');
  const pass = ENV_SCHEMA.find(e => e.key === 'WEBDAV_BACKUP_PASSWORD');
  assert.equal(pass.secret, true, 'WEBDAV_BACKUP_PASSWORD muss als Secret markiert sein');
});

test('BASE_URL und VAPID_SUBJECT sind schreibbar mit leerem Default', () => {
  for (const key of WIZARD_EXTRA_KEYS) {
    const entry = ENV_SCHEMA.find(e => e.key === key);
    assert.ok(entry, `${key} nicht in ENV_SCHEMA`);
    assert.equal(entry.writeToEnv, true, `${key}.writeToEnv ist nicht true`);
    assert.equal(entry.default, '', `${key}-Default muss leer sein`);
  }
});

test('Lokaler Dokumentspeicher ist optional, standardmäßig deaktiviert und hat den Pfad-Default /documents', () => {
  for (const key of DOCUMENT_STORAGE_LOCAL_KEYS) {
    const entry = ENV_SCHEMA.find(e => e.key === key);
    assert.ok(entry, `${key} nicht in ENV_SCHEMA`);
    assert.equal(entry.required, false, `${key} muss optional sein`);
    assert.equal(entry.type, 'default', `${key} muss type 'default' haben`);
    assert.equal(entry.writeToEnv, true, `${key}.writeToEnv ist nicht true`);
  }
  const enabled = ENV_SCHEMA.find(e => e.key === 'DOCUMENT_STORAGE_LOCAL_ENABLED');
  assert.equal(enabled.default, 'false');
  const path = ENV_SCHEMA.find(e => e.key === 'DOCUMENT_STORAGE_LOCAL_PATH');
  assert.equal(path.default, '/documents');
});

test('Web-Installer zeigt, sammelt und sendet die lokalen Dokumentspeicher-Werte', () => {
  const src = readFileSync(new URL('../tools/installer/install.html', import.meta.url), 'utf8');
  for (const id of ['adv-document-local-enable', 'adv-document-local-path']) {
    assert.match(src, new RegExp(`id="${id}"`), `Web-Installer-Feld fehlt: ${id}`);
  }
  for (const key of DOCUMENT_STORAGE_LOCAL_KEYS) {
    assert.match(src, new RegExp(`${key}:\\s*S\\.${key}`), `Web-Installer sendet ${key} nicht`);
    assert.match(src, new RegExp(`${key}:\\s*''`), `Web-Installer-State fehlt ${key}`);
  }
});

test('CLI-Installer sammelt und schreibt die lokalen Dokumentspeicher-Werte', () => {
  const src = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  for (const key of DOCUMENT_STORAGE_LOCAL_KEYS) {
    assert.match(src, new RegExp(`^${key}=`, 'm'), `CLI-Installer schreibt ${key} nicht in .env`);
  }
});

test('.env.example dokumentiert die lokalen Dokumentspeicher-Werte', () => {
  const src = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  for (const key of DOCUMENT_STORAGE_LOCAL_KEYS) {
    assert.match(src, new RegExp(`^#?\\s*${key}=`, 'm'), `.env.example fehlt ${key}`);
  }
});

test('Unraid deklariert die lokalen Dokumentspeicher-Werte advanced und optional', () => {
  const src = readFileSync(new URL('../templates/aashiyana.xml', import.meta.url), 'utf8');
  for (const key of DOCUMENT_STORAGE_LOCAL_KEYS) {
    const config = src.match(new RegExp(`<Config[^>]+Target="${key}"[^>]*>`));
    assert.ok(config, `Unraid fehlt ${key}`);
    assert.match(config[0], /Display="advanced"/, `${key} muss advanced sein`);
    assert.match(config[0], /Required="false"/, `${key} muss optional sein`);
  }
});

test('Portainer Compose reicht die lokalen Dokumentspeicher-Werte durch', () => {
  const src = readFileSync(new URL('../docs/docker-compose.portainer.yml', import.meta.url), 'utf8');
  for (const key of DOCUMENT_STORAGE_LOCAL_KEYS) {
    assert.match(
      src,
      new RegExp(`- ${key}=\\$\\{${key}:-`),
      `Portainer Compose fehlt ${key}`
    );
  }
});

test('Lokale Dokumentspeicher-Werte erzeugen keine TrueNAS- oder Umbrel-Fragen', () => {
  for (const path of [
    '../deploy/truenas/questions.yaml',
    '../deploy/truenas/templates/docker-compose.yaml',
    '../deploy/umbrel/docker-compose.yml',
    '../deploy/umbrel/umbrel-app.yml',
  ]) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    for (const key of DOCUMENT_STORAGE_LOCAL_KEYS) {
      assert.doesNotMatch(src, new RegExp(key), `${path} darf ${key} nicht explizit deklarieren`);
    }
  }
});

test('Jedes Container-Deployment schreibt Backups nach /backups (issue #579)', () => {




  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(
    dockerfile,
    /^ENV BACKUP_DIR=\/backups$/m,
    'Dockerfile muss BACKUP_DIR=/backups als Image-Default setzen'
  );

  for (const path of [
    '../docker-compose.yml',
    '../podman-compose.yml',
    '../docs/docker-compose.portainer.yml',
    '../deploy/umbrel/docker-compose.yml',
  ]) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(src, /:\/backups(:Z)?$/m, `${path} mountet kein /backups`);
    assert.match(src, /- BACKUP_DIR=\/backups$/m, `${path} setzt BACKUP_DIR nicht auf /backups`);
  }

  const truenas = readFileSync(
    new URL('../deploy/truenas/templates/docker-compose.yaml', import.meta.url),
    'utf8'
  );
  assert.match(truenas, /add_env\("BACKUP_DIR", "\/backups"\)/, 'TrueNAS setzt BACKUP_DIR nicht');

  const quadlet = readFileSync(new URL('../tools/quadlet/oikos.container', import.meta.url), 'utf8');
  assert.match(quadlet, /^Environment=BACKUP_DIR=\/backups$/m, 'Quadlet setzt BACKUP_DIR nicht');

  const unraid = readFileSync(new URL('../templates/aashiyana.xml', import.meta.url), 'utf8');
  const backupVar = unraid.match(/<Config[^>]+Target="BACKUP_DIR"[^>]*>[^<]*/);
  assert.ok(backupVar, 'Unraid deklariert BACKUP_DIR nicht');
  assert.match(backupVar[0], /Default="\/backups"/, 'Unraid BACKUP_DIR muss /backups defaulten');
  assert.match(unraid, /Target="\/backups"[^>]+Type="Path"/, 'Unraid mountet kein /backups');
});

test('TZ und OIKOS_HTTP_PORT haben writeToEnv: true', () => {
  for (const key of ['TZ', 'OIKOS_HTTP_PORT']) {
    const entry = ENV_SCHEMA.find(e => e.key === key);
    assert.ok(entry, `${key} nicht in ENV_SCHEMA`);
    assert.equal(entry.writeToEnv, true, `${key}.writeToEnv ist nicht true`);
  }
});

test('Dokument-WebDAV ist optional, standardmäßig deaktiviert und maskiert das Passwort', () => {
  for (const key of DOCUMENT_STORAGE_KEYS) {
    const entry = ENV_SCHEMA.find(e => e.key === key);
    assert.ok(entry, `${key} nicht in ENV_SCHEMA`);
    assert.equal(entry.required, false, `${key} muss optional sein`);
    assert.equal(entry.writeToEnv, true, `${key}.writeToEnv ist nicht true`);
  }

  const enabled = ENV_SCHEMA.find(e => e.key === 'DOCUMENT_STORAGE_WEBDAV_ENABLED');
  assert.equal(enabled.type, 'default');
  assert.equal(enabled.default, 'false');

  const password = ENV_SCHEMA.find(e => e.key === 'DOCUMENT_STORAGE_WEBDAV_PASSWORD');
  assert.equal(password.secret, true, 'WebDAV-Passwort muss als Secret markiert sein');
});

test('Google Drive OAuth installer wiring is optional, masked, validated and deployed consistently', () => {
  for (const key of GOOGLE_DRIVE_KEYS) {
    const entry = ENV_SCHEMA.find((item) => item.key === key);
    assert.ok(entry, `${key} missing from ENV_SCHEMA`);
    assert.equal(entry.required, false);
    assert.equal(entry.writeToEnv, true);
    assert.equal(entry.group, 'googleDrive');
  }
  assert.equal(
    ENV_SCHEMA.find((item) => item.key === 'GOOGLE_DRIVE_CLIENT_SECRET').secret,
    true
  );

  const web = readFileSync(new URL('../tools/installer/install.html', import.meta.url), 'utf8');
  for (const id of [
    'adv-document-google-drive-enable',
    'adv-document-google-drive-client-id',
    'adv-document-google-drive-client-secret',
    'document-google-drive-redirect-hint',
    'rv-document-google-drive',
  ]) assert.match(web, new RegExp(`id="${id}"`), `web installer missing ${id}`);
  for (const key of GOOGLE_DRIVE_KEYS) {
    assert.match(web, new RegExp(`${key}:\\s*S\\.${key}`));
    assert.match(web, new RegExp(`${key}:\\s*''`));
  }
  assert.match(web, /errDocumentGoogleDrivePair/);
  assert.match(web, /errDocumentGoogleDriveCredentials/);
  assert.match(web, /\/api\/v1\/documents\/storage\/google-drive\/callback/);

  const cli = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  for (const key of GOOGLE_DRIVE_KEYS) assert.match(cli, new RegExp(`^${key}=`, 'm'));
  assert.match(cli, /read -rs GOOGLE_DRIVE_CLIENT_SECRET/);
  assert.match(cli, /document_google_drive\.err_pair/);

  const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const portainer = readFileSync(new URL('../docs/docker-compose.portainer.yml', import.meta.url), 'utf8');
  const unraid = readFileSync(new URL('../templates/aashiyana.xml', import.meta.url), 'utf8');
  for (const key of GOOGLE_DRIVE_KEYS) {
    assert.match(envExample, new RegExp(`^${key}=`, 'm'));
    assert.match(portainer, new RegExp(`- ${key}=\\$\\{${key}:-`));
    assert.match(unraid, new RegExp(`Target="${key}"`));
  }
  assert.match(
    unraid.match(/<Config[^>]+Target="GOOGLE_DRIVE_CLIENT_SECRET"[^>]*>/)[0],
    /Mask="true"/
  );
  for (const deployment of [
    '../deploy/truenas/questions.yaml',
    '../deploy/truenas/templates/docker-compose.yaml',
    '../deploy/umbrel/docker-compose.yml',
    '../deploy/umbrel/umbrel-app.yml',
  ]) {
    const source = readFileSync(new URL(deployment, import.meta.url), 'utf8');
    for (const key of GOOGLE_DRIVE_KEYS) assert.doesNotMatch(source, new RegExp(key));
  }
});

test('Outlook-Push (Microsoft Graph) installer wiring is optional, masked and deployed consistently', () => {
  for (const key of OUTLOOK_KEYS) {
    const entry = ENV_SCHEMA.find((item) => item.key === key);
    assert.ok(entry, `${key} missing from ENV_SCHEMA`);
    assert.equal(entry.type, 'user');
    assert.equal(entry.required, false);
    assert.equal(entry.writeToEnv, true);
    assert.equal(entry.group, 'outlook');
  }
  assert.equal(
    ENV_SCHEMA.find((item) => item.key === 'MS_CLIENT_SECRET').secret,
    true
  );

  const web = readFileSync(new URL('../tools/installer/install.html', import.meta.url), 'utf8');
  for (const id of [
    'outlook-id',
    'outlook-secret',
    'outlook-redirect-hint',
    'rv-outlook',
  ]) assert.match(web, new RegExp(`id="${id}"`), `web installer missing ${id}`);
  assert.match(
    web,
    /id="outlook-secret"[^>]*type="password"|type="password"[^>]*id="outlook-secret"/,
    'the client secret field must be masked'
  );
  for (const key of OUTLOOK_KEYS) {
    assert.match(web, new RegExp(`${key}:\\s*S\\.${key}`));
    assert.match(web, new RegExp(`${key}:\\s*''`));
  }
  assert.match(web, /\/api\/v1\/calendar\/outlook\/callback/);

  const cli = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  for (const key of OUTLOOK_KEYS) assert.match(cli, new RegExp(`^${key}=`, 'm'));
  assert.match(cli, /read -rs MS_CLIENT_SECRET/);

  const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const portainer = readFileSync(new URL('../docs/docker-compose.portainer.yml', import.meta.url), 'utf8');
  const unraid = readFileSync(new URL('../templates/aashiyana.xml', import.meta.url), 'utf8');
  for (const key of OUTLOOK_KEYS) {
    assert.match(envExample, new RegExp(`^${key}=`, 'm'));
    assert.match(portainer, new RegExp(`- ${key}=\\$\\{${key}:-`));
    assert.match(unraid, new RegExp(`Target="${key}"`));
  }
  assert.match(
    unraid.match(/<Config[^>]+Target="MS_CLIENT_SECRET"[^>]*>/)[0],
    /Mask="true"/
  );
  for (const deployment of [
    '../deploy/truenas/questions.yaml',
    '../deploy/truenas/templates/docker-compose.yaml',
    '../deploy/umbrel/docker-compose.yml',
    '../deploy/umbrel/umbrel-app.yml',
  ]) {
    const source = readFileSync(new URL(deployment, import.meta.url), 'utf8');
    for (const key of OUTLOOK_KEYS) assert.doesNotMatch(source, new RegExp(key));
  }
});

test('Unraid deklariert alle Web-Push-Variablen advanced und maskiert den privaten Schluessel', () => {



  const unraid = readFileSync(new URL('../templates/aashiyana.xml', import.meta.url), 'utf8');
  const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

  for (const key of ['VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) {
    const entry = unraid.match(new RegExp(`<Config[^>]+Target="${key}"[^>]*>`));
    assert.ok(entry, `${key} fehlt in templates/aashiyana.xml`);
    assert.match(entry[0], /Display="advanced"/, `${key} sollte advanced sein`);
    assert.match(entry[0], /Required="false"/, `${key} ist optional`);
    assert.match(envExample, new RegExp(`^# ?${key}=`, 'm'), `${key} fehlt in .env.example`);
  }

  assert.match(
    unraid.match(/<Config[^>]+Target="VAPID_PRIVATE_KEY"[^>]*>/)[0],
    /Mask="true"/,
    'der private VAPID-Schluessel muss maskiert sein'
  );
  assert.match(
    unraid.match(/<Config[^>]+Target="VAPID_SUBJECT"[^>]*>/)[0],
    /BadJwtToken/,
    'die Apple-Falle gehoert in die Beschreibung, sonst setzt sie niemand'
  );
});

test('FIXER_API_KEY ist optional und als Secret markiert', () => {
  const fixer = ENV_SCHEMA.find(e => e.key === 'FIXER_API_KEY');
  assert.ok(fixer, 'FIXER_API_KEY nicht in ENV_SCHEMA');
  assert.equal(fixer.required, false);
  assert.equal(fixer.writeToEnv, true);
  assert.equal(fixer.secret, true);
});

test('Alle Schema-Einträge haben die Pflichtfelder key, type, label, group, writeToEnv', () => {
  for (const entry of ENV_SCHEMA) {
    assert.ok(typeof entry.key === 'string' && entry.key, `key fehlt oder leer`);
    assert.ok(typeof entry.type === 'string' && entry.type, `type fehlt für ${entry.key}`);
    assert.ok(typeof entry.label === 'string' && entry.label, `label fehlt für ${entry.key}`);
    assert.ok(typeof entry.group === 'string' && entry.group, `group fehlt für ${entry.key}`);
    assert.equal(entry.writeToEnv, true, `writeToEnv !== true für ${entry.key}`);
  }
});

test('Schema-Datei enthält genau so viele key-Felder wie Schema-Einträge (grep-Parität)', () => {
  const src = readFileSync(new URL('../tools/installer/env-schema.js', import.meta.url), 'utf8');
  const matches = src.match(/\bkey:/g);
  assert.equal(matches?.length ?? 0, TOTAL_KEYS, `Anzahl "key:"-Vorkommen in env-schema.js stimmt nicht mit ${TOTAL_KEYS} überein`);
});

test('/api/defaults-Route in install-server.js liefert ENV_SCHEMA (Snapshot)', () => {
  const src = readFileSync(new URL('../tools/installer/install-server.js', import.meta.url), 'utf8');
  assert.ok(src.includes("import { ENV_SCHEMA }"), 'install-server.js importiert ENV_SCHEMA nicht');
  assert.ok(src.includes('catalog: ENV_SCHEMA'), '/api/defaults gibt ENV_SCHEMA nicht unter dem Schlüssel "catalog" zurück');
});

// ── Phase 1: Zeitzone und Port wirken ───────────────────────────────────────

test('install.html nimmt TZ und OIKOS_HTTP_PORT ins gesendete env-Objekt auf', () => {
  const src = readFileSync(new URL('../tools/installer/install.html', import.meta.url), 'utf8');
  assert.match(src, /TZ:\s*S\.tz/, 'install.html sendet TZ nicht im env-Objekt');
  assert.match(src, /OIKOS_HTTP_PORT:\s*S\.port/, 'install.html sendet OIKOS_HTTP_PORT nicht im env-Objekt');
});

test('Web-Installer zeigt, sammelt und sendet alle Dokument-WebDAV-Werte', () => {
  const src = readFileSync(new URL('../tools/installer/install.html', import.meta.url), 'utf8');
  for (const id of [
    'adv-document-webdav-enable',
    'adv-document-webdav-url',
    'adv-document-webdav-username',
    'adv-document-webdav-password',
    'adv-document-webdav-path',
  ]) {
    assert.match(src, new RegExp(`id="${id}"`), `Web-Installer-Feld fehlt: ${id}`);
  }
  assert.match(
    src,
    /id="adv-document-webdav-password"[^>]*type="password"|type="password"[^>]*id="adv-document-webdav-password"/,
    'WebDAV-Passwortfeld muss maskiert sein'
  );
  for (const key of DOCUMENT_STORAGE_KEYS) {
    assert.match(src, new RegExp(`${key}:\\s*S\\.${key}`), `Web-Installer sendet ${key} nicht`);
    assert.match(src, new RegExp(`${key}:\\s*''`), `Web-Installer-State fehlt ${key}`);
  }
});

test('CLI-Installer sammelt und schreibt alle Dokument-WebDAV-Werte', () => {
  const src = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  assert.match(src, /configure_document_storage\b/, 'CLI-Installer konfiguriert Dokument-WebDAV nicht');
  for (const key of DOCUMENT_STORAGE_KEYS) {
    assert.match(src, new RegExp(`^${key}=`, 'm'), `CLI-Installer schreibt ${key} nicht in .env`);
  }
  assert.match(
    src,
    /read -rs DOCUMENT_STORAGE_WEBDAV_PASSWORD/,
    'CLI-Installer muss das WebDAV-Passwort verdeckt einlesen'
  );
});

test('docker-compose.yml mappt den Host-Port über OIKOS_HTTP_PORT mit Default 3000', () => {
  const src = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(
    src,
    /\$\{OIKOS_HTTP_PORT:-3000\}:3000/,
    'Port-Mapping nutzt OIKOS_HTTP_PORT nicht mit Default :-3000 (Container-Port muss 3000 bleiben)'
  );
  assert.doesNotMatch(
    src,
    /^\s*-\s*"0\.0\.0\.0:3000:3000"/m,
    'Hartkodiertes Port-Mapping 3000:3000 darf nicht mehr vorhanden sein'
  );
});

test('install.sh schreibt TZ und OIKOS_HTTP_PORT in die generierte .env', () => {
  const src = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  assert.match(src, /^TZ=\$\{YUVOMI_TZ\}/m, 'install.sh schreibt TZ=${YUVOMI_TZ} nicht in den .env-Block');
  assert.match(src, /^OIKOS_HTTP_PORT=\$\{YUVOMI_PORT\}/m, 'install.sh schreibt OIKOS_HTTP_PORT=${YUVOMI_PORT} nicht in den .env-Block');
});

test('.env.example dokumentiert OIKOS_HTTP_PORT', () => {
  const src = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(src, /OIKOS_HTTP_PORT/, '.env.example dokumentiert OIKOS_HTTP_PORT nicht');
});

test('.env.example dokumentiert alle optionalen Dokument-WebDAV-Werte', () => {
  const src = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  for (const key of DOCUMENT_STORAGE_KEYS) {
    assert.match(src, new RegExp(`^#?\\s*${key}=`, 'm'), `.env.example fehlt ${key}`);
  }
});

test('Unraid deklariert alle Dokument-WebDAV-Werte advanced und maskiert das Passwort', () => {
  const src = readFileSync(new URL('../templates/aashiyana.xml', import.meta.url), 'utf8');
  for (const key of DOCUMENT_STORAGE_KEYS) {
    const config = src.match(new RegExp(`<Config[^>]+Target="${key}"[^>]*>`));
    assert.ok(config, `Unraid fehlt ${key}`);
    assert.match(config[0], /Display="advanced"/, `${key} muss advanced sein`);
    assert.match(config[0], /Required="false"/, `${key} muss optional sein`);
  }
  const password = src.match(/<Config[^>]+Target="DOCUMENT_STORAGE_WEBDAV_PASSWORD"[^>]*>/);
  assert.match(password[0], /Mask="true"/, 'Unraid muss WebDAV-Passwort maskieren');
});

test('Portainer Compose reicht alle explizit aufgezählten Dokument-WebDAV-Werte durch', () => {
  const src = readFileSync(new URL('../docs/docker-compose.portainer.yml', import.meta.url), 'utf8');
  for (const key of DOCUMENT_STORAGE_KEYS) {
    assert.match(
      src,
      new RegExp(`- ${key}=\\$\\{${key}:-`),
      `Portainer Compose fehlt ${key}`
    );
  }
});

test('Optionale Dokument-WebDAV-Werte erzeugen keine TrueNAS- oder Umbrel-Fragen', () => {
  for (const path of [
    '../deploy/truenas/questions.yaml',
    '../deploy/truenas/templates/docker-compose.yaml',
    '../deploy/umbrel/docker-compose.yml',
    '../deploy/umbrel/umbrel-app.yml',
  ]) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    for (const key of DOCUMENT_STORAGE_KEYS) {
      assert.doesNotMatch(src, new RegExp(key), `${path} darf ${key} nicht explizit deklarieren`);
    }
  }
});

// ── Regel-Guard: kein Deploy-Default sperrt ein UI-Feld ──────────────────────
//


// Settings > Administration gesperrt. Die Sperre gilt pro Feld.
//






//




function serviceFiles(dir = '../server/services/') {
  const out = [];
  for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...serviceFiles(`${dir}${entry.name}/`));
    else if (entry.name.endsWith('.js')) out.push(`${dir}${entry.name}`);
  }
  return out;
}

function uiLockingEnvKeys() {
  const SHAPES = [
    /env:\s*'([A-Z][A-Z0-9_]{2,})'/g,                                    // CONFIG_KEYS (email.js)
    /^const ENV_[A-Z0-9_]*\s*=\s*process\.env\.([A-Z][A-Z0-9_]{2,})/gm,  // const ENV_URL (backup-webdav.js)
    /:\s*'([A-Z][A-Z0-9_]{2,})'/g,                                       // ENV_FIELDS (document-storage.js)
  ];
  const keys = new Set();
  let services = 0;

  for (const file of serviceFiles()) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    if (!/envControlled/.test(src)) continue;
    services += 1;
    const own = new Set();
    for (const shape of SHAPES) for (const m of src.matchAll(shape)) own.add(m[1]);


    // still weniger zu pruefen.
    assert.ok(own.size > 0,
      `${file.replace(/^\.\.\//, '')} sagt eine UI-Sperre zu (envControlled), aber keine der drei `
      + 'bekannten Schreibweisen liefert einen env-Namen. Die Ableitung gehoert erweitert.');
    for (const key of own) keys.add(key);
  }

  assert.ok(services >= 3,
    `Nur ${services} Services mit envControlled gefunden (gemessen: email, backup-webdav, `
    + 'document-storage). Die Ableitung greift nicht mehr.');
  assert.ok(keys.size >= 15,
    `Nur ${keys.size} sperrende Schluessel abgeleitet (gemessen: 18).`);
  return [...keys];
}

function envDescriptors(dir = '../') {
  const out = [];
  for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {






    // sie liest, urteilt bei jedem anders.
    const versionedDotFile = entry.isFile() && entry.name === '.env.example';
    if (!versionedDotFile && (entry.name.startsWith('.') || entry.name === 'node_modules')) continue;
    const next = `${dir}${entry.name}`;
    if (entry.isDirectory()) out.push(...envDescriptors(`${next}/`));
    else if (/\.(ya?ml|container)$/.test(entry.name) || versionedDotFile) out.push(next);
  }
  return out;
}

test('kein Deploy-Descriptor gibt einem UI-sperrenden Schlüssel einen nicht-leeren Default', () => {
  const keys = uiLockingEnvKeys();
  const files = envDescriptors();
  const offenders = [];


  assert.ok(files.length >= 5,
    `Nur ${files.length} Descriptor-Dateien gefunden - der Suchlauf greift nicht mehr.`);

  for (const file of files) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const key of keys) {

      for (const m of src.matchAll(new RegExp(`\\$\\{${key}:-([^}]*)\\}`, 'g'))) {
        if (m[1].trim() === '') continue;
        offenders.push(`${file.replace(/^\.\.\//, '')}: ${key} defaultet auf "${m[1]}"`);
      }
    }
  }

  assert.deepEqual(offenders.sort(), [],
    'Diese Defaults setzen eine env-Variable, die ein UI-Feld sperrt - der Nutzer kann das '
    + `Feld danach in den Einstellungen nicht mehr ändern:\n${offenders.join('\n')}`);
});

test('der Dokument-Mount zielt auf DOCUMENT_STORAGE_LOCAL_PATH, nie auf einen festen Pfad', () => {







  const offenders = [];
  for (const path of ['docker-compose.yml', 'podman-compose.yml', 'docs/docker-compose.portainer.yml']) {
    const src = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    for (const [line] of src.matchAll(/^.*\$\{DOCUMENT_STORAGE_LOCAL_DIR[^\n]*$/gm)) {
      if (!/:\$\{DOCUMENT_STORAGE_LOCAL_PATH:-\/documents\}/.test(line)) {
        offenders.push(`${path}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'Der Host-Ordner wird auf ein festes Ziel gemountet, während die App den konfigurierten '
    + `Pfad benutzt:\n${offenders.join('\n')}`);
});

// ── Regel-Guard: gelesene Env-Variable ⇄ .env.example ───────────────────────
//







// Platzhalter darin.
//


// Karte unten.
//







const INTENTIONALLY_UNDOCUMENTED = {
  APP_BUILD_REVISION:
    'Internal build revision injected by deployment infrastructure; not an installer or household setting.',
  OIKOS_INSTALLER_ROOT:
    'Interner Pfad des Installer-Prozesses (tools/installer/install-server.js), kein '
    + 'Deployment-Wert. Er beschreibt, wo der Installer selbst liegt, waehrend .env.example '
    + 'die Variablen der fertigen Installation dokumentiert - dort waere er eine Zeile, die '
    + 'niemand setzen darf.',
};

function literalEnvReads() {
  const roots = ['server', 'tools'];
  const found = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
      const hits = [
        ...src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g),
        ...src.matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g),
      ];
      for (const m of hits) if (!found.has(m[1])) found.set(m[1], rel);
    }
  };
  for (const root of roots) walk(root);
  return found;
}

test('jede zur Laufzeit gelesene Env-Variable ist in .env.example dokumentiert', () => {
  const documented = new Set(documentedKeys());
  const undocumented = [...literalEnvReads()]
    .filter(([key]) => !documented.has(key) && !(key in INTENTIONALLY_UNDOCUMENTED))
    .map(([key, file]) => `${key} (${file})`)
    .sort();
  assert.deepEqual(undocumented, [],
    'Diese Variablen werden gelesen, stehen aber nicht in .env.example. Damit sind sie auch '
    + 'fuer die beiden Guards darueber unsichtbar. Dokumentiere sie in .env.example (und '
    + 'entscheide dort, ob sie zusaetzlich ins ENV_SCHEMA gehoeren) oder nimm sie mit '
    + `Begruendung in INTENTIONALLY_UNDOCUMENTED auf. Offen:\n${undocumented.join('\n')}`);
});

test('die Karte der undokumentierten Variablen enthaelt keine Karteileichen', () => {


  const read = literalEnvReads();
  const documented = new Set(documentedKeys());
  for (const [key, reason] of Object.entries(INTENTIONALLY_UNDOCUMENTED)) {
    assert.ok(read.has(key), `${key} ist ausgenommen, wird aber nirgends (mehr) gelesen`);
    assert.ok(!documented.has(key),
      `${key} ist als undokumentiert ausgenommen, steht aber in .env.example`);
    assert.ok(typeof reason === 'string' && reason.length > 15, `${key} braucht eine echte Begruendung`);
  }
});

test('der Scanner findet ueberhaupt etwas', () => {


  const read = literalEnvReads();
  assert.ok(read.size > 40,
    `Nur ${read.size} Env-Lesestellen gefunden - der Verzeichnis-Walk ist vermutlich kaputt`);
  assert.ok(read.has('SESSION_SECRET'), 'SESSION_SECRET muss unter den Fundstellen sein');
});
