
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';




process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aashiyana-guestmig-')), 'unused.db');
const { MIGRATIONS } = await import('../server/db.js');

const V124 = MIGRATIONS.find((m) => m.version === 124);




function seedPreV124() {
  const db = new Database(join(mkdtempSync(join(tmpdir(), 'aashiyana-guestmig-')), 'db.sqlite'));
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE expense_groups (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE split_expense_guest_users (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      group_id   INTEGER REFERENCES expense_groups(id) ON DELETE CASCADE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX idx_split_guest_group ON split_expense_guest_users(group_id);

    INSERT INTO users (username) VALUES ('owner'), ('gast.reise'), ('gast.wg');
    INSERT INTO expense_groups (name) VALUES ('Reise'), ('WG-Kasse');
    INSERT INTO split_expense_guest_users (user_id, group_id, created_by, created_at) VALUES
      (2, 1, 1, '2026-01-02T03:04:05Z'),
      (3, 2, 1, '2026-02-03T04:05:06Z');
  `);
  return db;
}

function migrated() {
  const db = seedPreV124();


  db.exec(V124.up);
  return db;
}

test('v124 läuft ohne foreignKeysOff - keine Tabelle referenziert split_expense_guest_users', () => {
  assert.notEqual(V124.foreignKeysOff, true);
  const db = migrated();
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'FK-Durchsetzung blieb an');
  assert.deepEqual(db.pragma('foreign_key_check'), [], 'keine verwaisten Zeilen');
  db.close();
});

test('v124 überführt den Bestand vollständig und unverändert', () => {
  const db = migrated();


  assert.deepEqual(
    db.prepare('SELECT user_id, group_id, created_by, created_at FROM split_expense_guest_users ORDER BY user_id').all(),
    [
      { user_id: 2, group_id: 1, created_by: 1, created_at: '2026-01-02T03:04:05Z' },
      { user_id: 3, group_id: 2, created_by: 1, created_at: '2026-02-03T04:05:06Z' },
    ],
  );
  db.close();
});

test('v124 lässt Index zurück und keine Hilfstabelle', () => {
  const db = migrated();
  assert.deepEqual(
    db.prepare("SELECT type, name FROM sqlite_master WHERE tbl_name = 'split_expense_guest_users' AND type = 'index' ORDER BY name").all(),
    [{ type: 'index', name: 'idx_split_guest_group' }],
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'split_expense_guest_users_new'").get().c, 0,
    'Hilfstabelle darf nicht zurückbleiben',
  );
  db.close();
});

test('nach v124 überlebt die Gast-Zeile das Löschen ihrer Gruppe (group_id wird NULL)', () => {
  const db = migrated();
  db.prepare('DELETE FROM expense_groups WHERE id = ?').run(1);

  const orphan = db.prepare('SELECT * FROM split_expense_guest_users WHERE user_id = ?').get(2);
  assert.ok(orphan, 'der Gast bleibt ein Gast');
  assert.equal(orphan.group_id, null, 'nur die Zuordnung fällt weg');
  assert.equal(orphan.created_by, 1, 'übrige Spalten unberührt');

  const untouched = db.prepare('SELECT group_id FROM split_expense_guest_users WHERE user_id = ?').get(3);
  assert.equal(untouched.group_id, 2, 'der Gast der anderen Gruppe bleibt zugeordnet');
  db.close();
});

test('Gegenbeweis: vor v124 nimmt das Löschen der Gruppe die ganze Gast-Zeile mit', () => {
  const db = seedPreV124();
  db.prepare('DELETE FROM expense_groups WHERE id = ?').run(1);

  assert.equal(db.prepare('SELECT 1 FROM split_expense_guest_users WHERE user_id = ?').get(2), undefined,
    'Confinement-Zeile war weg - der Guard in server/index.js fand nichts mehr');
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(2),
    'das Login blieb bestehen: aus dem Gast wurde ein Vollkonto');
  db.close();
});

test('nach v124 räumt das Löschen des Nutzers die Gast-Zeile weiterhin ab', () => {
  const db = migrated();
  db.prepare('DELETE FROM users WHERE id = ?').run(2);
  assert.equal(db.prepare('SELECT 1 FROM split_expense_guest_users WHERE user_id = ?').get(2), undefined);
  db.close();
});

test('nach v124 hängt created_by weiterhin per SET NULL am Ersteller', () => {
  const db = migrated();
  db.prepare('DELETE FROM users WHERE id = ?').run(1);
  assert.equal(db.prepare('SELECT created_by FROM split_expense_guest_users WHERE user_id = ?').get(2).created_by, null);
  db.close();
});
