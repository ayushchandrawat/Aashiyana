import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'schema-mirror-test-secret';

const { MIGRATIONS } = await import('../server/db.js');
const { MIGRATIONS_SQL } = await import('../server/db-schema-test.js');

const stripComments = (sql) => String(sql)
  .replace(/--[^\n]*/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

function touchedTables(sql) {
  const s = stripComments(sql);
  const out = new Set();
  const patterns = [
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/gi,
    /CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/gi,
    /ALTER\s+TABLE\s+["`]?(\w+)/gi,




    /UPDATE\s+(?!ON\b)["`]?(\w+)/gi,
    /INSERT\s+INTO\s+["`]?(\w+)/gi,
  ];
  for (const re of patterns) {
    for (const m of s.matchAll(re)) out.add(m[1].toLowerCase().replace(/_new$/, ''));
  }
  return out;
}

const mirrorKeys = Object.keys(MIGRATIONS_SQL).map(Number).sort((a, b) => a - b);

// --------------------------------------------------------------------------



// --------------------------------------------------------------------------
test('Vorbedingung: der Spiegel hat überhaupt Einträge, und sie sind vergleichbar', () => {
  assert.ok(mirrorKeys.length >= 20, `nur ${mirrorKeys.length} Einträge - stimmt der Import?`);
  assert.ok(MIGRATIONS.length >= 100, `nur ${MIGRATIONS.length} Migrationen - stimmt der Import?`);
  assert.ok(touchedTables(MIGRATIONS_SQL[1]).has('tasks'), 'Migration 1 muss tasks anlegen');
});

test('Jeder Eintrag trägt die Migration, deren Nummer er führt', () => {
  const wrong = [];

  for (const key of mirrorKeys) {


    // (`locked`, `archived_at`, `visibility`) bereits eingearbeitet. Die Tests

    if (key === 1) continue;

    const migration = MIGRATIONS.find((m) => m.version === key);
    assert.ok(migration, `MIGRATIONS_SQL[${key}] hat keine Migration ${key} in db.js`);



    assert.equal(
      typeof migration.up, 'string',
      `Migration ${key} hat ein Funktions-up und kann nicht gespiegelt werden`,
    );

    const real = touchedTables(migration.up);
    const alien = [...touchedTables(MIGRATIONS_SQL[key])].filter((t) => !real.has(t));
    if (alien.length) {
      wrong.push(`MIGRATIONS_SQL[${key}] fasst ${alien.join(', ')} an - `
        + `Migration ${key} ("${migration.description}") nicht`);
    }
  }

  assert.deepEqual(
    wrong, [],
    'Ein Eintrag des Schema-Spiegels gehoert nicht zu seiner Nummer.\n'
    + 'Ein Test, der ihn faehrt, bekommt ein anderes Schema als er bestellt:\n'
    + wrong.join('\n'),
  );
});

// --------------------------------------------------------------------------



// --------------------------------------------------------------------------
test('Der Spiegel erfindet keine Tabelle, die es im echten Schema nicht gibt', () => {
  const realTables = new Set();
  for (const m of MIGRATIONS) {
    if (typeof m.up === 'string') for (const t of touchedTables(m.up)) realTables.add(t);
  }

  const invented = [];
  for (const key of mirrorKeys) {
    for (const t of touchedTables(MIGRATIONS_SQL[key])) {
      if (!realTables.has(t)) invented.push(`MIGRATIONS_SQL[${key}]: ${t}`);
    }
  }

  assert.deepEqual(invented, [], `Tabellen ohne Entsprechung in db.js:\n${invented.join('\n')}`);
});
