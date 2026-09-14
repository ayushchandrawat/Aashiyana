
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dbmod = await import('../server/db.js');
const migration146 = dbmod.MIGRATIONS.find((m) => m.version === 146);

function folders(rows = []) {
  const conn = new DatabaseSync(':memory:');
  conn.exec(`
    CREATE TABLE family_document_folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      created_by INTEGER
    );
  `);
  const insert = conn.prepare('INSERT INTO family_document_folders (name) VALUES (?)');
  for (const name of rows) insert.run(name);
  return conn;
}

const names = (conn) => conn.prepare('SELECT id, name FROM family_document_folders ORDER BY id').all();

test('ein Bestandsordner mit altem Namen wird umbenannt und behaelt seine id', () => {
  const conn = folders(['Belege', 'Geteilte Ausgaben', 'Inventar']);
  const before = names(conn).find((f) => f.name === 'Geteilte Ausgaben');

  migration146.up(conn);

  const after = names(conn);
  assert.deepEqual(after.map((f) => f.name), ['Belege', 'Gemeinsame Ausgaben', 'Inventar']);


  // die Belege zurueckgelassen.
  assert.equal(after.find((f) => f.name === 'Gemeinsame Ausgaben').id, before.id);
});

test('existiert der Zielname schon, bleibt der alte Ordner unberuehrt', () => {
  const conn = folders(['Geteilte Ausgaben', 'Gemeinsame Ausgaben']);

  migration146.up(conn);

  assert.deepEqual(names(conn).map((f) => f.name), ['Geteilte Ausgaben', 'Gemeinsame Ausgaben'],
    'zwei gleichnamige Ordner waeren schlimmer als einer mit altem Namen');
});

test('der Fall, der sich nur in der Grossschreibung unterscheidet, wird trotzdem umbenannt', () => {
  const conn = folders(['Pengeluaran bersama']);

  migration146.up(conn);

  assert.deepEqual(names(conn).map((f) => f.name), ['Pengeluaran Bersama'],
    'COLLATE NOCASE findet hier den Quellordner als seinen eigenen Konflikt - '
    + 'die Migration muss die eigene id ausschliessen');
});

test('beide Schreibweisen nebeneinander bringen die Migration nicht um', () => {






  const conn = folders(['Pengeluaran bersama', 'Pengeluaran Bersama']);

  assert.doesNotThrow(() => migration146.up(conn),
    'Migration v146 darf an einem Haushalt mit beiden Schreibweisen nicht abbrechen');

  assert.deepEqual(names(conn).map((f) => f.name), ['Pengeluaran bersama', 'Pengeluaran Bersama'],
    'bei belegtem Zielnamen bleibt alles stehen - ensureFolder trifft dann den kanonischen');
});

test('eine Datenbank ohne passenden Ordner bleibt unveraendert', () => {
  const conn = folders(['Belege', 'Vertraege']);

  migration146.up(conn);

  assert.deepEqual(names(conn).map((f) => f.name), ['Belege', 'Vertraege']);
});

test('jede Sprache ist abgedeckt: die Migration kennt jeden Namen, den ein Ordner heute traegt', () => {


  // Sprachen prueft, die er selbst aufzaehlt.
  const locales = readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'));
  assert.ok(locales.length >= 20, `nur ${locales.length} Locales gefunden - Pfad veraltet?`);

  const uncovered = [];
  for (const file of locales) {
    const data = JSON.parse(readFileSync(new URL(`../public/locales/${file}`, import.meta.url), 'utf8'));
    const title = data.splitExpenses?.title;
    assert.ok(title, `${file}: splitExpenses.title fehlt`);



    // Modul") - dort gehoert die Regel hin, weil sie fuer jede kuenftige

    //



    // fleissig etwas Richtiges in etwas Falsches um.
    const conn = folders([title]);
    migration146.up(conn);
    if (names(conn)[0].name !== title) uncovered.push(`${file}: ${title}`);
  }
  assert.deepEqual(uncovered, [], `Migration benennt einen bereits kanonischen Namen um:\n  ${uncovered.join('\n  ')}`);
});
