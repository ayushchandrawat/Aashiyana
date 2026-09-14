
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { dictBlock, dictValue, decodeEntities, stripTags, unescapeJs } from './docs-dict.js';
import { eachRule } from './css-rules.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = resolve(ROOT, 'docs');
const SHOTS = resolve(DOCS, 'screenshots');
const PAGES = ['index.html', 'install.html', 'datenschutz.html', 'impressum.html', 'privacy.html'];

const read = (p) => readFileSync(resolve(DOCS, p), 'utf8');
const decode = decodeEntities;

// ── (1) Kein Kommentar rendert als Text ──────────────────────────────────────

const COMMENT_END = /--!?>/g;
const COMMENT = /<!--[\s\S]*?--!?>/g;

function stripComments(html) {
  let prev;
  let out = html;
  do { prev = out; out = out.replace(COMMENT, ''); } while (out !== prev);
  return out;
}

function commentDamage(html) {
  const stripped = stripComments(html);
  const strayClose = [...stripped.matchAll(COMMENT_END)].map((m) => ({
    line: stripped.slice(0, m.index).split('\n').length,
    context: stripped.slice(Math.max(0, m.index - 60), m.index + 3).replace(/\s+/g, ' ').trim(),
  }));
  const unterminated = (stripped.match(/<!--/g) || []).length;
  return { strayClose, unterminated };
}

for (const page of PAGES) {
  test(`${page}: kein Kommentarrest steht als sichtbarer Text im Dokument`, () => {
    const { strayClose, unterminated } = commentDamage(read(page));
    assert.equal(
      strayClose.length, 0,
      `Kommentar-Ende ausserhalb eines Kommentars (rendert als Text):\n` +
      strayClose.map((s) => `  Zeile ~${s.line}: …${s.context}`).join('\n')
    );
    assert.equal(unterminated, 0, 'nicht geschlossener <!-- Kommentar: verschluckt allen Text bis zum nächsten -->');
  });
}

test('der Kommentar-Guard erkennt den Schaden, gegen den er gebaut ist', () => {



  const broken = [
    '</section>',
    '     with modules the reader has just been introduced to. -->',
    '<section class="handoff">',
    '</section>',
    '<!-- HANDOFFS - the payoff for the feature list above. Each row is one piece',
    '     of data crossing from the module that produces it to the module that',
    '<section class="longevity">',
  ].join('\n');

  assert.equal((broken.match(/<!--/g) || []).length, (broken.match(/--!?>/g) || []).length,
    'Vorbedingung: die Paar-Bilanz ist ausgeglichen, ein zaehlender Guard waere hier gruen');

  const { strayClose, unterminated } = commentDamage(broken);
  assert.equal(strayClose.length, 1, 'der abgetrennte Rest muss gefunden werden');
  assert.match(strayClose[0].context, /introduced to\. -->/);
  assert.equal(unterminated, 1, 'der unterminierte Kopf muss gefunden werden');
});

// ── (2) Substitutionstabelle == README ───────────────────────────────────────

function readmeSwapRows() {
  const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
  return readme.split('\n')
    .map((l) => l.match(/^\| (.+?) \| \*\*(.+?)\*\* - (.+?) \|$/))
    .filter(Boolean)
    .map((m) => [decode(m[1]).trim(), decode(m[2]).trim(), decode(m[3]).trim()]);
}

function pageSwapRows(html) {
  const en = dictBlock(html, 'en');
  const rows = [];
  for (let i = 1; ; i++) {
    const a = en.match(new RegExp(`\\bswap_${i}_a:'((?:[^'\\\\]|\\\\.)*)'`));
    const b = en.match(new RegExp(`\\bswap_${i}_b:'<b>(.*?)</b> - ((?:[^'\\\\]|\\\\.)*)'`));
    if (!a || !b) break;
    rows.push([decode(a[1]).trim(), decode(b[1]).trim(), decode(b[2]).trim()]);
  }
  return rows;
}

test('die Substitutionszeilen stimmen woertlich mit der README-Tabelle ueberein', () => {
  const readme = readmeSwapRows();
  const page = pageSwapRows(read('index.html'));

  assert.ok(readme.length >= 5, `README-Tabelle nicht gefunden oder zu kurz (${readme.length} Zeilen)`);
  assert.equal(page.length, readme.length,
    `Die Seite zeigt ${page.length} Zeilen, die README hat ${readme.length}. ` +
    'Beide sind handgepflegt - wer eine aendert, aendert die andere mit.');

  for (let i = 0; i < readme.length; i++) {
    assert.deepEqual(page[i], readme[i],
      `Zeile ${i + 1} weicht ab.\n  README: ${JSON.stringify(readme[i])}\n  Seite : ${JSON.stringify(page[i])}`);
  }
});

// ── (3) Modulzahl == was die Seite zeigt ─────────────────────────────────────

test('die Modulzahl der Proof-Leiste ist die Summe aus Feature-Zeilen und Modulkarten', () => {
  const html = read('index.html');
  const claimed = Number(html.match(/<b>(\d+)<\/b>\s*<span data-t="proof_modules"/)?.[1]);
  const featureRows = (html.match(/class="feat-row/g) || []).length;
  const modCards = (html.match(/class="mod-card/g) || []).length;

  assert.ok(Number.isInteger(claimed), 'Modulzahl in der Proof-Leiste nicht gefunden');
  assert.equal(featureRows + modCards, claimed,
    `Die Proof-Leiste behauptet ${claimed} Module, die Seite zeigt ${featureRows} Feature-Zeilen ` +
    `plus ${modCards} Modulkarten = ${featureRows + modCards}.`);
});

test('der Absatz ueber dem Modulraster nennt die Zahl der Karten, nicht irgendeine', () => {
  const html = read('index.html');
  const modCards = (html.match(/class="mod-card/g) || []).length;
  const WORDS = {
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    zehn: 10, elf: 11, zwoelf: 12, zwölf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, fünfzehn: 15, sechzehn: 16,
  };
  for (const lang of ['en', 'de']) {
    const desc = dictBlock(html, lang).match(/\bmore_desc:'((?:[^'\\]|\\.)*)'/)?.[1];
    assert.ok(desc, `more_desc fehlt im ${lang}-Woerterbuch`);
    const hit = Object.entries(WORDS).find(([w]) => new RegExp(`\\b${w}\\b`, 'i').test(desc));
    assert.ok(hit, `more_desc (${lang}) nennt keine Zahl: "${desc}"`);
    assert.equal(hit[1], modCards,
      `more_desc (${lang}) sagt "${hit[0]}" (${hit[1]}), es sind aber ${modCards} Modulkarten.`);
  }
});

// ── (4) WebP-Ableitungen je referenzierter Aufnahme ──────────────────────────

function localeDirs() {
  return ['', ...readdirSync(SHOTS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-z]{2}(-[a-z]{2})?$/.test(e.name))
    .map((e) => e.name)];
}

test('jede referenzierte Aufnahme hat beide WebP-Ableitungen in allen Sprachordnern', () => {
  const bases = new Set();
  for (const page of PAGES) {
    for (const m of read(page).matchAll(/(?:src|data-light|data-dark|data-light-m|data-dark-m)="screenshots\/([^"]+\.png)"/g)) {
      bases.add(m[1]);
    }
  }
  assert.ok(bases.size > 0, 'keine referenzierten Screenshots gefunden - Regex veraltet?');

  const missing = [];
  for (const base of bases) {
    for (const dir of localeDirs()) {
      for (const suffix of ['.webp', '@1x.webp']) {
        const rel = (dir ? `${dir}/` : '') + base.replace(/\.png$/, suffix);
        if (!existsSync(resolve(SHOTS, rel))) missing.push(`screenshots/${rel}`);
      }
    }
  }
  assert.deepEqual(missing, [],
    'Fehlende WebP-Ableitungen. onerror faengt nur FEHLENDE Dateien ab, der Fallback landet also ' +
    'still auf dem 5-10x groesseren PNG:\n  ' + missing.join('\n  '));
});

// ── (5) Woerterbuecher vollstaendig und deckungsgleich ───────────────────────

function dictKeys(block) {
  return new Set([...block.matchAll(/(?:^|[{,]\s*)\s*([a-z][a-z0-9_]*)\s*:\s*['"]/gm)].map((m) => m[1]));
}

function usedKeys(html) {
  const body = html.split(/\n\s*(?:var |const )?(?:DICT|T)\s*=/)[0];
  const keys = new Set();
  for (const attr of ['data-t', 'data-alt-t', 'data-t-aria']) {
    for (const m of body.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))) keys.add(m[1]);
  }
  return keys;
}


const TWINS = ['datenschutz.html', 'privacy.html'];

function markupClasses(html) {
  const body = html.split(/<\/head>/)[1] || html;
  return new Set([...body.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/)));
}

function headingShape(html) {
  const body = html.split(/<\/head>/)[1] || html;
  return [...body.matchAll(/<(h[1-6])\b/g)].map((m) => m[1]);
}

test('die beiden Rechtsseiten benutzen dieselben Klassen', () => {
  const [de, en] = TWINS.map((p) => markupClasses(read(p)));
  assert.ok(de.size > 10, `nur ${de.size} Klassen gefunden - Regex veraltet?`);

  const onlyDe = [...de].filter((c) => !en.has(c)).sort();
  const onlyEn = [...en].filter((c) => !de.has(c)).sort();
  assert.deepEqual([onlyDe, onlyEn], [[], []],
    `Klassen nur auf einer der beiden Rechtsseiten - die Regeln der anderen laufen ins Leere.\n`
    + `  nur datenschutz.html: ${onlyDe.join(', ') || '-'}\n  nur privacy.html: ${onlyEn.join(', ') || '-'}`);
});

test('die beiden Rechtsseiten haben dieselbe Abschnittsstruktur', () => {
  const [de, en] = TWINS.map((p) => headingShape(read(p)));
  assert.ok(de.length > 5, `nur ${de.length} Ueberschriften gefunden - Regex veraltet?`);
  assert.deepEqual(en, de,
    `Kopf-Folge der Rechtsseiten unterschiedlich - eine Fassung fuehrt einen Abschnitt, den die andere nicht hat.\n`
    + `  datenschutz.html: ${de.join(' ')}\n  privacy.html    : ${en.join(' ')}`);
});

test('der Zwillings-Guard erkennt den Schaden, gegen den er gebaut ist', () => {

  const withClasses = '</head><nav class="toc"><p class="toc-title">x</p><ol class="toc-list"></ol></nav>';
  const without = '</head><nav><h2>x</h2><ol></ol></nav>';
  const a = markupClasses(withClasses);
  const b = markupClasses(without);
  assert.notDeepEqual([...a].sort(), [...b].sort(),
    'der Klassen-Guard sieht die fehlenden toc-Klassen nicht');
  assert.notDeepEqual(headingShape(without), headingShape(withClasses),
    'der Struktur-Guard sieht den zusaetzlichen Kopf nicht');
});


function fallbackNodes(html) {
  const body = html.split(/\n\s*(?:var |const )?(?:DICT|T)\s*=/)[0];
  return [...body.matchAll(/<(\w+)[^>]*\sdata-t="([\w-]+)"[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => [m[2], stripTags(m[3])]);
}

function englishText(block, key) {
  const raw = dictValue(block, key);
  return raw === null ? null : stripTags(unescapeJs(raw));
}

for (const page of ['index.html', 'install.html']) {
  test(`${page}: der Markup-Fallback sagt dasselbe wie das englische Woerterbuch`, () => {
    const html = read(page);
    const en = dictBlock(html, 'en');
    assert.ok(en, 'en-Woerterbuch nicht gefunden');

    const nodes = fallbackNodes(html);
    assert.ok(nodes.length > 20, `nur ${nodes.length} data-t-Knoten gefunden - Regex veraltet?`);

    const drift = [];
    for (const [key, markup] of nodes) {
      const dict = englishText(en, key);
      if (dict === null || markup === dict) continue;
      drift.push(`${key}\n    Markup: ${markup}\n    T.en  : ${dict}`);
    }
    assert.deepEqual(drift, [],
      `Markup-Fallback und en-Woerterbuch sagen Verschiedenes (ohne JS steht der Markup-Text da):\n  ${drift.join('\n  ')}`);
  });
}

test('der Fallback-Guard erkennt den Schaden, gegen den er gebaut ist', () => {


  // Regex ins Leere greift, gruen und blind.
  const damaged = [
    '<p data-t="tb_out_v">Nothing until you configure it.</p>',
    'const T = {',
    "  en: {",
    "tb_out_v:'One update check against the GitHub releases API, nothing else.',",
    '  },',
    '  de: {',
    "tb_out_v:'Eine Update-Abfrage an die GitHub-Releases-API, sonst nichts.',",
    '  }',
    '};',
  ].join('\n');

  const en = dictBlock(damaged, 'en');
  assert.ok(en, 'Testvorlage: en-Block muss auffindbar sein');
  const [[key, markup]] = fallbackNodes(damaged);
  assert.equal(key, 'tb_out_v');
  assert.notEqual(markup, englishText(en, key),
    'der Guard sieht den Drift nicht, gegen den er geschrieben wurde');
});

test('der Fallback-Guard vergleicht Text, nicht Markup', () => {




  const same = [
    '<dd data-t="long_a1"><b>Nothing changes.</b> It is MIT-licensed.</dd>',
    'const T = {',
    '  en: {',
    "long_a1:'<b>Nothing changes.</b> It is MIT-licensed.',",
    '  },',
    '  de: {',
    "long_a1:'<b>Nichts aendert sich.</b> Es ist MIT-lizenziert.',",
    '  }',
    '};',
  ].join('\n');

  const [[key, markup]] = fallbackNodes(same);
  assert.equal(markup, englishText(dictBlock(same, 'en'), key));
});

for (const page of ['index.html', 'install.html']) {
  test(`${page}: jeder benutzte Schluessel steht in beiden Woerterbuechern`, () => {
    const html = read(page);
    const used = usedKeys(html);
    assert.ok(used.size > 20, `nur ${used.size} data-t-Schluessel gefunden - Regex veraltet?`);

    for (const lang of ['en', 'de']) {
      const block = dictBlock(html, lang);
      assert.ok(block, `${lang}-Woerterbuch nicht gefunden`);
      const missing = [...used].filter((k) => !dictKeys(block).has(k)).sort();
      assert.deepEqual(missing, [],
        `Schluessel ohne Eintrag im ${lang}-Woerterbuch (rendert stumm den Markup-Fallback): ${missing.join(', ')}`);
    }
  });
}

// ── (6) Jede Sektion schliesst, was sie oeffnet ──────────────────────────────

function maskNonMarkup(html) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');




  // End-Tags duerfen Attribute tragen (</script bar> schliesst) - daher [^>]*.
  let out = html, prev;
  do {
    prev = out;
    out = out
      .replace(COMMENT, blank)
      .replace(/<!--[\s\S]*$/, blank)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, blank)
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, blank);
  } while (out !== prev);
  return out;
}

const classOf = (tag) => (tag.match(/class="([^"]*)"/) || [])[1] || '(ohne class)';

function sectionDivBalance(html) {
  const masked = maskNonMarkup(html);
  const lineAt = (i) => masked.slice(0, i).split('\n').length;
  const sections = [];
  const divs = [];
  const problems = [];

  for (const m of masked.matchAll(/<(\/?)(section|div)\b[^>]*>/gi)) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const line = lineAt(m.index);

    if (tag === 'section') {
      if (closing) {
        const sec = sections.pop();
        if (!sec) continue;
        if (divs.length !== sec.divDepth) {
          problems.push({
            kind: 'balance', section: sec.cls, line: sec.line, end: line,
            delta: divs.length - sec.divDepth, groundings: sec.groundings,
          });
          while (divs.length > sec.divDepth) divs.pop();
        }
      } else {
        sections.push({ cls: classOf(m[0]), line, divDepth: divs.length, groundings: [] });
      }
      continue;
    }

    const sec = sections[sections.length - 1];
    if (!closing) { divs.push({ cls: classOf(m[0]), line }); continue; }

    if (sec && divs.length <= sec.divDepth) {
      problems.push({ kind: 'underflow', section: sec.cls, line, groundings: sec.groundings });
      continue;
    }
    const opened = divs.pop();

    if (sec && opened && divs.length === sec.divDepth) {
      sec.groundings.push(`Z${line} </div> schliesst .${opened.cls} von Z${opened.line}`);
    }
  }
  return problems;
}

const describeProblems = (problems) => problems.map((p) => {
  const head = p.kind === 'underflow'
    ? `  <section class="${p.section}">: in Z${p.line} schliesst ein </div> ueber die Sektionsgrenze hinaus`
    : `  <section class="${p.section}"> (Z${p.line}-${p.end}): Bilanz ${p.delta > 0 ? '+' : ''}${p.delta}` +
      ` (${p.delta > 0 ? `${p.delta} div nicht geschlossen` : `${-p.delta} div zu viel geschlossen`})`;

  if (p.groundings.length < 2) return head;
  const list = p.groundings.map((t, i) => `      ${i === 0 ? '-> ' : '   '}${t}`).join('\n');
  return `${head}\n    die Sektion steht ${p.groundings.length}x ohne offenes div da, gesund waere 1x`
       + ` - der erste Rueckfall ist die Fehlstelle:\n${list}`;
}).join('\n');

for (const page of PAGES) {
  test(`${page}: jede Sektion schliesst genau die divs, die sie oeffnet`, () => {
    const problems = sectionDivBalance(read(page));
    assert.equal(
      problems.length, 0,
      'Sektion mit unausgeglichener div-Bilanz - alles danach faellt aus seinem Container:\n' +
      describeProblems(problems)
    );
  });
}

test('der Bilanz-Guard erkennt den Schaden, gegen den er gebaut ist', () => {

  // statt .feat-grid, .mod-grid stand danach ausserhalb des Containers.
  const broken = [
    '<section class="showcase" id="modules">',   // 1
    '  <div class="wrap">',                      // 2
    '    <div class="feat-grid">',               // 3
    '      <div class="feat-row">',              // 4
    '      </div>',                              // 5
    '    </div>',                                // 6
    '    </div>',                                // 7  <- die Fehlstelle
    '    <div class="mod-grid">',                // 8
    '    </div>',                                // 9
    '  </div>',
    '</section>',                                // 11
  ].join('\n');

  const problems = sectionDivBalance(broken);
  assert.equal(problems.length, 1, 'der Bruch muss gefunden werden');
  assert.equal(problems[0].kind, 'underflow');
  assert.equal(problems[0].section, 'showcase');



  // gemeldete Zeile fuer den Fehler haelt.
  assert.equal(problems[0].line, 10, 'gemeldet wird der Riss, nicht die Fehlstelle');



  assert.equal(problems[0].groundings.length, 2, 'zwei Rueckfaelle statt einem');
  assert.equal(problems[0].groundings[0], 'Z7 </div> schliesst .wrap von Z2',
    `der erste Rueckfall muss die Fehlstelle sein, war:\n${problems[0].groundings.join('\n')}`);


  const fixed = broken.split('\n').filter((_, i) => i !== 6).join('\n');
  assert.deepEqual(sectionDivBalance(fixed), [], 'ohne das ueberzaehlige Tag meldet der Guard nichts');
});

test('der Bilanz-Guard zaehlt kein Markup aus Kommentaren, Skripten und Woerterbuechern', () => {



  const noise = [
    '<section class="platforms">',
    '  <div class="wrap">',
    '    <!-- The </div> above closes .mod-grid, which was missing. -->',
    '    <script>var s = "<div class=\\"x\\">";</script>',
    '    <style>.x::after { content: "</div>"; }</style>',
    '  </div>',
    '</section>',
  ].join('\n');

  assert.deepEqual(sectionDivBalance(noise), [], 'nur echtes Struktur-Markup zaehlt');
});



const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

const D_NUM = String.raw`(\d{1,2})\.(\d{1,2})\.(\d{4})`;
const D_WORD = String.raw`(\d{1,2})\s+(${MONTHS.join('|')})\s+(\d{4})`;

function statedDates(html) {
  const text = stripComments(html).replace(/<[^>]+>/g, ' ');
  const found = new Map(); // ISO -> Originalschreibweise
  const anchor = String.raw`(?:\bStand\b|last updated)[\s\S]{0,45}?`;

  for (const m of text.matchAll(new RegExp(anchor + D_NUM, 'gi'))) {
    found.set(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, `${m[1]}.${m[2]}.${m[3]}`);
  }
  for (const m of text.matchAll(new RegExp(anchor + D_WORD, 'gi'))) {
    const month = String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0');
    found.set(`${m[3]}-${month}-${m[1].padStart(2, '0')}`, `${m[1]} ${m[2]} ${m[3]}`);
  }
  return found;
}

for (const page of ['datenschutz.html', 'privacy.html', 'impressum.html']) {
  test(`${page}: nennt genau einen Stand`, () => {
    const dates = statedDates(read(page));
    assert.ok(dates.size > 0, 'die Seite muss einen Stand nennen');
    assert.equal(
      dates.size, 1,
      `widersprechende Standsangaben in einem Dokument:\n` +
      [...dates].map(([iso, raw]) => `  ${iso}  ("${raw}")`).join('\n')
    );
  });
}

test('der Stands-Guard erkennt den Schaden, gegen den er gebaut ist', () => {

  const de = '<p class="subtitle">Stand: 16.08.2026</p><p>Diese Erklaerung hat den Stand vom <strong>09.06.2026</strong>.</p>';
  const found = statedDates(de);
  assert.equal(found.size, 2, 'der Widerspruch muss gefunden werden');
  assert.deepEqual([...found.keys()].sort(), ['2026-06-09', '2026-08-16']);


  // auf jeder englischen Seite grundlos an.
  assert.equal(statedDates('<p>Stand: 16.08.2026</p><p>Last updated: 16 August 2026</p>').size, 1);



  assert.equal(statedDates(
    '<p>Stand: 16.08.2026</p><p>Angemessenheitsbeschluss der EU-Kommission vom 10.07.2023, '
    + 'ergaenzt durch Standardvertragsklauseln nach Art. 46 DSGVO.</p>').size, 1);


  assert.equal(statedDates(de.replace('09.06.2026', '16.08.2026')).size, 1);
});



function sectionHeads(html) {
  const body = stripComments(html);
  return [...body.matchAll(/<div class="sec-head([^"]*)"[^>]*>([\s\S]{0,400}?)<\/div>/g)].map((m) => ({
    lead: /\blead\b/.test(m[1]),
    centered: /\bcenter\b/.test(m[1]),
    eyebrow: /class="eyebrow"/.test(m[2]),
  }));
}

function sectionCount(html) {
  const body = stripComments(html);
  return (body.match(/<section\b/g) || []).length + (body.match(/<header class="hero"/g) || []).length;
}

test('index.html: Kapitelmarken bleiben hoechstens die Haelfte der Sektionen', () => {
  const html = read('index.html');
  const heads = sectionHeads(html);
  const sections = sectionCount(html);
  assert.ok(heads.length >= 6, `zu wenige Sektionskoepfe gefunden (${heads.length}) - Extraktor gebrochen?`);
  assert.ok(sections >= 7, `zu wenige Sektionen gefunden (${sections}) - Extraktor gebrochen?`);
  const lead = heads.filter((h) => h.lead).length;
  assert.ok(
    lead * 2 <= sections,
    `${lead} von ${sections} Sektionen sind Kapitelmarken. Ab der Haelfte ist die `
    + `Unterscheidung wieder eine Liste - siehe die Begruendung an .sec-head.lead.`
  );
});

test('index.html: der Eyebrow markiert die Kapitelmarke, nicht die Folgesektion', () => {
  const heads = sectionHeads(read('index.html'));
  const leadOhne = heads.filter((h) => h.lead && !h.eyebrow).length;
  const centerMit = heads.filter((h) => h.centered && h.eyebrow).length;
  assert.equal(leadOhne, 0, 'eine Kapitelmarke ohne Eyebrow: der Leser sieht keinen Kapitelanfang');
  assert.equal(centerMit, 0, 'eine zentrierte Folgesektion mit Eyebrow: sie gibt sich als Kapitel aus');
});

test('der Kapitelmarken-Guard erkennt den Schaden, gegen den er gebaut ist', () => {

  const kopf = '<div class="sec-head lead"><span class="eyebrow">A</span></div>';
  const alleLead = ('<section>' + kopf + '</section>').repeat(6);
  assert.equal(sectionHeads(alleLead).filter((h) => h.lead).length, 6, 'Vorbedingung: sechs Kapitelmarken');
  assert.ok(6 * 2 > sectionCount(alleLead), 'der Guard muss hier anschlagen');




  const html = read('index.html');
  const lead = sectionHeads(html).filter((h) => h.lead).length;
  assert.equal(lead * 2, sectionCount(html), 'der Stand liegt exakt auf der erlaubten Grenze');
});


const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(file) {
  const buf = readFileSync(file);
  assert.ok(buf.subarray(0, 8).equals(PNG_SIG), `${file} ist kein PNG`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function mobileShotFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('-mobile.png')) files.push(full);
    }
  };
  walk(SHOTS);
  return files;
}

function docsStylesheets() {
  const sheets = [{ where: 'assets/site.css', css: read('assets/site.css') }];
  for (const page of PAGES) {
    const html = read(page);
    const blocks = html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
    blocks.forEach((block, i) => {
      sheets.push({ where: `${page} <style> #${i + 1}`, css: block.replace(/^<style\b[^>]*>/i, '').replace(/<\/style>$/i, '') });
    });
  }
  return sheets;
}

function portraitRatioLiterals(sheets) {
  const found = [];
  for (const { where, css } of sheets) {
    for (const rule of eachRule(css)) {
      for (const decl of rule.body.split(';')) {
        const m = decl.match(/(^|[^-\w])aspect-ratio\s*:\s*([^;]+)$/);
        if (!m) continue;
        const value = m[2].trim().replace(/\s*!important$/, '');
        if (value.includes('var(')) continue;
        const parts = value.split('/').map((n) => Number(n.trim()));
        if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n) && n > 0)) continue;
        if (parts[0] >= parts[1]) continue;
        found.push({ where, selector: rule.selector, value });
      }
    }
  }
  return found;
}

function tokenRatio() {
  const css = read('assets/site.css');
  const m = css.match(/--ar-phone\s*:\s*([^;]+);/);
  assert.ok(m, '--ar-phone fehlt in docs/assets/site.css - die vier Handyrahmen haetten wieder keine gemeinsame Quelle');
  const parts = m[1].split('/').map((n) => Number(n.trim()));
  assert.equal(parts.length, 2, `--ar-phone muss ein Verhaeltnis "b / h" sein, war: ${m[1].trim()}`);
  return { w: parts[0], h: parts[1] };
}

test('docs: kein Handy-Seitenverhaeltnis steht als Literal in einer Regel', () => {
  const found = portraitRatioLiterals(docsStylesheets());
  assert.deepEqual(
    found, [],
    'hochkantes aspect-ratio als Literal - das ist die Bauart, an der .feat-phone (1320/1780) und '
    + '.mod-shot img (1320/1900) vom echten Mass weggelaufen sind. Es gehoert auf var(--ar-phone):\n'
    + found.map((f) => `  ${f.where}: ${f.selector} { aspect-ratio: ${f.value} }`).join('\n')
  );
});

test('docs:
  const token = tokenRatio();
  const files = mobileShotFiles();
  assert.ok(files.length > 0, 'keine -mobile.png gefunden - der Guard haette nichts zu vergleichen');

  const sizes = new Map();
  for (const file of files) {
    const { w, h } = pngSize(file);
    const key = `${w}x${h}`;
    if (!sizes.has(key)) sizes.set(key, []);
    sizes.get(key).push(file.slice(SHOTS.length + 1));
  }

  assert.equal(
    sizes.size, 1,
    'die Handyaufnahmen haben nicht mehr alle dasselbe Mass, ein Token kann sie also nicht mehr '
    + 'gemeinsam rahmen:\n'
    + [...sizes].map(([k, v]) => `  ${k}: ${v.length}x, z.B. ${v[0]}`).join('\n')
  );

  const [w, h] = [...sizes.keys()][0].split('x').map(Number);
  assert.deepEqual(
    { w: token.w, h: token.h }, { w, h },
    `--ar-phone steht auf ${token.w} / ${token.h}, die ${files.length} Aufnahmen sind aber ${w}x${h}. `
    + 'Ein getokenter falscher Wert ist derselbe Fehler mit besserer Buchhaltung.'
  );
});

test('der Ratio-Guard erkennt den Schaden, gegen den er gebaut ist', () => {

  const kaputt = [{
    where: 'test',
    css: '.feat-phone { display: block; width: 100%; aspect-ratio: 1320 / 1780; object-fit: cover; }\n'
      + '@media (max-width: 700px) { .mod-shot img { width: 100%; aspect-ratio: 1320 / 1900; } }',
  }];
  const treffer = portraitRatioLiterals(kaputt);
  assert.equal(treffer.length, 2, 'beide Fundstellen muessen anschlagen - auch die im @media-Block');
  assert.deepEqual(treffer.map((f) => f.value), ['1320 / 1780', '1320 / 1900']);



  const repariert = [{ where: 'test', css: kaputt[0].css.replace(/1320 \/ (?:1780|1900)/g, 'var(--ar-phone)') }];
  assert.deepEqual(portraitRatioLiterals(repariert), [], 'ueber den Token gefuehrt meldet der Guard nichts');
  assert.equal(
    portraitRatioLiterals([{ where: 'test', css: '.x { aspect-ratio: 1320 / 2867; }' }]).length, 1,
    'auch das RICHTIGE Verhaeltnis als Literal ist ein Treffer'
  );


  assert.deepEqual(
    portraitRatioLiterals([{ where: 'test', css: '.gal-frame img { aspect-ratio: 4 / 3; }' }]), [],
    '4/3 ist die Desktopaufnahme und darf als Literal stehen'
  );
});
