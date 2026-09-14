
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';





const { outboundStartDatetime, outboundDateRange, outboundEvent } =
  await import('../server/services/outbound-dtstart.js');

const MONATSLETZTER = 'FREQ=MONTHLY;BYMONTHDAY=-1';

// --------------------------------------------------------
// Die Umformung selbst
// --------------------------------------------------------

test('eine eigene Monatsletzten-Serie startet nach draussen am Monatsletzten', () => {
  const ev = { start_datetime: '2026-01-15T09:00', recurrence_rule: MONATSLETZTER, external_source: 'local' };
  assert.equal(outboundStartDatetime(ev), '2026-01-31T09:00');
});

test('eine importierte Serie geht Wort fuer Wort zurueck (#756)', () => {
  // Fremde Kalender duerfen ein unsynchronisiertes DTSTART absichtlich fuehren;

  for (const quelle of ['ics', 'caldav', 'google', 'apple']) {
    const ev = { start_datetime: '2026-01-15T09:00', recurrence_rule: MONATSLETZTER, external_source: quelle };
    assert.equal(outboundStartDatetime(ev), '2026-01-15T09:00', `Quelle ${quelle}`);
  }
});

test('eine BYDAY-Regel bleibt unangetastet (#549)', () => {


  const ev = { start_datetime: '2026-01-17T09:00', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO', external_source: 'local' };
  assert.equal(outboundStartDatetime(ev), '2026-01-17T09:00');
});

test('ohne Regel und bei schon passendem Start aendert sich nichts', () => {
  assert.equal(outboundStartDatetime({ start_datetime: '2026-01-15T09:00', external_source: 'local' }), '2026-01-15T09:00');
  const passend = { start_datetime: '2026-01-31T09:00', recurrence_rule: MONATSLETZTER, external_source: 'local' };
  assert.equal(outboundStartDatetime(passend), '2026-01-31T09:00');
});

test('das Ende wandert mit und behaelt die Dauer', () => {


  const kurz = outboundDateRange({
    start_datetime: '2026-01-15T09:00', end_datetime: '2026-01-15T10:30',
    recurrence_rule: MONATSLETZTER, external_source: 'local',
  });
  assert.deepEqual(kurz, { start_datetime: '2026-01-31T09:00', end_datetime: '2026-01-31T10:30' });

  const mehrtaegig = outboundDateRange({
    start_datetime: '2026-01-15T09:00', end_datetime: '2026-01-17T10:30',
    recurrence_rule: MONATSLETZTER, external_source: 'local',
  });
  assert.equal(mehrtaegig.end_datetime, '2026-02-02T10:30', 'zwei Tage Spanne bleiben zwei Tage');

  const ohneEnde = outboundDateRange({
    start_datetime: '2026-01-15T09:00', end_datetime: null,
    recurrence_rule: MONATSLETZTER, external_source: 'local',
  });
  assert.equal(ohneEnde.end_datetime, null);
});

test('das gespeicherte Zeitformat bleibt, wie es war', () => {


  const z = outboundDateRange({
    start_datetime: '2026-01-15T09:00:00Z', end_datetime: '2026-01-15T10:30:00Z',
    recurrence_rule: MONATSLETZTER, external_source: 'local',
  });
  assert.deepEqual(z, { start_datetime: '2026-01-31T09:00:00Z', end_datetime: '2026-01-31T10:30:00Z' });
});

test('outboundEvent laesst alle uebrigen Felder unberuehrt', () => {
  const ev = {
    id: 7, title: 'Miete', description: 'x', location: 'y', all_day: 0,
    start_datetime: '2026-01-15T09:00', end_datetime: '2026-01-15T10:00',
    recurrence_rule: MONATSLETZTER, external_source: 'local', tzid: null,
  };
  const out = outboundEvent(ev);
  assert.equal(out.start_datetime, '2026-01-31T09:00');
  assert.equal(out.title, 'Miete');
  assert.equal(out.id, 7);
  assert.equal(ev.start_datetime, '2026-01-15T09:00', 'das Original bleibt unveraendert');
});

// --------------------------------------------------------

// --------------------------------------------------------
//





test('der ausgehende CalDAV/Apple-Pfad schreibt den begradigten DTSTART', async () => {
  const { icsFieldsForEvent } = await import('../server/services/caldav-outbound.js');
  const { fields } = icsFieldsForEvent({
    id: 1, title: 'Miete', all_day: 0,
    start_datetime: '2026-01-15T09:00', end_datetime: '2026-01-15T10:00',
    recurrence_rule: MONATSLETZTER, external_source: 'local',
  }, 'Europe/Berlin');
  assert.match(fields.DTSTART.value, /^20260131T/, `DTSTART war ${fields.DTSTART.value}`);
  assert.match(fields.DTEND.value, /^20260131T/, `DTEND war ${fields.DTEND.value}`);
});

test('der ausgehende Pfad laesst ein importiertes DTSTART stehen (#756)', async () => {
  const { icsFieldsForEvent } = await import('../server/services/caldav-outbound.js');
  const { fields } = icsFieldsForEvent({
    id: 2, title: 'Fremd', all_day: 0,
    start_datetime: '2026-01-15T09:00', end_datetime: '2026-01-15T10:00',
    recurrence_rule: MONATSLETZTER, external_source: 'ics',
  }, 'Europe/Berlin');
  assert.match(fields.DTSTART.value, /^20260115T/, `DTSTART war ${fields.DTSTART.value}`);
});

test('ein ganztaegiger Termin wandert ebenfalls, mit exklusivem DTEND', async () => {
  const { icsFieldsForEvent } = await import('../server/services/caldav-outbound.js');
  const { fields } = icsFieldsForEvent({
    id: 3, title: 'Ganztags', all_day: 1,
    start_datetime: '2026-01-15', end_datetime: '2026-01-15',
    recurrence_rule: MONATSLETZTER, external_source: 'local',
  }, 'Europe/Berlin');
  assert.equal(fields.DTSTART.value, '20260131');

  assert.equal(fields.DTEND.value, '20260201');
});
