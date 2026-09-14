
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const dbmod = await import('../server/db.js');
const migration147 = dbmod.MIGRATIONS.find((m) => m.version === 147);

function rewards({ catalog = [], redemptions = [] } = {}) {
  const conn = new DatabaseSync(':memory:');
  conn.exec(`
    CREATE TABLE reward_catalog (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      cost        INTEGER NOT NULL,
      icon        TEXT,
      description TEXT
    );
    CREATE TABLE reward_redemptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      reward_name TEXT    NOT NULL,
      reward_icon TEXT,
      cost        INTEGER NOT NULL
    );
  `);
  const addItem = conn.prepare('INSERT INTO reward_catalog (name, cost, icon, description) VALUES (?, ?, ?, ?)');
  for (const [name, icon, description] of catalog) addItem.run(name, 10, icon, description ?? null);
  const addRedemption = conn.prepare('INSERT INTO reward_redemptions (user_id, reward_name, reward_icon, cost) VALUES (1, ?, ?, 10)');
  for (const [name, icon] of redemptions) addRedemption.run(name, icon);
  return conn;
}

const catalog = (conn) => conn.prepare('SELECT name, icon, description FROM reward_catalog ORDER BY id').all();
const redemptions = (conn) => conn.prepare('SELECT reward_name, reward_icon FROM reward_redemptions ORDER BY id').all();

test('das Icon "null" wird zu SQL-NULL, echte Icons bleiben unberuehrt', () => {
  const conn = rewards({ catalog: [['Eis', '🍦'], ['Kino', 'null'], ['Zoo', null]] });

  migration147.up(conn);

  assert.deepEqual(catalog(conn).map((r) => [r.name, r.icon]),
    [['Eis', '🍦'], ['Kino', null], ['Zoo', null]]);
});

test('die Beschreibung "null" wird zu SQL-NULL', () => {
  const conn = rewards({ catalog: [['Eis', null, 'null'], ['Kino', null, 'Zwei Karten']] });

  migration147.up(conn);

  assert.deepEqual(catalog(conn).map((r) => [r.name, r.description]),
    [['Eis', null], ['Kino', 'Zwei Karten']]);
});

test('der Einloese-Verlauf wird mitgeraeumt', () => {



  const conn = rewards({ redemptions: [['Kino', 'null'], ['Eis', '🍦'], ['Zoo', null]] });

  migration147.up(conn);

  assert.deepEqual(redemptions(conn).map((r) => r.reward_icon), [null, '🍦', null]);
});

test('Text, der "null" nur enthaelt, bleibt stehen', () => {



  const conn = rewards({
    catalog: [['A', 'Null', 'Nullnummer'], ['B', ' null ', ' null '], ['C', 'NULL', 'ist null wert']],
  });

  migration147.up(conn);

  assert.deepEqual(catalog(conn).map((r) => [r.icon, r.description]),
    [['Null', 'Nullnummer'], [' null ', ' null '], ['NULL', 'ist null wert']],
    'Gross-/Kleinschreibung und Leerzeichen zaehlen - nur der exakte Wert wird geraeumt');
});
