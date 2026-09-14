
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dbmod = await import('../server/db.js');
const migration157 = dbmod.MIGRATIONS.find((m) => m.version === 157);
const { ensureModuleFolder, MODULE_FOLDER_KEYS, isModuleFolderKey } =
  await import('../server/services/document-folders.js');

const ACTOR = 1;

function folders(rows = []) {
  const conn = new DatabaseSync(':memory:');
  conn.exec(`
    CREATE TABLE family_document_folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      parent_id  INTEGER REFERENCES family_document_folders(id) ON DELETE CASCADE,
      created_by INTEGER
    );
    CREATE UNIQUE INDEX idx_family_document_folders_sibling_name
      ON family_document_folders(COALESCE(parent_id, 0), name);
  `);
  const insert = conn.prepare('INSERT INTO family_document_folders (name) VALUES (?)');
  for (const name of rows) insert.run(name);
  return conn;
}

const rows = (conn) => conn.prepare(
  'SELECT id, name, module_key FROM family_document_folders ORDER BY id',
).all();

// --------------------------------------------------------
// Migration
// --------------------------------------------------------

test('die Migration bindet Bestandsordner an ihren Schluessel', () => {
  const conn = folders(['Belege', 'Gemeinsame Ausgaben', 'Inventar', 'Urlaub 2026']);

  migration157.up(conn);

  const byName = Object.fromEntries(rows(conn).map((f) => [f.name, f.module_key]));
  assert.equal(byName['Belege'], 'budget');
  assert.equal(byName['Gemeinsame Ausgaben'], 'splitExpenses');
  assert.equal(byName['Inventar'], 'inventory');

  assert.equal(byName['Urlaub 2026'], null);
});

test('die Migration erkennt den Ordner in jeder Sprache', () => {


  // legte daneben einen zweiten an.
  const conn = folders(['領収書', 'Чеки']);

  migration157.up(conn);

  const claimed = rows(conn).filter((f) => f.module_key === 'budget');
  assert.equal(claimed.length, 1, 'genau ein Ordner darf den Schluessel tragen');
  assert.equal(claimed[0].name, '領収書', 'der aelteste Treffer bekommt ihn');
});

test('zwei Sprachordner nebeneinander: der aeltere bekommt den Schluessel, der andere bleibt stehen', () => {
  const conn = folders(['Receipts', 'Belege']);

  migration157.up(conn);

  const after = rows(conn);
  assert.deepEqual(after.map((f) => f.module_key), ['budget', null]);


  assert.deepEqual(after.map((f) => f.name), ['Receipts', 'Belege']);
});

test('der Schluessel ist eindeutig - ein zweiter Ordner kann ihn nicht bekommen', () => {
  const conn = folders(['Belege']);
  migration157.up(conn);

  conn.prepare('INSERT INTO family_document_folders (name) VALUES (?)').run('Kassenzettel');
  assert.throws(
    () => conn.prepare('UPDATE family_document_folders SET module_key = ? WHERE name = ?')
      .run('budget', 'Kassenzettel'),
    /UNIQUE/,
    'ohne den Index koennten zwei Ordner denselben Zweck beanspruchen',
  );
});

test('die Namensliste der Migration deckt jede ausgelieferte Uebersetzung ab', () => {



  const locales = readdirSync(new URL('../public/locales', import.meta.url))
    .filter((f) => f.endsWith('.json'));
  assert.ok(locales.length >= 20, `zu wenige Locales gefunden (${locales.length})`);

  const ungebunden = [];
  for (const file of locales) {
    const json = JSON.parse(readFileSync(new URL(`../public/locales/${file}`, import.meta.url), 'utf8'));
    for (const key of MODULE_FOLDER_KEYS) {
      const name = json.documents?.[`${key}Folder`];
      if (!name) { ungebunden.push(`${file}: documents.${key}Folder fehlt`); continue; }

      const conn = folders([name]);
      migration157.up(conn);
      const [row] = rows(conn);
      if (row.module_key !== key) {
        ungebunden.push(`${file}: ${JSON.stringify(name)} -> ${row.module_key ?? 'nichts'} statt ${key}`);
      }
      conn.close();
    }
  }
  assert.deepEqual(ungebunden, [],
    `Bestandsordner, die die Migration nicht findet:\n  ${ungebunden.join('\n  ')}`);
});

// --------------------------------------------------------

// --------------------------------------------------------

function migrated(rows = []) {
  const conn = folders(rows);
  migration157.up(conn);
  return conn;
}

test('derselbe Schluessel in zwei Sprachen trifft denselben Ordner', () => {
  const conn = migrated(['Belege']);




  const a = ensureModuleFolder(conn, { key: 'budget', name: 'Belege' }, ACTOR);
  const b = ensureModuleFolder(conn, { key: 'budget', name: 'Receipts' }, ACTOR);

  assert.equal(a, b);
  assert.equal(rows(conn).length, 1);
});

test('eine umbenannte Uebersetzung spaltet den Ordner nicht mehr', () => {
  const conn = migrated(['Inventar']);


  const id = ensureModuleFolder(conn, { key: 'inventory', name: 'Inventarverzeichnis' }, ACTOR);

  const after = rows(conn);
  assert.equal(after.length, 1, 'kein zweiter Ordner');
  assert.equal(after[0].id, id);
  assert.equal(after[0].name, 'Inventar', 'der Name des Bestandsordners bleibt, wie er ist');
});

test('ein noch unbekannter Schluessel legt den Ordner mit seiner Beschriftung an', () => {
  const conn = migrated([]);

  const id = ensureModuleFolder(conn, { key: 'tasks', name: 'Aufgaben' }, ACTOR);

  const after = rows(conn);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, id);
  assert.equal(after[0].name, 'Aufgaben');
  assert.equal(after[0].module_key, 'tasks');
});

test('traegt ein selbst angelegter Ordner den Namen schon, wird er beansprucht statt verdoppelt', () => {


  const conn = migrated([]);
  conn.prepare('INSERT INTO family_document_folders (name) VALUES (?)').run('Aufgaben');

  const id = ensureModuleFolder(conn, { key: 'tasks', name: 'Aufgaben' }, ACTOR);

  const after = rows(conn);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, id);
  assert.equal(after[0].module_key, 'tasks');
});

test('ein fremder Schluessel wird nicht ueberschrieben', () => {
  const conn = migrated(['Belege']);




  const id = ensureModuleFolder(conn, { key: 'housekeeping', name: 'Belege' }, ACTOR);

  const after = rows(conn);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, id);
  assert.equal(after[0].module_key, 'budget');
});

test('ein selbst umbenannter Systemordner bleibt der Systemordner', () => {
  const conn = migrated(['Belege']);





  conn.prepare('UPDATE family_document_folders SET name = ? WHERE module_key = ?')
    .run('Kassenzettel 2026', 'budget');

  const id = ensureModuleFolder(conn, { key: 'budget', name: 'Belege' }, ACTOR);

  const after = rows(conn);
  assert.equal(after.length, 1, 'die Umbenennung darf keinen zweiten Ordner nach sich ziehen');
  assert.equal(after[0].id, id);
  assert.equal(after[0].name, 'Kassenzettel 2026', 'der selbst gewaehlte Name bleibt stehen');
});

test('ohne Schluessel bleibt es beim Suchen ueber den Namen', () => {


  const conn = migrated(['Urlaub 2026']);

  const id = ensureModuleFolder(conn, { name: 'Urlaub 2026' }, ACTOR);

  assert.equal(rows(conn).length, 1);
  assert.equal(rows(conn)[0].id, id);
});

test('ein erfundener Schluessel wird nicht angenommen', () => {
  const conn = migrated([]);

  assert.equal(isModuleFolderKey('budget'), true);
  assert.equal(isModuleFolderKey('../../etc'), false);
  assert.equal(isModuleFolderKey(''), false);



  // Client bestimmt.
  const id = ensureModuleFolder(conn, { key: 'erfunden', name: 'Sonstiges' }, ACTOR);
  assert.equal(rows(conn).find((f) => f.id === id).module_key, null);
});

test('jeder Schluessel der Liste hat eine Beschriftung in der Referenz-Locale', () => {
  const de = JSON.parse(readFileSync(new URL('../public/locales/de.json', import.meta.url), 'utf8'));
  const ohne = MODULE_FOLDER_KEYS.filter((key) => !de.documents?.[`${key}Folder`]);
  assert.deepEqual(ohne, [], `Schluessel ohne documents.<key>Folder: ${ohne.join(', ')}`);
});

// --------------------------------------------------------

// --------------------------------------------------------

test('wer einen Modul-Ordner anspricht, nennt seinen Schluessel', () => {





  const roots = ['pages', 'components'];
  const treffer = [];

  for (const root of roots) {
    const dir = new URL(`../public/${root}/`, import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const lines = readFileSync(new URL(file, dir), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const match = line.match(/t\('documents\.(\w+)Folder'\)/);




        // hier.
        if (!match || !MODULE_FOLDER_KEYS.includes(match[1])) return;


        const umfeld = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
        const hatKey = /folder_?[Kk]ey\s*:/.test(umfeld);
        treffer.push({ ort: `public/${root}/${file}:${i + 1}`, key: match[1], hatKey });
      });
    }
  }


  // greift, fehlerfrei "alles in Ordnung" ueber null geprueften Stellen.
  assert.ok(treffer.length >= 6,
    `zu wenige Aufrufer gefunden (${treffer.length}) - greift das Muster noch?`);


  // Server (`ensureDocumentFolder` in routes/calendar/helpers.js), weil dort

  const ohneKey = treffer.filter((t) => !t.hatKey && t.key !== 'calendarItems');
  assert.deepEqual(ohneKey.map((t) => `${t.ort} (${t.key})`), [],
    'Diese Stellen legen ueber den uebersetzten Namen ab und ergeben in einem\n'
    + 'mehrsprachigen Haushalt einen zweiten Ordner - sie brauchen folderKey/folder_key:');
});

test('der handgebaute Ordner-Tisch kennt keine Spalte, die das echte Schema nicht hat', () => {
  const nachbau = new Set(folders().prepare('PRAGMA table_info(family_document_folders)')
    .all().map((c) => c.name));



  const echt = new DatabaseSync(':memory:');
  echt.exec('PRAGMA foreign_keys = OFF');
  for (const migration of dbmod.MIGRATIONS) {
    if (typeof migration.up === 'string') echt.exec(migration.up);
    else migration.up(echt);
  }
  const echteSpalten = new Set(echt.prepare('PRAGMA table_info(family_document_folders)')
    .all().map((c) => c.name));

  assert.ok(echteSpalten.size > 3, 'das echte Schema wurde nicht aufgebaut - der Vergleich prueft nichts');
  assert.deepEqual([...nachbau].filter((c) => !echteSpalten.has(c)), [],
    'Diese Spalten stehen nur im Nachbau oben. Entweder ist das echte Schema\n'
    + 'weitergezogen, oder der Nachbau erfindet etwas - beides macht die Tests\n'
    + 'dieser Suite zu Aussagen ueber ein Schema, das es nicht gibt.');
});
