
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const dbmod = await import('../server/db.js');
const db = dbmod.get();

const migration145 = dbmod.MIGRATIONS.find((m) => m.version === 145);

function readDisabled(conn) {
  const row = conn.prepare("SELECT value FROM sync_config WHERE key = 'disabled_modules'").get();
  return row ? JSON.parse(row.value) : null;
}




// eigene Instanz mit vorbelegtem Wert.
function householdWith(value) {
  const conn = new DatabaseSync(':memory:');
  conn.exec(`
    CREATE TABLE sync_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `);
  if (value !== undefined) {
    conn.prepare("INSERT INTO sync_config (key, value) VALUES ('disabled_modules', ?)").run(value);
  }
  return conn;
}

test('Neuinstallation startet mit abgeschaltetem Inventory', () => {






  const conn = householdWith();
  migration145.up(conn);
  assert.deepEqual(readDisabled(conn), ['inventory']);
});

test('Bestandshaushalt behaelt seine eigenen Abschaltungen', () => {
  const conn = householdWith(JSON.stringify(['notes', 'rewards']));
  migration145.up(conn);

  const disabled = readDisabled(conn);
  assert.deepEqual(disabled.slice().sort(), ['inventory', 'notes', 'rewards']);
});

test('Haushalt ohne Zeile bekommt sie angelegt', () => {
  const conn = householdWith(undefined);
  migration145.up(conn);
  assert.deepEqual(readDisabled(conn), ['inventory']);
});

test('Kaputter oder fremdformatiger Wert legt die Migration nicht lahm', () => {
  for (const broken of ['{nicht json', '"kein array"', '42', 'null']) {
    const conn = householdWith(broken);
    migration145.up(conn);
    assert.deepEqual(readDisabled(conn), ['inventory'], `Wert ${broken} muss ersetzt werden`);
  }
});

test('Nicht-String-Eintraege werden aussortiert statt mitgeschleppt', () => {
  const conn = householdWith(JSON.stringify(['notes', 42, null, { a: 1 }]));
  migration145.up(conn);
  assert.deepEqual(readDisabled(conn), ['notes', 'inventory']);
});

test('Zweiter Lauf fuegt inventory kein zweites Mal hinzu', () => {


  const conn = householdWith(JSON.stringify(['notes']));
  migration145.up(conn);
  migration145.up(conn);
  assert.deepEqual(readDisabled(conn), ['notes', 'inventory']);
});

test('inventory ist ein gueltiger Slug fuer die Lese-/Schreibseite', async () => {
  // parseDisabledModules filtert gegen TOGGLEABLE_MODULES - stuende inventory

  const source = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../server/routes/preferences.js', import.meta.url), 'utf8'));
  const list = source.match(/const TOGGLEABLE_MODULES = \[([\s\S]*?)\];/)?.[1];
  assert.ok(list, 'TOGGLEABLE_MODULES nicht gefunden');
  assert.match(list, /'inventory'/);
});
