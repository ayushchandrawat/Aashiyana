import { test } from 'node:test';
import assert from 'node:assert/strict';

const { decodeHtmlEntities } = await import('../server/utils/html-entities.js');

test('decodiert &amp; zu &', () => {
  assert.equal(decodeHtmlEntities('Termine &amp; Verabredungen'), 'Termine & Verabredungen');
});

test('decodiert die übrigen Basis-Entities', () => {
  assert.equal(decodeHtmlEntities('a &lt; b &gt; c'), 'a < b > c');
  assert.equal(decodeHtmlEntities('&quot;Zitat&quot;'), '"Zitat"');
  assert.equal(decodeHtmlEntities('Leo&#39;s Team'), "Leo's Team");
  assert.equal(decodeHtmlEntities('Leo&apos;s Team'), "Leo's Team");
});

test('decodiert numerische Entities (dezimal und hex)', () => {
  assert.equal(decodeHtmlEntities('A&#38;B'), 'A&B');
  assert.equal(decodeHtmlEntities('A&#x26;B'), 'A&B');
  assert.equal(decodeHtmlEntities('Caf&#233;'), 'Café');
});

test('&amp; wird zuletzt aufgelöst (kein Doppel-Decode)', () => {

  assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;');
});

test('lässt Klartext mit rohem & unverändert (idempotent für saubere Namen)', () => {
  assert.equal(decodeHtmlEntities('Haare & Bart'), 'Haare & Bart');
  assert.equal(decodeHtmlEntities('Privat'), 'Privat');
});

test('behandelt leere/fehlende Werte robust', () => {
  assert.equal(decodeHtmlEntities(''), '');
  assert.equal(decodeHtmlEntities(null), null);
  assert.equal(decodeHtmlEntities(undefined), undefined);
});
