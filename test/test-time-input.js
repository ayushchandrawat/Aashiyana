import assert from 'node:assert/strict';
import test from 'node:test';



globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { parseTimeInput, isTimeInputValid, formatTimeInput } = await import('../public/i18n.js');

test('kompakte Schreibweise HHMM/HMM → HH:MM (#442)', () => {
  assert.equal(parseTimeInput('0930'), '09:30');
  assert.equal(parseTimeInput('930'), '09:30');
  assert.equal(parseTimeInput('1345'), '13:45');
  assert.equal(parseTimeInput('0000'), '00:00');
  assert.equal(parseTimeInput('2359'), '23:59');
});

test('Trennzeichen . , h → HH:MM (#442)', () => {
  assert.equal(parseTimeInput('09.30'), '09:30');
  assert.equal(parseTimeInput('9,30'), '09:30');
  assert.equal(parseTimeInput('9h30'), '09:30');
  assert.equal(parseTimeInput('9H30'), '09:30');
});

test('bestehende Formate bleiben gültig', () => {
  assert.equal(parseTimeInput('9'), '09:00');
  assert.equal(parseTimeInput('09'), '09:00');
  assert.equal(parseTimeInput('9:30'), '09:30');
  assert.equal(parseTimeInput('09:30'), '09:30');
  assert.equal(parseTimeInput('9:30 pm'), '21:30');
});

test('ungültige kompakte/getrennte Werte werden abgelehnt', () => {
  assert.equal(parseTimeInput('2400'), '');
  assert.equal(parseTimeInput('1360'), '');
  assert.equal(parseTimeInput('9.60'), '');
  assert.equal(parseTimeInput('99999'), '');
  assert.equal(parseTimeInput('25'), '');
});

test('isTimeInputValid akzeptiert neue Formate und leere Eingabe', () => {
  assert.equal(isTimeInputValid('0930'), true);
  assert.equal(isTimeInputValid('09.30'), true);
  assert.equal(isTimeInputValid(''), true);
  assert.equal(isTimeInputValid('2400'), false);
});

test('formatTimeInput normalisiert kompakte Eingabe (24h-Default)', () => {
  assert.equal(formatTimeInput('0930'), '09:30');
  assert.equal(formatTimeInput('9h30'), '09:30');
});
