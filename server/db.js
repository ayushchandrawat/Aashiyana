
import Database from 'better-sqlite3-multiple-ciphers';
import path from 'path';
import fs from 'node:fs/promises';
import { mkdirSync, existsSync, renameSync, rmSync, copyFileSync, openSync, readSync, closeSync } from 'node:fs';
import { createLogger } from './logger.js';
import { decodeHtmlEntities } from './utils/html-entities.js';
import { toE164, defaultCountryFromConfig } from './utils/phone.js';

const log = createLogger('DB');

const DB_KEY = process.env.DB_ENCRYPTION_KEY;

// --------------------------------------------------------

// --------------------------------------------------------
//

// (bzw. `/data/oikos.db` in allen ausgelieferten Docker-Templates). Damit

// effektiven Pfad ab:
//   - kein DB_PATH gesetzt              → <root>/aashiyana.db
//   - DB_PATH endet auf oikos.db        → <dir>/aashiyana.db  (Legacy-Default erkannt)
//   - DB_PATH endet auf aashiyana.db       → <dir>/aashiyana.db  (neuer Default)





let DB_PATH;
let LEGACY_DB_PATH;
{
  const configured = process.env.DB_PATH;
  const baseDir = configured
    ? path.dirname(configured)
    : path.join(import.meta.dirname, '..');
  const base = configured ? path.basename(configured) : null;
  const isManagedLayout = !configured || base === 'oikos.db' || base === 'aashiyana.db';
  DB_PATH = isManagedLayout ? path.join(baseDir, 'aashiyana.db') : configured;
  LEGACY_DB_PATH = isManagedLayout ? path.join(baseDir, 'oikos.db') : null;
}

function migrateLegacyDbFile() {
  if (!LEGACY_DB_PATH) return;             // Custom-Pfad → keine Migration
  if (existsSync(DB_PATH)) {
    if (existsSync(LEGACY_DB_PATH)) {
      log.warn(
        `Both ${path.basename(DB_PATH)} and legacy ${path.basename(LEGACY_DB_PATH)} exist — ` +
        `using ${path.basename(DB_PATH)} and leaving the legacy file untouched.`
      );
    }
    return;                                // bereits migriert / frisch
  }
  if (!existsSync(LEGACY_DB_PATH)) return;  // nichts zu migrieren

  log.info(`Legacy database detected — migrating ${LEGACY_DB_PATH} → ${DB_PATH}`);





  //    WAL liegen; dann NICHT teil-migrieren.
  let checkpointed = false;
  try {






    const encrypted = !isPlaintextDatabase(LEGACY_DB_PATH);
    const legacy = new Database(LEGACY_DB_PATH);
    try {
      if (encrypted) applyEncryptionKey(legacy);





      const [row] = legacy.pragma('wal_checkpoint(TRUNCATE)');
      checkpointed = row != null && row.busy === 0;
      if (!checkpointed) {
        log.warn(`Legacy checkpoint incomplete (busy=${row?.busy}).`);
      }
    } finally {
      legacy.close();
    }
  } catch (err) {
    log.warn(`Legacy checkpoint failed (${err?.message}).`);
  }

  if (!checkpointed) {



    log.warn(`Deferring migration — continuing on legacy path ${LEGACY_DB_PATH}.`);
    DB_PATH = LEGACY_DB_PATH;
    return;
  }


  //    umbenennen; die nun leeren Legacy-Sidecars best-effort entfernen (SQLite

  try {
    renameSync(LEGACY_DB_PATH, DB_PATH);
    for (const suffix of ['-wal', '-shm']) {
      const stale = `${LEGACY_DB_PATH}${suffix}`;
      if (existsSync(stale)) {
        try { rmSync(stale); } catch { /* harmlos: leeres/locked Sidecar */ }
      }
    }
    log.info(`Database migrated to ${DB_PATH}`);
  } catch (err) {

    log.warn(
      `Could not rename legacy database (${err?.message}); ` +
      `continuing on legacy path ${LEGACY_DB_PATH}.`
    );
    DB_PATH = LEGACY_DB_PATH;
  }
}

let db;

// --------------------------------------------------------
// Initialisierung
// --------------------------------------------------------

function init({ plaintextBackup = true } = {}) {
  if (db) return db;
  if (!path.isAbsolute(DB_PATH)) {
    log.warn(
      `DB_PATH "${DB_PATH}" is a relative path — inside Docker this resolves to ` +
      `"${path.resolve(DB_PATH)}", which is NOT the mounted volume. ` +
      `Data will be lost on container restart. Use an absolute path, e.g. DB_PATH=/data/aashiyana.db`
    );
  }
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  migrateLegacyDbFile();



  if (DB_KEY) {
    assertKeyIsNotPlaceholder();
    assertCipherSupport();
    encryptPlaintextDatabase({ backup: plaintextBackup });
  }

  db = new Database(DB_PATH);

  applyEncryptionKey(db);

  if (DB_KEY) {

    try {
      assertReadable(db);
    } catch {
      throw new Error(
        `[DB] Wrong encryption key — ${DB_PATH} could not be decrypted. ` +
        'Check DB_ENCRYPTION_KEY against the value used when the database was created.'
      );
    }
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');

  migrate();
  reconcileCriticalSchema();


  // dass diese Version scheitert, sondern was sie zwischendurch schreibt -





  // genannt, damit er kein Dauerzustand wird.
  const unknown = unknownMigrationVersions(db);
  if (unknown.length > 0) {
    const detail =
      `This database was written by a newer Aashiyana: it carries migration ${unknown.join(', ')} ` +
      `and this build knows up to v${latestKnownVersion()}.`;
    if (!allowNewerSchema()) {
      db.close();
      db = null;
      throw new Error(
        `[DB] ${detail} Running an older version on a newer database is not supported: what it ` +
        'writes in the meantime can be lost on the next update. Update Aashiyana to the version ' +
        'that wrote this database, or restore the backup taken before that update. To start ' +
        'anyway, at your own risk, set DB_ALLOW_NEWER_SCHEMA=1.'
      );
    }
    log.warn(
      `${detail} Started anyway because DB_ALLOW_NEWER_SCHEMA is set. What this version writes ` +
      'can be lost on the next update: take a backup now and update as soon as you can.'
    );
  }



  if (DB_KEY) assertStoredEncrypted();

  log.info(`Connected: ${DB_PATH} | Schema v${currentVersion()}`);
  return db;
}

function assertKeyIsNotPlaceholder() {
  if (!DB_KEY.startsWith('REPLACE_WITH_')) return;

  if (!existsSync(DB_PATH)) {
    throw new Error(
      '[DB] DB_ENCRYPTION_KEY is still the placeholder from .env.example ' +
      `(${DB_KEY}). That value is published in this repository, so it protects ` +
      'nothing. Generate a real one with `openssl rand -hex 32` and put it in ' +
      '.env, or clear the line entirely to run without encryption.'
    );
  }

  log.warn(
    'DB_ENCRYPTION_KEY is the placeholder from .env.example, so this database is ' +
    'encrypted with a publicly known value and is not protected. To rotate: stop ' +
    `the app, copy ${DB_PATH} somewhere safe, then open the database with the old ` +
    'key and run `PRAGMA rekey` with a value from `openssl rand -hex 32` before ' +
    'putting that same value into .env.'
  );
}

function applyEncryptionKey(database) {
  if (!DB_KEY) return;

  // SQLCipher-Format (statt des Default-Ciphers ChaCha20).
  database.pragma("cipher = 'sqlcipher'");
  database.pragma(`key="x'${Buffer.from(DB_KEY, 'utf8').toString('hex')}'"`);
}

function assertReadable(database) {
  database.prepare('SELECT count(*) FROM sqlite_master').get();
}

function assertCipherSupport() {
  const probe = new Database(':memory:');
  try {
    probe.prepare('SELECT sqlite3mc_version() AS version').get();
  } catch {
    throw new Error(
      '[DB] DB_ENCRYPTION_KEY is set, but the installed SQLite binding has no ' +
      'encryption support (expected better-sqlite3-multiple-ciphers). Refusing ' +
      'to start rather than storing your data unencrypted.'
    );
  } finally {
    probe.close();
  }
}

const SQLITE_PLAINTEXT_HEADER = Buffer.from('SQLite format 3\0', 'binary');

function isPlaintextDatabase(filePath) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const head = Buffer.alloc(SQLITE_PLAINTEXT_HEADER.length);
    const bytesRead = readSync(fd, head, 0, head.length, 0);
    return bytesRead === head.length && head.equals(SQLITE_PLAINTEXT_HEADER);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* Datei ist ohnehin gleich zu */ }
    }
  }
}

function encryptPlaintextDatabase({ backup = true } = {}) {
  if (!existsSync(DB_PATH)) return;           // Neuinstallation
  if (!isPlaintextDatabase(DB_PATH)) return;




  let backupPath = null;
  if (backup) {
    backupPath = `${DB_PATH}.plaintext-backup`;
    if (existsSync(backupPath)) {
      backupPath = `${DB_PATH}.plaintext-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    }
  }
  const workingPath = `${DB_PATH}.encrypting`;

  log.warn(`${DB_PATH} is unencrypted but DB_ENCRYPTION_KEY is set — encrypting now.`);









  let checkpointed = false;
  const source = new Database(DB_PATH);
  try {
    const [row] = source.pragma('wal_checkpoint(TRUNCATE)');
    checkpointed = row != null && row.busy === 0;
    if (!checkpointed) {
      log.warn(`WAL checkpoint incomplete (busy=${row?.busy}) — not encrypting a partial copy.`);
    }
  } finally {
    source.close();
  }

  if (!checkpointed) {
    throw new Error(
      `[DB] Cannot encrypt ${DB_PATH}: its write-ahead log could not be checkpointed, ` +
      'which means another connection is still using the database. Encrypting now ' +
      'would risk losing committed data. Make sure no second instance is running ' +
      'against this volume and start again.'
    );
  }

  if (backupPath) copyFileSync(DB_PATH, backupPath);
  copyFileSync(DB_PATH, workingPath);

  try {
    const working = new Database(workingPath);
    try {

      working.pragma('journal_mode = DELETE');
      working.pragma("cipher = 'sqlcipher'");
      working.pragma(`rekey="x'${Buffer.from(DB_KEY, 'utf8').toString('hex')}'"`);
      working.pragma('journal_mode = WAL');
    } finally {
      working.close();
    }
  } catch (err) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(`${workingPath}${suffix}`, { force: true }); } catch { /* Aufräumen ist best-effort */ }
    }
    throw new Error(
      `[DB] Encrypting the existing database failed (${err?.message}). ` +
      `The original database is untouched at ${DB_PATH}.`
    );
  }

  renameSync(workingPath, DB_PATH);



  for (const suffix of ['-wal', '-shm']) {
    try { rmSync(`${DB_PATH}${suffix}`, { force: true }); } catch { /* SQLite legt sie neu an */ }
    try { rmSync(`${workingPath}${suffix}`, { force: true }); } catch { /* dito */ }
  }

  if (!backupPath) {
    log.info('Database encrypted (AES-256).');
    return;
  }

  log.info(`Database encrypted (AES-256). Plaintext backup: ${backupPath}`);
  log.warn(
    `${backupPath} still contains UNENCRYPTED data — delete it once you have ` +
    'verified that the app starts and your data is complete.'
  );
}

function assertStoredEncrypted() {
  if (!isPlaintextDatabase(DB_PATH)) return;
  throw new Error(
    `[DB] DB_ENCRYPTION_KEY is set, but ${DB_PATH} is stored unencrypted. ` +
    'Refusing to continue — your data would not be protected.'
  );
}

// --------------------------------------------------------
// Migrations-Engine
// --------------------------------------------------------

const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema',
    up: `
      -- Benutzer
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    UNIQUE NOT NULL,
        display_name  TEXT    NOT NULL,
        password_hash TEXT    NOT NULL,
        avatar_color  TEXT    NOT NULL DEFAULT '#007AFF',
        role          TEXT    NOT NULL DEFAULT 'member'
                              CHECK(role IN ('admin', 'member')),
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Aufgaben
      CREATE TABLE IF NOT EXISTS tasks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        description     TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        priority        TEXT    NOT NULL DEFAULT 'none'
                                CHECK(priority IN ('none', 'low', 'medium', 'high', 'urgent')),
        status          TEXT    NOT NULL DEFAULT 'open'
                                CHECK(status IN ('open', 'in_progress', 'done')),
        due_date        TEXT,
        due_time        TEXT,
        assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        parent_task_id  INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Einkaufslisten
      CREATE TABLE IF NOT EXISTS shopping_lists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );


      CREATE TABLE IF NOT EXISTS meals (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        date       TEXT    NOT NULL,
        meal_type  TEXT    NOT NULL
                           CHECK(meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
        title      TEXT    NOT NULL,
        notes      TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Einkaufsartikel (nach meals, wegen added_from_meal FK)
      CREATE TABLE IF NOT EXISTS shopping_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id         INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
        name            TEXT    NOT NULL,
        quantity        TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        is_checked      INTEGER NOT NULL DEFAULT 0,
        added_from_meal INTEGER REFERENCES meals(id) ON DELETE SET NULL,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Mahlzeit-Zutaten
      CREATE TABLE IF NOT EXISTS meal_ingredients (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        meal_id          INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
        name             TEXT    NOT NULL,
        quantity         TEXT,
        on_shopping_list INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Kalender-Events
      CREATE TABLE IF NOT EXISTS calendar_events (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        title                TEXT    NOT NULL,
        description          TEXT,
        start_datetime       TEXT    NOT NULL,
        end_datetime         TEXT,
        all_day              INTEGER NOT NULL DEFAULT 0,
        location             TEXT,
        color                TEXT    NOT NULL DEFAULT '#007AFF',
        assigned_to          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        external_calendar_id TEXT,
        external_source      TEXT    NOT NULL DEFAULT 'local'
                                     CHECK(external_source IN ('local', 'google', 'apple')),
        recurrence_rule      TEXT,
        created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Pinnwand / Notizen
      CREATE TABLE IF NOT EXISTS notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT,
        content    TEXT    NOT NULL,
        color      TEXT    NOT NULL DEFAULT '#FFEB3B',
        pinned     INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Kontakte
      CREATE TABLE IF NOT EXISTS contacts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        category   TEXT    NOT NULL DEFAULT 'Sonstiges',
        phone      TEXT,
        email      TEXT,
        address    TEXT,
        notes      TEXT,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Budget
      CREATE TABLE IF NOT EXISTS budget_entries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        amount          REAL    NOT NULL,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        date            TEXT    NOT NULL,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- --------------------------------------------------------
      -- updated_at Trigger (automatisch bei UPDATE setzen)
      -- --------------------------------------------------------
      CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
        AFTER UPDATE ON users FOR EACH ROW
        BEGIN UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_tasks_updated_at
        AFTER UPDATE ON tasks FOR EACH ROW
        BEGIN UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_shopping_lists_updated_at
        AFTER UPDATE ON shopping_lists FOR EACH ROW
        BEGIN UPDATE shopping_lists SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_shopping_items_updated_at
        AFTER UPDATE ON shopping_items FOR EACH ROW
        BEGIN UPDATE shopping_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_meals_updated_at
        AFTER UPDATE ON meals FOR EACH ROW
        BEGIN UPDATE meals SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_meal_ingredients_updated_at
        AFTER UPDATE ON meal_ingredients FOR EACH ROW
        BEGIN UPDATE meal_ingredients SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_calendar_events_updated_at
        AFTER UPDATE ON calendar_events FOR EACH ROW
        BEGIN UPDATE calendar_events SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_notes_updated_at
        AFTER UPDATE ON notes FOR EACH ROW
        BEGIN UPDATE notes SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_contacts_updated_at
        AFTER UPDATE ON contacts FOR EACH ROW
        BEGIN UPDATE contacts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_budget_entries_updated_at
        AFTER UPDATE ON budget_entries FOR EACH ROW
        BEGIN UPDATE budget_entries SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      -- --------------------------------------------------------
      -- Indizes
      -- --------------------------------------------------------
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to    ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date       ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_status         ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent         ON tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_shopping_items_list  ON shopping_items(list_id);
      CREATE INDEX IF NOT EXISTS idx_meals_date           ON meals(date);
      CREATE INDEX IF NOT EXISTS idx_calendar_start       ON calendar_events(start_datetime);
      CREATE INDEX IF NOT EXISTS idx_calendar_assigned    ON calendar_events(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_notes_pinned         ON notes(pinned);
      CREATE INDEX IF NOT EXISTS idx_budget_date          ON budget_entries(date);
      CREATE INDEX IF NOT EXISTS idx_budget_created_by    ON budget_entries(created_by);
    `,
  },
  {
    version: 2,
    description: 'Sync configuration table for Google/Apple Calendar',
    up: `
      CREATE TABLE IF NOT EXISTS sync_config (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_calendar_external_id ON calendar_events(external_calendar_id);
    `,
  },
  {
    version: 3,
    description: 'Recurring budget entries: parent reference and skip table',
    up: `
      ALTER TABLE budget_entries ADD COLUMN recurrence_parent_id INTEGER
        REFERENCES budget_entries(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS budget_recurrence_skipped (
        parent_id INTEGER NOT NULL REFERENCES budget_entries(id) ON DELETE CASCADE,
        month     TEXT    NOT NULL,
        PRIMARY KEY (parent_id, month)
      );

      CREATE INDEX IF NOT EXISTS idx_budget_parent ON budget_entries(recurrence_parent_id);
    `,
  },
  {
    version: 4,
    description: 'Allow "none" priority and set it as default',
    up: `
      -- SQLite erlaubt kein ALTER CHECK, daher Tabelle neu erstellen
      CREATE TABLE tasks_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        description     TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        priority        TEXT    NOT NULL DEFAULT 'none'
                                CHECK(priority IN ('none', 'low', 'medium', 'high', 'urgent')),
        status          TEXT    NOT NULL DEFAULT 'open'
                                CHECK(status IN ('open', 'in_progress', 'done')),
        due_date        TEXT,
        due_time        TEXT,
        assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        parent_task_id  INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO tasks_new SELECT * FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      CREATE INDEX IF NOT EXISTS idx_tasks_status         ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned       ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent         ON tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_due            ON tasks(due_date);
    `,
  },
  {
    version: 5,
    description: 'Shopping categories as a separate table (customizable, sortable)',
    up: `
      CREATE TABLE IF NOT EXISTS shopping_categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        icon       TEXT    NOT NULL DEFAULT 'tag',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO shopping_categories (name, icon, sort_order) VALUES
        ('Obst & Gemüse',   'apple',           0),
        ('Backwaren',        'wheat',           1),
        ('Milchprodukte',    'milk',            2),
        ('Fleisch & Fisch',  'beef',            3),
        ('Tiefkühl',         'snowflake',       4),
        ('Getränke',         'cup-soda',        5),
        ('Haushalt',         'spray-can',       6),
        ('Drogerie',         'pill',            7),
        ('Sonstiges',        'shopping-basket', 8);
    `,
  },
  {
    version: 6,
    description: 'Recipe URL for meals',
    up: `
      ALTER TABLE meals ADD COLUMN recipe_url TEXT;
    `,
  },
  {
    version: 7,
    description: 'Category per ingredient for shopping list transfer',
    up: `
      ALTER TABLE meal_ingredients ADD COLUMN category TEXT NOT NULL DEFAULT 'Sonstiges';
    `,
  },
  {
    version: 8,
    description: 'Reminders for tasks and calendar events',
    up: `
      CREATE TABLE IF NOT EXISTS reminders (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL CHECK(entity_type IN ('task', 'event')),
        entity_id   INTEGER NOT NULL,
        remind_at   TEXT    NOT NULL,
        dismissed   INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_reminders_entity ON reminders(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_remind ON reminders(remind_at);
      CREATE INDEX IF NOT EXISTS idx_reminders_user   ON reminders(created_by);
    `,
  },
  {
    version: 9,
    description: 'Migrate task categories to English keys',
    up: `
      UPDATE tasks SET category = CASE category
        WHEN 'Haushalt'   THEN 'household'
        WHEN 'Schule'     THEN 'school'
        WHEN 'Einkauf'    THEN 'shopping'
        WHEN 'Reparatur'  THEN 'repair'
        WHEN 'Gesundheit' THEN 'health'
        WHEN 'Finanzen'   THEN 'finance'
        WHEN 'Freizeit'   THEN 'leisure'
        WHEN 'Sonstiges'  THEN 'misc'
        ELSE category
      END;
    `,
  },
  {
    version: 10,
    description: 'ICS subscriptions table',
    up: `
      CREATE TABLE IF NOT EXISTS ics_subscriptions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        url           TEXT    NOT NULL,
        color         TEXT    NOT NULL DEFAULT '#6366f1',
        shared        INTEGER NOT NULL DEFAULT 0,
        created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        etag          TEXT,
        last_modified TEXT,
        last_sync     TEXT,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
    `,
  },
  {
    version: 11,
    description: 'calendar_events: external_source ICS, subscription_id, user_modified',
    up: `
      CREATE TABLE calendar_events_new (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        title                TEXT    NOT NULL,
        description          TEXT,
        start_datetime       TEXT    NOT NULL,
        end_datetime         TEXT,
        all_day              INTEGER NOT NULL DEFAULT 0,
        location             TEXT,
        color                TEXT    NOT NULL DEFAULT '#007AFF',
        assigned_to          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        external_calendar_id TEXT,
        external_source      TEXT    NOT NULL DEFAULT 'local'
                                     CHECK(external_source IN ('local', 'google', 'apple', 'ics')),
        recurrence_rule      TEXT,
        subscription_id      INTEGER REFERENCES ics_subscriptions(id) ON DELETE CASCADE,
        user_modified        INTEGER NOT NULL DEFAULT 0,
        created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO calendar_events_new
        (id, title, description, start_datetime, end_datetime, all_day, location, color,
         assigned_to, created_by, external_calendar_id, external_source, recurrence_rule,
         subscription_id, user_modified, created_at, updated_at)
      SELECT id, title, description, start_datetime, end_datetime, all_day, location, color,
             assigned_to, created_by, external_calendar_id, external_source, recurrence_rule,
             NULL, 0, created_at, updated_at
      FROM calendar_events;

      DROP TRIGGER IF EXISTS trg_calendar_events_updated_at;
      DROP TABLE calendar_events;
      ALTER TABLE calendar_events_new RENAME TO calendar_events;

      CREATE TRIGGER trg_calendar_events_updated_at
        AFTER UPDATE ON calendar_events FOR EACH ROW
        BEGIN UPDATE calendar_events SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE INDEX IF NOT EXISTS idx_calendar_start       ON calendar_events(start_datetime);
      CREATE INDEX IF NOT EXISTS idx_calendar_assigned    ON calendar_events(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_calendar_external_id ON calendar_events(external_calendar_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_sub         ON calendar_events(subscription_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_sub_extid
        ON calendar_events (subscription_id, external_calendar_id)
        WHERE subscription_id IS NOT NULL;
    `,
  },
  {
    version: 12,
    description: 'calendar_events: replace partial unique index with full index (ON CONFLICT support)',
    up: `
      DROP INDEX IF EXISTS idx_calendar_sub_extid;
      CREATE UNIQUE INDEX idx_calendar_sub_extid
        ON calendar_events (subscription_id, external_calendar_id);
    `,
  },
  {
    version: 13,
    description: 'Recipes table and meal association',
    up: `
      CREATE TABLE IF NOT EXISTS recipes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT    NOT NULL,
        notes      TEXT,
        recipe_url TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        quantity   TEXT,
        category   TEXT    NOT NULL DEFAULT 'Sonstiges',
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_recipes_title ON recipes(title);
      CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);

      CREATE TRIGGER IF NOT EXISTS trg_recipes_updated_at
        AFTER UPDATE ON recipes FOR EACH ROW
        BEGIN UPDATE recipes SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_recipe_ingredients_updated_at
        AFTER UPDATE ON recipe_ingredients FOR EACH ROW
        BEGIN UPDATE recipe_ingredients SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      ALTER TABLE meals ADD COLUMN recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_meals_recipe_id ON meals(recipe_id);
    `,
  },
  {
    version: 14,
    description: 'External calendar metadata (name, color) and event association',
    up: `
      CREATE TABLE IF NOT EXISTS external_calendars (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        source      TEXT    NOT NULL CHECK(source IN ('google', 'apple')),
        external_id TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        color       TEXT,
        UNIQUE(source, external_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ext_cal_source ON external_calendars(source, external_id);

      ALTER TABLE calendar_events ADD COLUMN calendar_ref_id INTEGER
        REFERENCES external_calendars(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_cal_events_ref ON calendar_events(calendar_ref_id);
    `,
  },
  {
    version: 15,
    description: 'Budget expense categories as stable keys with subcategories',
    up: `
      ALTER TABLE budget_entries ADD COLUMN subcategory TEXT NOT NULL DEFAULT '';

      UPDATE budget_entries
      SET category = CASE category
        WHEN 'Lebensmittel' THEN 'food'
        WHEN 'Miete' THEN 'housing'
        WHEN 'Versicherung' THEN 'financial_other'
        WHEN 'Mobilität' THEN 'transport'
        WHEN 'Freizeit' THEN 'leisure'
        WHEN 'Kleidung' THEN 'shopping_clothing'
        WHEN 'Gesundheit' THEN 'personal_health'
        WHEN 'Bildung' THEN 'education'
        WHEN 'Sonstiges' THEN 'financial_other'
        ELSE category
      END
      WHERE amount < 0;

      UPDATE budget_entries
      SET subcategory = CASE category
        WHEN 'housing' THEN 'rent_mortgage'
        WHEN 'food' THEN 'groceries'
        WHEN 'transport' THEN 'fuel'
        WHEN 'personal_health' THEN 'pharmacy'
        WHEN 'leisure' THEN 'events'
        WHEN 'shopping_clothing' THEN 'clothes_shoes'
        WHEN 'education' THEN 'courses_college'
        WHEN 'financial_other' THEN 'insurance_other'
        ELSE ''
      END
      WHERE amount < 0 AND subcategory = '';

      UPDATE budget_entries
      SET category = 'Sonstiges Einkommen'
      WHERE amount > 0 AND category = 'Sonstiges';
    `,
  },
  {
    version: 16,
    description: 'Move budget categories and subcategories to separate tables',
    up: `
      CREATE TABLE IF NOT EXISTS budget_categories (
        key        TEXT PRIMARY KEY,
        name       TEXT    NOT NULL,
        type       TEXT    NOT NULL CHECK(type IN ('expense', 'income')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS budget_subcategories (
        key          TEXT PRIMARY KEY,
        category_key TEXT    NOT NULL REFERENCES budget_categories(key) ON DELETE CASCADE,
        name         TEXT    NOT NULL,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(category_key, name)
      );

      INSERT OR IGNORE INTO budget_categories (key, name, type, sort_order) VALUES
        ('housing', 'Housing / Home', 'expense', 0),
        ('food', 'Food', 'expense', 1),
        ('transport', 'Transport', 'expense', 2),
        ('personal_health', 'Personal Care / Health', 'expense', 3),
        ('leisure', 'Leisure and Entertainment', 'expense', 4),
        ('shopping_clothing', 'Shopping and Clothing', 'expense', 5),
        ('education', 'Education', 'expense', 6),
        ('financial_other', 'Financial Services and Other', 'expense', 7),
        ('Erwerbseinkommen', 'Erwerbseinkommen', 'income', 0),
        ('Kapitalerträge', 'Kapitalerträge', 'income', 1),
        ('Geschenke & Transfers', 'Geschenke & Transfers', 'income', 2),
        ('Sozialleistungen', 'Sozialleistungen', 'income', 3),
        ('Sonstiges Einkommen', 'Sonstiges Einkommen', 'income', 4);

      INSERT OR IGNORE INTO budget_subcategories (key, category_key, name, sort_order) VALUES
        ('rent_mortgage', 'housing', 'Rent / Mortgage', 0),
        ('condominium', 'housing', 'Condominium fees', 1),
        ('utilities', 'housing', 'Electricity / Water / Gas', 2),
        ('internet_tv_phone', 'housing', 'Internet / TV / Phone', 3),
        ('renovation_maintenance', 'housing', 'Renovation / Maintenance', 4),
        ('cleaning', 'housing', 'Cleaning', 5),
        ('groceries', 'food', 'Groceries', 0),
        ('restaurants_bars', 'food', 'Restaurants / Bars', 1),
        ('snacks_fast_food', 'food', 'Snacks / Fast Food', 2),
        ('bakery', 'food', 'Bakery', 3),
        ('fuel', 'transport', 'Fuel', 0),
        ('parking_tolls', 'transport', 'Parking / Tolls', 1),
        ('public_transport', 'transport', 'Public transport', 2),
        ('apps_taxi', 'transport', 'Apps / Taxi', 3),
        ('maintenance_insurance', 'transport', 'Maintenance / Insurance', 4),
        ('pharmacy', 'personal_health', 'Pharmacy', 0),
        ('health_insurance', 'personal_health', 'Health insurance', 1),
        ('gym_sports', 'personal_health', 'Gym / Sports', 2),
        ('beauty_cosmetics', 'personal_health', 'Beauty / Cosmetics', 3),
        ('travel', 'leisure', 'Travel', 0),
        ('streaming', 'leisure', 'Streaming', 1),
        ('events', 'leisure', 'Events', 2),
        ('hobbies', 'leisure', 'Hobbies', 3),
        ('clothes_shoes', 'shopping_clothing', 'Clothes / Shoes', 0),
        ('electronics', 'shopping_clothing', 'Electronics', 1),
        ('gifts', 'shopping_clothing', 'Gifts', 2),
        ('courses_college', 'education', 'Courses / College', 0),
        ('school_supplies', 'education', 'School supplies', 1),
        ('languages', 'education', 'Languages', 2),
        ('loans_interest', 'financial_other', 'Loans / Interest', 0),
        ('bank_fees', 'financial_other', 'Bank fees', 1),
        ('insurance_other', 'financial_other', 'Insurance', 2),
        ('investments', 'financial_other', 'Investments', 3),
        ('taxes', 'financial_other', 'Taxes', 4);

      INSERT OR IGNORE INTO budget_categories (key, name, type, sort_order)
      SELECT category, category, CASE WHEN amount < 0 THEN 'expense' ELSE 'income' END, 1000
      FROM budget_entries
      WHERE category NOT IN (SELECT key FROM budget_categories)
      GROUP BY category;

      INSERT OR IGNORE INTO budget_subcategories (key, category_key, name, sort_order)
      SELECT subcategory, category, subcategory, 1000
      FROM budget_entries
      WHERE subcategory != ''
        AND subcategory NOT IN (SELECT key FROM budget_subcategories)
        AND category IN (SELECT key FROM budget_categories WHERE type = 'expense')
      GROUP BY category, subcategory;
    `,
  },
  {
    version: 17,
    description: 'API tokens for non-interactive authentication',
    up: `
      CREATE TABLE IF NOT EXISTS api_tokens (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,
        token_hash   TEXT    NOT NULL UNIQUE,
        token_prefix TEXT    NOT NULL,
        created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at   TEXT,
        revoked_at   TEXT,
        last_used_at TEXT,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_created_by ON api_tokens(created_by);
    `,
  },
  {
    version: 18,
    description: 'Birthdays with calendar integration',
    up: `
      CREATE TABLE IF NOT EXISTS birthdays (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT    NOT NULL,
        birth_date        TEXT    NOT NULL,
        notes             TEXT,
        photo_data        TEXT,
        calendar_event_id INTEGER REFERENCES calendar_events(id) ON DELETE SET NULL,
        created_by        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TRIGGER IF NOT EXISTS trg_birthdays_updated_at
        AFTER UPDATE ON birthdays FOR EACH ROW
        BEGIN UPDATE birthdays SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE INDEX IF NOT EXISTS idx_birthdays_name         ON birthdays(name);
      CREATE INDEX IF NOT EXISTS idx_birthdays_birth_date   ON birthdays(birth_date);
      CREATE INDEX IF NOT EXISTS idx_birthdays_created_by   ON birthdays(created_by);
      CREATE INDEX IF NOT EXISTS idx_birthdays_calendar_ref ON birthdays(calendar_event_id);
    `,
  },
  {
    version: 19,
    description: 'Separate family member role from system access role',
    up: `
      ALTER TABLE users ADD COLUMN family_role TEXT NOT NULL DEFAULT 'other'
        CHECK(family_role IN ('dad', 'mom', 'parent', 'child', 'grandparent', 'relative', 'other'));

      CREATE INDEX IF NOT EXISTS idx_users_family_role ON users(family_role);
    `,
  },
  {
    version: 20,
    description: 'User profile pictures',
    up: `
      ALTER TABLE users ADD COLUMN avatar_data TEXT;
    `,
  },
  {
    version: 21,
    description: 'Calendar event icons',
    up: `
      ALTER TABLE calendar_events ADD COLUMN icon TEXT NOT NULL DEFAULT 'calendar';
    `,
  },
  {
    version: 22,
    description: 'Normalize calendar dentist icon',
    up: `
      UPDATE calendar_events SET icon = 'drill' WHERE icon = 'tooth';
    `,
  },
  {
    version: 23,
    description: 'Link family members with contacts and birthdays',
    up: `
      ALTER TABLE contacts ADD COLUMN family_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_family_user
        ON contacts(family_user_id) WHERE family_user_id IS NOT NULL;

      ALTER TABLE birthdays ADD COLUMN family_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_birthdays_family_user
        ON birthdays(family_user_id) WHERE family_user_id IS NOT NULL;

      INSERT INTO contacts (name, category, family_user_id)
      SELECT display_name, 'Sonstiges', id
      FROM users
      WHERE NOT EXISTS (
        SELECT 1 FROM contacts WHERE contacts.family_user_id = users.id
      );
    `,
  },
  {
    version: 24,
    description: 'Use tooth icon for dentist calendar events',
    up: `
      UPDATE calendar_events SET icon = 'tooth' WHERE icon = 'drill';
    `,
  },
  {
    version: 25,
    description: 'Allow archived status for tasks',
    up: `
      CREATE TABLE tasks_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        description     TEXT,
        category        TEXT    NOT NULL DEFAULT 'Sonstiges',
        priority        TEXT    NOT NULL DEFAULT 'none'
                                CHECK(priority IN ('none', 'low', 'medium', 'high', 'urgent')),
        status          TEXT    NOT NULL DEFAULT 'open'
                                CHECK(status IN ('open', 'in_progress', 'done', 'archived')),
        due_date        TEXT,
        due_time        TEXT,
        assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_recurring    INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT,
        parent_task_id  INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO tasks_new
      SELECT * FROM tasks;

      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      CREATE INDEX IF NOT EXISTS idx_tasks_status         ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned       ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent         ON tasks(parent_task_id);
    `,
  },
  {
    version: 26,
    description: 'Family documents with local storage metadata and visibility ACL',
    up: `
      CREATE TABLE IF NOT EXISTS family_documents (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL,
        description      TEXT,
        category         TEXT    NOT NULL DEFAULT 'other'
                                  CHECK(category IN ('medical', 'school', 'identity', 'insurance', 'finance', 'home', 'vehicle', 'legal', 'travel', 'pets', 'warranty', 'taxes', 'work', 'other')),
        status           TEXT    NOT NULL DEFAULT 'active'
                                  CHECK(status IN ('active', 'archived')),
        visibility       TEXT    NOT NULL DEFAULT 'family'
                                  CHECK(visibility IN ('family', 'restricted', 'private')),
        original_name    TEXT    NOT NULL,
        mime_type        TEXT    NOT NULL,
        file_size        INTEGER NOT NULL,
        content_data     TEXT    NOT NULL,
        storage_provider TEXT    NOT NULL DEFAULT 'local'
                                  CHECK(storage_provider IN ('local', 'external')),
        storage_key      TEXT,
        created_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS family_document_access (
        document_id INTEGER NOT NULL REFERENCES family_documents(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (document_id, user_id)
      );

      CREATE TRIGGER IF NOT EXISTS trg_family_documents_updated_at
        AFTER UPDATE ON family_documents FOR EACH ROW
        BEGIN UPDATE family_documents SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE INDEX IF NOT EXISTS idx_family_documents_status     ON family_documents(status);
      CREATE INDEX IF NOT EXISTS idx_family_documents_category   ON family_documents(category);
      CREATE INDEX IF NOT EXISTS idx_family_documents_created_by ON family_documents(created_by);
      CREATE INDEX IF NOT EXISTS idx_family_document_access_user ON family_document_access(user_id);
    `,
  },
  {
    version: 27,
    description: 'Calendar event attachments',
    up: `
      ALTER TABLE calendar_events ADD COLUMN attachment_name TEXT;
      ALTER TABLE calendar_events ADD COLUMN attachment_mime TEXT;
      ALTER TABLE calendar_events ADD COLUMN attachment_size INTEGER;
      ALTER TABLE calendar_events ADD COLUMN attachment_data TEXT;
    `,
  },
  {
    version: 28,
    description: 'Budget loans and installment payments',
    up: `
      CREATE TABLE IF NOT EXISTS budget_loans (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        title             TEXT    NOT NULL,
        borrower          TEXT    NOT NULL,
        total_amount      REAL    NOT NULL CHECK(total_amount > 0),
        installment_count INTEGER NOT NULL CHECK(installment_count > 0),
        start_month       TEXT    NOT NULL,
        notes             TEXT,
        status            TEXT    NOT NULL DEFAULT 'active'
                                  CHECK(status IN ('active', 'paid')),
        created_by        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS budget_loan_payments (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_id            INTEGER NOT NULL REFERENCES budget_loans(id) ON DELETE CASCADE,
        installment_number INTEGER NOT NULL CHECK(installment_number > 0),
        amount             REAL    NOT NULL CHECK(amount > 0),
        paid_date          TEXT    NOT NULL,
        budget_entry_id    INTEGER REFERENCES budget_entries(id) ON DELETE SET NULL,
        created_by         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(loan_id, installment_number)
      );

      CREATE TRIGGER IF NOT EXISTS trg_budget_loans_updated_at
        AFTER UPDATE ON budget_loans FOR EACH ROW
        BEGIN UPDATE budget_loans SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE INDEX IF NOT EXISTS idx_budget_loans_status ON budget_loans(status);
      CREATE INDEX IF NOT EXISTS idx_budget_loans_start_month ON budget_loans(start_month);
      CREATE INDEX IF NOT EXISTS idx_budget_loan_payments_loan ON budget_loan_payments(loan_id);
      CREATE INDEX IF NOT EXISTS idx_budget_loan_payments_paid_date ON budget_loan_payments(paid_date);
    `,
  },
  {
    version: 29,
    description: 'Generic CalDAV multi-account support',
    up: (db) => {
      // Create caldav_accounts table
      db.exec(`
        CREATE TABLE caldav_accounts (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT NOT NULL,
          caldav_url      TEXT NOT NULL,
          username        TEXT NOT NULL,
          password        TEXT NOT NULL,
          created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          last_sync       TEXT,
          UNIQUE(caldav_url, username)
        )
      `);

      // Create caldav_calendar_selection table
      db.exec(`
        CREATE TABLE caldav_calendar_selection (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id      INTEGER NOT NULL,
          calendar_url    TEXT NOT NULL,
          calendar_name   TEXT NOT NULL,
          calendar_color  TEXT,
          enabled         INTEGER NOT NULL DEFAULT 1,
          created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          FOREIGN KEY (account_id) REFERENCES caldav_accounts(id) ON DELETE CASCADE,
          UNIQUE(account_id, calendar_url)
        )
      `);

      // Create index for performance
      db.exec(`
        CREATE INDEX idx_caldav_selection_enabled
          ON caldav_calendar_selection(account_id, enabled)
      `);

      // Update external_calendars to allow 'caldav' source
      db.exec(`
        CREATE TABLE external_calendars_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          source      TEXT    NOT NULL CHECK(source IN ('google', 'apple', 'caldav')),
          external_id TEXT    NOT NULL,
          name        TEXT    NOT NULL,
          color       TEXT,
          UNIQUE(source, external_id)
        )
      `);

      db.exec(`
        INSERT INTO external_calendars_new (id, source, external_id, name, color)
        SELECT id, source, external_id, name, color
        FROM external_calendars
      `);

      db.exec(`DROP TABLE external_calendars`);
      db.exec(`ALTER TABLE external_calendars_new RENAME TO external_calendars`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_ext_cal_source ON external_calendars(source, external_id)`);

      // Migrate existing Apple data
      const appleUrl = db.prepare("SELECT value FROM sync_config WHERE key='apple_caldav_url'").get()?.value;
      const appleUser = db.prepare("SELECT value FROM sync_config WHERE key='apple_username'").get()?.value;
      const applePwd = db.prepare("SELECT value FROM sync_config WHERE key='apple_app_password'").get()?.value;
      const appleLastSync = db.prepare("SELECT value FROM sync_config WHERE key='apple_last_sync'").get()?.value;

      if (appleUrl && appleUser && applePwd) {
        // Insert migrated Apple account
        const result = db.prepare(`
          INSERT INTO caldav_accounts (name, caldav_url, username, password, last_sync)
          VALUES (?, ?, ?, ?, ?)
        `).run('Apple Calendar (migriert)', appleUrl, appleUser, applePwd, appleLastSync);

        const accountId = result.lastInsertRowid;

        // Migrate Apple calendars from external_calendars
        const appleCalendars = db.prepare(`
          SELECT external_id, name, color FROM external_calendars WHERE source='apple'
        `).all();

        for (const cal of appleCalendars) {
          db.prepare(`
            INSERT INTO caldav_calendar_selection
              (account_id, calendar_url, calendar_name, calendar_color, enabled)
            VALUES (?, ?, ?, ?, 1)
          `).run(accountId, cal.external_id, cal.name, cal.color);
        }

        // Update external_calendars source
        db.prepare(`UPDATE external_calendars SET source='caldav' WHERE source='apple'`).run();

      }

      // Add caldav to external_source CHECK constraint by recreating table
      db.exec(`
        CREATE TABLE calendar_events_new (
          id                           INTEGER PRIMARY KEY AUTOINCREMENT,
          title                        TEXT    NOT NULL,
          description                  TEXT,
          start_datetime               TEXT    NOT NULL,
          end_datetime                 TEXT,
          all_day                      INTEGER NOT NULL DEFAULT 0,
          location                     TEXT,
          color                        TEXT    NOT NULL DEFAULT '#007AFF',
          assigned_to                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_by                   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          external_calendar_id         TEXT,
          external_source              TEXT    NOT NULL DEFAULT 'local'
                                               CHECK(external_source IN ('local', 'google', 'apple', 'ics', 'caldav')),
          recurrence_rule              TEXT,
          subscription_id              INTEGER REFERENCES ics_subscriptions(id) ON DELETE CASCADE,
          user_modified                INTEGER NOT NULL DEFAULT 0,
          calendar_ref_id              INTEGER REFERENCES external_calendars(id) ON DELETE SET NULL,
          icon                         TEXT    NOT NULL DEFAULT 'calendar',
          attachment_name              TEXT,
          attachment_mime              TEXT,
          attachment_size              INTEGER,
          attachment_data              TEXT,
          target_caldav_account_id     INTEGER,
          target_caldav_calendar_url   TEXT,
          created_at                   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          updated_at                   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )
      `);

      db.exec(`
        INSERT INTO calendar_events_new
          (id, title, description, start_datetime, end_datetime, all_day, location, color,
           assigned_to, created_by, external_calendar_id, external_source, recurrence_rule,
           subscription_id, user_modified, calendar_ref_id, icon,
           attachment_name, attachment_mime, attachment_size, attachment_data,
           created_at, updated_at)
        SELECT id, title, description, start_datetime, end_datetime, all_day, location, color,
               assigned_to, created_by, external_calendar_id,
               CASE WHEN external_source = 'apple' THEN 'caldav' ELSE external_source END,
               recurrence_rule, subscription_id, user_modified, calendar_ref_id, icon,
               attachment_name, attachment_mime, attachment_size, attachment_data,
               created_at, updated_at
        FROM calendar_events
      `);

      db.exec(`DROP TRIGGER IF EXISTS trg_calendar_events_updated_at`);
      db.exec(`DROP TABLE calendar_events`);
      db.exec(`ALTER TABLE calendar_events_new RENAME TO calendar_events`);

      db.exec(`
        CREATE TRIGGER trg_calendar_events_updated_at
          AFTER UPDATE ON calendar_events FOR EACH ROW
          BEGIN UPDATE calendar_events SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END
      `);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_datetime)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_assigned ON calendar_events(assigned_to)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_external_id ON calendar_events(external_calendar_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_sub ON calendar_events(subscription_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_cal_events_ref ON calendar_events(calendar_ref_id)`);
      db.exec(`CREATE UNIQUE INDEX idx_calendar_sub_extid ON calendar_events (subscription_id, external_calendar_id)`);
    },
  },
  {
    version: 30,
    description: 'CardDAV multi-account contacts sync',
    up: `
      -- ========================================
      -- CardDAV Accounts
      -- ========================================
      CREATE TABLE carddav_accounts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        carddav_url TEXT NOT NULL,
        username    TEXT NOT NULL,
        password    TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        last_sync   TEXT,
        UNIQUE(carddav_url, username)
      );

      -- ========================================
      -- CardDAV Addressbook Selection
      -- ========================================
      CREATE TABLE carddav_addressbook_selection (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id       INTEGER NOT NULL,
        addressbook_url  TEXT NOT NULL,
        addressbook_name TEXT NOT NULL,
        enabled          INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(account_id, addressbook_url),
        FOREIGN KEY(account_id) REFERENCES carddav_accounts(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_carddav_addressbook_account
        ON carddav_addressbook_selection(account_id, enabled);

      -- ========================================
      -- Extend Contacts Table for CardDAV
      -- ========================================
      ALTER TABLE contacts ADD COLUMN organization TEXT;
      ALTER TABLE contacts ADD COLUMN job_title TEXT;
      ALTER TABLE contacts ADD COLUMN birthday TEXT;
      ALTER TABLE contacts ADD COLUMN website TEXT;
      ALTER TABLE contacts ADD COLUMN photo TEXT;
      ALTER TABLE contacts ADD COLUMN nickname TEXT;
      ALTER TABLE contacts ADD COLUMN carddav_account_id INTEGER
        REFERENCES carddav_accounts(id) ON DELETE SET NULL;
      ALTER TABLE contacts ADD COLUMN carddav_uid TEXT;
      ALTER TABLE contacts ADD COLUMN carddav_addressbook_url TEXT;

      CREATE INDEX idx_contacts_carddav_uid ON contacts(carddav_uid);
      CREATE INDEX idx_contacts_email ON contacts(email);

      -- UNIQUE constraint for CardDAV UIDs (prevents duplicates per account+addressbook)
      CREATE UNIQUE INDEX idx_contacts_carddav_uid_unique
        ON contacts(carddav_account_id, carddav_addressbook_url, carddav_uid)
        WHERE carddav_uid IS NOT NULL;

      -- ========================================
      -- Contact Phones (Multiple per Contact)
      -- ========================================
      CREATE TABLE contact_phones (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id INTEGER NOT NULL,
        label      TEXT,
        value      TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_contact_phones_contact ON contact_phones(contact_id);
      CREATE INDEX idx_contact_phones_value ON contact_phones(value);

      -- ========================================
      -- Contact Emails (Multiple per Contact)
      -- ========================================
      CREATE TABLE contact_emails (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id INTEGER NOT NULL,
        label      TEXT,
        value      TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_contact_emails_contact ON contact_emails(contact_id);
      CREATE INDEX idx_contact_emails_value ON contact_emails(value);

      -- ========================================
      -- Contact Addresses (Multiple per Contact)
      -- ========================================
      CREATE TABLE contact_addresses (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id  INTEGER NOT NULL,
        label       TEXT,
        street      TEXT,
        city        TEXT,
        state       TEXT,
        postal_code TEXT,
        country     TEXT,
        is_primary  INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_contact_addresses_contact ON contact_addresses(contact_id);
    `,
  },
  {
    version: 31,
    description: 'Advanced reminder options for birthdays',
    up: `
      ALTER TABLE birthdays ADD COLUMN reminder_offset TEXT;
      ALTER TABLE birthdays ADD COLUMN reminder_custom_amount INTEGER;
      ALTER TABLE birthdays ADD COLUMN reminder_custom_unit TEXT;
    `,
  },
  {
    version: 32,
    description: 'Multi-person assignment for tasks and calendar events',
    up: `
      CREATE TABLE IF NOT EXISTS task_assignments (
        task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS event_assignments (
        event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (event_id, user_id)
      );
      INSERT OR IGNORE INTO task_assignments (task_id, user_id)
        SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL;
      INSERT OR IGNORE INTO event_assignments (event_id, user_id)
        SELECT id, assigned_to FROM calendar_events WHERE assigned_to IS NOT NULL;
    `,
  },
  {
    version: 33,
    description: 'Housekeeping work sessions, decay tasks, supply requests, and maintenance log',
    up: `
      CREATE TABLE IF NOT EXISTS housekeeping_work_sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        check_in   TEXT    NOT NULL,
        check_out  TEXT,
        daily_rate REAL    NOT NULL DEFAULT 0 CHECK(daily_rate >= 0),
        extras     REAL    NOT NULL DEFAULT 0 CHECK(extras >= 0),
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS housekeeping_decay_tasks (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT    NOT NULL,
        area           TEXT    NOT NULL,
        frequency_days INTEGER NOT NULL CHECK(frequency_days > 0),
        last_completed TEXT,
        created_by     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS housekeeping_supply_requests (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL,
        quantity         TEXT,
        shopping_item_id INTEGER REFERENCES shopping_items(id) ON DELETE SET NULL,
        created_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS housekeeping_maintenance_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT    NOT NULL,
        photo_url   TEXT,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TRIGGER IF NOT EXISTS trg_housekeeping_work_sessions_updated_at
        AFTER UPDATE ON housekeeping_work_sessions FOR EACH ROW
        BEGIN UPDATE housekeeping_work_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_housekeeping_decay_tasks_updated_at
        AFTER UPDATE ON housekeeping_decay_tasks FOR EACH ROW
        BEGIN UPDATE housekeeping_decay_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_housekeeping_maintenance_log_updated_at
        AFTER UPDATE ON housekeeping_maintenance_log FOR EACH ROW
        BEGIN UPDATE housekeeping_maintenance_log SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE INDEX IF NOT EXISTS idx_housekeeping_sessions_check_in ON housekeeping_work_sessions(check_in);
      CREATE INDEX IF NOT EXISTS idx_housekeeping_sessions_open ON housekeeping_work_sessions(check_out);
      CREATE INDEX IF NOT EXISTS idx_housekeeping_decay_area ON housekeeping_decay_tasks(area);
      CREATE INDEX IF NOT EXISTS idx_housekeeping_decay_completed ON housekeeping_decay_tasks(last_completed);
      CREATE INDEX IF NOT EXISTS idx_housekeeping_supply_created ON housekeeping_supply_requests(created_at);
      CREATE INDEX IF NOT EXISTS idx_housekeeping_maintenance_created ON housekeeping_maintenance_log(created_at);
    `,
  },
  {
    version: 34,
    description: 'Housekeeping worker profile and payment tracking',
    up: `
      CREATE TABLE IF NOT EXISTS housekeeping_workers (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        daily_rate       REAL    NOT NULL DEFAULT 0 CHECK(daily_rate >= 0),
        payment_schedule TEXT    NOT NULL DEFAULT 'monthly'
                                  CHECK(payment_schedule IN ('daily', 'twice_monthly', 'monthly')),
        notes            TEXT,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      ALTER TABLE housekeeping_work_sessions ADD COLUMN paid_at TEXT;

      CREATE TRIGGER IF NOT EXISTS trg_housekeeping_workers_updated_at
        AFTER UPDATE ON housekeeping_workers FOR EACH ROW
        BEGIN UPDATE housekeeping_workers SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE INDEX IF NOT EXISTS idx_housekeeping_workers_user ON housekeeping_workers(user_id);
      CREATE INDEX IF NOT EXISTS idx_housekeeping_sessions_paid ON housekeeping_work_sessions(paid_at);
    `,
  },
  {
    version: 35,
    description: 'Housekeeping per-worker sessions and calendar linkage',
    up: `
      ALTER TABLE housekeeping_workers ADD COLUMN calendar_color TEXT NOT NULL DEFAULT '#7C3AED';
      ALTER TABLE housekeeping_work_sessions ADD COLUMN worker_id INTEGER REFERENCES housekeeping_workers(id) ON DELETE SET NULL;
      ALTER TABLE housekeeping_work_sessions ADD COLUMN calendar_event_id INTEGER REFERENCES calendar_events(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_housekeeping_sessions_worker ON housekeeping_work_sessions(worker_id);
      CREATE INDEX IF NOT EXISTS idx_housekeeping_sessions_calendar ON housekeeping_work_sessions(calendar_event_id);
    `,
  },
  {
    version: 36,
    description: 'Housekeeping payment task linkage',
    up: `
      ALTER TABLE housekeeping_work_sessions ADD COLUMN payment_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_housekeeping_sessions_payment_task ON housekeeping_work_sessions(payment_task_id);
    `,
  },
  {
    version: 37,
    description: 'Document folders and housekeeping receipt linkage',
    up: `
      CREATE TABLE IF NOT EXISTS family_document_folders (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TRIGGER IF NOT EXISTS trg_family_document_folders_updated_at
        AFTER UPDATE ON family_document_folders FOR EACH ROW
        BEGIN UPDATE family_document_folders SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      ALTER TABLE family_documents ADD COLUMN folder_id INTEGER REFERENCES family_document_folders(id) ON DELETE SET NULL;
      ALTER TABLE housekeeping_work_sessions ADD COLUMN receipt_document_id INTEGER REFERENCES family_documents(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_family_documents_folder ON family_documents(folder_id);
      CREATE INDEX IF NOT EXISTS idx_housekeeping_sessions_receipt ON housekeeping_work_sessions(receipt_document_id);
    `,
  },
  {
    version: 38,
    description: 'Calendar attachment document linkage',
    up: `
      ALTER TABLE calendar_events ADD COLUMN attachment_document_id INTEGER REFERENCES family_documents(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_calendar_attachment_document ON calendar_events(attachment_document_id);
    `,
  },
  {
    version: 39,
    description: 'Split expense groups, immutable ledger, settlements, recurring expenses, and activity',
    up: `
      CREATE TABLE IF NOT EXISTS expense_groups (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        name                TEXT    NOT NULL,
        description         TEXT,
        type                TEXT    NOT NULL DEFAULT 'general'
                                    CHECK(type IN ('household', 'couple', 'travel', 'event', 'shopping', 'general')),
        avatar_color        TEXT    NOT NULL DEFAULT '#0F766E',
        avatar_document_id  INTEGER REFERENCES family_documents(id) ON DELETE SET NULL,
        default_currency    TEXT    NOT NULL DEFAULT 'EUR',
        status              TEXT    NOT NULL DEFAULT 'active'
                                    CHECK(status IN ('active', 'archived')),
        created_by          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        archived_at         TEXT,
        created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS expense_group_members (
        group_id    INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role        TEXT    NOT NULL DEFAULT 'guest'
                            CHECK(role IN ('owner', 'admin', 'guest')),
        invited_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        joined_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (group_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id                INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
        title                   TEXT    NOT NULL,
        description             TEXT,
        amount_minor            INTEGER NOT NULL CHECK(amount_minor > 0),
        currency                TEXT    NOT NULL,
        converted_amount_minor  INTEGER NOT NULL CHECK(converted_amount_minor > 0),
        converted_currency      TEXT    NOT NULL,
        exchange_rate_num       INTEGER NOT NULL DEFAULT 1 CHECK(exchange_rate_num > 0),
        exchange_rate_den       INTEGER NOT NULL DEFAULT 1 CHECK(exchange_rate_den > 0),
        exchange_snapshot       TEXT,
        payer_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        category                TEXT    NOT NULL DEFAULT 'general',
        split_method            TEXT    NOT NULL DEFAULT 'equal'
                                      CHECK(split_method IN ('equal', 'exact', 'percentage', 'shares')),
        status                  TEXT    NOT NULL DEFAULT 'active'
                                      CHECK(status IN ('active', 'deleted')),
        expense_date            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now')),
        recurring_rule_id       INTEGER,
        created_by              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        deleted_at              TEXT,
        created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS expense_splits (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_id    INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        amount_minor  INTEGER NOT NULL CHECK(amount_minor >= 0),
        currency      TEXT    NOT NULL,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(expense_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS expense_comments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment     TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS expense_attachments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_id   INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        document_id  INTEGER NOT NULL REFERENCES family_documents(id) ON DELETE CASCADE,
        kind         TEXT    NOT NULL DEFAULT 'receipt' CHECK(kind IN ('receipt', 'proof', 'other')),
        created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(expense_id, document_id)
      );

      CREATE TABLE IF NOT EXISTS expense_ledger_entries (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id      INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
        source_type   TEXT    NOT NULL CHECK(source_type IN ('expense', 'expense_reversal', 'settlement', 'settlement_reversal')),
        source_id     INTEGER NOT NULL,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        counterparty_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        amount_minor  INTEGER NOT NULL,
        currency      TEXT    NOT NULL,
        memo          TEXT,
        created_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS settlements (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id      INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
        payer_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        payee_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        amount_minor  INTEGER NOT NULL CHECK(amount_minor > 0),
        currency      TEXT    NOT NULL,
        notes         TEXT,
        proof_document_id INTEGER REFERENCES family_documents(id) ON DELETE SET NULL,
        status        TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
        paid_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        created_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        deleted_at    TEXT,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS settlement_entries (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
        from_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        to_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        amount_minor   INTEGER NOT NULL CHECK(amount_minor > 0),
        currency       TEXT    NOT NULL,
        created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS recurring_expenses (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id        INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
        title           TEXT    NOT NULL,
        description     TEXT,
        amount_minor    INTEGER NOT NULL CHECK(amount_minor > 0),
        currency        TEXT    NOT NULL,
        payer_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        category        TEXT    NOT NULL DEFAULT 'general',
        split_method    TEXT    NOT NULL DEFAULT 'equal',
        split_snapshot  TEXT    NOT NULL,
        frequency       TEXT    NOT NULL CHECK(frequency IN ('weekly', 'monthly', 'yearly')),
        next_run_date   TEXT    NOT NULL,
        paused_at       TEXT,
        created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS expense_activity (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id    INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
        actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        type        TEXT    NOT NULL,
        entity_type TEXT    NOT NULL,
        entity_id   INTEGER,
        metadata    TEXT,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TRIGGER IF NOT EXISTS trg_expense_groups_updated_at
        AFTER UPDATE ON expense_groups FOR EACH ROW
        BEGIN UPDATE expense_groups SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE TRIGGER IF NOT EXISTS trg_expenses_updated_at
        AFTER UPDATE ON expenses FOR EACH ROW
        BEGIN UPDATE expenses SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE TRIGGER IF NOT EXISTS trg_settlements_updated_at
        AFTER UPDATE ON settlements FOR EACH ROW
        BEGIN UPDATE settlements SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE TRIGGER IF NOT EXISTS trg_recurring_expenses_updated_at
        AFTER UPDATE ON recurring_expenses FOR EACH ROW
        BEGIN UPDATE recurring_expenses SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE INDEX IF NOT EXISTS idx_expense_groups_status ON expense_groups(status);
      CREATE INDEX IF NOT EXISTS idx_expense_group_members_user ON expense_group_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_group_date ON expenses(group_id, expense_date DESC);
      CREATE INDEX IF NOT EXISTS idx_expenses_payer ON expenses(payer_id);
      CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);
      CREATE INDEX IF NOT EXISTS idx_expense_ledger_group_currency_user ON expense_ledger_entries(group_id, currency, user_id);
      CREATE INDEX IF NOT EXISTS idx_expense_ledger_source ON expense_ledger_entries(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_settlements_group_paid ON settlements(group_id, paid_at DESC);
      CREATE INDEX IF NOT EXISTS idx_recurring_expenses_next_run ON recurring_expenses(next_run_date, paused_at);
      CREATE INDEX IF NOT EXISTS idx_expense_activity_group_created ON expense_activity(group_id, created_at DESC);
    `,
  },
  {
    version: 40,
    description: 'Restricted Split guest accounts',
    up: `
      CREATE TABLE IF NOT EXISTS split_expense_guest_users (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        group_id   INTEGER REFERENCES expense_groups(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT OR IGNORE INTO split_expense_guest_users (user_id, group_id, created_by, created_at)
      SELECT a.entity_id, a.group_id, a.actor_id, a.created_at
      FROM expense_activity a
      WHERE a.type = 'guest_created'
        AND a.entity_type = 'member'
        AND a.entity_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_split_guest_group ON split_expense_guest_users(group_id);
    `,
  },
  {
    version: 41,
    description: 'Start date for tasks (scheduled / future tasks)',
    up: `
      ALTER TABLE tasks ADD COLUMN start_date TEXT;
      CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON tasks(start_date);
    `,
  },
  {
    version: 42,
    description: 'OIDC/SSO: oidc_sub and oidc_provider columns on users',
    up: `
      ALTER TABLE users ADD COLUMN oidc_sub      TEXT;
      ALTER TABLE users ADD COLUMN oidc_provider TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_sub
        ON users(oidc_sub) WHERE oidc_sub IS NOT NULL;
    `,
  },
  {
    version: 43,
    description: 'Performance indexes: assignment lookups by user, loan-payment entries, recurring events',
    up: `
      -- "assigned to me" lookups: the PKs are (event_id|task_id, user_id),
      -- so a user_id-leading index is missing for filtering by assignee.
      CREATE INDEX IF NOT EXISTS idx_event_assignments_user
        ON event_assignments(user_id);
      CREATE INDEX IF NOT EXISTS idx_task_assignments_user
        ON task_assignments(user_id);

      -- budget month list LEFT JOINs loan payments on budget_entry_id (only
      -- loan_id and paid_date were indexed) -> probed with a scan per row.
      CREATE INDEX IF NOT EXISTS idx_budget_loan_payments_entry
        ON budget_loan_payments(budget_entry_id);

      -- calendar GET expands all recurring events; partial index keeps that
      -- scan to just the recurring rows instead of the full events table.
      CREATE INDEX IF NOT EXISTS idx_calendar_recurring
        ON calendar_events(start_datetime) WHERE recurrence_rule IS NOT NULL;

    `,
  },
  {
    version: 44,
    description: 'FTS5 full-text search index across tasks, calendar events, notes, contacts, and shopping items',
    up: `
      CREATE VIRTUAL TABLE search_index USING fts5(
        entity UNINDEXED,
        entity_id UNINDEXED,
        title,
        body,
        tokenize = 'unicode61'
      );

      -- ---- tasks ----
      CREATE TRIGGER trg_search_tasks_ai AFTER INSERT ON tasks BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('task', NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.description, ''));
      END;
      CREATE TRIGGER trg_search_tasks_ad AFTER DELETE ON tasks BEGIN
        DELETE FROM search_index WHERE entity = 'task' AND entity_id = OLD.id;
      END;
      CREATE TRIGGER trg_search_tasks_au AFTER UPDATE ON tasks BEGIN
        DELETE FROM search_index WHERE entity = 'task' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('task', NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.description, ''));
      END;

      -- ---- calendar_events ----
      CREATE TRIGGER trg_search_events_ai AFTER INSERT ON calendar_events BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('event', NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.description, ''));
      END;
      CREATE TRIGGER trg_search_events_ad AFTER DELETE ON calendar_events BEGIN
        DELETE FROM search_index WHERE entity = 'event' AND entity_id = OLD.id;
      END;
      CREATE TRIGGER trg_search_events_au AFTER UPDATE ON calendar_events BEGIN
        DELETE FROM search_index WHERE entity = 'event' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('event', NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.description, ''));
      END;

      -- ---- notes ----
      CREATE TRIGGER trg_search_notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('note', NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.content, ''));
      END;
      CREATE TRIGGER trg_search_notes_ad AFTER DELETE ON notes BEGIN
        DELETE FROM search_index WHERE entity = 'note' AND entity_id = OLD.id;
      END;
      CREATE TRIGGER trg_search_notes_au AFTER UPDATE ON notes BEGIN
        DELETE FROM search_index WHERE entity = 'note' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('note', NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.content, ''));
      END;

      -- ---- contacts ----
      CREATE TRIGGER trg_search_contacts_ai AFTER INSERT ON contacts BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('contact', NEW.id, COALESCE(NEW.name, ''),
                COALESCE(NEW.phone, '') || ' ' || COALESCE(NEW.email, ''));
      END;
      CREATE TRIGGER trg_search_contacts_ad AFTER DELETE ON contacts BEGIN
        DELETE FROM search_index WHERE entity = 'contact' AND entity_id = OLD.id;
      END;
      CREATE TRIGGER trg_search_contacts_au AFTER UPDATE ON contacts BEGIN
        DELETE FROM search_index WHERE entity = 'contact' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('contact', NEW.id, COALESCE(NEW.name, ''),
                COALESCE(NEW.phone, '') || ' ' || COALESCE(NEW.email, ''));
      END;

      -- ---- shopping_items ----
      CREATE TRIGGER trg_search_items_ai AFTER INSERT ON shopping_items BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('item', NEW.id, COALESCE(NEW.name, ''), '');
      END;
      CREATE TRIGGER trg_search_items_ad AFTER DELETE ON shopping_items BEGIN
        DELETE FROM search_index WHERE entity = 'item' AND entity_id = OLD.id;
      END;
      CREATE TRIGGER trg_search_items_au AFTER UPDATE ON shopping_items BEGIN
        DELETE FROM search_index WHERE entity = 'item' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('item', NEW.id, COALESCE(NEW.name, ''), '');
      END;

      -- Backfill from existing rows.
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'task', id, COALESCE(title, ''), COALESCE(description, '') FROM tasks;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'event', id, COALESCE(title, ''), COALESCE(description, '') FROM calendar_events;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'note', id, COALESCE(title, ''), COALESCE(content, '') FROM notes;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'contact', id, COALESCE(name, ''),
               COALESCE(phone, '') || ' ' || COALESCE(email, '') FROM contacts;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'item', id, COALESCE(name, ''), '' FROM shopping_items;
    `,
  },
  {
    version: 45,
    description: 'CalDAV reminder (VTODO) sync: list selection + external linkage on tasks and shopping_items',
    up: `
      -- Reminder-list selection per CalDAV account (Apple Reminders = VTODO collections).
      -- Reused caldav_accounts; each list maps to the tasks or shopping module.
      CREATE TABLE caldav_reminder_selection (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id     INTEGER NOT NULL REFERENCES caldav_accounts(id) ON DELETE CASCADE,
        list_url       TEXT    NOT NULL,
        list_name      TEXT    NOT NULL,
        target_module  TEXT    NOT NULL DEFAULT 'tasks'
                               CHECK(target_module IN ('tasks', 'shopping')),
        target_list_id INTEGER REFERENCES shopping_lists(id) ON DELETE SET NULL,
        enabled        INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(account_id, list_url)
      );

      CREATE INDEX IF NOT EXISTS idx_caldav_reminder_selection_enabled
        ON caldav_reminder_selection(account_id, enabled);

      -- External linkage for read-only mirroring of remote VTODOs.
      ALTER TABLE tasks ADD COLUMN external_uid        TEXT;
      ALTER TABLE tasks ADD COLUMN external_source     TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE tasks ADD COLUMN external_account_id INTEGER;

      ALTER TABLE shopping_items ADD COLUMN external_uid        TEXT;
      ALTER TABLE shopping_items ADD COLUMN external_source     TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE shopping_items ADD COLUMN external_account_id INTEGER;

      CREATE INDEX IF NOT EXISTS idx_tasks_external
        ON tasks(external_source, external_account_id, external_uid);
      CREATE INDEX IF NOT EXISTS idx_shopping_items_external
        ON shopping_items(external_source, external_account_id, external_uid);
    `,
  },
  {
    version: 46,
    description: 'Budget recurring entries: interval (monthly/half_year/yearly) + virtual (smoothed) budgeting',
    up: `

      ALTER TABLE budget_entries ADD COLUMN recurrence_interval TEXT NOT NULL DEFAULT 'monthly';

      ALTER TABLE budget_entries ADD COLUMN recurrence_virtual INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE budget_entries ADD COLUMN recurrence_full_amount REAL;
    `,
  },
  {
    version: 47,
    description: 'Multiple Google calendars: per-calendar selection + sync token, per-event Google target',
    up: `
      CREATE TABLE IF NOT EXISTS google_calendar_selection (
        calendar_id  TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        color        TEXT,
        enabled      INTEGER NOT NULL DEFAULT 1,
        sync_token   TEXT,
        last_sync    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_google_selection_enabled
        ON google_calendar_selection(enabled);

      ALTER TABLE calendar_events ADD COLUMN target_google_calendar_id TEXT;
    `,
    // Data migration: carry the single selected Google calendar (Issue #220)
    // into the new selection table so existing installs keep syncing it.
    afterUp: (database) => {
      const calId = database.prepare(
        "SELECT value FROM sync_config WHERE key = 'google_calendar_id'"
      ).get()?.value;
      const connected = database.prepare(
        "SELECT value FROM sync_config WHERE key = 'google_access_token'"
      ).get()?.value;
      if (!connected) return; // not connected → nothing to migrate

      const id = calId || 'primary';
      const meta = database.prepare(
        "SELECT name, color FROM external_calendars WHERE source = 'google' AND external_id = ?"
      ).get(id);
      const syncToken = database.prepare(
        "SELECT value FROM sync_config WHERE key = 'google_sync_token'"
      ).get()?.value || null;

      database.prepare(`
        INSERT OR IGNORE INTO google_calendar_selection
          (calendar_id, name, color, enabled, sync_token)
        VALUES (?, ?, ?, 1, ?)
      `).run(id, meta?.name || id, meta?.color || null, syncToken);
    },
  },
  {
    version: 48,
    description: 'Housekeeping hourly billing: rate_type, hourly_rate, minutes_worked',
    up: `
      ALTER TABLE housekeeping_workers ADD COLUMN rate_type TEXT NOT NULL DEFAULT 'daily'
        CHECK(rate_type IN ('daily', 'hourly'));
      ALTER TABLE housekeeping_workers ADD COLUMN hourly_rate REAL NOT NULL DEFAULT 0 CHECK(hourly_rate >= 0);

      ALTER TABLE housekeeping_work_sessions ADD COLUMN rate_type TEXT NOT NULL DEFAULT 'daily';
      ALTER TABLE housekeeping_work_sessions ADD COLUMN hourly_rate REAL NOT NULL DEFAULT 0;
      ALTER TABLE housekeeping_work_sessions ADD COLUMN minutes_worked INTEGER;
    `,
  },
  {
    version: 49,
    description: 'Holiday cache for public holidays and school holidays',
    up: `
      CREATE TABLE IF NOT EXISTS holiday_cache (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        type        TEXT    NOT NULL CHECK(type IN ('public', 'school')),
        country     TEXT    NOT NULL,
        subdivision TEXT,
        start_date  TEXT    NOT NULL,
        end_date    TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        year        INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_holiday_cache_dates
        ON holiday_cache(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_holiday_cache_lookup
        ON holiday_cache(type, country, subdivision, year);
    `,
  },
  {
    version: 50,
    description: 'DMS integration: dms_accounts table + external document reference columns',
    up: `
      CREATE TABLE IF NOT EXISTS dms_accounts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        provider    TEXT    NOT NULL DEFAULT 'paperless'
                              CHECK(provider IN ('paperless')),
        name        TEXT    NOT NULL,
        base_url    TEXT    NOT NULL,
        api_token   TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        last_check  TEXT,
        UNIQUE(base_url)  -- one DMS account per server (intentional)
      );

      ALTER TABLE family_documents ADD COLUMN dms_account_id INTEGER
        REFERENCES dms_accounts(id) ON DELETE SET NULL;
      ALTER TABLE family_documents ADD COLUMN external_url TEXT;
      -- external_meta: JSON { correspondent, tags } mirrored from the DMS for display only (not queried)
      ALTER TABLE family_documents ADD COLUMN external_meta TEXT;

      CREATE INDEX IF NOT EXISTS idx_family_documents_dms ON family_documents(dms_account_id);
    `,
  },
  {
    version: 51,
    description: 'Document storage backend discriminator and consistency constraints',
    up: `
      ALTER TABLE family_documents ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'local'
        CHECK(storage_backend IN ('local', 'webdav', 'dms'));

      UPDATE family_documents
      SET storage_backend = CASE storage_provider
        WHEN 'external' THEN 'dms'
        ELSE 'local'
      END;

      UPDATE family_documents
      SET dms_account_id = NULL
      WHERE storage_backend != 'dms' AND dms_account_id IS NOT NULL;

      CREATE TRIGGER IF NOT EXISTS trg_family_documents_storage_insert
        BEFORE INSERT ON family_documents
        FOR EACH ROW
        BEGIN
          SELECT CASE
            WHEN NOT (
              (NEW.storage_provider = 'local' AND NEW.storage_backend = 'local')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'webdav')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'dms')
            )
            THEN RAISE(ABORT, 'invalid document storage provider/backend combination')
          END;
          SELECT CASE
            WHEN NEW.storage_backend != 'dms' AND NEW.dms_account_id IS NOT NULL
            THEN RAISE(ABORT, 'dms_account_id requires dms storage backend')
          END;
        END;

      CREATE TRIGGER IF NOT EXISTS trg_family_documents_storage_update
        BEFORE UPDATE OF storage_provider, storage_backend, dms_account_id ON family_documents
        FOR EACH ROW
        BEGIN
          SELECT CASE
            WHEN NOT (
              (NEW.storage_provider = 'local' AND NEW.storage_backend = 'local')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'webdav')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'dms')
            )
            THEN RAISE(ABORT, 'invalid document storage provider/backend combination')
          END;
          SELECT CASE
            WHEN NEW.storage_backend != 'dms' AND NEW.dms_account_id IS NOT NULL
            THEN RAISE(ABORT, 'dms_account_id requires dms storage backend')
          END;
        END;
    `,
  },
  {
    version: 52,
    description: 'DMS: add papra provider, org_id column, updated unique constraint',
    up(db) {
      // SQLite fires ON DELETE SET NULL when the referenced parent table is dropped
      // (even via DROP TABLE, not just individual DELETE statements). Save and restore
      // dms_account_id values around the table rebuild so existing DMS-linked documents
      // keep their account references after the migration.
      db.exec(`
        CREATE TEMP TABLE _m52_refs AS
          SELECT id, dms_account_id FROM family_documents WHERE dms_account_id IS NOT NULL;
        UPDATE family_documents SET dms_account_id = NULL WHERE dms_account_id IS NOT NULL;

        CREATE TABLE dms_accounts_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          provider    TEXT    NOT NULL DEFAULT 'paperless'
                                CHECK(provider IN ('paperless', 'papra')),
          name        TEXT    NOT NULL,
          base_url    TEXT    NOT NULL,
          org_id      TEXT    NOT NULL DEFAULT '',
          api_token   TEXT    NOT NULL,
          created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          last_check  TEXT,
          UNIQUE(base_url, org_id)
        );
        INSERT INTO dms_accounts_new (id, provider, name, base_url, org_id, api_token, created_at, last_check)
          SELECT id, provider, name, base_url, '', api_token, created_at, last_check FROM dms_accounts;
        DROP TABLE dms_accounts;
        ALTER TABLE dms_accounts_new RENAME TO dms_accounts;
        CREATE INDEX IF NOT EXISTS idx_family_documents_dms ON family_documents(dms_account_id);

        UPDATE family_documents
          SET dms_account_id = (SELECT dms_account_id FROM _m52_refs r WHERE r.id = family_documents.id)
          WHERE id IN (SELECT id FROM _m52_refs);
        DROP TABLE _m52_refs;
      `);
    },
  },
  {
    version: 53,
    description: 'Repair HTML-entity-encoded external calendar names (e.g. "&amp;")',
    up(db) {

      // Import-Kalender HTML-entity-encodierte Namen ("Termine &amp; …"), die


      const rows = db.prepare('SELECT id, name FROM external_calendars').all();
      const update = db.prepare('UPDATE external_calendars SET name = ? WHERE id = ?');
      for (const { id, name } of rows) {
        const decoded = decodeHtmlEntities(name);
        if (decoded !== name) update.run(decoded, id);
      }
    },
  },
  {
    version: 54,
    description: 'Web Push: push_subscriptions table + reminders.pushed_at column',
    up(db) {
      db.exec(`
        CREATE TABLE push_subscriptions (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint     TEXT    NOT NULL UNIQUE,
          p256dh       TEXT    NOT NULL,
          auth         TEXT    NOT NULL,
          user_agent   TEXT,
          created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          last_used_at TEXT
        );
        CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id);
        ALTER TABLE reminders ADD COLUMN pushed_at TEXT;
      `);
    },
  },
  {
    version: 55,
    description: 'Password reset tokens table',
    up: `
      CREATE TABLE password_resets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT    NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE UNIQUE INDEX idx_password_resets_hash ON password_resets(token_hash);
      CREATE INDEX idx_password_resets_user ON password_resets(user_id);
    `,
  },
  {
    version: 56,
    description: 'Budget subscription tracker with categories, payment methods, settings, and exchange-rate cache',
    up: `
      CREATE TABLE IF NOT EXISTS subscription_categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL COLLATE NOCASE UNIQUE,
        color      TEXT    NOT NULL DEFAULT '#0F766E',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT OR IGNORE INTO subscription_categories (name, color, sort_order) VALUES
        ('Entertainment', '#7C3AED', 0),
        ('Productivity',  '#2563EB', 1),
        ('Utilities',     '#0F766E', 2),
        ('Health',        '#DC2626', 3),
        ('Education',     '#D97706', 4),
        ('Other',         '#64748B', 5);

      CREATE TABLE IF NOT EXISTS subscription_payment_methods (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL COLLATE NOCASE UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT OR IGNORE INTO subscription_payment_methods (name, sort_order) VALUES
        ('Credit Card', 0),
        ('Debit Card',  1),
        ('PayPal',      2),
        ('Apple Pay',   3),
        ('Google Pay',  4),
        ('Bank Transfer', 5),
        ('Other',       6);

      CREATE TABLE IF NOT EXISTS budget_subscriptions (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT    NOT NULL,
        description       TEXT,
        amount            REAL    NOT NULL CHECK(amount >= 0),
        currency          TEXT    NOT NULL,
        billing_cycle     TEXT    NOT NULL CHECK(billing_cycle IN ('daily', 'weekly', 'monthly', 'yearly')),
        cycle_interval    INTEGER NOT NULL DEFAULT 1 CHECK(cycle_interval BETWEEN 1 AND 365),
        next_payment_date TEXT    NOT NULL,
        category_id       INTEGER REFERENCES subscription_categories(id) ON DELETE SET NULL,
        payment_method_id INTEGER REFERENCES subscription_payment_methods(id) ON DELETE SET NULL,
        reminder_days     INTEGER NOT NULL DEFAULT 3 CHECK(reminder_days BETWEEN 0 AND 365),
        enabled           INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        website_url       TEXT,
        logo_data         TEXT,
        brand_color       TEXT,
        notes             TEXT,
        created_by        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS subscription_settings (
        id             INTEGER PRIMARY KEY CHECK(id = 1),
        monthly_budget REAL    NOT NULL DEFAULT 0 CHECK(monthly_budget >= 0),
        base_currency  TEXT    NOT NULL DEFAULT 'EUR',
        updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      INSERT OR IGNORE INTO subscription_settings (id) VALUES (1);

      CREATE TABLE IF NOT EXISTS subscription_exchange_rates (
        base_currency TEXT NOT NULL,
        quote_currency TEXT NOT NULL,
        rate          REAL NOT NULL CHECK(rate > 0),
        fetched_at    TEXT NOT NULL,
        PRIMARY KEY(base_currency, quote_currency)
      );

      CREATE TRIGGER IF NOT EXISTS trg_budget_subscriptions_updated_at
        AFTER UPDATE ON budget_subscriptions FOR EACH ROW
        BEGIN UPDATE budget_subscriptions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_subscription_settings_updated_at
        AFTER UPDATE ON subscription_settings FOR EACH ROW
        BEGIN UPDATE subscription_settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 1; END;

      CREATE INDEX IF NOT EXISTS idx_budget_subscriptions_next_payment
        ON budget_subscriptions(enabled, next_payment_date);
      CREATE INDEX IF NOT EXISTS idx_budget_subscriptions_category
        ON budget_subscriptions(category_id);
      CREATE INDEX IF NOT EXISTS idx_budget_subscriptions_payment_method
        ON budget_subscriptions(payment_method_id);
    `,
  },
  {
    version: 57,
    description: 'Allow subscription entities in the existing reminder center',
    up: `
      CREATE TABLE reminders_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL CHECK(entity_type IN ('task', 'event', 'subscription')),
        entity_id   INTEGER NOT NULL,
        remind_at   TEXT    NOT NULL,
        dismissed   INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      INSERT INTO reminders_new (id, entity_type, entity_id, remind_at, dismissed, created_by, created_at)
        SELECT id, entity_type, entity_id, remind_at, dismissed, created_by, created_at FROM reminders;
      DROP TABLE reminders;
      ALTER TABLE reminders_new RENAME TO reminders;
      CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);
      CREATE INDEX idx_reminders_remind ON reminders(remind_at);
      CREATE INDEX idx_reminders_user ON reminders(created_by);
    `,
  },
  {
    version: 58,
    description: 'Link each active subscription renewal to its pending Budget expense',
    up: `
      ALTER TABLE budget_subscriptions ADD COLUMN budget_entry_id INTEGER
        REFERENCES budget_entries(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_budget_subscriptions_budget_entry
        ON budget_subscriptions(budget_entry_id);
    `,
    afterUp: (database) => {
      const subscriptions = database.prepare(`
        SELECT * FROM budget_subscriptions
        WHERE enabled = 1 AND budget_entry_id IS NULL
      `).all();
      const insert = database.prepare(`
        INSERT INTO budget_entries
          (title, amount, category, subcategory, date, is_recurring, created_by)
        VALUES (?, ?, 'financial_other', 'bank_fees', ?, 0, ?)
      `);
      const link = database.prepare(`
        UPDATE budget_subscriptions SET budget_entry_id = ? WHERE id = ?
      `);
      for (const subscription of subscriptions) {
        const entry = insert.run(
          subscription.name,
          -Math.abs(subscription.amount),
          subscription.next_payment_date,
          subscription.created_by,
        );
        link.run(entry.lastInsertRowid, subscription.id);
      }
    },
  },
  {
    version: 59,
    description: 'Mirror subscription categories into Budget and recategorize linked expenses',
    up: `
      ALTER TABLE subscription_categories ADD COLUMN budget_subcategory_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_categories_budget_subcategory
        ON subscription_categories(budget_subcategory_key)
        WHERE budget_subcategory_key IS NOT NULL;
    `,
    afterUp: (database) => {
      const nextOrder = database.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM budget_categories WHERE type = 'expense'
      `).get().n;
      database.prepare(`
        INSERT OR IGNORE INTO budget_categories (key, name, type, sort_order)
        VALUES ('subscriptions', 'Subscription', 'expense', ?)
      `).run(nextOrder);

      const defaultKeys = new Map([
        ['entertainment', 'subscription_entertainment'],
        ['productivity', 'subscription_productivity'],
        ['utilities', 'subscription_utilities'],
        ['health', 'subscription_health'],
        ['education', 'subscription_education'],
        ['other', 'subscription_other'],
      ]);
      const categories = database.prepare(`
        SELECT id, name, sort_order FROM subscription_categories ORDER BY sort_order, id
      `).all();
      const updateCategory = database.prepare(`
        UPDATE subscription_categories SET budget_subcategory_key = ? WHERE id = ?
      `);
      const upsertSubcategory = database.prepare(`
        INSERT INTO budget_subcategories (key, category_key, name, sort_order)
        VALUES (?, 'subscriptions', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          category_key = excluded.category_key,
          name = excluded.name,
          sort_order = excluded.sort_order
      `);
      for (const category of categories) {
        const key = defaultKeys.get(category.name.toLowerCase()) || `subscription_category_${category.id}`;
        updateCategory.run(key, category.id);
        upsertSubcategory.run(key, category.name, category.sort_order);
      }

      database.prepare(`
        UPDATE budget_entries
        SET category = 'subscriptions',
            subcategory = COALESCE((
              SELECT c.budget_subcategory_key
              FROM budget_subscriptions s
              LEFT JOIN subscription_categories c ON c.id = s.category_id
              WHERE s.budget_entry_id = budget_entries.id
            ), '')
        WHERE id IN (
          SELECT budget_entry_id FROM budget_subscriptions WHERE budget_entry_id IS NOT NULL
        )
      `).run();
    },
  },
  {
    version: 60,
    description: 'add notification channel delivery tracking',
    up: `
      CREATE TABLE IF NOT EXISTS notification_channels (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        provider        TEXT    NOT NULL,
        name            TEXT    NOT NULL,
        enabled         INTEGER NOT NULL DEFAULT 0,
        scope           TEXT    NOT NULL DEFAULT 'household',
        user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
        config_json     TEXT    NOT NULL DEFAULT '{}',
        secret_json     TEXT    NOT NULL DEFAULT '{}',
        last_test_at    TEXT,
        last_success_at TEXT,
        last_error      TEXT,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_notification_channels_provider
        ON notification_channels(provider);

      CREATE INDEX IF NOT EXISTS idx_notification_channels_enabled
        ON notification_channels(enabled);

      CREATE INDEX IF NOT EXISTS idx_notification_channels_user
        ON notification_channels(user_id);

      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        reminder_id     INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
        provider        TEXT    NOT NULL,
        channel_id      INTEGER REFERENCES notification_channels(id) ON DELETE SET NULL,
        target_key      TEXT    NOT NULL,
        status          TEXT    NOT NULL DEFAULT 'pending'
                                  CHECK(status IN ('pending', 'sent', 'failed', 'skipped')),
        attempt_count   INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_attempt_at TEXT,
        sent_at         TEXT,
        error           TEXT,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(reminder_id, provider, target_key)
      );

      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_reminder
        ON notification_deliveries(reminder_id);

      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_retry
        ON notification_deliveries(status, next_attempt_at);
    `,
  },
  {
    version: 61,
    description: 'add per-user read-only calendar feed token',
    up: `
      ALTER TABLE users ADD COLUMN calendar_feed_token TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_calendar_feed_token
        ON users(calendar_feed_token)
        WHERE calendar_feed_token IS NOT NULL;
    `,
  },
  {
    version: 62,
    description: 'restore reminders.pushed_at dropped by the migration 57 table rebuild',
    up: `
      ALTER TABLE reminders ADD COLUMN pushed_at TEXT;
    `,
  },
  {
    version: 63,
    description: 'Remove existing family members incorrectly added to split_expense_guest_users',
    up: `
      DELETE FROM split_expense_guest_users
      WHERE user_id NOT IN (
        SELECT DISTINCT entity_id FROM expense_activity
        WHERE type = 'guest_created' AND entity_type = 'member' AND entity_id IS NOT NULL
      );
    `,
  },
  {
    version: 64,
    description: 'add recurring meal templates',
    up: `
      CREATE TABLE IF NOT EXISTS meal_recurrence_templates (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        start_date TEXT    NOT NULL,
        weekday    INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
        meal_type  TEXT    NOT NULL
                           CHECK(meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
        title      TEXT    NOT NULL,
        notes      TEXT,
        recipe_url TEXT,
        recipe_id  INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS meal_recurrence_ingredients (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES meal_recurrence_templates(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        quantity    TEXT,
        category    TEXT    NOT NULL DEFAULT 'Sonstiges',
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS meal_recurrence_exceptions (
        template_id INTEGER NOT NULL REFERENCES meal_recurrence_templates(id) ON DELETE CASCADE,
        date        TEXT    NOT NULL,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (template_id, date)
      );

      ALTER TABLE meals ADD COLUMN recurrence_template_id INTEGER REFERENCES meal_recurrence_templates(id) ON DELETE SET NULL;

      CREATE TRIGGER IF NOT EXISTS trg_meal_recurrence_templates_updated_at
        AFTER UPDATE ON meal_recurrence_templates FOR EACH ROW
        BEGIN UPDATE meal_recurrence_templates SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_meal_recurrence_ingredients_updated_at
        AFTER UPDATE ON meal_recurrence_ingredients FOR EACH ROW
        BEGIN UPDATE meal_recurrence_ingredients SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE INDEX IF NOT EXISTS idx_meal_recurrence_templates_weekday
        ON meal_recurrence_templates(weekday, start_date);
      CREATE INDEX IF NOT EXISTS idx_meal_recurrence_ingredients_template
        ON meal_recurrence_ingredients(template_id);
      CREATE INDEX IF NOT EXISTS idx_meals_recurrence_template
        ON meals(recurrence_template_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_meals_recurrence_occurrence
        ON meals(recurrence_template_id, date)
        WHERE recurrence_template_id IS NOT NULL;
    `,
  },
  {
    version: 65,
    description: 'add health module: vitals, medications, schedules, logs, lab reports/results, activities',
    up: `

      CREATE TABLE IF NOT EXISTS health_vitals (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type        TEXT    NOT NULL,
        value_num   REAL,
        value_num2  REAL,
        value_num3  REAL,
        unit        TEXT,
        measured_at TEXT    NOT NULL,
        note        TEXT,
        visibility  TEXT    NOT NULL DEFAULT 'private'
                            CHECK(visibility IN ('private', 'family')),
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Medikamente (Stammdaten)
      CREATE TABLE IF NOT EXISTS medications (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name             TEXT    NOT NULL,
        dosage_text      TEXT,
        form             TEXT,
        active           INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        prn              INTEGER NOT NULL DEFAULT 0 CHECK(prn IN (0, 1)),
        stock_qty        REAL,
        stock_unit       TEXT,
        refill_threshold REAL,
        note             TEXT,
        visibility       TEXT    NOT NULL DEFAULT 'private'
                                 CHECK(visibility IN ('private', 'family')),
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Einnahmeplan (1 Med : n Zeitfenster)
      CREATE TABLE IF NOT EXISTS medication_schedules (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
        time_of_day   TEXT    NOT NULL,
        days_mask     INTEGER CHECK(days_mask IS NULL OR (days_mask BETWEEN 0 AND 127)),
        dose_qty      REAL,
        start_date    TEXT,
        end_date      TEXT,
        active        INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Dosis-Ereignisse (Log)
      CREATE TABLE IF NOT EXISTS medication_logs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
        schedule_id   INTEGER REFERENCES medication_schedules(id) ON DELETE SET NULL,
        scheduled_at  TEXT,
        status        TEXT    NOT NULL DEFAULT 'pending'
                              CHECK(status IN ('taken', 'skipped', 'pending')),
        taken_at      TEXT,
        dose_qty      REAL,
        note          TEXT,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Laborbefund (Kopf)
      CREATE TABLE IF NOT EXISTS health_lab_reports (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_date TEXT    NOT NULL,
        lab_name    TEXT,
        note        TEXT,
        visibility  TEXT    NOT NULL DEFAULT 'private'
                            CHECK(visibility IN ('private', 'family')),
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- Analyt-Werte je Befund
      CREATE TABLE IF NOT EXISTS health_lab_results (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id  INTEGER NOT NULL REFERENCES health_lab_reports(id) ON DELETE CASCADE,
        analyte    TEXT    NOT NULL,
        value_num  REAL,
        unit       TEXT,
        ref_low    REAL,
        ref_high   REAL,
        flag       TEXT    CHECK(flag IS NULL OR flag IN ('low', 'normal', 'high')),
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );


      CREATE TABLE IF NOT EXISTS health_activities (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type         TEXT    NOT NULL,
        duration_min REAL,
        distance_km  REAL,
        intensity    TEXT,
        calories     REAL,
        performed_at TEXT    NOT NULL,
        note         TEXT,
        visibility   TEXT    NOT NULL DEFAULT 'private'
                             CHECK(visibility IN ('private', 'family')),
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      -- updated_at-Trigger (je Tabelle mit updated_at)
      CREATE TRIGGER IF NOT EXISTS trg_health_vitals_updated_at
        AFTER UPDATE ON health_vitals FOR EACH ROW
        BEGIN UPDATE health_vitals SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_medications_updated_at
        AFTER UPDATE ON medications FOR EACH ROW
        BEGIN UPDATE medications SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_medication_schedules_updated_at
        AFTER UPDATE ON medication_schedules FOR EACH ROW
        BEGIN UPDATE medication_schedules SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_health_lab_reports_updated_at
        AFTER UPDATE ON health_lab_reports FOR EACH ROW
        BEGIN UPDATE health_lab_reports SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_health_activities_updated_at
        AFTER UPDATE ON health_activities FOR EACH ROW
        BEGIN UPDATE health_activities SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      -- Indizes
      CREATE INDEX IF NOT EXISTS idx_health_vitals_user_measured
        ON health_vitals(user_id, measured_at);
      CREATE INDEX IF NOT EXISTS idx_health_activities_user_performed
        ON health_activities(user_id, performed_at);
      CREATE INDEX IF NOT EXISTS idx_health_lab_reports_user_date
        ON health_lab_reports(user_id, report_date);
      CREATE INDEX IF NOT EXISTS idx_health_lab_results_report
        ON health_lab_results(report_id);
      CREATE INDEX IF NOT EXISTS idx_medications_user
        ON medications(user_id);
      CREATE INDEX IF NOT EXISTS idx_medication_logs_med_scheduled
        ON medication_logs(medication_id, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_medication_schedules_med_active
        ON medication_schedules(medication_id, active);
    `,
  },
  {
    version: 66,
    description: 'index medications and health activities in the FTS5 search_index (visibility scoping applied at query time)',
    up: `
      -- ---- medications ----
      CREATE TRIGGER trg_search_meds_ai AFTER INSERT ON medications BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('medication', NEW.id, COALESCE(NEW.name, ''), COALESCE(NEW.dosage_text, ''));
      END;
      CREATE TRIGGER trg_search_meds_ad AFTER DELETE ON medications BEGIN
        DELETE FROM search_index WHERE entity = 'medication' AND entity_id = OLD.id;
      END;
      CREATE TRIGGER trg_search_meds_au AFTER UPDATE ON medications BEGIN
        DELETE FROM search_index WHERE entity = 'medication' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('medication', NEW.id, COALESCE(NEW.name, ''), COALESCE(NEW.dosage_text, ''));
      END;

      -- ---- health_activities ----
      CREATE TRIGGER trg_search_activities_ai AFTER INSERT ON health_activities BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('activity', NEW.id, COALESCE(NEW.type, ''), COALESCE(NEW.note, ''));
      END;
      CREATE TRIGGER trg_search_activities_ad AFTER DELETE ON health_activities BEGIN
        DELETE FROM search_index WHERE entity = 'activity' AND entity_id = OLD.id;
      END;
      CREATE TRIGGER trg_search_activities_au AFTER UPDATE ON health_activities BEGIN
        DELETE FROM search_index WHERE entity = 'activity' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('activity', NEW.id, COALESCE(NEW.type, ''), COALESCE(NEW.note, ''));
      END;

      -- Backfill from existing rows.
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'medication', id, COALESCE(name, ''), COALESCE(dosage_text, '') FROM medications;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'activity', id, COALESCE(type, ''), COALESCE(note, '') FROM health_activities;
    `,
  },
  {
    version: 67,
    description: 'Store local family_documents.content_data as binary BLOB instead of base64 TEXT (#332)',


    // Numerik zu Text, niemals BLOB). Ergebnis: ~25 % weniger Speicher pro lokal





    up: (database) => {
      const ids = database.prepare(`
        SELECT id FROM family_documents
        WHERE storage_backend = 'local'
          AND content_data IS NOT NULL
          AND content_data <> ''
      `).all().map((row) => row.id);
      const read = database.prepare('SELECT content_data FROM family_documents WHERE id = ?');
      const write = database.prepare('UPDATE family_documents SET content_data = ? WHERE id = ?');
      for (const id of ids) {
        const value = read.get(id)?.content_data;
        if (value === null || value === undefined || Buffer.isBuffer(value)) continue;
        write.run(Buffer.from(String(value), 'base64'), id);
      }
    },
  },
  {
    version: 68,
    description: 'Shopping items: optionale notes/url-Attribute; notes im FTS-Suchindex',
    up: `
      ALTER TABLE shopping_items ADD COLUMN notes TEXT;
      ALTER TABLE shopping_items ADD COLUMN url   TEXT;




      DROP TRIGGER IF EXISTS trg_search_items_ai;
      DROP TRIGGER IF EXISTS trg_search_items_au;

      CREATE TRIGGER trg_search_items_ai AFTER INSERT ON shopping_items BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('item', NEW.id, COALESCE(NEW.name, ''), COALESCE(NEW.notes, ''));
      END;
      CREATE TRIGGER trg_search_items_au AFTER UPDATE ON shopping_items BEGIN
        DELETE FROM search_index WHERE entity = 'item' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('item', NEW.id, COALESCE(NEW.name, ''), COALESCE(NEW.notes, ''));
      END;

      DELETE FROM search_index WHERE entity = 'item';
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'item', id, COALESCE(name, ''), COALESCE(notes, '') FROM shopping_items;
    `,
  },
  {
    version: 69,
    description: 'Reward-System: optionaler Punktewert je Aufgabe',
    up: `
      ALTER TABLE tasks ADD COLUMN points INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 70,
    description: 'Reward-System: Teilnehmer, Prämien-Katalog, Einlösungen, Punkte-Ledger',
    up: `
      -- Wer nimmt am Punkte-System teil (opt-in je Mitglied). Zeile vorhanden =

      CREATE TABLE reward_participants (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );


      CREATE TABLE reward_catalog (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        cost        INTEGER NOT NULL,
        icon        TEXT,
        description TEXT,
        is_active   INTEGER NOT NULL DEFAULT 1,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );





      CREATE TABLE reward_redemptions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        catalog_id   INTEGER REFERENCES reward_catalog(id) ON DELETE SET NULL,
        reward_name  TEXT    NOT NULL,
        reward_icon  TEXT,
        cost         INTEGER NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'pending'
                             CHECK(status IN ('pending', 'fulfilled', 'rejected', 'cancelled')),
        note         TEXT,
        requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        decided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        decided_at   TEXT,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );


      -- Summe aller delta-Werte. Positive delta = verdient/Bonus, negative =

      CREATE TABLE reward_ledger (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta         INTEGER NOT NULL,
        type          TEXT    NOT NULL
                              CHECK(type IN ('earn', 'bonus', 'redeem', 'adjust', 'reversal')),
        reason        TEXT,
        task_id       INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        redemption_id INTEGER REFERENCES reward_redemptions(id) ON DELETE SET NULL,
        created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );



      CREATE UNIQUE INDEX uniq_reward_earn ON reward_ledger(task_id, user_id) WHERE type = 'earn';
      CREATE INDEX idx_reward_ledger_user ON reward_ledger(user_id);
      CREATE INDEX idx_reward_ledger_redemption ON reward_ledger(redemption_id);
      CREATE INDEX idx_reward_redemptions_status ON reward_redemptions(status);
    `,
  },
  {
    version: 71,
    description: 'add menstrual cycle tracking to health module: periods, day logs, per-user settings',
    up: `



      -- sind sensibel → Default 'private'.
      CREATE TABLE IF NOT EXISTS cycle_periods (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        start_date TEXT    NOT NULL,
        end_date   TEXT,
        note       TEXT,
        visibility TEXT    NOT NULL DEFAULT 'private'
                           CHECK(visibility IN ('private', 'family')),
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );




      CREATE TABLE IF NOT EXISTS cycle_day_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        log_date   TEXT    NOT NULL,
        flow       TEXT    CHECK(flow IS NULL OR flow IN ('spotting', 'light', 'medium', 'heavy')),
        symptoms   TEXT,
        mood       TEXT,
        note       TEXT,
        visibility TEXT    NOT NULL DEFAULT 'private'
                           CHECK(visibility IN ('private', 'family')),
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(user_id, log_date)
      );


      -- abgeleiteten Mittelwerte). NULL = automatisch aus Historie ableiten.
      CREATE TABLE IF NOT EXISTS cycle_settings (
        user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        cycle_length_avg  INTEGER,
        period_length_avg INTEGER,
        luteal_length     INTEGER NOT NULL DEFAULT 14,
        track_fertility   INTEGER NOT NULL DEFAULT 1 CHECK(track_fertility IN (0, 1)),
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TRIGGER IF NOT EXISTS trg_cycle_periods_updated_at
        AFTER UPDATE ON cycle_periods FOR EACH ROW
        BEGIN UPDATE cycle_periods SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_cycle_day_logs_updated_at
        AFTER UPDATE ON cycle_day_logs FOR EACH ROW
        BEGIN UPDATE cycle_day_logs SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER IF NOT EXISTS trg_cycle_settings_updated_at
        AFTER UPDATE ON cycle_settings FOR EACH ROW
        BEGIN UPDATE cycle_settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE user_id = OLD.user_id; END;

      CREATE INDEX IF NOT EXISTS idx_cycle_periods_user_start
        ON cycle_periods(user_id, start_date);
      CREATE INDEX IF NOT EXISTS idx_cycle_day_logs_user_date
        ON cycle_day_logs(user_id, log_date);
    `,
  },
  {
    version: 72,
    description: 'add per-scope permissions to api_tokens (module:read/module:write allow-list)',
    up: `

      -- NULL bedeutet bewusst „kein Scoping" → voller rollenbasierter Zugriff, damit




      ALTER TABLE api_tokens ADD COLUMN scopes TEXT DEFAULT NULL;
    `,
  },
  {
    version: 73,
    description: 'recipe meal type suitability for planner integrations',
    up: `
      ALTER TABLE recipes ADD COLUMN meal_types TEXT NOT NULL DEFAULT 'breakfast,lunch,dinner,snack';
    `,
  },
  {
    version: 74,
    description: 'role- and member-based access permissions for modules and widgets (#467)',
    up: `







      --
      --   subject_type  'role'  → subject_id = users.family_role
      --                 'user'  → subject_id = users.id (als Text)

      --                 'widget'→ resource_key = Dashboard-Widget-ID
      --   access        Module : 'none' | 'read' | 'write'

      CREATE TABLE IF NOT EXISTS access_permissions (
        subject_type  TEXT NOT NULL CHECK(subject_type IN ('role', 'user')),
        subject_id    TEXT NOT NULL,
        resource_type TEXT NOT NULL CHECK(resource_type IN ('module', 'widget')),
        resource_key  TEXT NOT NULL,
        access        TEXT NOT NULL CHECK(access IN ('none', 'read', 'write', 'allow')),
        updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (subject_type, subject_id, resource_type, resource_key)
      );
      CREATE INDEX IF NOT EXISTS idx_access_permissions_subject
        ON access_permissions(subject_type, subject_id);
    `,
  },
  {
    version: 75,
    description: 'planned/estimated budget: per-category monthly caps + monthly savings goal (#468)',
    up: `




      --


      --   amount    = geplanter Monatsbetrag, immer positiv (Deckel bzw. Sparziel), 2 Nachkommastellen.
      --



      CREATE TABLE IF NOT EXISTS budget_plans (
        category    TEXT NOT NULL PRIMARY KEY,
        amount      REAL NOT NULL,
        created_by  TEXT,
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
    `,
  },
  {
    version: 76,
    description: 'Kalender-Events: Ort (location) zusätzlich im FTS-Suchindex (#471)',
    up: `





      DROP TRIGGER IF EXISTS trg_search_events_ai;
      DROP TRIGGER IF EXISTS trg_search_events_au;

      CREATE TRIGGER trg_search_events_ai AFTER INSERT ON calendar_events BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('event', NEW.id,
                COALESCE(NEW.title, ''),
                TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.location, '')));
      END;
      CREATE TRIGGER trg_search_events_au AFTER UPDATE ON calendar_events BEGIN
        DELETE FROM search_index WHERE entity = 'event' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('event', NEW.id,
                COALESCE(NEW.title, ''),
                TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.location, '')));
      END;

      DELETE FROM search_index WHERE entity = 'event';
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'event', id,
               COALESCE(title, ''),
               TRIM(COALESCE(description, '') || ' ' || COALESCE(location, ''))
        FROM calendar_events;
    `,
  },
  {
    version: 77,
    description: 'FTS-Suchindex diakritik-insensitiv neu aufbauen (unicode61 remove_diacritics 2, #471)',
    up: `





      -- index-weit neu eingelesen (Reihenfolge = Trigger-Bodies der jeweiligen Module).
      DROP TABLE IF EXISTS search_index;
      CREATE VIRTUAL TABLE search_index USING fts5(
        entity UNINDEXED,
        entity_id UNINDEXED,
        title,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'task', id, COALESCE(title, ''), COALESCE(description, '') FROM tasks;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'event', id, COALESCE(title, ''),
               TRIM(COALESCE(description, '') || ' ' || COALESCE(location, '')) FROM calendar_events;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'note', id, COALESCE(title, ''), COALESCE(content, '') FROM notes;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'contact', id, COALESCE(name, ''),
               COALESCE(phone, '') || ' ' || COALESCE(email, '') FROM contacts;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'item', id, COALESCE(name, ''), COALESCE(notes, '') FROM shopping_items;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'medication', id, COALESCE(name, ''), COALESCE(dosage_text, '') FROM medications;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'activity', id, COALESCE(type, ''), COALESCE(note, '') FROM health_activities;
    `,
  },
  {
    version: 78,
    description: 'Sichtbarkeit pro Aufgabe/Termin: all | assignees | private (#474)',
    up: `


      -- serverseitig auf allen Lesepfaden (Liste, Detail, Dashboard, Suche, Reminder).
      ALTER TABLE tasks           ADD COLUMN visibility TEXT NOT NULL DEFAULT 'all';
      ALTER TABLE calendar_events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'all';
    `,
  },
  {
    version: 79,
    description: 'Standard-Zuweisung pro Kalender-Sync-Ziel (#459)',
    up: `
      -- Optionale Standard-Person je Sync-Ziel: neu importierte Termine werden ihr
      -- automatisch zugewiesen. NULL = keine Zuweisung (bisheriges Verhalten).


      ALTER TABLE external_calendars ADD COLUMN default_assignee_user_id INTEGER;
      ALTER TABLE ics_subscriptions  ADD COLUMN default_assignee_user_id INTEGER;
    `,
  },
  {
    version: 80,
    description: 'Opt-in: zugewiesene Personen im Kalender-Feed-Titel anzeigen (#482)',
    up: `


      ALTER TABLE users ADD COLUMN calendar_feed_show_assignees INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 81,
    description: 'Budget-Konten mit Startsaldo + optionale Konto-Zuordnung je Eintrag (#495)',
    up: `
      -- Getrennte Konten (Giro, Sparen, Bar …) mit fortlaufendem Saldo.

      CREATE TABLE IF NOT EXISTS budget_accounts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL,
        type             TEXT    NOT NULL DEFAULT 'checking',
        starting_balance REAL    NOT NULL DEFAULT 0,
        currency         TEXT,
        color            TEXT,
        archived         INTEGER NOT NULL DEFAULT 0,
        sort_order       INTEGER NOT NULL DEFAULT 0,
        created_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE TRIGGER IF NOT EXISTS trg_budget_accounts_updated_at
        AFTER UPDATE ON budget_accounts FOR EACH ROW
        BEGIN UPDATE budget_accounts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      -- Optionale Konto-Zuordnung je Eintrag; NULL = keinem Konto zugeordnet



      ALTER TABLE budget_entries ADD COLUMN account_id INTEGER
        REFERENCES budget_accounts(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_budget_account ON budget_entries(account_id);
    `,
  },
  {
    version: 82,
    description: 'Schwangerschafts-Modus im Zyklus-Tab: pausiert Vorhersagen, optionaler Entbindungstermin (#450)',
    up: `




      ALTER TABLE cycle_settings ADD COLUMN pregnancy_mode INTEGER NOT NULL DEFAULT 0
        CHECK(pregnancy_mode IN (0, 1));
      -- Optionaler errechneter Entbindungstermin (YYYY-MM-DD); NULL = ohne Termin,

      ALTER TABLE cycle_settings ADD COLUMN pregnancy_due_date TEXT;
    `,
  },
  {
    version: 83,
    description: 'Task categories as a customizable, sortable table (#494, #357)',
    up: `


      -- label_key (name = NULL → lokalisiert); Custom-Kategorien tragen name, label_key NULL.
      CREATE TABLE IF NOT EXISTS task_categories (
        key        TEXT    PRIMARY KEY,
        name       TEXT,
        label_key  TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT OR IGNORE INTO task_categories (key, name, label_key, sort_order) VALUES
        ('household', NULL, 'tasks.categoryHousehold', 0),
        ('school',    NULL, 'tasks.categorySchool',    1),
        ('shopping',  NULL, 'tasks.categoryShopping',  2),
        ('repair',    NULL, 'tasks.categoryRepair',    3),
        ('health',    NULL, 'tasks.categoryHealth',    4),
        ('finance',   NULL, 'tasks.categoryFinance',   5),
        ('leisure',   NULL, 'tasks.categoryLeisure',   6),
        ('misc',      NULL, 'tasks.categoryMisc',      7);


      UPDATE tasks SET category = 'misc' WHERE category = 'Sonstiges' OR category IS NULL OR category = '';


      INSERT OR IGNORE INTO task_categories (key, name, label_key, sort_order)
      SELECT category, category, NULL, 1000
      FROM tasks
      WHERE category IS NOT NULL AND category != ''
        AND category NOT IN (SELECT key FROM task_categories)
      GROUP BY category;
    `,
  },
  {
    version: 84,
    description: 'Contact categories as a customizable, sortable table with icons (#357)',
    up: `



      -- Lokalisierung tragen. icon speichert das Lucide-Icon je Kategorie.
      CREATE TABLE IF NOT EXISTS contact_categories (
        key        TEXT    PRIMARY KEY,
        name       TEXT,
        label_key  TEXT,
        icon       TEXT    NOT NULL DEFAULT 'tag',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT OR IGNORE INTO contact_categories (key, name, label_key, icon, sort_order) VALUES
        ('doctor',    NULL, 'contacts.categoryDoctor',    'stethoscope',    0),
        ('school',    NULL, 'contacts.categorySchool',    'graduation-cap', 1),
        ('authority', NULL, 'contacts.categoryAuthority', 'landmark',       2),
        ('insurance', NULL, 'contacts.categoryInsurance', 'shield',         3),
        ('craftsman', NULL, 'contacts.categoryCraftsman', 'wrench',         4),
        ('emergency', NULL, 'contacts.categoryEmergency', 'siren',          5),
        ('misc',      NULL, 'contacts.categoryOther',     'tag',            6);

      -- Bestandswerte (deutsche Namen) auf stabile Keys migrieren.
      UPDATE contacts SET category = CASE category
        WHEN 'Arzt'         THEN 'doctor'
        WHEN 'Schule/Kita'  THEN 'school'
        WHEN 'Behörde'      THEN 'authority'
        WHEN 'Versicherung' THEN 'insurance'
        WHEN 'Handwerker'   THEN 'craftsman'
        WHEN 'Notfall'      THEN 'emergency'
        WHEN 'Sonstiges'    THEN 'misc'
        ELSE category
      END;
      UPDATE contacts SET category = 'misc' WHERE category IS NULL OR category = '';


      INSERT OR IGNORE INTO contact_categories (key, name, label_key, icon, sort_order)
      SELECT category, category, NULL, 'tag', 1000
      FROM contacts
      WHERE category IS NOT NULL AND category != ''
        AND category NOT IN (SELECT key FROM contact_categories)
      GROUP BY category;
    `,
  },
  {
    version: 85,
    description: 'Single-occurrence exceptions for recurring calendar events (EXDATE, #489)',
    up: `
      -- Ausnahmen einzelner Vorkommen einer wiederkehrenden Serie (EXDATE).

      -- ausgenommenem Instanz-Datum. ON DELETE CASCADE entfernt die Ausnahmen,

      CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
        event_id       INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
        exception_date TEXT    NOT NULL,
        created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (event_id, exception_date)
      );
    `,
  },
  {
    version: 86,
    description: 'Link family documents to tasks (#503)',
    up: `




      CREATE TABLE IF NOT EXISTS task_documents (
        task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES family_documents(id) ON DELETE CASCADE,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (task_id, document_id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_documents_document ON task_documents(document_id);
    `,
  },
  {
    version: 87,
    description: 'School-holiday group code for multilingual cantons (#434)',
    up: `
      -- OpenHolidays modelliert innerhalb EINER Subdivision teils mehrere
      -- Schulferien-Regime (z. B. Kanton Bern: deutschsprachige Region CH-BE-VS




      ALTER TABLE holiday_cache ADD COLUMN group_code TEXT;
    `,
  },
  {
    version: 88,
    description: 'Budget personal/shared: owner_id + visibility on entries, loans, subscriptions (#476/#505)',
    up: `


      -- Sichtbarkeit (private/shared). Bestand → shared = bisheriges Haushalts-



      ALTER TABLE budget_entries ADD COLUMN owner_id INTEGER
        REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE budget_entries ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared'
        CHECK (visibility IN ('private', 'shared'));
      UPDATE budget_entries SET owner_id = created_by WHERE owner_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_budget_owner ON budget_entries(owner_id);

      ALTER TABLE budget_loans ADD COLUMN owner_id INTEGER
        REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE budget_loans ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared'
        CHECK (visibility IN ('private', 'shared'));
      UPDATE budget_loans SET owner_id = created_by WHERE owner_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_budget_loans_owner ON budget_loans(owner_id);

      ALTER TABLE budget_subscriptions ADD COLUMN owner_id INTEGER
        REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE budget_subscriptions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared'
        CHECK (visibility IN ('private', 'shared'));
      UPDATE budget_subscriptions SET owner_id = created_by WHERE owner_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_budget_subs_owner ON budget_subscriptions(owner_id);
    `,
  },
  {
    version: 89,
    description: 'CardDAV contact origin: distinguish remotely imported from locally adopted contacts',
    up: `







      -- NULL = kein CardDAV-Bezug (rein lokaler Kontakt).
      --





      -- importierte Kontakte tragen ihre echte Herkunft.
      ALTER TABLE contacts ADD COLUMN carddav_origin TEXT
        CHECK (carddav_origin IN ('remote', 'merged'));

      UPDATE contacts SET carddav_origin = 'merged' WHERE carddav_uid IS NOT NULL;
    `,
  },
  {
    version: 90,
    description: 'Link imported birthdays to their source contact',
    up: `




      -- Geburtstag als rein lokaler Eintrag bestehen.
      ALTER TABLE birthdays ADD COLUMN contact_id INTEGER
        REFERENCES contacts(id) ON DELETE SET NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_birthdays_contact_id
        ON birthdays(contact_id) WHERE contact_id IS NOT NULL;
    `,
  },
  {
    version: 91,
    description: 'Heal CardDAV contacts synced with escaped names, missing details, wrong category (#531)',
    up: `
      -- Bereits per CardDAV synchronisierte Kontakte (carddav_uid IS NOT NULL)




      UPDATE contacts SET category = 'misc'
        WHERE carddav_uid IS NOT NULL AND category = 'Sonstiges';


      -- kein Metazeichen, daher matcht '%\\,%' die Sequenz Backslash+Komma direkt.
      UPDATE contacts
        SET name = REPLACE(REPLACE(REPLACE(name, '\\,', ','), '\\;', ';'), '\\\\', '\\')
        WHERE carddav_uid IS NOT NULL
          AND (name LIKE '%\\,%' OR name LIKE '%\\;%' OR name LIKE '%\\\\%');




      UPDATE contacts SET phone = (
          SELECT value FROM contact_phones
          WHERE contact_id = contacts.id ORDER BY is_primary DESC, id ASC LIMIT 1
        )
        WHERE carddav_uid IS NOT NULL AND phone IS NULL
          AND EXISTS (SELECT 1 FROM contact_phones WHERE contact_id = contacts.id);

      UPDATE contacts SET email = (
          SELECT value FROM contact_emails
          WHERE contact_id = contacts.id ORDER BY is_primary DESC, id ASC LIMIT 1
        )
        WHERE carddav_uid IS NOT NULL AND email IS NULL
          AND EXISTS (SELECT 1 FROM contact_emails WHERE contact_id = contacts.id);
    `,
  },
  {
    version: 92,
    description: 'Surface CardDAV sync errors in the UI instead of only the server log (#534)',
    up: `




      ALTER TABLE carddav_accounts ADD COLUMN last_error TEXT;
      ALTER TABLE carddav_accounts ADD COLUMN last_error_at TEXT;
    `,
  },
  {
    version: 93,
    description: 'Attach CardDAV sync errors to the failing address book, not just the account (#534)',
    up: `




      ALTER TABLE carddav_addressbook_selection ADD COLUMN last_error TEXT;
    `,
  },
  {
    version: 94,
    description: 'Store structured vCard N name components for contacts (#535)',
    up: `

      -- Quellen formatieren FN unterschiedlich ("Given Family" vs. "Family, Given",





      ALTER TABLE contacts ADD COLUMN first_name TEXT;
      ALTER TABLE contacts ADD COLUMN last_name TEXT;
      ALTER TABLE contacts ADD COLUMN middle_name TEXT;
      ALTER TABLE contacts ADD COLUMN name_prefix TEXT;
      ALTER TABLE contacts ADD COLUMN name_suffix TEXT;
    `,
  },
  {
    version: 95,
    description: 'Add additive value_e164 column to contact_phones for format-independent CardDAV matching (libphonenumber-js)',
    up: `





      ALTER TABLE contact_phones ADD COLUMN value_e164 TEXT;
      CREATE INDEX idx_contact_phones_e164 ON contact_phones(value_e164);
    `,
    afterUp: (db) => {


      // Nummern mit internationaler Vorwahl (+) normalisiert.
      const defaultCountry = defaultCountryFromConfig(db);
      const rows = db.prepare('SELECT id, value FROM contact_phones').all();
      const upd = db.prepare('UPDATE contact_phones SET value_e164 = ? WHERE id = ?');
      for (const row of rows) {
        const e164 = toE164(row.value, defaultCountry);
        if (e164) upd.run(e164, row.id); // nur wo parsebar; sonst bleibt NULL
      }
    },
  },
  {
    version: 96,
    description: 'Add default_visibility to cycle_settings so new cycle entries can default to family-visible',
    up: `




      ALTER TABLE cycle_settings ADD COLUMN default_visibility TEXT NOT NULL DEFAULT 'private'
        CHECK(default_visibility IN ('private', 'family'));
    `,
  },
  {
    version: 97,
    description: 'Add tzid to calendar_events for DST-correct recurrence expansion (#549)',
    up: `

      -- CalDAV/Apple-Wiederholungen relevant, die am Anzeige-Zeitpunkt expandiert



      ALTER TABLE calendar_events ADD COLUMN tzid TEXT;
    `,
  },
  {
    version: 98,
    description: 'Add Google Drive as a document storage backend',
    foreignKeysOff: true,
    up: `
      CREATE TABLE family_documents_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL,
        description      TEXT,
        category         TEXT    NOT NULL DEFAULT 'other'
                                  CHECK(category IN ('medical', 'school', 'identity', 'insurance', 'finance', 'home', 'vehicle', 'legal', 'travel', 'pets', 'warranty', 'taxes', 'work', 'other')),
        status           TEXT    NOT NULL DEFAULT 'active'
                                  CHECK(status IN ('active', 'archived')),
        visibility       TEXT    NOT NULL DEFAULT 'family'
                                  CHECK(visibility IN ('family', 'restricted', 'private')),
        original_name    TEXT    NOT NULL,
        mime_type        TEXT    NOT NULL,
        file_size        INTEGER NOT NULL,
        content_data     TEXT    NOT NULL,
        storage_provider TEXT    NOT NULL DEFAULT 'local'
                                  CHECK(storage_provider IN ('local', 'external')),
        storage_key      TEXT,
        created_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        folder_id        INTEGER REFERENCES family_document_folders(id) ON DELETE SET NULL,
        dms_account_id   INTEGER REFERENCES dms_accounts(id) ON DELETE SET NULL,
        external_url     TEXT,
        external_meta    TEXT,
        storage_backend  TEXT    NOT NULL DEFAULT 'local'
                                  CHECK(storage_backend IN ('local', 'webdav', 'dms', 'google_drive'))
      );

      INSERT INTO family_documents_new (
        id, name, description, category, status, visibility, original_name,
        mime_type, file_size, content_data, storage_provider, storage_key,
        created_by, created_at, updated_at, folder_id, dms_account_id,
        external_url, external_meta, storage_backend
      )
      SELECT
        id, name, description, category, status, visibility, original_name,
        mime_type, file_size, content_data, storage_provider, storage_key,
        created_by, created_at, updated_at, folder_id, dms_account_id,
        external_url, external_meta, storage_backend
      FROM family_documents;

      DROP TABLE family_documents;
      ALTER TABLE family_documents_new RENAME TO family_documents;

      UPDATE family_documents
      SET visibility = CASE
        WHEN EXISTS (
          SELECT 1 FROM calendar_events e
          WHERE e.attachment_document_id = family_documents.id
            AND e.visibility = 'all'
        ) THEN 'family'
        WHEN EXISTS (
          SELECT 1 FROM calendar_events e
          WHERE e.attachment_document_id = family_documents.id
            AND e.visibility = 'assignees'
        ) THEN 'restricted'
        ELSE 'private'
      END
      WHERE EXISTS (
        SELECT 1 FROM calendar_events e
        WHERE e.attachment_document_id = family_documents.id
      );

      DELETE FROM family_document_access
      WHERE document_id IN (
        SELECT attachment_document_id
        FROM calendar_events
        WHERE attachment_document_id IS NOT NULL
      );

      INSERT OR IGNORE INTO family_document_access (document_id, user_id)
      SELECT e.attachment_document_id, ea.user_id
      FROM calendar_events e
      JOIN event_assignments ea ON ea.event_id = e.id
      WHERE e.attachment_document_id IS NOT NULL
        AND e.visibility = 'assignees'
        AND NOT EXISTS (
          SELECT 1 FROM calendar_events family_event
          WHERE family_event.attachment_document_id = e.attachment_document_id
            AND family_event.visibility = 'all'
        );

      CREATE TRIGGER trg_family_documents_updated_at
        AFTER UPDATE ON family_documents FOR EACH ROW
        BEGIN UPDATE family_documents SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER trg_family_documents_storage_insert
        BEFORE INSERT ON family_documents
        FOR EACH ROW
        BEGIN
          SELECT CASE
            WHEN NOT (
              (NEW.storage_provider = 'local' AND NEW.storage_backend = 'local')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'webdav')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'dms')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'google_drive')
            )
            THEN RAISE(ABORT, 'invalid document storage provider/backend combination')
          END;
          SELECT CASE
            WHEN NEW.storage_backend != 'dms' AND NEW.dms_account_id IS NOT NULL
            THEN RAISE(ABORT, 'dms_account_id requires dms storage backend')
          END;
        END;

      CREATE TRIGGER trg_family_documents_storage_update
        BEFORE UPDATE OF storage_provider, storage_backend, dms_account_id ON family_documents
        FOR EACH ROW
        BEGIN
          SELECT CASE
            WHEN NOT (
              (NEW.storage_provider = 'local' AND NEW.storage_backend = 'local')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'webdav')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'dms')
              OR (NEW.storage_provider = 'external' AND NEW.storage_backend = 'google_drive')
            )
            THEN RAISE(ABORT, 'invalid document storage provider/backend combination')
          END;
          SELECT CASE
            WHEN NEW.storage_backend != 'dms' AND NEW.dms_account_id IS NOT NULL
            THEN RAISE(ABORT, 'dms_account_id requires dms storage backend')
          END;
        END;

      CREATE INDEX idx_family_documents_status     ON family_documents(status);
      CREATE INDEX idx_family_documents_category   ON family_documents(category);
      CREATE INDEX idx_family_documents_created_by ON family_documents(created_by);
      CREATE INDEX idx_family_documents_folder     ON family_documents(folder_id);
      CREATE INDEX idx_family_documents_dms        ON family_documents(dms_account_id);
    `,
  },
  {
    version: 99,
    description: 'Add per-group default split method and config for shared expenses (#517)',
    up: `
      -- Persistente Standard-Aufteilung pro Ausgaben-Gruppe (#517): neue Ausgaben



      -- equal/exact. Reine UI-Vorbelegung: die harte Split-Validierung bleibt pro
      -- Ausgabe (buildSplits), daher hier bewusst keine Summen-/FK-Constraints.
      ALTER TABLE expense_groups ADD COLUMN default_split_method TEXT NOT NULL DEFAULT 'equal'
        CHECK(default_split_method IN ('equal', 'exact', 'percentage', 'shares'));
      ALTER TABLE expense_groups ADD COLUMN default_split_config TEXT;
    `,
  },
  {
    version: 100,
    description: 'Loans: optional interest phases (fixed rate + forecast follow-up rate, #569)',
    up: `
      -- Zins-Darlehen (#569): Bisher waren Darlehen zinsfrei (total_amount fest,

      -- nach deutschem Muster abgebildet: Sollzins (fixed_rate) + Anfangstilgung


      -- Zinsbindung (fixed_period_months) rechnet der Prognose-Anschlusszins
      -- (followup_rate) weiter. Der Server leitet daraus total_amount +
      -- installment_count ab, sodass die bestehende Raten-/Status-Logik


      ALTER TABLE budget_loans ADD COLUMN interest_mode TEXT NOT NULL DEFAULT 'none'
        CHECK(interest_mode IN ('none', 'fixed', 'fixed_then_variable'));
      ALTER TABLE budget_loans ADD COLUMN principal REAL;
      ALTER TABLE budget_loans ADD COLUMN fixed_rate REAL;
      ALTER TABLE budget_loans ADD COLUMN initial_repayment_rate REAL;
      ALTER TABLE budget_loans ADD COLUMN fixed_period_months INTEGER;
      ALTER TABLE budget_loans ADD COLUMN followup_rate REAL;
    `,
  },
  {
    version: 101,
    description: 'Loans: allow a purely variable interest rate (#569 follow-up)',
    foreignKeysOff: true,
    up: `
      -- Rein variables Darlehen (#569-Nachtrag): interest_mode kannte bisher nur





      -- Prognosewert ohne Bindung.
      --




      CREATE TABLE budget_loans_new (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        title             TEXT    NOT NULL,
        borrower          TEXT    NOT NULL,
        total_amount      REAL    NOT NULL CHECK(total_amount > 0),
        installment_count INTEGER NOT NULL CHECK(installment_count > 0),
        start_month       TEXT    NOT NULL,
        notes             TEXT,
        status            TEXT    NOT NULL DEFAULT 'active'
                                  CHECK(status IN ('active', 'paid')),
        created_by        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        owner_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        visibility        TEXT    NOT NULL DEFAULT 'shared'
                                  CHECK (visibility IN ('private', 'shared')),
        interest_mode     TEXT    NOT NULL DEFAULT 'none'
                                  CHECK(interest_mode IN ('none', 'fixed', 'variable', 'fixed_then_variable')),
        principal              REAL,
        fixed_rate             REAL,
        initial_repayment_rate REAL,
        fixed_period_months    INTEGER,
        followup_rate          REAL
      );

      INSERT INTO budget_loans_new (
        id, title, borrower, total_amount, installment_count, start_month, notes,
        status, created_by, created_at, updated_at, owner_id, visibility,
        interest_mode, principal, fixed_rate, initial_repayment_rate,
        fixed_period_months, followup_rate
      )
      SELECT
        id, title, borrower, total_amount, installment_count, start_month, notes,
        status, created_by, created_at, updated_at, owner_id, visibility,
        interest_mode, principal, fixed_rate, initial_repayment_rate,
        fixed_period_months, followup_rate
      FROM budget_loans;

      DROP TABLE budget_loans;
      ALTER TABLE budget_loans_new RENAME TO budget_loans;

      CREATE TRIGGER IF NOT EXISTS trg_budget_loans_updated_at
        AFTER UPDATE ON budget_loans FOR EACH ROW
        BEGIN UPDATE budget_loans SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE INDEX IF NOT EXISTS idx_budget_loans_status ON budget_loans(status);
      CREATE INDEX IF NOT EXISTS idx_budget_loans_start_month ON budget_loans(start_month);
      CREATE INDEX IF NOT EXISTS idx_budget_loans_owner ON budget_loans(owner_id);
    `,
  },
  {
    version: 102,
    description: 'Loans: own currency per loan with a fixed conversion rate (#582)',
    up: `




      --



      --







      -- Summenkarte rechnen damit um; das Darlehen selbst rechnet ungewandelt.
      ALTER TABLE budget_loans ADD COLUMN currency TEXT;
      ALTER TABLE budget_loans ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 103,
    description: 'Calendar: tombstones for events deleted locally but still remote (#593)',
    up: `





      --

      -- lokale Zeilen ebenfalls (cancelled-Events, Kalender-Abwahl). Ein Trigger


      --


      CREATE TABLE IF NOT EXISTS calendar_pending_deletions (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        source               TEXT NOT NULL,
        calendar_external_id TEXT NOT NULL,
        event_external_id    TEXT NOT NULL,
        attempts             INTEGER NOT NULL DEFAULT 0,
        last_error           TEXT,
        created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(source, calendar_external_id, event_external_id)
      );

      CREATE INDEX IF NOT EXISTS idx_cal_pending_del_event
        ON calendar_pending_deletions(source, event_external_id);
    `,
  },
  {
    version: 104,
    description: 'Calendar: mark locally edited mirrored events for outbound push (#593)',
    up: `




      --


      -- Push-Signal jeden Sync-Lauf ein Update an Google schicken. outbound_dirty

      --


      ALTER TABLE calendar_events ADD COLUMN outbound_dirty INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE calendar_events ADD COLUMN outbound_attempts INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_calendar_outbound_dirty
        ON calendar_events(outbound_dirty) WHERE outbound_dirty = 1;
    `,
  },
  {
    version: 105,
    description: 'Calendar: queue a pending calendar move for mirrored Google events (#593)',
    up: `


      -- dort belassen.
      --

      -- target_google_calendar_id != calendar_ref_id abgeleitet. Bestandsdaten





      ALTER TABLE calendar_events ADD COLUMN outbound_move_to TEXT;
    `,
  },
  {
    version: 106,
    description: 'Calendar: remember the CalDAV object URL so edits and deletes can reach the server (#593)',
    up: `




      --




      ALTER TABLE calendar_events ADD COLUMN external_object_url TEXT;



      ALTER TABLE calendar_pending_deletions ADD COLUMN object_url TEXT;
    `,
  },
  {
    version: 107,
    description: 'Subscriptions: optional end condition (never / on date / after N payments) (#594)',
    up: `



      --



      ALTER TABLE budget_subscriptions
        ADD COLUMN end_type TEXT NOT NULL DEFAULT 'never'
        CHECK(end_type IN ('never', 'on_date', 'after_count'));
      ALTER TABLE budget_subscriptions ADD COLUMN end_date TEXT;
      ALTER TABLE budget_subscriptions ADD COLUMN occurrence_count INTEGER;



      -- Zahlung ist immer Nummer occurrences_done + 1.
      ALTER TABLE budget_subscriptions
        ADD COLUMN occurrences_done INTEGER NOT NULL DEFAULT 0;



      -- Pausieren.
      ALTER TABLE budget_subscriptions ADD COLUMN completed_at TEXT;
    `,
  },
  {
    version: 108,
    description: 'Pantry: food inventory with quantity, storage location and expiry date (#596)',
    up: `





      -- Lagerorte analog shopping_categories: eigene Tabelle, sortierbar,

      -- DEFAULT_LOCATION_I18N - umbenannte Orte behalten ihren Klartext.
      CREATE TABLE IF NOT EXISTS pantry_locations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        icon       TEXT    NOT NULL DEFAULT 'package',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO pantry_locations (name, icon, sort_order) VALUES
        ('Vorratsschrank', 'archive',      0),
        ('Kühlschrank',    'refrigerator', 1),
        ('Gefrierschrank', 'snowflake',    2),
        ('Keller',         'warehouse',    3),
        ('Sonstiges',      'package',      4);

      CREATE TABLE IF NOT EXISTS pantry_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,




        quantity     REAL    NOT NULL DEFAULT 1,


        -- geteilte Liste in public/utils/pantry-units.js.
        unit         TEXT    NOT NULL DEFAULT 'pcs',


        location_id  INTEGER REFERENCES pantry_locations(id) ON DELETE SET NULL,
        category     TEXT    NOT NULL DEFAULT 'Sonstiges',
        -- YYYY-MM-DD; NULL = unbegrenzt haltbar (Salz, Reis, Konserven ohne MHD).
        expires_on   TEXT,

        -- "fast leer", sobald quantity <= min_quantity.
        min_quantity REAL,
        notes        TEXT,
        created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );





      CREATE INDEX IF NOT EXISTS idx_pantry_items_expires  ON pantry_items(expires_on);
      CREATE INDEX IF NOT EXISTS idx_pantry_items_location ON pantry_items(location_id);
      CREATE INDEX IF NOT EXISTS idx_pantry_items_name     ON pantry_items(name);

      CREATE TRIGGER IF NOT EXISTS trg_pantry_items_updated_at
        AFTER UPDATE ON pantry_items FOR EACH ROW
        BEGIN UPDATE pantry_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
    `,
  },
  {
    version: 109,
    description: 'Pantry: keep household stock when the member who entered it is deleted (#596 follow-up)',
    up: `





      --



      -- ON DELETE SET NULL.
      --

      -- Rebuild (Tabelle neu, Daten kopieren, tauschen). Indizes und Trigger

      CREATE TABLE pantry_items_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,
        quantity     REAL    NOT NULL DEFAULT 1,
        unit         TEXT    NOT NULL DEFAULT 'pcs',
        location_id  INTEGER REFERENCES pantry_locations(id) ON DELETE SET NULL,
        category     TEXT    NOT NULL DEFAULT 'Sonstiges',
        expires_on   TEXT,
        min_quantity REAL,
        notes        TEXT,
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO pantry_items_new
        (id, name, quantity, unit, location_id, category, expires_on, min_quantity, notes, created_by, created_at, updated_at)
        SELECT id, name, quantity, unit, location_id, category, expires_on, min_quantity, notes, created_by, created_at, updated_at
        FROM pantry_items;

      DROP TABLE pantry_items;
      ALTER TABLE pantry_items_new RENAME TO pantry_items;

      CREATE INDEX IF NOT EXISTS idx_pantry_items_expires  ON pantry_items(expires_on);
      CREATE INDEX IF NOT EXISTS idx_pantry_items_location ON pantry_items(location_id);
      CREATE INDEX IF NOT EXISTS idx_pantry_items_name     ON pantry_items(name);

      CREATE TRIGGER IF NOT EXISTS trg_pantry_items_updated_at
        AFTER UPDATE ON pantry_items FOR EACH ROW
        BEGIN UPDATE pantry_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
    `,
  },
  {
    version: 110,
    description: 'Google Calendar: force one full resync so series arrive as masters (#593)',
    up: `




      --





      --




      UPDATE google_calendar_selection SET sync_token = NULL;
    `,
  },
  {
    version: 111,
    description: 'meal recurrence: optional end date (#619)',
    up: `




      ALTER TABLE meal_recurrence_templates ADD COLUMN end_date TEXT;
    `,
  },
  {
    version: 112,
    description: 'budget entries: receipt/document attachments (#583)',
    up: `


      -- (Kassenbon + Rechnung + Garantie). Spiegelt bewusst expense_attachments,

      --


      --




      CREATE TABLE IF NOT EXISTS budget_entry_attachments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id    INTEGER NOT NULL REFERENCES budget_entries(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES family_documents(id) ON DELETE CASCADE,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(entry_id, document_id)
      );

      CREATE INDEX IF NOT EXISTS idx_budget_entry_attachments_entry
        ON budget_entry_attachments(entry_id);
      CREATE INDEX IF NOT EXISTS idx_budget_entry_attachments_document
        ON budget_entry_attachments(document_id);
    `,
  },
  {
    version: 113,
    description: 'CalDAV VTODO: push local changes and deletions back to the server (#617)',
    up: `




      --
      --   Weg zum Objekt  → external_object_url
      --   Absicht merken  → outbound_dirty

      --



      ALTER TABLE tasks ADD COLUMN external_object_url TEXT;
      ALTER TABLE tasks ADD COLUMN outbound_dirty      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN outbound_attempts   INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE shopping_items ADD COLUMN external_object_url TEXT;
      ALTER TABLE shopping_items ADD COLUMN outbound_dirty      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE shopping_items ADD COLUMN outbound_attempts   INTEGER NOT NULL DEFAULT 0;






      -- geteilt (calendar-outbound.js: outboundFailureAction).
      --


      CREATE TABLE IF NOT EXISTS caldav_todo_pending_deletions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES caldav_accounts(id) ON DELETE CASCADE,
        module     TEXT    NOT NULL CHECK(module IN ('tasks', 'shopping')),
        uid        TEXT    NOT NULL,
        object_url TEXT,
        attempts   INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(account_id, module, uid)
      );

      CREATE INDEX IF NOT EXISTS idx_caldav_todo_deletions_account
        ON caldav_todo_pending_deletions(account_id);
    `,
  },
  {
    version: 114,
    description: 'Tasks: repair the category default left behind by v83 (#586)',



    // (task_assignments, task_documents, reward_ledger, Unteraufgaben) per

    foreignKeysOff: true,
    up: `








      CREATE TABLE tasks_new (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        title               TEXT    NOT NULL,
        description         TEXT,
        category            TEXT    NOT NULL DEFAULT 'misc',
        priority            TEXT    NOT NULL DEFAULT 'none'
                                    CHECK(priority IN ('none', 'low', 'medium', 'high', 'urgent')),
        status              TEXT    NOT NULL DEFAULT 'open'
                                    CHECK(status IN ('open', 'in_progress', 'done', 'archived')),
        due_date            TEXT,
        due_time            TEXT,
        assigned_to         INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_recurring        INTEGER NOT NULL DEFAULT 0,
        recurrence_rule     TEXT,
        parent_task_id      INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        start_date          TEXT,
        external_uid        TEXT,
        external_source     TEXT    NOT NULL DEFAULT 'local',
        external_account_id INTEGER,
        points              INTEGER NOT NULL DEFAULT 0,
        visibility          TEXT    NOT NULL DEFAULT 'all',
        external_object_url TEXT,
        outbound_dirty      INTEGER NOT NULL DEFAULT 0,
        outbound_attempts   INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO tasks_new (
        id, title, description, category, priority, status, due_date, due_time,
        assigned_to, created_by, is_recurring, recurrence_rule, parent_task_id,
        created_at, updated_at, start_date, external_uid, external_source,
        external_account_id, points, visibility, external_object_url,
        outbound_dirty, outbound_attempts
      )
      SELECT
        id, title, description, category, priority, status, due_date, due_time,
        assigned_to, created_by, is_recurring, recurrence_rule, parent_task_id,
        created_at, updated_at, start_date, external_uid, external_source,
        external_account_id, points, visibility, external_object_url,
        outbound_dirty, outbound_attempts
      FROM tasks;







      -- fremden neuen Aufgabe zu.
      CREATE TEMP TABLE _tasks_seq AS
        SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'tasks'), 0) AS seq;

      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;




      UPDATE sqlite_sequence
         SET seq = (SELECT seq FROM _tasks_seq)
       WHERE name = 'tasks' AND seq < (SELECT seq FROM _tasks_seq);

      DROP TABLE _tasks_seq;



      UPDATE tasks SET category = 'misc'
      WHERE category NOT IN (SELECT key FROM task_categories);

      CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned   ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent     ON tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON tasks(start_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_external
        ON tasks(external_source, external_account_id, external_uid);



      DROP TRIGGER IF EXISTS trg_search_tasks_ai;
      DROP TRIGGER IF EXISTS trg_search_tasks_au;
      DROP TRIGGER IF EXISTS trg_search_tasks_ad;

      CREATE TRIGGER trg_search_tasks_ai AFTER INSERT ON tasks BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('task', NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.description, ''));
      END;

      CREATE TRIGGER trg_search_tasks_au AFTER UPDATE ON tasks BEGIN
        DELETE FROM search_index WHERE entity = 'task' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('task', NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.description, ''));
      END;

      CREATE TRIGGER trg_search_tasks_ad AFTER DELETE ON tasks BEGIN
        DELETE FROM search_index WHERE entity = 'task' AND entity_id = OLD.id;
      END;
    `,
  },
  {
    version: 115,
    description: 'Tasks: free-form tags, mirrored from VTODO CATEGORIES (#586)',
    up: `





      --


      -- jedem Kategorie-Dropdown auftauchen.





      -- Schreibweisen tragen kann.
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag     TEXT    NOT NULL,
        tag_key TEXT    NOT NULL,
        PRIMARY KEY (task_id, tag_key)
      );


      CREATE INDEX IF NOT EXISTS idx_task_tags_key ON task_tags(tag_key);
    `,
  },
  {
    version: 116,
    description: 'Shopping items: tags mirrored from VTODO CATEGORIES (#586)',
    up: `



      --




      CREATE TABLE IF NOT EXISTS shopping_item_tags (
        item_id INTEGER NOT NULL REFERENCES shopping_items(id) ON DELETE CASCADE,
        tag     TEXT    NOT NULL,
        tag_key TEXT    NOT NULL,
        PRIMARY KEY (item_id, tag_key)
      );

      CREATE INDEX IF NOT EXISTS idx_shopping_item_tags_key ON shopping_item_tags(tag_key);
    `,
  },
  {
    version: 117,
    description: 'Search index: tags belong to the searchable text (#586)',
    up: `



      --




      --





      -- folgerichtig nichts ein.

      DROP TRIGGER IF EXISTS trg_search_tasks_ai;
      DROP TRIGGER IF EXISTS trg_search_tasks_au;
      DROP TRIGGER IF EXISTS trg_search_tasks_ad;
      DROP TRIGGER IF EXISTS trg_search_items_ai;
      DROP TRIGGER IF EXISTS trg_search_items_au;
      DROP TRIGGER IF EXISTS trg_search_items_ad;

      CREATE TRIGGER trg_search_tasks_ai AFTER INSERT ON tasks BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'task', t.id, COALESCE(t.title, ''),
               TRIM(COALESCE(t.description, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM task_tags WHERE task_id = t.id), ''))
        FROM tasks t WHERE t.id = NEW.id;
      END;

      CREATE TRIGGER trg_search_tasks_au AFTER UPDATE ON tasks BEGIN
        DELETE FROM search_index WHERE entity = 'task' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'task', t.id, COALESCE(t.title, ''),
               TRIM(COALESCE(t.description, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM task_tags WHERE task_id = t.id), ''))
        FROM tasks t WHERE t.id = NEW.id;
      END;

      CREATE TRIGGER trg_search_tasks_ad AFTER DELETE ON tasks BEGIN
        DELETE FROM search_index WHERE entity = 'task' AND entity_id = OLD.id;
      END;

      CREATE TRIGGER trg_search_task_tags_ai AFTER INSERT ON task_tags BEGIN
        DELETE FROM search_index WHERE entity = 'task' AND entity_id = NEW.task_id;
        INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'task', t.id, COALESCE(t.title, ''),
               TRIM(COALESCE(t.description, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM task_tags WHERE task_id = t.id), ''))
        FROM tasks t WHERE t.id = NEW.task_id;
      END;

      CREATE TRIGGER trg_search_task_tags_ad AFTER DELETE ON task_tags BEGIN
        DELETE FROM search_index WHERE entity = 'task' AND entity_id = OLD.task_id;
        INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'task', t.id, COALESCE(t.title, ''),
               TRIM(COALESCE(t.description, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM task_tags WHERE task_id = t.id), ''))
        FROM tasks t WHERE t.id = OLD.task_id;
      END;

      CREATE TRIGGER trg_search_items_ai AFTER INSERT ON shopping_items BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'item', i.id, COALESCE(i.name, ''),
               TRIM(COALESCE(i.notes, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM shopping_item_tags WHERE item_id = i.id), ''))
        FROM shopping_items i WHERE i.id = NEW.id;
      END;

      CREATE TRIGGER trg_search_items_au AFTER UPDATE ON shopping_items BEGIN
        DELETE FROM search_index WHERE entity = 'item' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'item', i.id, COALESCE(i.name, ''),
               TRIM(COALESCE(i.notes, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM shopping_item_tags WHERE item_id = i.id), ''))
        FROM shopping_items i WHERE i.id = NEW.id;
      END;

      CREATE TRIGGER trg_search_items_ad AFTER DELETE ON shopping_items BEGIN
        DELETE FROM search_index WHERE entity = 'item' AND entity_id = OLD.id;
      END;

      CREATE TRIGGER trg_search_item_tags_ai AFTER INSERT ON shopping_item_tags BEGIN
        DELETE FROM search_index WHERE entity = 'item' AND entity_id = NEW.item_id;
        INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'item', i.id, COALESCE(i.name, ''),
               TRIM(COALESCE(i.notes, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM shopping_item_tags WHERE item_id = i.id), ''))
        FROM shopping_items i WHERE i.id = NEW.item_id;
      END;

      CREATE TRIGGER trg_search_item_tags_ad AFTER DELETE ON shopping_item_tags BEGIN
        DELETE FROM search_index WHERE entity = 'item' AND entity_id = OLD.item_id;
        INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'item', i.id, COALESCE(i.name, ''),
               TRIM(COALESCE(i.notes, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM shopping_item_tags WHERE item_id = i.id), ''))
        FROM shopping_items i WHERE i.id = OLD.item_id;
      END;



      DELETE FROM search_index WHERE entity IN ('task', 'item');
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'task', id, COALESCE(title, ''),
               TRIM(COALESCE(description, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM task_tags WHERE task_id = tasks.id), ''))
        FROM tasks;
      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'item', id, COALESCE(name, ''),
               TRIM(COALESCE(notes, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM shopping_item_tags WHERE item_id = shopping_items.id), ''))
        FROM shopping_items;
    `,
  },
  {
    version: 118,
    description: 'Mealie integration: mealie_accounts table + recipe mirror columns',
    up: `
      CREATE TABLE IF NOT EXISTS mealie_accounts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        base_url    TEXT    NOT NULL,
        api_token   TEXT    NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        last_sync   TEXT,
        last_error  TEXT,


        -- gespiegelt ankommen.
        UNIQUE(base_url)
      );

      CREATE TRIGGER IF NOT EXISTS trg_mealie_accounts_updated_at
        AFTER UPDATE ON mealie_accounts FOR EACH ROW
        BEGIN UPDATE mealie_accounts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      -- mealie_account_id NULL = eigenes Rezept; gesetzt = Spiegel dieses Kontos.
      ALTER TABLE recipes ADD COLUMN mealie_account_id INTEGER
        REFERENCES mealie_accounts(id) ON DELETE CASCADE;

      ALTER TABLE recipes ADD COLUMN mealie_recipe_id TEXT;

      ALTER TABLE recipes ADD COLUMN mealie_updated_at TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_mealie_unique
        ON recipes(mealie_account_id, mealie_recipe_id) WHERE mealie_account_id IS NOT NULL;
    `,
  },
  {
    version: 119,
    description: 'Mealie integration: separate public link URL from the server-reachable sync URL',
    up: `



      ALTER TABLE mealie_accounts ADD COLUMN external_url TEXT;
    `,
  },
  {
    version: 120,
    description: 'Mealie integration: store recipe slug and image flag for link rebuild and thumbnails',
    up: `



      ALTER TABLE recipes ADD COLUMN mealie_slug TEXT;
      ALTER TABLE recipes ADD COLUMN mealie_has_image INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 121,
    description: 'Invite links: admins invite members instead of setting their password',
    up: `




      CREATE TABLE IF NOT EXISTS invites (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash       TEXT    NOT NULL,
        email            TEXT,
        username         TEXT,
        display_name     TEXT,
        role             TEXT    NOT NULL DEFAULT 'member'
                                 CHECK(role IN ('admin', 'member')),


        family_role      TEXT    NOT NULL DEFAULT 'other',
        created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at       INTEGER NOT NULL,
        accepted_at      TEXT,
        accepted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        revoked_at       TEXT,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_hash ON invites(token_hash);
      CREATE INDEX IF NOT EXISTS idx_invites_open ON invites(expires_at)
        WHERE accepted_at IS NULL AND revoked_at IS NULL;
    `,
  },
  {
    version: 122,
    description: 'Tasks: link a recurring follow-up instance to the completion that created it (#650)',
    up: `




      -- tragen, das bedeutet "Unteraufgabe".
      ALTER TABLE tasks ADD COLUMN recurrence_origin_id INTEGER
        REFERENCES tasks(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_origin
        ON tasks(recurrence_origin_id) WHERE recurrence_origin_id IS NOT NULL;
    `,
  },
  {
    version: 123,
    description: 'CalDAV: detach mirrored tasks and shopping items from deleted accounts (#617)',
    up: `





      --





      -- ohnehin unerreichbar ist.
      --





      --




      UPDATE tasks
         SET external_source     = 'local',
             external_uid        = NULL,
             external_account_id = NULL,
             external_object_url = NULL,
             outbound_dirty      = 0,
             outbound_attempts   = 0
       WHERE external_account_id IS NOT NULL
         AND external_account_id NOT IN (SELECT id FROM caldav_accounts);

      UPDATE shopping_items
         SET external_source     = 'local',
             external_uid        = NULL,
             external_account_id = NULL,
             external_object_url = NULL,
             outbound_dirty      = 0,
             outbound_attempts   = 0
       WHERE external_account_id IS NOT NULL
         AND external_account_id NOT IN (SELECT id FROM caldav_accounts);
    `,
  },
  {
    version: 124,
    description: 'Split guests stay confined when their group is deleted (group_id ON DELETE SET NULL)',
    up: `
      -- Rechteausweitung: split_expense_guest_users traegt zwei Aussagen in







      -- routes/split-expenses.js), der Weg dorthin stand also jedem
      -- Gruppen-Owner offen.
      --



      --

      -- Keine Tabelle referenziert split_expense_guest_users, das DROP zieht

      CREATE TABLE split_expense_guest_users_new (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        group_id   INTEGER REFERENCES expense_groups(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO split_expense_guest_users_new (user_id, group_id, created_by, created_at)
        SELECT user_id, group_id, created_by, created_at FROM split_expense_guest_users;

      DROP TABLE split_expense_guest_users;
      ALTER TABLE split_expense_guest_users_new RENAME TO split_expense_guest_users;


      CREATE INDEX IF NOT EXISTS idx_split_guest_group ON split_expense_guest_users(group_id);
    `,
  },
  {
    version: 125,
    description: 'CalDAV: remember that a reminder-list discovery ran, even when it found nothing (#617)',
    up: `





      --

      -- gesetzt heisst "gesucht, Ergebnis gilt". Bestandskonten starten auf NULL
      -- und suchen damit genau einmal.
      ALTER TABLE caldav_accounts ADD COLUMN reminders_discovered_at TEXT;
    `,
  },
  {
    version: 126,
    description: 'Budget loans: lending direction (lent vs. borrowed) and an optional account for the installments (#638)',
    up: `




      --


      -- Default 'lent', damit Bestandsdaten ihr heutiges Verhalten behalten; wer


      ALTER TABLE budget_loans ADD COLUMN direction TEXT NOT NULL DEFAULT 'lent';



      -- neue Raten vererbt (rueckwirkend umbuchen wuerde historische Kontosalden

      ALTER TABLE budget_loans ADD COLUMN account_id INTEGER REFERENCES budget_accounts(id) ON DELETE SET NULL;
    `,
  },
  {
    version: 127,
    description: 'Tasks: repeat from the completion day instead of the due date (#658)',
    up: `
      -- Bis hierher rechnete die Serie ausschliesslich vom Faelligkeitsdatum:

      -- wieder am Samstag faellig - also fuenf Tage spaeter, nicht sieben. Fuer



      --

      -- Bestandsserien behalten ihre faelligkeitsverankerte Rechnung.
      ALTER TABLE tasks ADD COLUMN recurrence_from_completion INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 128,
    description: 'Budget: recurrence as unit + count, weekly included, skips keyed by day (#636)',
    up: `



      -- Einheit + Anzahl.
      ALTER TABLE budget_entries ADD COLUMN recurrence_interval_count INTEGER NOT NULL DEFAULT 1;


      -- Schreibweisen fuer denselben Rhythmus haetten sonst dauerhaft
      -- nebeneinander gestanden, und jede Auswertung muesste beide kennen.
      -- Verlustfrei: derselbe Abstand, dieselbe Glaettung.
      UPDATE budget_entries
         SET recurrence_interval = 'monthly', recurrence_interval_count = 6
       WHERE recurrence_interval = 'half_year';






      CREATE TABLE budget_recurrence_skipped_new (
        parent_id INTEGER NOT NULL REFERENCES budget_entries(id) ON DELETE CASCADE,
        date      TEXT    NOT NULL,
        PRIMARY KEY (parent_id, date)
      );



      INSERT OR IGNORE INTO budget_recurrence_skipped_new (parent_id, date)
      SELECT s.parent_id,
             s.month || '-' || substr('0' || MIN(
               CAST(strftime('%d', p.date) AS INTEGER),
               CAST(strftime('%d', date(s.month || '-01', '+1 month', '-1 day')) AS INTEGER)
             ), -2)
        FROM budget_recurrence_skipped s
        JOIN budget_entries p ON p.id = s.parent_id;

      DROP TABLE budget_recurrence_skipped;
      ALTER TABLE budget_recurrence_skipped_new RENAME TO budget_recurrence_skipped;
    `,
  },
  {
    version: 129,
    description: 'Budget: recurring series can book only after confirmation (#637)',
    up: `

      -- Serie kann deshalb verlangen, dass jede erzeugte Buchung erst bestaetigt

      ALTER TABLE budget_entries ADD COLUMN recurrence_confirm INTEGER NOT NULL DEFAULT 0;



      -- Wunsch ausgeloest hat, entstuende sonst weiter.
      --


      -- Summen, und jeder Haushalt saehe ueber Nacht andere Zahlen.
      ALTER TABLE budget_entries ADD COLUMN is_pending INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_budget_pending
        ON budget_entries(is_pending) WHERE is_pending = 1;
    `,
  },
  {
    version: 130,
    description: 'health: caregivers may record for a dependent member (#584)',
    up: `



      -- konnte jede Person ausschliesslich fuer sich selbst eintragen (#584).
      --




      -- Update stillschweigend Mitleser fuer die privaten Gesundheitsdaten jeder



      --




      CREATE TABLE IF NOT EXISTS health_care_grants (
        subject_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        caregiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (subject_id, caregiver_id),


        CHECK (subject_id <> caregiver_id)
      );



      CREATE INDEX IF NOT EXISTS idx_health_care_grants_caregiver
        ON health_care_grants(caregiver_id);
    `,
  },
  {
    version: 131,
    description: 'Budget: issuing bank and credit limit on credit-card accounts (#541)',
    up: `



      -- welchen Zeitraum ein solcher Tag begrenzt.
      ALTER TABLE budget_accounts ADD COLUMN credit_bank TEXT;
      ALTER TABLE budget_accounts ADD COLUMN credit_limit REAL;
    `,
  },
  {
    version: 132,
    description: 'Tasks: archive as its own axis instead of a status value (#688)',
    up: `




      ALTER TABLE tasks ADD COLUMN archived_at TEXT;








      UPDATE tasks
         SET archived_at = COALESCE(updated_at, created_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
             status      = 'done'
       WHERE status = 'archived';

      CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(archived_at);
    `,
  },
  {
    version: 133,
    description: 'Shopping: manual item order within a category (#678)',
    up: `





      ALTER TABLE shopping_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

      -- Bestand durchnummerieren, damit die heute sichtbare Reihenfolge exakt

      -- eingeordnet" dient.
      UPDATE shopping_items SET sort_order = (
        SELECT COUNT(*) + 1 FROM shopping_items AS prev
         WHERE prev.list_id  = shopping_items.list_id
           AND prev.category = shopping_items.category
           AND (prev.created_at < shopping_items.created_at
                OR (prev.created_at = shopping_items.created_at AND prev.id < shopping_items.id))
      );






      CREATE TRIGGER IF NOT EXISTS trg_shopping_items_sort_order
        AFTER INSERT ON shopping_items FOR EACH ROW WHEN NEW.sort_order = 0
        BEGIN
          UPDATE shopping_items SET sort_order = COALESCE((
            SELECT MAX(sort_order) FROM shopping_items
             WHERE list_id = NEW.list_id AND category = NEW.category AND id != NEW.id
          ), 0) + 1 WHERE id = NEW.id;
        END;

      CREATE INDEX IF NOT EXISTS idx_shopping_items_sort
        ON shopping_items(list_id, category, sort_order);
    `,
  },
  {
    version: 134,
    description: 'Recipe provider mirrors: generalize Mealie-only schema for multiple providers (#530)',
    up: `
      -- mealie_accounts -> recipe_provider_accounts, mit Provider-Diskriminator.







      ALTER TABLE mealie_accounts ADD COLUMN provider TEXT NOT NULL DEFAULT 'mealie'
        CHECK(provider IN ('mealie', 'tandoor'));

      -- Echtes RENAME TO (kein CREATE+DROP): bei aktivem foreign_keys schreibt

      -- neuen Namen um - recipes.mealie_account_id's FK-Ziel wird dabei

      ALTER TABLE mealie_accounts RENAME TO recipe_provider_accounts;



      -- partiellen UNIQUE-Index um.
      ALTER TABLE recipes RENAME COLUMN mealie_account_id TO provider_account_id;
      ALTER TABLE recipes RENAME COLUMN mealie_recipe_id TO provider_recipe_id;
      ALTER TABLE recipes RENAME COLUMN mealie_updated_at TO provider_updated_at;
      -- provider_slug's Bedeutung ist ab jetzt adapterabhaengig: Mealie legt
      -- hier seinen eigenen Rezept-Slug ab (fuer /g/{groupSlug}/r/{slug}



      ALTER TABLE recipes RENAME COLUMN mealie_slug TO provider_slug;
      ALTER TABLE recipes RENAME COLUMN mealie_has_image TO provider_has_image;
    `,
  },
  {
    version: 135,
    description: 'API integration tokens may act as an explicitly selected family member',
    up: `
      -- The creator remains the administrator responsible for the credential;
      -- the subject is the family member whose permissions and ownership apply
      -- to requests made with it. Existing tokens keep their current behaviour.
      ALTER TABLE api_tokens
        ADD COLUMN subject_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      UPDATE api_tokens SET subject_user_id = created_by WHERE subject_user_id IS NULL;
      CREATE INDEX idx_api_tokens_subject_user_id ON api_tokens(subject_user_id);
    `,
  },
  {
    version: 136,
    description: 'Outbound target for locally created tasks (CalDAV reminder list, #695)',
    up: `
      -- Mirrors the shape calendar events have carried since the CalDAV sync was
      -- built (target_caldav_account_id + target_caldav_calendar_url): a locally
      -- created row names where it wants to go, and the sync run uploads it and
      -- turns it into a mirror. Without a target nothing changes - a task with
      -- NULL here stays local, which is every task that exists today.
      ALTER TABLE tasks ADD COLUMN target_caldav_account_id INTEGER;
      ALTER TABLE tasks ADD COLUMN target_caldav_list_url   TEXT;

      CREATE INDEX idx_tasks_target_caldav
        ON tasks(target_caldav_account_id)
        WHERE target_caldav_account_id IS NOT NULL;
    `,
  },
  {
    version: 137,
    description: 'Inventory: locations, categories, items (Stage 1 of the full design)',
    up: `



      -- Stufe das Umhaengen doch braucht.
      CREATE TABLE IF NOT EXISTS inventory_locations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        parent_id  INTEGER REFERENCES inventory_locations(id) ON DELETE SET NULL,
        icon       TEXT    NOT NULL DEFAULT 'package',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_locations_parent ON inventory_locations(parent_id);

      CREATE TRIGGER IF NOT EXISTS trg_inventory_locations_updated_at
        AFTER UPDATE ON inventory_locations FOR EACH ROW
        BEGIN UPDATE inventory_locations SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;


      -- dort) - unabhaengig vom (umbenennbaren) Anzeigenamen.
      CREATE TABLE IF NOT EXISTS inventory_categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        key        TEXT    NOT NULL UNIQUE,
        name       TEXT    NOT NULL,
        icon       TEXT    NOT NULL DEFAULT 'package',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO inventory_categories (key, name, icon, sort_order) VALUES
        ('electronics', 'Elektronik', 'cpu',      0),
        ('vehicles',    'Fahrzeuge',  'car',      1),
        ('household',   'Haushalt',   'home',     2),
        ('sports',      'Sport',      'dumbbell', 3),
        ('other',       'Sonstiges',  'package',  4);

      CREATE TABLE IF NOT EXISTS inventory_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        brand           TEXT,
        model           TEXT,
        serial_number   TEXT,
        -- Kein echter FK auf inventory_categories.key - siehe Plan (Global



        category        TEXT    NOT NULL DEFAULT 'other',
        location_id     INTEGER REFERENCES inventory_locations(id) ON DELETE SET NULL,
        purchase_date   TEXT,
        purchase_price  REAL    CHECK (purchase_price IS NULL OR purchase_price >= 0),
        currency        TEXT,
        vendor          TEXT,
        warranty_months INTEGER CHECK (warranty_months IS NULL OR (warranty_months >= 0 AND warranty_months <= 600)),
        condition       TEXT    NOT NULL DEFAULT 'good' CHECK (condition IN ('new','good','fair','poor')),
        status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','disposed','lost')),
        notes           TEXT,



        created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);
      CREATE INDEX IF NOT EXISTS idx_inventory_items_status   ON inventory_items(status);

      CREATE TRIGGER IF NOT EXISTS trg_inventory_items_updated_at
        AFTER UPDATE ON inventory_items FOR EACH ROW
        BEGIN UPDATE inventory_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
    `,
  },
  {
    version: 138,
    description: 'Inventory: link items to documents from the Documents module (Stage 2)',
    up: `
      -- Spiegelt budget_entry_attachments 1:1 (server/db.js, Migration 112):
      -- gleiche Spaltenform, gleiche CASCADE-Begruendung. Das Dokument selbst


      CREATE TABLE IF NOT EXISTS inventory_item_documents (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES family_documents(id) ON DELETE CASCADE,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(item_id, document_id)
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_item_documents_item
        ON inventory_item_documents(item_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_item_documents_document
        ON inventory_item_documents(document_id);
    `,
  },
  {
    version: 139,
    description: 'Inventory: link items to budget entries with a role (Stage 3)',
    up: `




      --

      -- Wert hinein), damit Stufe 5 kein ALTER TABLE mehr braucht - "volles
      -- Schema jetzt, gestufte Umsetzung" (Design-Doc §1).
      CREATE TABLE IF NOT EXISTS inventory_item_entries (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id      INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        entry_id     INTEGER NOT NULL REFERENCES budget_entries(id) ON DELETE CASCADE,
        role         TEXT    NOT NULL DEFAULT 'purchase'
                     CHECK (role IN ('purchase','refund','instalment','maintenance','accessory')),
        amount_share REAL    CHECK (amount_share IS NULL OR amount_share >= 0),
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(item_id, entry_id, role)
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_item_entries_item ON inventory_item_entries(item_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_item_entries_entry ON inventory_item_entries(entry_id);
    `,
  },
  {
    version: 140,
    description: 'Allow inventory_item entities in the existing reminder center (Stage 4)',
    foreignKeysOff: true,
    up: `


      -- aktiver FK-Durchsetzung wuerde DROP TABLE reminders die gekoppelten
      -- Zustellprotokolle (notification_deliveries.reminder_id ... ON DELETE
      -- CASCADE) auf jeder bestehenden Installation mitloeschen.
      CREATE TABLE reminders_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL CHECK(entity_type IN ('task', 'event', 'subscription', 'inventory_item')),
        entity_id   INTEGER NOT NULL,
        remind_at   TEXT    NOT NULL,
        dismissed   INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        pushed_at   TEXT
      );
      INSERT INTO reminders_new (id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at)
        SELECT id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at FROM reminders;
      DROP TABLE reminders;
      ALTER TABLE reminders_new RENAME TO reminders;
      CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);
      CREATE INDEX idx_reminders_remind ON reminders(remind_at);
      CREATE INDEX idx_reminders_user ON reminders(created_by);
    `,
  },
  {
    version: 141,
    description: 'Inventory: custom tracked dates per item, widen reminders for inventory_tracked_date',
    foreignKeysOff: true,
    up: `

      CREATE TABLE IF NOT EXISTS inventory_item_dates (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id              INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        label                TEXT    NOT NULL,
        date                 TEXT    NOT NULL,
        reminder_offset_days INTEGER NOT NULL DEFAULT 30 CHECK (reminder_offset_days BETWEEN 0 AND 365),
        created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_item_dates_item ON inventory_item_dates(item_id);

      CREATE TRIGGER IF NOT EXISTS trg_inventory_item_dates_updated_at
        AFTER UPDATE ON inventory_item_dates FOR EACH ROW
        BEGIN UPDATE inventory_item_dates SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;



      -- erstellen. foreignKeysOff bleibt Pflicht - gleicher Grund wie v137
      -- (notification_deliveries.reminder_id ... ON DELETE CASCADE wuerde sonst
      -- beim DROP TABLE mitgeloescht).
      CREATE TABLE reminders_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL CHECK(entity_type IN ('task', 'event', 'subscription', 'inventory_item', 'inventory_tracked_date')),
        entity_id   INTEGER NOT NULL,
        remind_at   TEXT    NOT NULL,
        dismissed   INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        pushed_at   TEXT
      );
      INSERT INTO reminders_new (id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at)
        SELECT id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at FROM reminders;
      DROP TABLE reminders;
      ALTER TABLE reminders_new RENAME TO reminders;
      CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);
      CREATE INDEX idx_reminders_remind ON reminders(remind_at);
      CREATE INDEX idx_reminders_user ON reminders(created_by);
    `,
  },
  {
    version: 142,
    description: 'Inventory: add optional photo per item',
    up: `
      -- Ein Foto je Gegenstand, kein Galerie-Bedarf (Mockup-Vergleich, Design-
      -- Doc §2) - gleiches Speichermuster wie birthdays.photo_data: Data-URL,
      -- serverseitig validiert (server/routes/inventory/items.js), keine
      -- eigene Tabelle noetig fuer ein einzelnes optionales Feld.
      ALTER TABLE inventory_items ADD COLUMN photo_data TEXT;
    `,
  },
  {
    version: 143,
    description: 'Inventory: localize the five seeded categories via label_key (matches Task Categories, migration 83)',
    up: `

      -- Seed-Kategorien (name = NULL -> lokalisiert), Custom-Kategorien tragen
      -- weiterhin name (label_key = NULL). name war seit Migration 136 NOT NULL

      -- ADD COLUMN, sonst schlaegt die folgende UPDATE...SET name = NULL fehl.

      -- bewusst kein echter FK, siehe Migration 136), foreignKeysOff also nicht noetig.
      CREATE TABLE inventory_categories_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        key        TEXT    NOT NULL UNIQUE,
        name       TEXT,
        label_key  TEXT,
        icon       TEXT    NOT NULL DEFAULT 'package',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      INSERT INTO inventory_categories_new (id, key, name, icon, sort_order, created_at)
        SELECT id, key, name, icon, sort_order, created_at FROM inventory_categories;
      DROP TABLE inventory_categories;
      ALTER TABLE inventory_categories_new RENAME TO inventory_categories;

      -- Nur unveraendert gebliebene Seed-Zeilen umstellen: WHERE name = '<Seed-Wert>'


      UPDATE inventory_categories SET label_key = 'inventory.categoryElectronics', name = NULL
        WHERE key = 'electronics' AND name = 'Elektronik';
      UPDATE inventory_categories SET label_key = 'inventory.categoryVehicles', name = NULL
        WHERE key = 'vehicles' AND name = 'Fahrzeuge';
      UPDATE inventory_categories SET label_key = 'inventory.categoryHousehold', name = NULL
        WHERE key = 'household' AND name = 'Haushalt';
      UPDATE inventory_categories SET label_key = 'inventory.categorySports', name = NULL
        WHERE key = 'sports' AND name = 'Sport';
      UPDATE inventory_categories SET label_key = 'inventory.categoryOther', name = NULL
        WHERE key = 'other' AND name = 'Sonstiges';
    `,
  },
  {
    version: 144,
    description: 'add per-user read-only inventory deadlines feed token',
    up: `





      ALTER TABLE users ADD COLUMN inventory_deadlines_feed_token TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_inventory_deadlines_feed_token
        ON users(inventory_deadlines_feed_token)
        WHERE inventory_deadlines_feed_token IS NOT NULL;



      -- verwaiste Zeile weiterzugelten.
      DELETE FROM sync_config WHERE key = 'inventory_deadlines_feed_token';
    `,
  },
  {
    version: 145,
    description: 'ship the Inventory module disabled by default (households opt in)',
    up(db) {






      //


      // Neuinstallation und Bestandshaushalt gleichermassen ab.
      const row = db.prepare("SELECT value FROM sync_config WHERE key = 'disabled_modules'").get();

      // Defensiv genau wie parseDisabledModules (server/routes/preferences.js):

      let disabled = [];
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value);
          if (Array.isArray(parsed)) disabled = parsed.filter((m) => typeof m === 'string');
        } catch { /* kaputter Wert wird ersetzt, nicht respektiert */ }
      }



      // wieder einschalten wuerde.
      if (disabled.includes('inventory')) return;
      disabled.push('inventory');

      db.prepare(`
        INSERT INTO sync_config (key, value) VALUES ('disabled_modules', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      `).run(JSON.stringify(disabled));
    },
  },
  {
    version: 146,
    description: 'rename the shared-expenses receipt folder to the canonical module name',
    up(db) {

      // liegen. Das Modul heisst `splitExpenses.title` ("Gemeinsame Ausgaben"),




      // Ordner, weil `ensureFolder` (server/routes/documents.js) den Ordner

      // alten.
      //





      const RENAMES = [
        ['النفقات المشتركة', 'المصاريف المشتركة'],   // ar
        ['Sdílené výdaje', 'Společné výdaje'],       // cs
        ['Geteilte Ausgaben', 'Gemeinsame Ausgaben'], // de
        ['Κοινές δαπάνες', 'Κοινά έξοδα'],           // el
        ['Közös kiadások', 'Megosztott költségek'],  // hu
        ['Pengeluaran bersama', 'Pengeluaran Bersama'], // id
        ['共同の支出', '共有費用'],                    // ja
        ['Despesas partilhadas', 'Despesas compartilhadas'], // pt
        ['Paylaşılan harcamalar', 'Paylaşılan giderler'],    // tr
        ['Chi tiêu chung', 'Chi phí chung'],         // vi
        ['共同支出', '共享支出'],                      // zh
      ];




      // hoechstens eine.



      //



      // "Pengeluaran bersama" und "Pengeluaran Bersama" nebeneinander, vom





      const findExact = db.prepare('SELECT id FROM family_document_folders WHERE name = ?');
      const findClash = db.prepare('SELECT id FROM family_document_folders WHERE name = ? COLLATE NOCASE AND id <> ?');
      const rename = db.prepare('UPDATE family_document_folders SET name = ? WHERE id = ?');

      for (const [from, to] of RENAMES) {
        const source = findExact.get(from);
        if (!source) continue;




        // an der Zeilenreihenfolge.
        if (findClash.get(to, source.id)) continue;

        rename.run(to, source.id);
      }
    },
  },
  {
    version: 147,
    description: 'repair reward icons and descriptions stored as the text null',
    up(db) {







      //


      db.prepare("UPDATE reward_catalog SET icon = NULL WHERE icon = 'null'").run();
      db.prepare("UPDATE reward_catalog SET description = NULL WHERE description = 'null'").run();





      db.prepare("UPDATE reward_redemptions SET reward_icon = NULL WHERE reward_icon = 'null'").run();
    },
  },
  {
    version: 148,
    description: 'PRN medications: minimum interval and default dose per dose (#700)',
    up: `




      --





      --




      ALTER TABLE medications ADD COLUMN min_interval_hours REAL;
      ALTER TABLE medications ADD COLUMN prn_dose_qty REAL;
    `,
  },
  {
    version: 149,
    description: 'comments on tasks (#734)',
    up: `



      --





      --


      CREATE TABLE IF NOT EXISTS task_comments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
        comment    TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT
      );


      CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, id);
    `,
  },
  {
    version: 150,
    description: 'countdown flag on events and tasks (#647)',
    up: `



      -- System:
      --

      --   (Urlaub, "Disney+ verlaengern"). Ein eigenes Objekt hiesse fuer ihn,
      --   dasselbe Datum zweimal zu pflegen.
      --






      --



      --






      -- Sync-Lauf.
      ALTER TABLE calendar_events ADD COLUMN countdown INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks           ADD COLUMN countdown INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 151,
    description: 'search index: drop duplicate shopping item rows and make their insert trigger idempotent',
    up: `
      -- JEDER NEU ANGELEGTE EINKAUFSARTIKEL STAND ZWEIMAL IM VOLLTEXT-INDEX.
      --


      -- war:






      --

      -- selbst, denn trg_search_items_au loescht ueber (entity, entity_id) und
      -- erwischt damit beide Zeilen. Abhaken genuegte. Doppelt waren also genau

      -- denen jemand sucht. runSearch deckelt bei fuenf Treffern je Art, also
      -- kamen von fuenf angelegten Artikeln zweieinhalb an.
      --






      -- _au-Trigger nebenan schon macht.
      DROP TRIGGER IF EXISTS trg_search_items_ai;
      CREATE TRIGGER trg_search_items_ai AFTER INSERT ON shopping_items BEGIN
        DELETE FROM search_index WHERE entity = 'item' AND entity_id = NEW.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'item', i.id, COALESCE(i.name, ''),
               TRIM(COALESCE(i.notes, '') || ' ' ||
                    COALESCE((SELECT group_concat(tag, ' ') FROM shopping_item_tags WHERE item_id = i.id), ''))
        FROM shopping_items i WHERE i.id = NEW.id;
      END;

      -- Bestandsdaten: die schon geschriebenen Dubletten wegraeumen.
      --





      --


      --




      DELETE FROM search_index WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM search_index GROUP BY entity, entity_id
      );
    `,
  },
  {
    version: 152,
    description: 'contact categories carry their own colour instead of a css name list',
    up: `



      -- SEED-Schluessel treffen: seit #357 legt der Haushalt eigene Kategorien



      --





      -- (\`var(--chart-series-2)\` als gespeicherter Wert).
      --


      ALTER TABLE contact_categories ADD COLUMN color TEXT;

      UPDATE contact_categories SET color = 'var(--color-success)'      WHERE key = 'doctor'    AND color IS NULL;
      UPDATE contact_categories SET color = 'var(--color-warning)'      WHERE key = 'school'    AND color IS NULL;
      UPDATE contact_categories SET color = 'var(--color-accent)'       WHERE key = 'authority' AND color IS NULL;
      UPDATE contact_categories SET color = 'var(--module-budget)'      WHERE key = 'insurance' AND color IS NULL;
      UPDATE contact_categories SET color = 'var(--module-meals)'       WHERE key = 'craftsman' AND color IS NULL;
      UPDATE contact_categories SET color = 'var(--color-danger)'       WHERE key = 'emergency' AND color IS NULL;
      UPDATE contact_categories SET color = 'var(--color-text-secondary)' WHERE key = 'misc'    AND color IS NULL;
    `,
  },
  {
    version: 153,
    description: 'idempotency keys for retry-safe POST requests on the public api',
    up: `
      -- RETRY-SICHERES ANLEGEN UEBER DIE OEFFENTLICHE API (#822).
      --







      --




      -- zurueckgespielte fremde Antwort. Deshalb UNIQUE ueber (user_id, key)

      --

      -- entscheidet ueber Wiedergabe oder Konflikt.
      --


      -- eindeutigen Index stoesst statt danebenzulaufen.
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        key           TEXT    NOT NULL,
        method        TEXT    NOT NULL,
        path          TEXT    NOT NULL,
        request_hash  TEXT    NOT NULL,
        status        INTEGER,
        response_body TEXT,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        completed_at  TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_keys_actor
        ON idempotency_keys(user_id, key);



      CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created
        ON idempotency_keys(created_at);
    `,
  },
  {
    version: 154,
    description: 'Outlook (Microsoft Graph) one-way push: accounts, calendar selection, event links, event target columns',
    up: `

      -- Microsoft Graph API. Neuer Provider "Outlook-Push": one-way
      -- Aashiyana -> Outlook fuer persoenliche Microsoft-Konten (outlook.com /
      -- M365 Family), Multi-Account wie caldav_accounts.

      -- Ein verbundenes Microsoft-Konto. OAuth-Tokens liegen pro Konto-Zeile,



      CREATE TABLE outlook_accounts (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        name                  TEXT NOT NULL,
        ms_user_id            TEXT,
        email                 TEXT,
        access_token          TEXT NOT NULL,
        refresh_token         TEXT NOT NULL,
        token_expiry          TEXT,
        needs_reauth          INTEGER NOT NULL DEFAULT 0,
        auto_sync_calendar_id TEXT,
        owner_user_id         INTEGER REFERENCES users(id),
        created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        last_sync             TEXT,
        last_error            TEXT
      );

      CREATE UNIQUE INDEX idx_outlook_accounts_ms_user
        ON outlook_accounts(ms_user_id) WHERE ms_user_id IS NOT NULL;


      -- waehlbar. Neue Kalender starten deaktiviert: der Connect-Flow fuehrt

      CREATE TABLE outlook_calendar_selection (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id     INTEGER NOT NULL REFERENCES outlook_accounts(id) ON DELETE CASCADE,
        calendar_id    TEXT NOT NULL,
        calendar_name  TEXT NOT NULL,
        calendar_color TEXT,
        can_edit       INTEGER NOT NULL DEFAULT 1,
        enabled        INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(account_id, calendar_id)
      );







      -- Event danach einfrieren; es bleibt dauerhaft 'local'.
      CREATE TABLE outlook_event_links (
        event_id            INTEGER NOT NULL,
        account_id          INTEGER NOT NULL REFERENCES outlook_accounts(id) ON DELETE CASCADE,
        outlook_calendar_id TEXT NOT NULL,
        outlook_event_id    TEXT NOT NULL,
        content_hash        TEXT,




        outlook_change_key  TEXT,
        last_pushed_at      TEXT,
        last_error          TEXT,
        PRIMARY KEY (event_id, account_id)
      );
      CREATE INDEX idx_outlook_links_account ON outlook_event_links(account_id);

      -- Explizites Push-Ziel am Event (Muster target_caldav_* /
      -- target_google_calendar_id); gewinnt gegen den Auto-Sync-Kalender.
      -- Keine external_source-CHECK-Erweiterung noetig (kein Handoff, s. o.).
      ALTER TABLE calendar_events ADD COLUMN target_outlook_account_id INTEGER;
      ALTER TABLE calendar_events ADD COLUMN target_outlook_calendar_id TEXT;
    `,
  },
  {
    version: 155,
    description: 'Tasks: locked flag - a locked task keeps its definition closed to everyone but its creator and admins (#830)',
    up: `
      -- AUFGABE SPERREN (#830).
      --




      --


      -- Termine, Wiederholung, Punkte, Sichtbarkeit, Tags, Dokumente, Loeschen)

      -- eigene Erinnerung, sich selbst zuweisen) offen bleibt.
      --


      -- Wert: dad/mom/parent sicher, grandparent je nach Haushalt, relative



      --
      -- Default 0: bestehende Aufgaben verhalten sich unveraendert.
      ALTER TABLE tasks ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 156,
    description: 'Budget: third visibility shared_amount - the amount counts towards balances while title, category and notes stay private (#659)',
    foreignKeysOff: true,
    up: `
      -- BETRAG ZAEHLT, ZWECK BLEIBT PRIVAT (#659).
      --




      -- dadurch aber schlicht falsch, weil ihr Konto real weniger enthaelt.
      --





      -- liegen.
      --
      -- BEWUSST KEINE HAUSHALTS-EINSTELLUNG. Ein Schalter waere billiger, aber




      --


      -- aktiver FK-Durchsetzung wuerde DROP TABLE budget_entries die gekoppelten
      -- Belege (budget_entry_attachments.entry_id), die Wiederholungs-Ausnahmen

      -- (inventory_item_entries.entry_id) auf jeder bestehenden Installation
      -- mitloeschen - alle drei haengen per ON DELETE CASCADE daran.
      CREATE TABLE budget_entries_new (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        title                     TEXT    NOT NULL,
        amount                    REAL    NOT NULL,
        category                  TEXT    NOT NULL DEFAULT 'Sonstiges',
        date                      TEXT    NOT NULL,
        is_recurring              INTEGER NOT NULL DEFAULT 0,
        recurrence_rule           TEXT,
        created_by                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at                TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at                TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        recurrence_parent_id      INTEGER REFERENCES budget_entries(id) ON DELETE SET NULL,
        subcategory               TEXT    NOT NULL DEFAULT '',
        recurrence_interval       TEXT    NOT NULL DEFAULT 'monthly',
        recurrence_virtual        INTEGER NOT NULL DEFAULT 0,
        recurrence_full_amount    REAL,
        account_id                INTEGER REFERENCES budget_accounts(id) ON DELETE SET NULL,
        owner_id                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        visibility                TEXT    NOT NULL DEFAULT 'shared'
                                          CHECK (visibility IN ('private', 'shared', 'shared_amount')),
        recurrence_interval_count INTEGER NOT NULL DEFAULT 1,
        recurrence_confirm        INTEGER NOT NULL DEFAULT 0,
        is_pending                INTEGER NOT NULL DEFAULT 0
      );


      -- reminders.pushed_at verloren, v62 musste es nachtragen.
      INSERT INTO budget_entries_new (
        id, title, amount, category, date, is_recurring, recurrence_rule,
        created_by, created_at, updated_at, recurrence_parent_id, subcategory,
        recurrence_interval, recurrence_virtual, recurrence_full_amount,
        account_id, owner_id, visibility, recurrence_interval_count,
        recurrence_confirm, is_pending
      )
      SELECT
        id, title, amount, category, date, is_recurring, recurrence_rule,
        created_by, created_at, updated_at, recurrence_parent_id, subcategory,
        recurrence_interval, recurrence_virtual, recurrence_full_amount,
        account_id, owner_id, visibility, recurrence_interval_count,
        recurrence_confirm, is_pending
      FROM budget_entries;

      DROP TABLE budget_entries;
      ALTER TABLE budget_entries_new RENAME TO budget_entries;

      CREATE INDEX idx_budget_date       ON budget_entries(date);
      CREATE INDEX idx_budget_created_by ON budget_entries(created_by);
      CREATE INDEX idx_budget_parent     ON budget_entries(recurrence_parent_id);
      CREATE INDEX idx_budget_account    ON budget_entries(account_id);
      CREATE INDEX idx_budget_owner      ON budget_entries(owner_id);
      CREATE INDEX idx_budget_pending    ON budget_entries(is_pending) WHERE is_pending = 1;

      CREATE TRIGGER trg_budget_entries_updated_at
        AFTER UPDATE ON budget_entries FOR EACH ROW
        BEGIN UPDATE budget_entries SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
    `,
  },
  {
    version: 157,
    description: 'Document folders: a module folder is found by a stable key instead of its translated name',
    up(db) {

      //




      // folgten drei Fehler derselben Sorte:
      //






      //      Sprachdurchgang stand dasselbe wieder an.

      //      Schoenheitsfehler.
      //


      // deshalb nie wieder noetig.
      db.exec('ALTER TABLE family_document_folders ADD COLUMN module_key TEXT');
      db.exec(`CREATE UNIQUE INDEX idx_family_document_folders_module_key
                 ON family_document_folders(module_key) WHERE module_key IS NOT NULL`);






      const FOLDER_NAMES = [
        ['budget', [
          "الإيصالات", // ar
          "Doklady", // cs
          "Belege", // de
          "Αποδείξεις", // el
          "Receipts", // en
          "Comprobantes", // es
          "رسیدها", // fa
          "Mga Resibo", // fil
          "Justificatifs", // fr
          "रसीदें", // hi
          "Bizonylatok", // hu
          "Bukti", // id
          "Ricevute", // it
          "領収書", // ja
          "영수증", // ko
          "Bonnen", // nl
          "Dowody", // pl
          "Comprovativos", // pt
          "Чеки", // ru, uk
          "Kvitton", // sv
          "Fişler", // tr
          "Chứng từ", // vi
          "凭证", // zh
        ]],
        ['tasks', [
          "المهام", // ar
          "Úkoly", // cs
          "Aufgaben", // de
          "Εργασίες", // el
          "Tasks", // en
          "Tareas", // es
          "کارها", // fa
          "Mga gawain", // fil
          "Tâches", // fr
          "कार्य", // hi
          "Feladatok", // hu
          "Tugas", // id
          "Attività", // it
          "タスク", // ja
          "할 일", // ko
          "Taken", // nl
          "Zadania", // pl
          "Tarefas", // pt
          "Задачи", // ru
          "Uppgifter", // sv
          "Görevler", // tr
          "Завдання", // uk
          "Công việc", // vi
          "任务", // zh
        ]],
        ['splitExpenses', [
          "المصاريف المشتركة", // ar
          "Společné výdaje", // cs
          "Gemeinsame Ausgaben", // de
          "Κοινά έξοδα", // el
          "Shared expenses", // en
          "Gastos compartidos", // es
          "هزینه‌های مشترک", // fa
          "Mga hinating gastos", // fil
          "Dépenses partagées", // fr
          "साझा खर्च", // hi
          "Megosztott költségek", // hu
          "Pengeluaran Bersama", // id
          "Spese condivise", // it
          "共有費用", // ja
          "공동 지출", // ko
          "Gedeelde uitgaven", // nl
          "Wspólne wydatki", // pl
          "Despesas compartilhadas", // pt
          "Общие расходы", // ru
          "Delade utgifter", // sv
          "Paylaşılan giderler", // tr
          "Спільні витрати", // uk
          "Chi phí chung", // vi
          "共享支出", // zh
        ]],
        ['inventory', [






          "المقتنيات",
          "Inventář",
          "Απογραφή",
          "Inventario",
          "اموال",
          "Inventaire",
          "इन्वेंटरी",
          "Leltár",
          "Inventaris",
          "Inventario",
          "持ち物",
          "소지품",
          "Inventaris",
          "Inwentarz",
          "Inventário",
          "Инвентарь",
          "Inventarier",
          "Envanter",
          "Інвентар",
          "Tài sản",
          "物品",
          "Inventory", // ar, cs, el, en, es, fa, fil, fr, hi, hu, id, it, ja, ko, nl, pl, pt, ru, sv, tr, uk, vi, zh
          "Imbentaryo", // fil
          "Inventar", // de
        ]],
        ['housekeeping', [

          // das Modul, dessen Belege er traegt. Seit diesem Release traegt er



          //





          // zusaetzliche Name.
          "التدبير المنزلي",
          "Domácí práce",
          "Haushaltshilfe",
          "Νοικοκυριό",
          "خدمتکار خانه",
          "गृहकार्य",
          "Asisten Rumah Tangga",
          "家事",
          "가사 도우미",
          "Ev işleri",
          "家务",
          "التنظيف المنزلي", // ar
          "Úklid domácnosti", // cs
          "Hausreinigung", // de
          "Καθαριότητα", // el
          "HouseKeeping", // en
          "Limpieza", // es
          "نظافت خانه", // fa
          "Gawaing-bahay", // fil
          "Ménage", // fr
          "हाउसकीपिंग", // hi
          "HázTartás", // hu
          "Háztartás",

                       // Schreibweisen fuer zwei verschiedene Namen
          "Pembersihan rumah", // id
          "Pulizie", // it
          "ハウスキーピング", // ja
          "집 청소", // ko
          "Huishouden", // nl
          "Sprzątanie", // pl
          "Faxina", // pt
          "Уборка", // ru
          "Städning", // sv
          "Ev temizliği", // tr
          "Прибирання", // uk
          "Dọn dẹp", // vi
          "家政清洁", // zh
        ]],
        ['calendarItems', [
          "عناصر التقويم", // ar
          "Položky kalendáře", // cs
          "Kalendereinträge", // de
          "Στοιχεία ημερολογίου", // el
          "Calendar items", // en
          "Elementos del calendario", // es
          "مدخل‌های تقویم", // fa
          "Mga item sa kalendaryo", // fil
          "Éléments du calendrier", // fr
          "कैलेंडर आइटम", // hi
          "Naptár elemei", // hu
          "Entri kalender", // id
          "Elementi del calendario", // it
          "カレンダー項目", // ja
          "캘린더 항목", // ko
          "Kalenderitems", // nl
          "Wpisy kalendarza", // pl
          "Itens do calendário", // pt
          "Элементы календаря", // ru
          "Kalenderobjekt", // sv
          "Takvim öğeleri", // tr
          "Елементи календаря", // uk
          "Mục trên lịch", // vi
          "日历项目", // zh
        ]],
      ];

      const findAll = db.prepare(`SELECT id FROM family_document_folders
                                   WHERE name = ? COLLATE NOCASE ORDER BY id`);
      const claim = db.prepare('UPDATE family_document_folders SET module_key = ? WHERE id = ?');

      for (const [key, names] of FOLDER_NAMES) {






        //
        // Weitere Ordner desselben Zwecks bleiben bewusst stehen: sie



        let oldest = null;
        for (const name of names) {
          for (const row of findAll.all(name)) {
            if (oldest === null || row.id < oldest) oldest = row.id;
            break;
          }
        }
        if (oldest !== null) claim.run(key, oldest);
      }
    },
  },
  {
    version: 158,
    description: 'Google calendar: drop the sync token where the first user was deleted, so the missed events come back',
    up(db) {

      //








      //



      //



      // Kontingent bei Googles API.
      const hasFirstUser = db.prepare('SELECT 1 FROM users WHERE id = 1').get();
      if (hasFirstUser) return;

      db.prepare(`UPDATE google_calendar_selection
                     SET sync_token = NULL, last_sync = NULL
                   WHERE sync_token IS NOT NULL`).run();
    },
  },
  {
    version: 159,
    description: 'Two-factor authentication: TOTP secrets and recovery codes per user (#672)',
    up: `

      -- Schluessel und keine eigene id noetig.
      --






      --
      -- last_step haelt den zuletzt eingeloesten Zeitschritt fest. RFC 6238


      CREATE TABLE IF NOT EXISTS user_totp (
        user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret       TEXT    NOT NULL,
        confirmed_at TEXT,
        last_step    INTEGER,
        created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );




      CREATE TABLE IF NOT EXISTS user_recovery_codes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash  TEXT    NOT NULL,
        used_at    TEXT,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON user_recovery_codes(user_id);
    `,
  },
  {
    version: 160,
    description: 'Quick links: household links as a tile row on the overview (#469)',
    up: `




      -- geschlossen worden, weil vier Melder dasselbe wollten: Name, Adresse,

      --


      CREATE TABLE IF NOT EXISTS quick_links (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        url         TEXT    NOT NULL,







        -- Kachelbild waere Betriebsaufwand ohne Gegenwert.
        icon_data   TEXT,




        -- unterscheiden nichts, "J" auf Violett schon.
        color       TEXT,





        visibility  TEXT    NOT NULL DEFAULT 'all',

        created_by  INTEGER REFERENCES users(id),



        position    INTEGER NOT NULL DEFAULT 0,

        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );



      CREATE INDEX IF NOT EXISTS idx_quick_links_position ON quick_links(position);
    `,
  },
  {
    version: 161,
    description: 'Task completions: erledigen wird ein Ereignis, nicht nur ein Zustand (#791)',
    up: `





      --
      -- Zwei Spalten (completed_at, completed_by) am Datensatz waeren die





      --






      -- haengt dasselbe visibilityWhere an wie jede andere Aufgabenliste.
      --




      -- sehen" mitbringen.
      CREATE TABLE IF NOT EXISTS task_completions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,






        series_id    INTEGER NOT NULL,







        user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,

        completed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );





      -- zugleich das Idempotenz-Netz, falls derselbe Statuswechsel zweimal
      -- ankommt.
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_completion ON task_completions(task_id);


      -- Serie, ebenfalls nach Zeit. Zwei Lesepfade, zwei Indizes.
      CREATE INDEX IF NOT EXISTS idx_task_completions_at     ON task_completions(completed_at);
      CREATE INDEX IF NOT EXISTS idx_task_completions_series ON task_completions(series_id, completed_at);
    `,
  },
  {
    version: 162,
    description: 'Pantry: widen reminders for pantry_item so a best-before date can notify (#811)',
    foreignKeysOff: true,
    up: `

      -- entity_type ist gewachsen: ('task','event') -> +'subscription' (v137)
      -- -> +'inventory_item','inventory_tracked_date' (v141). Ein Vorratsartikel


      --
      -- KEINE eigene Tabelle und KEIN Vorlauf je Artikel: inventory_item_dates




      -- kennt: EXPIRY_SOON_DAYS aus public/utils/pantry-status.js, dieselbe

      -- diesen Zustandswechsel an; zwei Zahlen dafuer waeren zwei Wahrheiten.
      --

      -- notification_deliveries.reminder_id haengt mit ON DELETE CASCADE an

      CREATE TABLE reminders_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL CHECK(entity_type IN ('task', 'event', 'subscription', 'inventory_item', 'inventory_tracked_date', 'pantry_item')),
        entity_id   INTEGER NOT NULL,
        remind_at   TEXT    NOT NULL,
        dismissed   INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        pushed_at   TEXT
      );
      INSERT INTO reminders_new (id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at)
        SELECT id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at FROM reminders;
      DROP TABLE reminders;
      ALTER TABLE reminders_new RENAME TO reminders;
      CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);
      CREATE INDEX idx_reminders_remind ON reminders(remind_at);
      CREATE INDEX idx_reminders_user ON reminders(created_by);
    `,
  },
  {
    version: 163,
    description: 'Quick links: a built-in symbol as a third face, next to image and monogram (#873)',
    up: `

      --
      -- Gemeldet war: "It's just an icon and as heavy self-hoster I don't want
      -- to search and fetch icons from somewhere, I would like to have it just



      --






      -- kann.
      --






      -- Sicherheitsgrenze; siehe iconName() in server/routes/quick-links.js.
      --





      ALTER TABLE quick_links ADD COLUMN icon_name TEXT;
    `,
  },
  {
    version: 164,
    description: 'Document folders: a folder may live inside a folder (#785)',
    foreignKeysOff: true,
    up: `

      --





      --





      -- werden muesste.
      --



      --

      --





      -- Tabelle neu zu bauen.
      --







      --
      -- COALESCE UND KEIN SCHLICHTES UNIQUE(parent_id, name): SQLite behandelt

      -- name) liesse also beliebig viele Wurzelordner desselben Namens zu -

      --

      --

      -- Dateibrowser. Die DOKUMENTE darin bleiben: family_documents.folder_id



      -- Dokument kosten.
      --


      -- DROP TABLE leer.
      --



      CREATE TABLE family_document_folders_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        parent_id   INTEGER REFERENCES family_document_folders_new(id) ON DELETE CASCADE,
        module_key  TEXT,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT INTO family_document_folders_new (id, name, module_key, created_by, created_at, updated_at)
        SELECT id, name, module_key, created_by, created_at, updated_at FROM family_document_folders;

      DROP TABLE family_document_folders;
      ALTER TABLE family_document_folders_new RENAME TO family_document_folders;

      CREATE UNIQUE INDEX idx_family_document_folders_sibling_name
        ON family_document_folders(COALESCE(parent_id, 0), name);



      CREATE UNIQUE INDEX idx_family_document_folders_module_key
        ON family_document_folders(module_key) WHERE module_key IS NOT NULL;



      CREATE INDEX idx_family_document_folders_parent
        ON family_document_folders(parent_id);

      CREATE TRIGGER trg_family_document_folders_updated_at
        AFTER UPDATE ON family_document_folders FOR EACH ROW
        BEGIN UPDATE family_document_folders SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
    `,
  },
  {
    version: 165,
    description: 'Schedule: cycle patterns and per-day overrides (#786)',
    up: `
      CREATE TABLE IF NOT EXISTS schedule_shift_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, short_code TEXT,
        start_time TEXT, end_time TEXT, color TEXT NOT NULL DEFAULT '#6C3AED',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        CHECK ((start_time IS NULL) = (end_time IS NULL))
      );
      CREATE TABLE IF NOT EXISTS schedule_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, anchor_date TEXT NOT NULL,
        cycle_length INTEGER NOT NULL CHECK (cycle_length BETWEEN 1 AND 366),
        valid_from TEXT, valid_until TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS schedule_pattern_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_id INTEGER NOT NULL REFERENCES schedule_patterns(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        shift_type_id INTEGER REFERENCES schedule_shift_types(id) ON DELETE RESTRICT,
        UNIQUE (pattern_id, position)
      );
      CREATE TABLE IF NOT EXISTS schedule_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date_key TEXT NOT NULL, shift_type_id INTEGER REFERENCES schedule_shift_types(id) ON DELETE RESTRICT,
        note TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE (user_id, date_key)
      );
      CREATE INDEX idx_schedule_patterns_user ON schedule_patterns(user_id);
      CREATE INDEX idx_schedule_overrides_user ON schedule_overrides(user_id, date_key);
      CREATE TRIGGER trg_schedule_shift_types_updated_at AFTER UPDATE ON schedule_shift_types FOR EACH ROW BEGIN
        UPDATE schedule_shift_types SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE TRIGGER trg_schedule_patterns_updated_at AFTER UPDATE ON schedule_patterns FOR EACH ROW BEGIN
        UPDATE schedule_patterns SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
    `,
    afterUp(db) {
      const row = db.prepare("SELECT value FROM sync_config WHERE key = 'disabled_modules'").get();
      let disabled = [];
      try { const parsed = JSON.parse(row?.value || '[]'); if (Array.isArray(parsed)) disabled = parsed.filter((key) => typeof key === 'string'); } catch { /* replace invalid legacy value */ }
      if (!disabled.includes('schedule')) disabled.push('schedule');
      db.prepare("INSERT INTO sync_config (key, value) VALUES ('disabled_modules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')").run(JSON.stringify(disabled));
    },
  },
  {
    version: 166,
    description: 'Calendar: an event may have no colour of its own, so the assignee can lend theirs (#891)',







    //


    // davon (event_assignments, calendar_event_exceptions) mit ON DELETE CASCADE

    //
    // BESTANDSDATEN BLEIBEN UNVERAENDERT. Verlockend waere, '#007AFF' als "nie







    foreignKeysOff: true,








    up(db) {
      const spalten = new Set(db.prepare('PRAGMA table_info(calendar_events)').all().map((c) => c.name));
      if (!spalten.has('tzid')) db.exec('ALTER TABLE calendar_events ADD COLUMN tzid TEXT');

      db.exec(`
      CREATE TABLE calendar_events_new (
        id                           INTEGER PRIMARY KEY AUTOINCREMENT,
        title                        TEXT    NOT NULL,
        description                  TEXT,
        start_datetime               TEXT    NOT NULL,
        end_datetime                 TEXT,
        all_day                      INTEGER NOT NULL DEFAULT 0,
        location                     TEXT,
        color                        TEXT,
        assigned_to                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by                   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        external_calendar_id         TEXT,
        external_source              TEXT    NOT NULL DEFAULT 'local'
                                             CHECK(external_source IN ('local', 'google', 'apple', 'ics', 'caldav')),
        recurrence_rule              TEXT,
        subscription_id              INTEGER REFERENCES ics_subscriptions(id) ON DELETE CASCADE,
        user_modified                INTEGER NOT NULL DEFAULT 0,
        calendar_ref_id              INTEGER REFERENCES external_calendars(id) ON DELETE SET NULL,
        icon                         TEXT    NOT NULL DEFAULT 'calendar',
        attachment_name              TEXT,
        attachment_mime              TEXT,
        attachment_size              INTEGER,
        attachment_data              TEXT,
        target_caldav_account_id     INTEGER,
        target_caldav_calendar_url   TEXT,
        created_at                   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at                   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        attachment_document_id       INTEGER REFERENCES family_documents(id) ON DELETE SET NULL,
        target_google_calendar_id    TEXT,
        visibility                   TEXT    NOT NULL DEFAULT 'all',
        tzid                         TEXT,
        outbound_dirty               INTEGER NOT NULL DEFAULT 0,
        outbound_attempts            INTEGER NOT NULL DEFAULT 0,
        outbound_move_to             TEXT,
        external_object_url          TEXT,
        countdown                    INTEGER NOT NULL DEFAULT 0,
        target_outlook_account_id    INTEGER,
        target_outlook_calendar_id   TEXT
      );

      INSERT INTO calendar_events_new
        (id, title, description, start_datetime, end_datetime, all_day, location, color,
         assigned_to, created_by, external_calendar_id, external_source, recurrence_rule,
         subscription_id, user_modified, calendar_ref_id, icon,
         attachment_name, attachment_mime, attachment_size, attachment_data,
         target_caldav_account_id, target_caldav_calendar_url, created_at, updated_at,
         attachment_document_id, target_google_calendar_id, visibility, tzid,
         outbound_dirty, outbound_attempts, outbound_move_to, external_object_url,
         countdown, target_outlook_account_id, target_outlook_calendar_id)
      SELECT id, title, description, start_datetime, end_datetime, all_day, location, color,
             assigned_to, created_by, external_calendar_id, external_source, recurrence_rule,
             subscription_id, user_modified, calendar_ref_id, icon,
             attachment_name, attachment_mime, attachment_size, attachment_data,
             target_caldav_account_id, target_caldav_calendar_url, created_at, updated_at,
             attachment_document_id, target_google_calendar_id, visibility, tzid,
             outbound_dirty, outbound_attempts, outbound_move_to, external_object_url,
             countdown, target_outlook_account_id, target_outlook_calendar_id
      FROM calendar_events;


      -- Suchindex bleibt dabei unberuehrt, weil DROP TABLE keinen DELETE-Trigger

      DROP TRIGGER IF EXISTS trg_calendar_events_updated_at;
      DROP TRIGGER IF EXISTS trg_search_events_ai;
      DROP TRIGGER IF EXISTS trg_search_events_au;
      DROP TRIGGER IF EXISTS trg_search_events_ad;
      DROP TABLE calendar_events;
      ALTER TABLE calendar_events_new RENAME TO calendar_events;

      CREATE TRIGGER trg_calendar_events_updated_at
        AFTER UPDATE ON calendar_events FOR EACH ROW
        BEGIN UPDATE calendar_events SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

      CREATE TRIGGER trg_search_events_ai AFTER INSERT ON calendar_events BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('event', NEW.id,
                COALESCE(NEW.title, ''),
                TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.location, '')));
      END;

      CREATE TRIGGER trg_search_events_au AFTER UPDATE ON calendar_events BEGIN
        DELETE FROM search_index WHERE entity = 'event' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('event', NEW.id,
                COALESCE(NEW.title, ''),
                TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.location, '')));
      END;

      CREATE TRIGGER trg_search_events_ad AFTER DELETE ON calendar_events BEGIN
        DELETE FROM search_index WHERE entity = 'event' AND entity_id = OLD.id;
      END;

      CREATE INDEX idx_calendar_start ON calendar_events(start_datetime);
      CREATE INDEX idx_calendar_assigned ON calendar_events(assigned_to);
      CREATE INDEX idx_calendar_external_id ON calendar_events(external_calendar_id);
      CREATE INDEX idx_calendar_sub ON calendar_events(subscription_id);
      CREATE INDEX idx_cal_events_ref ON calendar_events(calendar_ref_id);
      CREATE UNIQUE INDEX idx_calendar_sub_extid ON calendar_events (subscription_id, external_calendar_id);
      CREATE INDEX idx_calendar_attachment_document ON calendar_events(attachment_document_id);
      CREATE INDEX idx_calendar_recurring ON calendar_events(start_datetime) WHERE recurrence_rule IS NOT NULL;
      CREATE INDEX idx_calendar_outbound_dirty ON calendar_events(outbound_dirty) WHERE outbound_dirty = 1;
      `);
    },
  },
  {
    version: 167,
    description: 'Calendar: color_modified tells a local recolour apart from any other edit (#899)',

    // JEDER Bearbeitung eines gespiegelten Termins gesetzt (routes/calendar/




    //




    // `color IS NULL AND color_modified = 1` eindeutig "geleert".
    //

    // uebernimmt die bisherige Bedeutung wortwoertlich: jede Zeile, deren Farbe







    up: `
      ALTER TABLE calendar_events ADD COLUMN color_modified INTEGER NOT NULL DEFAULT 0;
      UPDATE calendar_events SET color_modified = user_modified;
    `,
  },
  {
    version: 168,
    description: 'Users: onboarding walkthrough remembered per account instead of per browser',




    //






    //

    // Einfuehrung (in ihrer bisherigen, geraetegebundenen Form) bereits




    // Verhalten fuer ein neues Konto bekommt.
    up: `
      ALTER TABLE users ADD COLUMN onboarding_version INTEGER NOT NULL DEFAULT 0;
      UPDATE users SET onboarding_version = 1;
    `,
  },
  {
    version: 169,
    description: 'Reminders: a reminder on a shared event reaches its assignees, not only its author (#921)',



    // steht das Erinnerungsfeld LEER da. Beide hielten sie fuer geteilt.
    //





    //







    //








    // gilt ab dann als seine eigene.
    up: `
      ALTER TABLE reminders ADD COLUMN assigned_from INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_reminders_assigned_from ON reminders(assigned_from);
    `,
  },
  {
    version: 170,
    description: 'Subscriptions: seed categories and payment methods carry a label key, so they speak the reader language (#950)',


    // Zahlungsarten daneben auf Englisch - dieselbe Liste, zwei Sprachen.
    //

    // englischen TEXT ('Credit Card', 'Entertainment'). Die Kategorien hatten




    // desselben Namens meint.
    //







    //






    // ('subscription_entertainment'), waehrend jede spaeter angelegte Zeile
    // 'subscription_category_<id>' traegt.
    //

    // jemand 'Entertainment' in 'Filme' umbenennt - dann waere ihr Name genauso
    // weg.
    //



    // fortan "Unterhaltung", obwohl er "Other" geschrieben hat. Beide Befunde



    //


    // feste Begriffe, deren Uebersetzung dasselbe meint ('PayPal' bleibt
    // 'PayPal', 'Credit Card' wird 'Kreditkarte'). Wer 'Credit Card' laengst



    // fragilere Anker: sie steht nirgends im Schema.
    up: `
      ALTER TABLE subscription_categories     ADD COLUMN label_key TEXT;
      ALTER TABLE subscription_payment_methods ADD COLUMN label_key TEXT;

      UPDATE subscription_categories SET label_key = 'budget.subcatSubscriptionEntertainment'
        WHERE budget_subcategory_key = 'subscription_entertainment' AND name = 'Entertainment';
      UPDATE subscription_categories SET label_key = 'budget.subcatSubscriptionProductivity'
        WHERE budget_subcategory_key = 'subscription_productivity'  AND name = 'Productivity';
      UPDATE subscription_categories SET label_key = 'budget.subcatSubscriptionUtilities'
        WHERE budget_subcategory_key = 'subscription_utilities'     AND name = 'Utilities';
      UPDATE subscription_categories SET label_key = 'budget.subcatSubscriptionHealth'
        WHERE budget_subcategory_key = 'subscription_health'        AND name = 'Health';
      UPDATE subscription_categories SET label_key = 'budget.subcatSubscriptionEducation'
        WHERE budget_subcategory_key = 'subscription_education'     AND name = 'Education';
      UPDATE subscription_categories SET label_key = 'budget.subcatSubscriptionOther'
        WHERE budget_subcategory_key = 'subscription_other'         AND name = 'Other';

      UPDATE subscription_payment_methods SET label_key = CASE name
        WHEN 'Credit Card'   THEN 'subscriptions.paymentMethodCreditCard'
        WHEN 'Debit Card'    THEN 'subscriptions.paymentMethodDebitCard'
        WHEN 'PayPal'        THEN 'subscriptions.paymentMethodPaypal'
        WHEN 'Apple Pay'     THEN 'subscriptions.paymentMethodApplePay'
        WHEN 'Google Pay'    THEN 'subscriptions.paymentMethodGooglePay'
        WHEN 'Bank Transfer' THEN 'subscriptions.paymentMethodBankTransfer'
        WHEN 'Other'         THEN 'subscriptions.paymentMethodOther'
      END
      WHERE name IN ('Credit Card', 'Debit Card', 'PayPal', 'Apple Pay', 'Google Pay', 'Bank Transfer', 'Other');
    `,
  },
  {
    version: 171,
    description: 'Invites carry the starting permissions the admin chose, applied at first login (#869)',

    // EINLADUNG. `access_permissions` speichert sparsam: keine Zeile heisst





    //






    //



    // dazwischen aendert. Form: `{"modules":{...},"widgets":{...}}`, dieselbe

    // selbst (nur Abweichungen).
    up: `
      ALTER TABLE invites ADD COLUMN permissions TEXT;
    `,
  },
  {
    version: 172,
    description: 'Personal default visibility per health area, so new entries follow a choice instead of a fixed value (#958)',









    //





    //






    //




    //
    //   scope_key  'vital:<type>' aus VITAL_METRICS, sonst 'meds' | 'labs'



    up: `
      CREATE TABLE IF NOT EXISTS health_visibility_defaults (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope_key  TEXT    NOT NULL,
        visibility TEXT    NOT NULL CHECK(visibility IN ('private', 'family')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (user_id, scope_key)
      );
    `,
  },
  {
    version: 173,
    description: 'Users: the changelog marks are remembered per account instead of per browser (#496)',





    // offene Kante benannt, bevor es jemand melden musste.
    //




    //                           laufen.
    //   changelog_seen_latest   die zuletzt bekannte VEROEFFENTLICHTE Version.
    //                           Beantwortet "gibt es draussen etwas Neueres" -



    //



    // eigenstaendig altern.
    //



    up: `
      ALTER TABLE users ADD COLUMN changelog_seen_version TEXT;
      ALTER TABLE users ADD COLUMN changelog_seen_latest  TEXT;
    `,
  },
  {
    version: 174,
    description: 'Birthdays: optional name day with its own generated calendar event',
    // A name day is an anniversary, not a birth date. Inventing a year would
    // produce false information in APIs, exports, and date formatting, so it is
    // stored canonically as MM-DD. Its event link is separate from the birthday
    // so either occurrence can move, be removed, or be deleted at a provider.
    up: `
      ALTER TABLE birthdays ADD COLUMN name_day TEXT;
      ALTER TABLE birthdays ADD COLUMN name_day_calendar_event_id INTEGER
        REFERENCES calendar_events(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_birthdays_name_day_calendar_ref
        ON birthdays(name_day_calendar_event_id);
    `,
  },
  {
    version: 175,
    description: 'Permissions: allow fine-grained capability resources',
    // `access_permissions.resource_type` is protected by a CHECK constraint.
    // SQLite cannot extend that constraint in place, so the table is rebuilt
    // while preserving every existing module and widget override verbatim.
    // No concrete capability is registered here; features can add one without
    // having to change this core table again.
    up: `
      CREATE TABLE access_permissions_new (
        subject_type  TEXT NOT NULL CHECK(subject_type IN ('role', 'user')),
        subject_id    TEXT NOT NULL,
        resource_type TEXT NOT NULL CHECK(resource_type IN ('module', 'widget', 'capability')),
        resource_key  TEXT NOT NULL,
        access        TEXT NOT NULL CHECK(access IN ('none', 'read', 'write', 'allow')),
        updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (subject_type, subject_id, resource_type, resource_key)
      );
      INSERT INTO access_permissions_new
        (subject_type, subject_id, resource_type, resource_key, access, updated_at)
      SELECT subject_type, subject_id, resource_type, resource_key, access, updated_at
      FROM access_permissions;
      DROP TABLE access_permissions;
      ALTER TABLE access_permissions_new RENAME TO access_permissions;
      CREATE INDEX IF NOT EXISTS idx_access_permissions_subject
        ON access_permissions(subject_type, subject_id);
    `,
  },
  {
    version: 176,
    description: 'Notes: user-defined personal and household categories',
    // PERSOENLICHE KATEGORIEN sind Metadaten ihres Besitzers. Sie duerfen an
    // einer geteilten Notiz haengen, bleiben fuer andere Betrachter aber


    // Zuordnungen; die geteilten Notizen bleiben bestehen.
    //


    // dem Konto ihres Erstellers verschwindet.
    //
    // ZWEI PARTIELLE UNIQUE-INDIZES bilden die beiden Namensraeume exakt ab:
    // einmal pro Haushalt, einmal pro Besitzer. `name_key` verwendet die

    up: `
      CREATE TABLE note_categories (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
        name_key      TEXT    NOT NULL,
        scope         TEXT    NOT NULL CHECK(scope IN ('personal', 'household')),
        owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        CHECK(
          (scope = 'personal' AND owner_user_id IS NOT NULL)
          OR (scope = 'household' AND owner_user_id IS NULL)
        )
      );

      CREATE TABLE note_category_assignments (
        note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES note_categories(id) ON DELETE CASCADE,
        assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        PRIMARY KEY (note_id, category_id)
      );

      CREATE UNIQUE INDEX idx_note_categories_household_name
        ON note_categories(name_key)
        WHERE scope = 'household';
      CREATE UNIQUE INDEX idx_note_categories_personal_name
        ON note_categories(owner_user_id, name_key)
        WHERE scope = 'personal';
      CREATE INDEX idx_note_categories_visible
        ON note_categories(scope, owner_user_id, sort_order, name COLLATE NOCASE);
      CREATE INDEX idx_note_category_assignments_category
        ON note_category_assignments(category_id, note_id);
      CREATE TRIGGER trg_note_categories_updated_at
        AFTER UPDATE OF name, name_key, sort_order ON note_categories
      BEGIN
        UPDATE note_categories
        SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = NEW.id;
      END;
    `,
  },
  {
    version: 177,
    description: 'Health: cycle reminders - widen reminders for cycle_period/cycle_log_nudge, add an anchor table',
    foreignKeysOff: true,
    up: `

      -- foreignKeysOff bleibt Pflicht - notification_deliveries.reminder_id

      -- DROP TABLE leerlaufen.
      CREATE TABLE reminders_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type   TEXT    NOT NULL CHECK(entity_type IN ('task', 'event', 'subscription', 'inventory_item', 'inventory_tracked_date', 'pantry_item', 'cycle_period', 'cycle_log_nudge')),
        entity_id     INTEGER NOT NULL,
        remind_at     TEXT    NOT NULL,
        dismissed     INTEGER NOT NULL DEFAULT 0,
        created_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        pushed_at     TEXT,
        assigned_from INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO reminders_new (id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at, assigned_from)
        SELECT id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at, assigned_from FROM reminders;
      DROP TABLE reminders;
      ALTER TABLE reminders_new RENAME TO reminders;
      CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);
      CREATE INDEX idx_reminders_remind ON reminders(remind_at);
      CREATE INDEX idx_reminders_user ON reminders(created_by);
      CREATE INDEX idx_reminders_assigned_from ON reminders(assigned_from);





      -- stabile Id, an die reminders.entity_id haengen koennte (gleicher

      -- Anker je (Person, Datum, Art) loest das einheitlich fuer beide

      CREATE TABLE cycle_reminder_anchors (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        anchor_date TEXT    NOT NULL,
        kind        TEXT    NOT NULL CHECK(kind IN ('period_predicted', 'log_nudge')),
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(user_id, anchor_date, kind)
      );



      ALTER TABLE cycle_settings ADD COLUMN remind_period_days_before INTEGER;

      -- vorliegt. Eigener Schalter statt an remind_period_days_before


      ALTER TABLE cycle_settings ADD COLUMN remind_log_daily INTEGER NOT NULL DEFAULT 0 CHECK(remind_log_daily IN (0, 1));
    `,
  },
  {
    version: 178,
    description: 'Health: graded symptom logging - normalized cycle_day_log_symptoms table, backfilled from the legacy CSV column',
    // Die alte Komma-Spalte (cycle_day_logs.symptoms) bleibt UNVERAENDERT

    // historisch: neue Schreibvorgaenge (server/routes/health/cycle.js)



    up: (database) => {
      database.exec(`
        CREATE TABLE cycle_day_log_symptoms (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          day_log_id  INTEGER NOT NULL REFERENCES cycle_day_logs(id) ON DELETE CASCADE,
          symptom_key TEXT    NOT NULL,
          intensity   INTEGER CHECK(intensity IS NULL OR intensity BETWEEN 1 AND 3),
          UNIQUE(day_log_id, symptom_key)
        );
        CREATE INDEX idx_cycle_day_log_symptoms_day_log ON cycle_day_log_symptoms(day_log_id);
      `);



      // erfundene Angabe, keine migrierte.
      const rows = database.prepare(
        "SELECT id, symptoms FROM cycle_day_logs WHERE symptoms IS NOT NULL AND symptoms <> ''"
      ).all();
      const insert = database.prepare(
        'INSERT OR IGNORE INTO cycle_day_log_symptoms (day_log_id, symptom_key, intensity) VALUES (?, ?, NULL)'
      );
      for (const row of rows) {
        const keys = new Set(String(row.symptoms).split(',').map((s) => s.trim()).filter(Boolean));
        for (const key of keys) insert.run(row.id, key);
      }
    },
  },
  {
    version: 179,
    description: 'Health: optional basal body temperature per day log, for temperature-shift ovulation confirmation',

    // Zeile existiert schon. Kein CHECK auf basal_temp_unit: dieselbe
    // Freitext-Konvention wie health_vitals.unit (kein haushaltweiter



    up: `
      ALTER TABLE cycle_day_logs ADD COLUMN basal_temp REAL;
      ALTER TABLE cycle_day_logs ADD COLUMN basal_temp_unit TEXT;
    `,
  },
  {
    version: 180,
    description: 'Health: per-user read-only predicted-cycle ICS feed token',



    // personengebunden (cycle_periods.user_id) - kein haushaltweiter
    // Rueckzugs-Nachteil zu vermeiden, aber dieselbe Konvention trotzdem

    up: `
      ALTER TABLE users ADD COLUMN cycle_feed_token TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cycle_feed_token
        ON users(cycle_feed_token)
        WHERE cycle_feed_token IS NOT NULL;
    `,
  },
  {
    version: 181,
    description: 'Budget: materialisierte Serien-Instanzen erben das Konto ihrer Serie nach (#973)',





    //




    //
    // Drei Einschraenkungen, jede mit Grund:






    //     Abbuchung, die so nie stattfindet.
    up: `
      UPDATE budget_entries
      SET account_id = (
        SELECT p.account_id FROM budget_entries p
        WHERE p.id = budget_entries.recurrence_parent_id
      )
      WHERE recurrence_parent_id IS NOT NULL
        AND account_id IS NULL
        AND EXISTS (
          SELECT 1 FROM budget_entries p
          WHERE p.id = budget_entries.recurrence_parent_id
            AND p.account_id IS NOT NULL
            AND p.recurrence_virtual = 0
        );
    `,
  },
  {
    version: 182,
    description: 'Schedule: an optional icon alongside a shift type\'s color (#786 follow-up)',

    // feststeht (quick-links, Kalender-Termine) - nullable, weil bestehende

    up: `
      ALTER TABLE schedule_shift_types ADD COLUMN icon TEXT;
    `,
  },
  {
    version: 183,
    description: 'add per-user read-only schedule feed token',
    up: `



      ALTER TABLE users ADD COLUMN schedule_feed_token TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_schedule_feed_token
        ON users(schedule_feed_token)
        WHERE schedule_feed_token IS NOT NULL;
    `,
  },
  {
    version: 184,
    description: 'Schedule: shift-start reminders - widen reminders for schedule_entry, add an anchor table for pattern days',
    foreignKeysOff: true,

    up: `
      CREATE TABLE reminders_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL CHECK(entity_type IN ('task', 'event', 'subscription', 'inventory_item', 'inventory_tracked_date', 'pantry_item', 'cycle_period', 'cycle_log_nudge', 'schedule_entry')),
        entity_id   INTEGER NOT NULL,
        remind_at   TEXT    NOT NULL,
        dismissed   INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        pushed_at   TEXT,
        assigned_from INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO reminders_new (id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at, assigned_from)
        SELECT id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at, assigned_from FROM reminders;
      DROP TABLE reminders;
      ALTER TABLE reminders_new RENAME TO reminders;
      CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);
      CREATE INDEX idx_reminders_remind ON reminders(remind_at);
      CREATE INDEX idx_reminders_user ON reminders(created_by);
      CREATE INDEX idx_reminders_assigned_from ON reminders(assigned_from);



      -- keine stabile Id, an die reminders.entity_id haengen koennte - anders



      -- periodische Sync (server/services/schedule-reminders.js) fuer sein


      --







      CREATE TABLE schedule_reminder_entries (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date_key       TEXT    NOT NULL,
        shift_type_id  INTEGER NOT NULL REFERENCES schedule_shift_types(id) ON DELETE CASCADE,
        pattern_day_id INTEGER
      );
      CREATE UNIQUE INDEX idx_schedule_reminder_entries_slot
        ON schedule_reminder_entries(user_id, date_key, COALESCE(pattern_day_id, 0));


      -- Schichtbeginn. Anders als calendar_feed_token keine eigene


      ALTER TABLE users ADD COLUMN schedule_reminder_offset_minutes INTEGER;
    `,
  },
  {
    version: 185,
    description: 'Schedule: a personal weekly-hours target for the overtime flag',
    up: `

      -- Bestandshaushalt sieht also keinen stillen Wechsel. Personenbezogen



      ALTER TABLE users ADD COLUMN schedule_weekly_hours INTEGER;
    `,
  },
  {
    version: 186,
    description: 'Schedule: extra shifts, additive to the primary pattern/override slot (on-call alongside a regular shift)',




    // braucht keine Sonderbehandlung), nie ein Ersatz dafuer, daher beliebig




    up: `
      CREATE TABLE schedule_extra_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date_key TEXT NOT NULL,
        shift_type_id INTEGER NOT NULL REFERENCES schedule_shift_types(id) ON DELETE RESTRICT,
        note TEXT,
        reminder_offset_minutes INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE INDEX idx_schedule_extra_shifts_user ON schedule_extra_shifts(user_id, date_key);
    `,
  },
  {
    version: 187,
    description: 'Reminders: widen for schedule_extra_entry, extra shifts get their own independent reminders',
    foreignKeysOff: true,




    // reminders.entity_id zeigt direkt darauf.
    up: `
      CREATE TABLE reminders_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL CHECK(entity_type IN ('task', 'event', 'subscription', 'inventory_item', 'inventory_tracked_date', 'pantry_item', 'cycle_period', 'cycle_log_nudge', 'schedule_entry', 'schedule_extra_entry')),
        entity_id   INTEGER NOT NULL,
        remind_at   TEXT    NOT NULL,
        dismissed   INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        pushed_at   TEXT,
        assigned_from INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO reminders_new (id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at, assigned_from)
        SELECT id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at, assigned_from FROM reminders;
      DROP TABLE reminders;
      ALTER TABLE reminders_new RENAME TO reminders;
      CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);
      CREATE INDEX idx_reminders_remind ON reminders(remind_at);
      CREATE INDEX idx_reminders_user ON reminders(created_by);
      CREATE INDEX idx_reminders_assigned_from ON reminders(assigned_from);
    `,
  },
  {
    version: 188,
    description: 'Schedule: multiple pattern days at the same cycle position (timetables, not just one shift/day)',
    foreignKeysOff: true,
    // schedule_pattern_days trug bisher UNIQUE(pattern_id, position) - genau


    // Zeiten (Mathe 8-9, Bio 9-10, ...), jeder sein eigener shift_type_id.
    // SQLite kennt kein ALTER TABLE ... DROP CONSTRAINT, daher der Neubau -
    // rein additiv/rueckwirkungsfrei, jede bestehende Zeile erfuellt die
    // lockerere Form schon 1:1.
    //
    // schedule_reminder_entries traegt pattern_day_id bereits seit ihrer
    // Entstehung (Migration 184) - kein zweiter Rebuild hier noetig, siehe
    // deren eigener Kommentar.
    up: `
      CREATE TABLE schedule_pattern_days_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_id INTEGER NOT NULL REFERENCES schedule_patterns(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        shift_type_id INTEGER REFERENCES schedule_shift_types(id) ON DELETE RESTRICT
      );
      INSERT INTO schedule_pattern_days_new (id, pattern_id, position, shift_type_id)
        SELECT id, pattern_id, position, shift_type_id FROM schedule_pattern_days;
      DROP TABLE schedule_pattern_days;
      ALTER TABLE schedule_pattern_days_new RENAME TO schedule_pattern_days;
      CREATE INDEX idx_schedule_pattern_days_pattern_position ON schedule_pattern_days(pattern_id, position);
    `,
  },
  {
    version: 189,
    description: 'Schedule: custom field registry, per-shift-type assignment, and per-occurrence values',
    up: `
      CREATE TABLE schedule_custom_fields (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TRIGGER trg_schedule_custom_fields_updated_at AFTER UPDATE ON schedule_custom_fields FOR EACH ROW BEGIN
        UPDATE schedule_custom_fields SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;





      -- schedule_custom_fields.
      CREATE TABLE schedule_shift_type_fields (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_type_id    INTEGER NOT NULL REFERENCES schedule_shift_types(id) ON DELETE CASCADE,
        custom_field_id  INTEGER NOT NULL REFERENCES schedule_custom_fields(id) ON DELETE CASCADE,
        position         INTEGER NOT NULL DEFAULT 0,
        show_in_overlay  INTEGER NOT NULL DEFAULT 0 CHECK (show_in_overlay IN (0, 1)),
        UNIQUE (shift_type_id, custom_field_id)
      );
      CREATE INDEX idx_schedule_shift_type_fields_type ON schedule_shift_type_fields(shift_type_id, position);


      -- Fremdschluessel (polymorph ueber drei Elterntabellen - schedule_pattern_days,
      -- schedule_overrides, schedule_extra_shifts - dasselbe Zugestaendnis wie



      CREATE TABLE schedule_custom_field_values (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_type       TEXT    NOT NULL CHECK (entry_type IN ('pattern_day', 'override', 'extra_shift')),
        entry_id         INTEGER NOT NULL,
        custom_field_id  INTEGER NOT NULL REFERENCES schedule_custom_fields(id) ON DELETE CASCADE,
        value            TEXT    NOT NULL CHECK (length(value) BETWEEN 1 AND 500),
        UNIQUE (entry_type, entry_id, custom_field_id)
      );
      CREATE INDEX idx_schedule_custom_field_values_entry ON schedule_custom_field_values(entry_type, entry_id);
    `,
  },
  {
    version: 190,
    description: 'account username on inventory items and subscriptions',
    up: `

      --




      -- Grenze dazu steht dauerhaft in docs/SCOPE.md, Abschnitt 2.
      --

      -- Nachlaessigkeit: inventory_items traegt weder owner_id noch visibility,





      --


      ALTER TABLE inventory_items      ADD COLUMN account_username TEXT;
      ALTER TABLE budget_subscriptions ADD COLUMN account_username TEXT;
    `,
  },
  {
    version: 191,
    description: 'responsible members per budget entry',
    up: `

      -- bewegt.
      --






      --



      --



      CREATE TABLE budget_entry_responsibles (
        entry_id INTEGER NOT NULL REFERENCES budget_entries(id) ON DELETE CASCADE,
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (entry_id, user_id)
      );


      CREATE INDEX idx_budget_entry_responsibles_user ON budget_entry_responsibles(user_id);
    `,
  },
  {
    version: 192,
    description: 'own image for recipes typed into aashiyana',
    up: `
      -- EIN BILD JE REZEPT (#1059, Schritt 2).
      --

      -- gespiegelten Provider-Rezepts; wer keinen Mealie- oder Tandoor-Server

      -- das selbst hochgeladene Bild.
      --






      ALTER TABLE recipes ADD COLUMN image_data TEXT;
    `,
  },
  {
    version: 193,
    description: 'price and shop on a shopping item, managed shop list',
    up: `

      --





      -- (#714).
      --


      -- unordentlich (REWE, Rewe, rewe City sind dann drei Laeden).
      CREATE TABLE shopping_stores (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE (name)
      );



      -- spaeter darauf aufbaut, addiert genau solche Zahlen.
      --



      -- verschwindet.
      ALTER TABLE shopping_items ADD COLUMN price_cents INTEGER;
      ALTER TABLE shopping_items ADD COLUMN store_id INTEGER REFERENCES shopping_stores(id) ON DELETE SET NULL;
      CREATE INDEX idx_shopping_items_store ON shopping_items(store_id);
    `,
  },
  {
    version: 194,
    description: 'Calendar: linked overrides for local recurring occurrences (#975)',
    up: `
      ALTER TABLE calendar_events ADD COLUMN recurrence_parent_id INTEGER
        REFERENCES calendar_events(id) ON DELETE CASCADE;
      ALTER TABLE calendar_events ADD COLUMN recurrence_id TEXT;
      ALTER TABLE calendar_events ADD COLUMN overridden_fields TEXT;
      CREATE UNIQUE INDEX idx_calendar_occurrence_override_slot
        ON calendar_events(recurrence_parent_id, recurrence_id)
        WHERE recurrence_parent_id IS NOT NULL;
      CREATE INDEX idx_calendar_occurrence_override_range
        ON calendar_events(recurrence_parent_id, start_datetime)
        WHERE recurrence_parent_id IS NOT NULL;

      -- A child inherits text it did not override, so indexing its stored copy
      -- would duplicate the master for ordinary searches and consume LIMIT.
      DROP TRIGGER IF EXISTS trg_search_events_ai;
      DROP TRIGGER IF EXISTS trg_search_events_au;
      DROP TRIGGER IF EXISTS trg_search_events_ad;
      CREATE TRIGGER trg_search_events_ai AFTER INSERT ON calendar_events BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('event', NEW.id,
          CASE WHEN NEW.recurrence_parent_id IS NULL
                 OR EXISTS (SELECT 1 FROM json_each(
                      CASE WHEN json_valid(NEW.overridden_fields) THEN
                        CASE WHEN json_type(NEW.overridden_fields) = 'array' THEN NEW.overridden_fields END
                      END) WHERE type = 'text' AND value = 'title')
               THEN COALESCE(NEW.title, '') ELSE '' END,
          TRIM(
            CASE WHEN NEW.recurrence_parent_id IS NULL
                    OR EXISTS (SELECT 1 FROM json_each(
                         CASE WHEN json_valid(NEW.overridden_fields) THEN
                           CASE WHEN json_type(NEW.overridden_fields) = 'array' THEN NEW.overridden_fields END
                         END) WHERE type = 'text' AND value = 'description')
                 THEN COALESCE(NEW.description, '') ELSE '' END
            || ' ' ||
            CASE WHEN NEW.recurrence_parent_id IS NULL
                    OR EXISTS (SELECT 1 FROM json_each(
                         CASE WHEN json_valid(NEW.overridden_fields) THEN
                           CASE WHEN json_type(NEW.overridden_fields) = 'array' THEN NEW.overridden_fields END
                         END) WHERE type = 'text' AND value = 'location')
                 THEN COALESCE(NEW.location, '') ELSE '' END));
      END;
      CREATE TRIGGER trg_search_events_au AFTER UPDATE ON calendar_events BEGIN
        DELETE FROM search_index WHERE entity = 'event' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('event', NEW.id,
          CASE WHEN NEW.recurrence_parent_id IS NULL
                 OR EXISTS (SELECT 1 FROM json_each(
                      CASE WHEN json_valid(NEW.overridden_fields) THEN
                        CASE WHEN json_type(NEW.overridden_fields) = 'array' THEN NEW.overridden_fields END
                      END) WHERE type = 'text' AND value = 'title')
               THEN COALESCE(NEW.title, '') ELSE '' END,
          TRIM(
            CASE WHEN NEW.recurrence_parent_id IS NULL
                    OR EXISTS (SELECT 1 FROM json_each(
                         CASE WHEN json_valid(NEW.overridden_fields) THEN
                           CASE WHEN json_type(NEW.overridden_fields) = 'array' THEN NEW.overridden_fields END
                         END) WHERE type = 'text' AND value = 'description')
                 THEN COALESCE(NEW.description, '') ELSE '' END
            || ' ' ||
            CASE WHEN NEW.recurrence_parent_id IS NULL
                    OR EXISTS (SELECT 1 FROM json_each(
                         CASE WHEN json_valid(NEW.overridden_fields) THEN
                           CASE WHEN json_type(NEW.overridden_fields) = 'array' THEN NEW.overridden_fields END
                         END) WHERE type = 'text' AND value = 'location')
                 THEN COALESCE(NEW.location, '') ELSE '' END));
      END;
      CREATE TRIGGER trg_search_events_ad AFTER DELETE ON calendar_events BEGIN
        DELETE FROM search_index WHERE entity = 'event' AND entity_id = OLD.id;
      END;
      DELETE FROM search_index WHERE entity = 'event';
      INSERT INTO search_index (entity, entity_id, title, body)
      SELECT 'event', id,
        CASE WHEN recurrence_parent_id IS NULL
               OR EXISTS (SELECT 1 FROM json_each(
                    CASE WHEN json_valid(overridden_fields) THEN
                      CASE WHEN json_type(overridden_fields) = 'array' THEN overridden_fields END
                    END) WHERE type = 'text' AND value = 'title')
             THEN COALESCE(title, '') ELSE '' END,
        TRIM(
          CASE WHEN recurrence_parent_id IS NULL
                  OR EXISTS (SELECT 1 FROM json_each(
                       CASE WHEN json_valid(overridden_fields) THEN
                         CASE WHEN json_type(overridden_fields) = 'array' THEN overridden_fields END
                       END) WHERE type = 'text' AND value = 'description')
               THEN COALESCE(description, '') ELSE '' END
          || ' ' ||
          CASE WHEN recurrence_parent_id IS NULL
                  OR EXISTS (SELECT 1 FROM json_each(
                       CASE WHEN json_valid(overridden_fields) THEN
                         CASE WHEN json_type(overridden_fields) = 'array' THEN overridden_fields END
                       END) WHERE type = 'text' AND value = 'location')
               THEN COALESCE(location, '') ELSE '' END)
      FROM calendar_events;    `,
  },
  {
    version: 195,
    description: 'heal contacts auto-created for family/guest members with the legacy Sonstiges category (#1140)',
    up: `

      -- gespiegelt werden (server/auth.js, server/routes/split-expenses.js),

      -- stabilen Keys 'misc'. Da 'Sonstiges' kein Key in contact_categories

      --

      -- carddav_uid IS NOT NULL, um manuell angelegte Kontakte zu schonen.




      -- liegengebliebener Legacy-Default, keine Nutzerentscheidung.
      UPDATE contacts SET category = 'misc' WHERE category = 'Sonstiges';
    `,
  },
  {
    version: 196,
    description: 'change counter per shopping list, fed by triggers, for live updates',
    up: `

      --





      --

      -- sechs Modulen beschrieben (Einkauf, Essensplan, Rezepte, Haushaltshilfe,
      -- MCP, CalDAV-Sync). Ein Vermerk an jeder Schreibstelle waere sechs


      -- aus (docs/DECISIONS.md, Eintrag 2).
      CREATE TABLE shopping_list_changes (
        list_id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 0
      );




      INSERT INTO shopping_list_changes (list_id, version) SELECT id, 0 FROM shopping_lists;
      CREATE TRIGGER trg_shopping_lists_change_ai AFTER INSERT ON shopping_lists BEGIN
        INSERT OR IGNORE INTO shopping_list_changes (list_id, version) VALUES (NEW.id, 0);
      END;

      CREATE TRIGGER trg_shopping_lists_change_au AFTER UPDATE ON shopping_lists BEGIN
        INSERT INTO shopping_list_changes (list_id, version) VALUES (NEW.id, 1)
          ON CONFLICT(list_id) DO UPDATE SET version = version + 1;
      END;
      CREATE TRIGGER trg_shopping_items_change_ai AFTER INSERT ON shopping_items BEGIN
        INSERT INTO shopping_list_changes (list_id, version) VALUES (NEW.list_id, 1)
          ON CONFLICT(list_id) DO UPDATE SET version = version + 1;
      END;








      -- neu schreibt. IS NOT statt <>, damit NULL gegen NULL gleich ist.


      CREATE TRIGGER trg_shopping_items_change_au AFTER UPDATE ON shopping_items
        WHEN NEW.list_id IS NOT OLD.list_id OR NEW.name IS NOT OLD.name
          OR NEW.quantity IS NOT OLD.quantity OR NEW.category IS NOT OLD.category
          OR NEW.is_checked IS NOT OLD.is_checked OR NEW.notes IS NOT OLD.notes
          OR NEW.url IS NOT OLD.url OR NEW.sort_order IS NOT OLD.sort_order
          OR NEW.price_cents IS NOT OLD.price_cents OR NEW.store_id IS NOT OLD.store_id
        BEGIN
        INSERT INTO shopping_list_changes (list_id, version) VALUES (NEW.list_id, 1)
          ON CONFLICT(list_id) DO UPDATE SET version = version + 1;
      END;



      CREATE TRIGGER trg_shopping_items_change_au_moved AFTER UPDATE OF list_id ON shopping_items
        WHEN OLD.list_id <> NEW.list_id BEGIN
        INSERT INTO shopping_list_changes (list_id, version) VALUES (OLD.list_id, 1)
          ON CONFLICT(list_id) DO UPDATE SET version = version + 1;
      END;
      CREATE TRIGGER trg_shopping_items_change_ad AFTER DELETE ON shopping_items BEGIN
        INSERT INTO shopping_list_changes (list_id, version) VALUES (OLD.list_id, 1)
          ON CONFLICT(list_id) DO UPDATE SET version = version + 1;
      END;










      CREATE TRIGGER trg_shopping_item_tags_change_ai AFTER INSERT ON shopping_item_tags BEGIN
        INSERT INTO shopping_list_changes (list_id, version)
          SELECT list_id, 1 FROM shopping_items WHERE id = NEW.item_id
          ON CONFLICT(list_id) DO UPDATE SET version = version + 1;
      END;
      CREATE TRIGGER trg_shopping_item_tags_change_ad AFTER DELETE ON shopping_item_tags BEGIN
        INSERT INTO shopping_list_changes (list_id, version)
          SELECT list_id, 1 FROM shopping_items WHERE id = OLD.item_id
          ON CONFLICT(list_id) DO UPDATE SET version = version + 1;
      END;





      CREATE TRIGGER trg_shopping_lists_change_ad AFTER DELETE ON shopping_lists BEGIN
        DELETE FROM shopping_list_changes WHERE list_id = OLD.id;
      END;
    `,
  },
  {
    version: 197,
    description: 'Waste collection: types, manual schedules, per-occurrence overrides, and one-off pickups (#1063)',
    up: `
      CREATE TABLE waste_types (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        icon        TEXT    NOT NULL DEFAULT 'trash-2',
        color       TEXT    NOT NULL,
        archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TRIGGER trg_waste_types_updated_at AFTER UPDATE ON waste_types FOR EACH ROW BEGIN
        UPDATE waste_types SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE INDEX idx_waste_types_sort ON waste_types(archived, sort_order);

      -- recurrence_kind picks which of weekdays / month_day is authoritative for a
      -- schedule; the trailing CHECK keeps the other one NULL so a row can never
      -- carry both or neither. month_day=-1 means "last day of the month" (mirrors
      -- recurrence.js's own BYMONTHDAY=-1 convention); 1..31 means a fixed day, and
      -- anchor_date's own day-of-month must equal it (enforced in waste-domain.js,
      -- not here, since SQLite CHECK can't read a substring of another column
      -- portably across the two representations the codebase already has).
      CREATE TABLE waste_schedules (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        type_id          INTEGER NOT NULL REFERENCES waste_types(id),
        recurrence_kind  TEXT    NOT NULL CHECK (recurrence_kind IN ('weekly', 'monthly_fixed_day')),
        anchor_date      TEXT    NOT NULL,
        interval         INTEGER NOT NULL DEFAULT 1 CHECK (interval BETWEEN 1 AND 52),
        weekdays         TEXT,
        month_day        INTEGER CHECK (month_day IS NULL OR month_day = -1 OR month_day BETWEEN 1 AND 31),
        valid_until      TEXT,
        active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        CHECK (
          (recurrence_kind = 'weekly' AND weekdays IS NOT NULL AND month_day IS NULL)
          OR (recurrence_kind = 'monthly_fixed_day' AND month_day IS NOT NULL AND weekdays IS NULL)
        )
      );
      CREATE TRIGGER trg_waste_schedules_updated_at AFTER UPDATE ON waste_schedules FOR EACH ROW BEGIN
        UPDATE waste_schedules SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE INDEX idx_waste_schedules_type_active ON waste_schedules(type_id, active);

      -- One row per exception to a schedule's calculated occurrences.
      -- replacement_date NULL = explicit skip; a date = moved. UNIQUE(schedule_id,
      -- original_date) keeps a single calculated occurrence from carrying two
      -- contradictory overrides.
      CREATE TABLE waste_schedule_overrides (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id       INTEGER NOT NULL REFERENCES waste_schedules(id) ON DELETE CASCADE,
        original_date     TEXT    NOT NULL,
        replacement_date  TEXT,
        note              TEXT,
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE (schedule_id, original_date),
        CHECK (replacement_date IS NULL OR replacement_date <> original_date)
      );
      CREATE TRIGGER trg_waste_schedule_overrides_updated_at AFTER UPDATE ON waste_schedule_overrides FOR EACH ROW BEGIN
        UPDATE waste_schedule_overrides SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE INDEX idx_waste_schedule_overrides_schedule ON waste_schedule_overrides(schedule_id);

      -- A one-off is a domain fact (irregular/special collection), not a schedule
      -- with a fake recurrence. UNIQUE(type_id, date) keeps re-adding the same
      -- manual fact from silently duplicating an occurrence.
      CREATE TABLE waste_one_off_pickups (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        type_id     INTEGER NOT NULL REFERENCES waste_types(id),
        date        TEXT    NOT NULL,
        note        TEXT,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE (type_id, date)
      );
      CREATE TRIGGER trg_waste_one_off_pickups_updated_at AFTER UPDATE ON waste_one_off_pickups FOR EACH ROW BEGIN
        UPDATE waste_one_off_pickups SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE INDEX idx_waste_one_off_pickups_type_date ON waste_one_off_pickups(type_id, date);
    `,
  },
  {
    version: 198,
    description: 'ship the Waste collection module disabled by default (households opt in, #1063)',
    up(db) {
      // Same merge-not-replace pattern as migration 145 (Inventory) and 166
      // (Schedule): a household may already have disabled other modules, and a
      // blind INSERT OR REPLACE would silently re-enable them.
      const row = db.prepare("SELECT value FROM sync_config WHERE key = 'disabled_modules'").get();

      let disabled = [];
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value);
          if (Array.isArray(parsed)) disabled = parsed.filter((m) => typeof m === 'string');
        } catch { /* a broken value is replaced, not honored */ }
      }

      if (disabled.includes('waste')) return;
      disabled.push('waste');

      db.prepare(`
        INSERT INTO sync_config (key, value) VALUES ('disabled_modules', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      `).run(JSON.stringify(disabled));
    },
  },
  {
    version: 199,
    description: 'Waste collection: ICS import sources with health tracking (#1063 Phase 3)',
    up: `
      -- One row per imported file. version starts at 1 and is bumped on every
      -- committed (re)import; content_hash is the sha256 of the raw ICS text
      -- that produced the current committed snapshot, so a re-import preview
      -- can tell "nothing changed" from "this differs" without diffing rows.
      -- last_success_at is only touched on a successful commit (never cleared
      -- by a later failed attempt), so "needs refresh" reads as
      -- last_success_at stale/absent while last_error is set - never merely
      -- from file age (invariant #6).
      CREATE TABLE waste_sources (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        kind             TEXT    NOT NULL DEFAULT 'file' CHECK (kind IN ('file')),
        name             TEXT    NOT NULL,
        content_hash     TEXT    NOT NULL,
        version          INTEGER NOT NULL DEFAULT 1,
        coverage_start   TEXT,
        coverage_end     TEXT,
        last_import_at   TEXT,
        last_success_at  TEXT,
        last_error       TEXT,
        created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TRIGGER trg_waste_sources_updated_at AFTER UPDATE ON waste_sources FOR EACH ROW BEGIN
        UPDATE waste_sources SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE INDEX idx_waste_sources_name ON waste_sources(name);
    `,
  },
  {
    version: 200,
    description: 'Waste collection: ICS source label-to-type mappings (#1063 Phase 3)',
    up: `
      -- One row per distinct label (CATEGORIES tag, or SUMMARY when a feed
      -- carries no categories) seen for a source. Exactly one of
      -- (type_id set) / (ignored=1) is valid - a label is always either
      -- mapped or explicitly excluded, never left ambiguous. Rows persist
      -- across re-imports (UNIQUE on source_id+normalized_label) so a
      -- reviewed decision is remembered and only resurfaced for review, not
      -- re-asked, unless the label itself is new.
      CREATE TABLE waste_source_mappings (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id         INTEGER NOT NULL REFERENCES waste_sources(id) ON DELETE CASCADE,
        original_label    TEXT    NOT NULL,
        normalized_label  TEXT    NOT NULL,
        type_id           INTEGER REFERENCES waste_types(id),
        ignored           INTEGER NOT NULL DEFAULT 0 CHECK (ignored IN (0, 1)),
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE (source_id, normalized_label),
        CHECK (
          (ignored = 1 AND type_id IS NULL) OR (ignored = 0 AND type_id IS NOT NULL)
        )
      );
      CREATE TRIGGER trg_waste_source_mappings_updated_at AFTER UPDATE ON waste_source_mappings FOR EACH ROW BEGIN
        UPDATE waste_source_mappings SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE INDEX idx_waste_source_mappings_source ON waste_source_mappings(source_id);
    `,
  },
  {
    version: 201,
    description: 'Waste collection: committed imported pickups (#1063 Phase 3)',
    up: `
      -- One row per concrete pickup fact accepted by a committed import.
      -- identity_key is the stable cross-reimport identity used to diff a
      -- re-import into additions/changes/removals: the ICS UID (optionally
      -- suffixed with the concrete date, for a recurring or overridden
      -- VEVENT) when present, otherwise a deterministic fingerprint over the
      -- label and date (opt-in allowMissingUid mode - see waste-import.js).
      -- external_uid is kept separately, nullable, purely for display/
      -- diagnostics. type_id carries no cascade: an imported pickup is a
      -- reference that blocks type deletion exactly like a schedule or
      -- one-off (invariant #5); only source_id cascades, so deleting a
      -- source never touches another source's or manual data.
      CREATE TABLE waste_imported_pickups (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id          INTEGER NOT NULL REFERENCES waste_sources(id) ON DELETE CASCADE,
        type_id            INTEGER NOT NULL REFERENCES waste_types(id),
        identity_key       TEXT    NOT NULL,
        external_uid       TEXT,
        original_summary   TEXT,
        date_key           TEXT    NOT NULL,
        tz_note            TEXT,
        created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE (source_id, identity_key)
      );
      CREATE TRIGGER trg_waste_imported_pickups_updated_at AFTER UPDATE ON waste_imported_pickups FOR EACH ROW BEGIN
        UPDATE waste_imported_pickups SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
      CREATE INDEX idx_waste_imported_pickups_source ON waste_imported_pickups(source_id);
      CREATE INDEX idx_waste_imported_pickups_type_date ON waste_imported_pickups(type_id, date_key);
    `,
  },
  {
    version: 202,
    description: 'Waste collection: automatic ICS URL sources (#1063 Phase 7)',
    // kind's CHECK only allowed 'file' (migration 199); widening it to add
    // 'url' needs the CREATE+COPY+DROP+RENAME rebuild pattern used elsewhere
    // in this file, since SQLite cannot ALTER an existing CHECK. The DROP
    // TABLE step would otherwise cascade-delete every waste_source_mappings/
    // waste_imported_pickups row through their ON DELETE CASCADE (the same
    // hazard noted at migration 52's dms_accounts rebuild) - foreignKeysOff
    // suspends FK enforcement for this migration only, and the framework's
    // own foreign_key_check afterward fails the migration if anything was
    // actually left dangling.
    foreignKeysOff: true,
    up(db) {
      db.exec(`
        CREATE TABLE waste_sources_new (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          kind                     TEXT    NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'url')),
          name                     TEXT    NOT NULL,
          content_hash             TEXT    NOT NULL,
          version                  INTEGER NOT NULL DEFAULT 1,
          coverage_start           TEXT,
          coverage_end             TEXT,
          last_import_at           TEXT,
          last_success_at          TEXT,
          last_error               TEXT,
          -- URL-only fields (NULL for kind='file'). url is the subscription
          -- credential (invariant: never expose it to a user without write
          -- access) - server/routes/waste/sources.js redacts it on read for
          -- read-only callers, the same way caldav-sync.js keeps a password
          -- out of its own list responses.
          url                      TEXT,
          etag                     TEXT,
          last_modified            TEXT,
          refresh_interval_minutes INTEGER NOT NULL DEFAULT 1440,
          next_attempt_at          TEXT,
          consecutive_failures     INTEGER NOT NULL DEFAULT 0,
          -- Set when an auto-refresh fetched new content but could not
          -- auto-commit (an unmapped label, or an unresolved blocking
          -- diagnostic - neither may be decided automatically). The
          -- scheduler skips a source while this is set; only a reviewed
          -- manual refresh (same mapping wizard as file re-import) clears it.
          needs_mapping            INTEGER NOT NULL DEFAULT 0 CHECK (needs_mapping IN (0, 1)),
          created_by               INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          updated_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );
        INSERT INTO waste_sources_new (
          id, kind, name, content_hash, version, coverage_start, coverage_end,
          last_import_at, last_success_at, last_error, created_by, created_at, updated_at
        )
        SELECT id, kind, name, content_hash, version, coverage_start, coverage_end,
               last_import_at, last_success_at, last_error, created_by, created_at, updated_at
        FROM waste_sources;
        DROP TABLE waste_sources;
        ALTER TABLE waste_sources_new RENAME TO waste_sources;
        CREATE TRIGGER trg_waste_sources_updated_at AFTER UPDATE ON waste_sources FOR EACH ROW BEGIN
          UPDATE waste_sources SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
        CREATE INDEX idx_waste_sources_name ON waste_sources(name);
        -- The scheduler's own "which sources are due" query (kind='url',
        -- needs_mapping=0, next_attempt_at due).
        CREATE INDEX idx_waste_sources_due ON waste_sources(kind, needs_mapping, next_attempt_at);
      `);
    },
  },
  {
    version: 203,
    description: 'Waste collection: per-user, per-type pickup reminders (#1063 Phase 8)',
    // Same reminders-table rebuild pattern as migrations 137/141/148/162/177/
    // 184/187 (widening entity_type's CHECK, which SQLite cannot ALTER) - this
    // is the eighth. foreignKeysOff IS load-bearing here (audit finding M-11
    // corrected this comment, which previously claimed otherwise):
    // notification_deliveries.reminder_id REFERENCES reminders(id) ON DELETE
    // CASCADE (see line ~2614) - without foreignKeysOff, this rebuild's own
    // `DROP TABLE reminders` would cascade-delete every row in
    // notification_deliveries, wiping delivery history for every reminder
    // that had ever actually been pushed, not just the ones this migration
    // touches.
    foreignKeysOff: true,
    up(db) {
      db.exec(`
        CREATE TABLE reminders_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT    NOT NULL CHECK(entity_type IN ('task', 'event', 'subscription', 'inventory_item', 'inventory_tracked_date', 'pantry_item', 'cycle_period', 'cycle_log_nudge', 'schedule_entry', 'schedule_extra_entry', 'waste_pickup')),
          entity_id   INTEGER NOT NULL,
          remind_at   TEXT    NOT NULL,
          dismissed   INTEGER NOT NULL DEFAULT 0,
          created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          pushed_at   TEXT,
          assigned_from INTEGER REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO reminders_new (id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at, assigned_from)
          SELECT id, entity_type, entity_id, remind_at, dismissed, created_by, created_at, pushed_at, assigned_from FROM reminders;
        DROP TABLE reminders;
        ALTER TABLE reminders_new RENAME TO reminders;
        CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);
        CREATE INDEX idx_reminders_remind ON reminders(remind_at);
        CREATE INDEX idx_reminders_user ON reminders(created_by);
        CREATE INDEX idx_reminders_assigned_from ON reminders(assigned_from);

        -- Per (user, waste type) opt-in: enabled defaults on once a row
        -- exists, but a row only exists once a user has touched this type's
        -- settings at all (GET .../reminder-settings synthesizes an
        -- all-disabled default for every type without a row - no household-
        -- wide default-on that would silently start pushing to someone).
        -- offset_days/delivery_time are this preference's own lead-time and
        -- household-local delivery time, independent of any other module's
        -- reminder settings (Schedule's users.schedule_reminder_offset_minutes
        -- is a single household-wide-shaped scalar; Waste needs one lead time
        -- PER TYPE PER USER, so it gets its own table instead of widening
        -- that column's meaning).
        CREATE TABLE waste_reminder_settings (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type_id       INTEGER NOT NULL REFERENCES waste_types(id) ON DELETE CASCADE,
          enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          offset_days   INTEGER NOT NULL DEFAULT 1,
          delivery_time TEXT    NOT NULL DEFAULT '08:00',
          created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          UNIQUE (user_id, type_id)
        );
        CREATE TRIGGER trg_waste_reminder_settings_updated_at AFTER UPDATE ON waste_reminder_settings FOR EACH ROW BEGIN
          UPDATE waste_reminder_settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;

        -- Anchor table (same purpose as schedule_reminder_entries/
        -- cycle_reminder_anchors): a Waste occurrence is computed on read,
        -- not a stored row, so reminders.entity_id has nothing stable to
        -- point at without this. One anchor per (user, type, date_key) -
        -- exactly the coalesced occurrence identity waste-domain.js already
        -- uses, so a moved/skipped/coalesced occurrence maps onto the same
        -- or a cleanly different anchor, never a duplicate.
        CREATE TABLE waste_reminder_entries (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type_id    INTEGER NOT NULL REFERENCES waste_types(id) ON DELETE CASCADE,
          date_key   TEXT    NOT NULL,
          created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          UNIQUE (user_id, type_id, date_key)
        );
        CREATE INDEX idx_waste_reminder_entries_user ON waste_reminder_entries(user_id);
      `);
    },
  },
  {
    version: 204,
    description: 'Waste collection: ordinal-weekday monthly schedules (#1063 Phase 9)',
    // recurrence_kind's CHECK only allowed 'weekly'/'monthly_fixed_day' -
    // widening it (and the compound CHECK below it) to add
    // 'monthly_ordinal_weekday' needs the same CREATE+COPY+DROP+RENAME rebuild
    // as every other CHECK-widening in this file. foreignKeysOff avoids the
    // DROP TABLE step cascade-deleting every waste_schedule_overrides row
    // through its own ON DELETE CASCADE (same hazard as migrations 52/202/203).
    //
    // NO NEW COLUMNS: an ordinal-weekday schedule reuses `weekdays` (exactly
    // one code, e.g. 'MO' - not the CSV list a weekly schedule stores) and
    // `month_day` (the ordinal position: -1 for "last", 1-4 for "nth" - its
    // own CHECK already allows exactly this range, since 1-4 sits inside the
    // existing "1 BETWEEN 1 AND 31" bound). `server/services/waste-domain.js`
    // is what gives these two columns their new, kind-dependent meaning;
    // `server/services/recurrence.js`'s own `bydayOrdinal` shape (added
    // earlier in this same phase) is what actually computes the date.
    foreignKeysOff: true,
    up(db) {
      db.exec(`
        CREATE TABLE waste_schedules_new (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          type_id          INTEGER NOT NULL REFERENCES waste_types(id),
          recurrence_kind  TEXT    NOT NULL CHECK (recurrence_kind IN ('weekly', 'monthly_fixed_day', 'monthly_ordinal_weekday')),
          anchor_date      TEXT    NOT NULL,
          interval         INTEGER NOT NULL DEFAULT 1 CHECK (interval BETWEEN 1 AND 52),
          weekdays         TEXT,
          month_day        INTEGER CHECK (month_day IS NULL OR month_day = -1 OR month_day BETWEEN 1 AND 31),
          valid_until      TEXT,
          active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          CHECK (
            (recurrence_kind = 'weekly' AND weekdays IS NOT NULL AND month_day IS NULL)
            OR (recurrence_kind = 'monthly_fixed_day' AND month_day IS NOT NULL AND weekdays IS NULL)
            OR (recurrence_kind = 'monthly_ordinal_weekday' AND month_day IS NOT NULL AND weekdays IS NOT NULL)
          )
        );
        INSERT INTO waste_schedules_new SELECT * FROM waste_schedules;
        DROP TABLE waste_schedules;
        ALTER TABLE waste_schedules_new RENAME TO waste_schedules;
        CREATE TRIGGER trg_waste_schedules_updated_at AFTER UPDATE ON waste_schedules FOR EACH ROW BEGIN
          UPDATE waste_schedules SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id; END;
        CREATE INDEX idx_waste_schedules_type_active ON waste_schedules(type_id, active);
      `);
    },
  },
  {
    version: 205,
    description: 'Waste collection: revocable read-only ICS feed (#1063 Phase 10)',
    // Same personal-token-over-household-content pattern as migrations 61
    // (calendar_feed_token), 144 (inventory_deadlines_feed_token) and 176
    // (schedule_feed_token): Waste types/schedules/pickups have no owner or
    // visibility column, so the FEED CONTENT stays household-wide, but the
    // TOKEN is per-user - a revoke costs exactly one subscription, not every
    // subscriber's.
    //
    // waste_feed_type_ids is a nullable JSON array of waste_types.id, stored
    // alongside the token (not as a query-string parameter on the public feed
    // URL): a subscription URL is meant to stay stable across edits, and
    // putting mutable selection state in the URL would force a new URL - and
    // therefore a broken existing subscription - every time the selection
    // changes. NULL means "every active type", mirroring the reminder
    // settings default (no row = not yet touched = show everything).
    up: `
      ALTER TABLE users ADD COLUMN waste_feed_token TEXT;
      ALTER TABLE users ADD COLUMN waste_feed_type_ids TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_waste_feed_token
        ON users(waste_feed_token)
        WHERE waste_feed_token IS NOT NULL;
    `,
  },
  {
    version: 206,
    description: 'Waste collection: index waste types in the global FTS5 search_index (#1063 Phase 10)',
    // Same trigger shape as migration 66 (medications/health_activities) and
    // 68 (shopping_items). Deliberately indexes ONLY waste_types (the finite,
    // stored catalog) - never anything waste-domain.js's expandSchedule()/
    // resolveOccurrences() computes at read time. Those occurrences are
    // unbounded (a weekly schedule has no last date until valid_until) and
    // never materialize as rows; indexing them would mean either truncating
    // the index at an arbitrary horizon or growing it forever. A concrete,
    // dated pickup (waste_one_off_pickups/waste_imported_pickups) is the one
    // other kind of stored, searchable Waste fact, but it has no independent
    // title of its own (its "title" IS the type name) and Phase 10 asks for
    // stable deep links to "types, sources, and concrete pickups" via the
    // existing occurrence list, not a second index entity - so only the type
    // catalog gets indexed here; concrete pickups are still reachable by
    // searching their type's name and confirmed present in the Upcoming list.
    up: `
      CREATE TRIGGER trg_search_waste_types_ai AFTER INSERT ON waste_types BEGIN
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('waste_type', NEW.id, COALESCE(NEW.name, ''), '');
      END;
      CREATE TRIGGER trg_search_waste_types_ad AFTER DELETE ON waste_types BEGIN
        DELETE FROM search_index WHERE entity = 'waste_type' AND entity_id = OLD.id;
      END;
      CREATE TRIGGER trg_search_waste_types_au AFTER UPDATE ON waste_types BEGIN
        DELETE FROM search_index WHERE entity = 'waste_type' AND entity_id = OLD.id;
        INSERT INTO search_index (entity, entity_id, title, body)
        VALUES ('waste_type', NEW.id, COALESCE(NEW.name, ''), '');
      END;

      INSERT INTO search_index (entity, entity_id, title, body)
        SELECT 'waste_type', id, COALESCE(name, ''), '' FROM waste_types;
    `,
  },
  {
    version: 207,
    description: 'Waste collection: covering index for per-source pickup-health lookups (audit finding, no data change)',
    // waste-store.js#decorateSourceHealth/listSources both run
    // `WHERE source_id = ? AND date_key >= ?` (single source) or
    // `WHERE date_key >= ? GROUP BY source_id` (every source) against
    // waste_imported_pickups - neither existing index covers that:
    // idx_waste_imported_pickups_source is source_id alone (no date_key), and
    // idx_waste_imported_pickups_type_date (migration 201) is keyed on
    // type_id, not source_id. Both queries fell back to the source-only
    // index plus a per-row filter - fine at today's row counts (measured
    // 18-36ms, see the audit report), a table scan by source count that grows
    // with import history otherwise. A new index alongside the old ones
    // (not a replacement - idx_waste_imported_pickups_source still serves
    // deleteSource's un-filtered "does this source have any rows" shape).
    up: `
      CREATE INDEX idx_waste_imported_pickups_source_date ON waste_imported_pickups(source_id, date_key);
    `,
  },
  {
    version: 208,
    description: 'Schedule: an explicit toggle to turn overtime tracking off entirely (UX audit S-24)',
    up: `
      -- NULL/1 = an (Vorgabe, kein stiller Verhaltenswechsel fuer Bestandshaushalte),





      ALTER TABLE users ADD COLUMN schedule_overtime_enabled INTEGER;
    `,
  },
];

function migrate() {

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      description TEXT    NOT NULL,
      applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );

  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));

  if (pending.length === 0) return;

  const runMigration = db.transaction((migration) => {
    if (typeof migration.up === 'function') {
      migration.up(db);
    } else {
      db.exec(migration.up);
    }

    if (typeof migration.afterUp === 'function') {
      migration.afterUp(db);
    }
    if (migration.foreignKeysOff) {
      const violations = db.pragma('foreign_key_check');
      if (violations.length > 0) {
        throw new Error(
          `Migration ${migration.version} left ${violations.length} foreign key violation(s).`
        );
      }
    }
    db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)')
      .run(migration.version, migration.description);
    log.info(`Migration ${migration.version} applied: ${migration.description}`);
  });

  for (const migration of pending) {
    if (!migration.foreignKeysOff) {
      runMigration(migration);
      continue;
    }

    db.pragma('foreign_keys = OFF');
    if (db.pragma('foreign_keys', { simple: true }) !== 0) {
      throw new Error(`Migration ${migration.version} could not disable foreign key enforcement.`);
    }
    try {
      runMigration(migration);
    } finally {
      db.pragma('foreign_keys = ON');
      if (db.pragma('foreign_keys', { simple: true }) !== 1) {
        throw new Error(`Migration ${migration.version} could not restore foreign key enforcement.`);
      }
    }
  }
}

function unknownMigrationVersions(database) {
  const known = new Set(MIGRATIONS.map((m) => m.version));
  return database
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => row.version)
    .filter((version) => !known.has(version));
}

function latestKnownVersion() {
  return Math.max(0, ...MIGRATIONS.map((m) => m.version));
}

function allowNewerSchema() {
  return /^(1|true|yes)$/i.test(String(process.env.DB_ALLOW_NEWER_SCHEMA || '').trim());
}

const CRITICAL_COLUMNS = [


  { table: 'reminders', column: 'pushed_at', type: 'TEXT' },


  { table: 'calendar_events', column: 'tzid', type: 'TEXT' },
];

function reconcileCriticalSchema(database = db) {
  if (!database) return;
  for (const { table, column, type } of CRITICAL_COLUMNS) {
    let columns;
    try {
      columns = database.prepare(`PRAGMA table_info(${table})`).all();
    } catch {
      continue;
    }
    if (!columns.length) continue;                          // Tabelle existiert nicht
    if (columns.some((c) => c.name === column)) continue;   // Spalte bereits vorhanden
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      log.warn(`Schema-Drift behoben: ${table}.${column} fehlte trotz vermerkter Migration und wurde nachgetragen (#538).`);
    } catch (err) {
      log.error(`Schema-Reconciliation ${table}.${column} fehlgeschlagen:`, err?.message || err);
    }
  }
}

function currentVersion() {
  if (!db) return 0;
  try {
    const row = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get();
    return row?.v ?? 0;
  } catch {
    return 0;
  }
}

function getPath() {
  return DB_PATH;
}

async function backupToFile(destinationPath) {
  const database = get();
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });

  if (DB_KEY) {

    // frisch angelegtes Ziel schreiben ("backup is not supported with




    await unlinkIfExists(destinationPath);
    database.prepare('VACUUM INTO ?').run(destinationPath);
  } else if (typeof database.backup === 'function') {
    await database.backup(destinationPath);
  } else {
    database.prepare('VACUUM INTO ?').run(destinationPath);
  }

  return destinationPath;
}

function validateBackupFile(sourcePath) {




  const encrypted = !isPlaintextDatabase(sourcePath);
  const candidate = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    if (encrypted) applyEncryptionKey(candidate);
    assertReadable(candidate);
    const row = candidate.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get();
    if (!row) {
      throw new Error('Backup file is not a valid Aashiyana database.');
    }



    const unknown = unknownMigrationVersions(candidate);
    if (unknown.length > 0) {
      throw new Error(
        `Backup was written by a newer Aashiyana (schema v${unknown[unknown.length - 1]}; this ` +
        `version knows up to v${latestKnownVersion()}). Update Aashiyana first, then restore.`
      );
    }
    return candidate.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version ?? 0;
  } finally {
    candidate.close();
  }
}

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

async function restoreFromFile(sourcePath) {
  const backupVersion = validateBackupFile(sourcePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackPath = `${DB_PATH}.pre-restore-${timestamp}`;
  let rollbackCreated = false;

  try {
    if (db) {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
      db.close();
      db = null;
    }

    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    try {
      await fs.copyFile(DB_PATH, rollbackPath);
      rollbackCreated = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }

    await unlinkIfExists(`${DB_PATH}-wal`);
    await unlinkIfExists(`${DB_PATH}-shm`);
    await fs.copyFile(sourcePath, DB_PATH);







    init({ plaintextBackup: false });
    log.info(`Database restored from backup. Schema v${backupVersion}${rollbackCreated ? ` | rollback: ${rollbackPath}` : ''}`);

    return {
      schemaVersion: currentVersion(),
      rollbackPath: rollbackCreated ? rollbackPath : null,
    };
  } catch (err) {
    if (rollbackCreated) {
      try {
        if (db) {
          db.close();
          db = null;
        }
        await unlinkIfExists(`${DB_PATH}-wal`);
        await unlinkIfExists(`${DB_PATH}-shm`);
        await fs.copyFile(rollbackPath, DB_PATH);
        init({ plaintextBackup: false });
      } catch (rollbackErr) {
        log.error('Rollback after failed restore also failed:', rollbackErr);
      }
    } else if (!db) {
      try { init({ plaintextBackup: false }); } catch { /* preserve original restore error */ }
    }
    throw err;
  }
}

// --------------------------------------------------------

// --------------------------------------------------------

function get() {
  if (!db) throw new Error('[DB] Not initialized - call init() first.');
  return db;
}

function transaction(fn) {
  return get().transaction(fn)();
}

let _originalDb = null;

/**
 * ONLY FOR TESTING: Override the internal db instance
 * @param {import('better-sqlite3-multiple-ciphers').Database} testDb
 */
function _setTestDatabase(testDb) {
  if (!_originalDb) _originalDb = db;
  db = testDb;
}

/**
 * ONLY FOR TESTING: Restore the original db instance
 */
function _resetTestDatabase() {
  if (_originalDb) {
    db = _originalDb;
    _originalDb = null;
  }
}

init();   // auto-initialise when module is first imported

export { init, get, transaction, currentVersion, getPath, backupToFile, restoreFromFile, unknownMigrationVersions, MIGRATIONS, reconcileCriticalSchema, _setTestDatabase, _resetTestDatabase };
