
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';


process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aashiyana-gtok-')), 'unused.db');
const { MIGRATIONS } = await import('../server/db.js');

const MIGRATION = MIGRATIONS.find((m) => m.version === 158);

function applyMigration(db, migration) {
  if (typeof migration.up === 'function') migration.up(db);
  else db.exec(migration.up);
  migration.afterUp?.(db);
}

function buildPreDatabase() {
  const db = new Database(join(mkdtempSync(join(tmpdir(), 'aashiyana-gtok-')), 'db.sqlite'));
  for (const migration of MIGRATIONS.filter((m) => m.version <= 157)) {
    applyMigration(db, migration);
  }
  db.prepare(`INSERT INTO google_calendar_selection (calendar_id, name, enabled, sync_token, last_sync)
              VALUES ('primary', 'Familie', 1, 'tok-abc', '2026-08-20T10:00:00Z')`).run();
  db.prepare(`INSERT INTO google_calendar_selection (calendar_id, name, enabled, sync_token, last_sync)
              VALUES ('urlaub', 'Urlaub', 1, 'tok-def', '2026-08-20T10:00:00Z')`).run();
  return db;
}

function addUser(db, id) {
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role)
              VALUES (?, ?, ?, 'x', 'admin')`).run(id, `user${id}`, `User ${id}`);
}

test('ohne den Nutzer mit ID 1 fällt der Token weg - der nächste Lauf ist ein Full-Resync', () => {
  const db = buildPreDatabase();
  addUser(db, 2);
  applyMigration(db, MIGRATION);

  const rows = db.prepare('SELECT calendar_id, sync_token, last_sync FROM google_calendar_selection').all();
  assert.equal(rows.length, 2, 'die Kalenderauswahl selbst bleibt unangetastet');
  for (const row of rows) {
    assert.equal(row.sync_token, null, `${row.calendar_id}: ohne Token holt der nächste Lauf alles`);
    assert.equal(row.last_sync, null, `${row.calendar_id}: last_sync gehört zum verworfenen Token`);
  }
  db.close();
});

test('mit dem Nutzer mit ID 1 bleibt der Token stehen', () => {
  const db = buildPreDatabase();
  addUser(db, 1);
  applyMigration(db, MIGRATION);

  const rows = db.prepare('SELECT calendar_id, sync_token FROM google_calendar_selection ORDER BY calendar_id').all();
  assert.deepEqual(
    rows.map((r) => r.sync_token), ['tok-abc', 'tok-def'],
    'hier hat nie ein Termin gefehlt - ein Full-Resync kostete nur Kontingent bei Google'
  );
  db.close();
});

test('die Kalenderauswahl bleibt aktiviert, es wird nur der Token verworfen', () => {
  const db = buildPreDatabase();
  addUser(db, 7);
  applyMigration(db, MIGRATION);

  const row = db.prepare(`SELECT enabled, name FROM google_calendar_selection WHERE calendar_id = 'primary'`).get();
  assert.equal(row.enabled, 1, 'der Kalender darf nicht stillschweigend abgeschaltet werden');
  assert.equal(row.name, 'Familie');
  db.close();
});

test('ohne jeden Nutzer und ohne Kalender läuft die Migration durch', () => {
  const db = new Database(join(mkdtempSync(join(tmpdir(), 'aashiyana-gtok-')), 'db.sqlite'));
  for (const migration of MIGRATIONS.filter((m) => m.version <= 157)) applyMigration(db, migration);

  assert.doesNotThrow(() => applyMigration(db, MIGRATION), 'eine frische Installation hat weder das eine noch das andere');
  db.close();
});
