
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const dbmod = await import('../server/db.js');
const deadlinesIcs = await import('../server/services/inventory-deadlines-ics.js');
const { default: deadlinesFeedRouter } = await import('../server/routes/inventory/deadlines-feed.js');
const db = dbmod.get();



function setHouseholdLanguage(language) {
  db.prepare("INSERT INTO sync_config (key, value) VALUES ('language', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(language);
}

function insertItem(fields = {}) {
  const f = { name: 'Espressomaschine', purchase_date: null, warranty_months: null, ...fields };
  return db.prepare(`
    INSERT INTO inventory_items (name, purchase_date, warranty_months)
    VALUES (@name, @purchase_date, @warranty_months)
  `).run(f).lastInsertRowid;
}

// --------------------------------------------------------
// buildInventoryDeadlinesFeed
// --------------------------------------------------------

test('buildInventoryDeadlinesFeed enthält nur Gegenstände mit vollständigen Garantiedaten', () => {
  insertItem({ name: 'Mit Garantie', purchase_date: '2026-01-01', warranty_months: 12 });
  insertItem({ name: 'Ohne Kaufdatum', warranty_months: 12 });
  insertItem({ name: 'Ohne Garantiemonate', purchase_date: '2026-01-01' });

  setHouseholdLanguage('de');
  const ics = deadlinesIcs.buildInventoryDeadlinesFeed(db);
  const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(veventCount, 1);
  assert.match(ics, /SUMMARY:Garantie endet: Mit Garantie/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270101/);
});

test('buildInventoryDeadlinesFeed escaped Sonderzeichen im Namen', () => {
  db.exec('DELETE FROM inventory_items');
  insertItem({ name: 'Kaffee; Maschine, Pro', purchase_date: '2026-06-15', warranty_months: 6 });

  setHouseholdLanguage('de');
  const ics = deadlinesIcs.buildInventoryDeadlinesFeed(db);
  assert.match(ics, /SUMMARY:Garantie endet: Kaffee\\; Maschine\\, Pro/);
});

test('buildInventoryDeadlinesFeed überspringt unparsbare Kaufdaten statt den Feed zu sprengen', () => {
  db.exec('DELETE FROM inventory_items');



  insertItem({ name: 'Kaputtes Datum', purchase_date: '2026-02-30', warranty_months: 12 });
  insertItem({ name: 'Heiles Datum', purchase_date: '2026-01-01', warranty_months: 12 });

  const ics = deadlinesIcs.buildInventoryDeadlinesFeed(db);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(ics, /Heiles Datum/);
  assert.doesNotMatch(ics, /Kaputtes Datum/);
});

test('buildInventoryDeadlinesFeed liefert ein valides VCALENDAR-Gerüst auch ohne Gegenstände', () => {
  db.exec('DELETE FROM inventory_items');
  const ics = deadlinesIcs.buildInventoryDeadlinesFeed(db);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('buildInventoryDeadlinesFeed enthält ein VEVENT je getrackter Frist zusätzlich zu Garantien', () => {
  db.exec('DELETE FROM inventory_items');
  const itemId = insertItem({ name: 'Auto', purchase_date: '2026-01-01', warranty_months: 12 });
  db.prepare("INSERT INTO inventory_item_dates (item_id, label, date) VALUES (?, 'TÜV', '2027-03-01')").run(itemId);

  const ics = deadlinesIcs.buildInventoryDeadlinesFeed(db);
  const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(veventCount, 2, 'ein Garantie- und ein Fristen-VEVENT');
  assert.match(ics, /SUMMARY:Garantie endet: Auto/);
  assert.match(ics, /SUMMARY:TÜV: Auto/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270301/);
});

test('buildInventoryDeadlinesFeed erzeugt für einen Gegenstand ohne Garantie nur die Fristen-VEVENTs', () => {
  db.exec('DELETE FROM inventory_items');
  const itemId = insertItem({ name: 'Fahrrad' });
  db.prepare("INSERT INTO inventory_item_dates (item_id, label, date) VALUES (?, 'Wartung', '2027-05-01')").run(itemId);

  const ics = deadlinesIcs.buildInventoryDeadlinesFeed(db);
  const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(veventCount, 1);
  assert.match(ics, /SUMMARY:Wartung: Fahrrad/);
});

// --------------------------------------------------------
// Migration 144: Token-Spalte auf users
// --------------------------------------------------------

function insertUser(username, role = 'member') {
  return db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role)
    VALUES (?, ?, 'x', ?)
  `).run(username, username, role).lastInsertRowid;
}

const alice = insertUser('alice', 'admin');
const bob = insertUser('bob', 'member');

test('Migration 144 legt die Token-Spalte samt partiellem UNIQUE-Index an', () => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(cols.includes('inventory_deadlines_feed_token'));



  assert.equal(deadlinesIcs.getFeedToken(db, alice), null);
  assert.equal(deadlinesIcs.getFeedToken(db, bob), null);

  const token = deadlinesIcs.regenerateFeedToken(db, alice);
  assert.throws(
    () => db.prepare('UPDATE users SET inventory_deadlines_feed_token = ? WHERE id = ?').run(token, bob),
    /UNIQUE/i,
    'dasselbe Token darf nicht zweimal vergeben werden',
  );
  deadlinesIcs.clearFeedToken(db, alice);
});

// --------------------------------------------------------
// Token-Lebenszyklus (pro Nutzer)
// --------------------------------------------------------

test('Token-Lebenszyklus: null ohne Token, regenerate erzeugt, clear entfernt', () => {
  assert.equal(deadlinesIcs.getFeedToken(db, alice), null);

  const token = deadlinesIcs.regenerateFeedToken(db, alice);
  assert.ok(token && token.length > 20);
  assert.equal(deadlinesIcs.getFeedToken(db, alice), token);
  assert.equal(deadlinesIcs.findUserIdByFeedToken(db, token), alice);
  assert.equal(deadlinesIcs.findUserIdByFeedToken(db, 'wrong-token'), null);
  assert.equal(deadlinesIcs.findUserIdByFeedToken(db, null), null);

  const token2 = deadlinesIcs.regenerateFeedToken(db, alice);
  assert.notEqual(token2, token);
  assert.equal(deadlinesIcs.findUserIdByFeedToken(db, token), null, 'alter Token muss ungültig werden');

  deadlinesIcs.clearFeedToken(db, alice);
  assert.equal(deadlinesIcs.getFeedToken(db, alice), null);
  assert.equal(deadlinesIcs.findUserIdByFeedToken(db, token2), null);
});

test('Ein Rückzug trifft genau ein Abo, nicht alle', () => {


  const aliceToken = deadlinesIcs.regenerateFeedToken(db, alice);
  const bobToken = deadlinesIcs.regenerateFeedToken(db, bob);
  assert.notEqual(aliceToken, bobToken);

  deadlinesIcs.clearFeedToken(db, alice);
  assert.equal(deadlinesIcs.findUserIdByFeedToken(db, aliceToken), null);
  assert.equal(deadlinesIcs.findUserIdByFeedToken(db, bobToken), bob, 'Bobs Abo muss weiterlaufen');

  // Rotation ist genauso isoliert.
  const bobToken2 = deadlinesIcs.regenerateFeedToken(db, bob);
  assert.equal(deadlinesIcs.getFeedToken(db, alice), null);
  assert.equal(deadlinesIcs.findUserIdByFeedToken(db, bobToken2), bob);

  deadlinesIcs.clearFeedToken(db, bob);
});

test('Kalender- und Inventar-Token sind getrennte Instanzen desselben Musters', async () => {



  // ein gemeinsamer Schluessel fuer zwei Feeds geworden.
  const icsExport = await import('../server/services/ics-export.js');

  const calendarToken = icsExport.regenerateFeedToken(db, alice);
  const inventoryToken = deadlinesIcs.regenerateFeedToken(db, alice);
  assert.notEqual(calendarToken, inventoryToken);

  assert.equal(deadlinesIcs.findUserIdByFeedToken(db, calendarToken), null,
    'Kalender-Token darf den Inventar-Feed nicht oeffnen');
  assert.equal(icsExport.findUserIdByFeedToken(db, inventoryToken), null,
    'Inventar-Token darf den Kalender-Feed nicht oeffnen');


  deadlinesIcs.clearFeedToken(db, alice);
  assert.equal(icsExport.findUserIdByFeedToken(db, calendarToken), alice,
    'Inventar-Abo abschalten darf das Kalender-Abo nicht mitnehmen');

  icsExport.clearFeedToken(db, alice);
});

// --------------------------------------------------------
// Verwaltungs-Router
// --------------------------------------------------------

let actorId = alice;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.authUserId = actorId; next(); });
app.use('/inventory/deadlines-feed', deadlinesFeedRouter);
const server = app.listen(0);
const baseUrl = await new Promise((r) => server.on('listening', () => r(`http://127.0.0.1:${server.address().port}`)));
test.after(() => server.close());

async function call(method, path, { as = alice } = {}) {
  actorId = as;
  const res = await fetch(`${baseUrl}${path}`, { method });
  let json = null;
  try { json = await res.json(); } catch { /* leer */ }
  return { status: res.status, body: json };
}

test('GET /deadlines-feed liefert null ohne aktiven Feed', async () => {
  deadlinesIcs.clearFeedToken(db, alice);
  const r = await call('GET', '/inventory/deadlines-feed');
  assert.equal(r.status, 200);
  assert.equal(r.body.data, null);
});

test('POST /deadlines-feed/regenerate aktiviert den Feed, GET liefert ihn danach', async () => {
  const r = await call('POST', '/inventory/deadlines-feed/regenerate');
  assert.equal(r.status, 200);
  assert.ok(r.body.data.token);
  assert.match(r.body.data.url, /\/feed\/inventory-deadlines\/.+\.ics$/);

  const get = await call('GET', '/inventory/deadlines-feed');
  assert.equal(get.body.data.token, r.body.data.token);
});

test('DELETE /deadlines-feed deaktiviert den Feed', async () => {
  await call('POST', '/inventory/deadlines-feed/regenerate');
  const del = await call('DELETE', '/inventory/deadlines-feed');
  assert.equal(del.status, 200);
  assert.equal(del.body.data.token, null);

  const get = await call('GET', '/inventory/deadlines-feed');
  assert.equal(get.body.data, null);
});

test('Jeder Angemeldete verwaltet sein eigenes Token - auch Nicht-Admins', async () => {



  const bobRes = await call('POST', '/inventory/deadlines-feed/regenerate', { as: bob });
  assert.equal(bobRes.status, 200);
  assert.ok(bobRes.body.data.token);

  const aliceRes = await call('POST', '/inventory/deadlines-feed/regenerate', { as: alice });
  assert.notEqual(aliceRes.body.data.token, bobRes.body.data.token);


  const bobGet = await call('GET', '/inventory/deadlines-feed', { as: bob });
  assert.equal(bobGet.body.data.token, bobRes.body.data.token);


  await call('DELETE', '/inventory/deadlines-feed', { as: alice });
  const bobStill = await call('GET', '/inventory/deadlines-feed', { as: bob });
  assert.equal(bobStill.body.data.token, bobRes.body.data.token, 'Bobs Abo muss Alices DELETE ueberleben');

  await call('DELETE', '/inventory/deadlines-feed', { as: bob });
});

test('Feed-Texte folgen der Haushaltssprache statt fest deutsch zu sein', () => {
  db.exec('DELETE FROM inventory_items');
  insertItem({ name: 'Espressomaschine', purchase_date: '2026-01-01', warranty_months: 12 });

  setHouseholdLanguage('de');
  const de = deadlinesIcs.buildInventoryDeadlinesFeed(db);
  assert.match(de, /X-WR-CALNAME:Aashiyana Inventar/);
  assert.match(de, /SUMMARY:Garantie endet: Espressomaschine/);

  setHouseholdLanguage('en');
  const en = deadlinesIcs.buildInventoryDeadlinesFeed(db);
  assert.match(en, /X-WR-CALNAME:Aashiyana Inventory/);
  assert.match(en, /SUMMARY:Warranty ends: Espressomaschine/);
});
