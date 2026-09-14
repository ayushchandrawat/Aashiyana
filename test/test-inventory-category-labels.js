import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { withoutBlockComments } from './source-text.js';

const { __test: inventory } = await import('../public/pages/inventory.js');



const SEED = [
  { key: 'electronics', name: null, label_key: 'inventory.categoryElectronics', icon: 'cpu' },
  { key: 'vehicles',    name: null, label_key: 'inventory.categoryVehicles',    icon: 'car' },
  { key: 'household',   name: null, label_key: 'inventory.categoryHousehold',   icon: 'home' },
  { key: 'sports',      name: null, label_key: 'inventory.categorySports',      icon: 'dumbbell' },
  { key: 'other',       name: null, label_key: 'inventory.categoryOther',       icon: 'package' },
];
const CUSTOM = { key: 'werkzeug', name: 'Werkzeug', label_key: null, icon: 'wrench' };

function optionLabels(html) {
  return [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
    .map((m) => ({ value: m[1], label: m[2] }));
}

test('die Kategorie-Auswahl beschriftet Seed-Kategorien (name = NULL) nicht leer', () => {
  const options = optionLabels(inventory.categoryOptionsHtml(SEED));
  assert.equal(options.length, SEED.length, 'jede Kategorie ergibt genau eine Option');
  for (const { value, label } of options) {
    assert.notEqual(label, '', `Kategorie "${value}" steht ohne Beschriftung in der Auswahl`);
  }


  assert.deepEqual(options.map((o) => o.label), SEED.map((c) => c.label_key));
});

test('die Kategorie-Auswahl beschriftet Custom-Kategorien mit ihrem Namen', () => {
  const options = optionLabels(inventory.categoryOptionsHtml([CUSTOM]));
  assert.deepEqual(options, [{ value: 'werkzeug', label: 'Werkzeug' }]);
});

test('die Auswahl behaelt Reihenfolge und Key als Wert (die Vorauswahl haengt am Key)', () => {
  const options = optionLabels(inventory.categoryOptionsHtml([...SEED, CUSTOM]));
  assert.deepEqual(options.map((o) => o.value), [...SEED.map((c) => c.key), CUSTOM.key]);
});

test('categoryLabel faellt der Reihe nach auf label_key, name, key zurueck', () => {
  assert.equal(inventory.categoryLabel({ key: 'other', name: null, label_key: 'inventory.categoryOther' }),
    'inventory.categoryOther');
  assert.equal(inventory.categoryLabel({ key: 'werkzeug', name: 'Werkzeug', label_key: null }), 'Werkzeug');
  assert.equal(inventory.categoryLabel({ key: 'unbekannt', name: null, label_key: null }), 'unbekannt');
  assert.equal(inventory.categoryLabel(null), '');
});

test('itemCategoryLabel loest die denormalisierten Item-Felder gleich auf', () => {
  assert.equal(inventory.itemCategoryLabel({ category: 'other', category_name: null, category_label_key: 'inventory.categoryOther' }),
    'inventory.categoryOther');
  assert.equal(inventory.itemCategoryLabel({ category: 'werkzeug', category_name: 'Werkzeug', category_label_key: null }),
    'Werkzeug');
  assert.equal(inventory.itemCategoryLabel({ category: 'weg', category_name: null, category_label_key: null }), 'weg');
});

// Regel statt Fundstellen-Liste: welche Seiten label_key-Kategorien fuehren,


// vorbeizulaufen.
const pagesDir = new URL('../public/pages/', import.meta.url);
const localizedPages = readdirSync(pagesDir)
  .filter((f) => f.endsWith('.js'))


  .map((f) => ({
    file: f,
    src: withoutBlockComments(readFileSync(new URL(f, pagesDir), 'utf8')).replace(/^\s*\/\/.*$/gm, ''),
  }))
  .filter(({ src }) => /label_key/.test(src));

test('mindestens die drei bekannten Seiten mit lokalisierten Kategorien werden erfasst', () => {
  const files = localizedPages.map((p) => p.file).sort();
  for (const expected of ['contacts.js', 'inventory.js', 'tasks.js']) {
    assert.ok(files.includes(expected), `${expected} fuehrt label_key-Kategorien, wird aber nicht geprueft - `
      + 'der Ableitungs-Filter greift nicht mehr');
  }
});

const CATEGORY_CONTROL_RE = /value="\$\{(?:esc\((\w+)\.key\)|(\w+)\.id)\}"([\s\S]*?)<\/(?:option|label)>/g;

function labelKeyCollections() {
  const dbSrc = readFileSync(new URL('../server/db.js', import.meta.url), 'utf8');
  const namen = new Set();
  for (const m of dbSrc.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\s*\);/g)) {
    if (!/^\s*label_key\s/m.test(m[2])) continue;
    namen.add(m[1].replace(/^(?:task|contact|inventory|subscription|budget)_/, ''));
  }
  for (const m of dbSrc.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN label_key\b/g)) {
    namen.add(m[1].replace(/^(?:task|contact|inventory|subscription|budget)_/, ''));
  }
  return [...namen];
}

const LABEL_KEY_COLLECTIONS = labelKeyCollections();

test('die label_key-Sammlungen werden aus server/db.js abgeleitet', () => {


  for (const erwartet of ['categories', 'payment_methods']) {
    assert.ok(LABEL_KEY_COLLECTIONS.includes(erwartet),
      `"${erwartet}" fehlt in der Ableitung aus db.js - greift das Tabellen-Muster noch? `
      + `gefunden: ${LABEL_KEY_COLLECTIONS.join(', ') || '(nichts)'}`);
  }
});

for (const { file, src } of localizedPages) {
  test(`${file}: kein Kategorie-Label kommt roh aus .name`, () => {
    const controls = [...src.matchAll(CATEGORY_CONTROL_RE)]






      // `<quelle>.map((<var>` oder `for (const <var> of <quelle>)`.
      .filter((m) => {
        const variable = m[1] ?? m[2];
        const vorlauf = src.slice(0, m.index);
        const bindungen = [
          ...vorlauf.matchAll(new RegExp(`([\\w.]+)\\s*\\.\\s*map\\(\\(${variable}\\b`, 'g')),
          ...vorlauf.matchAll(new RegExp(`for \\(const ${variable} of ([\\w.]+)`, 'g')),
        ];
        if (bindungen.length === 0) return false;
        const naechste = bindungen.reduce((a, b) => (a.index > b.index ? a : b));
        return LABEL_KEY_COLLECTIONS.some((c) => new RegExp(`\\b${c}$`).test(naechste[1]));
      });
    assert.ok(controls.length > 0, `keine Kategorie-Auswahl in ${file} gefunden - das Muster greift nicht mehr`);
    for (const m of controls) {
      const variable = m[1] ?? m[2];
      const label = m[3];
      assert.ok(!new RegExp(`\\b${variable}\\.name\\b`).test(label),
        `${file}: die Auswahl liest ihr Label direkt aus ${variable}.name - bei einer Seed-Kategorie `
        + 'ist name NULL und die Beschriftung bleibt leer (#783). Ueber den Label-Resolver gehen.');
    }
  });
}
