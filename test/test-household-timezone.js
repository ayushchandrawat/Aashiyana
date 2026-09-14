process.env.TZ = 'America/Toronto';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  householdTimeZone, isValidTimeZone, serverTimeZone, shiftDateKey,
  storedToInstantMs, todayKey,
} = await import('../server/utils/timezone.js');

const dbmod = await import('../server/db.js');
const db = dbmod.get();

const setZone = (value) => {
  if (value === null) db.prepare("DELETE FROM sync_config WHERE key = 'household_timezone'").run();
  else db.prepare(`INSERT INTO sync_config (key, value) VALUES ('household_timezone', ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(value);
};

// --------------------------------------------------------
// Die Kette
// --------------------------------------------------------

test('householdTimeZone: die Einstellung schlaegt TZ', () => {
  setZone('Asia/Tokyo');
  assert.equal(householdTimeZone(db), 'Asia/Tokyo');


  setZone(null);
  assert.equal(householdTimeZone(db), 'America/Toronto');
});

test('householdTimeZone: ohne Verbindung bleibt es bei der Umgebung', () => {
  setZone('Asia/Tokyo');


  assert.equal(householdTimeZone(null), 'America/Toronto');
  assert.equal(householdTimeZone(undefined), 'America/Toronto');
  setZone(null);
});

test('householdTimeZone: eine unbekannte Zone in der DB faellt zurueck, statt zu werfen', () => {



  setZone('Mars/Olympus_Mons');
  assert.equal(householdTimeZone(db), 'America/Toronto');
  setZone(null);
});

test('serverTimeZone: ein ungueltiges TZ faellt auf die Systemzone', () => {
  const prev = process.env.TZ;
  try {
    process.env.TZ = 'Nicht/EineZone';
    const zone = serverTimeZone();
    assert.ok(isValidTimeZone(zone), `Rueckfall muss eine gueltige Zone sein, war "${zone}"`);
  } finally { process.env.TZ = prev; }
});

test('isValidTimeZone: kennt Aliase, weist Unsinn ab', () => {
  assert.ok(isValidTimeZone('Europe/Berlin'));
  assert.ok(isValidTimeZone('UTC'));
  // Alias statt kanonischem Namen: `Intl.supportedValuesOf` fuehrt ihn NICHT,

  assert.ok(isValidTimeZone('Europe/Kiev'));
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(null), false);
  assert.equal(isValidTimeZone(42), false);
});

// --------------------------------------------------------
// todayKey
// --------------------------------------------------------

test('todayKey: der Kalendertag der Haushaltszone, nicht der UTC-Tag', () => {



  const now = new Date('2026-08-22T02:00:00Z');
  setZone('America/Toronto');
  assert.equal(todayKey(db, now), '2026-08-21');

  assert.equal(now.toISOString().slice(0, 10), '2026-08-22');


  setZone('Asia/Tokyo');
  assert.equal(todayKey(db, new Date('2026-08-21T20:00:00Z')), '2026-08-22');
  setZone(null);
});

test('shiftDateKey: verschiebt Kalendertage, nicht 24-Stunden-Bloecke', () => {
  assert.equal(shiftDateKey('2026-08-21', 1), '2026-08-22');
  assert.equal(shiftDateKey('2026-08-21', -1), '2026-08-20');
  assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');


  assert.equal(shiftDateKey('2026-03-29', 1), '2026-03-30');
  assert.equal(shiftDateKey('kaputt', 1), 'kaputt');
});

// --------------------------------------------------------

// --------------------------------------------------------

test('storedToInstantMs: zonenlose Wanduhrzeit wird in der Haushaltszone gelesen', () => {


  assert.equal(
    storedToInstantMs('2026-08-21T19:00', 'America/Toronto'),
    Date.parse('2026-08-21T23:00:00Z'),
  );
  assert.equal(
    storedToInstantMs('2026-08-21T19:00:00', 'America/Toronto'),
    Date.parse('2026-08-21T23:00:00Z'),
  );
});

test('storedToInstantMs: ein Wert mit eigener Zone bleibt sein Zeitpunkt', () => {
  const expected = Date.parse('2026-08-21T23:00:00Z');
  assert.equal(storedToInstantMs('2026-08-21T19:00:00-04:00', 'Asia/Tokyo'), expected);
  assert.equal(storedToInstantMs('2026-08-21T23:00:00Z', 'Asia/Tokyo'), expected);
});

test('storedToInstantMs: ein reines Datum beginnt um Mitternacht der Zone', () => {
  assert.equal(
    storedToInstantMs('2026-08-21', 'America/Toronto'),
    Date.parse('2026-08-21T04:00:00Z'),
  );
  assert.equal(storedToInstantMs('', 'UTC'), null);
  assert.equal(storedToInstantMs(null, 'UTC'), null);
});

test('storedToInstantMs: der Stringvergleich, den er ersetzt, war falsch', () => {



  const local = '2026-08-21T21:00';
  const nowIso = '2026-08-22T00:00:00.000Z';
  assert.ok(local < nowIso, 'Voraussetzung: der Stringvergleich sortiert ihn nach hinten');
  assert.ok(
    storedToInstantMs(local, 'America/Toronto') > Date.parse(nowIso),
    'Der Zeitpunktvergleich stellt ihn richtig',
  );
});

// --------------------------------------------------------

// --------------------------------------------------------

const { getUpcomingEvents } = await import('../server/services/calendar-event-reader.js');

db.prepare(`INSERT INTO users (username, display_name, password_hash, role)
            VALUES ('admin','Admin','x','admin')`).run();

test('getUpcomingEvents: der Abendtermin von heute bleibt drin, wenn UTC schon morgen ist', () => {
  setZone('America/Toronto');



  // vertreten, weil der Stringvergleich genau zwischen ihnen brach.
  const rows = [
    ['Lokal 21:00', '2026-08-21T21:00', 0],              // zonenlose Wanduhrzeit
    ['Google 22:00', '2026-08-21T22:00:00-04:00', 0],    // Instant mit Offset
    ['Ganztags heute', '2026-08-21', 1],                 // reines Datum
  ];
  for (const [title, start, allDay] of rows) {
    db.prepare(`INSERT INTO calendar_events (title, start_datetime, all_day, created_by)
                VALUES (?, ?, ?, 1)`).run(title, start, allDay);
  }





  const now = new Date('2026-08-22T00:30:00Z'); // 20:30 Ortszeit in Toronto
  const titles = getUpcomingEvents(db, { userId: 1, limit: 10, fromToday: true, now })
    .map((e) => e.title);

  assert.deepEqual(titles.sort(), ['Ganztags heute', 'Google 22:00', 'Lokal 21:00'],
    'alle drei Formen muessen im Fenster bleiben');



  // nichts filterte.
  assert.equal(new Date('2026-08-22T00:30:00Z').toISOString().slice(0, 10), '2026-08-22');
  assert.ok(
    ['2026-08-21T21:00', '2026-08-21T22:00:00-04:00', '2026-08-21'].every(
      (start) => start < '2026-08-22T00:00:00'
    ),
    'alle drei lagen unter der UTC-Tagesgrenze und fielen deshalb heraus',
  );

  db.prepare("DELETE FROM calendar_events").run();
  setZone(null);
});

// --------------------------------------------------------

// --------------------------------------------------------

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SERVER_DIR = path.join(ROOT, 'server');

function serverFiles(dir = SERVER_DIR) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...serverFiles(full));
    else if (/\.js$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file);

test('Guard: nur timezone.js ruft serverTimeZone() direkt', () => {



  const offenders = serverFiles()
    .filter((file) => !file.endsWith(path.join('utils', 'timezone.js')))
    .filter((file) => /\bserverTimeZone\s*\(/.test(readFileSync(file, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, [],
    `Diese Dateien muessen householdTimeZone(<db>) nehmen: ${offenders.join(', ')}`);
});

test('Guard: kein Server-Modul leitet "heute" aus toISOString() ab', () => {





  const NOW_TO_DAY = /new Date\(\s*\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;
  const offenders = serverFiles()
    .filter((file) => !file.endsWith(path.join('utils', 'timezone.js')))
    .filter((file) => NOW_TO_DAY.test(readFileSync(file, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, [],
    `Diese Dateien bilden "heute" aus dem UTC-Tag: ${offenders.join(', ')}`);
});

test('Guard: der null-Rueckfall steht nur als Default-Parameter', () => {
  // `householdTimeZone(null)` / `todayKey(null)` ueberspringen die Einstellung







  //







  //




  // 2026-09-09: `todayKey(database, from)` -> `todayKey(null, from)` an




  // solche Aufrufstellen (schedule-reminders, cycle-reminders, cycle-ics,
  // calendar-events, pantry-reminders zweimal, birthdays zweimal) - gezaehlt,
  // nicht geschaetzt.
  const CALL = /(?:householdTimeZone|todayKey)\s*\(\s*null\s*[,)]/;
  const DECLARES_FN = /\bfunction\b|=>/;
  const offenders = [];
  for (const file of serverFiles()) {
    if (file.endsWith(path.join('utils', 'timezone.js'))) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (CALL.test(line) && !DECLARES_FN.test(line)) offenders.push(`${rel(file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [],
    `Diese Stellen umgehen die Einstellung: ${offenders.join(', ')}`);


  const bad = 'const tz = householdTimeZone(null);';
  assert.ok(CALL.test(bad) && !DECLARES_FN.test(bad), 'ein Rumpf-Aufruf muss auffallen');
  const good = 'function dueField(date, time, tz = householdTimeZone(null)) {';
  assert.ok(CALL.test(good) && DECLARES_FN.test(good), 'ein Default darf durchgehen');





  const badTwoArg = 'const key = todayKey(null, from);';
  assert.ok(CALL.test(badTwoArg) && !DECLARES_FN.test(badTwoArg),
    'auch zweiargumentig muss ein Rumpf-Aufruf auffallen');
});

test('Guard: der Outlook-Push traegt keine fest verdrahtete Zone mehr', () => {



  const source = readFileSync(path.join(SERVER_DIR, 'services', 'outlook-calendar.js'), 'utf8');
  const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/'Europe\/Berlin'|"Europe\/Berlin"/.test(code), false,
    'outlook-calendar.js enthaelt wieder eine feste Zone');
});

test('Guard: der Guard erkennt den Schaden, gegen den er gebaut ist', () => {


  const NOW_TO_DAY = /new Date\(\s*\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;
  assert.ok(NOW_TO_DAY.test('const today = new Date().toISOString().slice(0, 10);'));
  assert.ok(NOW_TO_DAY.test('x = new Date().toISOString().slice(0,10)'));

  assert.equal(NOW_TO_DAY.test('new Date(ms + days * 86400000).toISOString().slice(0, 10)'), false);
  assert.ok(/\bserverTimeZone\s*\(/.test('const tz = serverTimeZone();'));
  assert.equal(/\bserverTimeZone\s*\(/.test('import { householdTimeZone } from "x";'), false);
});
