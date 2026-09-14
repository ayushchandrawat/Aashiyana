
// Deckt den echten Live-Pfad ab: parseICS (Sync) -> DB-Event-Shape ->
// expandRecurringEvents (Lesen). Asserts kodieren das KORREKTE Verhalten;

import { parseICS, normalizeRecurrenceOverrides } from '../server/services/ics-parser.js';
import { expandRecurringEvents } from '../server/services/calendar-events.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}: ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }


// (start_datetime=dtstart, all_day, end_datetime=dtend, recurrence_rule=rrule).
function syncedEvent(ics) {
  const [ev] = parseICS(ics);
  return {
    id: 1,
    start_datetime: ev.dtstart,
    end_datetime: ev.dtend,
    all_day: ev.allDay ? 1 : 0,
    recurrence_rule: ev.rrule,
  };
}

// Menge der Instanz-Tage (YYYY-MM-DD) innerhalb [from, to].
function occDays(ics, from, to) {
  const inst = expandRecurringEvents([syncedEvent(ics)], from, to);
  return inst.map((e) => e.start_datetime.slice(0, 10));
}

const VCAL = (body) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n${body}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

console.log('\n[CalDAV-Recurrence-Test #549]\n');

// Wochentage der Testwoche 2026-07:
//   Sa 18 · So 19 · Mo 20 · Di 21 · Mi 22 · Do 23 · Fr 24 · Sa 25 · So 26

// --- Hypothese A: iOS "jeden Wochentag" als FREQ=DAILY;BYDAY=MO..FR ---


test('DAILY;BYDAY=MO-FR: nur Werktage, kein Sa/So', () => {
  const ics = VCAL(
    'UID:daily-weekday@x\r\nSUMMARY:Schule\r\n' +
    'DTSTART:20260720T080000Z\r\nDTEND:20260720T090000Z\r\n' +
    'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'
  );
  const days = occDays(ics, '2026-07-20', '2026-07-26');
  assert(!days.includes('2026-07-25'), `Sa 25. darf nicht vorkommen: ${days.join()}`);
  assert(!days.includes('2026-07-26'), `So 26. darf nicht vorkommen: ${days.join()}`);
  assert(days.length === 5, `erwartet 5 Werktage, bekam ${days.length}: ${days.join()}`);
});




test('WEEKLY;BYDAY=MO-FR mit DTSTART am Sa: keine Sa-Instanz', () => {
  const ics = VCAL(
    'UID:weekly-anchor-sat@x\r\nSUMMARY:Schule\r\n' +
    'DTSTART:20260718T080000Z\r\nDTEND:20260718T090000Z\r\n' +
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
  );
  const days = occDays(ics, '2026-07-18', '2026-07-24');
  assert(!days.includes('2026-07-18'), `Sa 18. (DTSTART) darf nicht erscheinen: ${days.join()}`);
  assert(days[0] === '2026-07-20', `erste Instanz sollte Mo 20. sein: ${days.join()}`);
  assert(days.length === 5, `erwartet Mo-Fr (5 Tage im Fenster), bekam ${days.length}: ${days.join()}`);
});


test('WEEKLY;BYDAY=MO-FR mit DTSTART am Mo: 5 Werktage (Kontrolle)', () => {
  const ics = VCAL(
    'UID:weekly-clean@x\r\nSUMMARY:Schule\r\n' +
    'DTSTART:20260720T080000Z\r\nDTEND:20260720T090000Z\r\n' +
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
  );
  const days = occDays(ics, '2026-07-20', '2026-07-26');
  assert(days.join() === '2026-07-20,2026-07-21,2026-07-22,2026-07-23,2026-07-24',
    `erwartet Mo-Fr, bekam: ${days.join()}`);
});

// --------------------------------------------------------


// CalDAV/ICS-Inbound-Upsert schreibt per external_calendar_id — ohne


// --------------------------------------------------------




function syncObject(ics) {
  const normalized = normalizeRecurrenceOverrides(parseICS(ics));
  const rows = new Map();       // external uid -> row
  const exceptions = new Map(); // row.id -> Set<YYYY-MM-DD>
  let nextId = 1;
  for (const ev of normalized) {
    let row = rows.get(ev.uid);
    if (!row) { row = { id: nextId++ }; rows.set(ev.uid, row); }
    row.start_datetime  = ev.dtstart;
    row.end_datetime    = ev.dtend;
    row.all_day         = ev.allDay ? 1 : 0;
    row.recurrence_rule = ev.rrule;
    row.tzid            = ev.tzid ?? null;
    if (ev.rrule && Array.isArray(ev.exdates) && ev.exdates.length) {
      if (!exceptions.has(row.id)) exceptions.set(row.id, new Set());
      for (const d of ev.exdates) exceptions.get(row.id).add(d);
    }
  }
  return { events: [...rows.values()], exceptions };
}

function instancesMulti(ics, from, to) {
  const { events, exceptions } = syncObject(ics);
  return expandRecurringEvents(events, from, to, exceptions)
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
}
function occDaysMulti(ics, from, to) {
  return instancesMulti(ics, from, to).map((e) => e.start_datetime.slice(0, 10));
}

// Master (MO,TU) + ein verlegtes Vorkommen (Di 21.07. → 10:00 Uhr).
const MASTER_PLUS_OVERRIDE =
  'BEGIN:VCALENDAR\r\n' +
  'BEGIN:VEVENT\r\nUID:series@x\r\nSUMMARY:Schule\r\n' +
  'DTSTART:20260720T080000Z\r\nDTEND:20260720T090000Z\r\n' +
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU\r\nEND:VEVENT\r\n' +
  'BEGIN:VEVENT\r\nUID:series@x\r\nSUMMARY:Schule (verlegt)\r\n' +
  'RECURRENCE-ID:20260721T080000Z\r\n' +
  'DTSTART:20260721T100000Z\r\nDTEND:20260721T110000Z\r\nEND:VEVENT\r\n' +
  'END:VCALENDAR';

test('Master+RECURRENCE-ID: Serie überlebt (kein Collapse zum Einzeltermin)', () => {
  const { events } = syncObject(MASTER_PLUS_OVERRIDE);
  const master = events.find((e) => e.recurrence_rule);
  assert(master, 'Master-Zeile mit RRULE muss existieren (nicht überschrieben)');
  assert(/BYDAY=MO,TU/.test(master.recurrence_rule), `RRULE erhalten: ${master.recurrence_rule}`);
  assert(master.start_datetime.slice(0, 10) === '2026-07-20',
    `Master-Start bleibt Mo 20.07.: ${master.start_datetime}`);
});

test('Master+RECURRENCE-ID: Serie läuft über Wochen weiter (nicht kollabiert)', () => {
  const days = occDaysMulti(MASTER_PLUS_OVERRIDE, '2026-07-20', '2026-08-03');
  // Mo/Di jede Woche: 20,21 · 27,28 · 03. (21. kommt vom Override, s.u.)
  for (const d of ['2026-07-20', '2026-07-27', '2026-07-28', '2026-08-03']) {
    assert(days.includes(d), `${d} muss vorkommen: ${days.join()}`);
  }
});

test('RECURRENCE-ID: Original-Slot unterdrückt, verlegte Instanz sichtbar (kein Doppel)', () => {
  const inst = instancesMulti(MASTER_PLUS_OVERRIDE, '2026-07-20', '2026-07-26');
  const on21 = inst.filter((e) => e.start_datetime.slice(0, 10) === '2026-07-21');
  assert(on21.length === 1, `genau eine Instanz am 21.07. (kein Original+Override-Doppel): ${on21.length}`);
  assert(on21[0].start_datetime.includes('T10:00:00'),
    `die sichtbare 21.07.-Instanz ist die verlegte (10:00): ${on21[0].start_datetime}`);
});

test('CalDAV-EXDATE wird als Ausnahme angewandt (Feiertag fällt aus)', () => {
  const ics =
    'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:exd@x\r\nSUMMARY:Schule\r\n' +
    'DTSTART:20260720T080000Z\r\nDTEND:20260720T090000Z\r\n' +
    'EXDATE:20260727T080000Z\r\n' +            // Mo 27.07. ausgenommen
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const days = occDaysMulti(ics, '2026-07-20', '2026-08-01');
  assert(!days.includes('2026-07-27'), `Mo 27.07. muss ausfallen (EXDATE): ${days.join()}`);
  assert(days.includes('2026-07-20') && days.includes('2026-07-28'),
    `andere Werktage bleiben: ${days.join()}`);
});

// --------------------------------------------------------



// --------------------------------------------------------

// Lokale Wanduhrzeit (HH:MM Europe/Berlin) einer Instanz.
function localHM(iso) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}


const TZ_SERIES =
  'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:tz@x\r\nSUMMARY:Schule\r\n' +
  'DTSTART;TZID=Europe/Berlin:20250924T072500\r\n' +
  'DTEND;TZID=Europe/Berlin:20250924T081000\r\n' +
  'RRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR';

test('TZID-Serie: gleiche Ortszeit im Sommer UND Winter (kein DST-Drift)', () => {
  const summer = instancesMulti(TZ_SERIES, '2026-04-01', '2026-04-02'); // CEST
  const winter = instancesMulti(TZ_SERIES, '2025-12-10', '2025-12-11'); // CET
  assert(summer.length === 1 && winter.length === 1, `je 1 Instanz: ${summer.length}/${winter.length}`);
  assert(localHM(summer[0].start_datetime) === '07:25', `Sommer 07:25: ${localHM(summer[0].start_datetime)}`);
  assert(localHM(winter[0].start_datetime) === '07:25', `Winter 07:25 (nicht 06:25): ${localHM(winter[0].start_datetime)}`);
});

test('TZID-Serie: Instanz bleibt am korrekten Wochentag (Mi, Tag-24-Master)', () => {
  const inst = instancesMulti(TZ_SERIES, '2025-12-10', '2025-12-11'); // Mi 10.12.
  assert(inst[0].start_datetime.slice(0, 10) === '2025-12-10', `Datum: ${inst[0].start_datetime}`);
});

// --------------------------------------------------------

//



// --------------------------------------------------------

test('jaehrliche Serie am 29. Februar kehrt im Schaltjahr zurueck', () => {
  const tage = occDays(VCAL('UID:yearly-leap@x\r\nSUMMARY:Serie\r\nDTSTART;VALUE=DATE:20240229\r\nDTEND;VALUE=DATE:20240301\r\nRRULE:FREQ=YEARLY'),
    '2024-01-01', '2028-12-31');
  assert(tage.includes('2024-02-29'), `Start fehlt: ${tage.join(', ')}`);
  assert(tage.includes('2025-02-28'), `im Nicht-Schaltjahr geklemmt: ${tage.join(', ')}`);
  assert(tage.includes('2028-02-29'), `2028 ist ein Schaltjahr, bekommen: ${tage.join(', ')}`);
});

test('monatliche Serie am 31. behaelt ihren Tag ueber den Februar hinweg', () => {
  const tage = occDays(VCAL('UID:monthly-31@x\r\nSUMMARY:Serie\r\nDTSTART;VALUE=DATE:20260131\r\nDTEND;VALUE=DATE:20260201\r\nRRULE:FREQ=MONTHLY'),
    '2026-01-01', '2026-06-30');
  assert(tage.includes('2026-02-28'), `der kurze Monat wird geklemmt: ${tage.join(', ')}`);
  assert(tage.includes('2026-03-31'), `und der 31. kommt zurueck: ${tage.join(', ')}`);
  assert(tage.includes('2026-05-31'), `auch spaeter noch: ${tage.join(', ')}`);

  const monate = new Set(tage.map((d) => d.slice(0, 7)));
  assert(monate.size === 6, `sechs Monate erwartet, bekommen ${monate.size}: ${[...monate].join(', ')}`);
});

test('BYMONTHDAY=-1 trifft ueber den ganzen Weg den letzten Tag', () => {
  const tage = occDays(VCAL('UID:monthly-last@x\r\nSUMMARY:Serie\r\nDTSTART;VALUE=DATE:20260115\r\nDTEND;VALUE=DATE:20260116\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1'),
    '2026-02-01', '2026-05-31');
  assert(tage.length >= 4, `zu wenige Vorkommen: ${tage.join(', ')}`);
  for (const d of tage) {
    const [y, m, day] = d.split('-').map(Number);
    assert(day === new Date(Date.UTC(y, m, 0)).getUTCDate(), `${d} ist nicht der letzte Tag`);
  }
});

// --------------------------------------------------------

// --------------------------------------------------------

test('COUNT zaehlt keine Tage, die BYDAY herausfiltert', () => {






  // treffen.
  const tage = occDays(VCAL('UID:byday-count@x\r\nSUMMARY:Serie\r\n'
    + 'DTSTART;VALUE=DATE:20260831\r\nDTEND;VALUE=DATE:20260901\r\n'
    + 'RRULE:FREQ=MONTHLY;BYDAY=MO;COUNT=2'), '2026-01-01', '2027-12-31');
  assert(tage.length === 2, `zwei Vorkommen erwartet, bekommen ${tage.length}: ${tage.join(', ')}`);
  assert(tage[0] === '2026-08-31', `erstes: ${tage[0]}`);
});

test('COUNT zaehlt ein ausgenommenes Vorkommen weiterhin mit (RFC 5545, #513)', () => {




  const ev = {
    id: 7, start_datetime: '2026-09-01', end_datetime: '2026-09-02',
    all_day: 1, recurrence_rule: 'FREQ=DAILY;COUNT=3',
  };
  const tage = expandRecurringEvents([ev], '2026-01-01', '2027-12-31',
    new Map([[7, new Set(['2026-09-02'])]])).map((e) => e.start_datetime.slice(0, 10));
  assert(tage.length === 2, `drei gezaehlt, eines ausgenommen -> zwei sichtbar, bekommen ${tage.join(', ')}`);
  assert(!tage.includes('2026-09-02'), 'das ausgenommene erscheint nicht');
  assert(tage.includes('2026-09-03'), 'und das dritte erscheint, statt der Ausnahme zum Opfer zu fallen');
});

test('ein DTSTART, das die Regel nicht erfuellt, ist kein Vorkommen', () => {




  const tage = occDays(VCAL('UID:unsync@x\r\nSUMMARY:Zaehlerstand\r\n'
    + 'DTSTART;VALUE=DATE:20260115\r\nDTEND;VALUE=DATE:20260116\r\n'
    + 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1'), '2026-01-01', '2026-04-30');
  assert(!tage.includes('2026-01-15'), `der 15. ist kein Vorkommen der Regel: ${tage.join(', ')}`);
  assert(tage[0] === '2026-01-31', `der erste Termin ist der 31. Januar, bekommen ${tage[0]}`);
  assert(tage.join(',') === '2026-01-31,2026-02-28,2026-03-31,2026-04-30', tage.join(', '));



  const synchron = occDays(VCAL('UID:sync@x\r\nSUMMARY:Zaehlerstand\r\n'
    + 'DTSTART;VALUE=DATE:20260131\r\nDTEND;VALUE=DATE:20260201\r\n'
    + 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1'), '2026-01-01', '2026-04-30');
  assert(synchron.join(',') === tage.join(','), `synchron: ${synchron.join(', ')}`);
});

test('eine Serie mit eigener Zone verliert ihr Monatsende nicht', () => {



  //



  const ev = {
    id: 42, tzid: 'America/New_York',
    start_datetime: '2026-02-01T01:00:00Z', end_datetime: '2026-02-01T02:00:00Z',
    all_day: 0, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
  };


  const inst = expandRecurringEvents([ev], '2026-01-01', '2026-04-30');
  assert(inst.length >= 3, `die Serie darf nicht leer werden, bekommen ${inst.length}`);






  const lokal = inst.map((e) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(e.start_datetime)));
  for (const tag of lokal) {
    const [y, m, d] = tag.split('-').map(Number);
    const letzter = new Date(Date.UTC(y, m, 0)).getUTCDate();
    assert(d === letzter, `${tag} ist lokal nicht der Monatsletzte (${letzter}.)`);
  }


  // seit #985 seinen eigenen Test direkt darunter: 20:00 New Yorker Zeit hat

});

test('eine Serie spaet abends behaelt ihr Monatsende ueber die Zeitumstellung', () => {





  // verpasstes Vorkommen, sondern alle folgenden.
  const ev = {
    id: 43, tzid: 'America/New_York',
    start_datetime: '2026-02-01T04:30:00Z', end_datetime: '2026-02-01T05:00:00Z',
    all_day: 0, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
  };
  const inst = expandRecurringEvents([ev], '2026-01-01', '2026-06-30');
  assert(inst.length >= 5, `mindestens fuenf Vorkommen erwartet, bekommen ${inst.length}`);

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  for (const e of inst) {
    const lokal = fmt.format(new Date(e.start_datetime));
    const [tag, zeit] = lokal.split(', ');
    const [y, m, d] = tag.split('-').map(Number);
    const letzter = new Date(Date.UTC(y, m, 0)).getUTCDate();
    assert(d === letzter, `${tag} ist lokal nicht der Monatsletzte (${letzter}.)`);



    assert(zeit === '23:30', `${lokal}: die lokale Uhrzeit muss 23:30 bleiben`);
  }
});

test('eine Ausnahme greift auch bei einer Serie, die lokal gerechnet wird', () => {






  const ev = {
    id: 44, tzid: 'America/New_York',
    start_datetime: '2026-02-01T04:30:00Z', end_datetime: '2026-02-01T05:00:00Z',
    all_day: 0, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
  };


  const ausnahmen = new Map([[44, new Set(['2026-04-01'])]]);

  const ohne = expandRecurringEvents([ev], '2026-01-01', '2026-06-30');
  const mit  = expandRecurringEvents([ev], '2026-01-01', '2026-06-30', ausnahmen);
  assert(mit.length === ohne.length - 1,
    `die Ausnahme muss genau ein Vorkommen entfernen (ohne ${ohne.length}, mit ${mit.length})`);

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const tage = mit.map((e) => fmt.format(new Date(e.start_datetime)));
  assert(!tage.includes('2026-03-31'), `der ausgenommene 31. Maerz steht noch drin: ${tage.join(', ')}`);
  assert(tage.includes('2026-04-30'), 'die uebrigen Vorkommen muessen bleiben');
});

const traegtZone = (wert) => /(?:Z|[+-]\d{2}:?\d{2})$/.test(String(wert ?? ''));

test('Serie mit Offset-Start: das Ende traegt ebenfalls seine Zone (#1089)', () => {
  const ev = {
    id: 1089,


    start_datetime: '2026-09-09T15:25:00-04:00',
    end_datetime:   '2026-09-09T15:30:00-04:00',
    all_day: 0,
    tzid: 'America/New_York',
    recurrence_rule: 'FREQ=WEEKLY',
  };
  const inst = expandRecurringEvents([ev], '2026-09-09', '2026-09-24');
  assert(inst.length >= 2, `zu wenige Vorkommen: ${inst.length}`);

  for (const e of inst) {
    assert(traegtZone(e.start_datetime), `Start ohne Zone: ${e.start_datetime}`);


    assert(traegtZone(e.end_datetime),
      `das Ende hat seine Zone verloren und wird darum nicht umgerechnet: ${e.end_datetime}`);

    const dauer = (new Date(e.end_datetime) - new Date(e.start_datetime)) / 60000;
    assert(dauer === 5, `Dauer verschoben: ${dauer} Minuten statt 5 (${e.start_datetime} bis ${e.end_datetime})`);
  }
});

test('Serie ohne Zone behaelt ihre Wanduhrzeit an BEIDEN Enden (Gegenprobe zu #1089)', () => {


  // auf UTC umstellte, verschoebe jeden lokal angelegten Serientermin.
  const ev = {
    id: 1090,
    start_datetime: '2026-09-09T15:25',
    end_datetime:   '2026-09-09T15:30',
    all_day: 0,
    tzid: null,
    recurrence_rule: 'FREQ=WEEKLY',
  };
  const inst = expandRecurringEvents([ev], '2026-09-09', '2026-09-24');
  assert(inst.length >= 2, `zu wenige Vorkommen: ${inst.length}`);
  for (const e of inst) {
    assert(!traegtZone(e.start_datetime), `Start unerwartet zonentragend: ${e.start_datetime}`);
    assert(!traegtZone(e.end_datetime), `Ende unerwartet zonentragend: ${e.end_datetime}`);
    assert(e.end_datetime.endsWith('T15:30'), `Wanduhrzeit verschoben: ${e.end_datetime}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
