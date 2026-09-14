import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIN_LENGTH = 13; // Werte ab 13 Zeichen zaehlen
const BASELINE_URL = new URL('./i18n-translated-baseline.json', import.meta.url);
const SETS = {
  app: new URL('../public/locales/', import.meta.url),
  installer: new URL('../tools/installer/locales/', import.meta.url),
};

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

function loadSet(dir) {
  const locales = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    locales.set(f.replace(/\.json$/, ''), flatten(JSON.parse(readFileSync(new URL(f, dir), 'utf8'))));
  }
  return locales;
}

function onlySymbols(value) {
  return /^(\{\{[^}]+\}\}|[\s\d\W])*$/.test(value);
}

export function copiedFromEnglish(de, en, locale) {
  const hits = [];
  for (const [key, enValue] of en) {
    if (typeof enValue !== 'string' || enValue.length < MIN_LENGTH || onlySymbols(enValue)) continue;
    if (de.get(key) === enValue) continue;
    if (locale.get(key) === enValue) hits.push(key);
  }
  return hits;
}

const baseline = JSON.parse(readFileSync(BASELINE_URL, 'utf8'));

for (const [setName, dir] of Object.entries(SETS)) {
  const locales = loadSet(dir);
  const de = locales.get('de');
  const en = locales.get('en');
  assert.ok(de && en, `${setName}: de.json und en.json muessen existieren`);

  test(`${setName}: der Zaehler ist nicht blind`, () => {

    const eligible = [...en].filter(([k, v]) => typeof v === 'string' && v.length >= MIN_LENGTH && !onlySymbols(v) && de.get(k) !== v).length;
    assert.ok(eligible > 50, `${setName}: nur ${eligible} zaehlbare Schluessel - Schwelle oder Scan stimmen nicht`);
    assert.equal(copiedFromEnglish(de, en, en).length, eligible);
    assert.equal(copiedFromEnglish(de, en, de).length, 0, 'de kopiert nichts aus en');
  });

  for (const [code, values] of locales) {
    if (code === 'de' || code === 'en') continue;
    const expected = baseline[setName]?.[code];
    const hits = copiedFromEnglish(de, en, values);

    test(`${setName}/${code}: keine neuen englischen Werte gegenueber der Baseline`, () => {
      assert.ok(Number.isInteger(expected), `${setName}/${code} fehlt in der Baseline - Eintrag mit ${hits.length} anlegen`);
      assert.ok(hits.length <= expected,
        `${setName}/${code}: ${hits.length} Werte woertlich englisch, Baseline ${expected}. Neu dazugekommen, `
        + `z. B.: ${hits.slice(-5).join(', ')} - uebersetzen, nicht die Baseline heben`);
    });

    test(`${setName}/${code}: die Baseline ist eine Messung und faellt mit`, () => {
      assert.equal(hits.length, expected,
        `${setName}/${code}: gemessen ${hits.length}, Baseline ${expected} - Baseline in `
        + 'test/i18n-translated-baseline.json auf den gemessenen Wert senken');
    });
  }

  test(`${setName}: die Baseline traegt keine Karteileichen`, () => {
    const stale = Object.keys(baseline[setName] ?? {}).filter((code) => !locales.has(code));
    assert.deepEqual(stale, [], `${setName}: Baseline-Eintraege ohne Locale-Datei`);
  });
}
