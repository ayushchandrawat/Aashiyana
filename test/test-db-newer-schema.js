import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

delete process.env.DB_ENCRYPTION_KEY;
delete process.env.DB_ALLOW_NEWER_SCHEMA;
const dir = mkdtempSync(join(tmpdir(), 'aashiyana-newer-schema-'));
const dbPath = join(dir, 'aashiyana.db');
let scenario = 0;

function boot() {
  process.env.DB_PATH = dbPath;
  return import(`../server/db.js?newer=${++scenario}`);
}

test.after(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('eine Datenbank dieses Builds startet ohne Befund', async () => {
  const mod = await boot();
  assert.deepEqual(mod.unknownMigrationVersions(mod.get()), []);


  mod.get().prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)')
    .run(999999, 'aus einer neueren Version');
  assert.deepEqual(mod.unknownMigrationVersions(mod.get()), [999999]);
  mod.get().close();
});

test('eine aeltere App verweigert den Start auf der neueren Datenbank und sagt warum', async () => {
  await assert.rejects(boot(), (err) => {
    assert.match(err.message, /newer Aashiyana/, 'die Ursache steht in der Meldung');
    assert.match(err.message, /999999/, 'die unbekannte Nummer steht in der Meldung');
    assert.match(err.message, /DB_ALLOW_NEWER_SCHEMA/, 'der Notfallschalter steht in der Meldung');
    return true;
  });
});

test('DB_ALLOW_NEWER_SCHEMA=1 startet trotzdem, die Datenbank bleibt nutzbar', async () => {
  process.env.DB_ALLOW_NEWER_SCHEMA = '1';
  try {
    const mod = await boot();
    assert.doesNotThrow(() => mod.get().prepare('SELECT 1').get());
    assert.deepEqual(mod.unknownMigrationVersions(mod.get()), [999999],
      'der Schalter umgeht die Pruefung, er repariert nichts');
    mod.get().close();
  } finally {
    delete process.env.DB_ALLOW_NEWER_SCHEMA;
  }
});

test('ein leerer Wert des Schalters zaehlt nicht als gesetzt', async () => {
  process.env.DB_ALLOW_NEWER_SCHEMA = '';
  try {
    await assert.rejects(boot(), /newer Aashiyana/);
  } finally {
    delete process.env.DB_ALLOW_NEWER_SCHEMA;
  }
});
