import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { eachRule } from './css-rules.js';

const STYLES_DIR = new URL('../public/styles/', import.meta.url);

const cssFiles = readdirSync(STYLES_DIR)
  .filter((name) => name.endsWith('.css'))
  .filter((name) => name !== 'tokens.css'); // Token-Quelle ist per Definition ausgenommen

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Liefert { line, text } je Deklaration der gegebenen Property. */
function declarations(css, prop) {
  const out = [];
  const re = new RegExp(`${prop}\\s*:\\s*([^;}]+)`, 'gi');
  let m;
  while ((m = re.exec(css)) !== null) {
    const line = css.slice(0, m.index).split('\n').length;
    out.push({ line, value: m[1].trim() });
  }
  return out;
}

const LITERAL = /(^|[\s(])-?\d*\.?\d+(px|rem|em)\b/;

function assertTypeRole(css, file, selector, token, message, alsoAllowed = []) {

  // darin: `.note-item__content .note-md-p { font-size: inherit }` setzt die



  // Funktioniert dadurch fuer `.widget__link` wie fuer `.split-card h3`.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const targets = new RegExp(`${escaped}(?![\\w-])(?:[:[][^\\s]*)*$`);
  const targetsSelector = (selectorText) => selectorText
    .split(',')
    .some((part) => targets.test(part.trim().replace(/\s+/g, ' ')));

  const rules = [...eachRule(css)].filter((rule) => targetsSelector(rule.selector));

  assert.ok(
    rules.length > 0,
    `${selector} kommt in ${file} in keiner Regel vor. Der Guard prueft damit nichts - `
    + 'wurde die Klasse umbenannt oder entfernt?',
  );

  const sizes = rules.flatMap((rule) => [...rule.body.matchAll(/font-size:\s*([^;]+)/g)]
    .map((m) => ({ value: m[1].trim(), where: rule.at.length ? `${rule.at.join(' / ')} { ${rule.selector} }` : rule.selector })));

  assert.ok(
    sizes.some(({ value }) => value === `var(${token})`),
    `${message}\n  ${selector} in ${file} setzt ${token} in keiner seiner ${rules.length} Regeln.`
    + `\n  Gefunden: ${sizes.map((s) => s.value).join(', ') || '(gar keine font-size)'}`,
  );







  const NEUTRAL = new Set(['inherit', 'unset', 'revert', '0', 'normal']);
  const allowed = new Set([`var(${token})`, ...alsoAllowed.map((t) => `var(${t})`)]);
  const wrong = sizes.filter(({ value }) => !allowed.has(value) && !NEUTRAL.has(value));
  assert.deepEqual(
    wrong.map((w) => `${w.where}: font-size: ${w.value}`),
    [],
    `${message}\n  ${selector} in ${file} setzt daneben eine abweichende Groesse - `
    + 'die spaetere gewinnt, die Rolle ist dann nur noch behauptet.',
  );
}

test('font-size wird ausschließlich über Tokens gesetzt (außer reset.css-Basis)', () => {
  const violations = [];
  for (const file of cssFiles) {
    if (file === 'reset.css') continue; // 1rem-Fundament
    const css = stripComments(readFileSync(new URL(file, STYLES_DIR), 'utf8'));
    for (const { line, value } of declarations(css, 'font-size')) {
      if (value.startsWith('var(')) continue;
      if (LITERAL.test(value)) violations.push(`${file}:${line} → font-size: ${value}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Hartkodierte font-size gefunden — stattdessen ein --text-*-Token nutzen:\n${violations.join('\n')}`,
  );
});

test('letter-spacing wird ausschließlich über Tracking-Tokens gesetzt', () => {
  const violations = [];
  for (const file of cssFiles) {
    const css = stripComments(readFileSync(new URL(file, STYLES_DIR), 'utf8'));
    for (const { line, value } of declarations(css, 'letter-spacing')) {
      if (value.startsWith('var(')) continue;
      if (/^(0|normal|inherit)$/.test(value)) continue;
      if (LITERAL.test(value)) {
        violations.push(`${file}:${line} → letter-spacing: ${value}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Hartkodiertes letter-spacing gefunden — stattdessen --tracking-tight/-normal/-label nutzen:\n${violations.join('\n')}`,
  );
});

test('die kanonischen Breakpoint-Tokens existieren in tokens.css', () => {
  const tokens = readFileSync(new URL('../public/styles/tokens.css', import.meta.url), 'utf8');
  for (const bp of ['--bp-mobile', '--bp-tablet', '--bp-desktop', '--bp-wide']) {
    assert.ok(tokens.includes(bp), `Breakpoint-Token ${bp} fehlt in tokens.css`);
  }
});

test('kein max-width einer Media-Query sitzt exakt auf einem Breakpoint-Kanonwert', () => {
  const violations = [];
  for (const file of cssFiles) {
    const css = stripComments(readFileSync(new URL(file, STYLES_DIR), 'utf8'));
    for (const at of css.matchAll(/@media([^{]*)\{/g)) {
      for (const bp of [640, 768, 1024, 1440]) {
        if (!new RegExp(`max-width:\\s*${bp}px`).test(at[1])) continue;
        const line = css.slice(0, at.index).split('\n').length;
        violations.push(`${file}:${line} → @media max-width: ${bp}px (Paarung: ${bp - 1}px)`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `max-width auf Kanonwert - die Grenze gehoert der grossen Seite (min-width):\n${violations.join('\n')}`,
  );
});

test('die Typografie-Rollen-Schicht steht als Regel, und der Eyebrow bleibt entfallen', () => {
  const typography = readFileSync(new URL('../public/styles/typography.css', import.meta.url), 'utf8');
  const selectors = [...eachRule(typography)].flatMap(({ selector }) => selector.split(','))
    .map((part) => part.trim());

  for (const role of ['.u-card-title', '.u-section-title', '.u-page-title']) {
    const declared = selectors.some((selector) => new RegExp(`(^|[\\s>+~])\\${role}([\\s.:[]|$)`).test(selector));
    assert.ok(declared, `Rollen-Klasse ${role} steht in typography.css in keiner Regel (nur ein Kommentar zaehlt nicht)`);
  }

  const eyebrow = selectors.filter((selector) => /(^|[\s>+~])\.u-eyebrow([\s.:[]|$)/.test(selector));
  assert.deepEqual(
    eyebrow,
    [],
    'Die Echte-Information-Regel verbietet die generische Eyebrow-Klasse - sie ist mit dem Rollout entfallen und darf nicht zurueckkehren',
  );

  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(
    indexHtml.includes('styles/typography.css'),
    'typography.css ist nicht in index.html eingebunden',
  );
});

test('kein Markup greift die entfallene Eyebrow-Klasse wieder auf', () => {
  const roots = ['../public/pages/', '../public/components/', '../public/settings/', '../public/utils/'];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) { walk(`${path}/`); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (/\bu-eyebrow\b/.test(readFileSync(new URL(path, import.meta.url), 'utf8'))) offenders.push(path);
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, [], `u-eyebrow ist entfallen und steht wieder im Markup:\n${offenders.join('\n')}`);
});

test('die Kopf-Titelrolle ist nicht frei adressierbar (u-toolbar-title bleibt entfallen)', () => {
  for (const file of cssFiles) {
    const css = stripComments(readFileSync(new URL(file, STYLES_DIR), 'utf8'));
    const declaring = [...eachRule(css)].flatMap(({ selector }) => selector.split(','))
      .map((part) => part.trim())
      .filter((part) => /(^|[\s>+~])\.u-toolbar-title([\s.:[]|$)/.test(part));
    assert.deepEqual(
      declaring,
      [],
      `${file} deklariert .u-toolbar-title - die Kopf-Titelrolle gehört den Shell-Klassen in typography.css`,
    );
  }

  const roots = ['../public/pages/', '../public/components/', '../public/settings/', '../public/utils/'];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) { walk(`${path}/`); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (/\bu-toolbar-title\b/.test(readFileSync(new URL(path, import.meta.url), 'utf8'))) offenders.push(path);
    }
  };
  for (const root of roots) walk(root);
  for (const single of ['../public/router.js', '../public/index.html', '../public/offline.html']) {
    if (/\bu-toolbar-title\b/.test(readFileSync(new URL(single, import.meta.url), 'utf8'))) offenders.push(single);
  }
  assert.deepEqual(
    offenders,
    [],
    `u-toolbar-title ist entfallen - die Kopf-Titelrolle wird nur über Shell-Klassen bezogen:\n${offenders.join('\n')}`,
  );
});

test('die Produkt-Typografie nutzt feste semantische Rollenwerte', () => {
  const tokens = readFileSync(new URL('../public/styles/tokens.css', import.meta.url), 'utf8');

  // Apple-Typo-Skala (HIG-Rollout 2026-08, DESIGN.md „Typography"): Large Title
  // 34 / Title 2 22 / Title 3 20 / Headline 17 / Body 17 / Subheadline 15 /


  //



  const expectedTokens = [
    ['--type-hero-mobile', '2.125rem'],
    ['--type-hero-desktop', '2.125rem'],
    ['--type-page-title-mobile', '2.125rem'],
    ['--type-page-title-desktop', '2.125rem'],
    ['--type-toolbar-title', '1.375rem'],
    ['--type-section-title', '1.25rem'],
    ['--type-card-title', '1.0625rem'],
    ['--type-body', '1.0625rem'],
    ['--type-secondary', '0.9375rem'],
    ['--type-caption', '0.8125rem'],
    ['--type-micro', '0.6875rem'],
  ];

  for (const [token, value] of expectedTokens) {
    assert.match(
      tokens,
      new RegExp(`${token}:\\s*${value.replace('.', '\\.')}`),
      `${token} muss als fester Rollenwert ${value} definiert sein`,
    );
  }
  assert.doesNotMatch(
    tokens,
    /--type-page-title-size:\s*clamp\(/,
    'Seitentitel dürfen in der Produktoberfläche nicht fluid skalieren',
  );
  assert.match(
    tokens,
    /--text-sm:\s*0\.875rem/,
    'die kompakte Sekundärstufe muss mindestens 14px groß sein',
  );
});

test('Raster und Liste der Dokumente verwenden dieselbe Titelrolle', () => {
  const typography = readFileSync(new URL('../public/styles/typography.css', import.meta.url), 'utf8');
  const cardTitleRole = typography.match(/\.u-card-title,[\s\S]*?\{[\s\S]*?font-size:\s*var\(--type-card-title\)/);

  assert.ok(cardTitleRole, 'die Karten-Titelrolle mit semantischem Token fehlt');
  assert.match(cardTitleRole[0], /\.document-card__title/, 'Dokumentkarten fehlen in der Titelrolle');
  assert.match(cardTitleRole[0], /\.document-row__title/, 'Dokumentzeilen fehlen in der Titelrolle');
});

test('sichtbare Split-Expense-Überschriften besitzen explizite Rollen', () => {
  const typography = readFileSync(new URL('../public/styles/typography.css', import.meta.url), 'utf8');

  assertTypeRole(typography, 'typography.css', '.split-group-header h2', '--type-section-title',
    'Gruppenüberschriften dürfen nicht auf die Browser-Standardgröße zurückfallen');
  assertTypeRole(typography, 'typography.css', '.split-card h3', '--type-card-title',
    'Kartenüberschriften dürfen nicht auf die Browser-Standardgröße zurückfallen');
});

test('Settings zeigen auf Leaf-Seiten nur den Leaf-Titel als sichtbare Hauptüberschrift', () => {
  const shell = readFileSync(new URL('../public/settings/shell.js', import.meta.url), 'utf8');
  const settingsCss = readFileSync(new URL('../public/styles/settings.css', import.meta.url), 'utf8');

  assert.match(
    shell,
    /classList\.toggle\('settings-page--leaf',\s*Boolean\(activeLeaf\)\)/,
    'die Settings-Shell muss Leaf-Seiten für die eindeutige Titelhierarchie markieren',
  );
  assert.match(
    settingsCss,
    /\.settings-page--leaf\s+\.settings-shell-header\s*\{\s*display:\s*none;/,
    'der globale Settings-Titel muss auf Leaf-Seiten visuell entfallen',
  );
  assert.doesNotMatch(
    shell,
    /renderDomainsOverview[\s\S]*?settings\.mobileOverviewTitle[\s\S]*?content\.replaceChildren/,
    'die mobile Root-Übersicht darf den sichtbaren Titel Einstellungen nicht duplizieren',
  );
});

test('Settings-Blätter wiederholen ihren eigenen Titel nicht als Unterüberschrift', async () => {




  const { SETTINGS_LEAVES } = await import('../public/settings/registry.js');
  const de = JSON.parse(readFileSync(new URL('../public/locales/de.json', import.meta.url), 'utf8'));
  const translate = (key) => key.split('.').reduce((value, segment) => value?.[segment], de);
  const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  const failures = [];
  for (const leaf of SETTINGS_LEAVES) {
    const file = String(leaf.loader).match(/\/settings\/(pages\/[\w-]+\.js)/)?.[1];
    assert.ok(file, `${leaf.id}: Loader-Pfad nicht erkennbar`);
    const source = readFileSync(new URL(`../public/settings/${file}`, import.meta.url), 'utf8');
    const label = normalize(translate(leaf.labelKey));


    for (const match of source.matchAll(/<h([23])\b[^>]*>\s*\$\{(?:esc\()?\s*t\(\s*['"]([\w.]+)['"]/g)) {
      const [, level, key] = match;
      if (normalize(translate(key)) === label) {
        failures.push(`${leaf.id}: <h${level}> wiederholt den Blatt-Titel "${translate(key)}" (${key})`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('kein sichtbarer Titel wiederholt den Namen eines Tabs seiner eigenen Leiste', async () => {

  // hierher ZWEI fest verdrahtete Dateien - health-tabs.js und health.js. Sein




  //



  //



  const de = JSON.parse(readFileSync(new URL('../public/locales/de.json', import.meta.url), 'utf8'));
  const translate = (key) => key.split('.').reduce((value, segment) => value?.[segment], de);
  const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  // Quellen je Seite: die Seitendatei plus ihre eigenen /utils/-Importe. Dort


  const readPublic = (path) => readFileSync(new URL(`../public${path}`, import.meta.url), 'utf8');
  const pageFiles = readdirSync(new URL('../public/pages/', import.meta.url))
    .filter((name) => name.endsWith('.js'));

  const failures = [];
  let barsSeen = 0;

  for (const name of pageFiles) {
    const page = readPublic(`/pages/${name}`);
    const sources = [page];
    for (const m of page.matchAll(/from\s+'(\/utils\/[\w./-]+\.js)'/g)) {
      try { sources.push(readPublic(m[1])); } catch { /* nicht aufloesbar */ }
    }









    //        entgegennimmt (`${renderTabButton('id', 'icon', t('x.y'))}`).
    const labelKeys = new Set();
    for (const src of sources) {
      for (const entry of src.matchAll(/\{[^{}]*\}/g)) {
        if (!/\broute:\s*['"]/.test(entry[0])) continue;
        const key = entry[0].match(/\blabelKey:\s*['"]([\w.]+)['"]/)?.[1];
        if (key) labelKeys.add(key);
      }
      for (const m of src.matchAll(/role="tablist"/g)) {
        const open = src.indexOf('>', m.index);
        if (open === -1) continue;
        const rest = src.slice(open + 1);
        const end = Math.min(
          ...[rest.indexOf('</nav>'), rest.indexOf('</div>')].filter((i) => i >= 0),
          rest.length,
        );
        for (const label of rest.slice(0, end).matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)) {
          labelKeys.add(label[1]);
        }
      }
    }
    if (!labelKeys.size) continue;
    barsSeen += 1;

    const tabLabels = new Set([...labelKeys].map((key) => normalize(translate(key))).filter(Boolean));




    //







    for (const match of page.matchAll(/<h([1-3])\b([^>]*)>\s*\$\{(?:esc\()?\s*t\(\s*(?:(panel\.titleKey)|['"]([\w.]+)['"])/g)) {
      const [, level, attrs, loopVar, key] = match;
      if (/\bsr-only\b/.test(attrs)) continue;
      const titles = loopVar ? [...tabLabels] : [normalize(translate(key))];
      for (const title of titles) {
        if (title && tabLabels.has(title)) {
          failures.push(`${name}: sichtbares <h${level}> wiederholt den Leisten-Namen „${title}"`);
        }
      }
    }
  }

  assert.ok(
    barsSeen >= 5,
    `Nur ${barsSeen} Module mit Leiste gefunden - der Guard misst dann fast nichts. `
    + 'Hat sich die Schreibweise der Tab-Leisten geändert?',
  );
  assert.deepEqual(failures, []);
});

test('kein sichtbarer Titel wiederholt den Namen des gewählten Eintrags einer Auswahlleiste', () => {










  //






  const readPublic = (path) => readFileSync(new URL(`../public${path}`, import.meta.url), 'utf8');
  const pageFiles = readdirSync(new URL('../public/pages/', import.meta.url))
    .filter((name) => name.endsWith('.js'));




  const TITLE_SLOT = /<(?:h[1-3]|span|div|p)\b([^>]*\b(?:page-toolbar__title|panel-head__title|list-header__name)\b[^>]*|[^>]*)>\s*\$\{(?:esc\()?\s*([\w.?[\]]+)/g;
  const HEADING = /<h[1-3]\b([^>]*)>\s*\$\{(?:esc\()?\s*([\w.?[\]]+)/g;

  const failures = [];
  let barsSeen = 0;

  for (const name of pageFiles) {
    const page = readPublic(`/pages/${name}`);





    const selected = new Map();   // Feldname -> Set der Sammlungen
    for (const m of page.matchAll(/\b(?:state\.)?(\w+)\s*\.map\(\s*\(?\s*(\w+)/g)) {
      const [, collection, item] = m;
      const body = page.slice(m.index, m.index + 900);





      if (!/--active\b|aria-selected|\bis-active\b|aria-current/.test(body)) continue;
      // Welches Feld beschriftet den Eintrag?
      for (const label of body.matchAll(new RegExp(`\\$\\{(?:esc\\()?\\s*${item}\\.(\\w+)`, 'g'))) {
        if (!selected.has(label[1])) selected.set(label[1], new Set());
        selected.get(label[1]).add(collection);
      }
    }
    if (!selected.size) continue;
    barsSeen += 1;


    //    erkennt man am Bezeichner: state.activeList, state.selectedAccount,

    //    verwendet.
    for (const pattern of [TITLE_SLOT, HEADING]) {
      pattern.lastIndex = 0;
      for (const m of page.matchAll(pattern)) {
        const [, attrs, expression] = m;
        if (/\bsr-only\b/.test(attrs)) continue;
        const field = expression.match(/\b(?:active|selected|current)\w*\??\.(\w+)$/i)?.[1];
        if (!field || !selected.has(field)) continue;
        const bars = [...selected.get(field)].join('`, `');
        failures.push(
          `${name}: sichtbarer Titel zeigt \`${expression}\` - dasselbe Feld beschriftet `
          + `bereits den aktiven Eintrag der Auswahlleiste über \`${bars}\`. `
          + 'Der gewählte Eintrag IST der Titel; was der Kopf sonst trägt, gehört neben ihn.',
        );
      }
    }
  }

  assert.ok(
    barsSeen >= 1,
    `Keine Auswahlleiste mit Aktivzustand gefunden (${barsSeen}) - der Guard misst dann nichts. `
    + 'Hat sich die Schreibweise der gemappten Leisten geändert?',
  );
  assert.deepEqual(failures, []);
});

test('lange Inhalts- und interaktive Texte verwenden mindestens die Sekundärrolle', () => {
  const dashboard = readFileSync(new URL('../public/styles/dashboard.css', import.meta.url), 'utf8');
  const notes = readFileSync(new URL('../public/styles/notes.css', import.meta.url), 'utf8');
  const recipes = readFileSync(new URL('../public/styles/recipes.css', import.meta.url), 'utf8');
  const calendar = readFileSync(new URL('../public/styles/calendar.css', import.meta.url), 'utf8');

  for (const selector of [
    '.widget__link',
    '.event-item__time',
    '.meal-slot__title',
    '.shopping-widget-item',
    '.note-item__content',
    '.budget-widget__footer',
  ]) {
    assertTypeRole(dashboard, 'dashboard.css', selector, '--type-secondary',
      `${selector} muss mindestens die 14px-Sekundärrolle verwenden`);
  }
  assertTypeRole(notes, 'notes.css', '.note-card__content', '--type-body',
    'Notiz-Fließtext muss die 16px-Bodyrolle verwenden');


  for (const selector of ['.recipe-detail__notes', '.recipe-detail__ingredient']) {
    assertTypeRole(recipes, 'recipes.css', selector, '--type-body',
      `${selector} muss die 16px-Bodyrolle verwenden`);
  }
  assertTypeRole(calendar, 'calendar.css', '.cal-toolbar__view-btn', '--type-secondary',
    'interaktive Kalender-Ansichtsschalter müssen mindestens 14px groß sein');
});

test('globale Toolbar- und Kartentitel folgen den semantischen Rollen', () => {
  const layout = readFileSync(new URL('../public/styles/layout.css', import.meta.url), 'utf8');
  const typography = readFileSync(new URL('../public/styles/typography.css', import.meta.url), 'utf8');



  // Abschnittsrolle (18px) in layout.css.
  // Mobil traegt derselbe Titel bewusst den Large Title: --type-page-title-mobile

  // kleinere Stufe" bleibt damit gewahrt. Jede dritte Groesse faellt auf.
  assertTypeRole(typography, 'typography.css', '.page-toolbar__title', '--type-toolbar-title',
    'Modul-Toolbartitel müssen die Canonical-Page-Head-Rolle (--type-toolbar-title, 22px) verwenden',
    ['--type-page-title-mobile']);





  const toolbarTitleInLayout = [...eachRule(layout)]
    .filter((rule) => /\.page-toolbar__title(?![\w-])/.test(rule.selector))
    .flatMap((rule) => [...rule.body.matchAll(/font-size:\s*([^;]+)/g)]
      .map((m) => `${rule.at.join(' / ') || 'Basisebene'}: ${rule.selector} -> ${m[1].trim()}`));
  assert.deepEqual(
    toolbarTitleInLayout,
    [],
    'layout.css darf die Toolbartitel-Größe nicht mehr setzen - die Rolle in typography.css ist die Quelle, '
    + 'und mobil darf der Titel auf keine kleinere semantische Stufe fallen.',
  );

  assertTypeRole(layout, 'layout.css', '.card__title', '--type-card-title',
    'generische Kartentitel müssen die 16px-Kartentitelrolle verwenden');
});

test('Such- und Schnellformular-Eingaben bleiben bei 16px', () => {
  const notes = readFileSync(new URL('../public/styles/notes.css', import.meta.url), 'utf8');
  const contacts = readFileSync(new URL('../public/styles/contacts.css', import.meta.url), 'utf8');
  const shopping = readFileSync(new URL('../public/styles/shopping.css', import.meta.url), 'utf8');







  const pageSearch = readFileSync(new URL('../public/styles/page-search.css', import.meta.url), 'utf8');
  assertTypeRole(pageSearch, 'page-search.css', '.page-search__input', '--text-base',
    'die geteilte Seitensuche darf nicht unter 16px fallen (sonst zoomt iOS beim Fokus)');
  for (const selector of ['quick-add__qty', 'quick-add__cat']) {
    assert.doesNotMatch(
      shopping,
      new RegExp(`\\.${selector}\\s*\\{\\s*font-size:\\s*var\\(--text-sm\\)`),
      `${selector} darf auf Desktop nicht unter 16px fallen`,
    );
  }
});
