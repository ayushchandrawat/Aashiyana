
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import Database from 'better-sqlite3-multiple-ciphers';
import { MIGRATIONS, _setTestDatabase, _resetTestDatabase } from '../server/db.js';
import { sync, getForRange, getCountries, getSubdivisions, getGroups, __setFetchImpl, __test } from '../server/services/holidays.js';

const { localHolidayFallback } = __test;


const namesAndDates = (year, country, subdivision) =>
  localHolidayFallback(country, 'public', year, 'EN', subdivision)
    .map((h) => `${h.startDate} ${h.name}`)
    .sort();


function buildTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
  for (const m of MIGRATIONS) {
    if (typeof m.up === 'function') m.up(db); else db.exec(m.up);
    if (typeof m.afterUp === 'function') m.afterUp(db);
    db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)').run(m.version, m.description);
  }
  return db;
}

const db = buildTestDb();
_setTestDatabase(db);

// ---- Helpers ----------------------------------------------------------------

function resetState() {
  db.prepare("DELETE FROM sync_config WHERE key LIKE 'holiday_%'").run();




  db.prepare("DELETE FROM sync_config WHERE key IN ('language', 'region')").run();
  db.prepare('DELETE FROM holiday_cache').run();
}

function setConfig(cfg) {
  const set = db.prepare(`INSERT INTO sync_config (key, value) VALUES (?, ?)
                          ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const [k, v] of Object.entries(cfg)) {
    if (v === undefined || v === null) continue;
    set.run(k, String(v));
  }
}

function seedHoliday({ type, country = 'DE', subdivision = null, group = null, start, end, name = 'Test', year }) {
  db.prepare(`INSERT INTO holiday_cache (type, country, subdivision, start_date, end_date, name, year, group_code)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(type, country, subdivision, start, end, name, year ?? Number(start.slice(0, 4)), group);
}

const okJson = (data) => ({ ok: true, json: async () => data });




// leere info-Liste beweist: nichts landet im Standard-Log-Level.
async function captureConsole(fn) {
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const lines = { log: [], info: [], warn: [], error: [] };
  for (const level of Object.keys(original)) {
    console[level] = (...args) => lines[level].push(args.join(' '));
  }
  try {
    await fn();
  } finally {
    Object.assign(console, original);
  }
  return lines;
}


function makeApiMock() {
  const calls = [];
  const fn = async (url) => {
    const s = String(url);
    calls.push(s);
    const path = new URL(s).pathname;
    const country = new URL(s).searchParams.get('countryIsoCode');
    if (path === '/PublicHolidays') {



      if (['BR', 'US', 'CA', 'GB', 'AU', 'NZ'].includes(country)) return okJson([]);




      if (country === 'ES') {
        return okJson([
          { startDate: '2026-12-25', endDate: '2026-12-25',
            name: [
              { language: 'ES', text: 'Navidad' },
              { language: 'CA', text: 'Nadal' },
              { language: 'EN', text: 'Christmas Day' },
              { language: 'DE', text: 'Weihnachtstag' },
            ] },
          { startDate: '2026-01-06', endDate: '2026-01-06',
            name: [
              { language: 'ES', text: 'Reyes' },
              { language: 'CA', text: 'Reis' },
            ] },




          { startDate: '2026-05-01', endDate: '2026-05-01',
            name: [
              { language: 'ES', text: 'Fiesta del Trabajo' },
              { language: 'CA', text: 'Festa del Treball' },
              { language: 'EN', text: 'Labour Day' },
            ] },
        ]);
      }
      return okJson([{ startDate: '2026-01-01', endDate: '2026-01-01',
        name: [{ language: 'DE', text: 'Neujahr' }, { language: 'EN', text: "New Year's Day" }] }]);
    }
    if (path === '/SchoolHolidays') {


      // faelschlich deutsche Sommerferien fuer z. B. die USA zurueckgeben.
      if (['BR', 'US', 'CA', 'GB', 'AU', 'NZ'].includes(country)) return okJson([]);
      return okJson([
        { startDate: '2026-07-20', endDate: '2026-08-30',
          name: [{ language: 'DE', text: 'Sommerferien' }, { language: 'EN', text: 'Summer break' }] },


        { startDate: '2026-07-20', endDate: '2026-08-23', tags: ['Exception'],
          name: [{ language: 'DE', text: 'Sommerferien' }, { language: 'EN', text: 'Summer break' }] },
      ]);
    }
    if (path === '/Countries') {
      return okJson([
        { isoCode: 'DE', name: [{ language: 'EN', text: 'Germany' }, { language: 'DE', text: 'Deutschland' }] },
        { isoCode: 'FR', name: [{ language: 'EN', text: 'France' }] },
      ]);
    }
    if (path === '/Subdivisions') {
      return okJson([
        { isoCode: 'DE-BY', name: [{ language: 'EN', text: 'Bavaria' }, { language: 'DE', text: 'Bayern' }] },
        { code: 'DE-BW', name: [], shortName: 'BW' },
      ]);
    }
    return okJson([]);
  };
  fn.calls = calls;
  return fn;
}

const SYNC_YEAR_SPAN = 4; // currentYear-1 .. currentYear+2
const BRAZIL_PUBLIC_HOLIDAYS_PER_YEAR = 10;

beforeEach(() => { resetState(); __setFetchImpl(null); });

// ---- getForRange -------------------------------------------------------------

test('getForRange: [] when no country configured', () => {
  setConfig({ holiday_show_public: '1' });
  assert.deepEqual(getForRange('2026-01-01', '2026-12-31'), []);
});

test('getForRange: [] when both layers disabled', () => {
  setConfig({ holiday_country: 'DE', holiday_show_public: '0', holiday_show_school: '0' });
  seedHoliday({ type: 'public', start: '2026-01-01', end: '2026-01-01' });
  assert.deepEqual(getForRange('2026-01-01', '2026-12-31'), []);
});

test('getForRange: returns public holiday with configured public color', () => {
  setConfig({ holiday_country: 'DE', holiday_show_public: '1', holiday_public_color: '#AA0000' });
  seedHoliday({ type: 'public', start: '2026-01-01', end: '2026-01-01', name: 'Neujahr' });
  const rows = getForRange('2026-01-01', '2026-01-31');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'public');
  assert.equal(rows[0].name, 'Neujahr');
  assert.equal(rows[0].color, '#AA0000');
});

test('getForRange: school holiday uses the school color, not the public one', () => {
  setConfig({ holiday_country: 'DE', holiday_show_school: '1',
    holiday_public_color: '#AA0000', holiday_school_color: '#00AA00' });
  seedHoliday({ type: 'school', start: '2026-07-20', end: '2026-08-30', name: 'Sommerferien' });
  const rows = getForRange('2026-08-01', '2026-08-10');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].color, '#00AA00');
});

test('getForRange: date overlap – includes spanning ranges, excludes outside ones', () => {
  setConfig({ holiday_country: 'DE', holiday_show_public: '1' });
  seedHoliday({ type: 'public', start: '2025-12-31', end: '2025-12-31', name: 'Silvester' }); // before
  seedHoliday({ type: 'public', start: '2026-01-01', end: '2026-01-06', name: 'Spanning' });   // overlaps start edge
  seedHoliday({ type: 'public', start: '2026-06-15', end: '2026-06-15', name: 'Inside' });      // inside
  seedHoliday({ type: 'public', start: '2027-01-01', end: '2027-01-01', name: 'After' });        // after
  const names = getForRange('2026-01-05', '2026-12-31').map((r) => r.name).sort();
  assert.deepEqual(names, ['Inside', 'Spanning']);
});

test('getForRange: type toggle hides school when only public is enabled', () => {
  setConfig({ holiday_country: 'DE', holiday_show_public: '1', holiday_show_school: '0' });
  seedHoliday({ type: 'public', start: '2026-05-01', end: '2026-05-01', name: 'Labour Day' });
  seedHoliday({ type: 'school', start: '2026-05-01', end: '2026-05-10', name: 'May break' });
  const rows = getForRange('2026-05-01', '2026-05-31');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'public');
});

test('getForRange: subdivision – national + matching region shown, other region hidden', () => {
  setConfig({ holiday_country: 'DE', holiday_subdivision: 'DE-BY', holiday_show_public: '1' });
  seedHoliday({ type: 'public', subdivision: null,    start: '2026-10-03', end: '2026-10-03', name: 'National' });
  seedHoliday({ type: 'public', subdivision: 'DE-BY', start: '2026-11-01', end: '2026-11-01', name: 'Bavaria only' });
  seedHoliday({ type: 'public', subdivision: 'DE-BW', start: '2026-11-01', end: '2026-11-01', name: 'BW only' });
  const names = getForRange('2026-01-01', '2026-12-31').map((r) => r.name).sort();
  assert.deepEqual(names, ['Bavaria only', 'National']);
});

test('getForRange: collapses identical holidays left over from an old scope – no duplicates (#434)', () => {



  setConfig({ holiday_country: 'DE', holiday_subdivision: 'DE-SH', holiday_show_public: '1' });
  seedHoliday({ type: 'public', subdivision: null,    start: '2026-01-01', end: '2026-01-01', name: 'Neujahr' });
  seedHoliday({ type: 'public', subdivision: 'DE-SH', start: '2026-01-01', end: '2026-01-01', name: 'Neujahr' });
  seedHoliday({ type: 'public', subdivision: '',      start: '2026-01-01', end: '2026-01-01', name: 'Neujahr' });
  const rows = getForRange('2026-01-01', '2026-12-31');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Neujahr');
});

test('getForRange: collapses overlapping same-name school variants into one union span (#434, CH-BE)', () => {




  setConfig({ holiday_country: 'CH', holiday_subdivision: 'CH-BE', holiday_show_school: '1' });
  seedHoliday({ type: 'school', country: 'CH', subdivision: 'CH-BE',
    start: '2026-07-04', end: '2026-08-09', name: 'Sommerferien' });
  seedHoliday({ type: 'school', country: 'CH', subdivision: 'CH-BE',
    start: '2026-07-06', end: '2026-08-14', name: 'Sommerferien' });

  const rows = getForRange('2026-07-01', '2026-08-31');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Sommerferien');
  assert.equal(rows[0].start_date, '2026-07-04');
  assert.equal(rows[0].end_date, '2026-08-14');
});

test('getForRange: keeps non-overlapping same-name entries separate (movable days)', () => {


  setConfig({ holiday_country: 'CH', holiday_show_school: '1' });
  seedHoliday({ type: 'school', country: 'CH', start: '2026-03-02', end: '2026-03-02', name: 'Ferientag' });
  seedHoliday({ type: 'school', country: 'CH', start: '2026-06-15', end: '2026-06-15', name: 'Ferientag' });
  const rows = getForRange('2026-01-01', '2026-12-31');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.start_date), ['2026-03-02', '2026-06-15']);
});

// ---- Schulferien-Gruppen (#434) ---------------------------------------------

test('getForRange: configured group shows only that regime, not the union (#434, CH-BE-VS)', () => {
  // Deutschsprachiger Kantonsteil (CH-BE-VS) endet am 09.08.; die


  setConfig({ holiday_country: 'CH', holiday_subdivision: 'CH-BE',
    holiday_group: 'CH-BE-VS', holiday_show_school: '1' });
  seedHoliday({ type: 'school', country: 'CH', subdivision: 'CH-BE', group: 'CH-BE-VS',
    start: '2026-07-04', end: '2026-08-09', name: 'Sommerferien' });
  seedHoliday({ type: 'school', country: 'CH', subdivision: 'CH-BE', group: 'CH-BE-EO',
    start: '2026-07-06', end: '2026-08-14', name: 'Sommerferien' });

  const rows = getForRange('2026-07-01', '2026-08-31');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].end_date, '2026-08-09');
});

test('getForRange: configured group still shows group-less rows (public holidays) (#434)', () => {


  setConfig({ holiday_country: 'CH', holiday_subdivision: 'CH-BE',
    holiday_group: 'CH-BE-EO', holiday_show_public: '1', holiday_show_school: '1' });
  seedHoliday({ type: 'public', country: 'CH', subdivision: 'CH-BE', group: null,
    start: '2026-08-01', end: '2026-08-01', name: 'Bundesfeier' });
  seedHoliday({ type: 'school', country: 'CH', subdivision: 'CH-BE', group: 'CH-BE-VS',
    start: '2026-01-31', end: '2026-02-08', name: 'Februarwoche' }); // nur VS
  const names = getForRange('2026-01-01', '2026-12-31').map((r) => r.name).sort();
  assert.deepEqual(names, ['Bundesfeier']); // Februarwoche (VS) ausgeblendet
});

test('getGroups: returns groups for a multilingual subdivision, sorted', async () => {
  __setFetchImpl(async (url) => {
    assert.equal(new URL(String(url)).pathname, '/Subdivisions');
    return okJson([
      { code: 'CH-BE', name: [], shortName: 'BE', groups: [
        { code: 'CH-BE-VS', shortName: 'BE-VS' },
        { code: 'CH-BE-EO', shortName: 'BE-EO' },
      ] },
      { code: 'CH-ZH', name: [], shortName: 'ZH', groups: [] },
    ]);
  });
  const groups = await getGroups('CH', 'CH-BE');
  assert.deepEqual(groups, [
    { code: 'CH-BE-EO', name: 'BE-EO' },
    { code: 'CH-BE-VS', name: 'BE-VS' },
  ]);
});

test('getGroups: [] for a subdivision without groups', async () => {
  __setFetchImpl(async () => okJson([
    { code: 'CH-ZH', name: [], shortName: 'ZH', groups: [] },
  ]));
  assert.deepEqual(await getGroups('CH', 'CH-ZH'), []);
});

test('sync: stores group_code from the OpenHolidays groups field (#434)', async () => {
  __setFetchImpl(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/SchoolHolidays') {
      return okJson([
        { startDate: '2026-07-04', endDate: '2026-08-09',
          name: [{ language: 'DE', text: 'Sommerferien' }], groups: [{ code: 'CH-BE-VS' }] },
        { startDate: '2026-07-06', endDate: '2026-08-14',
          name: [{ language: 'DE', text: 'Sommerferien' }], groups: [{ code: 'CH-BE-EO' }] },
      ]);
    }
    return okJson([]);
  });
  setConfig({ holiday_country: 'CH', holiday_subdivision: 'CH-BE', holiday_show_school: '1' });
  await sync(true);
  const stored = db.prepare(
    "SELECT group_code FROM holiday_cache WHERE end_date = '2026-08-09'",
  ).get();
  assert.equal(stored.group_code, 'CH-BE-VS');
});

// ---- sync --------------------------------------------------------------------

test('sync: no country → no fetch, synced 0', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  const res = await sync();
  assert.deepEqual(res, { synced: 0 });
  assert.equal(mock.calls.length, 0);
});

test('sync: both layers off → no fetch, synced 0', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  setConfig({ holiday_country: 'DE', holiday_show_public: '0', holiday_show_school: '0' });
  const res = await sync();
  assert.deepEqual(res, { synced: 0 });
  assert.equal(mock.calls.length, 0);
});



test('sync: no country → schweigt im Standard-Log-Level', async () => {
  __setFetchImpl(makeApiMock());
  const lines = await captureConsole(() => sync());
  assert.deepEqual(lines.info, []);
});

test('sync: both layers off → schweigt im Standard-Log-Level', async () => {
  __setFetchImpl(makeApiMock());
  setConfig({ holiday_country: 'DE', holiday_show_public: '0', holiday_show_school: '0' });
  const lines = await captureConsole(() => sync());
  assert.deepEqual(lines.info, []);
});

test('sync: throttled run → schweigt im Standard-Log-Level', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  setConfig({
    holiday_country: 'DE', holiday_show_public: '1', holiday_show_school: '0',
    holiday_last_sync: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),



    holiday_last_sync_scope: 'EN|DE||P|',
  });
  const lines = await captureConsole(() => sync());
  assert.equal(mock.calls.length, 0, 'throttled run darf nicht fetchen');
  assert.deepEqual(lines.info, []);
});

test('sync: public-only fetches PublicHolidays per year, caches them, sets last_sync', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);

  // seit #946, welcher Name im Cache landet.
  setConfig({ holiday_country: 'DE', holiday_show_public: '1', holiday_show_school: '0', language: 'de' });

  const res = await sync(true);

  assert.equal(res.synced, SYNC_YEAR_SPAN);
  assert.ok(mock.calls.every((u) => u.includes('/PublicHolidays')));
  assert.ok(!mock.calls.some((u) => u.includes('/SchoolHolidays')));

  const pub = db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE type='public'").get().c;
  assert.equal(pub, SYNC_YEAR_SPAN);

  assert.equal(db.prepare('SELECT name FROM holiday_cache LIMIT 1').get().name, 'Neujahr');
  // last_sync persisted
  assert.ok(db.prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync'").get()?.value);
});

test('sync: is idempotent – re-running does not duplicate cached rows', async () => {
  __setFetchImpl(makeApiMock());
  setConfig({ holiday_country: 'DE', holiday_show_public: '1', holiday_show_school: '0' });
  await sync(true);
  await sync(true);
  const pub = db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE type='public'").get().c;
  assert.equal(pub, SYNC_YEAR_SPAN);
});

test('sync: switching region purges the previous scope – no duplicate holidays (#434)', async () => {
  __setFetchImpl(makeApiMock());

  setConfig({ holiday_country: 'DE', holiday_show_public: '1', holiday_show_school: '0' });
  await sync(true);

  setConfig({ holiday_subdivision: 'DE-SH' });
  await sync(true);


  const total = db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE type='public'").get().c;
  assert.equal(total, SYNC_YEAR_SPAN);



  const stale = db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE subdivision IS NULL").get().c;
  assert.equal(stale, 0);
});

test('sync: both layers enabled caches public and school entries', async () => {
  __setFetchImpl(makeApiMock());
  setConfig({ holiday_country: 'DE', holiday_show_public: '1', holiday_show_school: '1' });
  const res = await sync(true);
  assert.equal(res.synced, SYNC_YEAR_SPAN * 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE type='public'").get().c, SYNC_YEAR_SPAN);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE type='school'").get().c, SYNC_YEAR_SPAN);
});

test('sync: drops "Exception"-tagged sub-regional holiday variants – no duplicate school breaks (#434)', async () => {
  __setFetchImpl(makeApiMock());


  setConfig({ holiday_country: 'DE', holiday_subdivision: 'DE-SH',
    holiday_show_public: '0', holiday_show_school: '1' });

  const res = await sync(true);


  assert.equal(res.synced, SYNC_YEAR_SPAN);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE type='school'").get().c, SYNC_YEAR_SPAN);
  const ends = db.prepare("SELECT DISTINCT end_date FROM holiday_cache WHERE type='school'").all().map((r) => r.end_date);
  assert.deepEqual(ends, ['2026-08-30']);
});

test('sync: Brazil local fallback follows the data language, not the country', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  setConfig({ holiday_country: 'BR', holiday_show_public: '1', holiday_show_school: '0', language: 'pt' });

  const res = await sync(true);

  assert.equal(res.synced, SYNC_YEAR_SPAN * BRAZIL_PUBLIC_HOLIDAYS_PER_YEAR);



  assert.deepEqual(mock.calls.filter((url) => url.includes('/PublicHolidays')), []);

  const currentYear = new Date().getFullYear();
  const namesOf = () => db.prepare(
    "SELECT name FROM holiday_cache WHERE country='BR' AND type='public' AND year=? ORDER BY start_date"
  ).all(currentYear).map((row) => row.name);
  let names = namesOf();
  assert.ok(names.includes('Tiradentes'));
  assert.ok(names.includes('Dia Nacional de Zumbi e da Consciência Negra'));
  assert.ok(names.includes('Natal'));



  // unerreichbar (#946).
  setConfig({ language: 'en' });
  await sync(true);
  names = namesOf();
  assert.ok(names.includes('Christmas Day'), `EN-Fassung erwartet, bekam: ${names.join(', ')}`);
  assert.ok(!names.includes('Natal'));
});

test('sync: throttles automatic sync if executed within 30 days', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  setConfig({ holiday_country: 'DE', holiday_show_public: '1', holiday_show_school: '0' });

  // First sync (force=false) - should run because DB has no last_sync
  const res1 = await sync(false);
  assert.equal(res1.synced, SYNC_YEAR_SPAN);
  const firstCallCount = mock.calls.length;
  assert.ok(firstCallCount > 0);

  // Second sync (force=false) - should throttle (skip)
  const res2 = await sync(false);
  assert.deepEqual(res2, { synced: 0 });
  assert.equal(mock.calls.length, firstCallCount); // no new API calls

  // Third sync (force=true) - should bypass throttle
  const res3 = await sync(true);
  assert.equal(res3.synced, SYNC_YEAR_SPAN);
  assert.equal(mock.calls.length, firstCallCount * 2); // new API calls made
});

// ---- Sprache der gespeicherten Eintraege (#946) ------------------------------

test('sync: die Namen folgen der Datensprache, nicht dem Land (#946)', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  // Der gemeldete Fall: Land Spanien, Region Katalonien, Datensprache Englisch.



  // zusagt.
  setConfig({
    holiday_country: 'ES', holiday_subdivision: 'ES-CT',
    holiday_show_public: '1', holiday_show_school: '0', language: 'en',
  });

  await sync(true);

  const namen = db.prepare("SELECT name FROM holiday_cache WHERE country='ES' AND start_date LIKE '%-12-25'").all().map((r) => r.name);
  assert.ok(namen.length > 0, 'ohne gespeicherte Zeile prueft die Zusicherung darunter nichts');
  assert.deepEqual([...new Set(namen)], ['Christmas Day'],
    'die eingestellte Datensprache entscheidet, nicht das Land');
});

test('sync: eine deutsche Datensprache bekommt denselben Feiertag auf Deutsch (#946)', async () => {
  __setFetchImpl(makeApiMock());


  // Dienst, der IMMER Englisch speichert.
  setConfig({
    holiday_country: 'ES', holiday_subdivision: 'ES-CT',
    holiday_show_public: '1', holiday_show_school: '0', language: 'de',
  });

  await sync(true);

  const namen = db.prepare("SELECT name FROM holiday_cache WHERE country='ES' AND start_date LIKE '%-12-25'").all().map((r) => r.name);
  assert.deepEqual([...new Set(namen)], ['Weihnachtstag']);
});

test('sync: fehlt die Wunschsprache, gilt Englisch vor der ersten angebotenen (#946)', async () => {
  __setFetchImpl(makeApiMock());



  // untergeschoben, obwohl eine englische Fassung danebenlag. Englisch fuehrt


  setConfig({
    holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'de',
  });

  await sync(true);

  const mai = db.prepare("SELECT name FROM holiday_cache WHERE country='ES' AND start_date LIKE '%-05-01'").all().map((r) => r.name);
  assert.ok(mai.length > 0, 'ohne gespeicherte Zeile prueft die Zusicherung darunter nichts');
  assert.deepEqual([...new Set(mai)], ['Labour Day'],
    'keine deutsche Fassung, aber eine englische → Englisch, nicht die Landessprache');


  // Halt - sonst stuende die Zeile leer da.
  const reyes = db.prepare("SELECT name FROM holiday_cache WHERE country='ES' AND start_date LIKE '%-01-06'").all().map((r) => r.name);
  assert.deepEqual([...new Set(reyes)], ['Reyes']);
});

test('sync: fragt ohne languageIsoCode, damit die Wahl hier faellt (#946)', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'en' });

  await sync(true);

  assert.ok(mock.calls.length > 0, 'ohne Abruf prueft die Zusicherung darunter nichts');
  const mitFilter = mock.calls.filter((url) => url.includes('languageIsoCode'));
  assert.deepEqual(mitFilter, [],
    'Mit languageIsoCode liefert OpenHolidays je Feiertag nur EINEN Namen - und wenn es\n'
    + 'den in der gefragten Sprache nicht gibt, den der Landessprache. Die Kaskade in\n'
    + 'resolveName laeuft dann ueber ein einelementiges Array und kann nichts mehr waehlen.');
});

test('sync: ein Sprachwechsel bricht die 30-Tage-Sperre (#946)', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'en' });

  await sync(true);
  const nachErstem = mock.calls.length;
  assert.ok(nachErstem > 0);


  assert.deepEqual(await sync(false), { synced: 0 });
  assert.equal(mock.calls.length, nachErstem, 'ohne Sprachwechsel bleibt es beim Bestand');




  setConfig({ language: 'de' });
  const res = await sync(false);
  assert.ok(res.synced > 0, 'ein Sprachwechsel muss den Bestand erneuern');
  assert.ok(mock.calls.length > nachErstem);

  const namen = db.prepare("SELECT name FROM holiday_cache WHERE country='ES' AND start_date LIKE '%-12-25'").all().map((r) => r.name);
  assert.deepEqual([...new Set(namen)], ['Weihnachtstag']);
  assert.ok(
    db.prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync_scope'").get()?.value?.startsWith('DE|ES|'),
    'der benutzte Scope steht neben dem Zeitstempel, sonst laeuft jeder Lauf erneut durch',
  );
});

test('sync: ein gescheiterter Lauf schreibt die Sprache NICHT fest (#946)', async () => {






  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'en' });
  __setFetchImpl(makeApiMock());
  await sync(true);
  assert.ok(db.prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync_scope'").get()?.value?.startsWith('EN|'));


  setConfig({ language: 'de' });
  const kaputt = async () => { throw new Error('network down'); };
  kaputt.calls = [];
  __setFetchImpl(kaputt);
  await captureConsole(() => sync(true));

  assert.equal(
    db.prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync_scope'").get()?.value,
    undefined,
    'ein unvollstaendiger Lauf laesst einen GEMISCHTEN Cache zurueck - kein Scope darf danach als erledigt gelten,\n'
    + 'sonst waere ein Zurueckwechseln auf den alten "unveraendert" und die 30-Tage-Sperre schriebe die halb\n'
    + 'umgestellten Bereiche fuer einen Monat fest',
  );


  db.prepare("DELETE FROM sync_config WHERE key='holiday_retry_after'").run();
  __setFetchImpl(makeApiMock());
  const res = await sync(false);
  assert.ok(res.synced > 0, 'der offene Sprachwechsel muss beim naechsten Lauf greifen');
  assert.ok(db.prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync_scope'").get()?.value?.startsWith('DE|'));
});

test('sync: nach einem Fehlschlag wird der Nachlauf gebremst, nicht wiederholt gehaemmert (#946)', async () => {






  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'en' });
  __setFetchImpl(makeApiMock());
  await sync(true);

  setConfig({ language: 'de' });
  const kaputt = async () => { throw new Error('network down'); };
  __setFetchImpl(kaputt);
  await captureConsole(() => sync(true));

  const gebremstBis = db.prepare("SELECT value FROM sync_config WHERE key='holiday_retry_after'").get()?.value;
  assert.ok(gebremstBis, 'ein Fehlschlag muss eine Wartemarke hinterlassen');
  assert.ok(new Date(gebremstBis).getTime() > Date.now(), 'die Wartemarke liegt in der Zukunft');

  const mock = makeApiMock();
  __setFetchImpl(mock);
  assert.deepEqual(await sync(false), { synced: 0 }, 'solange die Wartemarke gilt, wird nicht erneut gefetcht');
  assert.equal(mock.calls.length, 0);


  const res = await sync(true);
  assert.ok(res.synced > 0, 'force muss die Wartemarke uebergehen');
  assert.equal(db.prepare("SELECT value FROM sync_config WHERE key='holiday_retry_after'").get()?.value, undefined,
    'ein geglueckter Lauf raeumt die Wartemarke weg');
});

test('sync: der Brasilien-Ersatz folgt derselben Kaskade wie die API-Namen (#946)', async () => {



  // Portugiesisch, obwohl eine englische Fassung danebenlag.
  __setFetchImpl(makeApiMock());
  setConfig({ holiday_country: 'BR', holiday_show_public: '1', holiday_show_school: '0', language: 'de' });

  await sync(true);

  const currentYear = new Date().getFullYear();
  const namen = db.prepare(
    "SELECT name FROM holiday_cache WHERE country='BR' AND type='public' AND year=?"
  ).all(currentYear).map((r) => r.name);
  assert.ok(namen.length > 0, 'ohne gespeicherte Zeile prueft die Zusicherung darunter nichts');
  assert.ok(namen.includes('Christmas Day'),
    `keine deutsche Fassung, aber eine englische → Englisch, nicht Portugiesisch. Bekam: ${namen.join(', ')}`);
  assert.ok(!namen.includes('Natal'));
});

test('sync: ein geglueckter LEERER Abruf laesst nichts Altes stehen (#946)', async () => {



  // Zeilen anzufassen - ausgerechnet dieser Bereich behielt seine

  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'es' });
  __setFetchImpl(makeApiMock());
  await sync(true);
  const vorher = db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE country='ES'").get().c;
  assert.ok(vorher > 0, 'ohne Bestand prueft die Zusicherung darunter nichts');


  const leer = async () => ({ ok: true, json: async () => [] });
  __setFetchImpl(leer);
  setConfig({ language: 'de' });
  const res = await sync(true);

  assert.equal(db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE country='ES'").get().c, 0,
    'ein geglueckter leerer Abruf ist eine Auskunft - der Cache spiegelt sie, statt Altes zu behalten');
  assert.equal(res.incomplete, false, 'eine Leerantwort ist kein Fehlschlag');
  assert.ok(db.prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync_scope'").get()?.value?.startsWith('DE|'),
    'und darf deshalb den Merker setzen - es steht ja nichts Fremdsprachiges mehr da');
});

test('sync: die Wartemarke bremst keinen NEUEN Bereich (#946)', async () => {






  setConfig({
    holiday_country: 'ES', holiday_subdivision: 'ES-CT',
    holiday_show_public: '1', holiday_show_school: '0', language: 'en',
  });
  __setFetchImpl(makeApiMock());
  await sync(true);


  setConfig({ language: 'de' });
  __setFetchImpl(async () => { throw new Error('network down'); });
  await captureConsole(() => sync(true));
  const marke = db.prepare("SELECT value FROM sync_config WHERE key='holiday_retry_scope'").get()?.value;
  assert.ok(marke?.startsWith('DE|ES|ES-CT'), `Marke traegt den gescheiterten Bereich, war: ${marke}`);

  // Derselbe Bereich wird gebremst ...
  const gleich = makeApiMock();
  __setFetchImpl(gleich);
  assert.deepEqual(await sync(false), { synced: 0 });
  assert.equal(gleich.calls.length, 0);


  setConfig({ holiday_country: 'DE', holiday_subdivision: 'DE-BY' });
  const anderes = makeApiMock();
  __setFetchImpl(anderes);
  const res = await sync(false);
  assert.ok(res.synced > 0, 'ein neuer Bereich darf nicht an der Marke des alten haengenbleiben');
  assert.ok(anderes.calls.some((u) => u.includes('countryIsoCode=DE')));
});

test('sync: ein unvollstaendiger Lauf meldet sich nicht als "complete" (#946)', async () => {

  // die Synchronisierung durchgelaufen sei ("Holiday sync complete: 35 entries


  // selbstgehosteten Server oft die einzige Auskunft.
  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'en' });
  __setFetchImpl(makeApiMock());
  const gut = await captureConsole(() => sync(true));
  assert.ok(gut.info.some((l) => /complete/i.test(l)), 'ein geglueckter Lauf meldet sich als complete');
  assert.ok(!gut.info.some((l) => /INCOMPLETE/.test(l)));

  setConfig({ language: 'de' });
  __setFetchImpl(async () => { throw new Error('network down'); });
  const schlecht = await captureConsole(() => sync(true));
  assert.ok(!schlecht.info.some((l) => /complete/i.test(l)),
    'ein Lauf mit gescheiterten Abrufen darf sich nicht als complete melden');
  assert.ok(schlecht.warn.some((l) => /INCOMPLETE/.test(l)),
    'er muss stattdessen sagen, dass etwas fehlt - sonst sucht der naechste Melder an der falschen Stelle');
});

test('sync: die Wartemarke bremst nur die Sprache, bei der es schiefging (#946)', async () => {



  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'en' });
  __setFetchImpl(makeApiMock());
  await sync(true);

  // Nachlauf auf DE scheitert → Marke fuer DE.
  setConfig({ language: 'de' });
  __setFetchImpl(async () => { throw new Error('network down'); });
  await captureConsole(() => sync(true));
  assert.ok(db.prepare("SELECT value FROM sync_config WHERE key='holiday_retry_scope'").get()?.value?.startsWith('DE|ES|'),
    'die Marke traegt die volle Identitaet des Versuchs: Sprache, Land, Region, Ebenen');

  // Derselbe Wunsch DE wird gebremst ...
  const mockDe = makeApiMock();
  __setFetchImpl(mockDe);
  assert.deepEqual(await sync(false), { synced: 0 });
  assert.equal(mockDe.calls.length, 0);


  setConfig({ language: 'es' });
  const mockEs = makeApiMock();
  __setFetchImpl(mockEs);
  const res = await sync(false);
  assert.ok(res.synced > 0, 'ein neuer Sprachwunsch darf nicht an der Marke der alten haengenbleiben');
  assert.equal(db.prepare("SELECT value FROM sync_config WHERE key='holiday_retry_scope'").get()?.value, undefined,
    'ein geglueckter Lauf raeumt die Marke weg');
});

test('sync: eine abgeschaltete Ebene wird beim Wiedereinschalten nachgeholt (#946)', async () => {





  // aktiven Ebenen.
  setConfig({ holiday_country: 'DE', holiday_show_public: '1', holiday_show_school: '1', language: 'de' });
  __setFetchImpl(makeApiMock());
  await sync(true);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE type='school'").get().c > 0);


  setConfig({ holiday_show_school: '0', language: 'en' });
  __setFetchImpl(makeApiMock());
  await sync(true);


  setConfig({ holiday_show_school: '1' });
  const mock = makeApiMock();
  __setFetchImpl(mock);
  const res = await sync(false);
  assert.ok(res.synced > 0, 'eine wieder eingeschaltete Ebene muss nachgeholt werden');
  assert.ok(mock.calls.some((u) => u.includes('/SchoolHolidays')));
  assert.equal(db.prepare("SELECT name FROM holiday_cache WHERE type='school' LIMIT 1").get()?.name, 'Summer break',
    'sonst stuenden ihre Namen weiter in der alten Sprache da');
});

test('sync: ein Zurueckwechseln nach einem Teilfehlschlag repariert den Rest (#946)', async () => {



  // bereits umgestellten Bereiche behielten ihre neuen Namen fuer einen Monat.
  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'en' });
  __setFetchImpl(makeApiMock());
  await sync(true);

  // Wechsel auf DE scheitert.
  setConfig({ language: 'de' });
  __setFetchImpl(async () => { throw new Error('network down'); });
  await captureConsole(() => sync(true));
  assert.equal(db.prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync_scope'").get()?.value, undefined,
    'nach einem Teilfehlschlag darf kein Scope als erledigt gelten');


  setConfig({ language: 'en' });
  const mock = makeApiMock();
  __setFetchImpl(mock);
  const res = await sync(false);
  assert.ok(res.synced > 0, 'ein Zurueckwechseln nach einem Teilfehlschlag muss reparieren, nicht throtteln');
  assert.ok(mock.calls.length > 0);
});

test('sync: ein Fehlschlag wird wiederholt, ohne dass der Haushalt etwas aendert (#946)', async () => {



  // fehlgeschlagene Bereich blieb einen weiteren Monat alt.
  //






  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'en' });
  __setFetchImpl(makeApiMock());
  await sync(true);

  // Erneuter Lauf in DERSELBEN Sprache scheitert.
  __setFetchImpl(async () => { throw new Error('network down'); });
  await captureConsole(() => sync(true));
  const marke = db.prepare("SELECT value FROM sync_config WHERE key='holiday_retry_after'").get()?.value;
  assert.ok(marke, 'ein Fehlschlag hinterlaesst eine Reparaturmarke, auch ohne Sprachwechsel');

  // Solange die Marke gilt: keine neuen Abrufe.
  const gebremst = makeApiMock();
  __setFetchImpl(gebremst);
  assert.deepEqual(await sync(false), { synced: 0 });
  assert.equal(gebremst.calls.length, 0);



  db.prepare("INSERT INTO sync_config (key, value) VALUES ('holiday_retry_after', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(new Date(Date.now() - 1000).toISOString());
  const mock = makeApiMock();
  __setFetchImpl(mock);
  const res = await sync(false);
  assert.ok(res.synced > 0, 'nach Ablauf der Marke muss der gescheiterte Bereich erneut versucht werden');
  assert.ok(mock.calls.length > 0);
});

test('sync: ein Sprachwechsel holt auch Jahre ausserhalb des Fensters nach (#946)', async () => {





  //
  // Sie zu loeschen waere konsistent gewesen, haette aber alte Jahre leer


  const altesJahr = new Date().getFullYear() - 5;
  setConfig({ holiday_country: 'DE', holiday_show_public: '1', holiday_show_school: '0', language: 'de' });
  __setFetchImpl(makeApiMock());
  await sync(true);


  // Betrieb hinterlaesst.
  seedHoliday({ type: 'public', country: 'DE', start: `${altesJahr}-01-01`, end: `${altesJahr}-01-01`, name: 'Neujahr', year: altesJahr });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM holiday_cache WHERE year = ?').get(altesJahr).c, 1);


  setConfig({ language: 'en' });
  const mock = makeApiMock();
  __setFetchImpl(mock);
  await sync(true);

  assert.ok(mock.calls.some((u) => u.includes(`validFrom=${altesJahr}-01-01`)),
    `das Jahr ${altesJahr} liegt im Cache und muss beim Wechsel mit abgefragt werden`);
  const alt = db.prepare('SELECT name FROM holiday_cache WHERE year = ?').all(altesJahr).map((r) => r.name);
  assert.ok(!alt.includes('Neujahr'),
    `im Cache stand nach dem Wechsel weiter der deutsche Name: ${alt.join(', ') || '(nichts)'}`);



  const ohneWechsel = makeApiMock();
  __setFetchImpl(ohneWechsel);
  await sync(true);
  assert.ok(!ohneWechsel.calls.some((u) => u.includes(`validFrom=${altesJahr}-01-01`)),
    'ohne Scope-Wechsel wird das Fenster nicht ausgeweitet');
});

test('sync: eine unerwartete Antwortform raeumt den Cache NICHT (#946)', async () => {






  // Auskunft.
  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'es' });
  __setFetchImpl(makeApiMock());
  await sync(true);
  const vorher = db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE country='ES'").get().c;
  assert.ok(vorher > 0, 'ohne Bestand prueft die Zusicherung darunter nichts');


  __setFetchImpl(async () => ({ ok: true, json: async () => ({ error: 'upstream unavailable' }) }));
  setConfig({ language: 'de' });
  const res = await captureConsole(() => sync(true));

  assert.equal(db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE country='ES'").get().c, vorher,
    'eine unverstandene Antwort darf keinen Bestand loeschen');
  assert.equal(db.prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync_scope'").get()?.value, undefined,
    'und sie darf den Lauf nicht als vollstaendig verbuchen');
  assert.ok(db.prepare("SELECT value FROM sync_config WHERE key='holiday_retry_after'").get()?.value,
    'stattdessen bleibt eine Reparaturmarke offen');
  assert.ok(res.warn.some((l) => /unexpected response shape/.test(l)),
    'und der Log sagt, was er nicht verstanden hat');
});

test('sync: zwei Laeufe verschraenken sich nicht (#946)', async () => {

  // SYNC_INTERVAL_MINUTES, der Knopf "Jetzt synchronisieren" ruft sync(true) -





  // Mischzustand.
  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'de' });

  let drin = 0;
  let maxDrin = 0;
  const langsam = async (url) => {
    drin += 1;
    maxDrin = Math.max(maxDrin, drin);
    await new Promise((r) => setTimeout(r, 5));
    drin -= 1;
    return makeApiMock()(url);
  };
  __setFetchImpl(langsam);

  await Promise.all([sync(true), sync(true)]);

  assert.equal(maxDrin, 1,
    `zwei Laeufe waren gleichzeitig im Abruf (${maxDrin}) - sie koennen sich gegenseitig ueberschreiben`);


  const namen = db.prepare("SELECT DISTINCT name FROM holiday_cache WHERE country='ES' AND start_date LIKE '%-12-25'").all().map((r) => r.name);
  assert.deepEqual(namen, ['Weihnachtstag']);
});

test('sync: der wartende Lauf sieht den NEUEN Stand, nicht den alten (#946)', async () => {



  // wird, ueberhaupt ankommen.
  setConfig({ holiday_country: 'ES', holiday_show_public: '1', holiday_show_school: '0', language: 'de' });
  __setFetchImpl(makeApiMock());
  await sync(true);

  const ersterLauf = sync(true);

  setConfig({ language: 'en' });
  const zweiterLauf = sync(true);
  await Promise.all([ersterLauf, zweiterLauf]);

  const namen = db.prepare("SELECT DISTINCT name FROM holiday_cache WHERE country='ES' AND start_date LIKE '%-12-25'").all().map((r) => r.name);
  assert.deepEqual(namen, ['Christmas Day'],
    'der zuletzt gestartete Lauf gibt den Ausschlag, und zwar vollstaendig - nicht halb');
  assert.ok(db.prepare("SELECT value FROM sync_config WHERE key='holiday_last_sync_scope'").get()?.value?.startsWith('EN|'));
});

// ---- #965: lokal berechnete Laender (US/CA/GB/AU/NZ) ------------------------

// gegen amtliche/gut belegte Quellen (GOV.UK, mygov.scot, MBIE, Canada.ca)


// Gedankengang teilen.

test('US: 11 Bundesfeiertage, inkl. Beobachtungsregel (Samstag zurueck, Sonntag vor)', () => {
  const names2026 = namesAndDates(2026, 'US');
  assert.equal(names2026.length, 11);

  assert.ok(names2026.includes('2026-07-03 Independence Day'));
  assert.ok(!names2026.some((n) => n.includes('07-04')));

  assert.ok(names2026.includes('2026-06-19 Juneteenth National Independence Day'));
  // n-ter-Wochentag-Feiertage 2026, unabhaengig gegengeprueft:
  assert.ok(names2026.includes('2026-01-19 Martin Luther King, Jr. Day'));   // 3. Montag Januar
  assert.ok(names2026.includes('2026-02-16 Washington\'s Birthday'));         // 3. Montag Februar
  assert.ok(names2026.includes('2026-05-25 Memorial Day'));                  // letzter Montag Mai
  assert.ok(names2026.includes('2026-09-07 Labor Day'));                     // 1. Montag September
  assert.ok(names2026.includes('2026-10-12 Columbus Day'));                  // 2. Montag Oktober
  assert.ok(names2026.includes('2026-11-26 Thanksgiving Day'));              // 4. Donnerstag November
});

test('US: Sonntag verschiebt vorwaerts auf Montag', () => {

  const names2027 = namesAndDates(2027, 'US');
  assert.ok(names2027.includes('2027-07-05 Independence Day'));

  assert.ok(names2027.includes('2027-06-18 Juneteenth National Independence Day'));
});

test('US: ein auf das Vorjahr zurueckfallendes Beobachtungsdatum bleibt korrekt (Neujahr 2028)', () => {




  // gewesen waere es leicht gewesen.
  const names2028 = namesAndDates(2028, 'US');
  assert.ok(names2028.includes("2027-12-31 New Year's Day"),
    `erwartet 2027-12-31, bekam: ${names2028.filter((n) => n.includes('New Year')).join(', ')}`);
});

test('CA: 10 Feiertage, EN/FR-Kaskade, Victoria Day zwischen dem 18. und 24. Mai', () => {
  const en2026 = namesAndDates(2026, 'CA');
  assert.equal(en2026.length, 10);




  assert.ok(en2026.includes('2026-05-18 Victoria Day'), `bekam: ${en2026.filter((n) => n.includes('Victoria')).join(', ')}`);

  const fr2026 = localHolidayFallback('CA', 'public', 2026, 'FR')
    .map((h) => `${h.startDate} ${h.name}`).sort();
  assert.ok(fr2026.includes('2026-05-18 Fête de la Reine'));



  assert.ok(fr2026.includes('2026-07-01 Fête du Canada'), `bekam: ${fr2026.filter((n) => n.includes('Canada')).join(', ')}`);
});

test('CA: Victoria Day faellt auf den 24., wenn der selbst ein Montag ist', () => {


  const names2027 = namesAndDates(2027, 'CA');
  assert.ok(names2027.includes('2027-05-24 Victoria Day'));
});

test('CA: nur Sonntag verschiebt, Samstag bleibt unveraendert', () => {

  // Freitag) bleibt der kanadische Feiertag unveraendert am Samstag stehen,
  // weil Kanadas Regel nur Sonntag->Montag kennt (siehe Code-Kommentar).
  const names2028 = namesAndDates(2028, 'CA');
  assert.ok(names2028.includes("2028-01-01 New Year's Day"));
});

test('CA: Weihnachten und Boxing Day werden unabhaengig verschoben - dokumentierte Kollision moeglich', () => {




  const names2022 = namesAndDates(2022, 'CA');
  const dec26 = names2022.filter((n) => n.startsWith('2022-12-26'));
  assert.deepEqual(dec26, ['2022-12-26 Boxing Day', '2022-12-26 Christmas Day']);
});

test('GB (England & Wales): 8 Feiertage; Neujahr verschiebt VORWAERTS auf Montag, anders als die USA', () => {
  const namesEng = namesAndDates(2026, 'GB', 'GB-ENG');
  assert.equal(namesEng.length, 8);



  const names2028 = namesAndDates(2028, 'GB', 'GB-ENG');
  assert.ok(names2028.includes("2028-01-03 New Year's Day"),
    `erwartet Montag 3.1.2028 (vorwaerts), bekam: ${names2028.filter((n) => n.includes('New Year')).join(', ')}`);
});

test('GB (England & Wales): Weihnachten/Boxing Day Paar-Verschiebung, amtlich belegte Jahre', () => {
  // 2026: Weihnachten faellt auf Freitag (Werktag, unveraendert); Boxing Day
  // auf Samstag -> Ersatztag Montag 28.12. (GOV.UK/Presseberichte bestaetigt).
  const names2026 = namesAndDates(2026, 'GB', 'GB-ENG');
  assert.ok(names2026.includes('2026-12-25 Christmas Day'));
  assert.ok(names2026.includes('2026-12-28 Boxing Day'));

  // 2027: Weihnachten Samstag -> Ersatztag Montag 27.; Boxing Day Sonntag ->
  // Ersatztag Dienstag 28. (ebenfalls amtlich bestaetigt, siehe #965-Recherche).
  const names2027 = namesAndDates(2027, 'GB', 'GB-ENG');
  assert.ok(names2027.includes('2027-12-27 Christmas Day'));
  assert.ok(names2027.includes('2027-12-28 Boxing Day'));
});

test('GB (Schottland): 9 Feiertage, kein Ostermontag, eigener Sommertermin, 2. Januar als Paar', () => {
  const namesSct2026 = namesAndDates(2026, 'GB', 'GB-SCT');
  assert.equal(namesSct2026.length, 9);
  assert.ok(!namesSct2026.some((n) => n.includes('Easter Monday')));

  // 2022: 1. Januar Samstag, 2. Januar Sonntag -> Ersatztage Montag 3. und


  const namesSct2022 = namesAndDates(2022, 'GB', 'GB-SCT');
  assert.ok(namesSct2022.includes("2022-01-03 New Year's Day"),
    `bekam: ${namesSct2022.filter((n) => n.includes('01-0')).join(', ')}`);
  assert.ok(namesSct2022.includes('2022-01-04 2nd January'));
});

test('GB (Nordirland): 10 Feiertage, St Patrick\'s Day + Battle of the Boyne mit Mondayisation', () => {
  const namesNir2026 = namesAndDates(2026, 'GB', 'GB-NIR');
  assert.equal(namesNir2026.length, 10);

  // Montag 13. Juli (amtlich bestaetigt); St Patrick's Day faellt 2026 auf

  assert.ok(namesNir2026.includes('2026-07-13 Battle of the Boyne (Orangemen’s Day)'),
    `bekam: ${namesNir2026.filter((n) => n.includes('Boyne')).join(', ')}`);
  assert.ok(namesNir2026.includes("2026-03-17 St Patrick's Day"));
});

test('GB: ohne gewaehlte Subdivision gilt England & Wales', () => {
  assert.deepEqual(namesAndDates(2026, 'GB'), namesAndDates(2026, 'GB', 'GB-ENG'));
});

test('AU: 7 landesweite Feiertage, KEINE Wochenend-Verschiebung', () => {
  // Australien hat kein Bundesgesetz fuer Ersatztage (jeder Bundesstaat regelt


  const names2026 = namesAndDates(2026, 'AU');
  assert.equal(names2026.length, 7);
  assert.ok(names2026.includes('2026-04-25 Anzac Day')); // 2026: ein Samstag, bewusst unverschoben
});

test('NZ: Mondayisation fuer Waitangi/Anzac, Matariki nur innerhalb der amtlichen Tabelle', () => {

  // Montag 27. April (im #965-Rechercheergebnis direkt bestaetigtes Beispiel).
  const names2026 = namesAndDates(2026, 'NZ');
  assert.ok(names2026.includes('2026-04-27 Anzac Day'), `bekam: ${names2026.filter((n) => n.includes('Anzac')).join(', ')}`);

  // Schaetzung nahelegen wuerde - deshalb eine amtliche Tabelle, keine Formel).
  assert.ok(names2026.includes('2026-07-10 Matariki'));



  const names2053 = namesAndDates(2053, 'NZ');
  assert.ok(!names2053.some((n) => n.includes('Matariki')));
});

test('NZ: Neujahr/2.-Januar- und Weihnachten/Boxing-Day-Paare wie in Schottland', () => {

  // Januar Samstag) - dieselbe Formel muss dasselbe Ergebnis liefern.
  const names2028 = namesAndDates(2028, 'NZ');
  assert.ok(names2028.includes("2028-01-03 New Year's Day"));
  assert.ok(names2028.includes('2028-01-04 Day after New Year’s Day'));

  // 2021: Weihnachten Samstag, Boxing Day Sonntag -> Montag 27./Dienstag 28.

  const names2021 = namesAndDates(2021, 'NZ');
  assert.ok(names2021.includes('2021-12-27 Christmas Day'));
  assert.ok(names2021.includes('2021-12-28 Boxing Day'));
});

test("GB (Schottland): St Andrew's Day ist mondayised (Act 2007 s.1(2), Review-Fund zu #965)", () => {
  // GOV.UK (bank-holidays.json) fuehrt 2019-12-02, 2024-12-02 und 2025-12-01




  for (const [year, expected] of [
    [2019, "2019-12-02 St Andrew's Day"],
    [2024, "2024-12-02 St Andrew's Day"],
    [2025, "2025-12-01 St Andrew's Day"],
    [2026, "2026-11-30 St Andrew's Day"], // Montag - unverschoben
    [2030, "2030-12-02 St Andrew's Day"],
  ]) {
    const names = namesAndDates(year, 'GB', 'GB-SCT');
    assert.ok(names.includes(expected),
      `${year}: erwartet "${expected}", bekam: ${names.filter((n) => n.includes('Andrew')).join(', ') || '(nichts)'}`);
  }
});

// ---- #965 Review: vollstaendige Jahres-Tabellen 2026 + 2027 -------------------






// (moeglicherweise falschen) Gedankengang teilen:
//   US: OPM "Federal Holidays" (opm.gov), Tabellen 2026/2027.
//   CA: canada.ca (CRA) 2026; 2027 nach Holidays Act/Bills of Exchange Act


//   GB: gov.uk/bank-holidays.json (alle drei Nationen, 2026 + 2027).

//       Ersatztage (kein Bundesgesetz; siehe AU-Regelsatz).
//   NZ: employment.govt.nz (MBIE), Tabellen 2026/2027 inkl. Matariki.
//   BR: feste gesetzliche Daten + Karfreitag.
// Jede Wochentagsbehauptung wurde zusaetzlich unabhaengig per Datumsarithmetik

//

// Proklamation geschaffene, einmalige "World Cup bank holiday" am Mo 15.06.2026
// (gov.uk fuehrt ihn). Einmalig proklamierte Feiertage kann keine statische
// Regeltabelle liefern - dokumentierte Grenze, siehe docs/SPEC.md; der


test('US: vollstaendige Datumstabelle 2026 + 2027 (OPM)', () => {
  assert.deepEqual(namesAndDates(2026, 'US'), [
    "2026-01-01 New Year's Day",
    '2026-01-19 Martin Luther King, Jr. Day',
    "2026-02-16 Washington's Birthday",
    '2026-05-25 Memorial Day',
    '2026-06-19 Juneteenth National Independence Day',
    '2026-07-03 Independence Day', // 4.7. ist Samstag -> Freitag davor
    '2026-09-07 Labor Day',
    '2026-10-12 Columbus Day',
    '2026-11-11 Veterans Day',
    '2026-11-26 Thanksgiving Day',
    '2026-12-25 Christmas Day',
  ]);
  assert.deepEqual(namesAndDates(2027, 'US'), [
    "2027-01-01 New Year's Day",
    '2027-01-18 Martin Luther King, Jr. Day',
    "2027-02-15 Washington's Birthday",
    '2027-05-31 Memorial Day',
    '2027-06-18 Juneteenth National Independence Day', // 19.6. Samstag -> Freitag
    '2027-07-05 Independence Day',                     // 4.7. Sonntag -> Montag
    '2027-09-06 Labor Day',
    '2027-10-11 Columbus Day',
    '2027-11-11 Veterans Day',
    '2027-11-25 Thanksgiving Day',
    '2027-12-24 Christmas Day',                        // 25.12. Samstag -> Freitag
  ]);
});

test('CA: vollstaendige Datumstabelle 2026 + 2027 (canada.ca / Holidays Act)', () => {
  assert.deepEqual(namesAndDates(2026, 'CA'), [
    "2026-01-01 New Year's Day",
    '2026-04-03 Good Friday',
    '2026-05-18 Victoria Day',
    '2026-07-01 Canada Day',
    '2026-09-07 Labour Day',
    '2026-09-30 National Day for Truth and Reconciliation',
    '2026-10-12 Thanksgiving',
    '2026-11-11 Remembrance Day',
    '2026-12-25 Christmas Day',
    '2026-12-26 Boxing Day',
  ]);
  assert.deepEqual(namesAndDates(2027, 'CA'), [
    "2027-01-01 New Year's Day",
    '2027-03-26 Good Friday',
    '2027-05-24 Victoria Day',
    '2027-07-01 Canada Day',
    '2027-09-06 Labour Day',
    '2027-09-30 National Day for Truth and Reconciliation',
    '2027-10-11 Thanksgiving',
    '2027-11-11 Remembrance Day',
    '2027-12-25 Christmas Day', // Samstag - bleibt bewusst unverschoben
    '2027-12-27 Boxing Day',    // Sonntag -> Montag
  ]);
});

test('GB (England & Wales): vollstaendige Datumstabelle 2026 + 2027 (gov.uk)', () => {
  assert.deepEqual(namesAndDates(2026, 'GB', 'GB-ENG'), [
    "2026-01-01 New Year's Day",
    '2026-04-03 Good Friday',
    '2026-04-06 Easter Monday',
    '2026-05-04 Early May Bank Holiday',
    '2026-05-25 Spring Bank Holiday',
    '2026-08-31 Summer Bank Holiday', // LETZTER Montag im August
    '2026-12-25 Christmas Day',
    '2026-12-28 Boxing Day', // 26.12. Samstag -> Ersatztag Montag
  ]);
  assert.deepEqual(namesAndDates(2027, 'GB', 'GB-ENG'), [
    "2027-01-01 New Year's Day",
    '2027-03-26 Good Friday',
    '2027-03-29 Easter Monday',
    '2027-05-03 Early May Bank Holiday',
    '2027-05-31 Spring Bank Holiday',
    '2027-08-30 Summer Bank Holiday',
    '2027-12-27 Christmas Day', // 25.12. Samstag -> Montag
    '2027-12-28 Boxing Day',    // 26.12. Sonntag -> Dienstag
  ]);
});

test('GB (Schottland): vollstaendige Datumstabelle 2026 + 2027 (gov.uk)', () => {
  assert.deepEqual(namesAndDates(2026, 'GB', 'GB-SCT'), [
    "2026-01-01 New Year's Day",
    '2026-01-02 2nd January',
    '2026-04-03 Good Friday',
    '2026-05-04 Early May Bank Holiday',
    '2026-05-25 Spring Bank Holiday',

    // siehe Kommentar ueber diesem Block.
    '2026-08-03 Summer Bank Holiday',
    "2026-11-30 St Andrew's Day",     // Montag - unverschoben
    '2026-12-25 Christmas Day',
    '2026-12-28 Boxing Day',
  ]);
  assert.deepEqual(namesAndDates(2027, 'GB', 'GB-SCT'), [
    "2027-01-01 New Year's Day",
    '2027-01-04 2nd January', // 2.1. Samstag -> Ersatztag Montag
    '2027-03-26 Good Friday',
    '2027-05-03 Early May Bank Holiday',
    '2027-05-31 Spring Bank Holiday',
    '2027-08-02 Summer Bank Holiday',
    "2027-11-30 St Andrew's Day",
    '2027-12-27 Christmas Day',
    '2027-12-28 Boxing Day',
  ]);
});

test('GB (Nordirland): vollstaendige Datumstabelle 2026 + 2027 (gov.uk)', () => {
  assert.deepEqual(namesAndDates(2026, 'GB', 'GB-NIR'), [
    "2026-01-01 New Year's Day",
    "2026-03-17 St Patrick's Day",
    '2026-04-03 Good Friday',
    '2026-04-06 Easter Monday',
    '2026-05-04 Early May Bank Holiday',
    '2026-05-25 Spring Bank Holiday',
    '2026-07-13 Battle of the Boyne (Orangemen’s Day)', // 12.7. Sonntag -> Montag
    '2026-08-31 Summer Bank Holiday',
    '2026-12-25 Christmas Day',
    '2026-12-28 Boxing Day',
  ]);
  assert.deepEqual(namesAndDates(2027, 'GB', 'GB-NIR'), [
    "2027-01-01 New Year's Day",
    "2027-03-17 St Patrick's Day",
    '2027-03-26 Good Friday',
    '2027-03-29 Easter Monday',
    '2027-05-03 Early May Bank Holiday',
    '2027-05-31 Spring Bank Holiday',
    '2027-07-12 Battle of the Boyne (Orangemen’s Day)', // Montag - unverschoben
    '2027-08-30 Summer Bank Holiday',
    '2027-12-27 Christmas Day',
    '2027-12-28 Boxing Day',
  ]);
});

test('AU: vollstaendige Datumstabelle 2026 + 2027 (echte Kalenderdaten, keine Ersatztage)', () => {
  assert.deepEqual(namesAndDates(2026, 'AU'), [
    "2026-01-01 New Year's Day",
    '2026-01-26 Australia Day',
    '2026-04-03 Good Friday',
    '2026-04-06 Easter Monday',
    '2026-04-25 Anzac Day', // Samstag - bewusst unverschoben
    '2026-12-25 Christmas Day',
    '2026-12-26 Boxing Day',
  ]);
  assert.deepEqual(namesAndDates(2027, 'AU'), [
    "2027-01-01 New Year's Day",
    '2027-01-26 Australia Day',
    '2027-03-26 Good Friday',
    '2027-03-29 Easter Monday',
    '2027-04-25 Anzac Day',      // Sonntag - bewusst unverschoben
    '2027-12-25 Christmas Day',  // Samstag - bewusst unverschoben
    '2027-12-26 Boxing Day',     // Sonntag - bewusst unverschoben
  ]);
});

test('NZ: vollstaendige Datumstabelle 2026 + 2027 (employment.govt.nz)', () => {
  assert.deepEqual(namesAndDates(2026, 'NZ'), [
    "2026-01-01 New Year's Day",
    '2026-01-02 Day after New Year’s Day',
    '2026-02-06 Waitangi Day',
    '2026-04-03 Good Friday',
    '2026-04-06 Easter Monday',
    '2026-04-27 Anzac Day', // 25.4. Samstag -> Montag (Mondayisation seit 2013)
    "2026-06-01 King's Birthday",
    '2026-07-10 Matariki',
    '2026-10-26 Labour Day', // 4. Montag im Oktober
    '2026-12-25 Christmas Day',
    '2026-12-28 Boxing Day', // 26.12. Samstag -> Montag
  ]);
  assert.deepEqual(namesAndDates(2027, 'NZ'), [
    "2027-01-01 New Year's Day",
    '2027-01-04 Day after New Year’s Day', // 2.1. Samstag -> Montag
    '2027-02-08 Waitangi Day',             // 6.2. Samstag -> Montag
    '2027-03-26 Good Friday',
    '2027-03-29 Easter Monday',
    '2027-04-26 Anzac Day',                // 25.4. Sonntag -> Montag
    "2027-06-07 King's Birthday",
    '2027-06-25 Matariki',
    '2027-10-25 Labour Day',
    '2027-12-27 Christmas Day',            // 25.12. Samstag -> Montag
    '2027-12-28 Boxing Day',               // 26.12. Sonntag -> Dienstag
  ]);
});

test('BR: vollstaendige Datumstabelle 2026 + 2027 (feste gesetzliche Daten + Karfreitag)', () => {
  assert.deepEqual(namesAndDates(2026, 'BR'), [
    '2026-01-01 Universal Brotherhood Day',
    '2026-04-03 Good Friday',
    '2026-04-21 Tiradentes Day',
    '2026-05-01 Labour Day',
    '2026-09-07 Independence Day',
    '2026-10-12 Our Lady of Aparecida',
    "2026-11-02 All Souls' Day",
    '2026-11-15 Republic Proclamation Day',
    '2026-11-20 National Zumbi and Black Consciousness Day',
    '2026-12-25 Christmas Day',
  ]);
  assert.deepEqual(namesAndDates(2027, 'BR'), [
    '2027-01-01 Universal Brotherhood Day',
    '2027-03-26 Good Friday',
    '2027-04-21 Tiradentes Day',
    '2027-05-01 Labour Day',
    '2027-09-07 Independence Day',
    '2027-10-12 Our Lady of Aparecida',
    "2027-11-02 All Souls' Day",
    '2027-11-15 Republic Proclamation Day',
    '2027-11-20 National Zumbi and Black Consciousness Day',
    '2027-12-25 Christmas Day',
  ]);
});

test('sync: US public holidays cache locally - ohne einen einzigen /PublicHolidays-Abruf (#965 Review)', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  setConfig({ holiday_country: 'US', holiday_show_public: '1', holiday_show_school: '0', language: 'de' });

  const res = await sync(true);

  assert.equal(res.synced, SYNC_YEAR_SPAN * 11);



  // funktioniert per Konstruktion (eigener Test weiter unten).
  assert.deepEqual(mock.calls.filter((url) => url.includes('/PublicHolidays')), [],
    'ein lokal berechnetes Land darf /PublicHolidays gar nicht erst fragen');

  // Englisch, dokumentiert als bewusste Einschraenkung (siehe Code-Kommentar).
  const currentYear = new Date().getFullYear();
  const namen = db.prepare(
    "SELECT name FROM holiday_cache WHERE country='US' AND type='public' AND year=?",
  ).all(currentYear).map((r) => r.name);
  assert.ok(namen.includes('Christmas Day'));
});

test('sync: GB with a chosen subdivision caches that nation\'s own list', async () => {
  __setFetchImpl(makeApiMock());
  setConfig({ holiday_country: 'GB', holiday_subdivision: 'GB-SCT', holiday_show_public: '1', holiday_show_school: '0' });

  const res = await sync(true);

  assert.equal(res.synced, SYNC_YEAR_SPAN * 9); // Schottland: 9 statt 8 (England/Wales)
  const currentYear = new Date().getFullYear();
  const namen = db.prepare(
    "SELECT name FROM holiday_cache WHERE country='GB' AND type='public' AND year=?",
  ).all(currentYear).map((r) => r.name);
  assert.ok(namen.includes("St Andrew's Day"));
  assert.ok(!namen.includes('Easter Monday'));
});

test('sync: school holidays for a #965 country store nothing and report incomplete: false', async () => {



  __setFetchImpl(makeApiMock());
  setConfig({ holiday_country: 'US', holiday_show_public: '0', holiday_show_school: '1' });

  const res = await sync(true);

  assert.equal(res.incomplete, false);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM holiday_cache WHERE country='US' AND type='school'").get().c, 0);
});

// ---- getCountries / getSubdivisions -----------------------------------------

test('getCountries: prefers EN names and sorts alphabetically', async () => {
  __setFetchImpl(makeApiMock());
  const list = await getCountries();



  assert.deepEqual(list, [
    { isoCode: 'AU', name: 'Australia', schoolHolidays: false },
    { isoCode: 'BR', name: 'Brazil', schoolHolidays: false },
    { isoCode: 'CA', name: 'Canada', schoolHolidays: false },
    { isoCode: 'FR', name: 'France' },
    { isoCode: 'DE', name: 'Germany' },
    { isoCode: 'NZ', name: 'New Zealand', schoolHolidays: false },
    { isoCode: 'GB', name: 'United Kingdom', schoolHolidays: false },
    { isoCode: 'US', name: 'United States', schoolHolidays: false },
  ]);
});

test('getCountries: OpenHolidays nicht erreichbar -> die lokalen Laender bleiben waehlbar (#965 Review)', async () => {



  __setFetchImpl(async () => { throw new Error('network down'); });
  let list;
  const lines = await captureConsole(async () => { list = await getCountries(); });
  assert.deepEqual(list, [
    { isoCode: 'AU', name: 'Australia', schoolHolidays: false },
    { isoCode: 'BR', name: 'Brazil', schoolHolidays: false },
    { isoCode: 'CA', name: 'Canada', schoolHolidays: false },
    { isoCode: 'NZ', name: 'New Zealand', schoolHolidays: false },
    { isoCode: 'GB', name: 'United Kingdom', schoolHolidays: false },
    { isoCode: 'US', name: 'United States', schoolHolidays: false },
  ]);
  assert.ok(lines.warn.some((l) => /Countries/.test(l)),
    'der Ausfall gehoert ins Log - sonst sieht der Betreiber nie, warum nur sechs Laender da sind');
});

test('sync: ein lokal berechnetes Land synchronisiert auch komplett offline (#965 Review)', async () => {




  // gerettet, ihn aber als Fehlschlag verbucht (failed -> Reparaturmarke).
  __setFetchImpl(async () => { throw new Error('network down'); });
  setConfig({ holiday_country: 'GB', holiday_subdivision: 'GB-SCT', holiday_show_public: '1', holiday_show_school: '0' });

  const res = await sync(true);

  assert.equal(res.synced, SYNC_YEAR_SPAN * 9);
  assert.equal(res.incomplete, false, 'offline ist fuer ein lokales Land kein Fehlschlag');
  assert.equal(db.prepare("SELECT value FROM sync_config WHERE key='holiday_retry_after'").get()?.value, undefined,
    'und darf deshalb auch keine Reparaturmarke hinterlassen');
});

test('getCountries: an API-listed local country is not duplicated - the API entry wins', async () => {


  // zweiter Eintrag erscheinen.
  __setFetchImpl(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/Countries') {
      return okJson([{ isoCode: 'BR', name: [{ language: 'EN', text: 'Brazil (API)' }] }]);
    }
    return okJson([]);
  });
  const list = await getCountries();
  const brEntries = list.filter((c) => c.isoCode === 'BR');
  assert.equal(brEntries.length, 1);
  assert.equal(brEntries[0].name, 'Brazil (API)');
  assert.equal(brEntries[0].schoolHolidays, undefined, 'der API-Eintrag traegt kein schoolHolidays-Flag');
});

test('getSubdivisions: GB is answered locally, without an API call (#965)', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  const list = await getSubdivisions('GB');
  assert.deepEqual(list, [
    { isoCode: 'GB-ENG', name: 'England and Wales' },
    { isoCode: 'GB-NIR', name: 'Northern Ireland' },
    { isoCode: 'GB-SCT', name: 'Scotland' },
  ]);
  assert.equal(mock.calls.length, 0, 'GB ist kein echtes OpenHolidays-Land - kein Netzwerkaufruf noetig');
});

test('getGroups: GB has none, answered locally without an API call', async () => {
  const mock = makeApiMock();
  __setFetchImpl(mock);
  assert.deepEqual(await getGroups('GB', 'GB-ENG'), []);
  assert.equal(mock.calls.length, 0);
});

test('getSubdivisions: maps code/name, falls back to shortName, sorts', async () => {
  __setFetchImpl(makeApiMock());
  const list = await getSubdivisions('DE');
  assert.deepEqual(list, [
    { isoCode: 'DE-BY', name: 'Bavaria' },
    { isoCode: 'DE-BW', name: 'BW' },
  ]);
});

test('teardown: restore real database', () => {
  _resetTestDatabase();
});
