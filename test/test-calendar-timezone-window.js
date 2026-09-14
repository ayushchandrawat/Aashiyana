process.env.TZ = 'America/Los_Angeles';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const dbmod = await import('../server/db.js');
const { default: calendarRouter } = await import('../server/routes/calendar.js');
const { __test: cal } = await import('../public/pages/calendar.js');
const db = dbmod.get();

db.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES ('admin','Admin','x','admin')").run();

const app = express();
app.use((req, _res, next) => {
  req.authUserId = 1; req.authRole = 'admin';
  req.session = { userId: 1, role: 'admin' };
  next();
});
app.use('/', calendarRouter);
const server = app.listen(0);
const baseUrl = await new Promise((r) => server.on('listening', () => r(`http://127.0.0.1:${server.address().port}`)));
test.after(() => server.close());

function insertEvent(title, start, end) {
  db.prepare(`
    INSERT INTO calendar_events
      (title, start_datetime, end_datetime, created_by, color, icon, visibility,
       external_source, all_day, user_modified)
    VALUES (?, ?, ?, 1, '#007AFF', 'calendar', 'all', 'caldav', 0, 0)
  `).run(title, start, end);
}


insertEvent('Abend 19:00',   '2035-03-13T02:00:00Z', '2035-03-13T03:00:00Z'); // Di 12.03. lokal
insertEvent('Vormittag 09:00', '2035-03-12T16:00:00Z', '2035-03-12T17:00:00Z'); // Di 12.03. lokal
insertEvent('Vortag 19:00',  '2035-03-12T02:00:00Z', '2035-03-12T03:00:00Z'); // Mo 11.03. lokal

const pad = (n) => String(n).padStart(2, '0');
const localDate = (str) => {
  if (!str || str.length <= 10) return (str || '').slice(0, 10);
  const d = new Date(str);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function fetchRange(from, to) {
  const res = await fetch(`${baseUrl}/?from=${from}&to=${to}`);
  return (await res.json()).data;
}

function eventsOnDay(rows, cursor) {
  return rows.filter((e) => {
    const start = localDate(e.start_datetime);
    const end   = localDate(e.end_datetime || e.start_datetime);
    const from  = start < cursor ? cursor : start;
    const to    = end   > cursor ? cursor : end;
    return from <= to;
  }).map((e) => e.title).sort();
}

test('fetchWindow weitet das Anzeigefenster um genau einen Tag je Seite', () => {
  assert.deepEqual(cal.fetchWindow('2035-03-12', '2035-03-12'), { from: '2035-03-11', to: '2035-03-13' });
  assert.deepEqual(cal.fetchWindow('2035-03-01', '2035-03-31'), { from: '2035-02-28', to: '2035-04-01' });
});

test('Gegenprobe: ohne Puffer verliert die Tagesansicht den Abendtermin', async () => {
  const rows = await fetchRange('2035-03-12', '2035-03-12');
  assert.deepEqual(eventsOnDay(rows, '2035-03-12'), ['Vormittag 09:00'],
    'Ohne diese Gegenprobe wäre der Test unten auch bei kaputtem Puffer grün');
});

test('Tagesansicht zeigt mit Puffer alle Termine des lokalen Tages (#824)', async () => {
  const win  = cal.fetchWindow('2035-03-12', '2035-03-12');
  const rows = await fetchRange(win.from, win.to);
  assert.deepEqual(eventsOnDay(rows, '2035-03-12'), ['Abend 19:00', 'Vormittag 09:00']);
});

test('Der Puffer blendet keine Nachbartage ein', async () => {
  const win  = cal.fetchWindow('2035-03-12', '2035-03-12');
  const rows = await fetchRange(win.from, win.to);
  assert.ok(!eventsOnDay(rows, '2035-03-12').includes('Vortag 19:00'),
    'Der Montagstermin gehört auf den 11.03., nicht in die Tagesansicht des 12.03.');
  assert.deepEqual(eventsOnDay(rows, '2035-03-11'), ['Vortag 19:00']);
});

test('Wochenfenster verliert den Abendtermin am rechten Rand nicht', async () => {
  const win  = cal.fetchWindow('2035-03-06', '2035-03-12');
  const rows = await fetchRange(win.from, win.to);
  assert.ok(eventsOnDay(rows, '2035-03-12').includes('Abend 19:00'));
});

test('Östlich von UTC bleibt die Zuordnung korrekt', async () => {
  const prevTz = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {

    const win  = cal.fetchWindow('2035-03-12', '2035-03-12');
    const rows = await fetchRange(win.from, win.to);
    const titles = eventsOnDay(rows, '2035-03-12');
    assert.ok(titles.includes('Vortag 19:00'), 'in Tokio ist 2035-03-12T02:00Z der 12.03. um 11:00');
    assert.ok(!titles.includes('Abend 19:00'), '2035-03-13T02:00Z ist in Tokio der 13.03.');
  } finally {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  }
});
