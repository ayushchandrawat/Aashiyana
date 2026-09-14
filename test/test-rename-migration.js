
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';

let scenarioCounter = 0;


async function bootDb(dbPath) {
  if (dbPath === null) {
    delete process.env.DB_PATH;
  } else {
    process.env.DB_PATH = dbPath;
  }
  const mod = await import(`../server/db.js?scenario=${++scenarioCounter}`);
  mod.init();
  return mod;
}


function seedLegacyDb(filePath, marker) {
  const seed = new Database(filePath);
  seed.exec('CREATE TABLE rename_marker (note TEXT)');
  seed.prepare('INSERT INTO rename_marker (note) VALUES (?)').run(marker);
  seed.close();
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'aashiyana-rename-'));
}

test('Stale Legacy-Sidecars (-wal/-shm) werden nach erfolgreichem Checkpoint entfernt', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'oikos.db');
  const target = join(dir, 'aashiyana.db');
  seedLegacyDb(legacy, 'sidecar-cleanup');

  writeFileSync(`${legacy}-wal`, '');
  writeFileSync(`${legacy}-shm`, '');

  const mod = await bootDb(legacy);

  assert.ok(existsSync(target), 'aashiyana.db muss existieren');
  assert.ok(!existsSync(`${legacy}-wal`), 'Legacy -wal muss entfernt sein');
  assert.ok(!existsSync(`${legacy}-shm`), 'Legacy -shm muss entfernt sein');
  const row = mod.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'sidecar-cleanup', 'Daten müssen erhalten bleiben');
});

test('Legacy-Default: DB_PATH=…/oikos.db wird nach aashiyana.db migriert (Daten erhalten)', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'oikos.db');
  const target = join(dir, 'aashiyana.db');
  seedLegacyDb(legacy, 'legacy-default');

  const mod = await bootDb(legacy);

  assert.ok(existsSync(target), 'aashiyana.db muss nach der Migration existieren');
  assert.ok(!existsSync(legacy), 'oikos.db darf nach der Migration nicht mehr existieren');
  assert.equal(mod.getPath(), target, 'getPath() muss den neuen Pfad liefern');
  const row = mod.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'legacy-default', 'Marker-Daten müssen erhalten bleiben');
});

test('Compose-Update-Falle: DB_PATH=…/aashiyana.db migriert vorhandene oikos.db trotzdem', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'oikos.db');
  const target = join(dir, 'aashiyana.db');
  seedLegacyDb(legacy, 'compose-update');



  const mod = await bootDb(target);

  assert.ok(existsSync(target), 'aashiyana.db muss existieren');
  assert.ok(!existsSync(legacy), 'oikos.db muss migriert worden sein');
  const row = mod.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'compose-update');
});

test('Custom-Pfad: DB_PATH=…/familie.db wird respektiert, oikos.db bleibt unangetastet', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'oikos.db');
  const custom = join(dir, 'familie.db');
  seedLegacyDb(legacy, 'should-stay');

  const mod = await bootDb(custom);

  assert.equal(mod.getPath(), custom, 'Custom-Pfad muss verwendet werden');
  assert.ok(existsSync(custom), 'familie.db muss angelegt sein');
  assert.ok(existsSync(legacy), 'oikos.db darf NICHT migriert werden (Custom-Layout)');

  const marker = mod.get()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rename_marker'")
    .get();
  assert.equal(marker, undefined, 'Custom-DB darf die oikos-Marker-Daten nicht enthalten');
});

test('Doppelzustand: existieren beide, gewinnt aashiyana.db und oikos.db bleibt liegen', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'oikos.db');
  const target = join(dir, 'aashiyana.db');
  seedLegacyDb(legacy, 'legacy-loser');
  seedLegacyDb(target, 'target-winner');

  const mod = await bootDb(target);

  assert.ok(existsSync(legacy), 'oikos.db muss im Doppelzustand erhalten bleiben');
  const row = mod.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'target-winner', 'Die bestehende aashiyana.db gewinnt');
});

test('Frische Installation: kein Legacy-File → aashiyana.db wird neu angelegt', async () => {
  const dir = tmpDir();
  const target = join(dir, 'aashiyana.db');

  const mod = await bootDb(target);

  assert.ok(existsSync(target), 'aashiyana.db muss frisch angelegt werden');
  assert.ok(!existsSync(join(dir, 'oikos.db')), 'keine oikos.db bei frischer Installation');
});

test('Migration ist idempotent: zweiter Boot mit bereits migrierter aashiyana.db ist ein No-Op', async () => {
  const dir = tmpDir();
  const legacy = join(dir, 'oikos.db');
  const target = join(dir, 'aashiyana.db');
  seedLegacyDb(legacy, 'idempotent');

  await bootDb(legacy);              // erster Boot migriert
  assert.ok(!existsSync(legacy));

  const mod2 = await bootDb(target); // zweiter Boot: nichts zu migrieren
  const row = mod2.get().prepare('SELECT note FROM rename_marker').get();
  assert.equal(row.note, 'idempotent', 'Daten bleiben über mehrere Boots stabil');
});
