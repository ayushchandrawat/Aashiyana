import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createInstallerServer } from '../tools/installer/install-server.js';
import { SUPPORTED_LOCALES } from '../tools/installer/i18n-mini.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOCALES_DIR = new URL('../tools/installer/locales/', import.meta.url);
const HTML_PATH = new URL('../tools/installer/install.html', import.meta.url);
const REFERENCE = 'de';

function loadLocale(locale) {
  return JSON.parse(readFileSync(new URL(`${locale}.json`, LOCALES_DIR), 'utf8'));
}

function flattenKeys(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenKeys(v, key, out);
    else out.add(key);
  }
  return out;
}



//




// an beiden Enden oder an keinem.
test('jede Installer-Locale ist Zeile für Zeile 2-Leerzeichen-formatiert', () => {
  const wrong = [];
  for (const locale of SUPPORTED_LOCALES) {
    const raw = readFileSync(new URL(`${locale}.json`, LOCALES_DIR), 'utf8');
    const canonical = `${JSON.stringify(JSON.parse(raw), null, 2)}\n`;
    if (raw === canonical) continue;
    const a = raw.split('\n');
    const b = canonical.split('\n');
    const i = a.findIndex((line, n) => line !== b[n]);
    wrong.push(`${locale}.json Zeile ${i + 1}: ${JSON.stringify(a[i])} statt ${JSON.stringify(b[i])}`);
  }
  assert.deepEqual(wrong, [], `nicht kanonisch 2-Leerzeichen-formatiert:\n  ${wrong.join('\n  ')}`);
});

function referencedKeys() {
  const html = readFileSync(HTML_PATH, 'utf8');
  const attr = [...html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)].map(m => m[1]);
  const calls = [...html.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]);
  const rich = [...html.matchAll(/applyRich\([^,]+,\s*'([^']+)'/g)].map(m => m[1]);
  return new Set([...attr, ...calls, ...rich]);
}

const referenceKeys = flattenKeys(loadLocale(REFERENCE));



test('für jede unterstützte Locale existiert genau eine Locale-Datei', () => {
  const files = readdirSync(new URL(LOCALES_DIR)).filter(f => f.endsWith('.json')).sort();
  assert.deepEqual(files, [...SUPPORTED_LOCALES].sort().map(l => `${l}.json`));
});

for (const locale of SUPPORTED_LOCALES) {
  test(`${locale}.json ist schlüsselidentisch zur Referenz ${REFERENCE}.json`, () => {
    const keys = flattenKeys(loadLocale(locale));
    const missing = [...referenceKeys].filter(k => !keys.has(k));
    const extra = [...keys].filter(k => !referenceKeys.has(k));
    assert.deepEqual(missing, [], `${locale}.json fehlen Schlüssel: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `${locale}.json hat überzählige Schlüssel: ${extra.join(', ')}`);
  });
}

// ── install.html ⇄ Locales ───────────────────────────────────────────────────

test('install.html enthält i18n-Schlüssel (data-i18n vorhanden)', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  const count = (html.match(/data-i18n/g) || []).length;
  assert.ok(count > 0, 'keine data-i18n-Attribute in install.html gefunden');
});

test('jeder in install.html referenzierte Schlüssel existiert in der Referenz', () => {
  const used = referencedKeys();
  const unknown = [...used].filter(k => !referenceKeys.has(k));
  assert.deepEqual(unknown, [], `Unbekannte Schlüssel in install.html: ${unknown.join(', ')}`);
});

test('jeder in install.html referenzierte Schlüssel existiert in jeder Locale', () => {
  const used = referencedKeys();
  for (const locale of SUPPORTED_LOCALES) {
    const keys = flattenKeys(loadLocale(locale));
    const missing = [...used].filter(k => !keys.has(k));
    assert.deepEqual(missing, [], `${locale}.json fehlen genutzte Schlüssel: ${missing.join(', ')}`);
  }
});



async function withServer(fn) {
  const prev = process.env.OIKOS_INSTALLER_ROOT;
  process.env.OIKOS_INSTALLER_ROOT = REPO_ROOT;
  const server = createInstallerServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(r => server.close(r));
    if (prev === undefined) delete process.env.OIKOS_INSTALLER_ROOT;
    else process.env.OIKOS_INSTALLER_ROOT = prev;
  }
}

test('GET /i18n-mini.js liefert 200 + JavaScript', async () => {
  await withServer(async base => {
    const r = await fetch(`${base}/i18n-mini.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);
    assert.match(await r.text(), /export function t\(/);
  });
});

test('GET /locales/<locale>.json liefert 200 + JSON für jede Locale', async () => {
  await withServer(async base => {
    for (const locale of SUPPORTED_LOCALES) {
      const r = await fetch(`${base}/locales/${locale}.json`);
      assert.equal(r.status, 200, `/locales/${locale}.json lieferte ${r.status}`);
      assert.match(r.headers.get('content-type'), /application\/json/);
      const body = await r.json();
      assert.ok(body.title, `${locale}.json hat keinen title-Schlüssel`);
    }
  });
});

test('GET /locales/* lehnt Path-Traversal und Nicht-JSON mit 404 ab', async () => {
  await withServer(async base => {
    for (const path of ['/locales/../install.html', '/locales/nope.json', '/locales/de.txt']) {
      const r = await fetch(`${base}${path}`);
      assert.equal(r.status, 404, `${path} hätte 404 liefern müssen`);
    }
  });
});


//



// "Auslassungspunkte, Schaltflaeche, deaktiviert" vorgelesen.
//




test('kein Locale-Wert besteht ausschliesslich aus Zeichensetzung', () => {
  // \p{L} deckt jedes Alphabet ab (kyrillisch, arabisch, CJK), \p{N} Ziffern.

  const hasContent = (value) => /[\p{L}\p{N}]/u.test(value);
  const offenders = [];

  for (const locale of SUPPORTED_LOCALES) {
    const walk = (obj, prefix = '') => {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
        else if (typeof v === 'string' && v.length > 0 && !hasContent(v)) {
          offenders.push(`${locale}: ${key} = ${JSON.stringify(v)}`);
        }
      }
    };
    walk(loadLocale(locale));
  }

  assert.deepEqual(offenders, [],
    'Diese Werte enthalten keinen einzigen Buchstaben und keine Ziffer. Steht so '
    + 'einer auf einem Button, hat das Element keinen Namen mehr:\n' + offenders.join('\n'));
});

test('der Generieren-Button traegt waehrend der Operation einen Namen und haengt nicht', () => {
  const html = readFileSync(HTML_PATH, 'utf8');

  assert.match(html, /btn\.setAttribute\('aria-busy', 'true'\)/,
    'der Generieren-Button meldet seinen Betriebszustand nicht');


  assert.match(html, /\} finally \{[\s\S]*?btn\.disabled = false;[\s\S]*?btn\.textContent = t\('common\.generate'\);/,
    'der Generieren-Button wird nicht in jedem Fall zurueckgesetzt');
});

test('Zahlenbereiche in Fehlermeldungen sind mit ASCII-Minus geschrieben', () => {



  //



  const offenders = [];
  for (const locale of SUPPORTED_LOCALES) {
    const walk = (obj, prefix = '') => {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
        else if (typeof v === 'string' && /[–—](?=[0-9])/u.test(v)) {
          offenders.push(`${locale}: ${key} = ${JSON.stringify(v)}`);
        }
      }
    };
    walk(loadLocale(locale));
  }
  assert.deepEqual(offenders, [],
    'En-/Em-Dash direkt vor einer Ziffer ist ein Vorzeichen oder Bis-Strich und '
    + 'gehört als ASCII "-" geschrieben:\n' + offenders.join('\n'));
});

test('kein data-i18n zeigt auf einen Schluessel mit Platzhalter', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  const reference = loadLocale(REFERENCE);
  const lookup = (key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), reference);

  const offenders = [];
  for (const [, key] of html.matchAll(/\bdata-i18n="([^"]+)"/g)) {
    const value = lookup(key);
    if (typeof value === 'string' && /\{\{\w+\}\}/.test(value)) {
      offenders.push(`${key} -> "${value}"`);
    }
  }
  assert.deepEqual(offenders, [],
    `data-i18n auf interpolierten Schluesseln (applyTranslations kann sie nicht fuellen): ${offenders.join(' | ')}`);
});

test('der Sprachumschalter bietet genau die unterstuetzten Sprachen an', () => {
  const html = readFileSync(HTML_PATH, 'utf8');
  const select = html.match(/<select id="lang-switch"[\s\S]*?<\/select>/);
  assert.ok(select, 'lang-switch nicht gefunden');

  const offered = [...select[0].matchAll(/<option value="([^"]+)"/g)].map(m => m[1]).sort();
  const supported = [...SUPPORTED_LOCALES].sort();

  assert.deepEqual(offered, supported,
    `Optionsliste weicht von SUPPORTED_LOCALES ab. Nur im Select: ${offered.filter(l => !supported.includes(l))}; `
    + `nur in SUPPORTED_LOCALES: ${supported.filter(l => !offered.includes(l))}`);
});
