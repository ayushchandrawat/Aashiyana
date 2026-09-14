
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3-multiple-ciphers';

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'search-index-duplicates-test-secret';

const { MIGRATIONS } = await import('../server/db.js');
const { runSearch } = await import('../server/services/search.js');

const FIX_VERSION = 151;

function buildDatabase(upTo = Infinity) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);
  for (const migration of MIGRATIONS) {
    if (migration.version > upTo) break;
    if (typeof migration.up === 'function') migration.up(db);
    else db.exec(migration.up);
    if (typeof migration.afterUp === 'function') migration.afterUp(db);
    db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)')
      .run(migration.version, migration.description);
  }
  // runSearch() (unten) fragt seit #1063 Phase 10 immer auch waste_types ab





  for (const version of [197, 206]) {
    if (upTo >= version) continue;
    const migration = MIGRATIONS.find((m) => m.version === version);
    if (typeof migration.up === 'function') migration.up(db);
    else db.exec(migration.up);
    db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)')
      .run(migration.version, migration.description);
  }
  return db;
}

function applyMigration(db, version) {
  const migration = MIGRATIONS.find((m) => m.version === version);
  assert.ok(migration, `Migration ${version} muss es geben`);
  if (typeof migration.up === 'function') migration.up(db);
  else db.exec(migration.up);
  if (typeof migration.afterUp === 'function') migration.afterUp(db);
  db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)')
    .run(migration.version, migration.description);
}

function seedUserAndList(db) {
  const userId = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role)
    VALUES ('owner', 'Owner', 'hash', 'admin')
  `).run().lastInsertRowid;
  const listId = db.prepare('INSERT INTO shopping_lists (name, created_by) VALUES (?, ?)')
    .run('Wocheneinkauf', userId).lastInsertRowid;
  return { userId, listId };
}

const indexRows = (db, entity, entityId) => db
  .prepare('SELECT COUNT(*) AS n FROM search_index WHERE entity = ? AND entity_id = ?')
  .get(entity, entityId).n;

// --------------------------------------------------------------------------
// Der Anlassfall.
// --------------------------------------------------------------------------
test('Ein Artikel ohne eigene sort_order steht genau EINMAL im Index', () => {
  const db = buildDatabase();
  const { listId } = seedUserAndList(db);
  try {


    const id = db.prepare('INSERT INTO shopping_items (list_id, name) VALUES (?, ?)')
      .run(listId, 'Buchweizenmehl').lastInsertRowid;
    assert.equal(indexRows(db, 'item', id), 1);
  } finally {
    db.close();
  }
});

test('Der Fehler tritt nur ohne eigene sort_order auf - beide Wege ergeben eine Zeile', () => {



  const db = buildDatabase();
  const { listId } = seedUserAndList(db);
  try {
    const ohne = db.prepare('INSERT INTO shopping_items (list_id, name) VALUES (?, ?)')
      .run(listId, 'Ohnesortierung').lastInsertRowid;
    const mit = db.prepare('INSERT INTO shopping_items (list_id, name, sort_order) VALUES (?, ?, 7)')
      .run(listId, 'Mitsortierung').lastInsertRowid;

    assert.equal(db.prepare('SELECT sort_order FROM shopping_items WHERE id = ?').get(ohne).sort_order, 1,
      'Vorbedingung: der sort_order-Trigger hat gefeuert und die Zeile angefasst');
    assert.equal(indexRows(db, 'item', ohne), 1);
    assert.equal(indexRows(db, 'item', mit), 1);
  } finally {
    db.close();
  }
});

test('Die Suche liefert einen Artikel einmal, und fünf Artikel bleiben fünf', () => {



  const db = buildDatabase();
  const { userId, listId } = seedUserAndList(db);
  try {
    for (let i = 1; i <= 5; i += 1) {
      db.prepare('INSERT INTO shopping_items (list_id, name) VALUES (?, ?)')
        .run(listId, `Quinoasorte ${i}`);
    }
    const hits = runSearch(db, 'Quinoasorte', userId).items;
    assert.equal(hits.length, 5, 'alle fünf Artikel kommen an');
    assert.equal(new Set(hits.map((h) => h.id)).size, 5, 'und zwar fünf verschiedene');
  } finally {
    db.close();
  }
});

test('Auch nach Ändern und Abhaken bleibt es bei einer Zeile', () => {



  const db = buildDatabase();
  const { listId } = seedUserAndList(db);
  try {
    const id = db.prepare('INSERT INTO shopping_items (list_id, name) VALUES (?, ?)')
      .run(listId, 'Kichererbsen').lastInsertRowid;
    db.prepare('UPDATE shopping_items SET is_checked = 1 WHERE id = ?').run(id);
    assert.equal(indexRows(db, 'item', id), 1, 'nach dem Abhaken');
    db.prepare('UPDATE shopping_items SET name = ? WHERE id = ?').run('Kichererbsenmehl', id);
    assert.equal(indexRows(db, 'item', id), 1, 'nach dem Umbenennen');
    assert.equal(
      db.prepare("SELECT title FROM search_index WHERE entity = 'item' AND entity_id = ?").get(id).title,
      'Kichererbsenmehl',
      'und der Index trägt den neuen Namen',
    );
    db.prepare('DELETE FROM shopping_items WHERE id = ?').run(id);
    assert.equal(indexRows(db, 'item', id), 0, 'nach dem Löschen bleibt nichts zurück');
  } finally {
    db.close();
  }
});

test('Der Fix hängt NICHT an der Trigger-Reihenfolge', () => {
  const db = buildDatabase();
  const { listId } = seedUserAndList(db);
  try {


    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get('trg_shopping_items_sort_order')?.sql;
    assert.ok(sql, 'Vorbedingung: den sort_order-Trigger gibt es');

    db.exec('DROP TRIGGER trg_shopping_items_sort_order');
    db.exec(sql);

    const id = db.prepare('INSERT INTO shopping_items (list_id, name) VALUES (?, ?)')
      .run(listId, 'Rollgerste').lastInsertRowid;
    assert.equal(db.prepare('SELECT sort_order FROM shopping_items WHERE id = ?').get(id).sort_order, 1,
      'Vorbedingung: der neu angelegte sort_order-Trigger feuert weiterhin');
    assert.equal(indexRows(db, 'item', id), 1,
      'auch bei umgedrehter Reihenfolge genau eine Zeile - der Index-Trigger muss selbst idempotent sein');
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------




// --------------------------------------------------------------------------
const ENTITY_SEEDS = {
  task: (db, { userId }) => db.prepare(`
    INSERT INTO tasks (title, priority, status, created_by) VALUES (?, 'medium', 'open', ?)
  `).run('Zwetschgenmus', userId).lastInsertRowid,
  event: (db, { userId }) => db.prepare(`
    INSERT INTO calendar_events (title, start_datetime, created_by) VALUES (?, '2030-01-01T10:00:00Z', ?)
  `).run('Zwetschgenmus', userId).lastInsertRowid,
  note: (db, { userId }) => db.prepare('INSERT INTO notes (title, content, created_by) VALUES (?, ?, ?)')
    .run('Zwetschgenmus', 'Text', userId).lastInsertRowid,
  contact: (db) => db.prepare('INSERT INTO contacts (name) VALUES (?)')
    .run('Zwetschgenmus').lastInsertRowid,
  item: (db, { listId }) => db.prepare('INSERT INTO shopping_items (list_id, name) VALUES (?, ?)')
    .run(listId, 'Zwetschgenmus').lastInsertRowid,
  medication: (db, { userId }) => db.prepare(`
    INSERT INTO medications (user_id, name, visibility) VALUES (?, ?, 'private')
  `).run(userId, 'Zwetschgenmus').lastInsertRowid,
  activity: (db, { userId }) => db.prepare(`
    INSERT INTO health_activities (user_id, type, performed_at, visibility)
    VALUES (?, ?, '2030-01-01T08:00:00Z', 'private')
  `).run(userId, 'Zwetschgenmus').lastInsertRowid,
};

test('Guard: KEINE indizierte Entität legt beim Anlegen zwei Index-Zeilen an', () => {
  const db = buildDatabase();
  const ctx = seedUserAndList(db);
  try {
    const doppelt = [];
    for (const [entity, seed] of Object.entries(ENTITY_SEEDS)) {
      const id = seed(db, ctx);
      const n = indexRows(db, entity, id);
      assert.ok(n > 0, `Vorbedingung: ${entity} wird überhaupt indiziert (sonst prüft dieser Guard nichts)`);
      if (n !== 1) doppelt.push(`${entity}: ${n}`);
    }
    assert.deepEqual(doppelt, [], [
      'Diese Entitäten schreiben beim Anlegen mehr als eine Index-Zeile.',
      'Meist steckt ein zweiter AFTER-INSERT-Trigger dahinter, der ein UPDATE',
      'auf dieselbe Zeile macht - SQLite sichert die Reihenfolge zweier Trigger',
      'desselben Typs nicht zu. Der _ai-Trigger dieser Entität muss dann wie der',
      'von shopping_items vor dem INSERT löschen (Migration 151).',
    ].join(' '));
  } finally {
    db.close();
  }
});

test('Guard: nur ein AFTER-INSERT-Trigger im Schema updatet seine eigene Tabelle', () => {




  const db = buildDatabase();
  try {
    const verdaechtig = db
      .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'")
      .all()
      .filter((t) => /AFTER\s+INSERT/i.test(t.sql)
        && new RegExp(`UPDATE\\s+${t.tbl_name}\\b`, 'i').test(t.sql.replace(/\s+/g, ' ')))
      .map((t) => t.name);

    assert.deepEqual(verdaechtig, ['trg_shopping_items_sort_order'],
      'Kommt hier einer dazu, prüfe den _ai-Trigger seiner Tabelle auf Dubletten');
  } finally {
    db.close();
  }
});

// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
test(`Migration ${FIX_VERSION} räumt vorhandene Dubletten weg`, () => {
  const db = buildDatabase(FIX_VERSION - 1);
  const { userId, listId } = seedUserAndList(db);
  try {


    const ids = [];
    for (const name of ['Amaranth', 'Buchweizen', 'Couscous']) {
      ids.push(db.prepare('INSERT INTO shopping_items (list_id, name) VALUES (?, ?)')
        .run(listId, name).lastInsertRowid);
    }
    for (const id of ids) {
      assert.equal(indexRows(db, 'item', id), 2, 'Vorbedingung: der alte Stand schreibt wirklich doppelt');
    }
    const task = ENTITY_SEEDS.task(db, { userId, listId });
    assert.equal(indexRows(db, 'task', task), 1, 'Vorbedingung: eine Aufgabe war schon vorher einfach');

    applyMigration(db, FIX_VERSION);

    for (const id of ids) {
      assert.equal(indexRows(db, 'item', id), 1, 'die Dublette ist weg');
    }
    assert.equal(indexRows(db, 'task', task), 1, 'und die einfache Zeile ist nicht mit weggeräumt worden');



    const hits = runSearch(db, 'Buchweizen', userId).items;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, 'Buchweizen');
  } finally {
    db.close();
  }
});

test(`Migration ${FIX_VERSION} repariert auch den Trigger, nicht nur die Daten`, () => {


  // bis jemand sucht.
  const db = buildDatabase(FIX_VERSION - 1);
  const { listId } = seedUserAndList(db);
  try {
    applyMigration(db, FIX_VERSION);
    const id = db.prepare('INSERT INTO shopping_items (list_id, name) VALUES (?, ?)')
      .run(listId, 'Dinkelgriess').lastInsertRowid;
    assert.equal(indexRows(db, 'item', id), 1, 'nach der Migration angelegt - eine Zeile');
  } finally {
    db.close();
  }
});
