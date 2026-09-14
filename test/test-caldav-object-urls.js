
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withoutBlockComments } from './source-text.js';
import { calendarObjectUrlFilter, withCalendarObjectUrlFilter } from '../server/utils/caldav-client.js';
import { parseICS } from '../server/services/ics-parser.js';

const SERVER_DIR = new URL('../server/', import.meta.url).pathname;
const OWNER = 'utils/caldav-client.js';

function jsFilesUnder(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...jsFilesUnder(join(dir, entry.name), rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}


const COLLECTION = 'https://mail.example.org/dav/cal/haushalt/default/';

// --------------------------------------------------------
// 1. Der Filter
// --------------------------------------------------------

test('Objekt ohne .ics-Endung wird durchgelassen (der Fall aus #883)', () => {
  const keep = calendarObjectUrlFilter(COLLECTION);
  assert.ok(keep('https://mail.example.org/dav/cal/haushalt/default/NZtPkIOMoK'), 'JMAP-Objektname abgewiesen');
});

test('Objekt mit .ics-Endung wird weiterhin durchgelassen', () => {
  const keep = calendarObjectUrlFilter(COLLECTION);
  assert.ok(keep('https://mail.example.org/dav/cal/haushalt/default/9f3a-1.ics'), '.ics-Objekt abgewiesen');
});

test('Die Collection selbst wird abgewiesen - mit und ohne Schrägstrich', () => {
  const keep = calendarObjectUrlFilter(COLLECTION);
  assert.ok(!keep('https://mail.example.org/dav/cal/haushalt/default/'), 'Collection mit Schrägstrich durchgelassen');
  assert.ok(!keep('https://mail.example.org/dav/cal/haushalt/default'),  'Collection ohne Schrägstrich durchgelassen');
});

test('Collection ohne Schrägstrich angegeben: beide Schreibweisen fallen weg', () => {
  const keep = calendarObjectUrlFilter('https://mail.example.org/dav/cal/haushalt/default');
  assert.ok(!keep('https://mail.example.org/dav/cal/haushalt/default/'), 'mit Schrägstrich durchgelassen');
  assert.ok(!keep('https://mail.example.org/dav/cal/haushalt/default'),  'ohne Schrägstrich durchgelassen');
  assert.ok(keep('https://mail.example.org/dav/cal/haushalt/default/NZtPkIOMoK'), 'Objekt abgewiesen');
});

test('Unter-Collections und leere hrefs fallen weg', () => {
  const keep = calendarObjectUrlFilter(COLLECTION);
  assert.ok(!keep('https://mail.example.org/dav/cal/haushalt/default/archiv/'), 'Unter-Collection durchgelassen');
  assert.ok(!keep(''),        'leerer href durchgelassen');
  assert.ok(!keep(null),      'null durchgelassen');
  assert.ok(!keep(undefined), 'undefined durchgelassen');
});

test('Relativer href wird gegen dieselbe Regel gemessen wie ein absoluter', () => {
  const keep = calendarObjectUrlFilter(COLLECTION);
  assert.ok(keep('/dav/cal/haushalt/default/NZtPkIOMoK'), 'relatives Objekt abgewiesen');
  assert.ok(!keep('/dav/cal/haushalt/default/'),          'relative Collection durchgelassen');
});

// --------------------------------------------------------


//    genau dann, wenn `urlFilter` fehlt.
// --------------------------------------------------------

function fakeClient() {
  const calls = [];
  return {
    calls,
    fetchCalendars:       () => [],
    fetchCalendarObjects: (params) => { calls.push(params); return []; },
  };
}

test('withCalendarObjectUrlFilter hängt einen urlFilter an', async () => {
  const raw = fakeClient();
  const client = withCalendarObjectUrlFilter(raw);
  await client.fetchCalendarObjects({ calendar: { url: COLLECTION } });
  const [params] = raw.calls;
  assert.ok(typeof params.urlFilter === 'function', 'kein urlFilter übergeben - tsdavs .ics-Default greift');
  assert.ok(params.urlFilter(`${COLLECTION}NZtPkIOMoK`), 'übergebener Filter weist das Objekt ab');
});

test('Ein explizit übergebener urlFilter gewinnt', async () => {
  const raw = fakeClient();
  const client = withCalendarObjectUrlFilter(raw);
  const own = () => false;
  await client.fetchCalendarObjects({ calendar: { url: COLLECTION }, urlFilter: own });
  assert.ok(raw.calls[0].urlFilter === own, 'eigener Filter wurde überschrieben');
});

test('Auch der Outbound-Pfad mit objectUrls bekommt den Filter', async () => {


  const raw = fakeClient();
  const client = withCalendarObjectUrlFilter(raw);
  await client.fetchCalendarObjects({
    calendar:   { url: COLLECTION },
    objectUrls: [`${COLLECTION}NZtPkIOMoK`],
  });
  assert.ok(raw.calls[0].urlFilter(`${COLLECTION}NZtPkIOMoK`), 'objectUrl würde weggefiltert');
});

test('Die übrigen Client-Methoden bleiben erreichbar', () => {
  const client = withCalendarObjectUrlFilter(fakeClient());
  assert.ok(typeof client.fetchCalendars === 'function', 'fetchCalendars verloren');
});

test('Auch Methoden am Prototyp überleben den Wrapper', () => {





  // deshalb eigens gestellt.
  class DavLike {
    fetchCalendars() { return 'aus dem Prototyp'; }
    deleteCalendarObject() { return 'auch aus dem Prototyp'; }
    fetchCalendarObjects() { return []; }
  }
  const client = withCalendarObjectUrlFilter(new DavLike());
  assert.equal(client.fetchCalendars(), 'aus dem Prototyp', 'fetchCalendars vom Prototyp verloren');
  assert.equal(client.deleteCalendarObject(), 'auch aus dem Prototyp', 'deleteCalendarObject verloren');
});

test('Ein Bezeichner im Query darf auf einen Schrägstrich enden', () => {


  // so endet, fiele still heraus.
  const keep = calendarObjectUrlFilter('https://mail.example.org/dav/calendar?collection=home');
  assert.ok(keep('https://mail.example.org/dav/calendar?object=folder/item/'),
    'Objekt mit Schrägstrich im Query-Bezeichner abgewiesen');
  assert.ok(keep('https://mail.example.org/dav/calendar/?object=x'),
    'Objekt hinter einem Collection-Pfad abgewiesen');
  assert.ok(!keep('https://mail.example.org/dav/cal/x/default/'),
    'echte Collection ohne Query durchgelassen');
});

test('Objekt und Collection werden über den vollen Bezeichner getrennt, nicht nur den Pfad', () => {



  const keep = calendarObjectUrlFilter('https://mail.example.org/dav/calendar?collection=home');
  assert.ok(keep('https://mail.example.org/dav/calendar?object=NZtPkIOMoK'), 'Objekt am Query abgewiesen');
  assert.ok(!keep('https://mail.example.org/dav/calendar?collection=home'), 'Collection durchgelassen');
});

test('createCalDAVClient reicht seinen Client durch den Wrapper', () => {




  const src = withoutBlockComments(readFileSync(join(SERVER_DIR, OWNER), 'utf-8'));
  const body = src.slice(src.indexOf('export async function createCalDAVClient'));
  const end  = body.indexOf('\n}');
  assert.ok(end > 0, 'createCalDAVClient nicht auffindbar');
  assert.ok(
    /withCalendarObjectUrlFilter\(/.test(body.slice(0, end)),
    'createCalDAVClient gibt seinen Client nicht durch withCalendarObjectUrlFilter - tsdavs .ics-Default greift wieder',
  );
});

// --------------------------------------------------------
// 3. Regel-Guard: kein zweiter CalDAV-Client an der Factory vorbei



// --------------------------------------------------------

test('Nur caldav-client.js erzeugt einen CalDAV-tsdav-Client', () => {
  const offenders = jsFilesUnder(SERVER_DIR)
    .filter((rel) => rel !== OWNER)
    .filter((rel) => /defaultAccountType:\s*'caldav'/.test(readFileSync(join(SERVER_DIR, rel), 'utf-8')));
  assert.ok(
    offenders.length === 0,
    `umgeht den urlFilter aus caldav-client.js: ${offenders.join(', ')} - Client über createCalDAVClient() beziehen`,
  );
});

test('Der Guard misst überhaupt etwas', () => {


  const owner = readFileSync(join(SERVER_DIR, OWNER), 'utf-8');
  assert.ok(/defaultAccountType:\s*'caldav'/.test(owner), `${OWNER} trägt das gesuchte Muster nicht mehr`);
  assert.ok(jsFilesUnder(SERVER_DIR).length > 20, 'Dateiliste unplausibel kurz');
});

// --------------------------------------------------------

// --------------------------------------------------------

const JMAP_VEVENT = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20260924T190000',
  'UID:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'TRANSP:OPAQUE',
  'DTSTAMP:20260826T131133Z',
  'DURATION:PT2H',
  'SUMMARY:Elternabend',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('DURATION ohne DTEND und TZID ohne VTIMEZONE werden geparst', () => {
  const [ev] = parseICS(JMAP_VEVENT);
  assert.ok(ev, 'Event wurde verworfen');
  assert.ok(ev.dtstart === '2026-09-24T17:00:00Z', `dtstart: ${ev.dtstart}`);
  assert.ok(ev.dtend   === '2026-09-24T19:00:00Z', `dtend aus DURATION: ${ev.dtend}`);
  assert.ok(ev.tzid    === 'Europe/Berlin',        `tzid: ${ev.tzid}`);
});

// --------------------------------------------------------
// 5. Sichtbarkeit: was der Parser verwirft, benennt er
// --------------------------------------------------------

test('onSkip meldet einen VEVENT ohne UID', () => {
  const skipped = [];
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Ohne UID\r\nDTSTART:20260601T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.ok(parseICS(ics, { onSkip: (i) => skipped.push(i) }).length === 0, 'sollte übersprungen werden');
  assert.ok(skipped.length === 1, `erwartet 1 Meldung, bekam ${skipped.length}`);
  assert.ok(/UID/i.test(skipped[0].reason), `Grund nennt UID nicht: ${skipped[0].reason}`);
});

test('onSkip meldet einen VEVENT ohne DTSTART mitsamt seiner UID', () => {
  const skipped = [];
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:kaputt@x\r\nSUMMARY:Ohne Start\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.ok(parseICS(ics, { onSkip: (i) => skipped.push(i) }).length === 0, 'sollte übersprungen werden');
  assert.ok(skipped.length === 1, `erwartet 1 Meldung, bekam ${skipped.length}`);
  assert.ok(skipped[0].uid === 'kaputt@x', `UID fehlt in der Meldung: ${skipped[0].uid}`);
  assert.ok(/DTSTART/i.test(skipped[0].reason), `Grund nennt DTSTART nicht: ${skipped[0].reason}`);
});

test('Ein sauberer VEVENT löst keine Meldung aus', () => {
  const skipped = [];
  assert.ok(parseICS(JMAP_VEVENT, { onSkip: (i) => skipped.push(i) }).length === 1, 'sollte geparst werden');
  assert.ok(skipped.length === 0, `unerwartete Meldung: ${JSON.stringify(skipped)}`);
});

test('parseICS bleibt ohne zweites Argument aufrufbar', () => {
  assert.ok(parseICS(JMAP_VEVENT).length === 1, 'Signatur gebrochen');
});
