
//






import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALES_DIR = new URL('../public/locales/', import.meta.url);
const I18N_PATH = new URL('../public/i18n.js', import.meta.url);
const REFERENCE = 'de';

function supportedLocales() {
  const src = readFileSync(I18N_PATH, 'utf8');
  const match = src.match(/const SUPPORTED_LOCALES = \[([^\]]+)\]/);
  assert.ok(match, 'SUPPORTED_LOCALES nicht in public/i18n.js gefunden');
  return match[1].match(/'([a-z-]+)'/g).map(s => s.slice(1, -1));
}

function readLocale(locale) {
  return readFileSync(new URL(`${locale}.json`, LOCALES_DIR), 'utf8');
}

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

function placeholders(value) {
  if (typeof value !== 'string') return new Set();
  return new Set([...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]));
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many)$/;

const LOCALES = supportedLocales();
const reference = flatten(JSON.parse(readLocale(REFERENCE)));
const referenceKeys = [...reference.keys()];

test('für jede unterstützte Locale existiert genau eine Locale-Datei', () => {
  const files = readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json')).sort();
  assert.deepEqual(files, [...LOCALES].sort().map(l => `${l}.json`));
});

test('die Referenz-Locale trägt Schlüssel', () => {
  assert.ok(referenceKeys.length > 1000, `de.json hat nur ${referenceKeys.length} Schlüssel`);
});

test('jede Locale trägt die vollständige Bestätigung für verwaiste Kalender-Overrides', () => {
  const keys = [
    'calendar.overrideOrphanConfirmTitle',
    'calendar.overrideOrphanConfirmTitle_one',
    'calendar.overrideOrphanConfirmDetail',
    'calendar.overrideOrphanConfirmAction',
  ];
  for (const locale of LOCALES) {
    const values = flatten(JSON.parse(readLocale(locale)));
    for (const key of keys) {
      assert.ok(typeof values.get(key) === 'string' && values.get(key).trim(),
        `${locale}.json: ${key} fehlt oder ist leer`);
    }
    assert.ok(values.get(keys[0]).includes('{{count}}'), `${locale}.json: der Plural nennt count nicht`);
    assert.ok(values.get(keys[1]).includes('{{count}}'), `${locale}.json: der Singular nennt count nicht`);
  }
});








for (const locale of LOCALES) {
  if (locale === REFERENCE) continue;

  test(`${locale}.json ist schlüsselidentisch zur Referenz ${REFERENCE}.json`, () => {
    const keys = flatten(JSON.parse(readLocale(locale)));
    const missing = referenceKeys.filter(k => !keys.has(k));
    const extra = [...keys.keys()].filter(k => !reference.has(k));
    assert.deepEqual(missing, [], `${locale}.json fehlen Schlüssel: ${missing.slice(0, 20).join(', ')}`);
    assert.deepEqual(extra, [], `${locale}.json hat überzählige Schlüssel: ${extra.slice(0, 20).join(', ')}`);
  });





  //

  // gleichnamige Referenzvariante: eine `_one`-Form darf {{count}} weglassen,



  test(`${locale}.json nutzt dieselben Platzhalter wie die Referenz`, () => {
    const keys = flatten(JSON.parse(readLocale(locale)));
    const mismatches = [];
    for (const [key, refValue] of reference) {
      if (!keys.has(key)) continue;
      const actual = placeholders(keys.get(key));
      const variant = PLURAL_SUFFIX.test(key);
      const allowed = variant
        ? placeholders(reference.get(key.replace(PLURAL_SUFFIX, '')) ?? refValue)
        : placeholders(refValue);
      const missing = variant ? [] : [...allowed].filter(p => !actual.has(p));
      const extra = [...actual].filter(p => !allowed.has(p));
      if (missing.length || extra.length) {
        mismatches.push(`${key}: fehlt {${missing.join(',')}} überzählig {${extra.join(',')}}`);
      }
    }
    assert.deepEqual(mismatches, [], `${locale}.json:\n  ${mismatches.join('\n  ')}`);
  });
}




//









//




test('jede Locale-Datei ist Zeile für Zeile 4-Leerzeichen-formatiert', () => {
  const wrong = [];
  for (const locale of LOCALES) {
    const raw = readLocale(locale);
    const canonical = `${JSON.stringify(JSON.parse(raw), null, 4)}\n`;
    if (raw === canonical) continue;


    const a = raw.split('\n');
    const b = canonical.split('\n');
    const i = a.findIndex((line, n) => line !== b[n]);
    wrong.push(`${locale}.json Zeile ${i + 1}: ${JSON.stringify(a[i])} statt ${JSON.stringify(b[i])}`);
  }
  assert.deepEqual(wrong, [], `nicht kanonisch 4-Leerzeichen-formatiert:\n  ${wrong.join('\n  ')}`);
});

test('alle Locale-Dateien enden mit einem Zeilenumbruch', () => {
  const wrong = LOCALES.filter(l => !readLocale(l).endsWith('\n'));
  assert.deepEqual(wrong, [], `ohne abschließenden Zeilenumbruch: ${wrong.join(', ')}`);
});


//
// Modulnamen leben an zwei Stellen: in `nav.*` (Sidebar, Tray, Kommandopalette,





// „Haushalt". Kein Test konnte das sehen - beide Schluessel existierten, beide

//




// die Regel.
test('jeder statisch geschriebene t()-Schlüssel steht auch in der Referenz-Locale', () => {







  //



  // meldet, wird abgeschaltet statt befolgt.
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor' || entry.name === 'locales') continue;
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js')) files.push(child);
    }
  };
  walk(new URL('../public/', import.meta.url));

  const offenders = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*(['"])([a-zA-Z0-9_.]+)\1/g)) {
      const key = match[2];
      if (reference.has(key)) continue;

      if (referenceKeys.some((k) => k.startsWith(`${key}_`) && PLURAL_SUFFIX.test(k))) continue;
      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${file.pathname.split('/public/')[1]}:${line} → ${key}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Diese t()-Aufrufe nennen einen Schlüssel, den de.json nicht kennt - im Browser `
    + `steht dann der Schlüssel selbst in der Oberfläche:\n${offenders.join('\n')}`,
  );
});

test('Modulnamen sind in nav und in den API-Token-Scopes wortgleich', () => {
  const drift = [];
  let compared = 0;
  for (const locale of LOCALES) {
    const keys = flatten(JSON.parse(readLocale(locale)));
    for (const [key, value] of keys) {
      const match = key.match(/^settings\.apiTokenScopeModules\.(\w+)$/);
      if (!match) continue;
      const navKey = `nav.${match[1]}`;
      if (!keys.has(navKey)) continue;
      compared++;
      if (keys.get(navKey) !== value) {
        drift.push(`${locale}: ${key} = ${JSON.stringify(value)}, ${navKey} = ${JSON.stringify(keys.get(navKey))}`);
      }
    }
  }

  // greift, fehlerfrei „keine Drift" ueber null verglichene Paare.
  assert.ok(compared >= 12 * LOCALES.length,
    `zu wenige Paare verglichen (${compared}) - greift der Selektor noch?`);
  assert.deepEqual(drift, [], `Modulname driftet:\n  ${drift.join('\n  ')}`);
});






//







//






const FOLDER_NAMED_LIKE_MODULE = [
  ['splitExpenses.title', 'documents.splitExpensesFolder'],


  ['inventory.title', 'documents.inventoryFolder'],


  // "Haushaltshilfe", "ハウスキーピング" gegen "家事" - und zwei davon,

  ['housekeeping.title', 'documents.housekeepingFolder'],
];

test('der Beleg-Ordner heisst wie das Modul, dessen Belege er traegt', () => {
  const drift = [];
  for (const locale of LOCALES) {
    const keys = flatten(JSON.parse(readLocale(locale)));
    for (const [titleKey, folderKey] of FOLDER_NAMED_LIKE_MODULE) {
      const title = keys.get(titleKey);
      const folder = keys.get(folderKey);
      assert.ok(title, `${locale}: ${titleKey} fehlt`);
      assert.ok(folder, `${locale}: ${folderKey} fehlt`);
      if (title !== folder) {
        drift.push(`${locale}: ${titleKey} ${JSON.stringify(title)}, Ordner ${JSON.stringify(folder)}`);
      }
    }
  }
  assert.deepEqual(drift, [],
    `Der Beleg-Ordner traegt einen anderen Namen als das Modul:\n  ${drift.join('\n  ')}`);
});
