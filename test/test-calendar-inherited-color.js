
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aashiyana-colmig-')), 'unused.db');
const { MIGRATIONS } = await import('../server/db.js');

const NULLABLE_COLOR_VERSION  = 166;
const COLOR_MODIFIED_VERSION  = 167;

function applyMigration(db, migration) {
  if (typeof migration.up === 'function') migration.up(db);
  else db.exec(migration.up);
  migration.afterUp?.(db);
}

function applyWithMigrateSemantics(db, migration) {
  if (!migration.foreignKeysOff) return applyMigration(db, migration);
  db.pragma('foreign_keys = OFF');
  try {
    applyMigration(db, migration);
    const violations = db.pragma('foreign_key_check');
    assert.deepEqual(violations, [], 'die Migration darf keine Fremdschluessel verletzen');
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function buildDatabaseBefore(version = NULLABLE_COLOR_VERSION) {
  const db = new Database(join(mkdtempSync(join(tmpdir(), 'aashiyana-colmig-')), 'db.sqlite'));
  db.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS.filter((m) => m.version < version)) {
    applyMigration(db, migration);
  }
  return db;
}

function seed(db) {
  db.prepare("INSERT INTO users (id, username, display_name, password_hash, role) VALUES (1,'admin','Admin','x','admin')").run();
  db.prepare("INSERT INTO users (id, username, display_name, password_hash, role) VALUES (2,'maria','Maria','x','member')").run();

  const calRef = db.prepare(
    "INSERT INTO external_calendars (source, external_id, name, color) VALUES ('caldav','fam','Familie','#34A853') RETURNING id"
  ).get().id;

  const insert = db.prepare(`
    INSERT INTO calendar_events
      (title, start_datetime, end_datetime, color, external_source, external_calendar_id,
       calendar_ref_id, recurrence_rule, user_modified, icon, visibility, countdown, created_by)
    VALUES (@title, @start_datetime, @end_datetime, @color, @external_source, @external_calendar_id,
       @calendar_ref_id, @recurrence_rule, @user_modified, @icon, @visibility, @countdown, 1)
  `);

  const rows = [
    { title: 'Elternabend', start_datetime: '2026-09-01T19:00', end_datetime: '2026-09-01T21:00',
      color: '#8156C0', external_source: 'local', external_calendar_id: null, calendar_ref_id: null,
      recurrence_rule: 'FREQ=MONTHLY', user_modified: 0, icon: 'calendar', visibility: 'all', countdown: 1 },
    { title: 'Zahnarzt', start_datetime: '2026-09-05T08:30', end_datetime: '2026-09-05T09:15',
      color: '#34A853', external_source: 'caldav', external_calendar_id: 'uid-1', calendar_ref_id: calRef,
      recurrence_rule: null, user_modified: 1, icon: 'tooth', visibility: 'assignees', countdown: 0 },
    { title: 'Geburtstag Maria', start_datetime: '2026-05-04', end_datetime: null,
      color: '#007AFF', external_source: 'local', external_calendar_id: null, calendar_ref_id: null,
      recurrence_rule: 'FREQ=YEARLY', user_modified: 0, icon: 'cake', visibility: 'all', countdown: 0 },
  ];
  const ids = rows.map((r) => insert.run(r).lastInsertRowid);

  db.prepare('INSERT INTO event_assignments (event_id, user_id) VALUES (?, 2)').run(ids[0]);
  db.prepare('INSERT INTO event_assignments (event_id, user_id) VALUES (?, 1)').run(ids[0]);
  db.prepare("INSERT INTO calendar_event_exceptions (event_id, exception_date) VALUES (?, '2026-10-01')").run(ids[0]);
  db.prepare("INSERT INTO birthdays (name, birth_date, calendar_event_id, created_by) VALUES ('Maria','1990-05-04',?,1)").run(ids[2]);

  return { ids, calRef };
}

function snapshot(db) {
  return db.prepare('SELECT * FROM calendar_events ORDER BY id').all();
}

// --------------------------------------------------------
// Der Rebuild
// --------------------------------------------------------

test('Migration 166 nimmt beim Rebuild keine abhaengige Zeile mit', () => {
  const db = buildDatabaseBefore();
  const seeded = seed(db);
  const before = snapshot(db);
  assert.equal(before.length, 3);

  applyWithMigrateSemantics(db, MIGRATIONS.find((m) => m.version === NULLABLE_COLOR_VERSION));

  const after = snapshot(db);
  assert.equal(after.length, 3, 'keine Zeile darf verschwinden');
  for (const [i, row] of after.entries()) {
    for (const [key, value] of Object.entries(before[i])) {
      assert.deepEqual(row[key], value, `Feld ${key} von Termin ${row.id} hat sich geaendert`);
    }
  }




  assert.deepEqual(
    db.prepare('SELECT user_id FROM event_assignments WHERE event_id = ? ORDER BY user_id').all(seeded.ids[0]),
    [{ user_id: 1 }, { user_id: 2 }],
    'die Zuweisungen muessen den Rebuild ueberleben'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM calendar_event_exceptions WHERE event_id = ?').get(seeded.ids[0]).n,
    1,
    'die EXDATE-Ausnahme muss den Rebuild ueberleben'
  );


  assert.equal(
    db.prepare('SELECT calendar_event_id FROM birthdays WHERE name = ?').get('Maria').calendar_event_id,
    seeded.ids[2],
    'die Geburtstags-Verknuepfung muss stehen bleiben'
  );

  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'die Durchsetzung ist danach wieder an');
});

test('Migration 166 stellt Trigger und Indizes vollstaendig wieder her', () => {
  const db = buildDatabaseBefore();
  const objectsOf = () => db.prepare(
    "SELECT type, name FROM sqlite_master WHERE tbl_name='calendar_events' AND type IN ('index','trigger') ORDER BY type, name"
  ).all().filter((o) => !o.name.startsWith('sqlite_autoindex'));

  const before = objectsOf();
  applyWithMigrateSemantics(db, MIGRATIONS.find((m) => m.version === NULLABLE_COLOR_VERSION));
  assert.deepEqual(objectsOf(), before,
    'ein Rebuild nimmt Trigger und Indizes mit - jeder einzelne muss neu angelegt werden');




  assert.equal(before.filter((o) => o.type === 'trigger').length, 4,
    'vier Trigger: updated_at plus die drei des Suchindex');
});

test('Migration 166 macht color nullable, ohne einen Bestandswert anzufassen', () => {
  const db = buildDatabaseBefore();
  seed(db);
  applyWithMigrateSemantics(db, MIGRATIONS.find((m) => m.version === NULLABLE_COLOR_VERSION));

  const col = db.prepare('PRAGMA table_info(calendar_events)').all().find((c) => c.name === 'color');
  assert.equal(col.notnull, 0, 'die Spalte muss NULL annehmen');
  assert.equal(col.dflt_value, null, 'und keinen Default mehr aufdraengen');






  const farben = db.prepare('SELECT color FROM calendar_events ORDER BY id').all().map((r) => r.color);
  assert.deepEqual(farben, ['#8156C0', '#34A853', '#007AFF'],
    'die Migration darf keine bestehende Farbe loeschen, auch nicht die, die nach einem Default aussieht');


  db.prepare('UPDATE calendar_events SET color = NULL WHERE id = 1').run();
  assert.equal(db.prepare('SELECT color FROM calendar_events WHERE id = 1').get().color, null);
});

test('Migration 166 uebersteht eine DB, der die tzid-Spalte fehlt (#549)', () => {




  // Bestandsinstallationen mit "no such column: tzid".
  const db = buildDatabaseBefore();
  seed(db);




  db.pragma('foreign_keys = OFF');
  const spalten = db.prepare('PRAGMA table_info(calendar_events)').all()
    .map((c) => c.name).filter((n) => n !== 'tzid');
  const liste = spalten.join(', ');
  db.exec(`CREATE TABLE ce_ohne_tzid AS SELECT ${liste} FROM calendar_events`);
  db.exec('DROP TABLE calendar_events');
  db.exec('ALTER TABLE ce_ohne_tzid RENAME TO calendar_events');
  db.pragma('foreign_keys = ON');
  assert.ok(
    !db.prepare('PRAGMA table_info(calendar_events)').all().some((c) => c.name === 'tzid'),
    'die Vorbedingung muss stimmen, sonst prueft dieser Test nichts'
  );

  applyWithMigrateSemantics(db, MIGRATIONS.find((m) => m.version === NULLABLE_COLOR_VERSION));

  const nachher = db.prepare('PRAGMA table_info(calendar_events)').all();
  assert.ok(nachher.some((c) => c.name === 'tzid'), 'die Migration muss die fehlende Spalte nachtragen');
  assert.equal(nachher.find((c) => c.name === 'color').notnull, 0, 'und ihre eigentliche Arbeit trotzdem tun');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n, 3, 'ohne Zeilen zu verlieren');
});

test('der Test-Schema-Auszug haelt die Spalte ebenfalls nullable', async () => {


  // driftet still: haelt er `color` weiter NOT NULL, laufen genau die Suiten

  // koennen ihn gar nicht herstellen. Dieselbe Datei lag schon einmal sieben


  const { MIGRATIONS_SQL } = await import('../server/db-schema-test.js');

  for (const key of [1, 11]) {
    const sql = MIGRATIONS_SQL[key];
    if (!sql || !/CREATE TABLE[^;]*calendar_events/.test(sql)) continue;
    const db = new Database(join(mkdtempSync(join(tmpdir(), 'aashiyana-auszug-')), 'db.sqlite'));



    db.pragma('foreign_keys = OFF');
    db.exec(sql);
    const col = db.prepare('PRAGMA table_info(calendar_events)').all().find((c) => c.name === 'color');
    assert.equal(col.notnull, 0, `MIGRATIONS_SQL[${key}]: color muss NULL annehmen wie in Produktion`);



    db.prepare(`INSERT INTO calendar_events (title, start_datetime, color, created_by)
                VALUES ('Farblos', '2040-01-01T09:00', NULL, 1)`).run();
    assert.equal(db.prepare('SELECT color FROM calendar_events').get().color, null);
    db.close();
  }
});

// --------------------------------------------------------

// --------------------------------------------------------

test('Migration 167 uebernimmt den bisherigen Schutz Zeile fuer Zeile', () => {
  const db = buildDatabaseBefore(COLOR_MODIFIED_VERSION);
  seed(db);

  const vorher = db.prepare('SELECT user_modified FROM calendar_events ORDER BY id').all()
    .map((r) => r.user_modified);

  // nichts: `color_modified = 0` waere dann von `color_modified = user_modified`

  assert.ok(new Set(vorher).size > 1, `der Bestand muss beide Faelle tragen: ${vorher.join()}`);

  applyWithMigrateSemantics(db, MIGRATIONS.find((m) => m.version === COLOR_MODIFIED_VERSION));

  const nachher = db.prepare('SELECT user_modified, color_modified FROM calendar_events ORDER BY id').all();
  assert.deepEqual(nachher.map((r) => r.color_modified), vorher,
    'der Backfill ist konservativ: was heute geschuetzt ist, bleibt geschuetzt');
  assert.deepEqual(nachher.map((r) => r.user_modified), vorher,
    'und user_modified behaelt seine eigene Bedeutung');

  const spalte = db.prepare('PRAGMA table_info(calendar_events)').all()
    .find((c) => c.name === 'color_modified');
  assert.equal(spalte.notnull, 1, 'das Flag ist nie unbekannt');
  assert.equal(spalte.dflt_value, '0', 'ein neuer Termin faengt ohne eigene Farbwahl an');
});

test('Migration 167 laesst einen neuen Termin bei 0 anfangen', () => {

  // waere jeder frisch importierte Termin gegen die Farbe seines Anbieters

  const db = buildDatabaseBefore(COLOR_MODIFIED_VERSION);
  seed(db);
  db.prepare("UPDATE calendar_events SET user_modified = 1").run();
  applyWithMigrateSemantics(db, MIGRATIONS.find((m) => m.version === COLOR_MODIFIED_VERSION));

  db.prepare(`INSERT INTO calendar_events (title, start_datetime, created_by)
              VALUES ('Frisch importiert', '2040-01-01T09:00', 1)`).run();
  const neu = db.prepare("SELECT color_modified FROM calendar_events WHERE title = 'Frisch importiert'").get();
  assert.equal(neu.color_modified, 0);
});

test('der Test-Schema-Auszug kennt den Zustand ebenfalls', async () => {




  const { MIGRATIONS_SQL } = await import('../server/db-schema-test.js');
  const sql = MIGRATIONS_SQL[11];
  const db = new Database(join(mkdtempSync(join(tmpdir(), 'aashiyana-auszug-')), 'db.sqlite'));
  db.pragma('foreign_keys = OFF');
  db.exec(sql);
  db.prepare(`INSERT INTO calendar_events (title, start_datetime, created_by)
              VALUES ('Farblos', '2040-01-01T09:00', 1)`).run();
  assert.equal(db.prepare('SELECT color_modified FROM calendar_events').get().color_modified, 0);
  db.close();
});

// --------------------------------------------------------
// Wer das Gatter bedient (#899)
// --------------------------------------------------------

function ohneKommentare(quelle) {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((zeile) => !/^\s*(\/\/|--)/.test(zeile))
    .join('\n');
}

const SYNC_DIENSTE = [
  'server/services/caldav-sync.js',
  'server/services/apple-calendar.js',
  'server/services/google-calendar.js',
];

test('jedes Farb-Gatter des Inbound haengt an color_modified (#899)', async () => {




  const { readFile } = await import('node:fs/promises');
  const GATTER_RE = /CASE\s+WHEN\s+(\w+)\s*=\s*0\s+THEN\s+\?\s+ELSE\s+color\s+END/g;

  let gefunden = 0;
  const falsch = [];
  for (const datei of SYNC_DIENSTE) {
    const quelle = ohneKommentare(await readFile(new URL(`../${datei}`, import.meta.url), 'utf8'));
    for (const treffer of quelle.matchAll(GATTER_RE)) {
      gefunden++;
      if (treffer[1] !== 'color_modified') falsch.push(`${datei}: ${treffer[0]}`);
    }
  }



  assert.ok(gefunden >= 5, `nur ${gefunden} Farb-Gatter gefunden - stimmt das Muster noch?`);
  assert.deepEqual(falsch, [],
    'user_modified wird bei JEDER Bearbeitung gesetzt; ein Titel-Edit fror die Farbe damit ein (#899)');
});

test('der Upload merkt sich, dass die hinausgeschickte Farbe unsere ist (#899)', async () => {



  //




  const { readFile } = await import('node:fs/promises');
  const UPDATE_RE = /UPDATE calendar_events\s+SET([\s\S]*?)WHERE/g;

  let gefunden = 0;
  const ohneFlag = [];
  for (const datei of SYNC_DIENSTE) {
    const quelle = ohneKommentare(await readFile(new URL(`../${datei}`, import.meta.url), 'utf8'));
    for (const treffer of quelle.matchAll(UPDATE_RE)) {
      const setListe = treffer[1];
      if (!/external_source\s*=\s*'(caldav|apple|google)'/.test(setListe)) continue;
      gefunden++;
      if (!/color_modified/.test(setListe)) ohneFlag.push(datei);
    }
  }

  assert.equal(gefunden, 3, `drei Anbieter, drei Upload-Stellen - gefunden: ${gefunden}`);
  assert.deepEqual(ohneFlag, [],
    'der Upload muss color_modified setzen, sonst verliert der Termin seine exakte Farbe an die gemappte');
});

// --------------------------------------------------------
// Die Importpfade
// --------------------------------------------------------

test('kein Importpfad schreibt die geerbte Kalenderfarbe in die Eigenfarb-Spalte', async () => {



  const { readFile } = await import('node:fs/promises');
  const DIENSTE = [
    'server/services/caldav-sync.js',
    'server/services/apple-calendar.js',
    'server/services/google-calendar.js',
    'server/services/ics-subscription.js',
  ];

  // geerbte Farbe zur Eigenfarbe macht.
  const FALLBACK_RE = /\.color\s*\|\|\s*[A-Za-z_$][\w$.]*(?:[Cc]olor|COLOR)/g;

  for (const datei of DIENSTE) {
    const quelle = await readFile(new URL(`../${datei}`, import.meta.url), 'utf8');
    const treffer = [...quelle.matchAll(FALLBACK_RE)].map((m) => m[0]);




    const echte = treffer.filter((t) => !/fallbackColor/.test(t));
    assert.deepEqual(echte, [],
      `${datei}: die geerbte Farbe gehoert nicht in calendar_events.color (#891), gefunden: ${echte.join(', ')}`);
  }
});

test('der Lesepfad speist cal_color aus beiden Toepfen', async () => {
  // ICS-Abos haben keinen external_calendars-Eintrag - ihre geerbte Farbe steht

  // Abo-Terminen ihre Farbe ganz weg statt sie nur umzuhaengen.
  const { readFile } = await import('node:fs/promises');
  const LESEPFADE = [
    'server/routes/calendar/read.js',
    'server/routes/calendar/crud.js',
    'server/services/calendar-event-reader.js',
  ];
  for (const datei of LESEPFADE) {
    const quelle = await readFile(new URL(`../${datei}`, import.meta.url), 'utf8');
    const anzahl = (quelle.match(/AS cal_color/g) || []).length;
    assert.ok(anzahl > 0, `${datei}: liefert kein cal_color`);
    assert.equal((quelle.match(/COALESCE\(ec\.color,\s*isub\.color\) AS cal_color/g) || []).length, anzahl,
      `${datei}: jedes cal_color muss beide Quellen lesen, sonst verlieren Abo-Termine ihre Farbe`);
    assert.ok(/LEFT JOIN ics_subscriptions isub ON isub\.id = e\.subscription_id/.test(quelle),
      `${datei}: der Join auf ics_subscriptions fehlt`);
  }
});
