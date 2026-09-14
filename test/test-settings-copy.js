import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { SETTINGS_LEAVES } from '../public/settings/registry.js';

const de = JSON.parse(readFileSync(new URL('../public/locales/de.json', import.meta.url), 'utf8'));
const translate = (key) => key.split('.').reduce((value, segment) => value?.[segment], de);

const SENTENCE_SPLIT = /[.!?]+\s+/;


// als Substantiv.
const NOUN = /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{4,}$/;




const stemOf = (word) => word
  .slice(0, Math.min(Math.max(5, word.length - 2), 8))
  .toLowerCase();

function leafSourcePath(leaf) {
  const match = String(leaf.loader).match(/\/settings\/(pages\/[\w-]+\.js)/);
  assert.ok(match, `${leaf.id}: Loader-Pfad nicht erkennbar`);
  return new URL(`../public/settings/${match[1]}`, import.meta.url);
}

const translationKeysIn = (source) => [...source.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)].map((m) => m[1]);

function renderedVocabulary(leaf) {
  const source = readFileSync(leafSourcePath(leaf), 'utf8');
  const keys = translationKeysIn(source);

  for (const match of source.matchAll(/from\s+'\/settings\/([\w/-]+\.js)'/g)) {
    const shared = new URL(`../public/settings/${match[1]}`, import.meta.url);
    keys.push(...translationKeysIn(readFileSync(shared, 'utf8')));
  }

  const values = [leaf.labelKey, ...keys]
    .map(translate)
    .filter((value) => typeof value === 'string');
  return values.join(' ').toLowerCase();
}

function descriptionNouns(description) {
  return description
    .split(SENTENCE_SPLIT)

    .flatMap((sentence) => sentence.trim().split(/\s+/).slice(1))
    .map((word) => word.replace(/[.,;:!?()„“"»«]/g, ''))
    .filter((word) => NOUN.test(word))

    // ("CalDAV" und "Kalender" statt "CalDAV-Kalender").
    .flatMap((word) => (word.includes('-') ? word.split('-') : [word]))
    .filter((part) => part.length >= 5);
}

test('jede Leaf-Description endet mit einem Satzschlusszeichen', () => {
  for (const leaf of SETTINGS_LEAVES) {
    const description = translate(leaf.descriptionKey);
    assert.equal(typeof description, 'string', `${leaf.id}: ${leaf.descriptionKey} fehlt in de.json`);
    assert.match(
      description,
      /[.!?]$/,
      `${leaf.id}: "${description}" endet ohne Satzschlusszeichen`,
    );
  }
});

test('jedes Substantiv einer Leaf-Description kommt im Blatt-Inhalt vor', () => {
  const failures = [];
  for (const leaf of SETTINGS_LEAVES) {
    const description = translate(leaf.descriptionKey);
    const vocabulary = renderedVocabulary(leaf);
    for (const noun of descriptionNouns(description)) {
      if (!vocabulary.includes(stemOf(noun))) {
        failures.push(`${leaf.id}: Description nennt "${noun}", das Blatt rendert es nicht`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
