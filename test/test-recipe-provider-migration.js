
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';




// db.js' eigene init()/get()-Instanz (gleiches Muster wie
// test-calendar-outbound-migration.js / test-budget-loans-migration.js).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'aashiyana-recipeprovidermig-')), 'unused.db');
const { MIGRATIONS } = await import('../server/db.js');

function applyMigration(db, migration) {
  if (migration.foreignKeysOff) db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(() => {
      if (typeof migration.up === 'function') {
        migration.up(db);
      } else {
        db.exec(migration.up);
      }
      if (typeof migration.afterUp === 'function') migration.afterUp(db);
      if (migration.foreignKeysOff) {
        assert.deepEqual(db.pragma('foreign_key_check'), []);
      }
      db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)')
        .run(migration.version, migration.description);
    });
    run();
  } finally {
    if (migration.foreignKeysOff) db.pragma('foreign_keys = ON');
  }
}

function buildMigratedDatabase(migrations) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);
  for (const migration of migrations) applyMigration(db, migration);
  return db;
}

function buildPreRenameDatabase(t) {
  const db = buildMigratedDatabase(MIGRATIONS.filter(({ version }) => version <= 133));
  t.after(() => db.close());
  return db;
}



function seedPreMigrationData(db) {
  const userId = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role)
    VALUES ('admin', 'Admin', 'hash', 'admin')
  `).run().lastInsertRowid;

  const accountId = db.prepare(`
    INSERT INTO mealie_accounts (name, base_url, api_token, created_by, last_sync, external_url)
    VALUES ('Zuhause', 'https://mealie.example.test', 'tok-123', ?, '2026-01-01T00:00:00Z', 'https://mealie.public.test')
  `).run(userId).lastInsertRowid;

  const recipeId = db.prepare(`
    INSERT INTO recipes (
      title, notes, recipe_url, created_by,
      mealie_account_id, mealie_recipe_id, mealie_updated_at, mealie_slug, mealie_has_image
    ) VALUES (
      'Gebratener Reis', 'Testnotiz', 'https://mealie.public.test/g/home/r/reis', ?,
      ?, 'uuid-42', '2026-01-02T00:00:00Z', 'reis', 1
    )
  `).run(userId, accountId).lastInsertRowid;

  const ingredientId = db.prepare(`
    INSERT INTO recipe_ingredients (recipe_id, name, quantity, category)
    VALUES (?, 'Reis', '200 g', 'Getreide')
  `).run(recipeId).lastInsertRowid;

  return { userId, accountId, recipeId, ingredientId };
}

test('migration v134: mealie_accounts -> recipe_provider_accounts rename erhält Konto-, Rezept- und Zutatendaten', (t) => {
  const db = buildPreRenameDatabase(t);
  const { accountId, recipeId, ingredientId } = seedPreMigrationData(db);
  const migration = MIGRATIONS.find(({ version }) => version === 134);
  assert.ok(migration, 'migration v134 must exist');

  applyMigration(db, migration);


  assert.throws(() => db.prepare('SELECT * FROM mealie_accounts').get(), /no such table/);

  const account = db.prepare('SELECT * FROM recipe_provider_accounts WHERE id = ?').get(accountId);
  assert.ok(account, 'Konto muss unter dem neuen Tabellennamen erreichbar sein');
  assert.equal(account.name, 'Zuhause');
  assert.equal(account.base_url, 'https://mealie.example.test');
  assert.equal(account.api_token, 'tok-123');
  assert.equal(account.external_url, 'https://mealie.public.test');
  assert.equal(account.provider, 'mealie', 'DEFAULT muss Bestandskonten als mealie markieren');

  const recipe = db.prepare(`
    SELECT provider_account_id, provider_recipe_id, provider_updated_at, provider_slug, provider_has_image, title
    FROM recipes WHERE id = ?
  `).get(recipeId);
  assert.ok(recipe, 'Rezept muss über die neuen Spaltennamen erreichbar sein');
  assert.equal(recipe.provider_account_id, accountId);
  assert.equal(recipe.provider_recipe_id, 'uuid-42');
  assert.equal(recipe.provider_updated_at, '2026-01-02T00:00:00Z');
  assert.equal(recipe.provider_slug, 'reis');
  assert.equal(recipe.provider_has_image, 1);
  assert.equal(recipe.title, 'Gebratener Reis');

  const ingredient = db.prepare('SELECT recipe_id, name, quantity FROM recipe_ingredients WHERE id = ?').get(ingredientId);
  assert.ok(ingredient, 'Zutat darf durch den Rename nicht kaskadiert gelöscht worden sein');
  assert.equal(ingredient.recipe_id, recipeId);
  assert.equal(ingredient.name, 'Reis');
  assert.equal(ingredient.quantity, '200 g');

  assert.deepEqual(db.pragma('foreign_key_check'), [], 'DB muss nach der Migration FK-konsistent bleiben');
});

test('migration v134: provider-CHECK erlaubt mealie/tandoor, lehnt unbekannte Provider ab', (t) => {
  const db = buildPreRenameDatabase(t);
  const { userId } = seedPreMigrationData(db);
  applyMigration(db, MIGRATIONS.find(({ version }) => version === 134));

  assert.doesNotThrow(() => db.prepare(`
    INSERT INTO recipe_provider_accounts (name, base_url, api_token, provider, created_by)
    VALUES ('Tandoor-Zuhause', 'https://tandoor.example.test', 'tok-456', 'tandoor', ?)
  `).run(userId), 'provider=tandoor muss den CHECK passieren');

  assert.throws(() => db.prepare(`
    INSERT INTO recipe_provider_accounts (name, base_url, api_token, provider, created_by)
    VALUES ('RecipeSage', 'https://recipesage.example.test', 'tok-789', 'recipesage', ?)
  `).run(userId), /CHECK constraint failed/, 'unbekannter provider-Wert muss am CHECK scheitern');
});

test('migration v134: updated_at-Trigger feuert nach der Umbenennung weiter', (t) => {
  const db = buildPreRenameDatabase(t);
  const { accountId } = seedPreMigrationData(db);
  applyMigration(db, MIGRATIONS.find(({ version }) => version === 134));

  // trg_mealie_accounts_updated_at feuert AFTER UPDATE ON (jetzt)



  db.prepare("UPDATE recipe_provider_accounts SET updated_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(accountId);
  const row = db.prepare('SELECT updated_at FROM recipe_provider_accounts WHERE id = ?').get(accountId);
  assert.notEqual(row.updated_at, '2000-01-01T00:00:00Z', 'Trigger muss den manuell gesetzten Wert überschreiben');
});

test('migration v134: partieller UNIQUE-Index und ON-DELETE-CASCADE bleiben unter den neuen Spaltennamen aktiv', (t) => {
  const db = buildPreRenameDatabase(t);
  const { userId, accountId, recipeId, ingredientId } = seedPreMigrationData(db);
  applyMigration(db, MIGRATIONS.find(({ version }) => version === 134));

  // idx_recipes_mealie_unique deckte (mealie_account_id, mealie_recipe_id) ab

  // provider_recipe_id) durchsetzen.
  assert.throws(() => db.prepare(`
    INSERT INTO recipes (title, created_by, provider_account_id, provider_recipe_id)
    VALUES ('Duplikat', ?, ?, 'uuid-42')
  `).run(userId, accountId), /UNIQUE constraint failed/);

  // recipes.provider_account_id REFERENCES recipe_provider_accounts(id) ON


  db.prepare('DELETE FROM recipe_provider_accounts WHERE id = ?').run(accountId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE id = ?').get(recipeId).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recipe_ingredients WHERE id = ?').get(ingredientId).n, 0);

  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
