import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import Database from 'better-sqlite3-multiple-ciphers';
import express from 'express';

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'task-scope-test-secret';

const { MIGRATIONS, get, _setTestDatabase } = await import('../server/db.js');
const { default: tasksRouter } = await import('../server/routes/tasks.js');
const { default: dashboardRouter } = await import('../server/routes/dashboard.js');
const { taskScopeWhere, taskScopeNeedsToday } = await import('../server/services/task-scope.js');

const moduleDatabase = get();
const db = buildMigratedDatabase(MIGRATIONS);
_setTestDatabase(db);
moduleDatabase.close();

function buildMigratedDatabase(migrations) {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);
  for (const migration of migrations) {
    if (typeof migration.up === 'function') migration.up(database);
    else database.exec(migration.up);
    if (typeof migration.afterUp === 'function') migration.afterUp(database);
    database.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)')
      .run(migration.version, migration.description);
  }
  return database;
}




const now = new Date();
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const TODAY = localKey(now);
const TOMORROW = addDays(1);
const NEXT_WEEK = addDays(7);
const YESTERDAY = addDays(-1);

const ALICE = db.prepare(`
  INSERT INTO users (username, display_name, password_hash, avatar_color, role)
  VALUES (?, 'Alice', 'hash', '#007AFF', 'admin')
`).run(`alice-${randomUUID()}`).lastInsertRowid;

// --------------------------------------------------------------------------



// --------------------------------------------------------------------------
const insertTask = db.prepare(`
  INSERT INTO tasks (title, priority, status, due_date, start_date, parent_task_id, visibility, created_by)
  VALUES (?, 'high', 'open', ?, ?, ?, 'all', ?)
`);

const PARENT_ID = insertTask.run('Umzug vorbereiten', TODAY, null, null, ALICE).lastInsertRowid;
const SUBTASK_ID = insertTask.run('Kartons kaufen', TODAY, null, PARENT_ID, ALICE).lastInsertRowid;
const FUTURE_ID = insertTask.run('Erst nächste Woche', TODAY, NEXT_WEEK, null, ALICE).lastInsertRowid;
const STARTED_ID = insertTask.run('Läuft seit gestern', TODAY, YESTERDAY, null, ALICE).lastInsertRowid;




const parentDone = insertTask.run('Küche streichen', TODAY, null, null, ALICE).lastInsertRowid;
const doneSubtask = insertTask.run('Farbe besorgen', TODAY, null, parentDone, ALICE).lastInsertRowid;
db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(doneSubtask);

// --------------------------------------------------------------------------
// Beide echten Router am selben Bestand.
// --------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.authUserId = ALICE;
  req.authRole = 'admin';
  req.session = { userId: ALICE, role: 'admin' };
  req.sessionModuleAccess = null;
  next();
});
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/dashboard', dashboardRouter);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/api/v1`;

test.after(() => { server.close(); db.close(); });

const moduleTasks = async (query = '') => (await (await fetch(`${base}/tasks${query}`)).json()).data;
const dashboard = async (query = '') => (await fetch(`${base}/dashboard${query}`)).json();

// --------------------------------------------------------------------------



// --------------------------------------------------------------------------
test('Vorbedingung: beide Wege liefern überhaupt Aufgaben, und die normale ist in beiden', async () => {
  const listed = await moduleTasks();
  const body = await dashboard();

  assert.ok(listed.some((t) => t.id === PARENT_ID), 'das Modul listet die gewöhnliche Aufgabe');
  assert.ok(body.urgentTasks.some((t) => t.id === PARENT_ID), 'die Übersicht zeigt die gewöhnliche Aufgabe');
  assert.ok(body.urgentTasks.length > 0, 'die Übersicht ist nicht generell leer');
});

// --------------------------------------------------------------------------



// --------------------------------------------------------------------------
test('Übersicht und Modul treffen dieselbe Auswahl', async () => {
  const listedIds = new Set((await moduleTasks()).map((t) => t.id));
  const body = await dashboard();

  for (const task of body.urgentTasks) {
    assert.ok(
      listedIds.has(task.id),
      `Die Übersicht zeigt "${task.title}" (id ${task.id}), das Aufgabenmodul listet sie nicht - `
      + 'die beiden Auswahlregeln sind auseinandergelaufen (#825).',
    );
  }
});

test('Eine Unteraufgabe ist kein eigener Eintrag der Übersicht', async () => {
  const body = await dashboard();
  assert.ok(
    !body.urgentTasks.some((t) => t.id === SUBTASK_ID),
    'die Unteraufgabe stand ohne die Aufgabe, zu der sie gehört, als eigene Zeile in der Übersicht',
  );
});

test('Was erst später beginnt, steht heute in keiner der beiden Listen', async () => {
  const listed = await moduleTasks();
  const body = await dashboard();

  assert.ok(!listed.some((t) => t.id === FUTURE_ID), 'Vorbedingung: das Modul blendet sie aus');
  assert.ok(
    !body.urgentTasks.some((t) => t.id === FUTURE_ID),
    'die erst nächste Woche beginnende Aufgabe stand schon heute in der Übersicht',
  );
  assert.ok(
    body.urgentTasks.some((t) => t.id === STARTED_ID),
    'eine bereits begonnene Aufgabe muss bleiben - sonst filtert die Regel zu scharf',
  );
});

// --------------------------------------------------------------------------



// --------------------------------------------------------------------------
test('Die Kennzahlen zählen dieselbe Grundgesamtheit wie die Liste', async () => {
  const body = await dashboard();
  const listed = await moduleTasks();
  const openInModule = listed.filter((t) => t.status !== 'done').length;

  assert.equal(
    body.openTaskCount, openInModule,
    'die Kachel „offen" zählt andere Aufgaben, als das Modul listet - Unteraufgaben oder '
    + 'noch nicht begonnene laufen in der Zahl mit',
  );
  assert.equal(body.tasksDoneToday, 0, 'eine abgehakte Unteraufgabe ist keine eigene Tagesleistung');
});

// --------------------------------------------------------------------------



// Syntaxfehler statt einer falschen Antwort.
// --------------------------------------------------------------------------
test('Das Scope-Fragment bleibt in jeder Kombination verkettbar', () => {
  const combos = [
    {}, { includeFuture: true }, { includeSubtasks: true },
    { includeFuture: true, includeSubtasks: true },
  ];
  for (const opts of combos) {
    const sql = taskScopeWhere('t', opts);
    assert.ok(sql.trim().length > 0, `leeres Fragment für ${JSON.stringify(opts)}`);
    db.prepare(`SELECT COUNT(*) AS n FROM tasks t WHERE ${sql}`).get(
      ...(taskScopeNeedsToday(opts) ? [TODAY] : []),
    );
  }
});

test('Der Tagesschlüssel wird gebunden, nicht aus SQLite genommen', () => {


  const sql = taskScopeWhere('t', { bind: '@today' });
  const count = (today) => db.prepare(`SELECT COUNT(*) AS n FROM tasks t WHERE ${sql}`).get({ today }).n;

  assert.ok(count(NEXT_WEEK) > count(TOMORROW), 'ein späterer Stichtag muss mehr Aufgaben einschließen');
  assert.ok(!taskScopeNeedsToday({ includeFuture: true }), 'ohne Startdatum-Filter ist kein Bind fällig');
});

// --------------------------------------------------------------------------
// Widget-Optionen (#814): dieselbe Einschraenkung, dieselbe Antwort.
//





// --------------------------------------------------------------------------
const GARDEN = 'garden-scope-test';
const OFFICE = 'office-scope-test';
db.prepare('INSERT INTO task_categories (key, name, sort_order) VALUES (?, ?, ?), (?, ?, ?)')
  .run(GARDEN, 'Garten', 90, OFFICE, 'Buero', 91);
const insertCategorized = db.prepare(`
  INSERT INTO tasks (title, priority, status, due_date, category, visibility, created_by)
  VALUES (?, 'high', 'open', ?, ?, 'all', ?)
`);
insertCategorized.run('Hecke schneiden', TODAY, GARDEN, ALICE);
insertCategorized.run('Rasen maehen', TODAY, GARDEN, ALICE);
insertCategorized.run('Steuer sortieren', TODAY, OFFICE, ALICE);

test('Kategorie-Einschraenkung: Modul und Uebersicht treffen dieselbe Auswahl', async () => {
  const fromModule = (await moduleTasks(`?category=${GARDEN}`)).map((t) => t.title).sort();
  const fromDashboard = (await dashboard(`?tasks_category=${GARDEN}`)).urgentTasks.map((t) => t.title).sort();
  assert.deepEqual(fromDashboard, fromModule);
  assert.ok(fromModule.includes('Hecke schneiden'));
  assert.ok(!fromModule.includes('Steuer sortieren'));
});

test('Mehrere Kategorien verbinden sich ODER, auf beiden Seiten', async () => {


  const fromModule = await moduleTasks(`?category=${GARDEN}&category=${OFFICE}`);
  const titles = fromModule.map((t) => t.title).sort();
  assert.deepEqual(titles, ['Hecke schneiden', 'Rasen maehen', 'Steuer sortieren']);
  const fromDashboard = (await dashboard(`?tasks_category=${GARDEN}&tasks_category=${OFFICE}`))
    .urgentTasks.map((t) => t.title).sort();
  assert.deepEqual(fromDashboard, titles);
});

test('Die Kennzahlen der Uebersicht zaehlen die eingeschraenkte Menge, nicht alles', async () => {
  const all = await dashboard();
  const garden = await dashboard(`?tasks_category=${GARDEN}`);
  assert.equal(garden.openTaskCount, 2, 'die Kachel zaehlt an der Einschraenkung vorbei');
  assert.ok(all.openTaskCount > garden.openTaskCount,
    'ohne Einschraenkung muessen es mehr sein - sonst misst der Test nichts');

  // Grundgesamtheit meinen.
  assert.equal(garden.urgentTasks.length, garden.openTaskCount);
});

test('Eine leere oder unbekannte Auswahl leert die Uebersicht nicht', async () => {


  // Dialog geoeffnet hat.
  const empty = await dashboard('?tasks_category=');
  const all = await dashboard();
  assert.equal(empty.openTaskCount, all.openTaskCount);

  assert.equal((await dashboard('?tasks_category=gibtesnicht')).openTaskCount, 0);
});

// --------------------------------------------------------------------------

// Kalendermodul (`belongsToMe` in public/pages/calendar.js).
// --------------------------------------------------------------------------
const BOB = db.prepare(`
  INSERT INTO users (username, display_name, password_hash, avatar_color, role)
  VALUES (?, 'Bob', 'hash', '#34C759', 'member')
`).run(`bob-${randomUUID()}`).lastInsertRowid;

const insertEvent = db.prepare(`
  INSERT INTO calendar_events (title, start_datetime, end_datetime, all_day, visibility, created_by)
  VALUES (?, ?, ?, 0, 'all', ?)
`);
const MINE_EVENT = insertEvent.run('Zahnarzt', `${TOMORROW}T09:00`, `${TOMORROW}T10:00`, ALICE).lastInsertRowid;
const HIS_EVENT = insertEvent.run('Bobs Training', `${TOMORROW}T11:00`, `${TOMORROW}T12:00`, ALICE).lastInsertRowid;
const NOBODYS_EVENT = insertEvent.run('Muellabfuhr', `${TOMORROW}T13:00`, `${TOMORROW}T14:00`, ALICE).lastInsertRowid;
db.prepare('INSERT INTO event_assignments (event_id, user_id) VALUES (?, ?)').run(MINE_EVENT, ALICE);
db.prepare('INSERT INTO event_assignments (event_id, user_id) VALUES (?, ?)').run(HIS_EVENT, BOB);

test('Termine ohne Einschraenkung: alle drei stehen da', async () => {
  const titles = (await dashboard()).upcomingEvents.map((e) => e.title);
  for (const title of ['Zahnarzt', 'Bobs Training', 'Muellabfuhr']) {
    assert.ok(titles.includes(title), `${title} fehlt - der Test misst sonst nichts`);
  }
});

test('events_scope=mine zeigt nur, was mir zugewiesen ist', async () => {
  const titles = (await dashboard('?events_scope=mine')).upcomingEvents.map((e) => e.title);
  assert.deepEqual(titles, ['Zahnarzt']);



  assert.ok(!titles.includes('Muellabfuhr'));
});

test('Die Termin-Einschraenkung wirkt vor der Deckelung', async () => {
  // Sechs fremde Termine VOR meinem: gefiltert wuerde nachtraeglich innerhalb

  for (let i = 0; i < 6; i++) {
    insertEvent.run(`Fremdtermin ${i}`, `${TOMORROW}T0${i}:30`, `${TOMORROW}T0${i}:45`, ALICE);
  }
  const titles = (await dashboard('?events_scope=mine')).upcomingEvents.map((e) => e.title);
  assert.deepEqual(titles, ['Zahnarzt'], 'der eigene Termin ist hinter der Deckelung verschwunden');
});

// --------------------------------------------------------------------------


// --------------------------------------------------------------------------
const insertAllDay = db.prepare(`
  INSERT INTO calendar_events (title, start_datetime, end_datetime, all_day, visibility, created_by)
  VALUES (?, ?, ?, 1, 'all', ?)
`);
const insertBirthday = db.prepare(`
  INSERT INTO birthdays (name, birth_date, calendar_event_id, created_by) VALUES (?, ?, ?, ?)
`);
test('Vorbedingung: ohne Parameter fuellen die Geburtstage das Termin-Widget', async () => {
  for (const name of ['Hartmut', 'Lars', 'Mira', 'Ove', 'Rosa']) {
    const eventId = insertAllDay.run(`Geburtstag: ${name}`, TOMORROW, TOMORROW, ALICE).lastInsertRowid;
    insertBirthday.run(name, '1980-01-01', eventId, ALICE);
  }
  const events = (await dashboard()).upcomingEvents;
  assert.equal(events.length, 5, 'die Route deckelt bei fuenf - sonst misst der Test unten nichts');
  assert.ok(events.every((e) => e.birthday_name),
    `es sollen ausschliesslich Geburtstage sein: ${events.map((e) => e.title).join(', ')}`);
});

test('events_birthdays=hide nimmt die Geburtstage heraus - VOR der Deckelung', async () => {
  const events = (await dashboard('?events_birthdays=hide')).upcomingEvents;
  assert.ok(events.every((e) => !e.birthday_name),
    `Geburtstag durchgerutscht: ${events.map((e) => e.title).join(', ')}`);



  assert.equal(events.length, 5, 'die Geburtstage wurden erst nach der Deckelung entfernt');
});

test('Erkannt wird der Geburtstag am Modul-Eintrag, nicht an seinem Titel', async () => {



  // englischsprachigen Haushalt umgekehrt keinen einzigen echten gefunden,

  insertEvent.run('Geburtstag: Deko kaufen', `${TOMORROW}T00:05`, `${TOMORROW}T00:15`, ALICE);
  const titles = (await dashboard('?events_birthdays=hide')).upcomingEvents.map((e) => e.title);
  assert.ok(titles.includes('Geburtstag: Deko kaufen'),
    `am Titel statt am Eintrag gefiltert: ${titles.join(', ')}`);
});

test('Ohne den Parameter bleibt alles, wie es war', async () => {


  // nichts (er koennte sonst als Abwahl durchgehen).
  for (const query of ['', '?events_birthdays=show', '?events_birthdays=']) {
    const events = (await dashboard(query)).upcomingEvents;
    assert.ok(events.some((e) => e.birthday_name), `Geburtstage fehlen bei "${query}"`);
  }
});
