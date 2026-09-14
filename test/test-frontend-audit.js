/**
 * Frontend audit regression tests.
 * Guards the accessibility and hard-constraint fixes from the UX audit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SETTINGS_DOMAINS, SETTINGS_LEAVES } from '../public/settings/registry.js';
import { eachRule } from './css-rules.js';
import { withoutHtmlComments, withoutBlockComments, withoutCommentsKeepingLines } from './source-text.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r/g, '');



// (`attrs: { id: 'foo' }`). Beide meinen dasselbe gerenderte Attribut.
const controlIdPattern = (id) => new RegExp(`id="${id}"|id:\\s*['"]${id}['"]`);

function walkJsFiles(dir) {
  const entries = readdirSync(new URL(dir, import.meta.url), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return walkJsFiles(`${path}/`);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

function walkFrontendFiles(dir) {
  const entries = readdirSync(new URL(dir, import.meta.url), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return walkFrontendFiles(`${path}/`);
    return entry.isFile() && /\.(html|js)$/.test(entry.name) ? [path] : [];
  });
}

function darkSchemeBlock(tokensCss) {
  for (const rule of eachRule(tokensCss)) {
    const chain = rule.at.join(' ');
    if (/prefers-color-scheme:\s*dark/.test(chain) && /:root/.test(rule.selector)) {
      return { 1: rule.body };
    }
  }
  return null;
}

function darkAttrBlock(tokensCss) {
  for (const rule of eachRule(tokensCss)) {
    if (/^\[data-theme="dark"\]$/.test(rule.selector.trim())) return { 1: rule.body };
  }
  return null;
}



// Aufrufs zu seinem Ergebnis-Bezeichner passt.
function settledCalls(source) {
  const marker = 'Promise.allSettled([';
  const calls = [];
  let from = 0;

  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) return calls;

    const names = source.slice(0, start).match(/const\s*\[([^\]]*)\]\s*=\s*await\s*$/);
    const entries = [''];
    let depth = 1;
    let index = start + marker.length;

    while (index < source.length && depth > 0) {
      const char = source[index];
      if ('([{'.includes(char)) depth += 1;
      else if (')]}'.includes(char)) depth -= 1;
      if (depth === 0) break;
      if (char === ',' && depth === 1) entries.push('');
      else entries[entries.length - 1] += char;
      index += 1;
    }

    if (names) calls.push({ names: names[1].split(',').map((name) => name.trim()), entries });
    from = index + 1;
  }
}





function enclosingObject(source, at) {
  let start = at;
  let depth = 0;
  while (start >= 0) {
    const char = source[start];
    if (char === '}') depth += 1;
    else if (char === '{') { if (depth === 0) break; depth -= 1; }
    start -= 1;
  }
  if (start < 0) return null;

  let end = start;
  depth = 0;
  while (end < source.length) {
    const char = source[end];
    if (char === '{') depth += 1;
    else if (char === '}') { depth -= 1; if (depth === 0) break; }
    end += 1;
  }
  return source.slice(start, end + 1);
}



function functionBody(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=`).exec(source);
  if (!match) return null;
  const open = source.indexOf('{', match.index + match[0].length);
  if (open === -1) return null;

  let depth = 0;
  let end = open;
  while (end < source.length) {
    const char = source[end];
    if (char === '{') depth += 1;
    else if (char === '}') { depth -= 1; if (depth === 0) break; }
    end += 1;
  }
  return source.slice(open, end + 1);
}

function resolveLocaleKey(obj, key) {
  return key.split('.').reduce((value, part) => (value != null ? value[part] : undefined), obj);
}

function assertKeysExistInEveryLocale(keys) {
  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url))
    .filter((file) => file.endsWith('.json'));
  const locales = localeFiles.map((file) => ({
    file,
    data: JSON.parse(read(`../public/locales/${file}`)),
  }));
  const missing = [];

  for (const key of keys) {
    for (const locale of locales) {
      if (resolveLocaleKey(locale.data, key) === undefined) {
        missing.push(`${key}:${locale.file}`);
      }
    }
  }

  assert.deepEqual(missing, []);
}




// als gemeint (CodeQL js/incomplete-sanitization).
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');



// Gelegenheit gewesen, dieselbe Falle wieder einzubauen. Seine Geschichte
// (drei bezahlte Blindstellen) steht dort im Kopfkommentar.

function cssRuleBody(css, selector) {
  const match = css.match(new RegExp(`${escapeForRegExp(selector)}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

function assertRuleUsesToken(css, selector, property, token, file) {
  const body = cssRuleBody(css, selector);
  assert.match(body, new RegExp(`${property}:\\s*var\\(${token}\\)`), `${file} ${selector} ${property} should use ${token}`);
}






// nach unseren Regeln geschrieben.
//


// (schedule.js), laufen seitdem ueber insertAdjacentHTML('afterend') + remove().
//







const VENDOR_PREFIX = '../public/vendor/';
const VENDOR_FILES = new Set(['../public/lucide.min.js']);
const HTML_STRING_WRITE = /(?:\.(?:innerHTML|outerHTML)|\[\s*(['"`])(?:innerHTML|outerHTML)\1\s*\])\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?!=)/;

test('kein innerHTML- oder outerHTML-Schreibzugriff irgendwo unter public/ (ausser vendor/)', () => {
  const files = walkJsFiles('../public/').filter((f) => !f.startsWith(VENDOR_PREFIX) && !VENDOR_FILES.has(f));
  const offenders = files.filter((file) => HTML_STRING_WRITE.test(read(file)));
  assert.deepEqual(offenders, [],
    'anhaengen mit insertAdjacentHTML oder ueber die DOM-API, User-Daten durch esc()');



  assert.ok(files.length >= 100, `nur ${files.length} Frontend-Dateien gefunden - der Scan greift nicht mehr`);
});

test('der innerHTML-Guard erkennt das Muster, das er verbietet', () => {
  const pattern = HTML_STRING_WRITE;
  assert.ok(pattern.test('root.innerHTML = `<div>`;'), 'Zuweisung wird nicht erkannt');
  assert.ok(pattern.test('el.innerHTML=""'), 'Zuweisung ohne Leerzeichen wird nicht erkannt');
  assert.ok(pattern.test('existing.outerHTML = html;'), 'outerHTML-Zuweisung wird nicht erkannt');
  assert.ok(pattern.test('list.innerHTML += row;'), 'Verbundzuweisung += wird nicht erkannt');
  assert.ok(pattern.test('el.outerHTML ||= html;'), 'logische Zuweisung ||= wird nicht erkannt');
  assert.ok(pattern.test('el.innerHTML ??= html;'), 'logische Zuweisung ??= wird nicht erkannt');
  assert.ok(pattern.test("el['outerHTML'] = html;"), 'Klammerschreibweise wird nicht erkannt');
  assert.ok(pattern.test('el["innerHTML"] += row;'), 'Klammerschreibweise mit += wird nicht erkannt');
  assert.ok(!pattern.test("const html = el['outerHTML'];"), 'ein Lesezugriff in Klammern wird faelschlich beanstandet');
  assert.ok(!pattern.test('if (el.innerHTML === x)'), 'ein Vergleich wird faelschlich beanstandet');
  assert.ok(!pattern.test('if (el.innerHTML !== x)'), 'eine Ungleichheit wird faelschlich beanstandet');
  assert.ok(!pattern.test('return emptyStateEl(opts).outerHTML;'), 'ein Lesezugriff wird faelschlich beanstandet');
});

test('kein HTML-Kommentar im Markup enthält ein Backtick', () => {
  const offenders = [];
  let scanned = 0;

  for (const file of walkJsFiles('../public/')) {
    if (file.includes('/vendor/')) continue;
    const source = read(file);
    const comments = [...source.matchAll(/<!--[\s\S]*?-->/g)];
    if (!comments.length) continue;
    scanned += comments.length;
    for (const [comment] of comments) {
      if (!comment.includes('`')) continue;
      offenders.push(`${file}: ${comment.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }

  assert.ok(
    scanned >= 10,
    `Nur ${scanned} HTML-Kommentare gefunden - der Scan ist blind geworden. `
    + 'Werden Seiten noch über Template-Literale gerendert?',
  );
  assert.deepEqual(
    offenders,
    [],
    'Ein Backtick in einem HTML-Kommentar schließt das umgebende Template-Literal '
    + 'und macht aus dem Rest ein Tagged Template - die Seite rendert dann gar nicht '
    + 'mehr. Klassennamen dort ohne Backticks schreiben.',
  );
});

test('static frontend translation keys exist in every locale', () => {
  const keys = new Set();

  for (const file of walkJsFiles('../public/')) {
    const source = read(file);
    [...source.matchAll(/\bt\(\s*(['"])([^'"]+)\1/g)].forEach((match) => keys.add(match[2]));
    [...source.matchAll(/labelKey:\s*['"]([^'"]+)['"]/g)].forEach((match) => keys.add(match[1]));
  }

  for (const file of walkFrontendFiles('../public/')) {
    const source = read(file);
    [...source.matchAll(/data-i18n=["']([^"']+)["']/g)].forEach((match) => keys.add(match[1]));
  }

  assertKeysExistInEveryLocale(keys);
});

test('app locale values do not ship German placeholder markers', () => {
  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url))
    .filter((file) => file.endsWith('.json'));
  const violations = [];

  function collect(value, path, file) {
    if (typeof value === 'string') {
      if (value.includes('[de:')) violations.push(`${file}:${path}`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) collect(child, path ? `${path}.${key}` : key, file);
  }

  for (const file of localeFiles) {
    collect(JSON.parse(read(`../public/locales/${file}`)), '', file);
  }

  assert.deepEqual(violations, []);
});

test('English and French user multi-select none labels are localized', () => {
  const en = JSON.parse(read('../public/locales/en.json'));
  const fr = JSON.parse(read('../public/locales/fr.json'));

  assert.equal(en.userMultiSelect.nobody, '- No one -');
  assert.equal(fr.userMultiSelect.nobody, '- Personne -');
});

test('dynamic frontend translation key domains exist in every locale', () => {
  const familyRoles = ['dad', 'mom', 'parent', 'child', 'grandparent', 'relative', 'other'];
  const documentCategories = ['medical', 'school', 'identity', 'insurance', 'finance', 'home', 'vehicle', 'legal', 'travel', 'pets', 'warranty', 'taxes', 'work', 'other'];
  const documentVisibilities = ['family', 'restricted', 'private'];
  const dashboardBudgetLabels = ['catHousing', 'catFood', 'catTransport', 'catPersonalHealth', 'catLeisure', 'catShoppingClothing', 'catEducation', 'catFinancialOther', 'catEarnedIncome', 'catInvestmentIncome', 'catTransferGiftIncome', 'catGovernmentBenefits', 'catOtherIncome'];
  const splitGroupTypes = ['household', 'couple', 'travel', 'event', 'shopping', 'general'];
  const splitMethods = ['equal', 'exact', 'percentage', 'shares'];



  const splitActivityTypes = ['group_created', 'group_updated', 'group_archived', 'member_added', 'member_removed', 'guest_created', 'expense_created', 'expense_edited', 'expense_deleted', 'comment_added', 'payment_registered', 'recurring_created', 'recurring_paused', 'recurring_resumed', 'recurring_generated'];

  const keys = [
    ...familyRoles.map((role) => `settings.familyRole${role.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`),
    ...documentCategories.map((category) => `documents.category.${category}`),
    ...documentVisibilities.map((visibility) => `documents.visibility.${visibility}`),
    ...dashboardBudgetLabels.map((key) => `budget.${key}`),
    ...splitGroupTypes.map((type) => `splitExpenses.groupType.${type}`),
    ...splitMethods.map((method) => `splitExpenses.splitHint.${method}`),
    ...splitActivityTypes.map((type) => `splitExpenses.activityType.${type}`),
  ];

  assertKeysExistInEveryLocale(keys);
});

test('settings information-architecture keys exist in every locale', () => {
  const keys = new Set();

  // Registry-derived labels/descriptions — the source of truth, never duplicated here.
  for (const domain of SETTINGS_DOMAINS) keys.add(domain.labelKey);
  for (const leaf of SETTINGS_LEAVES) {
    keys.add(leaf.labelKey);
    keys.add(leaf.descriptionKey);
  }

  // Shared Settings-IA copy that lives outside the registry but is part of the same surface.
  [
    // Shell chrome + overview headings.
    'settings.title',
    'settings.navigationLabel',
    'settings.breadcrumbLabel',
    'settings.backToSettings',
    'settings.loadError',
    'settings.retry',
    // Domain + mobile overview labels.
    'settings.mobileOverviewTitle',
    'settings.mobileOverviewDescription',
    'settings.mobileDomainTitle',
    // Status-first integration copy + progressive disclosure.
    'settings.providerSpecific',
    'settings.moreProviders',
    // Apple-legacy copy.
    'settings.legacy',
    'settings.appleLegacyHint',
    // Document backup warning.
    'settings.documentStorageBackupWarning',
    // Kitchen active count.
    'settings.kitchenActiveCount',
    // App navigation section labels.
    'nav.sectionOverview',
    'nav.sectionPlan',
    'nav.sectionHousehold',
    'nav.sectionPeople',
    'nav.sectionFinance',
    'nav.sectionCustomModules',
    // Unauthorized / access-redirected notice.
    'settings.accessRedirected',
  ].forEach((key) => keys.add(key));

  assertKeysExistInEveryLocale([...keys]);
});

test('service worker precaches every supported locale file', () => {
  const i18n = read('../public/i18n.js');
  const sw = read('../public/sw.js');
  const supportedLocales = [...i18n.match(/SUPPORTED_LOCALES\s*=\s*\[([^\]]+)\]/)?.[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
  const precachedLocales = [...sw.matchAll(/'\/locales\/([^']+)\.json'/g)].map((match) => match[1]).sort();

  assert.deepEqual(supportedLocales.sort(), localeFiles, 'SUPPORTED_LOCALES must match public/locales/*.json');
  assert.deepEqual(precachedLocales, supportedLocales.sort(), 'Service worker APP_LOCALES must precache every supported locale');
});

test('service worker release caches track package and deployment revisions and include the early locale bootstrap', () => {
  const pkg = JSON.parse(read('../package.json'));
  const sw = read('../public/sw.js');
  const release = sw.match(/const APP_RELEASE\s*=\s*['"]([^'"]+)['"]/)?.[1];

  assert.equal(release, pkg.version, 'Service worker APP_RELEASE must match package.json');
  assert.match(sw, /const APP_BUILD_REVISION\s*=\s*['"]__YUVOMI_BUILD_REVISION__['"]/);
  assert.match(sw, /const CACHE_RELEASE\s*=\s*`\$\{APP_RELEASE\}-\$\{APP_BUILD_REVISION\}`/);
  for (const cache of ['shell', 'pages', 'locales', 'assets', 'api']) {
    assert.match(sw, new RegExp(`aashiyana-${cache}-\\$\\{CACHE_RELEASE\\}`));
  }
  assert.match(sw, /['"]\/lang-init\.js['"]/, 'early lang/dir bootstrap must be available offline');
});

test('an announced update stops the router from loading further page modules (#616)', () => {
  const router = read('../public/router.js');



  // bereits geladenen, alten geteilten Module - ein neu hinzugekommener Export

  assert.match(router, /shellStale\s*=\s*true;/, 'SW_UPDATED must mark the running shell as stale');
  assert.match(router, /if \(shellStale && reloadOnce\(\)\)/, 'importPage() must reload instead of importing a page module');
  assert.match(router, /function prefetchRoute\(path\) \{[\s\S]*?if \(shellStale\) return;/, 'prefetchRoute() must stop warming modules after an update');
  assert.doesNotMatch(
    router,
    /SW_UPDATED[\s\S]{0,400}moduleCache\.clear\(\)/,
    'moduleCache.clear() on SW_UPDATED is ineffective - it empties only the router map, not the document module map',
  );
});

test('runtime locale changes keep language and writing direction synchronized', () => {
  const i18n = read('../public/i18n.js');
  const router = read('../public/router.js');

  assert.match(i18n, /const RTL_LOCALES\s*=\s*new Set\(\[['"]ar['"],\s*['"]fa['"]\]\)/);
  assert.match(i18n, /function applyDocumentLocale\(locale\)/);
  assert.match(i18n, /document\.documentElement\.lang\s*=\s*locale/);
  assert.match(i18n, /document\.documentElement\.dir\s*=\s*RTL_LOCALES\.has\(locale\)\s*\?\s*['"]rtl['"]\s*:\s*['"]ltr['"]/);
  assert.equal((i18n.match(/applyDocumentLocale\(/g) || []).length, 3);
  assert.match(
    router,
    /window\.addEventListener\(['"]locale-changed['"],\s*\(\)\s*=>\s*\{[\s\S]*rebuildNavigation\(\);[\s\S]*refreshCurrentRoute\(\);[\s\S]*\}\);/
  );
});

test('install prompt waits for initial translations before rendering text', () => {
  const i18n = read('../public/i18n.js');
  const prompt = read('../public/components/aashiyana-install-prompt.js');

  assert.match(i18n, /export function whenI18nReady/);
  assert.match(prompt, /import \{ t,\s*whenI18nReady \} from '\/i18n\.js';/);
  assert.match(prompt, /await whenI18nReady\(\)/);
});

test('date helpers produce local YYYY-MM-DD keys without toISOString slicing', async () => {
  const { toLocalDateKey } = await import('../public/utils/date.js');
  const date = new Date(2026, 4, 24, 2, 30, 0);
  assert.equal(toLocalDateKey(date), '2026-05-24');
});

test('meals, budget and waste pages do not slice toISOString for date keys', () => {
  for (const file of ['../public/pages/meals.js', '../public/pages/budget.js', '../public/pages/waste.js']) {
    assert.doesNotMatch(read(file), /toISOString\(\)\.slice\(0,\s*10\)/, `${file} must use local date keys`);
  }
});

test('die geteilte Sub-Tab-Leiste verlangt eine erklärte Semantik und verspricht kein Panel ohne Panel', () => {
  const source = read('../public/utils/sub-tabs.js');

  assert.match(source, /semantics !== 'nav' && semantics !== 'tabs'/,
    'renderSubTabs muss eine unbekannte Semantik ablehnen');
  assert.doesNotMatch(source, /semantics\s*=\s*['"]/,
    'semantics darf keinen Default haben - ein Default verbreitet die falsche Variante still');
  assert.match(source, /semantics === 'tabs' && typeof panelFor !== 'function'/,
    "eine Tablist ohne Panels ist eine Navigation - 'tabs' muss panelFor verlangen");

  // Navigation: echte Links mit aria-current, kein Tab-Vokabular.
  assert.match(source, /createElement\(isNav \? 'a' : 'button'\)/,
    'Zielorte sind Links, Sichten sind Buttons');
  assert.match(source, /setAttribute\('aria-current', 'page'\)/,
    'der aktive Zielort braucht aria-current="page"');


  assert.match(source, /const panel = panelFor\(btn\.dataset\.tabId\);/,
    'die Panels kommen vom Aufrufer, nicht aus einer Attributsuche im Baum');
  assert.match(source, /if \(!panel\) \{\s*\n\s*btn\.removeAttribute\('aria-controls'\);/,
    'ohne Panel muss aria-controls WEG statt ins Leere zu zeigen');
  assert.match(source, /btn\.setAttribute\('aria-controls', panel\.id\)/,
    'aria-controls muss auf die ID des gefundenen Panels zeigen');
  assert.match(source, /panel\.setAttribute\('aria-labelledby', btn\.id\)/);


  assert.doesNotMatch(source, /querySelectorAll\(\s*'\[data-panel\]'\s*\)/,
    'die Suche nach dem gesperrten data-panel darf nicht zurückkommen');
});


test('kein endlos animiertes Element traegt in derselben Regel einen filter', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);
  const offenders = [];
  let seenEndless = 0;

  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body, at } of eachRule(read(`../public/styles/${file}`))) {
      if (!/\banimation(-iteration-count)?\s*:[^;]*\binfinite\b/.test(body)) continue;
      seenEndless += 1;


      // (Issue #716): Glasflaechen abzuschalten brachte 20 → 24 fps, der

      const own = body.replace(/-webkit-backdrop-filter\s*:[^;]*;?/g, '')
        .replace(/\bbackdrop-filter\s*:[^;]*;?/g, '');
      const m = own.match(/(?:^|[;{\s])filter\s*:\s*([^;]+)/);
      if (!m || m[1].trim() === 'none') continue;
      offenders.push(`${file}${at.length ? ` [${at.join(' ')}]` : ''}: ${selector} -> filter: ${m[1].trim()}`);
    }
  }



  assert.ok(seenEndless >= 5,
    `Nur ${seenEndless} endlose Animationen gefunden - der Scanner findet public/styles/ `
    + 'nicht mehr, statt nichts zu beanstanden.');

  assert.deepEqual(offenders.sort(), [],
    'Bewegung und Filter liegen auf demselben Element: der Browser rastert den Filter '
    + 'damit pro Frame neu, im Leerlauf und solange die Seite offen ist (Issue #716). '
    + 'Beides gehoert auf zwei Knoten - die aeussere Huelle bewegt sich, das Kind traegt '
    + `den Filter und steht still (Vorbild: .lg-blob / .lg-blob__ink in glass.css).\n${offenders.join('\n')}`);
});

test('keine Bewegungskurve steht ausserhalb von tokens.css als Literal', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);
  const offenders = [];
  let seenCurveTokens = 0;

  for (const { selector, body, at } of eachRule(read('../public/styles/tokens.css'))) {
    seenCurveTokens += (body.match(/--ease-[a-z-]+\s*:/g) || []).length;
  }

  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    if (file === 'tokens.css') continue;
    for (const { selector, body, at } of eachRule(read(`../public/styles/${file}`))) {
      if (!/cubic-bezier\s*\(/.test(body)) continue;
      const m = body.match(/[^;{]*cubic-bezier\s*\([^)]*\)[^;}]*/);
      offenders.push(`${file}${at.length ? ` [${at.join(' ')}]` : ''}: ${selector} -> ${(m ? m[0] : '').trim()}`);
    }
  }



  assert.ok(seenCurveTokens >= 3,
    `Nur ${seenCurveTokens}
    + 'liest die Token-Datei nicht mehr, statt nichts zu beanstanden.');

  assert.deepEqual(offenders.sort(), [],
    'Eine Bewegungskurve steht als Literal in einem Bauteil statt als Token. Wer '
    + '`--ease-out` oder `--ease-glass` woertlich ausschreibt, folgt einer spaeteren '
    + 'Aenderung des Tokens nicht mehr; wer eine unbekannte Kurve schreibt, fuehrt eine '
    + 'vierte Bewegungssprache ohne Entscheidung ein. Kurven werden in tokens.css '
    + `benannt und hier nur benutzt.\n${offenders.join('\n')}`);
});



test('jede Wetterlage traegt ihren Ton in beiden Themes und loest ihn auch auf', () => {
  const page = read('../public/pages/dashboard.js');
  const tokens = read('../public/styles/tokens.css');
  const css = read('../public/styles/dashboard.css');

  const toneFn = page.match(/function weatherToneKey\([\s\S]*?\n}/);
  assert.ok(toneFn, 'weatherToneKey() nicht gefunden - die Quelle der Lagen ist weg.');
  const tones = [...new Set([...toneFn[0].matchAll(/return '([a-z]+)'/g)].map((m) => m[1]))];
  assert.ok(tones.length >= 6, `Nur ${tones.length} Wetterlagen gelesen - die Signatur greift nicht mehr.`);

  const bandsDecl = page.match(/const WEATHER_BANDS = \[([^\]]+)\]/);
  assert.ok(bandsDecl, 'WEATHER_BANDS nicht gefunden.');
  const bands = [...bandsDecl[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(bands.length >= 5, `Nur ${bands.length} Temperaturbaender gelesen.`);

  const darkScheme = darkSchemeBlock(tokens);
  const darkAttr = darkAttrBlock(tokens);
  assert.ok(darkScheme && darkAttr, 'Ein Dark-Block von tokens.css ist nicht auffindbar.');

  const missing = [];
  const check = (name, attr) => {
    if (!new RegExp(`\\n\\s*--_${name}:\\s*#`).test(tokens)) missing.push(`tokens.css :root --_${name}`);
    if (!new RegExp(`--_${name}:\\s*#`).test(darkScheme[1])) missing.push(`tokens.css prefers-color-scheme --_${name}`);
    if (!new RegExp(`--_${name}:\\s*#`).test(darkAttr[1])) missing.push(`tokens.css [data-theme=dark] --_${name}`);
    if (!new RegExp(`--${name}:\\s*var\\(--_${name}\\)`).test(tokens)) missing.push(`tokens.css oeffentliches --${name}`);
    if (!css.includes(attr)) missing.push(`dashboard.css ${attr}`);
  };

  for (const tone of tones) check(`weather-${tone}`, `[data-weather-tone="${tone}"]`);
  for (const band of bands) check(`weather-band-${band}`, `[data-weather-band="${band}"]`);

  assert.deepEqual(missing, [], `Wetter-Vokabular unvollstaendig:\n${missing.join('\n')}`);
});

test('jede Bewegung des Wetter-Widgets steht unter einer Bewegungs-Bedingung', () => {
  const page = read('../public/pages/dashboard.js');
  const css = read('../public/styles/dashboard.css');

  const motionFn = page.match(/function weatherMotionAttr\([\s\S]*?\n}/);
  assert.ok(motionFn, 'weatherMotionAttr() nicht gefunden.');
  const motions = [...new Set([...motionFn[0].matchAll(/data-weather-motion="([a-z]+)"/g)].map((m) => m[1]))];
  assert.ok(motions.length >= 4, `Nur ${motions.length} Gangarten gelesen - die Signatur greift nicht mehr.`);






  // prefers-reduced-motion-Bedingung stehen.
  const stray = [];
  let seen = 0;
  for (const rule of eachRule(css)) {
    if (!/weather-widget|weather-forecast|wall-weather|data-weather-motion/.test(rule.selector)) continue;
    if (!/\banimation(-name|-delay|-duration)?\s*:\s*(?!none)/.test(rule.body)) continue;
    seen += 1;
    const gated = rule.at.some((at) => /prefers-reduced-motion/.test(at));

    // von Umgebungsbewegung:




    //     passiert - Apple laesst seine Aktivitaetsanzeigen aus demselben Grund
    //     drehen. Die Zusicherung darunter belegt, dass er wirklich fluechtig

    const transient = /--spinning/.test(rule.selector);
    if (!gated && !/data-wall-night/.test(rule.selector) && !transient) {
      stray.push(`${rule.selector} -> ${rule.body.trim().slice(0, 60)}`);
    }
  }
  assert.ok(seen >= 6, `Nur ${seen} animierte Wetter-Regeln gesehen - die Signatur greift nicht mehr.`);
  assert.deepEqual(stray, [],
    'Bewegung am Wetter-Widget ohne Bewegungs-Bedingung. Sie gehoert in den\n'
    + '`@media (prefers-reduced-motion: no-preference)`-Block in dashboard.css -\n'
    + 'eine nachgeschobene `animation: none`-Gegenregel verliert gegen jeden\n'
    + `Selektor mit einem Zusatz mehr (gemessen am fallenden Regen).\n${stray.join('\n')}`);


  const inBlock = [...eachRule(css)]
    .filter((rule) => rule.at.some((at) => /prefers-reduced-motion:\s*no-preference/.test(at)))
    .map((rule) => rule.selector).join('\n');
  const missing = motions.filter((m) => !inBlock.includes(`[data-weather-motion="${m}"]`));
  assert.deepEqual(missing, [], `Gangart ohne Animation: ${missing.join(', ')}`);
  assert.match(inBlock, /weather-widget__glyph::before/, 'der Lichthauch muss im Bewegungsblock atmen');




  assert.match(page, /classList\.add\('weather-widget__refresh--spinning'\)/,
    'der Ladekringel muss beim Anstossen gesetzt werden');
  assert.match(page, /classList\.remove\('weather-widget__refresh--spinning'\)/,
    'der Ladekringel muss wieder entfernt werden - sonst ist er keine Rueckmeldung, sondern Dauerbewegung');
});

test('jedes benutzte Design-Token ist auch definiert', () => {

  const walkCss = (dir) => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) return entry.name === 'vendor' ? [] : walkCss(`${path}/`);
      return entry.isFile() && entry.name.endsWith('.css') ? [path] : [];
    });
  const files = [...walkFrontendFiles('../public/'), ...walkCss('../public/')];
  assert.ok(files.length > 100, `Nur ${files.length} Dateien gescannt - der Scanner findet public/ nicht mehr.`);
  assert.ok(files.some((f) => f.endsWith('tokens.css')), 'tokens.css muss im Scan liegen');




  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  const defined = new Set();
  const setFromJs = new Set();
  const used = new Map();

  for (const file of files) {
    const src = strip(read(file));
    for (const m of src.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) defined.add(m[1]);


    for (const m of src.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9_-]+)/g)) setFromJs.add(m[1]);
    for (const m of src.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)(\$\{)?\s*(,)?/g)) {

      // Glied dabei herauskommt, weiss erst die Laufzeit.
      if (m[2]) continue;
      const entry = used.get(m[1]) ?? { withFallback: false, bare: false, files: new Set() };
      if (m[3]) entry.withFallback = true; else entry.bare = true;
      entry.files.add(file.replace('../public/', ''));
      used.set(m[1], entry);
    }
  }

  assert.ok(defined.size > 300, `Nur ${defined.size} Tokens gefunden - der Scanner liest tokens.css nicht mehr.`);
  assert.ok(used.size > 300, `Nur ${used.size} Token-Nutzungen gefunden - der Scanner misst nichts.`);

  const offenders = [...used]
    .filter(([name]) => !defined.has(name) && !setFromJs.has(name))
    .map(([name, entry]) => `${name} (${entry.bare ? 'ohne Fallback' : 'mit Fallback'}) in ${[...entry.files].join(', ')}`);

  assert.deepEqual(offenders, [],
    'Benutzte Tokens ohne Definition:\n  ' + offenders.join('\n  ')
    + '\nOhne Fallback faellt die ganze Deklaration weg. Mit Fallback funktioniert sie und der Wert '
    + 'steht trotzdem ausserhalb der Skala - dann fehlt die Stufe, nicht der Fallback.');
});

test('jede Shadow-DOM-Komponente bringt ihren eigenen reduced-motion-Block mit', () => {
  const offenders = [];

  for (const file of walkFrontendFiles('../public/components/')) {
    const source = read(file);
    if (!/attachShadow\(/.test(source)) continue;


    if (!/transition:\s*(?!none)|animation:\s*(?!none)/.test(source)) continue;

    if (!/@media \(prefers-reduced-motion: reduce\)/.test(source)) {
      offenders.push(file.replace('../public/', ''));
    }
  }

  assert.deepEqual(offenders, [],
    'Shadow-DOM-Komponenten mit Bewegung, aber ohne eigenen reduced-motion-Block:\n  '
    + offenders.join('\n  ')
    + '\nDer globale Block in reset.css erreicht keinen Shadow Tree. PRODUCT.md sagt zu, dass jede '
    + 'Animation prefers-reduced-motion respektiert - diese Zusage muss die Komponente selbst halten.');
});

test('das Install-Banner faellt nicht in die abgeloeste Welt zurueck', () => {
  const source = read('../public/components/aashiyana-install-prompt.js');







  assert.doesNotMatch(source, /var\(\s*--[a-zA-Z0-9_-]+\s*,/,
    'Token-Fallbacks in der Komponente - der Token-Existenz-Guard deckt den Wegfall ab, '
    + 'ein Fallback konserviert nur eine alte Palette.');



  assert.match(source, /setTimeout\(finish/,
    '_remove() braucht eine Frist als zweiten Weg hinaus (transitionend feuert ohne Transition nie)');
});

test('der Install-Nachlauf haengt am gerenderten Banner, nicht an seiner Existenz', () => {
  const layout = read('../public/styles/layout.css');
  const source = read('../public/components/aashiyana-install-prompt.js');

  const setzer = layout.match(/:root:has\(aashiyana-install-prompt([^)]*)\)\s*\{[^}]*--install-prompt-tail/);
  assert.ok(setzer, 'die Regel, die --install-prompt-tail setzt, muss ueber :root:has(aashiyana-install-prompt...) laufen');
  assert.match(setzer[1], /\[[a-z-]+\]/,
    'das :has()-Argument braucht ein Zustands-Attribut. Ohne eines fragt der Selektor nur, ob das '
    + 'Element im DOM steht - und das ist es immer (index.html). Gemessen: 105px Nachlauf unter '
    + 'jedem Scrollport der App, dauerhaft, ohne je ein Banner zu zeigen.');

  const attr = setzer[1].match(/\[([a-z-]+)\]/)[1];
  assert.match(source, new RegExp(`setAttribute\\(\\s*SHOWN_ATTR|setAttribute\\(\\s*['"\`]${attr}['"\`]`),
    `das Bauteil muss ${attr} setzen, wenn das Banner steht - sonst fragt das CSS einen Zustand ab, den niemand meldet`);
  assert.match(source, new RegExp(`removeAttribute\\(\\s*SHOWN_ATTR|removeAttribute\\(\\s*['"\`]${attr}['"\`]`),
    `das Bauteil muss ${attr} beim Abbau wieder entfernen`);
});

test('jede matchMedia-Grenze einer Seite kennt ihr CSS auch', () => {





  // DIESELBEN Elemente wirkt - deshalb baut `own` je Seite auf.
  //


  // Grenze gehoert der grossen Seite, siehe test:typography);






  const threshold = (kind, px) => (kind === 'max' ? Number(px) + 1 : Number(px));
  const BOUNDARY = /\(\s*(min|max)-width:\s*(\d+)px\s*\)/g;

  const shared = new Set();
  for (const file of ['layout.css', 'tokens.css', 'list-row.css', 'panel.css', 'sub-tabs.css']) {
    for (const m of read(`../public/styles/${file}`).matchAll(BOUNDARY)) {
      shared.add(threshold(m[1], m[2]));
    }
  }

  const offenders = [];
  for (const path of walkJsFiles('../public/pages/')) {
    const page = path.split('/').pop().replace(/\.js$/, '');
    const cssPath = `../public/styles/${page}.css`;
    const own = new Set(shared);
    if (existsSync(new URL(cssPath, import.meta.url))) {
      for (const m of read(cssPath).matchAll(BOUNDARY)) own.add(threshold(m[1], m[2]));
    }


    // `matchMedia()` uebergebenen. Die erste Fassung suchte





    for (const m of withoutBlockComments(read(path)).matchAll(/['"`]\(\s*(min|max)-width:\s*(\d+)px\s*\)['"`]/g)) {
      if (!own.has(threshold(m[1], m[2]))) {
        offenders.push(`${path}: schaltet an der Schwelle ${threshold(m[1], m[2])}px (${m[1]}-width: ${m[2]}px), aber weder ${page}.css noch die geteilten Stylesheets kennen diese Schwelle`);
      }
    }
  }

  assert.deepEqual(offenders, [],
    'matchMedia-Grenze ohne Entsprechung im eigenen CSS - an genau dieser Zahl laufen Layout und '
    + 'Verhalten auseinander:\n  ' + offenders.join('\n  '));
});

test('keine Komponente definiert dieselbe Lifecycle-Methode zweimal', () => {
  const LIFECYCLE = ['connectedCallback', 'disconnectedCallback', 'adoptedCallback', 'attributeChangedCallback'];
  const offenders = [];

  for (const file of walkJsFiles('../public/components/')) {
    const src = read(file);
    for (const name of LIFECYCLE) {
      const treffer = [...src.matchAll(new RegExp(`^\\s{2}(?:async\\s+)?${name}\\s*\\(`, 'gm'))];
      if (treffer.length > 1) {
        offenders.push(`${file}: ${name} ist ${treffer.length}x definiert`);
      }
    }
  }

  assert.deepEqual(offenders, [],
    'doppelte Lifecycle-Methode - die spaetere ueberschreibt die fruehere lautlos:\n  '
    + offenders.join('\n  '));
});

test('der Hinweis am Formularlabel ist eine Klasse, kein Inline-Design-Wert', () => {
  assert.match(read('../public/styles/layout.css'), /\.form-label__hint \{[\s\S]{0,200}?color: var\(--color-text-tertiary\)/,
    'die abgestufte Label-Ergaenzung gehoert ins Stylesheet');
  assert.match(read('../public/pages/notes.js'), /<span class="form-label__hint">/,
    'notes.js muss die Klasse nutzen statt drei Werte inline zu schreiben');
});

test('die Wischgeste setzt und loest das Compositor-Versprechen selbst', () => {
  const swipe = read('../public/utils/swipe-row.js');
  const layout = read('../public/styles/layout.css');




  assert.match(layout, /\.swipe-row--armed > :not\(\.swipe-reveal\) \{\s*\n\s*will-change: transform;/,
    'die geteilte Buehne traegt das Versprechen, nicht die einzelnen Module');
  assert.match(layout, /\.swipe-row--swiping > :not\(\.swipe-reveal\) \{/,
    'die Traegerflaeche gehoert auf die bewegte Karte, nicht auf ein Reveal-Panel');
  assert.doesNotMatch(layout, /\.swipe-row--(?:armed|swiping) > :first-child/,
    ':first-child trifft in einer Wischzeile immer das Panel, nie die Karte');
  assert.match(swipe, /addEventListener\('touchstart'[\s\S]{0,900}?arm\(\);/,
    'gesetzt wird bei touchstart - bei der ersten Bewegung waere es einen Frame zu spaet');
  assert.match(swipe, /addEventListener\('touchcancel'/,
    'ein abgebrochener Kontakt muss die Ebene ebenfalls freigeben');
  assert.match(swipe, /disarm\(animate \? SWIPE_RESET_MS : 0\)/,
    'die Ebene faellt erst nach der Rueckfeder-Animation weg');

  for (const [file, selector] of [['shopping.css', '.shopping-item'], ['tasks.css', '.task-card']]) {
    const css = read(`../public/styles/${file}`);
    const body = [...eachRule(css)].find((rule) => rule.selector === `.swipe-row ${selector}`)?.body ?? '';
    assert.doesNotMatch(body, /will-change/,
      `${file}: die Dauerregel auf ${selector} darf nicht zurueckkommen`);
  }
});

test('der Wischhinweis feuert hoechstens einmal je Seitenbesuch', () => {
  const swipe = read('../public/utils/swipe-row.js');
  const fn = swipe.match(/export function maybeShowSwipeHint\([\s\S]*?\n\}/);
  assert.ok(fn, 'expected maybeShowSwipeHint to exist');

  assert.match(fn[0], /if \(hintShownForPath === location\.pathname\) return;/,
    'die Sperre muss VOR der Arbeit stehen, sonst zaehlt jeder Re-Render mit');
  assert.match(swipe, /^let hintShownForPath = null;$/m,
    'die Sperre gehoert auf Modulebene - der Pfad als Schluessel laesst den Hinweis bei einem spaeteren Besuch wieder zu');
  assert.ok(
    fn[0].indexOf('hintShownForPath = location.pathname') > fn[0].indexOf("querySelector('.swipe-row')"),
    'gesetzt wird die Sperre erst, wenn eine Zeile da war - eine leere Liste darf den Besuch nicht verbrauchen',
  );



  // updateCheckedActions(). noticeSwappedSides im selben Modul bringt dafuer

  for (const access of fn[0].matchAll(/localStorage\.\w+\(/g)) {
    const before = fn[0].slice(0, access.index);
    assert.ok(
      before.lastIndexOf('try {') > before.lastIndexOf('} catch'),
      `ungeschuetzter localStorage-Zugriff in maybeShowSwipeHint: ${access[0]}`,
    );
  }
  assert.ok([...fn[0].matchAll(/localStorage\.\w+\(/g)].length >= 2,
    'Reichweiten-Nachweis: kein localStorage-Zugriff gefunden - der Guard prueft nichts mehr');
});

test('jede JS-Datei unter public/ ist syntaktisch gueltiges ESM', () => {
  const files = walkFrontendFiles('../public/').filter((f) => f.endsWith('.js') && !f.includes('/vendor/'));
  assert.ok(files.length > 100, `Nur ${files.length} JS-Dateien gefunden - der Scanner findet public/ nicht mehr.`);

  const offenders = [];
  for (const file of files) {
    try {


      execFileSync(process.execPath, ['--check', new URL(file, import.meta.url).pathname], { stdio: 'pipe' });
    } catch (err) {
      const detail = String(err.stderr || err.message).split('\n').find((l) => /SyntaxError/.test(l)) || String(err.message).slice(0, 120);
      offenders.push(`${file.replace('../public/', '')}: ${detail.trim()}`);
    }
  }

  assert.deepEqual(offenders, [],
    'Dateien, die nicht parsen:\n  ' + offenders.join('\n  ')
    + '\nHaeufigste Ursache: ein Backtick in einem Kommentar INNERHALB eines Template-Literals.');
});


test('jede Sub-Tab-Leiste erklärt ihre Semantik, und zwar die, die ihre Routen hergeben', () => {

  const kitchen = read('../public/utils/kitchen-tabs.js');
  assert.match(kitchen, /semantics:\s*'nav'/,
    'die Küchen-Leiste wechselt das Modul; das ist Navigation, keine Tabs');
  assert.doesNotMatch(kitchen, /panelFor/,
    'ein Modulwechsel hat kein Panel im selben Dokument');


  const health = read('../public/utils/health-tabs.js');
  assert.match(health, /semantics:\s*'tabs'/,
    'die Gesundheits-Leiste tauscht ein Panel im selben Dokument; das sind Tabs');
  assert.match(health, /panelFor:\s*\(route\) =>[\s\S]*?data-health-panel/,
    'die Tabs müssen ihre echten Panels benennen');


  const healthPage = read('../public/pages/health.js');
  assert.match(healthPage, /data-health-panel="\$\{esc\(panel\.route\)\}"/,
    'health.js muss die Panels mit genau dem Attribut rendern, das panelFor sucht');
  assert.doesNotMatch(healthPage, /function showPanel\(/,
    'Auswahl und Panel-Sichtbarkeit sind eine Operation - zwei Besitzer laufen auseinander');
});

test('settings theme toggle exposes pressed state', () => {
  const source = read('../public/settings/pages/personal-appearance.js');
  assert.match(source, /aria-pressed/);
  assert.match(source, /setAttribute\('aria-pressed'/);
});

test('personal settings leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/personal-account.js',
    '../public/settings/pages/personal-appearance.js',
    '../public/settings/pages/personal-device.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    assert.match(read(file), /export async function render\(container,\s*\{\s*user\s*\}\)/);
  }
});

test('personal account leaf preserves self-profile, password, and logout contracts', () => {
  const source = read('../public/settings/pages/personal-account.js');

  assert.match(source, /await auth\.me\(\)/);
  assert.match(source, /Object\.assign\(user,\s*.*user/);
  assert.match(source, /auth\.updateProfile\(\{/);
  assert.match(source, /avatar_data:/);
  assert.match(source, /phone:/);
  assert.match(source, /email:/);
  assert.match(source, /birth_date:/);
  assert.match(source, /api\.patch\('\/auth\/me\/password',\s*\{\s*current_password:/);
  assert.match(source, /await auth\.logout\(\)/);
  assert.match(source, /window\.aashiyana\?\.navigate\('\/login'\)/);
  assert.match(source, /id="profile-avatar-file"[^>]*aria-label=/);
  assert.match(source, /id="profile-avatar-file"[^>]*tabindex="-1"/);
  assert.match(source, /id="profile-avatar-file"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="profile-error"[^>]*role="alert"/);
  assert.match(source, /id="password-error"[^>]*role="alert"/);
  assert.match(source, /id="profile-display-name"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="profile-phone"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="profile-email"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="profile-birth-date"[^>]*aria-describedby="profile-error"/);
  assert.match(source, /id="current-password"[^>]*aria-describedby="password-error"/);
  assert.match(source, /id="new-password"[^>]*aria-describedby="password-error"/);
  assert.match(source, /id="confirm-password"[^>]*aria-describedby="password-error"/);
  assert.match(source, /role="alert"[^>]*>\$\{t\('settings\.loadError'\)\}/);
});

test('#936: ein verknuepftes Rezept hat von der Essenskarte aus einen Ausgang', () => {


  // EXTERNE Adresse (`recipe_url`). Die Verknuepfung hatte also keinen Ausgang -
  // man konnte sie anlegen und nie benutzen.
  const meals = read('../public/pages/meals.js');
  const recipes = read('../public/pages/recipes.js');


  // und Startseite schon benutzen - kein dritter eigener Parameter.
  assert.match(meals, /data-action="open-linked-recipe"/);
  assert.match(meals, /href="\/recipes\?open=\$\{encodeURIComponent\(meal\.recipe_id\)\}"/);



  assert.match(recipes, /new URLSearchParams\(window\.location\.search\)\.get\('open'\)/);




  // Aufklappen.
  const renderAt = recipes.indexOf('export async function render(container)');
  assert.ok(renderAt > 0, 'render() existiert');
  const renderBody = recipes.slice(renderAt);
  assert.match(renderBody, /renderRecipeList\(\);\s*(?:\n\s*\/\/[^\n]*)*\n\s*openRecipeFromQuery\(\);/,
    'der Deep-Link wird nicht gelesen - /recipes?open=N oeffnet dann nichts');




  const handlerAt = meals.indexOf("action === 'open-linked-recipe'");
  assert.ok(handlerAt > 0, 'der Klick wird behandelt');
  const handler = meals.slice(handlerAt, handlerAt + 400);
  assert.match(handler, /metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/);
  assert.match(handler, /navigate\(/, 'ein roher href waere ein Vollreload der PWA');






  // vergisst.
  assert.match(meals, /closest\('\.meal-card__actions'\)\) return;/,
    'die Aktionsleiste muss als Ganzes vom Ziehen ausgenommen sein');
  assert.doesNotMatch(meals, /data-action="delete-meal"\], \[data-action=/,
    'die alte Aufzaehlung im Drag-Guard ist wieder da');




  assert.match(meals, /meal\.recipe_id && recipesReachable\(\)/,
    'der interne Knopf haengt nicht an der Erreichbarkeit des Rezeptmoduls');
  assert.match(meals, /isModuleDisabled\?\.\('recipes'\)/);



  // ausfiltert, waere per `?open=` unerreichbar - wortlos.
  assert.match(recipes, /has\('open'\)\)\s*\{\s*\n\s*state\.query = '';\s*\n\s*state\.sourceFilter = 'all';/,
    'ein alter Filter kann das verlangte Rezept verstecken');
});

test('#934: die Waehrung steht ausserhalb der ausblendbaren Formatkarte', () => {






  //


  // Formatkarte stehen, also ausserhalb von ihr.
  const source = read('../public/settings/pages/personal-appearance.js');

  const currencyAt = source.indexOf('id="currency-select"');
  const customAt   = source.indexOf('id="custom-formats"');
  assert.ok(currencyAt > 0, 'das Waehrungsfeld existiert');
  assert.ok(customAt > 0, 'die ausblendbare Formatkarte existiert');
  assert.ok(currencyAt < customAt,
    'das Waehrungsfeld liegt in der ausblendbaren Formatkarte - genau der Zustand aus #934');




  assert.match(source, /id="custom-formats"\$\{customHidden \? ' hidden' : ''\}/);
  assert.ok(source.indexOf('id="date-format-select"') > customAt,
    'das Datumsformat gehoert weiterhin in die ausblendbare Karte');
  assert.ok(source.indexOf('id="time-format-select"') > customAt,
    'das Zeitformat gehoert weiterhin in die ausblendbare Karte');









  // ersten Fassung dieser Zusicherung passiert.
  const syncStart = source.indexOf('function syncRegionSelect(');
  assert.ok(syncStart > 0, 'syncRegionSelect existiert');
  const syncBody = source.slice(syncStart, source.indexOf('\n}', syncStart));
  assert.match(syncBody, /applyCustomVisibility\(container, regionSelect\.value\)/,
    'syncRegionSelect zieht die Sichtbarkeit der Formatkarte nicht mit');


  assert.equal([...source.matchAll(/customBlock\.hidden/g)].length, 1);






  assert.equal([...source.matchAll(/syncRegionSelect\(container, \{ mayHide: false \}\)/g)].length, 2,
    'Datum und Uhrzeit muessen ihre eigene Karte offenhalten');





  assert.match(source, /derived === regionBefore \? regionBefore : CUSTOM_REGION/,
    'die Herleitung darf die Region bestaetigen, nicht wechseln');



  assert.match(source, /currencyDuringRegion\.disabled = true/);
  assert.match(source, /currencyDuringRegion\?\.isConnected\) currencyDuringRegion\.disabled = false/);
});

test('personal appearance leaf owns theme, locale, and regional preferences', () => {
  const source = read('../public/settings/pages/personal-appearance.js');

  assert.match(source, /await getPreferences\(\)/);
  assert.match(source, /getSupportedLocales\(\)/);
  assert.match(source, /setLocale\(/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /setAttribute\('aria-pressed'/);
  assert.match(source, /data-lucide="monitor"/);
  assert.match(source, /data-lucide="sun"/);
  assert.match(source, /data-lucide="moon"/);
  assert.match(source, /date_format/);
  assert.match(source, /time_format/);
  assert.match(source, /savePreferences\(\{/);
  assert.match(source, /function safeStorageGet\(/);
  assert.match(source, /function safeStorageSet\(/);
  assert.match(source, /function safeStorageRemove\(/);
  assert.match(source, /function safeStorageGet[\s\S]*try \{[\s\S]*localStorage\.getItem[\s\S]*catch/);
  assert.match(source, /function safeStorageSet[\s\S]*try \{[\s\S]*localStorage\.setItem[\s\S]*catch/);
  assert.match(source, /function safeStorageRemove[\s\S]*try \{[\s\S]*localStorage\.removeItem[\s\S]*catch/);
  assert.equal([...source.matchAll(/localStorage\.getItem/g)].length, 1);
  assert.equal([...source.matchAll(/localStorage\.setItem/g)].length, 1);
  assert.equal([...source.matchAll(/localStorage\.removeItem/g)].length, 1);
  assert.match(source, /function bindEvents\(container,\s*user\)/);
  assert.match(source, /await setLocale\(locale\);[\s\S]*await render\(container,\s*\{\s*user\s*\}\)/);
  assert.match(source, /if \(localeSelect\.isConnected\)\s*localeSelect\.disabled = false/);
  assert.match(source, /id="locale-error"[^>]*role="alert"/);
  assert.match(source, /id="date-format-error"[^>]*role="alert"/);
  assert.match(source, /id="time-format-error"[^>]*role="alert"/);
  assert.match(source, /id="locale-select"[^>]*aria-describedby="locale-error"/);



  assert.match(source, /id="formats-household-hint"[^>]*>\$\{t\('settings\.formatsHouseholdHint'\)\}/);
  assert.match(source, /id="date-format-select"[^>]*aria-describedby="formats-household-hint date-format-error"/);
  assert.match(source, /id="time-format-select"[^>]*aria-describedby="formats-household-hint time-format-error"/);
  assert.match(source, /role="alert"[^>]*>\$\{t\('settings\.loadError'\)\}/);
});

test('personal device leaf owns PWA installation state and disconnect cleanup', () => {
  const source = read('../public/settings/pages/personal-device.js');

  assert.match(
    source,
    /import \{\s*getPwaInstallState,\s*onPwaInstallStateChanged,\s*promptPwaInstall\s*\} from '\/utils\/pwa-install\.js';/,
  );
  assert.match(source, /onPwaInstallStateChanged\(/);
  assert.match(source, /promptPwaInstall\(\)/);
  assert.match(source, /!container\.isConnected/);
  assert.match(source, /if \(unsubscribed\) return/);
  assert.match(source, /stopListening\(\)/);
  assert.match(source, /new MutationObserver\(/);
  // Cleanup observes only the router's persistent swap container (#main-content),
  // not the whole document.body subtree (which fires on every app DOM mutation).
  assert.match(source, /getElementById\('main-content'\)/);
  assert.match(source, /observer\.observe\(swapRoot, \{ childList: true \}\)/);
  assert.doesNotMatch(source, /subtree:\s*true/);
  assert.match(source, /observer\?\.disconnect\(\)/);
  assert.match(source, /id="pwa-install-status"[^>]*aria-live=/);
  assert.match(source, /id="pwa-install-error"[^>]*role="alert"/);
  assert.match(source, /id="pwa-install-btn"[^>]*aria-describedby="pwa-install-status pwa-install-error"/);
});

test('module-specific settings leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/modules-kitchen.js',
    '../public/settings/pages/modules-calendar.js',
    '../public/settings/pages/modules-options.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    const source = read(file);
    assert.match(source, /export async function render\(container,\s*\{\s*user\s*\}\)/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, `${file} must not assign innerHTML`);
    assert.doesNotMatch(source, /\bfetch\(/, `${file} must use the shared API client`);
  }
});

test('module-specific settings leaves only reference their owned preferences and endpoints', () => {
  const ownership = {
    '../public/settings/pages/modules-kitchen.js': {
      endpoints: ['/preferences'],
      preferences: ['meal_type_names', 'visible_meal_types'],
    },
    '../public/settings/pages/modules-calendar.js': {
      endpoints: [
        '/preferences',
        '/preferences/holidays/countries',
        '/preferences/holidays/groups/',
        '/preferences/holidays/subdivisions/',
        '/preferences/holidays/sync',
      ],
      preferences: [
        'calendar_default_duration',
        'week_start',
        'holiday_country',
        'holiday_subdivision',
        'holiday_group',
        'holiday_show_public',
        'holiday_show_school',
        'holiday_public_color',
        'holiday_school_color',
        'holiday_last_sync',
      ],
    },
    '../public/settings/pages/modules-options.js': {
      endpoints: ['/preferences'],
      preferences: ['budget_mode', 'health_cycle_enabled', 'housekeeping_payment_tasks', 'tasks_subtasks_expanded', 'schedule_hidden_templates'],
    },
  };

  for (const [file, approved] of Object.entries(ownership)) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const endpoints = [
      ...source.matchAll(/\bapi\.(?:get|put|post|patch|delete)\(\s*`([^`$]*)/g),
      ...source.matchAll(/\bapi\.(?:get|put|post|patch|delete)\(\s*['"]([^'"]+)/g),
    ].map((match) => match[1]);

    // dazwischen, der Endpunkt bleibt derselbe (Critique 2026-07-27).
    if (/\b(?:get|save)Preferences\(/.test(source)) endpoints.push('/preferences');
    const preferenceKeys = new Set(
      [...source.matchAll(/\b(?:preferences|preferenceData)\.([a-z][a-z0-9_]*)/g)]
        .map((match) => match[1]),
    );
    for (const match of source.matchAll(/savePreferences\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      for (const keyMatch of match[1].matchAll(/\b([a-z][a-z0-9_]*)\s*:/g)) {
        preferenceKeys.add(keyMatch[1]);
      }
    }

    assert.deepEqual(
      [...new Set(endpoints)].sort(),
      [...approved.endpoints].sort(),
      `${file} must only call its approved endpoints`,
    );
    assert.deepEqual(
      [...preferenceKeys].sort(),
      [...approved.preferences].sort(),
      `${file} must only reference its owned preference keys`,
    );
  }
});

// `api.get('/preferences')` liefert den `{ data }`-Envelope, `getPreferences()`


// v1.49.0 dauerhaft leer, `disabled_modules` kam nie an, und jede abgehakte



test('preferences cache consumers never unwrap a data envelope', () => {
  const consumers = walkJsFiles('../public/').filter((file) => /\bgetPreferences\(/.test(read(file)));
  assert.ok(consumers.length >= 8, 'expected the settings leaves to read preferences through the cache');

  for (const file of consumers) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /getPreferences\(\)\s*\)*\s*\??\.data\b/,
      `${file} must not read .data off getPreferences() - it already returns the preferences object`,
    );

    const bindings = [...source.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+getPreferences\(\)/g)]
      .map((match) => match[1]);
    for (const call of settledCalls(source)) {
      call.entries.forEach((entry, index) => {
        if (/\bgetPreferences\(/.test(entry) && call.names[index]) bindings.push(`${call.names[index]}.value`);
      });
    }

    for (const binding of bindings) {
      assert.doesNotMatch(
        source,
        new RegExp(`${escapeForRegExp(binding)}\\s*\\??\\.data\\b`),
        `${file} must not read .data off the cached preferences (${binding})`,
      );
    }
  }
});

test('module-specific settings leaves preserve their required controls and behaviors', () => {
  const kitchen = read('../public/settings/pages/modules-kitchen.js');
  assert.match(kitchen, /const MEAL_TYPES = \['breakfast', 'lunch', 'dinner', 'snack'\]/);
  assert.match(kitchen, /await getPreferences\(\)/);
  assert.match(kitchen, /savePreferences\(\{ visible_meal_types: checkedMealTypes \}\)/);
  assert.match(kitchen, /MEAL_TYPES\.map\(/);
  assert.doesNotMatch(kitchen, /\/(?:recipes|shopping)|shopping\/categories|recipe_settings|shopping_settings/);

  const calendar = read('../public/settings/pages/modules-calendar.js');
  for (const id of [
    'holiday-country',
    'holiday-subdivision',
    'holiday-show-public',
    'holiday-public-color',
    'holiday-show-school',
    'holiday-school-color',
    'holiday-sync-btn',
  ]) {
    assert.match(calendar, controlIdPattern(id));
  }
  assert.match(calendar, /api\.get\('\/preferences\/holidays\/countries'\)/);
  assert.match(calendar, /api\.get\(`\/preferences\/holidays\/subdivisions\/\$\{countryCode\}`\)/);
  assert.match(calendar, /api\.post\('\/preferences\/holidays\/sync', \{\}\)/);

  // Haushaltweites plus der Verweis dorthin (Critique 2026-07-27).
  assert.doesNotMatch(calendar, /id="calendar-default-assign-me"|js-default-reminder/);
  assert.match(calendar, /\/settings\/personal\/calendar/);
  assert.doesNotMatch(calendar, /caldav|carddav|google|apple|subscriptions|sync accounts/i);
  assert.doesNotMatch(calendar, /#[0-9a-f]{6}/i);
  assert.match(calendar, /id="holiday-country" disabled/);
  assert.ok(
    calendar.indexOf("form.addEventListener('submit'") <
      calendar.indexOf('const countriesResult = await runHolidayDiscovery'),
    'Calendar must bind submit handling before loading holiday discovery data',
  );




  // /preferences-Request statt einem pro Schalter.
  const options = read('../public/settings/pages/modules-options.js');
  for (const id of ['budget-mode-personal', 'health-cycle-enabled', 'housekeeping-payment-tasks', 'tasks-subtasks-expanded']) {
    assert.match(options, controlIdPattern(id));
  }

  // `.map(...)`-Aufrufstelle statt vier einzelner TOGGLES-Eintraege (ein


  // `controlIdPattern` finden koennte. Die erzeugende Vorlage selbst pruefen.
  assert.match(options, /const SCHEDULE_TEMPLATES = \[/);
  assert.match(options, /id: `schedule-template-\$\{key\}`/, 'the three schedule template checkboxes must use the reviewed id pattern');




  assert.equal([...options.matchAll(/toggleRowHtml\(\{/g)].length, 5);
  assert.equal([...options.matchAll(/<(?:input|select|textarea)\b/g)].length, 0);
  assert.equal([...options.matchAll(/getPreferences\(\)/g)].length, 1);
  assert.match(options, /budget_mode: checked \? 'personal' : 'shared'/);


  assert.doesNotMatch(options, /id="currency-select"/);
  assert.match(options, /\/settings\/personal\/appearance/);
});

test('synchronization-by-data-type leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/sync-calendar.js',
    '../public/settings/pages/sync-contacts.js',
    '../public/settings/pages/sync-reminders.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    const source = read(file);
    assert.match(source, /export async function render\(container,\s*\{[^}]*\}(?:\s*=\s*\{\})?\)/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, `${file} must not assign innerHTML`);
    assert.doesNotMatch(source, /\bfetch\(/, `${file} must use the shared API client`);
    assert.doesNotMatch(source, /\brequire\(/, `${file} must use import, not require`);
    assert.match(
      source,
      /import \{ api \} from '\/api\.js'/,
      `${file} must import the shared API client`,
    );
  }
});

test('die Widget-Optionen sind auch am ausgeblendeten Widget erreichbar (#814)', () => {
  const source = read('../public/pages/dashboard.js');
  const widgets = read('../public/utils/dashboard-widgets.js');


  // ab Werk ausgeblendet, weil das Cockpit ihre Domaenen abdeckt. Genau sie



  const covered = widgets.match(/COCKPIT_COVERED_WIDGETS = new Set\(\[([^\]]*)\]/);
  assert.ok(covered, 'COCKPIT_COVERED_WIDGETS nicht gefunden - das Muster greift nicht mehr');
  const withOptions = source.match(/WIDGETS_WITH_OPTIONS = new Set\(\[([^\]]*)\]/);
  assert.ok(withOptions, 'WIDGETS_WITH_OPTIONS nicht gefunden');
  const optionIds = [...withOptions[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  const coveredIds = [...covered[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(optionIds.some((id) => coveredIds.includes(id)),
    'kein Options-Widget ist ab Werk ausgeblendet - dann ist diese Regel gegenstandslos geworden');


  const tray = source.match(/function renderHiddenWidgetsTray[\s\S]*?\n}/);
  assert.ok(tray, 'renderHiddenWidgetsTray nicht gefunden');
  assert.match(tray[0], /data-widget-options=/,
    'die Ablage bietet keine Optionen an - am ausgeblendeten Widget waeren sie unerreichbar');


  // `grid.querySelectorAll` faende sie nicht.
  assert.match(source, /container\.querySelectorAll\('\[data-widget-options\]'\)/,
    'die Optionen-Knoepfe der Ablage bekommen keinen Listener');
});

test('das Kopfband faehrt im selben Anpassen-Zyklus wie die Kacheln (#740)', () => {
  const source = read('../public/pages/dashboard.js');







  const widgetPuts = [...source.matchAll(/api\.put\('\/preferences',\s*\{[^}]*dashboard_widgets[^}]*\}/g)]
    .map((m) => m[0]);
  assert.ok(widgetPuts.length >= 2,
    `Nur ${widgetPuts.length} dashboard_widgets-PUTs gefunden - das Muster greift nicht mehr`);
  const withoutGlance = widgetPuts.filter((call) => !call.includes('dashboard_today_glance'));
  assert.deepEqual(withoutGlance, [],
    'Kacheln und Kopfband muessen in EINEM PUT gehen - sonst schreibt ein Fehlschlag die Haelfte:\n  '
    + withoutGlance.join('\n  '));
  assert.match(source, /function cancelDashboardConfig\(\)[\s\S]{0,200}?glanceVisible = savedGlanceVisible/,
    'Abbrechen stellt das Kopfband nicht zurueck');




  assert.match(source, /function resetDashboardConfig[\s\S]{0,1400}?glanceVisible = res\.data\?\.dashboard_today_glance !== false/,
    'Zuruecksetzen holt das Kopfband nicht aus der Vorgabe zurueck');
  assert.match(source, /dashboard_widgets: null, dashboard_today_glance: null/,
    'Zuruecksetzen muss BEIDE eigenen Werte loeschen - sonst folgt die Haelfte weiter dem alten Stand');
  assert.match(source, /glanceVisible = previousGlance/,
    'Rueckgaengig nimmt das Kopfband nicht mit zurueck');
  assert.match(source, /previousGlance !== glanceVisible/,
    'wurde NUR das Kopfband umgeschaltet, muss der Toast trotzdem Rueckgaengig anbieten');




  assert.match(source, /\(glanceVisible \|\| isCustomizing\)/,
    'ausgeblendet verschwindet das Kopfband auch im Bearbeiten-Modus');
  assert.match(source, /!parts\.length && !editing/,
    'ohne Inhalt faellt das Kopfband auch im Bearbeiten-Modus weg');
  assert.match(source, /data-glance-show/,
    'ausgeblendet fehlt der Weg zurueck ueber die Chip-Leiste');
});

test('sync-calendar leaf loads CalDAV, Google, and Apple with independent status', () => {
  const source = read('../public/settings/pages/sync-calendar.js');

  // CalDAV calendar account management + status before forms.
  assert.match(source, /api\.get\('\/calendar\/caldav\/accounts'\)/);
  assert.match(source, /api\.post\('\/calendar\/caldav\/accounts'/);



  // Schreibweise statt der Absicht.
  assert.match(source, /api\.delete\(\s*`\/calendar\/caldav\/accounts\/\$\{[^}]+\}/);
  assert.match(source, /\/calendar\/caldav\/accounts\/\$\{[^}]+\}\/calendars/);
  assert.match(source, /api\.post\('\/calendar\/caldav\/sync'\)/);
  assert.match(source, /createStatusSummary\(/);
  assert.match(source, /t\('settings\.caldavTitle'\)/);
  assert.match(source, /enabledCalendarCount/);
  assert.match(source, /neverSynced/);



  assert.match(source, /account\.lastSync/);
  assert.match(source, /account\.caldavUrl/);
  assert.doesNotMatch(source, /account\.last_sync|account\.caldav_url/);

  assert.match(source, /import \{ withBusy \} from '\/utils\/ux\.js'/);
  assert.doesNotMatch(source, /checkbox\.disabled = true/);
  // Gleiche Aufklapp-Grammatik wie Kontakt-Sync (createDisclosure, kein <details>),

  assert.match(source, /createDisclosure\(\{[\s\S]*?caldav-calendars-/);
  assert.doesNotMatch(source, /createElement\('details'\)/);
  assert.match(source, /disconnectAccountConfirmTitle', \{ name: account\.name \}/);

  // Independent fetches so one failure does not hide the others.
  assert.match(source, /Promise\.allSettled/);

  // Reminder-list collections must NOT leak into the calendar leaf.
  assert.doesNotMatch(source, /reminder-lists/);
  assert.doesNotMatch(source, /\/calendar\/caldav\/reminders\/sync/);

  // Google + Apple live behind one accessible "More providers" disclosure.
  assert.match(source, /createDisclosure\(/);
  assert.match(source, /settings\.moreProviders/);

  // Google: provider-specific labelled, all endpoints preserved.
  assert.match(source, /settings\.providerSpecific/);
  assert.match(source, /api\.get\('\/calendar\/google\/status'\)/);
  assert.match(source, /\/api\/v1\/calendar\/google\/auth/);
  assert.match(source, /api\.post\('\/calendar\/google\/sync'/);
  assert.match(source, /api\.get\('\/calendar\/google\/calendars'\)/);
  assert.match(source, /api\.patch\('\/calendar\/google\/calendars'/);
  assert.match(source, /api\.put\('\/calendar\/google\/readonly'/);

  // CalDAV-Konto darueber: seit #820 haengt ein `?deleteEvents=` daran.
  assert.match(source, /api\.delete\(`\/calendar\/google\/disconnect\?deleteEvents=/);
  assert.match(source, /api\.delete\(endpoint\)/);
  assert.match(source, /'\/calendar\/google\/mirrored-events'/);



  assert.match(source, /appendSyncError\(status, googleStatus\?\.lastError\)/);
  assert.match(source, /appendSyncError\(status, appleStatus\?\.lastError\)/);
  assert.match(source, /t\('settings\.syncErrorDetail', \{ error: lastError \}\)/);

  // Apple: legacy badge + hint steering new users to CalDAV, endpoints preserved.
  assert.match(source, /settings\.legacy/);
  assert.match(source, /settings\.appleLegacyHint/);
  assert.match(source, /api\.get\('\/calendar\/apple\/status'\)/);
  assert.match(source, /api\.post\('\/calendar\/apple\/connect'/);
  assert.match(source, /api\.post\('\/calendar\/apple\/sync'/);
  assert.match(source, /api\.delete\(`\/calendar\/apple\/disconnect\?deleteEvents=/);
  assert.match(source, /'\/calendar\/apple\/mirrored-events'/);

  // OAuth callback handling: localized banner, expand disclosure, scrub only callback params.
  assert.match(source, /sync_ok/);
  assert.match(source, /sync_error/);
  assert.match(source, /history\.replaceState/);
});

test('die Kalender-Abos liegen im persoenlichen Blatt, nicht hinter dem Admin-Gate', () => {
  const source = read('../public/settings/pages/personal-calendar-subscriptions.js');
  const registry = read('../public/settings/registry.js');


  // `shared = 1 OR created_by = ich`, schreiben antwortet 403 fuer fremde Abos.
  assert.match(source, /api\.get\('\/calendar\/subscriptions'\)/);
  assert.match(source, /api\.post\('\/calendar\/subscriptions'/);
  assert.match(source, /api\.patch\(`\/calendar\/subscriptions\/\$\{[^}]+\}`/);
  assert.match(source, /api\.delete\(`\/calendar\/subscriptions\/\$\{[^}]+\}`\)/);

  assert.match(source, /api\.post\('\/calendar\/import'/);



  // viermal gemacht hat (calendar-defaults, task-defaults #695, navigation,

  const leaf = registry.match(/\{[^{}]*id: 'personal-calendar-subscriptions'[\s\S]*?\n  \}/);
  assert.ok(leaf, 'personal-calendar-subscriptions fehlt in der Registry');
  assert.match(leaf[0], /adminOnly: false/,
    'das Blatt der Kalender-Abos darf nicht adminOnly sein - der Server gatet sie nicht');
  assert.match(leaf[0], /domainId: 'personal'/);




  assert.doesNotMatch(source, /\/calendar\/caldav\//);
  assert.doesNotMatch(source, /\/calendar\/google\//);
  assert.doesNotMatch(source, /\/calendar\/apple\//);
});

test('sync-contacts leaf owns CardDAV account management', () => {
  const source = read('../public/settings/pages/sync-contacts.js');

  assert.match(source, /api\.get\('\/contacts\/cardav\/accounts'\)/);
  assert.match(source, /api\.post\('\/contacts\/cardav\/accounts'/);
  assert.match(source, /api\.delete\(`\/contacts\/cardav\/accounts\/\$\{[^}]+\}`\)/);
  assert.match(source, /\/contacts\/cardav\/accounts\/\$\{[^}]+\}\/addressbooks/);

  assert.match(source, /api\.put\(`\/contacts\/cardav\/addressbooks\/\$\{[^}]+\}`/);
  assert.doesNotMatch(source, /addressbooks\/toggle/);
  assert.match(source, /addressbooks\/refresh/);
  assert.match(source, /\/contacts\/cardav\/accounts\/\$\{[^}]+\}\/sync/);

  assert.match(source, /account\.lastSync/);
  assert.doesNotMatch(source, /account\.last_sync|account\.cardav_url/);




  assert.match(source, /import \{ withBusy \} from '\/utils\/ux\.js'/);
  assert.match(source, /withBusy\(checkbox/);
  assert.match(source, /loadingClass: 'btn--loading'/);
  assert.match(source, /btn--danger-outline/);
  assert.match(source, /function buildUnreachableAccount/);
  assert.match(source, /t\('common\.retry'\)/);



  // meldet keinen Erfolg ohne aktiviertes Adressbuch.
  assert.match(source, /disconnectAccountConfirmTitle', \{ name: account\.name \}/);
  // Fremdserver-Passwort: weder das App-Passwort anbieten (current-password)

  assert.match(source, /id="cardav-password"[^>]*autocomplete="off"/);
  assert.doesNotMatch(source, /autocomplete="(current|new)-password"/);
  assert.match(source, /cardavCredentialsTrustHint/);
  assert.match(source, /wireBlurValidation\(form\)/);
  assert.match(source, /if \(!validateAll\(form\)\) return;/);
  assert.doesNotMatch(source, /t\('common\.allFieldsRequired'\)/);
  // Inaktiver Sync-Button bleibt tabbar: aria-disabled statt disabled, Klick

  assert.match(source, /syncBtn\.setAttribute\('aria-disabled'/);
  assert.doesNotMatch(source, /syncBtn\.disabled = /);
  assert.doesNotMatch(source, /syncBtn\.title = /);
  assert.match(source, /aria-disabled'\) === 'true'\) return;/);
  assert.match(source, /syncBtn\.setAttribute\('aria-describedby'/);
  assert.match(source, /noAddressbookEnabled/);
  assert.match(source, /notSyncedYet/);

  assert.match(source, /addressbooksEnabledOfTotal/);
  assert.doesNotMatch(source, /key: 'addressbook-count'/);



  assert.match(source, /api\.put\(`\/contacts\/cardav\/accounts\/\$\{account\.id\}`/);
  assert.match(source, /settings\.cardavEditAccount/);
  assert.match(source, /settings\.enableAll/);
  assert.match(source, /settings\.disableAll/);
  assert.match(source, /account\.lastError/);
  assert.match(source, /settings\.syncErrorDetail/);
  // Geteilte Aufklapp-Komponente statt rohem <details>.
  assert.match(source, /createDisclosure\(\{/);
  assert.doesNotMatch(source, /createElement\('details'\)/);
  assert.doesNotMatch(source, /details = \[t\('settings\.cardavTitle'\)\]/, 'Modultitel nicht als Detailzeile wiederholen');

  // Contacts leaf must not own calendar or reminder concerns.
  assert.doesNotMatch(source, /\/calendar\/caldav/);
  assert.doesNotMatch(source, /\/calendar\/google/);
  assert.doesNotMatch(source, /\/calendar\/apple/);
});

test('sync-reminders leaf maps CalDAV reminder lists and syncs without calendars', () => {
  const source = read('../public/settings/pages/sync-reminders.js');

  // Reuse CalDAV accounts but render only reminder/task collections.
  assert.match(source, /api\.get\('\/calendar\/caldav\/accounts'\)/);
  assert.match(source, /reminder-lists/);
  assert.match(source, /api\.patch\(`\/calendar\/caldav\/accounts\/\$\{[^}]+\}\/reminder-lists`/);
  assert.match(source, /api\.post\('\/calendar\/caldav\/reminders\/sync'\)/);
  assert.match(source, /targetModule/);
  assert.match(source, /settings\.caldavReminderMapTasks/);
  assert.match(source, /settings\.caldavReminderMapShopping/);
  assert.match(source, /settings\.caldavRemindersHint/);




  assert.match(source, /isICloudAccount\(account\.caldavUrl\)/);
  assert.match(source, /settings\.caldavRemindersAppleNote/);
  assert.match(source, /icloud\.com/);


  assert.match(source, /account\.lastSync/);
  assert.match(source, /account\.caldavUrl/);
  assert.doesNotMatch(source, /account\.last_sync|account\.caldav_url/);
  assert.match(source, /import \{ withBusy \} from '\/utils\/ux\.js'/);

  // Calendar collections must NOT appear in the reminders leaf.
  assert.doesNotMatch(source, /\/calendars\b/);
  assert.doesNotMatch(source, /\/calendar\/caldav\/sync\b/);
});

test('documents-domain leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/documents-storage.js',
    '../public/settings/pages/documents-dms.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    const source = read(file);
    assert.match(source, /export async function render\(container,\s*\{[^}]*\}(?:\s*=\s*\{\})?\)/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, `${file} must not assign innerHTML`);
    assert.doesNotMatch(source, /\bfetch\(/, `${file} must use the shared API client`);
    assert.doesNotMatch(source, /\brequire\(/, `${file} must use import, not require`);
    assert.match(
      source,
      /import \{ api \} from (['"])\/api\.js\1/,
      `${file} must import the shared API client`,
    );
  }
});

test('documents-storage leaf owns hybrid document storage with a status-first layout', () => {
  const source = read('../public/settings/pages/documents-storage.js');

  // Storage config + test endpoints preserved unchanged.
  assert.match(source, /api\.get\((['"])\/documents\/storage\/config\1\)/);
  assert.match(source, /api\.put\((['"])\/documents\/storage\/config\1/);
  assert.match(source, /api\.post\((['"])\/documents\/storage\/test\1/);

  // Status-first: render the active backend and target before the connection fields.
  assert.match(source, /createStatusSummary\(/);
  assert.match(source, /active_upload_backend/);
  assert.match(source, /selected_upload_backend/);
  assert.match(source, /webdav_document_count/);
  assert.match(source, /google_drive/);
  assert.match(source, /documentStorageTarget/);

  // Drive uses the shared API client and a normal anchor for OAuth.
  assert.match(source, /\/documents\/storage\/google-drive\/auth/);
  assert.match(source, /api\.post\((['"])\/documents\/storage\/google-drive\/test\1/);
  assert.match(source, /api\.delete\((['"])\/documents\/storage\/google-drive\/disconnect\1/);
  assert.match(source, /createSettingRow\(/);
  assert.match(source, /drive_ok/);
  assert.match(source, /drive_error/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /settings\.documentStorageGoogleDrivePrivacy/);

  // Connection fields live behind an accessible disclosure.
  assert.match(source, /createDisclosure\(/);

  // Protected-change detection + confirm before save.
  assert.match(source, /hasProtectedDocumentStorageChange/);
  assert.match(source, /settings\.documentStorageConfirmExisting/);

  // Env-controlled handling + backup warning preserved.
  assert.match(source, /env_controlled/);
  assert.match(source, /settings\.documentStorageBackupWarning/);

  // Storage leaf must not own DMS concerns.
  assert.doesNotMatch(source, /\/documents\/dms/);
});

test('documents-dms leaf owns DMS account management (Paperless + Papra)', () => {
  const source = read('../public/settings/pages/documents-dms.js');

  assert.match(source, /api\.get\('\/documents\/dms\/accounts'\)/);
  assert.match(source, /api\.post\('\/documents\/dms\/accounts'/);
  assert.match(source, /api\.delete\(`\/documents\/dms\/accounts\/\$\{[^}]+\}`\)/);
  assert.match(source, /\/documents\/dms\/accounts\/\$\{[^}]+\}\/test/);
  assert.match(source, /value="paperless"/);
  assert.match(source, /value="papra"/);

  // DMS leaf must not own storage concerns.
  assert.doesNotMatch(source, /\/documents\/storage/);
});

test('administration-domain leaves exist and export async render functions', () => {
  const files = [
    '../public/settings/pages/admin-family.js',
    '../public/settings/pages/admin-api.js',
    '../public/settings/pages/admin-backup.js',
    '../public/settings/pages/admin-weather.js',
    '../public/settings/pages/admin-system.js',
  ];

  for (const file of files) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} must exist`);
    const source = read(file);
    assert.match(source, /export async function render\(container,\s*\{[^}]*\}(?:\s*=\s*\{\})?\)/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, `${file} must not assign innerHTML`);
    assert.doesNotMatch(source, /\bfetch\(/, `${file} must use the shared API client`);
    assert.doesNotMatch(source, /\brequire\(/, `${file} must use import, not require`);


    assert.match(
      source,
      /import \{ api(?:,\s*auth)? \} from '\/api\.js'|from '\/settings\/(?:preferences-cache|weather-location)\.js'/,
      `${file} must import the shared API client`,
    );
  }
});

test('admin-family leaf owns family member + role management lazily', () => {
  const source = read('../public/settings/pages/admin-family.js');

  // Users are fetched only when the leaf is active, via the auth helper.
  assert.match(source, /auth\.getUsers\(\)/);
  assert.match(source, /auth\.createUser\(/);
  assert.match(source, /auth\.updateUser\(/);
  assert.match(source, /auth\.deleteUser\(/);
  assert.match(source, /buildFamilyRoleOptions/);
  assert.match(source, /family_role/);
  assert.match(source, /birth_date/);

  // Family leaf must not own API token, backup, or version concerns.
  assert.doesNotMatch(source, /\/auth\/api-tokens/);
  assert.doesNotMatch(source, /\/backup\//);
  assert.doesNotMatch(source, /\/version/);
});

test('admin-api leaf owns API token lifecycle with one-time secret display', () => {
  const source = read('../public/settings/pages/admin-api.js');

  assert.match(source, /api\.get\('\/auth\/api-tokens'\)/);
  assert.match(source, /api\.post\('\/auth\/api-tokens'/);
  assert.match(source, /api\.delete\(`\/auth\/api-tokens\/\$\{[^}]+\}`\)/);

  // The raw token is only ever read from the creation response.
  assert.match(source, /res\.token/);

  // API leaf must not own family, backup, or version concerns.
  assert.doesNotMatch(source, /\/auth\/users/);
  assert.doesNotMatch(source, /\/backup\//);
  assert.doesNotMatch(source, /\/version/);
});

test('admin-backup leaf owns database + WebDAV backup without document storage', () => {
  const source = read('../public/settings/pages/admin-backup.js');

  assert.match(source, /\/api\/v1\/backup\/database/);
  assert.match(source, /api\.rawPost\('\/backup\/restore'/);
  assert.match(source, /api\.get\('\/backup\/status'\)/);
  assert.match(source, /api\.post\('\/backup\/trigger'\)/);
  assert.match(source, /api\.get\('\/backup\/webdav\/config'\)/);
  assert.match(source, /api\.put\('\/backup\/webdav\/config'/);
  assert.match(source, /api\.post\('\/backup\/webdav\/test'/);
  assert.match(source, /api\.post\('\/backup\/webdav\/trigger'\)/);

  // CLI recovery guidance lives behind a collapsed disclosure.
  assert.match(source, /createDisclosure\(/);
  assert.match(source, /settings\.backupCliTitle/);

  // Backup leaf must not own document-storage WebDAV or API/version concerns.
  assert.doesNotMatch(source, /\/documents\/storage/);
  assert.doesNotMatch(source, /\/auth\/api-tokens/);
  assert.doesNotMatch(source, /\/version/);
});

test('personal-calendar leaf owns only the per-user event defaults', () => {
  const source = read('../public/settings/pages/personal-calendar.js');

  assert.match(source, controlIdPattern('calendar-default-assign-me'));
  assert.match(source, /id="calendar-default-reminders"/);
  assert.match(source, /savePreferences\(\{ calendar_default_assign_me: value \}\)/);
  assert.match(source, /savePreferences\(\{ calendar_default_reminders: selected \}\)/);


  assert.match(source, /settings\.calendarDefaultsScopeHint/);

  // Haushaltweites bleibt im adminOnly-Kalenderblatt.
  assert.doesNotMatch(source, /week_start|calendar_default_duration|holiday_/);
});



// requestLocation samt Koordinatenvalidierung lag zweimal im Baum
// (Critique 2026-07-27).
test('beide Wetter-Blätter rendern dasselbe Standortformular', () => {
  const shared = read('../public/settings/weather-location.js');
  for (const field of ['lat', 'lon', 'city', 'units', 'auto-locate', 'locate-btn']) {
    assert.match(shared, new RegExp(`id="\\$\\{scope\\}-${field}"|id: \`\\$\\{scope\\}-${field}\``));
  }
  assert.match(shared, /latitude >= -90/);
  assert.match(shared, /latitude <= 90/);
  assert.match(shared, /longitude >= -180/);
  assert.match(shared, /longitude <= 180/);

  const owners = walkFrontendFiles('../public/settings/')
    .filter((path) => /function requestLocation\(/.test(read(path)));
  assert.deepEqual(owners, ['../public/settings/weather-location.js']);

  for (const leaf of ['admin-weather', 'personal-weather']) {
    const source = read(`../public/settings/pages/${leaf}.js`);
    assert.match(source, /weatherLocationFieldsHtml\(\{/, `${leaf} muss das geteilte Formular rendern`);
    assert.match(source, /bindWeatherLocationEvents\(container, SCOPE\)/);
    assert.match(source, /hasValidWeatherCoords\(location\.lat, location\.lon\)/);
    assert.doesNotMatch(source, /navigator\.geolocation/, `${leaf} darf Geolocation nicht selbst anfassen`);
  }
});

test('admin-weather leaf owns the household default location', () => {
  const source = read('../public/settings/pages/admin-weather.js');

  assert.match(source, /HOUSEHOLD_WEATHER_SCOPE as SCOPE/);
  assert.match(source, /weather_provider: 'open-meteo'/);
  assert.match(source, /weather_provider: null/);
  assert.match(source, /window\.aashiyana\?\.showToast/);
  assert.match(source, /await render\(container, \{ user \}\)/);


  assert.match(source, /settings\.householdWeatherOverrideHint/);


  assert.doesNotMatch(source, /app_name|app-name-input|APP_NAME_STORAGE_KEY/);
  assert.doesNotMatch(source, /\/version/);
});

test('admin-system leaf owns the app name next to the read-only version rows', () => {
  const source = read('../public/settings/pages/admin-system.js');

  assert.match(source, /api\.get\('\/version'\)/);
  assert.match(source, /settings\.systemVersionLabel/);
  assert.match(source, /MIT/);
  assert.match(source, /setup_required/);



  assert.match(source, /id="app-name-input"/);
  assert.match(source, /savePreferences\(\{ app_name: value \}\)/);
  assert.match(source, /new CustomEvent\('app-name-changed'/);
  assert.match(source, /localStorage\.setItem\(key, value\)/);
  assert.match(source, /localStorage\.removeItem\(key\)/);

  assert.doesNotMatch(source, /systemAppNameLabel/);

  // System leaf owns no other backend domain and no secrets.
  assert.doesNotMatch(source, /\/documents\//);
  assert.doesNotMatch(source, /\/backup\//);
  assert.doesNotMatch(source, /\/auth\/api-tokens/);
  assert.doesNotMatch(source, /weather_/);
});

test('Shopping uses the shared category manager component (Audit F-15)', () => {
  const component = read('../public/components/category-manager.js');
  assert.match(component, /customElements\.define\(\s*'aashiyana-category-manager'/);
  assert.match(component, /import \{ api \} from '\/api\.js'/);
  assert.match(component, /import \{ t \} from '\/i18n\.js'/);
  assert.match(component, /import \{ esc \} from '\/utils\/html\.js'/);

  assert.match(component, /item\.key \?\? item\.id/);
  assert.match(component, /disconnectedCallback\(\)/);
  assert.match(component, /removeEventListener/);
  assert.doesNotMatch(component, /#[0-9a-f]{6}/i);

  const shopping = read('../public/pages/shopping.js');
  assert.match(shopping, /components\/category-manager\.js/);
  assert.match(shopping, /<aashiyana-category-manager>/);
  assert.match(shopping, /basePath: '\/shopping\/categories'/);
  assert.match(shopping, /shopping\.manageCategories/);
  assert.match(shopping, /category-manager-changed/);


  const openMgr = shopping.match(/async function openCategoryManager[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(openMgr, /const onCategoriesChanged = async \(\) => \{[\s\S]*?loadCategories\(\)/);


  assert.equal(existsSync(new URL('../public/components/shopping-category-manager.js', import.meta.url)), false);
});

test('Kitchen settings copy directs Recipes and Shopping content settings to their modules', () => {
  const english = JSON.parse(read('../public/locales/en.json'));
  const german = JSON.parse(read('../public/locales/de.json'));
  const kitchenPage = read('../public/settings/pages/modules-kitchen.js');




  assert.match(kitchenPage, /t\('settings\.kitchenExternalHint'\)/);
  assert.match(english.settings.kitchenExternalHint, /Recipes/);
  assert.match(english.settings.kitchenExternalHint, /Shopping/);
  assert.match(english.settings.kitchenExternalHint, /modules/);
  assert.match(german.settings.kitchenExternalHint, /Rezepte/);
  assert.match(german.settings.kitchenExternalHint, /Einkauf/);
  assert.match(german.settings.kitchenExternalHint, /Modulen/);
});

test('Recipes expose meal-type suitability controls for planner integrations', () => {
  const recipesPage = read('../public/pages/recipes.js');
  const recipesCss = read('../public/styles/recipes.css');

  assert.match(recipesPage, /normalizeRecipeMealTypes/);
  assertKeysExistInEveryLocale(['recipes.dragToMealsHint']);
  assert.match(recipesPage, /id="recipe-meal-types"/);
  assert.match(recipesPage, /input type="checkbox" value="\$\{option\.key\}" checked/);
  assert.match(recipesPage, /meal_types/);
  assert.match(recipesCss, /\.recipe-meal-types\s*\{/);
  assert.match(recipesCss, /\.recipe-card__meal-types\s*\{/);
});

test('Meals page adds a recipe sidebar and randomize planner controls', () => {
  const mealsPage = read('../public/pages/meals.js');
  const mealsCss = read('../public/styles/meals.css');

  assert.match(mealsPage, /id="week-randomize"/);
  assert.match(mealsPage, /id="recipe-sidebar"/);
  assert.match(mealsPage, /recipes\.dragToMealsHint/);
  assert.match(mealsPage, /function renderRecipeSidebar/);
  assert.match(mealsPage, /function openRandomizeModal/);
  assert.match(mealsPage, /function wireRecipeSidebar/);
  assert.match(mealsPage, /confirmModal\(t\('meals\.replaceExistingConfirm'\)/, 'dropping onto occupied slots should use a dedicated localized confirmation string');
  assert.match(mealsPage, /recipeSupportsMealType/);
  assert.match(mealsCss, /\.meals-layout\s*\{/);
  assert.match(mealsCss, /\.recipe-sidebar\s*\{/);
  assert.match(mealsCss, /\.week-nav__randomize\s*\{/);
  assertKeysExistInEveryLocale([
    'meals.randomizePlan',
    'meals.randomizeTitle',
    'meals.randomizeReplaceExisting',
    'meals.replaceExistingConfirm',
    'meals.randomizeSuccess',
    'meals.randomizeWeekFull',
    'meals.randomizeNoRecipes',
  ]);
});

test('browser loader supports personal settings API and auth imports', () => {
  const source = read('./test-browser-loader.mjs');

  assert.match(source, /patch:\s*async/);
  assert.match(source, /export const auth/);
  assert.match(source, /me:\s*async/);
  assert.match(source, /getUsers:\s*async/);
  assert.match(source, /'\/utils\/pwa-install\.js'/);
  assert.match(source, /getPwaInstallState/);
  assert.match(source, /onPwaInstallStateChanged/);
  assert.match(source, /promptPwaInstall/);
});

test('wer an der Frische haengt UND offline gecacht wird, liest ueber getWithSource', () => {





  // Referenzlisten gefiltert.
  //









  // ganz unten.
  const MARKER = [
    /const intents\s*=\s*new Map\(/,        // Absichten neben dem Serverstand
    /const pending[A-Z]\w*\s*=\s*new Map\(/, // aeltere Schreibweise desselben
    /const settledAt\s*=\s*new Map\(/,       // Bestaetigungszeit je Eintrag
    /^\s*\w*[sS]tale:\s/m,                   // Referenzlisten mit Frische-Flag
  ];

  const sw = read('../public/sw.js');
  const whitelist = sw.match(/const API_CACHE_WHITELIST\s*=\s*\[([^\]]*)\]/)?.[1];
  assert.ok(whitelist, 'API_CACHE_WHITELIST in sw.js nicht gefunden - der Guard liest ins Leere');
  const cached = [...whitelist.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const seiten = readdirSync(new URL('../public/pages/', import.meta.url))
    .filter((f) => f.endsWith('.js'));

  const verletzt = [];
  const ungeprueft = [];
  let geprueft = 0;
  for (const datei of seiten) {
    const src = read(`../public/pages/${datei}`);
    const haengtAnFrische = MARKER.some((re) => re.test(src));
    if (!haengtAnFrische) { ungeprueft.push({ datei, src }); continue; }


    const pfad = `/${datei.replace(/\.js$/, '')}`;
    if (!cached.includes(pfad)) continue;
    if (!new RegExp(`api\\.get(WithSource)?\\([\`'"]${pfad}`).test(src)) continue;
    geprueft += 1;
    if (!/getWithSource\(/.test(src)) verletzt.push(`${datei} (Pfad ${pfad})`);
  }



  // Browser-Ketten-Guard weiter oben.
  assert.ok(geprueft > 0,
    'keine einzige Seite geprueft - Merkmale oder Whitelist-Format haben sich geaendert');




  //




  // `shopping.js` auf `api.get()` waere unbemerkt durchgegangen.
  const blind = ungeprueft
    .filter(({ src }) => /getWithSource\(/.test(src))
    .map(({ datei }) => datei);
  assert.deepEqual(blind, [],
    `benutzt getWithSource(), wird aber von keinem Merkmal erkannt: ${blind.join(', ')} - `
    + 'die Merkmalsliste MARKER ist veraltet, und der Guard prueft diese Seite nicht mehr');
  assert.deepEqual(verletzt, [],
    `haengt an der Frische und steht in API_CACHE_WHITELIST, liest aber nicht ueber `
    + `api.getWithSource(): ${verletzt.join(', ')} - eine gecachte Antwort raeumt dort `
    + 'den Merker fuer ausstehende Bearbeitungen oder wird als frische Referenz gelesen');
});

test('legacy settings page remains available during the leaf migration', () => {
  assert.equal(existsSync(new URL('../public/pages/settings.js', import.meta.url)), true);
});

test('user multi-select option is the containing block of its hidden checkbox (#483)', () => {
  // The checkbox is position:absolute + opacity:0 (visually hidden but focusable).
  // Without position:relative on the option, it resolves against the overflow:hidden
  // .modal-panel, so tapping a member scrolls the panel instead of the modal body —
  // a large blank block appears and later fields become unreachable on mobile.
  const css = read('../public/styles/user-multi-select.css');
  assert.match(
    css,
    /\.user-ms__option\s*\{[^}]*position:\s*relative/,
    '.user-ms__option must declare position: relative',
  );
  assert.match(
    css,
    /\.user-ms__checkbox\s*\{[^}]*position:\s*absolute/,
    'guard assumes .user-ms__checkbox stays position: absolute',
  );
});

test('responsive settings shell defines desktop and mobile navigation layouts', () => {
  const source = read('../public/styles/settings.css');

  assert.match(
    source,
    /@media \(min-width:\s*1024px\)[\s\S]*\.settings-shell__navigation\s*\{[\s\S]*position:\s*sticky/,
  );
  assert.match(
    source,
    /@media \(max-width:\s*1023px\)[\s\S]*\.settings-mobile-overview\s*\{/,
  );
});

test('settings disclosure exposes its expanded state and controlled panel', () => {
  const source = read('../public/settings/components.js');

  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-controls/);
});

test('settings rows programmatically label form controls and preserve descriptions', () => {
  const source = read('../public/settings/components.js');

  assert.match(source, /let settingRowIdCounter\s*=\s*0/);
  assert.match(source, /control\?\.matches\?\.\(['"]input,\s*select,\s*textarea,\s*button['"]\)/);
  assert.match(source, /control\?\.querySelector\?\.\(['"]input,\s*select,\s*textarea,\s*button['"]\)/);
  assert.match(source, /if \(formControl && !formControl\.id\)/);
  assert.match(source, /document\.createElement\(formControl \? 'label' : 'div'\)/);
  assert.match(source, /title\.htmlFor\s*=\s*formControl\.id/);
  assert.match(source, /detail\.id\s*=/);
  assert.match(source, /formControl\.getAttribute\('aria-describedby'\)/);
  assert.match(source, /describedBy\.push\(detail\.id\)/);
  assert.match(source, /describedBy\.join\(' '\)/);
  assert.match(source, /formControl\.setAttribute\('aria-describedby'/);
});

test('push client re-registers an orphaned subscription', () => {
  const source = read('../public/push.js');

  // App-Start: bestehendes Abo nachregistrieren, sonst bleibt ein serverseitig
  // entferntes Abo (410, DB-Restore) dauerhaft stumm.
  assert.match(source, /if \(st\.subscribed\) await resyncSubscription\(\)/);
  assert.match(source, /async function resyncSubscription\(\)/);
  assert.match(source, /api\.post\('\/push\/subscribe', sub\.toJSON\(\)\)/);

  assert.match(source, /async function repairPush\(\)/);
  assert.match(source, /!matchesServerKey\(sub, serverKey\)/);
  assert.match(source, /await sub\.unsubscribe\(\)/);
  // Nie ungefragt nachfragen: Reparatur setzt eine erteilte Berechtigung voraus.
  assert.match(source, /Notification\.permission !== 'granted'\) return false/);
});

test('notification settings report real delivery and self-heal once', () => {
  const source = read('../public/settings/pages/notifications.js');


  assert.match(source, /sent = Number\(res\?\.data\?\.sent\) \|\| 0/);
  assert.match(source, /if \(sent > 0\) status\.textContent = t\('settings\.pushTestSent'\)/);
  assert.match(source, /t\('settings\.pushTestFailed'\)/);
  assert.match(source, /t\('settings\.pushTestNoDevice'\)/);


  assert.match(source, /repaired = await repairPush\(\)/);
  assert.equal(source.match(/await sendTest\(\)/g).length, 2);

  assert.match(source, /getPwaInstallState\(\)\.ios/);
  assert.match(source, /t\('settings\.pushIosNotInstalled'\)/);
});

test('settings shell marks and focuses the active page', () => {
  const source = read('../public/settings/shell.js');

  assert.match(source, /setAttribute\('aria-current',\s*'page'\)/);
  assert.match(source, /\.tabIndex\s*=\s*-1/);
  assert.match(source, /\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
});

test('settings retry focus only moves to a connected replacement button after retry failure', () => {
  const source = read('../public/settings/shell.js');

  assert.match(source, /const loadAndRender = async \(\{\s*focusRetry = false\s*\} = \{\}\) =>/);
  assert.match(source, /onRetry:\s*\(\) => loadAndRender\(\{\s*focusRetry:\s*true\s*\}\)/);
  assert.match(
    source,
    /if \(focusRetry\)[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*retryButton\?\.isConnected[\s\S]*retryButton\.focus\(\{\s*preventScroll:\s*true\s*\}\)/,
  );
  assert.match(source, /await loadAndRender\(\);/);
});

test('settings shell falls back to the domains overview for orphaned active leaves', () => {
  const source = read('../public/settings/shell.js');

  assert.match(source, /if \(!domain\)\s*\{[\s\S]*console\.error\([\s\S]*renderDomainsOverview\(content,\s*domains(?:,\s*user)?\)/);
  assert.match(source, /else\s*\{[\s\S]*await renderLeafContent\(content,\s*activeLeaf,\s*domain,\s*user,\s*query\)/);
});

test('router hides inactive overlays from keyboard focus', () => {
  const source = read('../public/router.js');
  assert.match(source, /\.inert\s*=/);
  assert.match(source, /returnFocus/);
});

test('mobile More sheet trigger controls its dialog and traps keyboard focus', () => {
  const source = read('../public/router.js');

  assert.match(source, /moreBtn\.setAttribute\('aria-controls',\s*'more-sheet'\)/);
  assert.match(source, /const currentMoreBtn = \(\) => container\.querySelector\('#more-btn'\) \|\| moreBtn/);
  assert.match(source, /currentMoreBtn\(\)\.setAttribute\('aria-expanded',\s*'true'\)/);
  assert.match(source, /currentMoreBtn\(\)\.setAttribute\('aria-expanded',\s*'false'\)/);
  assert.match(source, /function\s+createFocusTrap/);
  assert.match(source, /moreSheetTrap/);
  assert.match(source, /addEventListener\('keydown',\s*moreSheetTrap/);
  assert.match(source, /removeEventListener\('keydown',\s*moreSheetTrap/);
});

test('More button active state keeps visible More identity and accessible active context', () => {
  const source = read('../public/router.js');

  assert.match(source, /function\s+setMoreButtonState/);
  assert.match(source, /moreBtn\.setAttribute\('aria-current',\s*'page'\)/);



  assert.match(source, /moreBtn\.setAttribute\('aria-label',[^;]*\bmoreLabel\b/);
  assert.match(source, /moreBtn\.setAttribute\('title',\s*t\('nav\.more'\)\)/);

  assert.match(source, /moreBtnLabel\.textContent\s*=\s*t\('nav\.more'\)/);
  assert.doesNotMatch(source, /moreBtn\.toggleAttribute\('aria-current',\s*inMoreSheet\)/);
});

test('mobile navigation derives five stable destinations from three favorites', () => {
  const source = read('../public/router.js');

  assert.match(source, /const\s+MOBILE_FAVORITE_COUNT\s*=\s*3/);
  assert.match(source, /resolveMobileNavOrder/);
  assert.match(source, /function\s+mobileFavoriteItems/);
  assert.match(source, /function\s+buildBottomNavItems/);
});

test('jede verwendete btn--Variante ist im Stylesheet definiert', () => {


  // Mode 1.32:1). Undefinierte Utility-Klassen sind unsichtbare Bugs.
  const css = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((file) => file.endsWith('.css'))
    .map((file) => read(`../public/styles/${file}`))
    .join('\n');
  const defined = new Set([...css.matchAll(/\.(btn--[a-z0-9-]+)/g)].map((m) => m[1]));

  const used = new Set();
  for (const file of walkFrontendFiles('../public/')) {
    if (file.includes('/vendor/') || file.includes('lucide')) continue;

    // keine Variante von `.btn`.
    for (const match of read(file).matchAll(/(?<![\w-])btn--[a-z0-9-]+/g)) used.add(match[0]);
  }

  const missing = [...used].filter((cls) => !defined.has(cls)).sort();
  assert.deepEqual(missing, [], `btn-Varianten ohne CSS-Regel: ${missing.join(', ')}`);
});

test('Sync-Kontolisten decken die Grid-Spalte, damit mobil nichts abgeschnitten wird', () => {
  const settings = read('../public/styles/settings.css');


  assert.match(
    settings,
    /\.settings-sync-accounts\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    settings,
    /\.settings-status-summary__details li\s*\{[^}]*overflow-wrap:\s*anywhere/,
  );
  assert.match(
    settings,
    /\.caldav-calendars-summary\s*\{[^}]*min-height:\s*var\(--target-lg\)/,
  );


  // verliert „Trennen" bei mehreren Konten seinen Besitzer.


  assert.match(
    settings,
    /\.caldav-account-item\s*\{[\s\S]*?border:\s*var\(--space-px\) solid color-mix\(in srgb, var\(--color-text-primary\)/,
  );
  assert.match(
    settings,
    /\.caldav-account-item \.settings-status-summary\s*\{[^}]*border:\s*0/,
  );
  assert.match(
    settings,
    /\.caldav-account-item \.settings-disclosure\s*\{[^}]*border:\s*0/,
  );


  assert.doesNotMatch(
    settings,
    /\.caldav-account-item\s*\{[^}]*border:\s*var\(--space-px\) solid var\(--glass-border-subtle\)/,
  );
});

test('mobile navigation uses neutral inactive wells and one active indicator', () => {
  const layout = read('../public/styles/layout.css');

  assert.match(
    layout,
    /\.nav-item__icon-well\s*\{[\s\S]*?background:\s*var\(--color-surface-elevated\)/,
  );
  assert.match(
    layout,
    /\.nav-item\[aria-current="page"\] \.nav-item__icon-well,[\s\S]*?background:\s*transparent/,
  );
  assert.doesNotMatch(layout, /\.nav-bottom__indicator\s*\{[\s\S]*?width\s+0\.45s/);
});

test('mobile navigation Quiet Precision keeps state feedback stable and accessible', () => {
  const layout = read('../public/styles/layout.css');
  const glass = read('../public/styles/glass.css');
  const indicatorRule = cssRuleBody(layout, '.nav-bottom__indicator');
  const indicatorSurfaceRule = cssRuleBody(layout, '.nav-bottom__indicator::before');
  const indicatorSurfaceGlass = cssRuleBody(glass, '.nav-bottom__indicator::before');
  const focusRule = cssRuleBody(layout, '.nav-bottom .nav-item:focus-visible');
  const pressedWellRule = cssRuleBody(layout, '.nav-bottom .nav-item:active .nav-item__icon-well');

  assert.match(indicatorSurfaceRule, /inset-inline:\s*var\(--space-1\)/);
  assert.doesNotMatch(indicatorRule, /transition:[^;]*\bwidth\b/);




  //



  const activeNavLabelRule = [...eachRule(layout)].find(({ selector }) =>
    selector.includes('.nav-bottom .nav-item--active .nav-item__label'))?.body ?? '';


  //




  // WELCHE Farbe sie toent.
  assert.match(
    activeNavLabelRule,
    /color:\s*color-mix\(\s*in srgb,\s*var\(--color-accent\)\s*70%,\s*var\(--color-text-primary\)\s*\)/,
  );
  assert.match(
    activeNavLabelRule,
    /font-weight:\s*var\(--font-weight-semibold\)/,
  );


  // verschwinden.
  assert.match(focusRule, /outline:\s*none/);
  const focusWellRule = cssRuleBody(layout, '.nav-bottom .nav-item:focus-visible .nav-item__icon-well');




  // Tastatur-Affordanz fuenf.
  assert.match(focusWellRule, /outline:\s*var\(--focus-ring-width\)\s+solid\s+var\(--focus-ring-color\)/);
  assert.match(focusWellRule, /outline-offset:\s*var\(--focus-ring-offset\)/);
  assert.match(focusWellRule, /--focus-ring-color:\s*var\(--color-accent\)/);
  assert.match(pressedWellRule, /transform:\s*translateY\(var\(--space-px\)\) scale\(0\.96\)/);
  assert.doesNotMatch(layout, /(^|\n)\.nav-item:active\s*\{[\s\S]*?transform:/);
  assert.doesNotMatch(layout, /\.nav-bottom \.nav-item:active\s*\{[\s\S]*?transform:/);


  // Kante der gleitenden Pille).
  assert.match(
    glass,
    /\.nav-bottom__indicator\s*\{[\s\S]*?background:\s*color-mix\(in srgb,\s*var\(--color-accent\)/,
  );
  assert.doesNotMatch(indicatorSurfaceGlass, /background:/);
  assert.match(
    glass,
    /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.nav-bottom__indicator\s*\{[\s\S]*?background:/,
  );
  assert.match(
    layout,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.nav-bottom \.nav-item:active \.nav-item__icon-well\s*\{[\s\S]*?transform:\s*none/,
  );
  assert.match(
    layout,
    /@media \(prefers-contrast: more\)[\s\S]*?\.nav-item\[aria-current="page"\],\s*\.nav-item--active\s*\{[\s\S]*?text-decoration:\s*underline/,
  );
  assert.match(
    layout,
    /@media \(forced-colors: active\)[\s\S]*?\.nav-item\[aria-current="page"\],\s*\.nav-item--active\s*\{[\s\S]*?border-bottom:\s*2px solid Highlight/,
  );
});

test('More-Sheet honours prefers-reduced-motion (no vestibular slide-up)', () => {
  const layout = read('../public/styles/layout.css');


  assert.match(cssRuleBody(layout, '.more-sheet'), /transition:\s*transform/);



  assert.match(
    layout,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.more-sheet\s*\{[\s\S]*?transition:\s*opacity[\s\S]*?opacity:\s*0/,
  );
  assert.match(
    layout,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.more-sheet\[aria-hidden="false"\]\s*\{[\s\S]*?opacity:\s*1/,
  );


  // bewegungsfrei faden.
  assert.match(cssRuleBody(layout, '.search-overlay'), /transition:\s*transform/);
  assert.match(
    layout,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.search-overlay\s*\{[\s\S]*?transition:\s*opacity[\s\S]*?opacity:\s*0/,
  );
});

test('bottom-nav labels wrap to two lines instead of clipping across locales', () => {
  const layout = read('../public/styles/layout.css');
  const labelRule = cssRuleBody(layout, '.nav-bottom .nav-item__label');


  assert.match(labelRule, /white-space:\s*normal/);
  assert.match(labelRule, /-webkit-line-clamp:\s*2/);
  assert.match(labelRule, /overflow-wrap:\s*anywhere/);


  assert.match(cssRuleBody(layout, '.nav-bottom__items'), /min-height:\s*var\(--nav-height-mobile\)/);
  assert.doesNotMatch(cssRuleBody(layout, '.nav-bottom__items'), /(^|[^-])height:\s*var\(--nav-height-mobile\)/);

  // Longest-String-Guard: kein bottom-bar-Nav-Label darf so lang werden, dass

  const NAV_KEYS = [
    'dashboard', 'calendar', 'tasks', 'notes', 'kitchen', 'contacts', 'birthdays',
    'budget', 'documents', 'housekeeping', 'rewards', 'health', 'settings', 'more',
    'shopping', 'meals', 'recipes',
  ];
  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'));
  const offenders = [];
  for (const file of localeFiles) {
    const nav = JSON.parse(read(`../public/locales/${file}`)).nav || {};
    for (const key of NAV_KEYS) {
      const value = nav[key];
      if (typeof value === 'string' && value.length > 24) offenders.push(`${file}:nav.${key} (${value.length}) "${value}"`);
    }
  }
  assert.deepEqual(offenders, [], `bottom-bar nav labels over 24 chars need a shorter canonical label:\n${offenders.join('\n')}`);
});

test('bottom-nav icon-well fills the 44x44 touch-comfort zone', () => {
  const layout = read('../public/styles/layout.css');
  const tokens = read('../public/styles/tokens.css');
  const wellRule = cssRuleBody(layout, '.nav-bottom .nav-item__icon-well');

  // Sichtbares Well: 44 breit × 40 hoch (kein 32px-Streifen mehr).
  assert.match(wellRule, /width:\s*var\(--target-base\)/);
  assert.match(wellRule, /height:\s*var\(--target-md\)/);
  assert.doesNotMatch(wellRule, /height:\s*var\(--target-sm\)/);


  assert.match(tokens, /--nav-height-mobile:\s*6[0-4]px/);
});

test('bottom nav keeps a navigation landmark with a disclosure button, not a tablist', () => {
  const source = read('../public/router.js');


  assert.match(source, /bottomNav\.setAttribute\('aria-label', t\('nav\.navigation'\)\)/);
  assert.doesNotMatch(source, /'role',\s*'tablist'/);
  assert.doesNotMatch(source, /setAttribute\('role', 'tab'\)/);

  // More bleibt ein korrekter Disclosure-Button.
  assert.match(source, /moreBtn\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(source, /moreBtn\.setAttribute\('aria-controls', 'more-sheet'\)/);
});

test('kitchen tab discloses its (variable) destination in the accessible name', () => {
  const source = read('../public/router.js');


  assert.match(
    source,
    /function kitchenNavAriaLabel\(path\)\s*\{[\s\S]*?nav\.kitchenActiveLabel[\s\S]*?nav\.kitchenGoLabel[\s\S]*?\}/,
  );
  assertKeysExistInEveryLocale(['nav.kitchenGoLabel']);


  const localeFiles = readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'));
  for (const file of localeFiles) {
    const value = JSON.parse(read(`../public/locales/${file}`)).nav?.kitchenGoLabel;
    assert.match(value ?? '', /\{\{section\}\}/, `${file}: nav.kitchenGoLabel must interpolate {{section}}`);
  }
});

test('mobile bottom navigation remains visible while content scrolls', () => {
  const source = read('../public/router.js');
  const layout = read('../public/styles/layout.css');

  assert.doesNotMatch(source, /initNavHideOnScroll/);
  assert.doesNotMatch(layout, /\.nav-bottom--hidden\s*\{/);
});

test('More sheet closes route clicks through delegated handler after rebuilds', () => {
  const source = read('../public/router.js');

  assert.match(source, /sheet\.addEventListener\('click',\s*\(e\) =>/);
  assert.match(source, /e\.target\.closest\('\[data-route\]'\)/);
  assert.doesNotMatch(source, /sheet\.querySelectorAll\('\[data-route\]'\)\.forEach/);
});

test('More sheet search trigger is a native button with visible focus styling', () => {
  const router = read('../public/router.js');
  const layout = read('../public/styles/layout.css');
  const focusRule = cssRuleBody(layout, '.more-sheet__search:focus-visible');

  assert.match(router, /const moreSearchBar = document\.createElement\('button'\)/);
  assert.match(router, /moreSearchBar\.type = 'button'/);
  assert.doesNotMatch(router, /moreSearchBar\.setAttribute\('role',\s*'button'\)/);
  assert.match(focusRule, /outline:/);
  assert.match(focusRule, /box-shadow:/);
});

test('SPA navigation can move focus to main content after route changes', () => {
  const source = read('../public/router.js');

  assert.match(source, /main\.tabIndex\s*=\s*-1/);
  assert.match(source, /function\s+focusMainContentAfterNavigation/);
  assert.match(source, /focusMainContentAfterNavigation\(basePath/);
});

test('bottom navigation labels are constrained against localized overflow', () => {
  const layout = read('../public/styles/layout.css');
  const labelRule = cssRuleBody(layout, '.nav-item__label');

  assert.match(labelRule, /max-width:\s*100%/);
  assert.match(labelRule, /overflow:\s*hidden/);
  assert.match(labelRule, /text-overflow:\s*ellipsis/);
  assert.match(labelRule, /white-space:\s*nowrap/);
});

test('mobile bottom navigation avoids clipped Android labels and sparse icon spacing', () => {
  const layout = read('../public/styles/layout.css');
  const navItemRule = cssRuleBody(layout, '.nav-bottom .nav-item');
  const iconWellRule = cssRuleBody(layout, '.nav-bottom .nav-item__icon-well');
  const labelRule = cssRuleBody(layout, '.nav-item__label');

  assert.match(navItemRule, /padding-block:\s*var\(--space-0h\)/);
  assert.match(iconWellRule, /width:\s*var\(--target-base\)/);

  assert.match(iconWellRule, /height:\s*var\(--target-md\)/);
  assert.match(iconWellRule, /border-radius:\s*var\(--radius-full\)/);
  assert.match(labelRule, /line-height:\s*1\.2/);
});

test('verborgene Reveal-Aktionen bleiben nicht klickbar', () => {
  const ALLOW = new Set(['nav-item__label', 'nav-section-label']);
  const findings = [];

  for (const file of readdirSync(new URL('../public/styles/', import.meta.url))) {
    if (!file.endsWith('.css')) continue;
    const rules = cssRules(read(`../public/styles/${file}`));


    const hidden = new Map();
    for (const { selectors, body } of rules) {
      if (selectors.some((s) => /^(from|to|\d+%)$/.test(s))) continue;
      if (!/(^|[\s;])opacity:\s*0\s*;/.test(body)) continue;
      const guarded = /pointer-events/.test(body);
      for (const selector of selectors) {



        const classes = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
        const subject = classes[classes.length - 1];
        if (subject && !hidden.has(subject)) hidden.set(subject, guarded);
      }
    }

    // Wer davon wird per Hover/Fokus eingeblendet?
    for (const { selectors, body } of rules) {
      if (!selectors.some((s) => /:hover|:focus-within/.test(s))) continue;
      if (!/opacity:\s*1/.test(body)) continue;
      for (const selector of selectors) {
        const classes = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
        const cls = classes[classes.length - 1];
        if (!cls || !hidden.has(cls) || hidden.get(cls) || ALLOW.has(cls)) continue;
        hidden.delete(cls);
        findings.push(`${file} .${cls}`);
      }
    }
  }

  assert.deepEqual(findings, [], `opacity:0 ohne pointer-events:none in Reveal-Regeln:\n${findings.join('\n')}`);
});

test('keine Seite baut .empty-state-Markup von Hand', () => {

  const RENDERER = '../public/utils/empty-state.js';
  const offenders = [];
  for (const file of walkFrontendFiles('../public/')) {
    if (file === RENDERER || file.startsWith('../public/vendor/')) continue;
    const src = read(file);
    const hits = [
      ...src.matchAll(/class="empty-state(?:["\s])/g),
      ...src.matchAll(/className\s*=\s*['"]empty-state(?:['"\s])/g),
    ];
    if (hits.length) offenders.push(`${file} (${hits.length}x)`);
  }
  assert.deepEqual(offenders, [],
    'Leerzustands-Markup von Hand statt emptyStateEl()/emptyStateHTML()/mountEmptyState():\n'
    + offenders.join('\n'));
});

test('die String-Ausgabe des Leerzustands leitet sich aus der Element-Fassung ab', () => {
  const src = read('../public/utils/empty-state.js');
  assert.match(src, /export function emptyStateHTML[\s\S]{0,600}?return emptyStateEl\(opts\)\.outerHTML;/,
    'emptyStateHTML() baut eigenes Markup statt emptyStateEl() zu serialisieren');
  assert.match(src, /export function emptyHintHTML[\s\S]{0,300}?return emptyHintEl\(text, opts\)\.outerHTML;/,
    'emptyHintHTML() baut eigenes Markup statt emptyHintEl() zu serialisieren');

  // CTA still tot - sichtbar, klickbar, ohne Wirkung.
  assert.match(src, /emptyStateHTML[\s\S]{0,400}?action\?\.onClick[\s\S]{0,300}?throw new TypeError/,
    'emptyStateHTML() nimmt ein onClick entgegen, das die String-Ausgabe nicht überlebt');
});

test('jeder Fehler-Leerzustand fuehrt eine Aktion', () => {
  const offenders = [];
  for (const file of walkFrontendFiles('../public/')) {
    if (file.startsWith('../public/vendor/')) continue;



    const src = withoutBlockComments(read(file));
    for (const match of src.matchAll(/variant:\s*'error'/g)) {


      const window_ = src.slice(match.index, match.index + 700);
      const end = window_.search(/\n\s*\}\);/);
      const call = end === -1 ? window_ : window_.slice(0, end);
      if (!/\baction\b|\bactions\b|\bonRetry\b/.test(call)) {
        offenders.push(`${file} -> ${call.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'Fehler-Leerzustand ohne Aktion - eine Sackgasse. mountLoadError() nutzen '
    + 'oder eine action mitgeben:\n' + offenders.join('\n'));
});

test('der Leerzustands-Titel ist eine Überschrift, und die kompakte Form hat keine', () => {
  const src = read('../public/utils/empty-state.js');
  assert.match(src, /if \(title\) parts\.push\(`<h2 class="empty-state__title">/,
    'der Titel ist keine <h2> mehr oder wird auch ohne Text gesetzt');
  assert.doesNotMatch(src, /<div class="empty-state__title"/,
    'der Renderer setzt den Titel als <div> - damit ist der Leerzustand strukturlos');
  assert.match(src, /export function emptyHintEl[\s\S]{0,400}?emptyStateEl\(\{ compact: true/,
    'emptyHintEl() baut wieder eigenes Markup statt den Renderer zu rufen');
});

test('die Küchen-Seiten zeigen bei einem Ladefehler den Fehlerzustand, nicht den Leerzustand', () => {
  for (const page of ['meals', 'recipes', 'shopping', 'pantry']) {
    const src = read(`../public/pages/${page}.js`);


    assert.match(src, /\bmountLoadError\s*\(/,
      `${page}.js ruft den geteilten Fehler-Renderer mountLoadError() nicht auf`);




    const assigned = new Set(
      [...src.matchAll(/\bstate\.(\w*[eE]rror)\s*=/g)].map((m) => m[1]),
    );
    for (const field of assigned) {
      const readPattern = new RegExp(`(if\\s*\\(|&&|\\|\\||!)\\s*!?state\\.${field}\\b`);
      assert.match(src, readPattern,
        `${page}.js setzt state.${field}, prüft es aber nirgends - der Fehler bleibt unsichtbar`);
    }


    //    Fehlerzustand zuerst.
    for (const [name, body] of topLevelFunctions(src)) {
      const errorAt = body.search(/\bmountLoadError\s*\(/);
      const emptyAt = body.search(/\bmountEmptyState\s*\(/);
      if (errorAt === -1 || emptyAt === -1) continue;
      assert.ok(errorAt < emptyAt,
        `${page}.js: ${name}() rendert den Leerzustand vor dem Fehlerzustand - `
        + 'nach einem Ladefehler ist die Sammlung ebenfalls leer, der Leer-Zweig greift also zuerst');
    }


    for (const [name, body] of topLevelFunctions(src)) {
      if (!/\bcatch\b/.test(body)) continue;
      const toastOnly = /showToast\s*\(\s*t\(\s*['"][\w.]*[lL]oadError/.test(body);
      assert.ok(!toastOnly,
        `${page}.js: ${name}() meldet einen Ladefehler per Toast - der vergeht, `
        + 'während der falsche Zustand darunter stehen bleibt');
    }
  }
});

test('Fokusringe lesen die Tokens aus tokens.css §7b', () => {
  const tokens = read('../public/styles/tokens.css');
  for (const token of ['--focus-ring-width', '--focus-ring-color', '--focus-ring-offset', '--focus-ring-offset-inset']) {
    assert.ok(tokens.includes(`${token}:`), `tokens.css führt ${token} nicht`);
  }

  const findings = [];
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url))) {
    if (!file.endsWith('.css')) continue;
    const lines = read(`../public/styles/${file}`).split('\n');

    lines.forEach((line, i) => {
      const decl = line.split('/*')[0];


      // `{` oder `;`.
      if (!/(^|[{;])\s*outline(-color|-offset|-width)?\s*:/.test(decl)) return;
      if (/outline\s*:\s*(none|0)\s*[;}]/.test(decl)) return;
      if (/var\(--focus-ring/.test(decl)) return;



      let selector = null;
      let depth = 0;
      for (let j = i; j >= 0; j--) {
        depth += (lines[j].match(/\}/g) || []).length - (lines[j].match(/\{/g) || []).length;
        if (depth < 0) { selector = lines[j]; break; }
      }
      if (!selector || !/:focus-visible|:focus-within/.test(selector)) return;

      findings.push(`${file}:${i + 1}  ${selector.split('{')[0].trim().slice(0, 50)} → ${decl.trim().slice(0, 50)}`);
    });
  }

  assert.deepEqual(findings, [],
    'Fokusregeln mit eigenen Werten statt der
    + 'Ausnahmen überschreiben --focus-ring-color lokal und lesen Breite/Offset '
    + `weiter aus den Tokens:\n${findings.join('\n')}`);
});

test('kein Ladefehler wird nur in einen Toast gelegt', () => {
  const offenders = [];
  for (const file of walkFrontendFiles('../public/')) {
    if (!file.endsWith('.js') || file.startsWith('../public/vendor/')) continue;
    const src = withoutBlockComments(read(file));
    for (const [name, body] of topLevelFunctions(src)) {
      const block = body.slice(body.search(/\bcatch\s*[({]/));
      if (!/\bcatch\s*[({]/.test(body)) continue;
      const toastsLoadError = /showToast\s*\(\s*t\(\s*['"][\w.]*[lL]oadError/.test(block);
      if (!toastsLoadError) continue;

      const clearsCollection = /\.\w+\s*=\s*\[\]/.test(block);
      if (!clearsCollection) continue;

      const keepsError = /\.\w*[eE]rror\s*=\s*(?!null|false)/.test(block)
        || /\bthrow\b/.test(block)
        || /\bmountLoadError\s*\(/.test(block);
      if (!keepsError) offenders.push(`${file}: ${name}()`);
    }
  }
  assert.deepEqual(offenders, [],
    'Ladefehler nur als Toast, waehrend die geleerte Sammlung darunter einen '
    + 'Leerzustand zeigt - der Toast vergeht, die falsche Aussage bleibt:\n'
    + offenders.join('\n'));
});

function topLevelFunctions(src) {
  const out = [];
  const pattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
  const starts = [...src.matchAll(pattern)];
  starts.forEach((match, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
    out.push([match[1], src.slice(match.index, end)]);
  });
  return out;
}

test('die Küchen-Listen teilen eine Zeilen-Grammatik', () => {
  const shared = read('../public/styles/list-row.css');
  const indexHtml = read('../public/index.html');

  assert.match(indexHtml, /<link rel="stylesheet" href="\/styles\/list-row\.css" \/>/,
    'list-row.css muss in index.html eingehängt sein (Router lädt nur EIN Page-CSS pro Seite)');


  const rowsBlock = shared.match(/\.list-rows\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rowsBlock, /background-color:\s*var\(--color-surface-work\)/,
    '.list-rows muss die opake Arbeitsfläche tragen (DESIGN.md: kein Glas unter Fließtext)');
  assert.match(rowsBlock, /border-radius:\s*var\(--radius-md\)/,
    '.list-rows muss den Inhaltsflächen-Radius aus DESIGN.md §5 tragen');




  // festen Slot am Anfang der Bedienzone.
  assert.doesNotMatch(shared.replace(/\/\*[\s\S]*?\*\//g, ''), /\.list-row__end-action/,
    'an der Zeilenkante verankerte Aktionen liegen in der FAB-Ecke - fester Slot am Anfang der Bedienzone stattdessen');

  const bruchOhneStrich = [...eachRule(shared)]
    .filter((r) => /overflow-wrap:\s*anywhere/.test(r.body) && !/hyphens:\s*auto/.test(r.body));
  assert.deepEqual(bruchOhneStrich.map((r) => r.selector.trim()), [],
    'in der geteilten Zeilengrammatik braucht jeder Umbruch im Wort seinen Trennstrich - '
    + 'sonst steht dort bei 320px „Kirschtoma / ten"');

  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((f) => f.endsWith('.css') && f !== 'list-row.css')) {
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      if (!/\.list-row__(?:name|meta)\b/.test(rule.selector)) continue;
      assert.doesNotMatch(rule.body, /hyphens:/,
        `${file} (${rule.selector.trim()}) darf die Trennung der geteilten Grammatik nicht überschreiben`);
    }
  }

  const pantryCss = read('../public/styles/pantry.css');
  const slot = pantryCss.match(/\.pantry-row__cart-slot\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(slot, /width:\s*var\(--target-lg\)/,
    'wo ein Warenkorb liegt, muss der Slot die volle .row-action-Breite tragen');
  assert.match(slot, /flex-shrink:\s*0/, 'der Slot darf nicht schrumpfen');
  assert.match(pantryCss, /\.pantry-row__cart-slot:empty\s*\{\s*display:\s*none/,
    'ein Warenkorb-Slot ohne Warenkorb reserviert 52px Textspalte fuer nichts');



  const nameBlock = shared.match(/\.list-row__name\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.doesNotMatch(nameBlock, /text-overflow|white-space:\s*nowrap/,
    '.list-row__name darf nicht ellipsieren: bei 320px blieben vier lesbare Zeichen');
  assert.match(nameBlock, /overflow-wrap:\s*anywhere/,
    '.list-row__name muss umbrechen dürfen');


  //




  const perTab = {
    shopping: ['.shopping-item', '../public/styles/shopping.css'],
    pantry:   ['.pantry-row',    '../public/styles/pantry.css'],
  };
  for (const [tab, [selector, path]] of Object.entries(perTab)) {
    const css = read(path);
    const blocks = [...css.matchAll(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 'g'))]
      .map((m) => m[1]).join('\n');
    for (const prop of ['border-radius', 'background-color', 'padding']) {
      assert.doesNotMatch(blocks, new RegExp(`^\\s*${prop}:`, 'm'),
        `${tab}: ${selector} darf kein eigenes ${prop} setzen - das trägt .list-row bzw. .list-rows`);
    }
  }


  for (const page of ['shopping', 'pantry', 'recipes']) {
    const src = read(`../public/pages/${page}.js`);
    for (const cls of ['list-scroller', 'list-rows', 'list-row', 'list-row__main', 'list-row__name', 'list-row__actions']) {
      assert.ok(src.includes(cls), `${page}.js muss ${cls} verwenden`);
    }
  }



  for (const path of ['../public/styles/shopping.css', '../public/styles/pantry.css', '../public/styles/recipes.css']) {
    const css = read(path);
    assert.doesNotMatch(css, /@media\s*\(hover:\s*hover\)\s*\{[^}]*opacity:\s*0/,
      `${path}: Zeilenaktionen der Listen-Tabs dürfen nicht per hover-Reveal versteckt werden`);
  }


  //
  // Dritte Fundstelle derselben Defektklasse in diesem Repo: .recipe-detail




  const recipesCssForHidden = read('../public/styles/recipes.css');
  const layoutCss = read('../public/styles/layout.css');
  if (/\.recipe-detail\s*\{[^}]*display:/.test(recipesCssForHidden)) {
    assert.match(layoutCss, /\.recipe-detail\[hidden\],/,
      '.recipe-detail setzt display und muss deshalb in der [hidden]-Durchsetzungsliste in layout.css stehen');
  }



  // begann deshalb 16px neben Kopf, Rezepten und Vorrat.
  const shoppingCss = read('../public/styles/shopping.css');
  const itemsList = shoppingCss.match(/^\.items-list\s*\{([^}]*)\}/m)?.[1] ?? '';
  assert.doesNotMatch(itemsList, /padding-inline:|padding:\s*\S+\s+\S+/,
    '.items-list darf kein horizontales Polster setzen:
  assert.doesNotMatch(shared.match(/\.list-scroller\s*\{([^}]*)\}/)?.[1] ?? '', /padding-inline:/,
    '.list-scroller darf kein padding-inline setzen: wo der Spalten-Träger sitzt, ist pro Tab verschieden');



  // Kommentar im CSS.
  //



  // demselben Element sitzt (`class="list-scroller items-list"`).
  //



  const styleDir = new URL('../public/styles/', import.meta.url);
  const allRules = readdirSync(styleDir).filter((f) => f.endsWith('.css'))
    .flatMap((file) => scopedRules(read(`../public/styles/${file}`)).map((rule) => ({ file, ...rule })));


  //


  //     keine Zusage.

  //     `max-width: var(--content-max-width-narrow); max-width: none` als

  //   - Kurzschreibweisen setzen dieselbe Eigenschaft mit: `place-self:




  const declaredValue = (body, props, axis = 'block') => {
    const list = [].concat(props);
    const alternatives = list.map((p) => escapeForRegExp(p)).join('|');
    // Standard-Eigenschaften sind ASCII-case-insensitiv (`MAX-WIDTH` wirkt),

    const flags = list.some((p) => p.startsWith('--')) ? 'gm' : 'gmi';
    const hits = [...body.matchAll(new RegExp(`(?:^|;)\\s*(${alternatives})\\s*:\\s*([^;]+)`, flags))]
      .map(([, prop, raw]) => ({ prop, raw: raw.trim() }));
    if (!hits.length) return null;
    const important = hits.filter(({ raw }) => /!\s*important$/i.test(raw));
    const { prop, raw } = (important.length ? important : hits).at(-1);
    const value = raw.replace(/!\s*important$/i, '').trim();
    if (!prop.toLowerCase().startsWith('place-')) return value;

    // fuer beide Achsen.
    const parts = value.split(/\s+/);
    return axis === 'inline' ? (parts[1] ?? parts[0]) : parts[0];
  };
  const NARROW = 'var(--content-max-width-narrow)';




  const NARROW_VAR = `var(--page-measure, ${NARROW})`;
  const istLesemass = (wert) => wert === NARROW || wert === NARROW_VAR;
  const ALIGN_SELF = ['align-self', 'place-self'];


  // der Modul-Root-Breiten-Guard weiter unten schon.




  // Schreibweisen sehr wohl (logisch gegen physisch, gleiche Achse).
  const WIDTH_AXES = [['width', 'inline-size'], ['max-width', 'max-inline-size']];
  const MAX_WIDTH = ['max-width', 'max-inline-size'];


  const FREE_WIDTH = ['none', 'auto', 'initial', 'unset', 'revert', '100%'];

  const FILLS = ['stretch', 'normal', 'auto', 'initial', 'unset', 'revert'];





  // nicht gibt.
  const inlineMargins = (body) => {
    let start = null;
    let end = null;
    let startFixed = false;
    let endFixed = false;
    const setStart = (value, important) => {
      if (startFixed && !important) return;
      start = value;
      startFixed = startFixed || important;
    };
    const setEnd = (value, important) => {
      if (endFixed && !important) return;
      end = value;
      endFixed = endFixed || important;
    };
    const pattern = /(?:^|;)\s*(margin|margin-inline|margin-inline-start|margin-inline-end|margin-left|margin-right)\s*:\s*([^;]+)/gim;
    for (const [, rawProp, rawValue] of body.matchAll(pattern)) {
      const prop = rawProp.toLowerCase();

      // Shorthand - sonst meldete `margin-inline-end: 20rem !important;

      const important = /!\s*important$/i.test(rawValue.trim());
      const value = rawValue.replace(/!\s*important$/i, '').trim();
      const parts = value.split(/\s+/);
      if (prop === 'margin') {
        const [top, right = top, , left = right] = parts;
        setStart(left, important);
        setEnd(right, important);
      } else if (prop === 'margin-inline') {
        const [first, second = first] = parts;
        setStart(first, important);
        setEnd(second, important);
      } else if (prop === 'margin-inline-start' || prop === 'margin-left') {
        setStart(value, important);
      } else {
        setEnd(value, important);
      }
    }
    return [['margin-inline-start', start], ['margin-inline-end', end]].filter(([, value]) => value !== null);
  };




  // `.list-scroller .row` dagegen nicht.
  //






  const targets = (selector, token) => {
    const subject = selector.replace(/:(?:not|has)\([^)]*\)/g, '');
    const compound = subject.trim().split(/[\s>+~]+/).pop() ?? '';



    if (/::|:(?:before|after|first-line|first-letter|marker|backdrop|selection|placeholder)\b/.test(compound)) return false;
    return new RegExp(`${escapeForRegExp(token)}(?![\\w-])`).test(compound);
  };
  const rulesFor = (token) => allRules.filter(({ selectors }) => selectors.some((s) => targets(s, token)));





  //






  const scrollerTokens = new Set(['.list-scroller']);
  for (const page of ['shopping', 'pantry', 'recipes']) {
    const src = read(`../public/pages/${page}.js`);
    const combos = [...src.matchAll(/class(?:Name)?\s*=\s*(['"`])([^'"`]*\blist-scroller\b[^'"`]*)\1/g)];
    assert.ok(combos.length > 0,
      `${page}.js hängt seine Klasse nicht mehr literal an .list-scroller - dieser Scan findet sie dann nicht und prüft den Scroller des Tabs ungewollt gar nicht`);
    combos.forEach(([, , combo]) => combo.trim().split(/\s+/).forEach((cls) => scrollerTokens.add(`.${cls}`)));





    const inTag = (src.match(/<[^>]*\blist-scroller\b[^>]*>/g) ?? [])
      .map((tag) => tag.match(/\bid="([^"]+)"/)?.[1]);
    const nextToClassName = [...src.matchAll(
      /(\w+)\.className\s*=\s*['"`][^'"`]*\blist-scroller\b[^'"`]*['"`];\s*\1\.id\s*=\s*['"`]([^'"`]+)/g)]
      .map(([, , id]) => id);
    [...inTag, ...nextToClassName].filter(Boolean).forEach((id) => scrollerTokens.add(`#${id}`));





    for (const [, variable] of src.matchAll(/(\w+)\.className\s*=\s*['"`][^'"`]*\blist-scroller\b/g)) {
      const name = escapeForRegExp(variable);
      assert.doesNotMatch(src, new RegExp(`\\b${name}\\.style\\.(?:max)?(?:Width|InlineSize)\\s*=`, 'i'),
        `${page}.js setzt eine Inline-Breite am Scroller - die schlägt jede Regel im Stylesheet und damit auch diesen Guard`);
      assert.doesNotMatch(src, new RegExp(`\\b${name}\\.style\\.(?:alignSelf|placeSelf)\\s*=`),
        `${page}.js setzt align-self inline am Scroller - das nimmt ihm die volle Breite`);
      assert.doesNotMatch(src, new RegExp(`\\b${name}\\.style\\.setProperty\\(\\s*['"\`](?:(?:max-)?(?:width|inline-size)|align-self|place-self|margin(?:-inline)?(?:-start|-end)?|margin-left|margin-right)`, 'i'),
        `${page}.js setzt eine Breite, Ausrichtung oder Marge inline am Scroller (setProperty)`);
      assert.doesNotMatch(src, new RegExp(`\\b${name}\\.style\\.cssText\\s*=`),
        `${page}.js überschreibt den Stil des Scrollers per cssText - was darin steht, sieht dieser Guard nicht`);
      assert.doesNotMatch(src, new RegExp(`\\b${name}\\.setAttribute\\(\\s*['"\`]style`, 'i'),
        `${page}.js setzt den Stil des Scrollers per setAttribute - derselbe Inline-Stil über einen anderen Weg`);
      assert.doesNotMatch(src, new RegExp(`\\b${name}\\.style\\.margin(?:Inline|Left|Right)?[A-Za-z]*\\s*=`),
        `${page}.js setzt eine Inline-Marge am Scroller - die zieht als gestrecktes Flex-Item direkt von seiner Breite ab`);
    }
    (src.match(/<[^>]*\blist-scroller\b[^>]*>/g) ?? []).forEach((tag) => {
      assert.doesNotMatch(tag, /\sstyle\s*=/,
        `${page}.js gibt dem Scroller ein style-Attribut - Inline-Stile schlagen jede Regel im Stylesheet`);
    });
  }
  assert.ok(rulesFor('.list-scroller').length > 0,
    '.list-scroller ist nirgends definiert: ein leerer Treffer darf hier nicht still grün bleiben');
  for (const cls of scrollerTokens) {
    for (const { file, selectors, body } of rulesFor(cls)) {
      for (const axis of WIDTH_AXES) {
        const cap = declaredValue(body, axis);
        assert.ok(cap === null || FREE_WIDTH.includes(cap),
          `${file} ${selectors.join(', ')}: ${axis[0]}: ${cap} kappt den Scroller - dann endet sein Mausrad-Trefferbereich an der Lesespalten-Kante`);
      }




      for (const [prop, value] of inlineMargins(body)) {
        assert.ok(/^0[a-z%]*$/.test(value),
          `${file} ${selectors.join(', ')}: ${prop}: ${value} nimmt dem Scroller Breite - der Trefferbereich endet dann davor`);
      }






      const spread = declaredValue(body, ALIGN_SELF);
      assert.ok(spread === null || FILLS.includes(spread),
        `${file} ${selectors.join(', ')}: align-self: ${spread} nimmt dem Scroller die volle Breite - dann greift das Mausrad rechts daneben ins Leere`);



      assert.equal(declaredValue(body, 'all'), null,
        `${file} ${selectors.join(', ')}: die all-Kurzschreibweise setzt Breite und Ausrichtung des Scrollers zurück`);
    }
  }





  //    Verschiedenes bedeuten.
  for (const { file, selectors, body } of allRules) {



    if (file === 'tokens.css' && selectors.every((s) => /^:root\b/.test(s.trim()))) continue;
    assert.equal(declaredValue(body, '--content-max-width-narrow'), null,
      `${file} ${selectors.join(', ')}:
  }




  //    weiter zwei Texte vergleicht, die zueinander passen.




  // declaredValue() kennt die Vorrangregel bereits.
  const canonicalBodies = allRules
    .filter(({ file, selectors, conditional }) => file === 'tokens.css' && !conditional
      && selectors.some((sel) => /^:root\b/.test(sel)))
    .map(({ body }) => body).join(';');
  const tokenValue = declaredValue(canonicalBodies, '--content-max-width-narrow');
  assert.ok(tokenValue !== null,
    'tokens.css muss
  assert.match(tokenValue, /^(?:\d+(?:\.\d+)?(?:px|rem|em|ch|ex|vw|vmin|vmax|%)|(?:min|max|clamp|calc)\(.*\))$/,
    `--content-max-width-narrow ist auf "${tokenValue}" gesetzt - das ist keine Breite, und die Kappung der Kinder läuft ins Leere`);






  for (const cls of ['.list-group', '.list-rows']) {
    const rules = rulesFor(cls);










    const plain = (sel) => {
      const bare = sel.replace(/:(?:is|where)\(([^)]*)\)/g, '$1');
      return !/:/.test(bare) && !/[\s>+~,]/.test(bare);
    };
    assert.ok(rules.some(({ body, conditional, selectors }) =>
      !conditional && selectors.some(plain) && istLesemass(declaredValue(body, MAX_WIDTH))),
    `${cls} muss das Lesemaß UNBEDINGT tragen: eine Kappung hinter einem Breakpoint, an einem Zustand (:hover) oder unter einem Vorfahren (.foo ${cls}) greift nicht in jedem Kontext, in dem das Element gerendert wird`);
    for (const { file, body } of rules) {




      const definite = declaredValue(body, ['width', 'inline-size']);
      assert.ok(definite === null || definite === 'auto' || definite === '100%',
        `${file}: ${cls} bekommt hier eine feste Breite (${definite}) - gekappt wird über max-width, sonst steht die Liste unabhängig vom Lesemaß schmal`);


      // Kind seine Spur per Voreinstellung. `justify-self: start` nimmt ihm

      // bleibt dabei unangetastet und unwirksam.
      const inline = declaredValue(body, ['justify-self', 'place-self'], 'inline');
      assert.ok(inline === null || FILLS.includes(inline),
        `${file}: ${cls} bekommt justify-self: ${inline} - dann schrumpft die Gruppe auf ihren Inhalt, statt das Lesemaß auszufüllen`);
      assert.equal(declaredValue(body, 'all'), null,
        `${file}: ${cls} wird per all-Kurzschreibweise zurückgesetzt - das nimmt Kappung und Ausrichtung mit`);

      const width = declaredValue(body, MAX_WIDTH);
      if (width === null) continue;
      assert.ok(istLesemass(width),
        `${file}: ${cls} bekommt hier eine zweite, abweichende Breite - das Lesemaß ist EIN Wert`);
    }
  }



  //


  //    `align-self: start` streckt das voreingestellte `align-items: stretch`





  //









  //    Deklarationen aller passenden Regeln, bevor er den Wert bestimmt.








  const subjectKeys = (selector) => {
    const subject = selector
      .replace(/:(?:not|has)\([^)]*\)/g, '')
      .replace(/:(?:is|where)\(([^)]*)\)/g, '$1')
      .trim().split(/[\s>+~]+/).pop() ?? '';
    return new Set(subject.match(/[.#][\w-]+/g) ?? []);
  };

  //    `.context-a .list-rows { overflow: hidden }` und
  //    `.context-b .list-rows { align-self: start }` im selben Topf,


  const contextOf = (selector) => {
    const parts = selector.replace(/:(?:is|where)\(([^)]*)\)/g, '$1').trim().split(/[\s>+~]+/);
    return parts.slice(0, -1).join(' ');
  };


  // Ruhezustand - also fast immer - besteht.
  const stateOf = (selector) => {
    const subject = selector.replace(/:(?:is|where)\(([^)]*)\)/g, '$1')
      .trim().split(/[\s>+~]+/).pop() ?? '';
    return (subject.match(/:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).sort().join('');
  };
  const sharedRules = scopedRules(shared)
    .flatMap(({ selectors, body }) => selectors.map((sel) => ({
      keys: subjectKeys(sel), context: contextOf(sel), state: stateOf(sel), sel, body,
    })))
    .filter(({ keys }) => keys.size > 0);
  const elements = new Map();
  for (const { keys, context, state, sel } of sharedRules) {
    const id = `${context}|${state}|${[...keys].sort().join('')}`;
    if (!elements.has(id)) elements.set(id, { keys, context, state, label: sel });
  }
  for (const [, { keys, context, state, label }] of elements) {
    const body = sharedRules


      .filter(({ keys: own, context: ownContext, state: ownState }) =>
        [...own].every((key) => keys.has(key))
        && (ownContext === '' || ownContext === context)
        && (ownState === '' || ownState === state))
      .map(({ body: part }) => part).join(';');
    const selectors = [label];
    if (!istLesemass(declaredValue(body, MAX_WIDTH))) continue;



    const overflow = declaredValue(body, ['overflow', 'overflow-y', 'overflow-block']);
    if (overflow === null || !/\b(?:hidden|clip)\b/.test(overflow)) continue;
    assert.equal(declaredValue(body, ALIGN_SELF), 'start',
      `${selectors.join(', ')} kappt aufs Lesemaß und clippt zugleich, ist also ein gekapptes Kind des Scroller-Grids: ohne align-self: start schneidet es den Überlauf ab, bevor .list-scroller ihn sieht`);
  }



  for (const { file, body } of rulesFor('.list-rows')) {
    const align = declaredValue(body, ALIGN_SELF);
    if (align === null) continue;
    assert.equal(align, 'start',
      `${file}: .list-rows bekommt hier ein anderes align-self - genau der Rückfall, den die Regel darüber verhindert`);
  }


  //




  //    Inhaltsspalte beim Modulwechsel um 436px (Critique 2026-08-13).


  for (const carrier of ['.list-rows', '.row-carrier']) {
    const body = scopedRules(shared)
      .filter(({ selectors }) => selectors.some((s) => s.trim() === carrier))
      .map(({ body: part }) => part).join(';');
    assert.ok(istLesemass(declaredValue(body, MAX_WIDTH)),
      `${carrier} muss auf dasselbe Lesemaß kappen wie der andere Träger - zwei Zahlen sind ein sichtbarer Sprung beim Modulwechsel, keine zwei Grammatiken`);
  }
});

test('das Lesemass haengt an der Seite, nicht am Traeger', () => {
  const layout = read('../public/styles/layout.css');
  const shared = read('../public/styles/list-row.css');

  assert.match(layout, /\.(?:page-measure--narrow|app-page--reading)\s*\{[\s\S]*?--page-measure:\s*var\(--layout-reading\)/,
    'die Rolle muss die Variable setzen - sonst liest der Rest hier nichts');


  for (const carrier of ['.list-group', '.list-rows', '.row-carrier']) {
    const at = shared.indexOf(`\n${carrier} {`);
    assert.ok(at !== -1, `${carrier} muss es geben`);
    const body = shared.slice(at, shared.indexOf('\n}', at));
    assert.match(body, /max-width:\s*var\(--page-measure,\s*var\(--content-max-width-narrow\)\)/,
      `${carrier} muss das Lesemass der SEITE lesen, mit der Konstante als Rueckfall`);
  }




  // (zweispaltig, Begruendung im Quelltext).
  const ZWEISPALTIG = /ZWEISPALTIG/;
  for (const page of walkJsFiles('../public/pages/')) {
    const src = read(page);
    if (!/class="[^"]*\blist-row\b/.test(src)) continue;
    if (ZWEISPALTIG.test(src)) continue;
    // Calendar agenda toggles reading measure per view (is-reading-measure).
    if (/is-reading-measure/.test(src) && /app-page--full|data-composition="full"/.test(src)) continue;
    assert.match(src, /page-measure--narrow|app-page--(?:reading|data|dashboard|form)|data-composition="(?:reading|data|dashboard|form)"|mode:\s*'(?:reading|data|dashboard|form)'|renderAppPage\s*\(/,
      `${page}: zeigt eine Zeilenliste, traegt das Lesemass der Seite aber nicht - `
      + 'Kopf und Bedienzeilen enden dann neben ihrem eigenen Koerper');
  }
});

test('wer eine Pille zeigt, markiert seinen Scrollport', () => {
  const layout = read('../public/styles/layout.css');
  assert.match(layout, /\.page-scrollport[^{]*\{[^}]*padding-block-end:[^;]*--shell-tail/,
    'die Rolle muss den Nachlauf auch wirklich setzen - sonst prueft der Rest hier eine Klasse ohne Wirkung');

  for (const page of walkJsFiles('../public/pages/')) {
    const src = read(page);
    if (!/\bsetBulkPill\s*\(/.test(src)) continue;
    assert.match(src, /page-scrollport/,
      `${page}: zeigt eine Sammelaktions-Pille, markiert aber seinen Scrollport nicht - `
      + 'sie verdeckt dann am Listenende die Zeilen, auf die sie sich bezieht');
  }
});

test('wer seinen eigenen Scrollport mitbringt, markiert ihn', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);


  const eigenerPort = [];
  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      const selector = rule.selector.trim();


      if (!/^\.[a-z-]+-page$/.test(selector)) continue;
      if (!/height:\s*100%/.test(rule.body)) continue;
      if (!/overflow:\s*hidden/.test(rule.body)) continue;
      eigenerPort.push(selector.slice(1));
    }
  }
  assert.ok(eigenerPort.length >= 8,
    `es muessen mindestens die acht bekannten Seiten mit eigenem Scrollport gefunden werden, `
    + `gefunden: ${eigenerPort.join(', ')}`);


  const seiten = walkJsFiles('../public/pages/').map((f) => ({ f, src: read(f) }));
  for (const root of new Set(eigenerPort)) {
    const traeger = seiten.filter(({ src }) => src.includes(root));
    assert.ok(traeger.length > 0, `kein public/pages/*.js rendert ${root}`);
    for (const { f, src } of traeger) {
      assert.match(src, /page-scrollport/,
        `${f}: rendert ${root} (height:100% + overflow:hidden, scrollt also nicht selbst), `
        + 'vergibt die Rolle page-scrollport aber nicht - der Nachlauf der fixierten '
        + 'Shell-Flaechen landet dann an .app-content und verkuerzt den Scrollport, '
        + 'statt am Inhaltsende zu reiten');
    }
  }
});

test('ein Scrollport nennt seinen Bodenfreiraum nicht selbst', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);

  const markiert = new Set();
  for (const file of walkJsFiles('../public/pages/')) {
    for (const m of read(file).matchAll(/["'`]([^"'`]*\bpage-scrollport\b[^"'`]*)["'`]/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls && cls !== 'page-scrollport' && /^[a-z][\w-]*$/.test(cls)) markiert.add(cls);
      }
    }
  }

  const verstoesse = [];
  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const rule of eachRule(read(`../public/styles/${file}`))) {


      const letztes = rule.selector.trim().split(/\s+/).pop() || '';
      const klassen = [...letztes.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]);
      if (!klassen.some((c) => markiert.has(c))) continue;

      for (const decl of rule.body.matchAll(/(^|[;{])\s*(padding(?:-bottom|-block-end)?)\s*:([^;]*)/g)) {
        const [, , prop, wert] = decl;
        if (prop !== 'padding') {
          verstoesse.push(`${file}: ${rule.selector.trim()} → ${prop}:${wert.trim()}`);
          continue;
        }

        const teile = wert.trim().replace(/\b(?:calc|var|min|max|clamp)\([^()]*(?:\([^()]*\)[^()]*)*\)/g, 'X').split(/\s+/).filter(Boolean);
        if (teile.length >= 3) {
          verstoesse.push(`${file}: ${rule.selector.trim()} → padding mit ${teile.length} Werten (${wert.trim()})`);
        }
      }
    }
  }

  assert.deepStrictEqual(verstoesse, [],
    'diese Scrollports legen ihren Bodenfreiraum selbst fest, statt ihn als '
    + '--scrollport-pad anzumelden. Genau so ueberlebte die achte FAB-Reserve den '
    + `Umbau von 2026-08-12: ${verstoesse.join(' | ')}`);
});

test('die Scrollport-Rolle sitzt an einer Box mit Ueberlauf', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);


  // einzeln. Die Scroll-Achse liegt am geteilten Baustein (`.list-scroller`,



  const gruppen = [];
  for (const file of walkJsFiles('../public/pages/')) {
    for (const m of read(file).matchAll(/["'`]([^"'`]*\bpage-scrollport\b[^"'`]*)["'`]/g)) {
      const klassen = m[1].split(/\s+/).filter((c) => /^[a-z][\w-]*$/.test(c) && c !== 'page-scrollport');
      if (klassen.length) gruppen.push({ file, klassen });
    }
  }
  assert.ok(gruppen.length >= 10, `zu wenige markierte Scrollports gefunden: ${gruppen.length}`);

  const scrollend = new Set();
  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      if (!/overflow(-y)?:\s*(auto|scroll)/.test(rule.body)) continue;
      for (const cls of rule.selector.matchAll(/\.([a-z][\w-]*)/g)) scrollend.add(cls[1]);
    }
  }
  const blind = gruppen
    .filter(({ klassen }) => !klassen.some((c) => scrollend.has(c)))
    .map(({ file, klassen }) => `${file}: ${klassen.join('.')}`);
  assert.deepStrictEqual(blind, [],
    'diese Markierungen tragen page-scrollport, aber keine ihrer Klassen hat eine '
    + `Scroll-Achse - die Rolle legt dort einen Nachlauf ins Leere: ${blind.join(' | ')}`);
});

test('die Pillenzone steht nur am markierten Scrollport', () => {
  const layout = read('../public/styles/layout.css').replace(/\/\*[\s\S]*?\*\//g, '');




  // machte 2026-08-19 exakt denselben Fehler auf demselben Selektor.
  //




  const ZONEN = /--(?:fab-safe-zone|bulk-pill-safe-zone|install-prompt-tail|shell-tail)/;
  const treffer = [];
  for (const m of layout.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!/\.app-content\s*$/.test(selector)) continue;
    if (/:not\(:has\([^)]*\.page-scrollport[^)]*\)\)\s*$/.test(selector)) continue;
    if (!/padding/.test(m[2]) || !ZONEN.test(m[2])) continue;
    treffer.push(selector);
  }

  assert.deepStrictEqual(treffer, [],
    'diese Regeln polstern .app-content mit einer Shell-Zone, ohne den Fall '
    + 'auszuschliessen, in dem die Seite ihren eigenen Scrollport mitbringt. Dort '
    + 'scrollt .app-content nicht, das Padding verkuerzt den echten Scrollport und '
    + `wird zum toten Band darunter: ${treffer.join(', ')}`);
});

test('ein Kopf mit --narrow pflegt ihn beim Ansichtswechsel', () => {
  for (const page of walkJsFiles('../public/pages/')) {
    const src = read(page);
    if (!src.includes('page-toolbar--narrow')) continue;


    if (!/data-view/.test(src) || !/viewMode|state\.view\b/.test(src)) continue;
    assert.match(src, /classList\.toggle\(\s*'page-toolbar--narrow'/,
      `${page}: setzt
  }
});

test('der FAB weicht der Zeile, statt eine Gasse zu reservieren', () => {
  const layout = read('../public/styles/layout.css');
  const tokens = read('../public/styles/tokens.css');
  const router = read('../public/router.js');


  const styleDir = new URL('../public/styles/', import.meta.url);
  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    const css = read(`../public/styles/${file}`);
    const live = css
      .replace(/\/\*[\s\S]*?\*\//g, '')  // Kommentare dürfen die Historie nennen
      .match(/var\(--fab-lane\)/g);
    assert.equal(live, null, `${file} reserviert wieder eine FAB-Gasse (var(--fab-lane))`);
  }
  assert.doesNotMatch(tokens.replace(/\/\*[\s\S]*?\*\//g, ''), /--fab-lane\s*:/,
    '--fab-lane ist stillgelegt und darf nicht wieder definiert werden');




  // 80,6% einer Zeilenaktion verdeckt (Critique P1, 2026-07-30).
  //







  assert.match(tokens, /--fab-safe-zone:\s*calc\([^;]*--fab-gap[^;]*--fab-size[^;]*;/,
    'der SCHWEBENDE Fall braucht seine Zone weiter, abgeleitet aus --fab-gap und --fab-size');
  assert.match(
    tokens,
    /@media\s*\(max-width:\s*1023px\)\s*\{\s*:root\s*\{[^}]*--fab-safe-zone:\s*0px/,
    'wo die Bottom-Nav steht, faellt
  );


  // und an seiner eigenen Groesse.
  assert.match(
    tokens,
    /--fab-offset-bottom:\s*calc\([^;]*--nav-height-mobile[^;]*--fab-size[^;]*\)/s,
    'der eingesetzte FAB zentriert sich aus --nav-height-mobile und --fab-size'
  );


  assert.match(
    layout,
    /\.nav-bottom__items\s*\{[^}]*padding-inline-end:\s*calc\(var\(--fab-size\)/,
    'die Nav-Kapsel muss ihr hinteres Ende aus --fab-size freihalten'
  );








  //

  // kostet.






  //


  assert.match(layout, /:has\([^)]*\.page-fab[^{]*\{[^}]*--fab-tail:\s*var\(--fab-safe-zone\)/,
    'die FAB-Zone muss unter der FAB-Bedingung zum Summanden --fab-tail werden');
  assert.match(layout, /--shell-tail:\s*calc\([^;]*--fab-tail[^;]*\)/,
    'und
  assert.match(layout, /\.page-scrollport[^{]*\{[^}]*padding-block-end:[^;]*--shell-tail/,
    'und
    + 'liegt damit leerer Raum unter dem Knopf, und der Scrollport bleibt porthoch');
  assert.doesNotMatch(layout.replace(/\/\*[\s\S]*?\*\//g, ''), /margin-block-end:\s*var\(--fab-safe-zone\)/,
    'die FAB-Zone darf den Scrollport nicht wieder verkuerzen (Marge statt Nachlauf): '
    + 'das schnitt das Dashboard-Raster 96px ueber der Fensterkante ab');

  // Die drei auseinandergedrifteten Kopien bleiben abgeschafft. Sie rechneten


  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    const live = read(`../public/styles/${file}`).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(live, /--[\w-]*fab-clearance/,
      `${file} führt wieder ein eigenes FAB-Freiraum-Token statt --fab-safe-zone`);
  }


  //







  //


  assert.doesNotMatch(layout.replace(/\/\*[\s\S]*?\*\//g, ''), /\.page-fab--retracted/,
    '.page-fab--retracted ist entfallen (#634) und darf nicht zurückkehren');
  assert.doesNotMatch(router, /fab-scroll\.js|installFabRetract/,
    'router.js darf keinen Scroll-Mechanismus mehr am FAB verdrahten (#634)');
  assert.equal(existsSync(new URL('../public/utils/fab-scroll.js', import.meta.url)), false,
    'utils/fab-scroll.js ist entfallen (#634)');
  assert.doesNotMatch(read('../public/sw.js'), /fab-scroll\.js/,
    'sw.js darf die entfallene Datei nicht precachen - ein 404 lässt die gesamte SW-Installation scheitern');




  //







  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    const live = read(`../public/styles/${file}`).replace(/\/\*[\s\S]*?\*\//g, '');
    const fabRules = (live.match(/[^{}]*\.page-fab[^{]*\{[^}]*\}/g) ?? [])
      .filter((rule) => !/keyboard-visible/.test(rule));
    for (const rule of fabRules) {
      assert.doesNotMatch(rule, /opacity:\s*0\s*[;}]/,
        `${file} blendet den FAB per opacity aus - genau der Zustand aus #634`);
      assert.doesNotMatch(rule, /pointer-events:\s*none/,
        `${file} nimmt dem FAB die Bedienbarkeit - genau der Zustand aus #634`);
    }
  }
});

test('jede CSS-Ausblendung des FAB nullt seinen Nachlauf', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);
  const versteckt = [];
  const nullt = [];
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body } of eachRule(read(`../public/styles/${file}`))) {
      const trifftFab = /\.page-fab\b|#fab-new-item\b/.test(selector);
      const nurHidden = /\.page-fab\[hidden\]|#fab-new-item\[hidden\]/.test(selector);
      if (trifftFab && /display:\s*none/.test(body) && !nurHidden) {
        versteckt.push({ file, selector: norm(selector) });
      }
      if (/--fab-safe-zone:\s*0/.test(body)) nullt.push({ file, selector: norm(selector) });
    }
  }


  assert.ok(versteckt.length >= 4,
    `Reichweite: nur ${versteckt.length} Ausblende-Regeln gefunden - der Scanner greift nicht mehr`);



  // Teilzeichenkette gepruefet: `body:has(.toolbar-new-btn:not([hidden]))` steckt in
  // `body:has(.toolbar-new-btn:not([hidden])) #fab-layer .page-fab`, und
  // `#fab-layer #fab-new-item` steckt in `body:has(#fab-layer #fab-new-item)`.
  const ohnePaar = versteckt.filter(({ file, selector }) => !nullt.some((z) =>
    z.file === file && (selector.includes(z.selector) || z.selector.includes(selector))));

  assert.deepEqual(ohnePaar.map((x) => `${x.file}: ${x.selector}`), [],
    'diese Regeln verstecken den FAB, ohne --fab-safe-zone zu nullen - dort reserviert '
    + 'der Nachlauf am Scroll-Ende Platz fuer einen Knopf ohne Flaeche');
});

test('der Page-FAB hängt in der Shell, nicht im Scrollport', () => {
  const router = read('../public/router.js');
  const layout = read('../public/styles/layout.css');
  const styleDir = new URL('../public/styles/', import.meta.url);


  //






  assert.match(router, /shellNodes\s*=\s*\[[^\]]*\bmain\b\s*,[^\]]*\bfabLayer\b\s*,[^\]]*\bbottomNav\b/,
    'die FAB-Layer muss als Shell-Kind hinter dem Scrollport und vor der Bottom-Nav hängen (#634)');
  assert.match(layout, /\.fab-layer\s*\{[^}]*position:\s*absolute/,
    '.fab-layer braucht einen eigenen Kasten an der Shell-Ecke (#634)');



  assert.ok((router.match(/adoptPageFab\(\)/g) ?? []).length >= 4,
    'adoptPageFab() muss definiert und an allen Renderpfaden aufgerufen werden (#634)');
  assert.match(router, /clearPageFab\(\)/,
    'der FAB der alten Seite muss mit ihrem Inhalt verschwinden, nicht später (#634)');




  const ALLOWED_ROOT = /^(html|body|:root|\.app-shell|\.fab-layer|\.keyboard-visible)/;
  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    const live = read(`../public/styles/${file}`).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of live.match(/[^{}]*\{[^}]*\}/g) ?? []) {
      const selectors = block.slice(0, block.indexOf('{')).split(',');
      for (const selector of selectors) {
        if (!selector.includes('.page-fab')) continue;
        const prefix = selector.slice(0, selector.indexOf('.page-fab')).trim();
        assert.ok(prefix === '' || ALLOWED_ROOT.test(prefix),
          `${file}: "${selector.trim()}" adressiert den FAB über einen Modul-Kontext - `
          + 'seit
      }
    }
  }
});

test('die Tastatur-Erkennung hängt am Fokus, nicht nur am Viewport', () => {
  const router = read('../public/router.js');

  const sync = router.match(/function syncKeyboardVisible\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(sync, 'syncKeyboardVisible() muss es geben - sie hält die Bedingung an einer Stelle');



  assert.match(sync, /isTextEntry\(document\.activeElement\)/,
    'die Tastatur gilt nur als offen, wenn ein Texteingabefeld den Fokus hat (#634)');
  assert.match(sync, /focused && shrunk|shrunk && focused/,
    'Fokus UND Viewport - eine der beiden Bedingungen allein reicht nicht (#634)');



  assert.match(router, /addEventListener\('focusout', scheduleKeyboardSync\)/,
    'focusout muss den Zustand auflösen - der Rückweg, der nicht ausbleiben kann (#634)');
  assert.match(router, /addEventListener\('focusin', scheduleKeyboardSync\)/,
    'focusin muss den Zustand nachziehen');



  assert.equal((router.match(/keyboard-visible/g) ?? []).length, 1,
    'keyboard-visible darf nur in syncKeyboardVisible() gesetzt werden (#634)');





  const scheduler = router.match(/function scheduleKeyboardSync\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(scheduler, 'scheduleKeyboardSync() muss es geben');
  assert.doesNotMatch(scheduler, /requestAnimationFrame/,
    'der Rückweg darf nicht an rAF hängen - das ruht in verborgenen Tabs (#634)');
  assert.match(scheduler, /setTimeout/,
    'der aufgeschobene Abgleich läuft über einen Timer, der auch verborgen feuert (#634)');



  const nonText = router.match(/NON_TEXT_INPUT_TYPES = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
  for (const type of ['date', 'checkbox', 'radio', 'color', 'file', 'range']) {
    assert.match(nonText, new RegExp(`'${type}'`),
      `input[type=${type}] öffnet keine Tastatur und darf den FAB nicht verbergen`);
  }
});

// --------------------------------------------------------

// --------------------------------------------------------

function transferCalls(source) {
  return [...source.matchAll(/api\.post\(\s*[`'"]([^`'"]+)[`'"]/g)]
    .map((match) => match[1])
    .filter((url) => /\/to-shopping-list$|\/import-[a-z-]+$/.test(url));
}

function transferRoutes(source) {
  const heads = [...source.matchAll(/^router\.(get|post|put|patch|delete)\('([^']+)'/gm)];
  return heads
    .map((head, index) => ({
      method: head[1],
      path: head[2],
      body: source.slice(head.index, heads[index + 1]?.index ?? source.length),
    }))
    .filter(({ method, path }) => method === 'post' && /\/to-shopping-list$|\/import-[a-z-]+$/.test(path));
}

const CONFIRMED_TRANSFERS = new Map([
  ['import-meal-plan', 'Einkauf holt sich den Essensplan: eigener Dialog mit Zeitraum-Wahl und '
    + 'Vorschau („X Zutaten aus Y Mahlzeiten"), bestätigt auf der Zielliste selbst.'],
  ['import-shopping', 'Einkauf räumt in den Vorrat ein: eigener Dialog, in dem Menge, Einheit und '
    + 'Lagerort pro Artikel gesetzt werden - kein versehentlich auslösbarer Knopf.'],
]);

const isConfirmedTransfer = (url) => [...CONFIRMED_TRANSFERS.keys()].some((name) => url.endsWith(name));

test('der Zustand „keine Einkaufsliste" hat genau eine Antwort', () => {
  const de = JSON.parse(read('../public/locales/de.json'));
  const helper = read('../public/utils/kitchen-transfer.js');



  // auseinandergelaufen waren.
  assert.match(helper, /export async function resolveShoppingTarget/,
    'die Vorprüfung gehört in den geteilten Baustein, nicht in die drei Aufrufer');
  assert.match(helper, /showToast\(message, 'warning', TRANSFER_TOAST_MS, action\)/,
    'Ton warning statt danger: eine fehlende Voraussetzung ist keine Störung');
  assert.match(helper, /navigate\('\/shopping'\)/,
    'die Antwort muss einen Ausweg tragen, nicht nur den Zustand benennen');
  assert.match(helper, /isModuleDisabled\?\.\('shopping'\)/,
    'ist der Einkauf abgeschaltet, wäre der Ausweg eine Sackgasse - dann entfällt er');

  const pagesDir = new URL('../public/pages/', import.meta.url);
  let checked = 0;
  for (const entry of readdirSync(pagesDir)) {
    if (!entry.endsWith('.js')) continue;
    const source = read(`../public/pages/${entry}`);
    for (const url of transferCalls(source)) {
      if (isConfirmedTransfer(url)) continue;
      checked += 1;
      assert.match(source, /from '\/utils\/kitchen-transfer\.js'/,
        `${entry} überträgt nach ${url} und muss dafür den geteilten Baustein importieren`);
      assert.match(source, /resolveShoppingTarget\(/,
        `${entry} muss sein Transfer-Ziel über resolveShoppingTarget() bestimmen, nicht selbst prüfen`);
    }
  }
  assert.ok(checked >= 3, `mindestens die drei erzeugenden Pfade müssen erfasst sein, gefunden: ${checked}`);





  const ownEmptyStates = new Set(['shopping.noLists', 'dashboard.noShoppingLists']);
  for (const entry of readdirSync(pagesDir)) {
    if (!entry.endsWith('.js')) continue;
    for (const [, key] of read(`../public/pages/${entry}`)
      .matchAll(/t\('([a-zA-Z]+\.(?:noShoppingLists|noLists))'/g)) {
      assert.ok(
        key.startsWith('kitchen.') || ownEmptyStates.has(key),
        `${entry} beantwortet „keine Einkaufsliste" mit ${key} statt über den geteilten Baustein`,
      );
    }
  }


  assertKeysExistInEveryLocale(['kitchen.noShoppingLists', 'kitchen.createShoppingList']);
  assert.equal(de.meals.noShoppingLists, undefined,
    'der Text darf nicht in meals.* liegen - die Rezepte liehen ihn sich von dort');
  assert.equal(de.pantry.noLists, undefined, 'auch der Vorrat besitzt den Zustand nicht mehr allein');
  assert.doesNotMatch(de.kitchen.noShoppingLists, /Tab/,
    'den Zielort nennt der Knopf; ein zweites Mal im Satz wäre der Tab-Name doppelt');
});

test('jeder Ein-Tipp-Transfer in eine fremde Liste ist rücknehmbar', () => {
  const helper = read('../public/utils/kitchen-transfer.js');



  assert.match(helper, /export const TRANSFER_TOAST_MS = 5000/);
  assert.match(helper, /showToast\(message, 'success', TRANSFER_TOAST_MS, undo\)/,
    'der Erfolgs-Toast muss die Rücknahme tragen');
  assert.match(helper, /ids\.length\s*\?/,
    'ohne IDs darf kein Undo-Knopf erscheinen, der nichts zurücknehmen kann');
  assert.match(helper, /api\.post\('\/shopping\/items\/undo-transfer', \{ ids \}\)/,
    'die Rücknahme läuft über EINEN Aufruf - N einzelne DELETEs können zur Hälfte scheitern');
  assert.match(helper, /refreshKitchenBadges\(\)/,
    'die Zahl des Einkaufs-Tabs ändert sich in beide Richtungen, beide Male hier');




  const routesDir = new URL('../server/routes/', import.meta.url);
  let routesChecked = 0;
  for (const entry of readdirSync(routesDir)) {
    if (!entry.endsWith('.js')) continue;
    for (const route of transferRoutes(read(`../server/routes/${entry}`))) {
      if (isConfirmedTransfer(route.path)) continue;
      routesChecked += 1;
      assert.match(route.body, /added_ids/,
        `POST ${route.path} (${entry}) muss die erzeugten IDs zurückgeben`);
      assert.match(route.body, /lastInsertRowid/,
        `POST ${route.path} (${entry}) muss die IDs beim Einfügen einsammeln`);
      assert.match(route.body, /added_ids: \[\] \} \}\)/,
        `POST ${route.path} (${entry}) muss auch im Leerfall added_ids liefern, damit der Client nicht raten muss`);
    }
  }
  assert.ok(routesChecked >= 3, `mindestens drei Transfer-Routen erwartet, gefunden: ${routesChecked}`);





  const shoppingRoute = read('../server/routes/shopping.js');
  const undoBlock = shoppingRoute.slice(shoppingRoute.indexOf("router.post('/items/undo-transfer'"));
  assert.match(undoBlock, /UPDATE meal_ingredients SET on_shopping_list = 0/,
    'das Undo muss das Zutaten-Flag mit zurücknehmen');
  assert.match(undoBlock, /db\.get\(\)\.transaction\(/,
    'die Rücknahme ist eine Handlung und gehört in eine Transaktion');



  const pagesDir = new URL('../public/pages/', import.meta.url);
  for (const entry of readdirSync(pagesDir)) {
    if (!entry.endsWith('.js')) continue;
    const source = read(`../public/pages/${entry}`);
    for (const url of transferCalls(source)) {
      if (isConfirmedTransfer(url)) continue;
      assert.match(source, /announceTransfer\(\{/,
        `${entry} überträgt nach ${url} und muss den Erfolg über announceTransfer() melden`);
      assert.match(source, /added_ids/,
        `${entry} muss die added_ids der Antwort weiterreichen, sonst gibt es nichts zurückzunehmen`);
      assert.doesNotMatch(source, /showToast\([^)]*'success',\s*\d+/,
        `${entry} darf keine eigene Toast-Standzeit für einen Transfer setzen`);
    }
  }




  for (const page of ['pantry.js', 'recipes.js', 'meals.js']) {
    assert.match(read(`../public/pages/${page}`), /if \(btn\) btn\.disabled = true;/,
      `${page} muss den auslösenden Knopf während des Transfers sperren`);
  }

  assertKeysExistInEveryLocale(['kitchen.transferUndone']);
});

test('der Einkaufs-Kopf trägt mobil keine unbeschrifteten Aktionen', () => {
  const page = read('../public/pages/shopping.js');
  const css = read('../public/styles/shopping.css');
  const menu = read('../public/utils/popover-menu.js');
  const layout = read('../public/styles/layout.css');


  assert.match(page, /import \{ popoverMenuHtml, installPopoverMenus \} from '\/utils\/popover-menu\.js'/,
    'shopping.js muss das geteilte Überlaufmenü nutzen');
  assert.match(layout, /^\.popover-menu \{/m, '.popover-menu muss in layout.css stehen, nicht im Modul-CSS');
  assert.match(layout, /\.popover-menu:popover-open\s*\{\s*display:\s*flex/,
    'das Panel braucht display erst bei :popover-open, sonst schlägt es das UA-display:none');


  // waren mobil nackte Glyphen.
  assert.match(menu, /<span>\$\{esc\(item\.label\)\}<\/span>/,
    'jeder Menü-Eintrag muss ein sichtbares Textlabel tragen');
  const menuStart = page.indexOf("id: 'list-actions-menu'");
  assert.ok(menuStart > 0, 'das Überlaufmenü der Einkaufsliste ist nicht auffindbar - der Guard misst dann nichts');
  const items = page.slice(menuStart, page.indexOf('})}', menuStart));


  for (const key of ['shopping.renameListLabel', 'shopping.importMeals', 'shopping.manageCategories', 'shopping.deleteListLabel']) {
    assert.ok(items.includes(`t('${key}')`), `das Überlaufmenü muss ${key} als Label führen`);
  }
  assert.match(items, /danger:\s*true/, '„Liste löschen" muss im Menü als destruktiv gekennzeichnet sein');





  assert.match(page, /label:\s*t\('shopping\.listActionsLabel',\s*\{\s*name:/,
    'der Menü-Trigger muss die gewählte Liste im zugänglichen Namen nennen');







  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(cssNoComments, /\.list-header__(more|inline-actions)\s*\{/,
    'die responsive Doppelfassung der Listen-Aktionen ist entfallen - eine Darstellung auf allen Breiten');
  assert.doesNotMatch(page, /list-header__(more|inline-actions)/,
    'die responsive Doppelfassung der Listen-Aktionen ist entfallen - eine Darstellung auf allen Breiten');



  assert.match(cssNoComments, /\.list-tabs-bar__actions\s*\{[^}]*position:\s*sticky/,
    'die Aktionszone muss am Rand der scrollenden Chip-Leiste stehenbleiben');
  assert.match(cssNoComments, /\.list-tabs-bar__actions\s*\{[^}]*background-color:/,
    'die sticky Aktionszone braucht einen opaken Grund, sonst scrollen Chips sichtbar darunter durch');


  // drei unbeschriftete Glyphen nebeneinander standen.
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.list-header__import-btn span\s*\{\s*display:\s*none/,
    '„Aus dem Essensplan" darf mobil nicht auf ein nacktes Icon reduziert werden - es steht mit Label im Menü');


  assert.match(css, /@media \(hover: none\)[\s\S]{0,600}\.quick-add\s*\{\s*display:\s*none/,
    'das Quick-Add muss auf Touch eingeklappt sein');
  assert.match(css, /\.shopping-page--adding \.quick-add\s*\{\s*display:\s*block/,
    'der FAB muss es aufklappen können');
  assert.match(page, /fab\.setAttribute\('aria-expanded', String\(open\)\)/,
    'der FAB muss seinen Aufklapp-Zustand melden');
  assert.match(page, /fab\.removeAttribute\('aria-expanded'\)/,
    'auf Zeigergeräten klappt der FAB nichts auf und darf keinen Zustand behaupten');
  assert.match(page, /e\.key !== 'Escape'/, 'Esc muss das Quick-Add wieder schließen');


  assert.match(css, /@media \(hover: hover\)[\s\S]{0,400}\.empty-state__cta\s*\{\s*display:\s*none/,
    'auf Zeigergeräten ist der Leerzustands-CTA eine dritte Tür in denselben Raum');




  assertKeysExistInEveryLocale([
    'shopping.listActionsLabel', 'shopping.checkedHint', 'shopping.checkedHint_one',




    'pantry.bulkPillLabel', 'pantry.bulkPillLabel_one',
  ]);
});

test('die Sammelaktions-Pille wohnt in der Shell und kostet die Liste keine Zeile', () => {
  const layout    = read('../public/styles/layout.css');
  const listRow   = read('../public/styles/list-row.css');
  const tokens    = read('../public/styles/tokens.css');
  const router    = read('../public/router.js');

  // --- 1. EINE Schreibweise -------------------------------------------------
  const bulkbarRules = [...eachRule(layout)].filter((r) => /^\.list-bulkbar\b/.test(r.selector.trim()));
  assert.ok(bulkbarRules.length,
    '.list-bulkbar gehört in die Shell-Schicht (layout.css), wo auch der Toast steht');




  // gemacht, der recht hatte).
  for (const [file, css] of [
    ['list-row.css', listRow],
    ['pantry.css',   read('../public/styles/pantry.css')],
    ['shopping.css', read('../public/styles/shopping.css')],
  ]) {
    for (const rule of eachRule(css)) {
      assert.doesNotMatch(rule.selector, /\.list-bulkbar|\.pantry-bulkbar/,
        `${file} darf die Sammelaktions-Leiste nicht nachbauen - sie steht in layout.css`);
    }
  }

  for (const page of ['shopping', 'pantry']) {
    const src = read(`../public/pages/${page}.js`);
    assert.match(src, /from '\/utils\/bulk-pill\.js'/,
      `${page}.js muss die geteilte Shell-Oberfläche verwenden, nicht selbst rendern`);
    assert.match(src, /setBulkPill\(/, `${page}.js muss die Pille über setBulkPill setzen`);
    assert.match(src, /clearBulkPill\(/,
      `${page}.js muss die Pille wegnehmen, sobald es keine Teilmenge mehr gibt`);


    // `<!--` stehen (CodeQL js/incomplete-multi-character-sanitization, high).


    assert.doesNotMatch(withoutHtmlComments(withoutBlockComments(src)),
      /class="[^"]*\blist-bulkbar\b/,
      `${page}.js darf die Leiste nicht wieder in den Seitenfluss schreiben`);
  }


  //





  //



  // schon einmal verboten hat.


  const subjektWeg = [...eachRule(layout)].filter((r) => /\.list-bulkbar__subject\b/.test(r.selector)
    && /display:\s*none/.test(r.body) && r.at.some((a) => /bulk-pill/.test(a)));
  assert.equal(subjektWeg.length, 1,
    'erwartet genau eine Container-Regel, die das Subjekt der Pille wegnimmt');
  const markeDa = [...eachRule(layout)].find((r) => /__action-count\b/.test(r.selector)
    && /display:\s*(inline|flex|inline-flex|inline-block)/.test(r.body));
  assert.ok(markeDa, 'ohne Subjekt muss die Zahl an der Aktion sichtbar werden');
  assert.deepEqual(markeDa.at, subjektWeg[0].at,
    'die Marke tritt unter GENAU der Bedingung ein, unter der das Subjekt geht - '
    + 'sonst stünde die Zahl irgendwo zweimal oder nirgends');



  const markeBasis = [...eachRule(layout)].find((r) => r.selector.trim() === '.list-bulkbar__action-count' && !r.at.length);
  assert.ok(markeBasis && /display:\s*none/.test(markeBasis.body),
    'die Marke ist standardmässig weg - neben dem Subjekt wäre sie dessen Echo');




  const shoppingSrc = read('../public/pages/shopping.js');
  const loeschAktion = shoppingSrc.match(/actions\.push\(\{[\s\S]*?clearChecked[\s\S]*?\n {2}\}\);/);
  assert.ok(loeschAktion, 'die Löschen-Aktion der Einkaufs-Pille nicht gefunden');




  assert.match(loeschAktion[0], /^\s*count:\s*checkedCount,\s*$/m,
    'die Löschen-Kapsel muss ihre Zahl als eigene Eigenschaft mitgeben - ohne Subjekt '
    + 'liest sich ein blosses „Löschen" über einer vollen Liste wie „die Liste löschen"');

  // --- 2. EINZEILIG per Konstruktion ---------------------------------------
  const pillBase = bulkbarRules.find((r) => r.selector.trim() === '.list-bulkbar' && !r.at.length);
  assert.ok(pillBase, '.list-bulkbar braucht eine Basisregel ohne At-Block');
  assert.doesNotMatch(pillBase.body, /flex-wrap:\s*wrap/,
    'ein Umbruch macht aus der Pille wieder den 103px-Block, den sie ersetzt');
  assert.match(pillBase.body, /min-height:\s*var\(--bulk-pill-height\)/,
    'die Pille muss die Höhe halten, mit der --bulk-pill-safe-zone rechnet');
  assert.match(tokens, /--bulk-pill-safe-zone:\s*calc\([^;]*--bulk-pill-height[^;]*\)/,
    'der Nachlauf leitet sich aus der Pillenhöhe ab und darf nicht davon wegdriften');

  // --- 3. Nachlauf am Scroll-Ende ------------------------------------------



  // `.has-bulk-safe-zone` (2026-08-13) unveraendert: der Guard verlangte


  //


  // Nachlauf, sonst reservierte jede der drei Listen ihn dauerhaft.
  const pillenSummand = [...eachRule(layout)].filter((r) =>
    /--bulk-pill-tail:\s*var\(--bulk-pill-safe-zone\)/.test(r.body));
  assert.strictEqual(pillenSummand.length, 1,
    'die Pillenzone wird an GENAU EINER Stelle zum Summanden --bulk-pill-tail');
  assert.match(pillenSummand[0].selector, /:has\([^)]*\.list-bulkbar[^)]*\)/,
    'und nur, solange eine Pille da ist - sonst reserviert jeder Scrollport den '
    + 'Streifen auch dann, wenn nichts ausgewaehlt ist');
  assert.match(layout, /--shell-tail:\s*calc\([^;]*--bulk-pill-tail[^;]*\)/,
    'und der Summand muss in der Summe --shell-tail auftauchen, sonst zaehlt ihn niemand');






  const stackAppend = router.match(/bottomStack\.append\(([^)]*)\)/);
  assert.ok(stackAppend, 'die Shell muss einen .shell-bottom-stack füllen');
  const order = stackAppend[1].split(',').map((s) => s.trim());
  assert.equal(order[0], 'bulkPillLayerEl',
    'die Pille steht ZUERST im Stapel, damit sie dem Toast ausweicht und nicht umgekehrt');
  assert.ok(order.length === 3 && order.every((n) => /toastContainer|bulkPillLayer/.test(n)),
    'in den Stapel gehören genau die Pillen-Schicht und die beiden Toast-Container');



  const emptyRule = [...eachRule(layout)].find((r) => /\.shell-bottom-stack\s*>\s*:empty/.test(r.selector));
  assert.ok(emptyRule && /display:\s*none/.test(emptyRule.body),
    'leere Zellen des Stapels müssen aus dem Fluss - sonst verschiebt ihre Lücke den Toast');
});

test('jede Sammelaktions-Pille gibt ihre Zahl an eine Kapsel weiter', () => {
  const actionLiterals = (src) => {
    const out = [];
    for (const m of src.matchAll(/\bonClick:/g)) {
      let depth = 0;
      let start = -1;
      for (let i = m.index; i >= 0; i--) {
        if (src[i] === '}') depth += 1;
        else if (src[i] === '{') {
          if (depth === 0) { start = i; break; }
          depth -= 1;
        }
      }
      if (start === -1) continue;
      let end = -1;
      depth = 0;
      for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) out.push(src.slice(start, end + 1));
    }
    return out;
  };

  const pages = readdirSync(new URL('../public/pages/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => [f, read(`../public/pages/${f}`)])
    .filter(([, src]) => /from '\/utils\/bulk-pill\.js'/.test(src) && /setBulkPill\(/.test(src));

  assert.ok(pages.length >= 2,
    'erwartet mindestens Einkauf und Vorrat als Pillen-Aufrufer - findet der Scan keine, prüft er nichts');

  for (const [name, src] of pages) {
    const literals = actionLiterals(src);
    assert.ok(literals.length, `${name}: keine Aktion mit onClick gefunden`);


    const mitZahl = literals.filter((lit) => /^\s*count:\s*[^,\s][^\n]*,\s*$/m.test(lit));
    assert.ok(mitZahl.length >= 1,
      `${name}: mindestens eine Kapsel muss ihre Zahl als eigene Eigenschaft mitgeben - `
      + 'unter 21rem fällt das Subjekt der Pille weg, und was dann ohne Objekt dasteht, '
      + 'ist entweder gefährlich („Löschen") oder mehrdeutig („Alles")');
  }
});

test('die Zählmarke der Pille geht nicht in den Namen der Kapsel ein', () => {
  const pill = read('../public/utils/bulk-pill.js');


  // `if (action.count != null) {` samt seiner vier Spalten Einzug und starb an



  const at = pill.indexOf('list-bulkbar__action-count');
  assert.notEqual(at, -1, 'die Marke der Kapsel wird nirgends gesetzt');


  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i--) {
    if (pill[i] === '}') depth += 1;
    else if (pill[i] === '{') { if (depth === 0) { start = i; break; } depth -= 1; }
  }
  assert.notEqual(start, -1, 'kein umschliessender Block um die Marke gefunden');
  let end = -1;
  depth = 0;
  for (let i = start; i < pill.length; i++) {
    if (pill[i] === '{') depth += 1;
    else if (pill[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const block = pill.slice(start, end + 1);

  assert.match(block, /setAttribute\('aria-hidden', 'true'\)/,
    'die Marke muss aus dem Namen der Kapsel heraus - die Zahl steht bereits im Namen der '
    + 'Gruppe (aria-labelledby überlebt display:none) und, wo es eine gibt, im aria-label');
});

test('eine destruktive Sammelaktion fragt zurück, bevor sie ausführt', () => {
  const actionLiterals = (src) => {
    const out = [];
    for (const m of src.matchAll(/\bonClick:/g)) {
      let depth = 0;
      let start = -1;
      for (let i = m.index; i >= 0; i--) {
        if (src[i] === '}') depth += 1;
        else if (src[i] === '{') { if (depth === 0) { start = i; break; } depth -= 1; }
      }
      if (start === -1) continue;
      let end = -1;
      depth = 0;
      for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) out.push(src.slice(start, end + 1));
    }
    return out;
  };



  const DESTRUKTIV = /\bt\(\s*['"][^'"]*\.(delete|remove|clear|destroy)[^'"]*['"]|\bt\(\s*['"]common\.delete['"]/i;

  const pages = readdirSync(new URL('../public/pages/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => [f, read(`../public/pages/${f}`)])
    .filter(([, src]) => /from '\/utils\/bulk-pill\.js'/.test(src) && /setBulkPill\(/.test(src));

  assert.ok(pages.length >= 2,
    'erwartet mindestens Einkauf und Vorrat als Pillen-Aufrufer - findet der Scan keine, prüft er nichts');







  // das seine eigene Bestaetigung mitbringt.
  //

  // `label`, `ariaLabel`, `count`, `danger`, `confirm` und `onClick`


  const PILLEN_SCHLUESSEL = new Set(['label', 'ariaLabel', 'count', 'danger', 'confirm', 'onClick']);
  const istPillenKapsel = (lit) => {
    const keys = [...lit.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]);
    return keys.length > 0 && keys.every((k) => PILLEN_SCHLUESSEL.has(k));
  };

  let destruktiveGefunden = 0;
  for (const [name, src] of pages) {
    for (const lit of actionLiterals(src).filter(istPillenKapsel)) {
      const markiert = /^\s*danger:\s*true,\s*$/m.test(lit);
      const fragt    = /^\s*confirm:\s*\{/m.test(lit);
      const verb     = DESTRUKTIV.test(lit);

      if (markiert) {
        assert.ok(fragt, `${name}: eine als gefährlich markierte Kapsel muss zurückfragen - `
          + 'die Tinte allein unterscheidet sie vom Nachbarn, nicht von einem Fehltipp');
      }
      if (verb) {
        destruktiveGefunden += 1;
        assert.ok(markiert && fragt,
          `${name}: eine Kapsel mit destruktivem Verb braucht BEIDES - die Tinte, damit sie `
          + 'sich von der harmlosen Kapsel daneben unterscheidet, und die Rückfrage, damit '
          + 'ein Fehltipp folgenlos bleibt');
      }
    }
  }


  assert.ok(destruktiveGefunden >= 1,
    'keine destruktive Sammelaktion gefunden - entweder ist der Einkauf umgebaut oder das '
    + 'Muster DESTRUKTIV trifft die Keys nicht mehr');


  //






  const pill = read('../public/utils/bulk-pill.js');
  assert.match(pill, /confirmBtn\.disabled = true;\s*\n\s*setTimeout\(\(\) => \{ confirmBtn\.disabled = false; \}, CONFIRM_GRACE_MS\);/,
    'die Bestätigung muss nach dem Aufmachen der Frage kurz gesperrt sein - sie liegt auf '
    + 'der Kapsel, die sie ausgelöst hat');
  const grace = pill.match(/const CONFIRM_GRACE_MS = (\d+);/);
  assert.ok(grace, 'die Schutzfrist braucht einen benannten Wert, keine Zahl im Aufruf');
  const ms = Number(grace[1]);
  assert.ok(ms >= 250 && ms <= 500,
    `die Frist liegt zwischen einem Doppeltipp und einer gelesenen Antwort (250-500ms), ist aber ${ms}ms`);


  // Wartezeit, kein Schutz.
  assert.doesNotMatch(pill, /cancel\.disabled = true/,
    'wer abbricht, darf das sofort - nur die Bestätigung wartet');
});

test('die Rückfrage der Pille bricht um, statt zu kappen', () => {
  const layout = read('../public/styles/layout.css');
  const rules  = [...eachRule(layout)];

  const wrap = rules.find((r) => r.selector.trim() === '.list-bulkbar--confirming' && !r.at.length);
  assert.ok(wrap && /flex-wrap:\s*wrap/.test(wrap.body),
    'der Bestätigungszustand muss umbrechen dürfen - sonst kappt die Frage bei der ersten '
    + 'Sprache, die länger ist als Deutsch');

  const frage = rules.find((r) => /\.list-bulkbar--confirming\s+\.list-bulkbar__subject/.test(r.selector)
    && !r.at.length);
  assert.ok(frage, 'die Frage braucht eine eigene Regel gegen die Kürzung des Ruhezustands');
  assert.match(frage.body, /flex:\s*1\s+0\s+auto/,
    'die Frage darf nicht schrumpfen - sie soll die Kapseln in die nächste Zeile schieben');
  assert.match(frage.body, /overflow:\s*visible/,
    'ohne das erbt die Frage die Ellipse des Subjekts und kappt in einer Zeile, die Platz hätte');



  // „Verwijderen" allein darunter.
  const choices = rules.find((r) => r.selector.trim() === '.list-bulkbar__choices' && !r.at.length);
  assert.ok(choices, 'Abbrechen und Bestätigen brauchen einen gemeinsamen Träger');
  assert.match(choices.body, /flex-shrink:\s*0/,
    'das Paar wandert als Ganzes, es schrumpft nicht');
  assert.match(read('../public/utils/bulk-pill.js'), /class(?:Name)?\s*=\s*'list-bulkbar__choices'/,
    'die Fabrik muss das Paar auch bauen - eine CSS-Regel ohne Knoten ist keine Zusicherung');



  //




  const ohneNot = (sel) => sel.replace(/:not\([^)]*\)/g, '');
  for (const rule of rules) {
    if (!/\.list-bulkbar--confirming/.test(ohneNot(rule.selector))) continue;
    assert.equal(rule.at.filter((a) => /bulk-pill/.test(a)).length, 0,
      'der Bestätigungszustand darf an keiner Container-Schwelle hängen - sein Bedarf hängt '
      + 'an der Sprache, nicht an einer Zahl');
  }
});

test('ein Etikett verschwindet, wenn es heisst wie die eigene Prioritaet', () => {
  const src = read('../public/pages/tasks.js');

  const fn = src.match(/function renderTagBadges\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'renderTagBadges nicht gefunden');
  assert.match(fn[0], /priority\s*=\s*null/,
    'die Etiketten-Funktion muss die Prioritaet kennen, sonst kann sie sie nicht vergleichen');





  // Filter ueber die Etiketten vorkommt.
  const labelVar = fn[0].match(/const\s+(\w+)\s*=[^;]*PRIORITY_LABELS\(\)\[priority\]/);
  assert.ok(labelVar,
    'verglichen wird gegen das ANGEZEIGTE Label, nicht gegen den Schluessel - das Etikett kommt '
    + 'aus einer fremden Liste und ist in der Sprache geschrieben, in der es dort steht');
  const filterMitLabel = new RegExp(`tags\\s*=\\s*tags\\.filter\\([\\s\\S]{0,160}?\\b${labelVar[1]}\\b`);
  assert.match(fn[0], filterMitLabel,
    `das Label (\`${labelVar[1]}\`) muss die Etiketten wirklich filtern - eine Variable, die nur `
    + 'berechnet und nie benutzt wird, ist ein Guard ohne Gegenstand');
  assert.match(fn[0], /toLocaleLowerCase|toLowerCase/,
    'gross/klein darf den Vergleich nicht entscheiden - „Dringend" und „dringend" sind dasselbe Wort');


  const aufrufe = [...src.matchAll(/renderTagBadges\(([^)]*)\)/g)]
    .map((m) => m[1]).filter((args) => !args.includes('limit ='));
  assert.ok(aufrufe.length >= 2, `erwartet mindestens zwei Aufrufstellen, gefunden ${aufrufe.length}`);
  for (const args of aufrufe) {
    assert.match(args, /task\.priority/,
      `eine Aufrufstelle gibt die Prioritaet nicht mit (\`${args}\`) - dort steht das Etikett `
      + 'weiter neben seinem Zwilling');
  }
});

test('eine Zeile wiederholt die geteilte Grammatik nicht', () => {
  const listRowCss = read('../public/styles/list-row.css');
  const basis = [...eachRule(listRowCss)]
    .find((r) => r.selector.trim() === '.list-row' && !r.at.length);
  assert.ok(basis, '.list-row braucht eine Basisregel - ohne sie prueft der Guard nichts');


  const geteilt = new Map();
  for (const decl of basis.body.split(';')) {
    const [prop, ...rest] = decl.split(':');
    if (!rest.length) continue;
    const p = prop.trim().replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!p || p.startsWith('--')) continue;
    geteilt.set(p, rest.join(':').trim().replace(/\s+/g, ' '));
  }
  assert.ok(geteilt.size >= 5,
    `erwartet mindestens fuenf geteilte Deklarationen, gefunden ${geteilt.size}`);


  const begleiter = new Set();
  for (const file of readdirSync(new URL('../public/pages/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
    const src = read(`../public/pages/${file}`);
    for (const m of src.matchAll(/class="([^"]*\blist-row\b[^"]*)"/g)) {
      for (const cls of m[1].split(/\s+/)) {

        if (!cls || cls === 'list-row' || cls.includes('$') || cls.includes('{')) continue;
        begleiter.add(cls);
      }
    }
  }
  assert.ok(begleiter.size >= 3,
    'erwartet mindestens die drei nachgezogenen Zeilen als Begleitklassen - findet der Scan '
    + 'keine, prueft er nichts');

  const alleCss = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((f) => f.endsWith('.css') && f !== 'list-row.css')
    .map((f) => [f, read(`../public/styles/${f}`)]);

  const verstoesse = [];
  for (const [file, css] of alleCss) {
    for (const rule of eachRule(css)) {


      const sel = rule.selector.trim();
      if (!begleiter.has(sel.replace(/^\./, ''))) continue;
      for (const [prop, wert] of geteilt) {
        const treffer = new RegExp(`(^|;)\\s*${prop}\\s*:\\s*${wert.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(;|$)`);
        if (treffer.test(rule.body)) verstoesse.push(`${file} ${sel} { ${prop}: ${wert} }`);
      }
    }
  }
  assert.deepEqual(verstoesse, [],
    'diese Zeilen setzen eine Eigenschaft auf DENSELBEN Wert, den `.list-row` schon setzt - '
    + 'das ist ein Nachbau, kein Unterschied. Abweichen ist erlaubt, wiederholen nicht');
});

test('eine Seite mit Zeilenliste hat auch geteilte Zeilen', () => {
  for (const file of readdirSync(new URL('../public/pages/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
    const src = read(`../public/pages/${file}`);
    if (!/class="[^"]*\blist-rows\b/.test(src)) continue;
    assert.match(src, /class="[^"]*\blist-row\b/,
      `${file} baut eine Zeilenliste, aber keine geteilte Zeile - genau so standen Agenda, `
      + 'Kontakte und Aufgaben mit ihrem eigenen Nachbau darin');
  }
});

test('das Shell-Material behält im Reduced-Transparency-Fallback seinen dunklen Grund', () => {
  const glass = read('../public/styles/glass.css');
  let seen = 0;

  for (const rule of eachRule(glass)) {
    if (!rule.at.some((a) => /prefers-reduced-transparency/.test(a))) continue;
    if (!/\.toast\b|\.list-bulkbar\b/.test(rule.selector)) continue;
    seen += 1;
    const bg = rule.body.match(/background-color:\s*([^;]+)/)?.[1]?.trim();
    assert.ok(bg, `${rule.selector} muss im Fallback einen opaken Grund setzen`);
    assert.match(bg, /--neutral-800/,
      `${rule.selector} braucht seinen EIGENEN dunklen Grund - der helle Akzent gehört dem Chip, `
      + 'und die Schrift auf diesem Material ist --neutral-50');
  }

  assert.ok(seen >= 1,
    'Toast und Pille tragen Glas und brauchen deshalb einen Reduced-Transparency-Fallback');
});

test('die Bedienzone der Vorratszeile traegt keinen Text', () => {
  const shared = read('../public/styles/list-row.css');
  const pantryCss = read('../public/styles/pantry.css');
  const pantryJs = read('../public/pages/pantry.js');


  const rows = shared.match(/\.list-rows\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rows, /container-type:\s*inline-size/,
    '.list-rows muss abfragbarer Container sein - ein Container kann sich selbst nicht abfragen');
  assert.match(rows, /container-name:\s*list-rows/, 'der Container braucht einen Namen');


  assert.match(pantryJs, /stepper\.append\(minus,\s*plus\)/,
    'in den Stepper gehoeren nur die beiden Knoepfe - ein Wert dazwischen macht seine Breite vom Text abhaengig');
  const pantryRules = [...eachRule(pantryCss)];
  const valueRule = pantryRules.find((r) => /\.pantry-stepper__value/.test(r.selector));
  assert.equal(valueRule, undefined,
    'das Wertfeld ist in die Metazeile gezogen; kaeme es zurueck, waere die Zusage still gebrochen');
  const wrapping = pantryRules.filter((r) => /\.pantry-stepper\b/.test(r.selector) && /flex-wrap:\s*wrap/.test(r.body));
  assert.deepEqual(wrapping.map((r) => r.selector), [],
    'der Stepper darf nicht mehr umbrechen - der Umbruch war der Hoehentreiber der Zeile');



  // trotzdem gruen.
  assert.match(pantryJs, /quantity\.className = 'pantry-row__quantity'/,
    'die Menge braucht einen eigenen Knoten in der Metazeile - der Stepper aktualisiert ihn');
  assert.match(pantryJs, /meta\.appendChild\(quantity\)/,
    'die Menge haengt in der Metazeile');
  assert.match(pantryJs, /row\.querySelector\('\.pantry-row__quantity'\)/,
    'refreshRowQuantity muss den neuen Knoten treffen, sonst friert die Anzeige beim Steppen ein');

  assert.match(pantryJs, /expiry\.className = 'pantry-row__expiry'/,
    'das MHD braucht einen eigenen Knoten, sonst kann es nur abgeschnitten statt weggelassen werden');
  assert.match(pantryJs, /expiry\.textContent = ` · \$\{t\('pantry\.bestBefore'/,
    'das Trennzeichen gehoert IN den Knoten - sonst bleibt beim Weglassen ein einsames Mittelpunkt-Zeichen stehen');
  assert.match(
    pantryCss,
    /@container list-rows \(max-width:[^)]+\)\s*\{\s*\.pantry-row:has\(\.pantry-row__cart\) \.pantry-row__expiry\s*\{\s*display:\s*none/,
    'das MHD faellt auf der schmalen Zeile MIT Warenkorb weg - an der Traegerbreite, nicht am Viewport',
  );



  assert.match(pantryCss, /--pantry-step-btn:\s*var\(--target-md\)/, 'Zeiger: --target-md');
  assert.match(pantryCss, /@media \(hover: none\)\s*\{\s*\.pantry-stepper\s*\{\s*--pantry-step-btn:\s*var\(--target-base\)/,
    'Touch: --target-base, gesetzt an derselben Variable');
  assert.doesNotMatch(pantryCss, /\.pantry-stepper__btn\s*\{[^}]*width:\s*var\(--target-md\)/,
    'die Knopfgröße darf nicht doppelt gepflegt werden');
});

test('die Küchen-Tab-Leiste trägt den Zustand des Kreislaufs', () => {
  const route = read('../server/routes/kitchen.js');
  const tabs = read('../public/utils/kitchen-tabs.js');
  const sub = read('../public/utils/sub-tabs.js');
  const index = read('../server/index.js');

  // Eine Abfrage, vier Zahlen - keine drei Fremd-Endpunkte pro Seitenaufruf.
  assert.match(index, /app\.use\('\/api\/v1\/kitchen', kitchenRouter\)/,
    'der Kitchen-Router muss gemountet sein');
  assert.match(read('../server/openapi/paths/kitchen.js'), /'\/api\/v1\/kitchen\/summary'/,
    'die Route muss in der OpenAPI-Spec stehen');
  assert.match(route, /router\.get\('\/summary'[\s\S]*?try \{[\s\S]*?\} catch \(err\)/,
    'jeder Route-Handler in try/catch (Hard Constraint)');





  assert.match(tabs, /kitchen\/summary\?today=\$\{encodeURIComponent\(todayKey\(\)\)\}/,
    'der Client muss seinen lokalen Tag mitgeben, sonst rechnet der Server in UTC');
  assert.match(route, /DATE_RE\.test\(req\.query\.today/, 'die Route muss `today` validieren');



  const status = read('../public/utils/pantry-status.js');
  assert.match(status, /const out = quantity <= 0/);
  assert.match(route, /quantity <= 0/, 'leer: dieselbe Bedingung wie pantryItemStatus');
  assert.match(route, /min_quantity IS NOT NULL AND quantity <= min_quantity/,
    'fast leer: dieselbe Bedingung wie pantryItemStatus');
  assert.match(route, /expires_on IS NOT NULL AND expires_on < \?/,
    'abgelaufen: reiner Stringvergleich wie im Client (YYYY-MM-DD ist lexikografisch chronologisch)');



  assert.match(tabs, /route === _activeRoute \? 0 :/,
    'der aktive Tab darf kein Badge tragen - sonst veraltet es bei jeder eigenen Mutation');


  for (const [tabKey, stateKey] of [['nav.shopping', 'nav.shoppingOpen'], ['nav.pantry', 'nav.pantryAttention']]) {
    assert.ok(tabs.includes(`\${t('${tabKey}')}: \${t('${stateKey}'`),
      `${stateKey} muss den Tabnamen voranstellen, sonst hört ein Screenreader nur die Zahl`);
  }
  assert.match(sub, /badge\.setAttribute\('aria-hidden', 'true'\)/,
    'die Zahl ist redundant, sobald das Label sie nennt');


  const subCss = read('../public/styles/sub-tabs.css');
  assert.match(subCss, /\.sub-tab__badge\[hidden\]\s*\{\s*display:\s*none/,
    'ohne diese Regel bleibt das leere Badge 16px breit stehen');


  assert.match(subCss, /\.sub-tab__badge\s*\{[\s\S]*?color:\s*var\(--color-text-primary\)/,
    'die Zahl braucht Ink, nicht die zurückgenommene Tab-Tinte');
  assertKeysExistInEveryLocale([
    'nav.shoppingOpen', 'nav.shoppingOpen_one',
    'nav.pantryAttention', 'nav.pantryAttention_one',
  ]);


  //





  // Stationen mit echtem offenem Vorrat.
  //


  const badges = tabs.slice(tabs.indexOf('const BADGES = ['), tabs.indexOf('/** Aktuelle Leiste'));
  assert.ok(badges.includes("route: '/shopping'") && badges.includes("route: '/pantry'"),
    'die zwei Stationen mit offenem Zustand brauchen ein Badge');
  for (const route of ['/recipes', '/meals']) {
    assert.ok(!badges.includes(`route: '${route}'`),
      `${route}: ein Badge, das Bestand oder Abwesenheit zählt, entwertet die zwei, die etwas verlangen`);
  }



  const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code(route), /\bgaps\b|FROM meals\b|visible_meal_types/,
    'server/routes/kitchen.js: die Lücken-Rechnung ist ohne Badge tot - sie darf nicht stehenbleiben');
  assert.doesNotMatch(code(tabs), /meals\?\.gaps|mealsGaps/,
    'kitchen-tabs.js: kein Rest des entfallenen Mahlzeiten-Badges');
});

test('die Küche benutzt ein Vokabular für eine Sache', () => {
  const de = JSON.parse(read('../public/locales/de.json'));
  const pages = Object.fromEntries(['meals', 'recipes', 'shopping', 'pantry']
    .map((p) => [p, read(`../public/pages/${p}.js`)]));






  assertKeysExistInEveryLocale(['common.toShoppingList', 'common.toShoppingListWhich', 'common.toShoppingListNamed']);
  for (const dead of ['meals.transferToShoppingList', 'meals.toShoppingListNamed', 'recipes.toShoppingList', 'recipes.toShoppingListTitle', 'pantry.toShopping', 'pantry.chooseList']) {
    const [block, key] = dead.split('.');
    assert.equal(de[block]?.[key], undefined,
      `${dead} ist durch common.toShoppingList(Named) ersetzt - zwei Keys für ein Label laufen auseinander (auf Englisch war das schon passiert)`);
  }
  for (const page of ['meals', 'recipes', 'pantry']) {
    assert.ok(
      pages[page].includes("t('common.toShoppingList')")
        || pages[page].includes("t('common.toShoppingListNamed'"),
      `${page}.js muss das geteilte Transfer-Label nutzen (common.toShoppingList oder die benannte Fassung)`,
    );
  }

  // Jeder Transfer-Toast nennt sein ZIEL.
  for (const key of ['meals.transferSuccess', 'recipes.toShoppingSuccess', 'pantry.toShoppingDone']) {
    const [block, name] = key.split('.');
    assert.match(de[block][name], /\{\{list\}\}/,
      `${key} muss die Ziel-Liste nennen: „übernommen" allein sagt nicht, wohin`);
  }
  assert.match(de.shopping.toPantryDoneAt, /\{\{location\}\}/,
    'der Weg in den Vorrat muss den gewählten Lagerort nennen');



  // Regel weiter galt.
  for (const [page, key] of [['meals', 'meals.transferSuccess'], ['recipes', 'recipes.toShoppingSuccess'], ['pantry', 'pantry.toShoppingDone']]) {
    assert.match(pages[page], new RegExp(`t\\('${key}',\\s*\\{[^}]*list:`),
      `${page}.js muss den Listennamen an ${key} übergeben`);
  }



  for (const dead of ['meals.title', 'recipes.title', 'shopping.title', 'pantry.title']) {
    const [block, key] = dead.split('.');
    assert.equal(de[block]?.[key], undefined,
      `${dead} ist durch nav.${block} ersetzt - ein Screenreader hörte sonst „Mahlzeiten" im Tab und „Essensplan" in der Überschrift`);
  }
  for (const [page, key] of [['meals', 'nav.meals'], ['recipes', 'nav.recipes'], ['shopping', 'nav.shopping'], ['pantry', 'nav.pantry']]) {
    assert.ok(pages[page].includes(`t('${key}')`), `${page}.js muss ${key} als Seitentitel nutzen`);
  }


  assertKeysExistInEveryLocale(['common.nameLabel', 'common.nameRequired']);
  for (const dead of ['meals.titleLabel', 'meals.titleRequired', 'recipes.titleLabel', 'recipes.titleRequired', 'pantry.nameLabel', 'pantry.nameRequired']) {
    const [block, key] = dead.split('.');
    assert.equal(de[block]?.[key], undefined, `${dead} ist durch common.nameLabel/nameRequired ersetzt`);
  }



  for (const key of ['meals.deletedToast', 'meals.seriesDeletedToast', 'recipes.deleted', 'pantry.deleted', 'shopping.deletedListToast', 'shopping.itemDeletedToast', 'shopping.itemsRemovedToast']) {
    const [block, name] = key.split('.');
    assert.match(de[block][name], /gelöscht/,
      `${key} muss „gelöscht" sagen - „entfernt" im Einkauf gegen „gelöscht" in Mahlzeiten war dieselbe Handlung mit zwei Verben`);


    assert.match(de[block][name], /\.$/, `${key} muss auf einen Punkt enden`);
  }
  assert.match(de.kitchen.transferUndone, /entfernt/,
    'das Undo nimmt den Artikel von der Einkaufsliste, ohne ihn zu löschen - hier ist „entfernt" korrekt');
});

test('die beiden Küchen-Editoren sind derselbe Dialog', () => {
  const shopping = read('../public/pages/shopping.js');
  const pantry = read('../public/pages/pantry.js');
  const de = JSON.parse(read('../public/locales/de.json'));


  assertKeysExistInEveryLocale(['common.editItem']);
  assert.equal(de.pantry?.editItem, undefined, 'pantry.editItem ist durch common.editItem ersetzt');
  for (const [name, src] of [['shopping', shopping], ['pantry', pantry]]) {
    assert.ok(src.includes("t('common.editItem')"), `${name}.js muss den geteilten Dialog-Titel nutzen`);
  }
  const details = shopping.slice(shopping.indexOf('function openItemDetails'), shopping.indexOf('function updateItemsList'));
  assert.doesNotMatch(details, /title: item\.name/,
    'der Datenwert ist kein Dialogtitel - er sagt nicht, was der Dialog tut');


  assert.match(details, /id="item-details-cancel"/, 'der Dialog braucht ein Abbrechen');
  assert.match(details, /#item-details-cancel'\)\?\.addEventListener\('click', \(\) => closeModal\(\)\)/,
    'Abbrechen muss auch verdrahtet sein');

  // Name, Menge und Kategorie editierbar.
  for (const field of ['item-details-name', 'item-details-qty', 'item-details-cat']) {
    assert.ok(details.includes(`id="${field}"`), `${field} muss im Dialog editierbar sein`);
  }
  assert.match(details, /reportFieldError\(nameEl, t\('common\.nameRequired'\)\)/,
    'ein leerer Name muss am Feld gemeldet werden, nicht per Toast');


  const layout = read('../public/styles/layout.css');
  assert.match(layout, /^\.form-check \{/m, '.form-check gehört in layout.css, nicht in ein Modul-CSS');


  // (--module-accent → --active-module-accent → --color-accent), und sie hatte





  assert.match(layout, /\.form-check input\[type="checkbox"\]\s*\{[\s\S]*?accent-color:\s*var\(--color-accent\)/,
    'die Checkbox muss eingekleidet sein und die Stimme tragen, auch im Modal');
  assert.match(shopping, /class="form-check pantry-transfer__clear"/,
    'die folgenreichste Checkbox des Moduls („Artikel von der Einkaufsliste löschen", standardmäßig aktiv) war die unauffälligste');
  assert.match(read('../public/pages/recipes.js'), /class="form-check recipe-meal-types__option"/,
    'die Mahlzeit-Typen im Rezept-Formular waren die zweite nackte System-Checkbox');

  for (const [file, selector] of [['shopping.css', '.pantry-transfer__clear'], ['recipes.css', '.recipe-meal-types__option']]) {
    const block = read(`../public/styles/${file}`).match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    assert.doesNotMatch(block, /display:|align-items:|cursor:/,
      `${file}: ${selector} darf Geometrie und Zielgröße nicht doppelt pflegen - das leistet .form-check`);
  }



  assert.match(shopping, /id="shopping-import-submit" disabled/,
    'der Import-Knopf muss deaktiviert starten');
  assert.match(shopping, /submitBtn\.disabled = !transferred/,
    'die Vorschau muss ihn freischalten, sobald der Zeitraum Zutaten enthält');
});

test('die Touch-Zielgröße folgt DESIGN.md statt einer dritten Zahl', () => {
  const tokens = read('../public/styles/tokens.css');


  //





  //







  //



  const design = read('../DESIGN.md');
  const bulletStart = design.indexOf('- **Touch-Targets:**');
  assert.notStrictEqual(bulletStart, -1,
    'DESIGN.md muss den Touch-Targets-Absatz führen - er ist die Quelle der Untergrenze');
  const bulletEnd = design.indexOf('\n- ', bulletStart + 1);
  const bullet = design
    .slice(bulletStart, bulletEnd === -1 ? undefined : bulletEnd)
    .replace(/\s+/g, ' ');





  // der Zusage.
  const stated = bullet.match(
    /`--target-base` (\d+)px auf Zeigerger[äa]e?ten.*?`@media \(hover: none\)` auf (\d+)px/);
  assert.ok(stated,
    `DESIGN.md muss beide Zielgrößen mit ihrem Kriterium nennen, gefunden: „${bullet}"`);
  const pointerPx = Number(stated[1]);
  const touchPx = Number(stated[2]);




  const floor = tokens.match(/--target-md:\s*(\d+)px/);
  assert.ok(floor, '--target-md ist die Desktop-Untergrenze und muss in tokens.css stehen');
  assert.ok(pointerPx >= Number(floor[1]),
    `die Zeigergröße aus DESIGN.md (${pointerPx}px) darf die Untergrenze --target-md `
    + `(${floor[1]}px) nicht unterschreiten`);



  const base = tokens.match(/--target-base:\s*(\d+)px/);
  assert.ok(base, '--target-base muss in tokens.css eine Zahl tragen');
  assert.strictEqual(Number(base[1]), pointerPx,
    `auf Zeigergeräten gilt die Zahl aus DESIGN.md (${pointerPx}px)`);
  const lg = tokens.match(/--target-lg:\s*(\d+)px/);
  assert.ok(lg, '--target-lg muss in tokens.css eine Zahl tragen');
  assert.strictEqual(Number(lg[1]), touchPx,
    `--target-lg muss die Fingergröße aus DESIGN.md tragen (${touchPx}px)`);
  assert.match(tokens, /@media \(hover: none\)\s*\{\s*:root\s*\{\s*--target-base:\s*var\(--target-lg\)/,
    `auf Fingergeräten muss



  const anchor = tokens.indexOf('Touch-Ziele auf Fingergeräten');
  assert.notStrictEqual(anchor, -1,
    'der Abschnitt der Touch-Ziele muss in tokens.css auffindbar bleiben - ohne Anker '
    + 'prüft die nächste Zusicherung das Dateiende');
  assert.doesNotMatch(tokens.slice(anchor, anchor + 1400), /--target-base[\s\S]{0,80}@media \(max-width/,
    'die Touch-Größe darf nicht an einer Viewport-Breite hängen');
});

test('der offene Nicht-Text-Kontrast bleibt an den Tokens dokumentiert', () => {
  const tokens = read('../public/styles/tokens.css');
  const block = tokens.slice(0, tokens.indexOf('--color-border:'));
  assert.match(block, /WCAG 1\.4\.11/, 'der Befund muss an --color-border dokumentiert bleiben');
  assert.match(block, /1\.13:1/, 'der gemessene Ist-Wert auf dem Grouped-Grund gehört dazu');
  assert.match(block, /1\.26:1/, 'der Wert auf
  assert.match(block, /1\.60:1/, 'der Dark-Wert gehört dazu');
  assert.match(block, /#949494/, 'der Zielwert für 3:1 gegen die kühle Rampe gehört dazu, sonst muss ihn jeder neu ausrechnen');
  assert.match(block, /nicht für dekorative Gruppierung/,
    'die Abgrenzung Bedienelement gegen Kartenkante gehört dazu - der Critique warf beides zusammen');
});

test('die Küche animiert benannte Properties und sagt Abbrechen überall gleich', () => {






  for (const file of ['shopping.css', 'meals.css', 'recipes.css', 'pantry.css', 'list-row.css', 'kitchen-tabs.css', 'filter-chip.css', 'sub-tabs.css']) {
    const css = read(`../public/styles/${file}`);
    assert.doesNotMatch(css, /transition:\s*all\b/,
      `${file}: transition: all animiert implizit auch Layout-Properties`);
  }




  const modal = read('../public/components/modal.js');
  for (const which of ['prompt', 'select', 'confirm']) {
    assert.match(modal, new RegExp(`class="btn btn--secondary" id="${which}-modal-cancel"`),
      `${which}Modal: Abbrechen muss dieselbe Optik tragen wie in den Seiten-Modalen`);
  }
  assert.doesNotMatch(modal, /btn--ghost" id="\w+-modal-cancel"/,
    'kein Abbrechen darf als Ghost zurückkommen');



  assert.match(read('../public/styles/filter-chip.css'), /WARUM DIE LANGEN LISTEN KEINEN Y-FADE BEKOMMEN/,
    'die Entscheidung gegen den vertikalen Fade gehört an die geteilte Konvention');
  assert.match(read('../public/styles/tokens.css'), /Semantik-Kollision|GEPRÜFT UND BEWUSST SO GELASSEN/,
    'die Farbgleichheit der Mahlzeit-Punkte mit warning/accent gehört an die Tokens');
  assert.match(read('../public/styles/meals.css'), /1920px\s+Content-Spalte gedeckelt auf 1280 → passt/,
    'die Wochenboard-Rechnung gehört ins CSS: „auf keiner Desktop-Breite" stimmt nicht, es fehlen 52px bei 1440');
});

test('der Zeilenname bricht in Wörtern, nicht in Zeichen', () => {
  const shared = read('../public/styles/list-row.css');
  const recipes = read('../public/styles/recipes.css');
  const recipesJs = read('../public/pages/recipes.js');

  const nameBlock = shared.match(/\.list-row__name\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(nameBlock, /overflow-wrap:\s*anywhere/,
    'der Name muss umbrechen dürfen - die Ellipse war der P0 des vorigen Laufs');
  assert.match(nameBlock, /flex:\s*1 1 auto/,
    'ohne flex-basis fällt der Name in einem Flex-Elternteil auf min-content, also auf ein Zeichen');



  assert.match(recipesJs, /import \{ popoverMenuHtml, installPopoverMenus \} from '\/utils\/popover-menu\.js'/,
    'die Zeile muss das geteilte Überlaufmenü nutzen, keine vierte Eigenkonstruktion');
  assert.match(recipesJs, /id: `recipe-menu-\$\{recipe\.id\}`/, 'jede Zeile braucht eine eigene Menü-ID');
  assert.match(recipesJs, /installPopoverMenus\(page\)/, 'das Menü muss an der stabilen Seitenwurzel verdrahtet sein');

  assert.match(recipes, /@container list-rows \(max-width: 30rem\)/,
    'die Umschaltung hängt an der ZEILENbreite, wie beim Vorrats-Stepper');

  const inlineBase = recipes.indexOf('.recipe-row__inline-actions {');
  const query = recipes.indexOf('@container list-rows');
  assert.ok(inlineBase !== -1 && inlineBase < query,
    'der Basiszustand muss VOR der Container-Query stehen, sonst gewinnt er gegen sie');
  const compact = recipes.slice(query);
  assert.match(compact, /\.recipe-row__inline-actions\s*\{\s*display:\s*none/,
    'die drei Inline-Aktionen müssen in der schmalen Zeile weichen');
  assert.match(compact, /\.recipe-row__toggle \.list-row__meta\s*\{[\s\S]*?flex:\s*1 0 100%/,
    'die Zutatenzahl muss unter den Namen rücken - sie ist flex-shrink: 0 und nähme ihm sonst 70px');
});

test('phase 3 high-frequency controls use tokenized touch targets', () => {
  const tasks = read('../public/styles/tasks.css');
  const shopping = read('../public/styles/shopping.css');
  const notes = read('../public/styles/notes.css');
  const layout = read('../public/styles/layout.css');

  assert.match(tasks, /\.task-status-btn::before[\s\S]*var\(--target-base\)/);
  assert.match(tasks, /\.task-bulk-checkbox[\s\S]*(?:min-width|width):\s*var\(--target-base\)/);
  assert.match(tasks, /\.task-card__inline-action[\s\S]*width:\s*var\(--target-base\)/);
  assert.match(tasks, /\.task-card__inline-action[\s\S]*height:\s*var\(--target-base\)/);
  assert.match(tasks, /\.bulk-actions-bar__actions \.btn[\s\S]*min-height:\s*var\(--target-base\)/);
  assert.match(shopping, /\.item-check[\s\S]*(?:min-width|width):\s*var\(--target-base\)/);





  assert.match(read('../public/styles/list-row.css'),
    /\.list-row\s*\{[\s\S]*?min-height:\s*var\(--target-lg\)/);

  // 2026-07-29 eigene .item-details/.item-delete-Regeln mit --target-base.





  const shoppingPage = read('../public/pages/shopping.js');
  assert.match(shoppingPage, /class="row-action"\s+data-action="item-details"/);
  assert.match(shoppingPage, /class="row-action row-action--danger"\s+data-action="delete-item"/);
  assert.match(layout, /\.row-action\s*\{[\s\S]*?width:\s*var\(--target-lg\)/);
  assert.match(layout, /\.row-action\s*\{[\s\S]*?height:\s*var\(--target-lg\)/);
  assert.match(notes, /\.note-card__pin[\s\S]*width:\s*var\(--target-base\)/);
  assert.match(notes, /\.note-card__delete[\s\S]*width:\s*var\(--target-base\)/);
});

test('Tasks toolbar keeps secondary controls visible instead of an overflow slider', () => {
  const tasksPage = read('../public/pages/tasks.js');
  const tasksCss = read('../public/styles/tasks.css');



  // Dokumente (#506) verworfen. Aufgaben nutzt jetzt die geteilte Grammatik:
  // umbrechender Kopf plus sichtbare Filterzeile.
  assert.doesNotMatch(tasksPage, /<details class="tasks-toolbar__secondary"/);
  assert.doesNotMatch(tasksCss, /tasks-toolbar__secondary/);




  assert.match(tasksPage, /class="page-toolbar[^"]*\bpage-toolbar--wrap\b[^"]*\btasks-toolbar\b/);


  assert.match(tasksPage, /<div class="page-toolbar__actions">[\s\S]*id="view-toggle"[\s\S]*id="btn-bulk-select"/);
  assert.match(tasksPage, /<div class="tasks-filters-row">[\s\S]*id="filter-bar"[\s\S]*id="group-mode-toggle"/);
  assert.match(tasksCss, /\.tasks-filters-row\s*\{[\s\S]*display:\s*flex/);


  // der Kanban-Ansicht ausgeblendeten Controls sichtbar.
  assert.match(tasksCss, /\.tasks-filters-row \[hidden\]\s*\{[\s\S]*display:\s*none/);
});

test('Tasks and Notes expose every click target as a real control', () => {
  const tasksPage = read('../public/pages/tasks.js');
  const notesPage = read('../public/pages/notes.js');


  // Kontakte dieselbe .filter-chip-Klasse als <button aria-pressed> rendern.
  assert.match(tasksPage, /function makeChip\(/);
  assert.match(tasksPage, /chip\s*=\s*document\.createElement\('button'\)/);
  assert.doesNotMatch(tasksPage, /className\s*=\s*'filter-chip[^']*';?[\s\S]{0,80}createElement\('span'\)/);



  assert.match(tasksPage, /<button type="button" class="task-card__title/);
  assert.match(tasksPage, /<button type="button" class="subtask-progress"[\s\S]*aria-expanded=/);
  assert.match(tasksPage, /<button type="button" class="kanban-card__title/);


  assert.match(notesPage, /class="note-card__open" data-action="open"/);


  assert.match(tasksPage, /data-view="list"[\s\S]*aria-pressed=/);
  assert.match(tasksPage, /data-mode="category" aria-pressed="true"/);
});

test('showToast is never called with an unsupported variant', () => {
  // showToast kennt nur default | success | warning | danger. 'error' landete

  const files = [
    '../public/router.js',
    '../public/pages/notes.js',
    '../public/pages/tasks.js',
    '../public/pages/budget.js',
    '../public/pages/calendar.js',
    '../public/pages/contacts.js',
    '../public/pages/dashboard.js',
    '../public/pages/meals.js',
    '../public/pages/recipes.js',
    '../public/pages/budget-plans.js',
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /showToast\([^;]*?,\s*'error'\)/s, `${file} uses showToast(..., 'error')`);
  }
});

test('responsive adaptation keeps Notes vertical and prevents intrinsic-width overflow', () => {
  const notes = read('../public/styles/notes.css');
  const dashboard = read('../public/styles/dashboard.css');
  const pageSearch = read('../public/styles/page-search.css');

  // The shared search control guards its own intrinsic-width overflow.
  assert.match(pageSearch, /\.page-search\s*\{[\s\S]*min-width:\s*0/);
  assert.match(notes, /\.notes-toolbar\s+\.page-toolbar__title\s*\{[\s\S]*flex:\s*0\s+0\s+auto/);
  assert.match(notes, /\.notes-grid\s*\{[\s\S]*display:\s*grid/);
  assert.match(notes, /\.notes-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(notes, /\.notes-grid\s*\{[\s\S]*?columns:\s*2/);
  assert.match(
    notes,
    /@container notes-page \(min-width:\s*520px\)[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(
    notes,
    /@container notes-page \(min-width:\s*720px\)[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(
    dashboard,
    /\.notes-grid-widget\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(notes, /\.note-card\s*\{[\s\S]*min-width:\s*0/);
  assert.match(notes, /\.note-card__title\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(
    notes,
    /\.note-card__title,[\s\S]*\.note-card__content\s*\{[\s\S]*unicode-bidi:\s*plaintext/
  );
});

test('dashboard weather widget adapts to selected widget size', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const wrapperRule = cssRuleBody(dashboard, '.widget-wrapper');

  assert.match(wrapperRule, /container:\s*dashboard-widget\s*\/\s*inline-size/);
  assert.match(
    dashboard,
    /@container dashboard-widget \(min-width:\s*480px\)[\s\S]*\.weather-widget__inner\s*\{[\s\S]*flex-direction:\s*row/,
    'weather should switch to horizontal layout from its widget width, not viewport width',
  );
  assert.match(
    dashboard,
    /\.widget-size--1x1\s*>\s*\.weather-widget \.weather-widget__meta,[\s\S]*\.widget-size--1x1\s*>\s*\.weather-widget \.weather-forecast\s*\{[\s\S]*display:\s*none/,
    'tiny weather widgets should not force rich forecast content into the tile',
  );
  assert.match(
    dashboard,
    /\.widget-size--2x1\s*>\s*\.weather-widget \.weather-widget__meta,[\s\S]*\.widget-size--4x1\s*>\s*\.weather-widget \.weather-widget__meta\s*\{[\s\S]*display:\s*none/,
    'one-row weather widgets should use a denser summary',
  );
  assert.doesNotMatch(
    dashboard,
    /@media \(min-width:\s*(?:768|1024|1440)px\)\s*\{\s*\.weather-widget\s*\{/,
    'weather layout must not be driven by viewport breakpoints',
  );
  assert.doesNotMatch(dashboard, /\.weather-widget\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});

test('responsive adaptation keeps all four Kitchen tabs readable on narrow phones', () => {
  const kitchenTabs = read('../public/styles/kitchen-tabs.css');







  assert.match(
    kitchenTabs,
    /@media \(max-width:\s*639px\)[\s\S]*\.kitchen-tabs-bar \.sub-tabs-bar__title\s*\{[\s\S]*display:\s*none/
  );
  assert.doesNotMatch(
    kitchenTabs,
    /@media \(max-width:\s*639px\)[\s\S]*\.kitchen-tabs-bar\s*\{[^}]*padding-inline/,
    'kitchen-tabs-bar darf
  );

  //





  //



  //


  assert.match(
    kitchenTabs,
    /\.kitchen-tabs-bar \.sub-tab\s*\{[^}]*flex:\s*0 0 auto/,
    'die Tabs behalten ihre natürliche Breite - Gleichverteilung kürzt Labels, sobald ein Badge dazukommt',
  );
  assert.doesNotMatch(
    kitchenTabs,
    /\.kitchen-tabs-bar \.sub-tab__label\s*\{[^}]*text-overflow:\s*ellipsis/,
    'ein gekürztes „Mahlz…" kostet mehr Orientierung als ein Tab, für den man wischen muss',
  );

  const subTabs = read('../public/styles/sub-tabs.css');
  assert.match(subTabs, /\.sub-tabs-bar\s*\{[^}]*overflow-x:\s*auto/,
    'ohne overflow-x: auto läuft die Leiste bei natürlicher Breite über statt zu scrollen');
  assert.match(read('../public/utils/sub-tabs.js'), /export function scrollActiveSubTabIntoView/,
    'der aktive Tab muss nachträglich eingescrollt werden können: die Badges kommen asynchron und verbreitern die Leiste');
  assert.match(read('../public/utils/kitchen-tabs.js'), /scrollActiveSubTabIntoView\(_bar\)/,
    'nach dem Setzen der Badges muss der aktive Tab wieder ins Bild geholt werden');
});

test('responsive adaptation uses tablet space without crowding module toolbars', () => {
  const documents = read('../public/styles/documents.css');
  const settings = read('../public/styles/settings.css');




  const documentsPageSrc = read('../public/pages/documents.js');
  assert.match(documentsPageSrc, /class="page-toolbar page-toolbar--wrap documents-toolbar"/);
  assert.match(documentsPageSrc, /<div class="documents-filters">/);
  assert.match(
    documents,
    /\.documents-filter-chips\s*\{[^}]*overflow-x:\s*auto/
  );





  // statt der abgeloesten Zweispaltigkeit.
  assert.match(
    settings,
    /\.settings-mobile-overview__links\s*\{[^}]*background:\s*var\(--color-surface-work\)[^}]*overflow:\s*hidden/
  );
  assert.doesNotMatch(
    settings,
    /\.settings-mobile-overview__links\s*\{[^}]*grid-template-columns/
  );
});

test('Birthday page exposes a single creation action (FAB), no duplicate toolbar button', () => {
  const birthdays = read('../public/pages/birthdays.js');

  assert.match(birthdays, /class="page-fab" id="fab-new-birthday"/);
  assert.doesNotMatch(birthdays, /toolbar-new-btn/);
});

test('dashboard polish keeps one page heading and native quick-action controls', () => {
  const dashboard = read('../public/pages/dashboard.js');
  const css = read('../public/styles/dashboard.css');

  assert.equal((dashboard.match(/<h1\b/g) || []).length, 1, 'dashboard must expose one h1');
  assert.match(dashboard, /<h2 class="dashboard-overview__title(?: dashboard-overview__title--\$\{greetingPeriod\(\)\})?"/);
  assert.match(dashboard, /<button type="button" class="fab-action"/);
  assert.doesNotMatch(dashboard, /class="fab-action"[^>]*role="button"/);
  assert.doesNotMatch(dashboard, /<button class="fab-action__btn"/);
  assert.match(css, /\.dashboard-icon-btn\s*\{[\s\S]*width:\s*var\(--target-lg\);[\s\S]*height:\s*var\(--target-lg\)/);




  assert.doesNotMatch(
    css,
    /@media \(max-width:\s*639px\)[\s\S]*?\.dashboard-icon-btn\s*\{[^{}]*width:\s*var\(--target-base\)[^{}]*height:\s*var\(--target-base\)/,
    'mobile dashboard controls must keep the large touch target through the final cascade'
  );
  assert.match(
    css,
    /@media \(min-width:\s*1024px\)[\s\S]*\.dashboard-icon-btn\s*\{[\s\S]*width:\s*var\(--target-md\);[\s\S]*height:\s*var\(--target-md\)/,
  );
});

test('dashboard today cockpit keeps content visibly below its section heading', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const typography = read('../public/styles/typography.css');
  const valueRule = cssRuleBody(dashboard, '.today-cockpit-card__value');

  assert.match(
    typography,
    /\.today-cockpit__header h2,[\s\S]*?font-size:\s*var\(--type-section-title\)/,
    'Heute wichtig must keep the section-title role',
  );



  assert.match(
    valueRule,
    /font-size:\s*var\(--type-card-title\)/,
    'cockpit value must carry the 16px card-title role, still below the 18px section heading',
  );
});

test('polished rounded cards use subtle full borders instead of thick accent caps', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const housekeeping = read('../public/styles/housekeeping.css');

  const overview = dashboard.match(/\.dashboard-overview\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  const cockpit = dashboard.match(/\.today-cockpit\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  const housekeepingCard = housekeeping.match(/\.housekeeping-card\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

  assert.doesNotMatch(overview, /border-top:\s*(?:3px|var\(--space-1\))/);
  assert.doesNotMatch(cockpit, /border-top:\s*(?:3px|var\(--space-1\))/);





  const widgetBase = dashboard.match(/\n\.widget\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(widgetBase, '.widget muss eine Basisregel haben');
  assert.doesNotMatch(widgetBase, /border-top:\s*(?:[2-9]px|var\(--space-[1-9])/);
  assert.doesNotMatch(dashboard, /\.widget::before/);
  assert.doesNotMatch(housekeepingCard, /border-top:\s*3px/);
});

test('hardening keeps Birthday rows on one line with extreme localized content', () => {
  const birthdays = read('../public/styles/birthdays.css');

  for (const part of ['__name', '__meta', '__notes']) {
    const body = cssRuleBody(birthdays, `.birthday-item${part}`);
    assert.ok(body, `.birthday-item${part} muss eine Regel haben`);
    assert.match(body, /overflow:\s*hidden/,
      `.birthday-item${part} muss ueberlaufenden Inhalt kappen statt die Zeile zu dehnen`);
    assert.doesNotMatch(body, /overflow-wrap:\s*anywhere/,
      `.birthday-item${part} darf nicht wieder umbrechen - das war der Hoehentreiber`);
  }


  for (const part of ['__name', '__meta', '__notes']) {
    assert.match(cssRuleBody(birthdays, `.birthday-item${part}`), /unicode-bidi:\s*plaintext/);
  }

  assert.match(cssRuleBody(birthdays, '.birthday-item__name'), /white-space:\s*nowrap/);

  assert.match(birthdays, /@container birthdays-list \(min-width:[^)]+\)\s*\{\s*\.birthday-item__notes/,
    'die Notiz erscheint ueber einen Container-Query am Traeger, nicht ueber einen Viewport-Breakpoint');




  // dass der eigene Container-Name daneben ausdruecklich stehen bleibt.
  assert.match(read('../public/pages/birthdays.js'), /class="row-carrier birthdays-list"/,
    'die Liste traegt den geteilten Traeger, statt ihn nachzubauen');
  assert.match(cssRuleBody(read('../public/styles/list-row.css'), '.row-carrier'), /container-type:\s*inline-size/,
    'ohne Container am Traeger fragt der Query ins Leere und die Notiz bliebe fuer immer aus');
  assert.match(cssRuleBody(birthdays, '.birthdays-list'), /container-name:\s*birthdays-list list-rows/,
    'beide Namen ausdruecklich - sonst gewinnt der spaeter geladene und der andere ist lautlos tot');
});

test('hardening uses logical alignment for RTL-sensitive adapted controls', () => {
  const notes = read('../public/styles/notes.css');
  const tasks = read('../public/styles/tasks.css');
  const pageSearch = read('../public/styles/page-search.css');

  assert.match(notes, /margin-inline-start:\s*auto/);
  // The shared search control's leading icon uses logical inset for RTL.
  assert.match(pageSearch, /\.page-search__icon\s*\{[\s\S]*inset-inline-start:/);
  assert.match(notes, /\.note-card__pin\s*\{[\s\S]*inset-inline-end:/);



  assert.match(tasks, /\.tasks-filters__end\s*\{[\s\S]*margin-inline-start:\s*auto/);
  assert.doesNotMatch(tasks, /margin-(left|right):\s*auto/);
});

test('route failures expose a localized recoverable alert instead of raw technical errors', () => {
  const router = read('../public/router.js');
  const notesPage = read('../public/pages/notes.js');




  // haelt der Renderer-Guard weiter oben fest.
  assert.match(router, /function renderError\(container,\s*err\)[\s\S]*emptyStateEl\(\{[\s\S]{0,200}?variant:\s*'error'/);
  assert.match(router, /function renderError\(container,\s*err\)[\s\S]*description:\s*friendlyError\(err\)/);
  assert.match(router, /state\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.match(router, /Failed to fetch\|NetworkError\|Load failed/i);
  assert.match(router, /return t\(['"]common\.errorServer['"]\)/);
  assert.match(router, /err\?\.name === ['"]TypeError['"][\s\S]*return t\(['"]common\.unexpectedError['"]\)/);
  assert.match(notesPage, /catch \(err\)\s*\{[\s\S]*console\.error\([\s\S]*throw err;/);
});

test('Notes keeps user colours off the reading surface', () => {
  const notesPage = read('../public/pages/notes.js');
  const notesCss = read('../public/styles/notes.css');





  // gemischt (--tint-surface, tokens.css 6b) - damit

  // Alt-Hex-Werten ausserhalb der Palette (DESIGN.md, User-Farben-Regel).
  assert.doesNotMatch(notesPage, /function isLightColor/);
  assert.doesNotMatch(notesPage, /getReadableTextColor/,
    'Eine zur Laufzeit gerechnete Textfarbe waere wieder eine ungemessene Paarung.');
  assert.match(notesPage, /style="--note-color:\$\{esc\(note\.color\)\};"/,
    'Die Zettelfarbe reist als CSS-Variable, nicht als background-color.');
  assert.match(notesPage, /style="--avatar-color:\$\{esc\(avatarColor\)\};"/);

  const cardRule = notesCss.match(/\n\.note-card\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(cardRule, /background:\s*color-mix\(in srgb, var\(--note-color[^)]*\) var\(--tint-surface\), var\(--color-surface\)\)/);
  assert.match(cardRule, /color:\s*var\(--color-text-primary\)/);
  assert.match(cardRule, /border:\s*none/, 'Karten sind randlos auf dem Grouped-Grund.');

  assert.doesNotMatch(
    notesCss.match(/\.note-card__content\s*\{[\s\S]*?\n\}/)?.[0] ?? '',
    /opacity:/,
  );
});

test('phase 3 Tasks bulk actions stay de-emphasized until tasks are selected', () => {
  const tasksPage = read('../public/pages/tasks.js');
  const tasksCss = read('../public/styles/tasks.css');

  assert.match(tasksPage, /bar\.hidden\s*=\s*!\(state\.bulkSelectMode && selected > 0\)/);
  assert.match(tasksPage, /bar\.classList\.toggle\('bulk-actions-bar--active',\s*selected > 0\)/);
  assert.match(tasksPage, /toggleBtn\.setAttribute\('aria-pressed',\s*String\(state\.bulkSelectMode\)\)/);
  assert.match(tasksCss, /\.bulk-actions-bar\[hidden\]\s*\{[\s\S]*display:\s*none/);
  assert.match(tasksCss, /\.bulk-actions-bar--active\s*\{/);
});

test('phase 3 mobile Shopping quick-add separates name, quantity, category, and add controls', () => {
  const shoppingPage = read('../public/pages/shopping.js');
  const shoppingCss = read('../public/styles/shopping.css');

  assert.match(shoppingPage, /<div class="quick-add__input-wrap">[\s\S]*id="item-name-input"[\s\S]*id="autocomplete-dropdown" hidden[\s\S]*<\/div>\s*<input class="quick-add__qty"/);
  assert.match(
    shoppingCss,
    /\.quick-add__form\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)\s*var\(--target-base\)/
  );
  assert.match(shoppingCss, /\.quick-add__input-wrap\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(shoppingCss, /\.quick-add__qty\s*\{[\s\S]*position:\s*static[\s\S]*min-height:\s*var\(--target-base\)/);
  assert.match(shoppingCss, /\.quick-add__cat\s*\{[\s\S]*min-width:\s*0[\s\S]*min-height:\s*var\(--target-base\)/);
});

test('phase 6 touched UI files continue using design tokens for target sizes', () => {
  const tasks = read('../public/styles/tasks.css');
  const shopping = read('../public/styles/shopping.css');
  const notes = read('../public/styles/notes.css');


  // .contact-action-btn/.birthday-action-btn/.budget-entry__action).
  const layout = read('../public/styles/layout.css');
  const targetRules = [
    ['../public/styles/tasks.css', tasks, '.task-status-btn'],
    ['../public/styles/shopping.css', shopping, '.quick-add__btn'],
    ['../public/styles/shopping.css', shopping, '.item-check'],
    ['../public/styles/notes.css', notes, '.note-card__pin'],
    ['../public/styles/notes.css', notes, '.note-card__delete'],
    ['../public/styles/layout.css', layout, '.row-action'],
  ];

  for (const [file, source, selector] of targetRules) {
    const body = cssRuleBody(source, selector);
    assert.doesNotMatch(
      body,
      /\b(?:min-)?(?:height|width):\s*(?:[1-9]|[1-3]\d|4[0-3])px\b/,
      `${file} ${selector} should not use sub-44px hardcoded target sizes`
    );
  }

  for (const property of ['width', 'height']) {
    assertRuleUsesToken(tasks, '.task-status-btn', property, '--target-base', '../public/styles/tasks.css');
    assertRuleUsesToken(shopping, '.quick-add__btn', property, '--target-base', '../public/styles/shopping.css');
    assertRuleUsesToken(shopping, '.item-check', property, '--target-base', '../public/styles/shopping.css');
    assertRuleUsesToken(notes, '.note-card__pin', property, '--target-base', '../public/styles/notes.css');
    assertRuleUsesToken(notes, '.note-card__delete', property, '--target-base', '../public/styles/notes.css');
    assertRuleUsesToken(layout, '.row-action', property, '--target-lg', '../public/styles/layout.css');
  }

  assertRuleUsesToken(layout, '.row-action', 'min-height', '--target-lg', '../public/styles/layout.css');
  assertRuleUsesToken(layout, '.row-action', 'min-width', '--target-lg', '../public/styles/layout.css');
});

test('phase 4 keeps Kitchen navigation identity stable', () => {
  const routerSource = read('../public/router.js');

  assert.match(routerSource, /t\('nav\.kitchen'\)/);
  assert.match(routerSource, /t\('nav\.kitchenActiveLabel',\s*\{\s*section/);
  assert.doesNotMatch(routerSource, /kitchenBtnLabel\.textContent\s*=\s*kitchenTarget\.label/);
  assert.doesNotMatch(routerSource, /kitchenBtnIcon\)\s*kitchenBtnIcon\.dataset\.lucide\s*=\s*kitchenTarget\.icon/);
  assert.doesNotMatch(routerSource, /sidebarLabel\)\s*sidebarLabel\.textContent\s*=\s*kitchenTarget\.label/);
  assert.doesNotMatch(routerSource, /sidebarIcon\)\s*sidebarIcon\.dataset\.lucide\s*=\s*kitchenTarget\.icon/);
});

test('global navigation groups domains with translated section labels', () => {
  const routerSource = read('../public/router.js');

  // The grouped main-app navigation references every section label key and
  // resolves section labels through t().
  assert.match(routerSource, /'nav\.sectionOverview'/);
  assert.match(routerSource, /'nav\.sectionPlan'/);
  assert.match(routerSource, /'nav\.sectionHousehold'/);
  assert.match(routerSource, /'nav\.sectionPeople'/);
  assert.match(routerSource, /'nav\.sectionFinance'/);
  assert.match(routerSource, /'nav\.sectionCustomModules'/);
  assert.match(routerSource, /t\(labelKey\)/);

  // The replaced household section label is no longer referenced.
  assert.doesNotMatch(routerSource, /nav\.section\.household/);
});

test('global navigation derives exactly one Kitchen destination', () => {
  const routerSource = read('../public/router.js');

  // Kitchen is inserted once via sidebarKitchenEl(), gated by a single-shot flag.
  // It is appended into the current section group via appendNavEl().
  assert.equal((routerSource.match(/appendNavEl\(sidebarKitchenEl\(\)\)/g) ?? []).length, 1);
  assert.match(routerSource, /if \(!kitchenAdded\)/);
});

test('navigation settings leaf reuses the canonical module-order helpers', () => {
  const leaf = read('../public/settings/pages/modules-navigation.js');

  assert.match(leaf, /import\s*\{[^}]*normalizeModuleOrder[^}]*\}\s*from\s*'\/settings\/module-order\.js'/s);
  assert.match(leaf, /import\s*\{[^}]*expandModuleOrder[^}]*\}\s*from\s*'\/settings\/module-order\.js'/s);
});

test('phase 4 keeps More bottom-nav identity stable while exposing active section accessibly', () => {
  const routerSource = read('../public/router.js');

  assert.match(routerSource, /t\('nav\.moreActiveLabel',\s*\{\s*section:\s*activeSecondary\.label\s*\}\)/);
  assert.match(routerSource, /moreBtnLabel\.textContent\s*=\s*t\('nav\.more'\)/);
  assert.match(routerSource, /replaceNavIcon\(moreBtn,\s*'\.nav-item__icon',\s*'more-horizontal'\)/);
  assert.doesNotMatch(routerSource, /const\s+moreIcon\s*=\s*activeSecondary\s*\?\s*activeSecondary\.icon/);
  assert.doesNotMatch(routerSource, /moreBtnLabel\.textContent\s*=\s*moreLabel/);




  const navIcons = read('../public/nav-icons.js');
  assert.match(navIcons, /'more-horizontal':\s*\[/);
  assert.match(routerSource, /moduleIconEl\('more-horizontal',\s*'nav-item__icon'\)/);
  assert.doesNotMatch(routerSource, /grid-2x2/);
});

test('phase 4 locales include More active accessible label', () => {
  const localesDir = new URL('../public/locales/', import.meta.url);
  const files = readdirSync(localesDir).filter((f) => f.endsWith('.json'));

  assert.ok(files.length >= 16, 'expected at least 16 locale files');
  for (const file of files) {
    const data = JSON.parse(readFileSync(new URL(file, localesDir), 'utf8'));
    assert.equal(typeof data.nav?.moreActiveLabel, 'string', `${file}: nav.moreActiveLabel must be a string`);
    assert.match(data.nav.moreActiveLabel, /\{\{section\}\}/, `${file}: nav.moreActiveLabel must include {{section}}`);
  }
});

test('phase 4 touched icon markup uses icon classes instead of inline icon sizing', () => {
  const files = [
    '../public/router.js',
    '../public/pages/settings.js',
    '../public/pages/meals.js',
    '../public/pages/recipes.js',
    '../public/pages/shopping.js',
  ];

  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /<i\s+[^>]*data-lucide=[^>]*style=["'][^"']*(?:width|height):/s, `${file} must not inline-size Lucide placeholders`);
    assert.doesNotMatch(source, /\.style\.cssText\s*=\s*['"][^'"]*(?:width|height):/, `${file} must not assign inline icon dimensions`);
  }
});

test('phase 4 settings theme toggle uses Lucide placeholders instead of inline SVG icons', () => {
  const settings = read('../public/settings/pages/personal-appearance.js');

  assert.doesNotMatch(settings, /<svg\s+width="18"\s+height="18"[\s\S]*?data-theme-value=/);
  assert.match(settings, /data-lucide="monitor"/);
  assert.match(settings, /data-lucide="sun"/);
  assert.match(settings, /data-lucide="moon"/);
});

test('phase 4 opens search from More sheet in a single handoff', () => {
  const routerSource = read('../public/router.js');

  assert.match(routerSource, /closeSheet\(\{\s*restoreFocus:\s*false\s*\}\)/);
  assert.match(routerSource, /requestAnimationFrame\(\(\) => \{\s*openSearch\(\);/);
});

test('settings cutover: the controller is a thin shell delegate without the legacy monolith', () => {
  const settingsPage = read('../public/pages/settings.js');

  assert.match(settingsPage, /renderSettingsShell/, 'controller must delegate rendering to the shell');
  assert.match(settingsPage, /readStoredSettingsDestination/, 'controller must read & migrate stored settings state');
  assert.doesNotMatch(settingsPage, /settings-tab-panel/, 'controller must not render legacy tab panels');
  assert.doesNotMatch(settingsPage, /data-panel=/, 'controller must not render legacy data-panel attributes');
  assert.doesNotMatch(settingsPage, /settings-nav\.js/, 'controller must not import the removed settings-nav helpers');
  assert.doesNotMatch(settingsPage, /extraClass:\s*'settings-tabs'/, 'controller must not render the legacy sub-tab bar');

  const lineCount = settingsPage.split('\n').length;
  assert.ok(lineCount <= 170, `settings controller should be a thin shell (was ${lineCount} lines)`);
});

test('settings cutover: obsolete navigation modules and stylesheet are removed', () => {
  assert.equal(existsSync(new URL('../public/utils/settings-nav.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../public/styles/settings-nav.css', import.meta.url)), false);
});

test('settings cutover: no obsolete settings-tab / panel references remain in public', () => {
  const offenders = [];
  for (const file of walkFrontendFiles('../public/')) {
    const source = read(file);
    if (/settings-nav\b|settings-tabs\b|settings-tab-panel\b|data-panel=|renderSettingsSidebar\b/.test(source)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `obsolete settings navigation references remain: ${offenders.join(', ')}`);
});

test('settings cutover: the access-redirected notice is consumed once on the account leaf', () => {
  const account = read('../public/settings/pages/personal-account.js');

  assert.match(account, /aashiyana:settings:notice/, 'account leaf must read the one-time redirect notice');
  assert.match(account, /accessRedirected/, 'account leaf must surface the access-redirected message');
  assert.match(account, /removeItem\(/, 'account leaf must consume the notice once');
});

test('jede Route erklärt ihren Dokumenttitel, und jeder erklärte Key existiert in de.json', () => {
  const router = read('../public/router.js');



  const entries = [...router.matchAll(/\{\s*path:\s*'([^']+)'\s*,\s*page:\s*'[^']+'\s*,\s*requiresAuth:\s*\w+\s*,\s*module:\s*(?:null|'[^']*')\s*,?([^}]*)\}/g)]
    .map((m) => ({ path: m[1], rest: m[2] }));

  assert.ok(entries.length >= 19,
    `Aus ROUTES kamen nur ${entries.length} Einträge - der Guard misst dann nichts. `
    + 'Hat sich die Schreibweise der Routen-Einträge geändert?');

  const untitled = entries.filter(({ rest }) => !/titleKey:/.test(rest)).map(({ path }) => path);
  assert.deepEqual(untitled, [],
    `Routen ohne titleKey: ${untitled.join(', ')}. Eine Route ohne Titel muss auffallen, `
    + 'nicht still auf den App-Namen fallen (WCAG 2.4.2, Level A). `titleKey: null` ist die '
    + 'erklärte Ausnahme für Anmelden/Ersteinrichtung.');



  for (const path of ['/forgot-password', '/reset-password', '/join']) {
    const entry = entries.find((e) => e.path === path);
    assert.ok(entry && /titleKey:\s*'[^']+'/.test(entry.rest),
      `${path} braucht einen eigenen Titel - es ist ein Weg in die App, kein Zwischenschritt`);
  }


  assert.match(router, /SETTINGS_LEAVES\.map\([\s\S]{0,200}?titleKey:\s*'nav\.settings'/,
    'jedes Settings-Blatt braucht den Sektionstitel');
  assert.match(router, /HEALTH_ROUTES\.map\([\s\S]*?titleKey:\s*'nav\.health'/,
    'jede Health-Route braucht den Sektionstitel');



  const de = JSON.parse(read('../public/locales/de.json'));
  const lookup = (key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), de);
  const missing = [...router.matchAll(/titleKey:\s*'([^']+)'/g)]
    .map((m) => m[1])
    .filter((key) => typeof lookup(key) !== 'string');
  assert.deepEqual([...new Set(missing)], [],
    `titleKey ohne Eintrag in de.json: ${missing.join(', ')}`);


  assert.match(router, /ROUTES\.find\(\(route\) => route\.path === path\)\?\.titleKey/,
    'routeTitle muss ROUTES lesen');
  assert.doesNotMatch(router, /const map = \{\s*\n\s*'\/':\s*t\(/,
    'die abgelöste Titel-Map darf nicht zurückkommen');
});

test('settings cutover: route direction treats settings sub-paths as one section', () => {
  const routerSource = read('../public/router.js');

  assert.match(
    routerSource,
    /startsWith\('\/settings'\)/,
    'router must normalise /settings sub-paths for title and direction handling',
  );
});

test('phase 6 shared sub-tabs support keyboard tab navigation', () => {
  const source = read('../public/utils/sub-tabs.js');

  assert.match(source, /bar\.addEventListener\('keydown'/);
  assert.match(source, /e\.key === 'ArrowRight'/);
  assert.match(source, /e\.key === 'ArrowLeft'/);
  assert.match(source, /e\.key === 'Home'/);
  assert.match(source, /e\.key === 'End'/);
  assert.match(source, /\.focus\(\)/);
});

// --------------------------------------------------------
// Liquid-Glass-Migration: Regressions-Guards (UX-Audit)
// --------------------------------------------------------

test('calendar week-view time labels use a readable text token, not the disabled token', () => {
  const calendar = read('../public/styles/calendar.css');
  const body = cssRuleBody(calendar, '.week-view__time-label');

  assert.match(body, /color:\s*var\(--color-text-tertiary\)/, 'time labels must use --color-text-tertiary for WCAG AA contrast');
  assert.doesNotMatch(body, /color:\s*var\(--color-text-disabled\)/, 'time labels must not reuse the disabled token (insufficient contrast)');
});

test('calendar month view uses tinted event surfaces derived from --ev-color', () => {
  const calendar = read('../public/styles/calendar.css');
  const gridBody = cssRuleBody(calendar, '.month-grid');
  const dayBody = cssRuleBody(calendar, '.month-day');


  const eventBody = cssRuleBody(calendar, '\n.month-day__event');
  const outsideEventBody = cssRuleBody(calendar, '.month-day--outside .month-day__event');
  const outsideDayBody = cssRuleBody(calendar, '\n.month-day--outside');

  assert.match(gridBody, /background-color:\s*var\(--color-border-subtle\)/, 'month grid should expose clear cell boundaries');
  assert.match(gridBody, /gap:\s*var\(--space-px\)/, 'month grid boundaries should use tokenized one-pixel gaps');
  assert.match(dayBody, /background-color:\s*var\(--color-surface-work\)/, 'month cells should use a stable work surface');



  assert.match(eventBody, /background:\s*color-mix\(in srgb,\s*var\(--ev-color\)\s*var\(--tint-surface\),\s*var\(--color-surface-work\)\)/, 'event chips should sit on a tinted work surface, not a saturated fill');




  // benennt.
  assert.match(eventBody, /color:\s*color-mix\(in srgb,\s*var\(--ev-color\)\s*\d+%,\s*var\(--color-text-primary\)\)/, 'event chip text should be a readable ink derived from the event colour');




  assert.doesNotMatch(eventBody, /border:/, 'month bars read flat: the cell gap carries the boundary, not a per-bar border');
  assert.doesNotMatch(eventBody, /box-shadow/, 'tinted event chips should read flat, without a drop shadow');



  assert.match(outsideDayBody, /background-color:\s*var\(--color-bg\)/, 'previous/next month cells dim via their surface, not via text opacity');
  assert.doesNotMatch(outsideDayBody, /opacity:/, 'a blanket opacity on the cell would drag its text below AA');




  assert.match(outsideEventBody, /background:\s*color-mix\(in srgb,\s*var\(--ev-color\)\s*var\(--tint-wash\),\s*var\(--color-surface-work\)\)/, 'outside-month bars keep the tint recipe, only weaker');
});

test('calendar agenda events and task chips keep readable contrast in mobile agenda', () => {
  const calendar = read('../public/styles/calendar.css');
  const eventBody = cssRuleBody(calendar, '.agenda-event');
  const colorBody = cssRuleBody(calendar, '.agenda-event__color');
  const taskBody = cssRuleBody(calendar, '.cal-task-chip');
  const metaBody = cssRuleBody(calendar, '.agenda-event__meta');






  // eine Ebene hoeher eingeloest.
  assert.doesNotMatch(eventBody, /background(-color)?:/, 'the agenda row is a row: its surface belongs to the carrier');
  assert.doesNotMatch(eventBody, /border:|box-shadow:/, 'the agenda row is a row: no own edge, no own shadow');
  assert.match(read('../public/pages/calendar.js'), /<div class="list-rows">\$\{events/,
    'agenda events must sit in exactly one carrier (.list-rows), which carries surface and hairlines');


  assert.match(colorBody, /width:\s*var\(--space-2\)/, 'agenda color dot should use a spacing token for its width');
  assert.match(colorBody, /height:\s*var\(--space-2\)/, 'agenda color dot should be a fixed-size dot, not a full-height rail');
  assert.match(colorBody, /border-radius:\s*var\(--radius-full\)/, 'agenda color dot should be round');




  // Aufgaben-Bars standen.

  //






  //


  // list-row.css fuer die Aufgabenliste traegt.
  assert.match(taskBody, /background:\s*var\(--color-fill-well\)/, 'task chips carry a neutral surface: the step is the dot, not the fill');
  assert.doesNotMatch(taskBody, /color-mix\(in srgb,\s*currentColor/, 'task chips must not tint from their priority colour: that is the retracted fassung of the scale rule');
  assert.match(read('../public/pages/calendar.js'), /class="priority-dot priority-dot--\$\{priority\}"/,
    'a task chip must render the shared priority dot (list-row.css), not a second fassung of the scale');
  assert.doesNotMatch(taskBody, /border(-color)?:|box-shadow:/, 'task chips read flat: the dot is the second channel, not an edge on top of it');
  assert.match(metaBody, /color:\s*var\(--color-text-secondary\)/, 'metadata should remain legible in light and dark themes');
});

test('calendar metadata uses lucide icon markup instead of visible emoji', () => {
  const source = read('../public/pages/calendar.js');

  assert.doesNotMatch(source, /📍|🗓|📅|🎂|👤/, 'calendar metadata must not render visible emoji icons');
  assert.match(source, /calendarMetaIconHtml\('map-pin'\)/, 'location metadata should use the shared metadata icon helper');
  assert.match(source, /class="calendar-meta-icon icon-sm"/, 'metadata icons should use tokenized icon classes');
});

test('desktop Meals and Calendar date-navigation icons use the accent color', () => {
  const meals = read('../public/styles/meals.css');
  const calendar = read('../public/styles/calendar.css');








  assert.match(cssRuleBody(meals, '.week-nav .btn--icon'), /color:\s*var\(--color-accent\)/);
  assert.match(cssRuleBody(calendar, '.cal-toolbar__nav .btn--icon'), /color:\s*var\(--color-accent\)/);
});

test('calendar attachment removal control honors its hidden state', () => {
  const calendarCss = read('../public/styles/calendar.css');
  assert.match(
    calendarCss,
    /#modal-remove-attachment\[hidden\]\s*\{\s*display:\s*none;/,
    'the remove-attachment button must stay hidden for events without an attachment'
  );
});

test('phase 7 calendar inline polish keeps icons and all-day labels tokenized', () => {
  const source = read('../public/pages/calendar.js');
  const calendar = read('../public/styles/calendar.css');
  const allDayLabel = cssRuleBody(calendar, '.calendar-all-day-label');

  assert.doesNotMatch(source, /data-lucide="(?:x|plus|trash-2|repeat)"\s+style=/, 'Lucide icons should use icon utility classes, not inline sizing');
  assert.doesNotMatch(source, /font-size:10px|color:var\(--color-text-disabled\)/, 'all-day labels should not keep low-contrast inline text styles');
  assert.match(source, /calendarRepeatIconHtml\(ev\)/, 'recurrence markers should share the tokenized repeat icon helper');
  assert.match(source, /class="calendar-all-day-label"/, 'all-day gutter labels should use the shared label class');
  assert.match(allDayLabel, /font-size:\s*var\(--text-xs\)/, 'all-day labels should use a text token');
  assert.match(allDayLabel, /color:\s*var\(--color-text-secondary\)/, 'all-day labels should use readable secondary text');

  //





  //

  // selbst fuehrt. Welche Zahl dahintersteht, entscheidet tokens.css.
  assert.match(allDayLabel, /width:\s*var\(--cal-gutter-width\)/,
    'all-day gutter width should come from the same token as the hour column, not a second spacing value');
});

test('phase 7 Budget row actions stay touch-safe on mobile', () => {
  const source = read('../public/pages/budget.js');
  const layout = read('../public/styles/layout.css');



  const actionRule = cssRuleBody(layout, '.row-action');

  assert.match(actionRule, /width:\s*var\(--target-lg\)/, 'Row action buttons should use the large touch target width');
  assert.match(actionRule, /height:\s*var\(--target-lg\)/, 'Row action buttons should use the large touch target height');
  assert.doesNotMatch(actionRule, /opacity:\s*0/, 'Row actions stay visible without hover (touch-safe)');
  assert.match(source, /class="row-action row-action--danger"/, 'Budget delete uses the shared danger row action');
  assert.doesNotMatch(source, /data-lucide="(?:plus|trash-2|pencil)"\s+style=/, 'Budget Lucide actions should use icon utility classes');
});

test('sticky section headers stack above glass cards via --z-sticky', () => {
  const stickyHeaders = [
    ['../public/styles/meals.css', '.day-header'],
    ['../public/styles/calendar.css', '.agenda-day__header'],
    ['../public/styles/contacts.css', '.contact-group__header'],
  ];

  for (const [file, selector] of stickyHeaders) {
    const body = cssRuleBody(read(file), selector);
    assert.match(body, /position:\s*sticky/, `${file} ${selector} should be sticky`);
    assert.match(body, /z-index:\s*var\(--z-sticky\)/, `${file} ${selector} must use --z-sticky so glass cards do not scroll over it`);
  }
});

test('every locale resolves the grouped navigation section labels', () => {
  const localesDir = new URL('../public/locales/', import.meta.url);
  const files = readdirSync(localesDir).filter((f) => f.endsWith('.json'));
  const sectionKeys = ['sectionOverview', 'sectionPlan', 'sectionHousehold', 'sectionPeople', 'sectionFinance', 'sectionCustomModules'];

  assert.ok(files.length >= 16, 'expected at least 16 locale files');
  for (const file of files) {
    const data = JSON.parse(readFileSync(new URL(file, localesDir), 'utf8'));
    for (const key of sectionKeys) {
      assert.equal(typeof data.nav?.[key], 'string', `${file}: nav.${key} must be a string`);
      assert.ok(data.nav[key].length > 0, `${file}: nav.${key} must not be empty`);
    }
    assert.ok(!('section.household' in data.nav), `${file}: nav must not keep the flat "section.household" key (t() cannot resolve it)`);
  }
});

test('Brazilian Portuguese uses localized Help navigation copy', () => {
  const data = JSON.parse(read('../public/locales/pt.json'));

  assert.equal(data.nav?.help, 'Ajuda');
  assert.equal(data.help?.title, 'Ajuda');
  assert.doesNotMatch(JSON.stringify({ nav: data.nav, help: data.help }), /Hilfe/);
});

test('phase 7 locale files keep the de reference key set complete', () => {
  const reference = JSON.parse(readFileSync(new URL('de.json', LOCALE_DIR), 'utf8'));
  const referenceKeys = new Set(flattenLocaleKeys(reference));

  assert.ok(referenceKeys.size > 0, 'de locale should expose reference keys');
  for (const file of LOCALES) {
    const data = JSON.parse(readFileSync(new URL(file, LOCALE_DIR), 'utf8'));
    const keys = new Set(flattenLocaleKeys(data));
    const missing = [...referenceKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !referenceKeys.has(key));

    assert.deepEqual(missing, [], `${file} is missing locale keys`);
    assert.deepEqual(extra, [], `${file} has extra locale keys`);
  }
});

test('dark-mode token blocks stay in sync between @media and [data-theme="dark"]', () => {
  const tokens = read('../public/styles/tokens.css');

  const mediaBlock = darkSchemeBlock(tokens);
  const attrBlock = darkAttrBlock(tokens);

  assert.ok(mediaBlock, 'expected a prefers-color-scheme dark block');
  assert.ok(attrBlock, 'expected a [data-theme="dark"] block');

  const parseVars = (block) => {
    const map = new Map();
    for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      map.set(name, value.trim());
    }
    return map;
  };

  const media = parseVars(mediaBlock[1]);
  const attr = parseVars(attrBlock[1]);

  assert.ok(media.size > 0 && attr.size > 0, 'both dark blocks must declare variables');
  const allKeys = new Set([...media.keys(), ...attr.keys()]);
  const divergent = [...allKeys].filter((k) => media.get(k) !== attr.get(k));
  assert.deepEqual(divergent, [], `dark token blocks diverge for: ${divergent.join(', ')}`);
});

test('phase 1 defines synchronized surface roles for readable work areas', () => {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const mediaBlock = darkSchemeBlock(tokens);
  const attrBlock = darkAttrBlock(tokens);

  assert.ok(rootBlock, 'expected a :root token block');
  assert.ok(mediaBlock, 'expected a prefers-color-scheme dark block');
  assert.ok(attrBlock, 'expected a [data-theme="dark"] block');

  const root = parseTokenMap(rootBlock[1]);
  const media = parseTokenMap(mediaBlock[1]);
  const attr = parseTokenMap(attrBlock[1]);
  const publicSurfaceTokens = [
    '--color-surface-work',
    '--color-surface-raised',
    '--app-backdrop-accent-strength',
    '--app-backdrop-secondary-strength',
  ];



  const privateSurfaceTokens = [
    '--_color-surface-work',
    '--_color-surface-raised',
    '--_color-surface-glass',
    '--_app-backdrop-accent-strength',
    '--_app-backdrop-secondary-strength',
  ];

  for (const token of publicSurfaceTokens) {
    assert.ok(root.has(token), `${token} should be available as a public design token`);
    assert.match(root.get(token), /var\(--_/, `${token} should point at a private theme value`);
  }

  for (const token of privateSurfaceTokens) {
    assert.ok(root.has(token), `${token} should have a light-mode value`);
    assert.ok(media.has(token), `${token} should have a system dark-mode override`);
    assert.ok(attr.has(token), `${token} should have an explicit dark-mode override`);
    assert.equal(media.get(token), attr.get(token), `${token} dark values must stay synchronized`);
  }
});

test('phase 1 keeps productive list surfaces opaque instead of high-transparency glass', () => {
  const glass = read('../public/styles/glass.css');
  const productiveRules = [
    ['.tasks-page .task-card', '--color-surface-work'],
    ['.tasks-page .task-card:hover', '--color-surface-raised'],
    ['.shopping-page .shopping-item:hover', '--color-surface-raised'],
    ['.contacts-page .contact-item:hover', '--color-surface-raised'],
  ];

  for (const [selector, token] of productiveRules) {
    const body = cssRuleBody(glass, selector);
    assert.match(body, new RegExp(`var\\(${token}\\)`), `${selector} should use ${token}`);
    assert.doesNotMatch(body, /var\(--glass-bg-card(?:-hover)?\)/, `${selector} should not use translucent card glass`);
    assert.doesNotMatch(body, /backdrop-filter/, `${selector} should not add blur inside productive lists`);
  }
});

test('phase 1 app backdrop uses subtle tokenized tint and opaque scroll content', () => {
  const glass = read('../public/styles/glass.css');
  const layout = read('../public/styles/layout.css');
  const shellRule = cssRuleBody(glass, '.app-shell');
  const glassContentRule = cssRuleBody(glass, '.app-content');
  const layoutContentRule = cssRuleBody(layout, '.app-content');

  assert.match(shellRule, /var\(--app-backdrop-accent-strength\)/, 'app-shell tint strength should be tokenized');
  assert.match(shellRule, /var\(--app-backdrop-secondary-strength\)/, 'secondary backdrop tint should be tokenized');
  assert.match(glassContentRule, /background-color:\s*var\(--color-bg\)/, 'glass.css should keep scroll content on an opaque readable base');
  assert.doesNotMatch(layoutContentRule, /radial-gradient/, 'layout.css should not put decorative radial gradients on the scroll container');
});

test('phase 2 dashboard primary titles do not split words mid-token', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const selectors = [
    '.dashboard-overview__title',
    '.today-cockpit-card__value',
  ];

  for (const selector of selectors) {
    const body = cssRuleBody(dashboard, selector);
    assert.match(body, /overflow-wrap:\s*normal/, `${selector} should prefer natural word wrapping`);
    assert.match(body, /word-break:\s*normal/, `${selector} should not break German words mid-token`);
    assert.doesNotMatch(body, /overflow-wrap:\s*anywhere/, `${selector} must not use anywhere wrapping`);
  }
});

test('dashboard „Heute wichtig" is one inset-grouped list, not a tile grid', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const gridBody = cssRuleBody(dashboard, '.today-cockpit__grid');
  const cardBody = cssRuleBody(dashboard, '\n.today-cockpit-card');
  const iconBody = cssRuleBody(dashboard, '.today-cockpit-card__icon');


  //







  assert.match(gridBody, /grid-template-columns:\s*1fr/, 'the group is a single column of rows, not a tile grid');
  assert.match(gridBody, /background:\s*var\(--color-surface\)/, 'the group carries one opaque surface');
  assert.match(gridBody, /border-radius:\s*var\(--radius-[a-z0-9]+\)/, 'the group is the rounded container, and it rounds via a token');
  assert.match(gridBody, /overflow:\s*hidden/, 'rows must clip to the group radius');
  assert.doesNotMatch(gridBody, /repeat\(2,/, 'the 2×2 glance grid belongs to the superseded world');


  assert.match(cardBody, /background:\s*transparent/, 'rows sit on the group surface, not on their own');
  assert.match(cardBody, /border:\s*none/, 'rows are separated by hairlines, never framed');
  assert.doesNotMatch(cardBody, /border-radius/, 'the row never rounds - only the group does');
  assert.match(cardBody, /min-height:\s*var\(--target-base\)/, 'row height stays tokenized against the touch target');
  assert.match(
    dashboard,
    /\.today-cockpit-card \+ \.today-cockpit-card\s*\{[^}]*border-top:\s*1px solid var\(--color-border-subtle\)/,
    'consecutive rows are divided by a hairline',
  );





  assert.match(iconBody, /--seal-accent:\s*var\(--today-card-accent\)/, 'the icon well forwards its tone accent to the seal');
  const layout = read('../public/styles/layout.css');






  const sealBody = [...eachRule(layout)]
    .filter((r) => r.selector.split(',').some((s) => s.trim() === '.module-seal'))
    .map((r) => r.body)
    .join('\n');
  assert.ok(sealBody, 'keine .module-seal-Regel gefunden - die Signatur greift nicht mehr');

  //

  // --seal-base) - der Guard hielt fest, was dark-chroma.mjs am selben Tag




  assert.match(sealBody, /background:[\s\S]*var\(--seal-accent\);/, 'the seal carries its module tone as the disc itself');
  assert.match(sealBody, /color:\s*var\(--color-ink-on-vivid\)/, 'the glyph is the measured ink on a vivid ground');


  // eine Mischung dahinter.
  //



  // dieselbe Falle, die test/css-rules.js oben beschreibt.
  const sealGrounds = [];
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body } of eachRule(read(`../public/styles/${file}`))) {
      if (/--seal-base\s*:/.test(body)) sealGrounds.push(`${file}: ${selector}`);
      if (selector.includes('.module-seal--vivid')) sealGrounds.push(`${file}: ${selector}`);
    }
  }
  assert.deepEqual(sealGrounds, [],
    'Das Siegel hat ein Gesicht: kein
    + 'kein
  const dashboardJs = read('../public/pages/dashboard.js');
  assert.match(dashboardJs, /class="module-seal today-cockpit-card__icon"/, 'the cockpit icon well takes its form from the seal');

  // Sehr schmale Container bleiben einspaltig (Container-Query, kein Viewport-BP)
  assert.match(
    dashboard,
    /@container today-cockpit \(max-width:\s*270px\)[\s\S]*grid-template-columns:\s*1fr/,
    'very narrow cockpit container should fall back to a single column'
  );
});

test('the dashboard speed dial owns no FAB geometry of its own', () => {
  const dashboard = read('../public/styles/dashboard.css');
  const live = dashboard.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.doesNotMatch(live, /\.fab-container|\.fab-main/,
    'der eigene Kasten des Dashboards ist entfallen - der Dial ist eine '
    + '.page-fab-group mit einem .page-fab darin (#634)');
  for (const rule of live.match(/[^{}]*\bfab\b[^{]*\{[^}]*\}/g) ?? []) {
    assert.doesNotMatch(rule, /\b(?:width|height):\s*\d/,
      `dashboard.css schreibt wieder eine FAB-Groesse von Hand statt --fab-size:\n${rule}`);
  }
  assert.doesNotMatch(cssRuleBody(dashboard, '.dashboard'), /padding-bottom/,
    'die FAB-Reserve kommt aus --fab-safe-zone an .app-content; eine zweite '
    + 'Reserve am Modul stapelt sich zu totem Raum (Audit A1-16)');
  assert.doesNotMatch(
    dashboard,
    /@media \(max-width:\s*639px\)[\s\S]*\.dashboard-shell\s*\{[^}]*padding-bottom/,
    'the mobile shell must not stack a second FAB clearance (Audit A1-16)'
  );
});

test('calendar draws its gutter from the shared page token and compacts weekday headers', () => {
  const calendar = read('../public/styles/calendar.css');


  // `padding: var(--space-6) var(--space-8)` plus `padding-inline: var(--space-10)`

  // sticky Kopf 24px vom oberen Rand ab, obwohl er top:0 klebt. Der Rand kommt

  assert.match(
    calendar,
    /#cal-body\s*\{[^}]*padding-inline:\s*var\(--page-inline-pad\)/,
    'calendar body should take its gutter from the shared --page-inline-pad',
  );
  assert.doesNotMatch(
    calendar,
    /\.calendar-page\s*\{[^}]*padding(-inline)?:\s*var\(--space-/,
    'calendar must not reintroduce a module-specific page gutter (#577)',
  );
  assert.match(
    calendar,
    /@media \(min-width:\s*1024px\)[\s\S]*?\.week-view__day-header\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center/,
    'desktop weekday and date should sit side by side',
  );
  assert.match(
    calendar,
    /@media \(min-width:\s*1024px\)[\s\S]*?\.week-view__day-num\s*\{[\s\S]*?width:\s*var\(--target-sm\);[\s\S]*?height:\s*var\(--target-sm\)/,
    'desktop date markers should use the compact touch-size token',
  );
});

// Bis Block 2 (2026-08-10) verglich dieser Guard genau zwei Namen



// tragen, sonst kehrt die Kollision (zwei Violetts, zwei Teals) still zurueck.


test('module accent families stay pairwise distinct and every module draws from one', () => {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = darkAttrBlock(tokens);

  assert.ok(rootBlock, 'expected a :root token block');
  assert.ok(darkBlock, 'expected a [data-theme="dark"] block');

  for (const [theme, block] of [['light', rootBlock[1]], ['dark', darkBlock[1]]]) {
    const values = parseTokenMap(block);
    const families = [...values.entries()].filter(([name]) => name.startsWith('--_family-'));
    assert.ok(
      families.length >= 9,
      `${theme}: expected the module accent families in this block, found ${families.length}`,
    );
    const seen = new Map();
    for (const [name, value] of families) {
      const v = value.toLowerCase();
      assert.ok(
        !seen.has(v),
        `${theme}: ${name} shares its value ${v} with ${seen.get(v)} - family accents must stay pairwise distinct`,
      );
      seen.set(v, name);
    }
  }

  const rootValues = parseTokenMap(rootBlock[1]);
  for (const [name, value] of rootValues) {
    if (!name.startsWith('--module-')) continue;
    assert.match(
      value,
      /^var\(--_family-[\w-]+\)$/,
      `${name} must draw its value from a --_family-* token, got: ${value}`,
    );
  }
});

// ============================================================
// UX-Audit Mai 2026 — P2/P3 (docs/UI-UX-AUDIT-2026-05.md)
// ============================================================

const LOCALE_DIR = new URL('../public/locales/', import.meta.url);
const LOCALES = readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'));

function flattenLocaleKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenLocaleKeys(value, fullKey);
    }
    return [fullKey];
  });
}

// --- Kontrast-Helfer (WCAG 2.x relative luminance) ---
function parseTokenMap(block) {
  const map = new Map();


  // ueberschreibt dann den echten Token-Wert (2026-08-06 genau so passiert).
  for (const [, name, value] of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(name, value.trim());
  }
  return map;
}

function resolveColor(name, map) {
  let value = map.get(name);
  let guard = 0;
  while (value && /^var\(/.test(value) && guard++ < 12) {
    const ref = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (!ref) break;
    value = map.get(ref[1]);
  }
  return value;
}

function hexToRgb(hex) {
  const m = String(hex).trim().match(/^#([0-9a-f]{6})$/i);
  assert.ok(m, `expected a 6-digit hex color, got: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

function relLum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const l1 = relLum(hexToRgb(a));
  const l2 = relLum(hexToRgb(b));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseCssRgb(value) {
  const hex = String(value).trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) return [...hexToRgb(value), 1];

  const rgba = String(value).trim().match(/^rgba?\(([^)]+)\)$/i);
  assert.ok(rgba, `expected a hex, rgb, or rgba color, got: ${value}`);
  const parts = rgba[1].split(',').map((part) => Number(part.trim()));
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function compositeColor(foreground, background) {
  const [fr, fg, fb, fa] = parseCssRgb(foreground);
  const [br, bg, bb] = parseCssRgb(background);
  const channels = [
    fr * fa + br * (1 - fa),
    fg * fa + bg * (1 - fa),
    fb * fa + bb * (1 - fa),
  ];
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

test('text/surface token pairs meet WCAG AA 4.5:1 in both themes', () => {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = darkAttrBlock(tokens);
  assert.ok(rootBlock, 'expected a :root token block');
  assert.ok(darkBlock, 'expected a [data-theme="dark"] block');

  const light = parseTokenMap(rootBlock[1]);
  const dark = new Map(light);
  for (const [k, v] of parseTokenMap(darkBlock[1])) dark.set(k, v);


  //







  const pairs = [
    ['--color-text-primary', '--color-surface'],
    ['--color-text-primary', '--color-bg'],
    ['--color-text-secondary', '--color-surface'],
    ['--color-text-secondary', '--color-bg'],
    ['--color-text-tertiary', '--color-bg'],
    ['--color-accent', '--color-surface'],
  ];

  for (const [theme, map] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg] of pairs) {
      const fgHex = resolveColor(fg, map);
      const bgHex = resolveColor(bg, map);
      const ratio = contrastRatio(fgHex, bgHex);
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${fg} (${fgHex}) on ${bg} (${bgHex}) is ${ratio.toFixed(2)}:1, below WCAG AA 4.5:1`,
      );
    }
  }
});




const COPAIR_CATEGORY = new Map([
  ['[disabled] .ydp__input', { min: 0, why: 'WCAG 1.4.3 nimmt deaktivierte Bedienelemente aus; Sonde 2 tut dasselbe' }],
  ['.ydp__trigger:hover', { min: 3, why: 'Ziel traegt ein 18px-Icon, keinen Text - WCAG 1.4.11 (3:1), gemessen 3,30:1 dark' }],
]);

test('jede Regel, die Farbe UND Untergrund setzt, haelt ihr eigenes Paar', () => {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = darkAttrBlock(tokens);
  assert.ok(rootBlock && darkBlock, 'expected :root and [data-theme="dark"] token blocks');
  const light = parseTokenMap(rootBlock[1]);
  const dark = new Map(light);
  for (const [k, v] of parseTokenMap(darkBlock[1])) dark.set(k, v);

  // `var(--x, fallback)` mitnehmen: `.settings-backup-card__icon` schreibt so,

  const resolveValue = (value, map, depth = 0) => {
    if (!value || depth > 12) return null;
    const v = value.trim();
    const ref = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
    if (ref) return resolveValue(map.get(ref[1]) ?? ref[2], map, depth + 1);
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null;
  };
  const lastDecl = (body, prop) => {
    let found = null;
    for (const m of body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g'))) found = m[1].trim();
    return found;
  };



  const SIZE_PX = {
    '--text-xs': 12, '--text-sm': 14, '--text-base': 16, '--text-lg': 18, '--text-xl': 20, '--text-2xl': 24, '--text-3xl': 30,
  };

  const styles = new URL('../public/styles/', import.meta.url);
  const files = readdirSync(styles).filter((entry) => entry.endsWith('.css') && entry !== 'tokens.css');
  const findings = [];
  const usedCategories = new Set();
  let pairs = 0;

  for (const file of files) {
    for (const rule of eachRule(readFileSync(new URL(file, styles), 'utf8'))) {
      const fgRaw = lastDecl(rule.body, 'color');
      const bgRaw = lastDecl(rule.body, 'background-color') ?? lastDecl(rule.body, 'background');
      if (!fgRaw || !bgRaw) continue;



      if (/gradient|color-mix|transparent|currentColor|inherit|none/i.test(bgRaw)) continue;
      if (/color-mix|currentColor|inherit/i.test(fgRaw)) continue;
      pairs += 1;

      const category = [...COPAIR_CATEGORY.entries()].find(([needle]) => rule.selector.includes(needle));
      if (category) usedCategories.add(category[0]);
      const sizeToken = lastDecl(rule.body, 'font-size')?.match(/--[\w-]+/)?.[0];
      const px = sizeToken ? SIZE_PX[sizeToken] : null;
      const bold = /bold|[6-9]00/.test(lastDecl(rule.body, 'font-weight') ?? '');
      const large = px !== null && px !== undefined && (px >= 24 || (px >= 18.66 && bold));
      const min = category ? category[1].min : (large ? 3 : 4.5);
      if (min === 0) continue;

      for (const [theme, map] of [['light', light], ['dark', dark]]) {
        const fg = resolveValue(fgRaw, map);
        const bg = resolveValue(bgRaw, map);
        if (!fg || !bg) continue;
        const ratio = contrastRatio(fg, bg);
        if (ratio + 0.005 < min) {
          findings.push(
            `${theme}: ${ratio.toFixed(2)}:1 (soll ${min})  ${fg} auf ${bg}  ${file}  ${rule.selector}`
            + `${rule.at.length ? `  [${rule.at.join(' ')}]` : ''}`,
          );
        }
      }
    }
  }




  assert.ok(pairs >= 150,
    `Nur ${pairs} ko-deklarierte Farbpaare gefunden (gemessen: 198). Der Regelscanner `
    + 'oder die Deklarations-Suche greift nicht mehr - der Guard misst nichts, statt nichts zu finden.');

  assert.deepEqual(findings.sort(), [],
    'Regeln, die ihr eigenes Farbpaar nicht halten. Die Antwort ist fast nie ein neuer '
    + 'Sonderwert: eine Semantikfarbe auf ihrer EIGENEN blassen Fuellung nimmt die lesbare '
    + 'Stufe (`--color-<n>-ink` / `--meal-<n>-ink`, tokens.css). Wer die Fuellung stattdessen '
    + 'aufhellt, tauscht den Textkontrast gegen die Sichtbarkeit der Flaeche.');



  const stale = [...COPAIR_CATEGORY.keys()].filter((needle) => !usedCategories.has(needle));
  assert.deepEqual(stale, [],
    'COPAIR_CATEGORY nennt Selektoren, die in keinem Stylesheet mehr ein Farbpaar bauen.');
});

test('module accents stay readable as text on the page background in both themes', () => {
  // `.btn--secondary` faerbt seine Beschriftung mit --active-module-accent


  // Theme lagen sechs Farben darunter (Settings-Audit 2026-07-27: 4.13:1 bei

  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = darkAttrBlock(tokens);
  assert.ok(rootBlock && darkBlock, 'expected :root and [data-theme="dark"] token blocks');

  const light = parseTokenMap(rootBlock[1]);
  const dark = new Map(light);
  for (const [k, v] of parseTokenMap(darkBlock[1])) dark.set(k, v);

  const moduleTokens = [...light.keys()].filter((name) => /^--module-[\w-]+$/.test(name));
  assert.ok(moduleTokens.length >= 15, `expected the module palette, found ${moduleTokens.length}`);

  for (const [theme, map] of [['light', light], ['dark', dark]]) {
    const background = resolveColor('--color-bg', map);
    for (const token of moduleTokens) {
      const accent = resolveColor(token, map);
      const ratio = contrastRatio(accent, background);
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${token} (${accent}) on --color-bg (${background}) is ${ratio.toFixed(2)}:1, below WCAG AA 4.5:1`,
      );
    }
  }
});




// geht (drei von acht Mutationen blieben so gruen):
//

//   --module-accent         setzt jedes Modul-CSS scoped auf seiner Page-Root
//                           (`--module-accent: var(--module-birthdays)`).
//

// jede Modulfarbe moeglich, also zaehlt der schlechteste Fall.
const RUNTIME_FILL_TOKENS = new Set(['--active-module-accent', '--module-accent']);


function localModuleAccent(src) {
  const m = src.match(/--module-accent\s*:\s*var\(\s*(--module-[\w-]+)\s*\)/);
  return m ? m[1] : null;
}

function themeTokenMaps() {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = darkAttrBlock(tokens);
  assert.ok(rootBlock && darkBlock, 'expected :root and [data-theme="dark"] token blocks');
  const light = parseTokenMap(rootBlock[1]);
  const dark = new Map(light);
  for (const [k, v] of parseTokenMap(darkBlock[1])) dark.set(k, v);
  return { light, dark };
}



function fillColors(token, map, scopedAccent) {
  if (RUNTIME_FILL_TOKENS.has(token)) {
    const names = token === '--module-accent' && scopedAccent
      ? [scopedAccent]
      : [...map.keys()].filter((name) => /^--module-[\w-]+$/.test(name));
    return names.map((name) => ({ label: name, hex: resolveColor(name, map) }));
  }
  const hex = resolveColor(token, map);
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? [{ label: token, hex }] : [];
}

function flipsTextPolarity(lightHex, darkHex) {
  if (!lightHex || !darkHex) return false;
  return contrastRatio('#ffffff', lightHex) >= 4.5 && contrastRatio('#ffffff', darkHex) < 4.5;
}

test('Textfarbe auf vividen Fuellflaechen haelt WCAG AA in beiden Themes', () => {
  const { light, dark } = themeTokenMaps();
  const dir = new URL('../public/styles/', import.meta.url);
  const violations = [];

  for (const file of readdirSync(dir).filter((n) => n.endsWith('.css') && n !== 'tokens.css')) {
    const src = read(`../public/styles/${file}`);
    const scopedAccent = localModuleAccent(src);

    // Selektor-Teil, der Block selbst bleibt korrekt.
    for (const [, selector, body] of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {



      // traegt weiss mit gemessenen 4,87:1).
      const fill = body.match(
        /(?:^|[\s;])background(?:-color)?\s*:\s*var\(\s*(--[\w-]+)\s*(?:,\s*var\(\s*(--[\w-]+)\s*\)\s*)?\)\s*(?:;|$)/,
      );
      const textColor = body.match(/(?:^|[\s;])color\s*:\s*var\(\s*(--[\w-]+)\s*\)\s*(?:;|$)/);
      if (!fill || !textColor) continue;

      const fillToken = fill[1];
      const lightFills = fillColors(fillToken, light, scopedAccent);
      const darkFills = new Map(
        fillColors(fillToken, dark, scopedAccent).map((f) => [f.label, f.hex]),
      );

      for (const surface of lightFills) {
        const darkHex = darkFills.get(surface.label);
        if (!flipsTextPolarity(surface.hex, darkHex)) continue;

        for (const [theme, map, surfaceHex] of [
          ['light', light, surface.hex],
          ['dark', dark, darkHex],
        ]) {
          const ink = resolveColor(textColor[1], map);
          if (!ink || !/^#[0-9a-f]{6}$/i.test(ink)) continue;
          const ratio = contrastRatio(ink, surfaceHex);
          if (ratio >= 4.5) continue;
          violations.push(
            `${file} {${selector.trim().split('\n').pop().trim()}}: ${theme} ` +
            `${textColor[1]} (${ink}) auf ${surface.label} (${surfaceHex}) = ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
  }

  assert.deepEqual(violations, [],
    'Textfarbe auf vivider Fuellflaeche unter 4,5:1 -
});

test('--color-ink-on-vivid traegt auf jedem Modulakzent, --color-text-on-accent nicht', () => {



  // drittes, ebenso untaugliches Token ausweicht.
  const { light, dark } = themeTokenMaps();

  for (const [theme, map] of [['light', light], ['dark', dark]]) {
    const ink = resolveColor('--color-ink-on-vivid', map);
    const modules = [...map.keys()].filter((name) => /^--module-[\w-]+$/.test(name));
    assert.ok(modules.length >= 15, `expected the module palette, found ${modules.length}`);

    for (const token of modules) {
      const surface = resolveColor(token, map);
      const ratio = contrastRatio(ink, surface);
      assert.ok(ratio >= 4.5,
        `${theme}:
    }
  }



  const staticWhite = resolveColor('--color-text-on-accent', dark);
  assert.equal(staticWhite.toLowerCase(), '#ffffff', '--color-text-on-accent ist statisches Weiss');
  const worst = [...dark.keys()]
    .filter((name) => /^--module-[\w-]+$/.test(name))
    .map((name) => contrastRatio(staticWhite, resolveColor(name, dark)));
  assert.ok(Math.min(...worst) < 3,
    'Dark-Modulakzente muessen weissen Text unterschreiten, sonst ist die Regel gegenstandslos');
});

test('Text auf getoenter Flaeche haelt WCAG AA in beiden Themes', () => {
  const { light, dark } = themeTokenMaps();
  const dir = new URL('../public/styles/', import.meta.url);
  const TINT = /^--color-[\w-]+-light$/;
  const PURE_VAR = /^var\(\s*(--[\w-]+)\s*\)$/;



  const componentKeys = (selector, at) => selector
    .split(',')
    .map((part) => part.trim().replace(/::?[\w-]+(?:\([^)]*\))?/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((part) => `${at.join(' | ')}||${part}`);

  const declaration = (body, prop) => {
    const m = body.match(new RegExp(`(?:^|[\\s;])${prop}\\s*:\\s*([^;]+)`));
    return m ? m[1].trim() : null;
  };


  // ausserhalb seiner Toenungsregeln traegt.
  const components = new Map();
  const entryFor = (key) => {
    if (!components.has(key)) components.set(key, { tints: [], base: [] });
    return components.get(key);
  };

  for (const file of readdirSync(dir).filter((n) => n.endsWith('.css') && n !== 'tokens.css')) {
    for (const { selector, body, at } of eachRule(read(`../public/styles/${file}`))) {
      const fill = declaration(body, 'background(?:-color)?')?.match(PURE_VAR)?.[1];
      const text = declaration(body, 'color')?.match(PURE_VAR)?.[1];
      if (!fill && !text) continue;
      const where = `${file} {${selector}}`;

      for (const key of componentKeys(selector, at)) {
        const entry = entryFor(key);



        if (fill && TINT.test(fill)) entry.tints.push({ token: fill, own: text, where });
        else if (text) entry.base.push({ token: text, where });
      }
    }
  }

  const violations = [];
  for (const { tints, base } of components.values()) {
    for (const tint of tints) {
      const inks = tint.own
        ? [{ token: tint.own, where: tint.where }]
        : base;
      for (const ink of inks) {
        for (const [theme, map] of [['light', light], ['dark', dark]]) {
          const surface = resolveColor(tint.token, map);
          const color = resolveColor(ink.token, map);
          if (!/^#[0-9a-f]{6}$/i.test(surface ?? '') || !/^#[0-9a-f]{6}$/i.test(color ?? '')) continue;
          const ratio = contrastRatio(color, surface);
          if (ratio >= 4.5) continue;
          violations.push(
            `${theme}: ${ink.token} (${color}, ${ink.where}) auf ${tint.token} `
            + `(${surface}, ${tint.where}) = ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
  }

  assert.deepEqual([...new Set(violations)].sort(), [],
    'Text auf einer -light-Toenung gehoert auf den zugehoerigen -ink-Ton');
});

test('jede horizontale Fade-Maske hat ihr RTL-Gegenstueck', () => {
  const dir = new URL('../public/styles/', import.meta.url);
  const HORIZONTAL = /mask-image\s*:\s*linear-gradient\(\s*to (?:right|left)/;
  const missing = [];
  let physical = 0;

  for (const file of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    const rules = [...eachRule(read(`../public/styles/${file}`))];
    const rtl = new Set(
      rules
        .filter(({ selector }) => selector.includes('[dir="rtl"]'))
        .map(({ selector, at }) => `${at.join(' | ')}||${selector.replace(/\[dir="rtl"\]\s*/g, '').trim()}`),
    );

    for (const { selector, body, at } of rules) {
      if (selector.includes('[dir="rtl"]')) continue;
      if (!HORIZONTAL.test(body)) continue;
      physical += 1;
      if (!rtl.has(`${at.join(' | ')}||${selector.trim()}`)) {
        missing.push(`${file} {${selector}}: physische Maskenachse ohne [dir="rtl"]-Spiegelung`);
      }
    }
  }


  assert.ok(physical >= 4, `erwartet: horizontale Maskenregeln, gefunden: ${physical}`);
  assert.deepEqual(missing, [],
    'eine physische Verlaufsachse muss in RTL gespiegelt werden, sonst fadet die falsche Kante');
});

test('Zeilenaktionen ziehen sich auf Touch zurueck, ohne unerreichbar zu werden', () => {
  const dir = new URL('../public/styles/', import.meta.url);
  const ACTIONS = /(?:^|[\s,>+~])\.[\w-]*(?:row-actions|__actions)\b/;
  const violations = [];
  let seen = 0;

  for (const file of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    for (const { selector, body, at } of eachRule(read(`../public/styles/${file}`))) {
      if (!at.some((preamble) => /hover:\s*none/.test(preamble))) continue;
      if (!ACTIONS.test(selector)) continue;
      seen += 1;
      if (/(?:^|[\s;])display\s*:\s*none/.test(body)) {
        violations.push(`${file} {${selector}}: display: none nimmt die Knoepfe aus dem Fokusbaum`);
      }
    }
  }


  assert.ok(seen >= 2, `erwartet: Zeilenaktionsregeln unter (hover: none), gefunden: ${seen}`);
  assert.deepEqual(violations, [],
    'auf Touch versteckt heisst aus dem Fluss nehmen (clip-path), nicht display: none');
});

test('der Toenungs-Guard sieht die Toenungsflaechen der App', () => {
  const dir = new URL('../public/styles/', import.meta.url);
  const pairs = [];

  for (const file of readdirSync(dir).filter((n) => n.endsWith('.css') && n !== 'tokens.css')) {
    const src = read(`../public/styles/${file}`);
    if (/background(?:-color)?\s*:\s*var\(\s*--color-[\w-]+-light\s*\)/.test(src)) pairs.push(file);
  }

  assert.ok(pairs.length >= 4,
    `erwartet: mehrere Dateien mit -light-Toenungen, gefunden: ${pairs.join(', ') || 'keine'}`);
});

test('module accent is recomputed on every runtime theme switch', () => {
  const router = read('../public/router.js');



  const writers = walkJsFiles('../public/')
    .filter((path) => !path.includes('/vendor/'))
    .flatMap((path) => {
      const hits = read(path).match(/setProperty\(\s*'--active-module-accent'/g) ?? [];
      return hits.map(() => path);
    });
  assert.deepEqual(
    writers,
    ['../public/router.js'],
    `--active-module-accent must be written in exactly one place, found: ${writers.join(', ')}`,
  );

  const helper = router.match(/function applyModuleAccentForRoute\([\s\S]*?\n\}/);
  assert.ok(helper, 'expected applyModuleAccentForRoute to own the write');
  assert.match(
    helper[0],
    /setProperty\(\s*'--active-module-accent'/,
    'the single write must live inside applyModuleAccentForRoute',
  );


  assert.match(router, /applyModuleAccentForRoute\(route\)/, 'navigate() must use the helper');

  // 3. Expliziter Theme-Wechsel (window.aashiyana.applyTheme) berechnet neu.
  const applyTheme = router.match(/applyTheme:\s*\(value\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(applyTheme, 'expected the applyTheme export');
  assert.match(
    applyTheme[0],
    /data-theme/,
    'sanity: applyTheme is the function that flips the theme',
  );
  assert.match(
    applyTheme[0],
    /applyModuleAccentForRoute\(currentRoute\(\)\)/,
    'applyTheme must recompute the module accent for the current route',
  );

  // 4. Theme "Automatisch" schaltet ohne applyTheme um - rein per CSS-Media-


  //

  //    Wegwerf-Ausdruck (`matchMedia(...).addEventListener(...)`) darf die


  assert.match(
    router,
    /const darkSchemeQuery = window\.matchMedia\??\.?\(\s*'\(prefers-color-scheme: dark\)'\s*\)/,
    'the prefers-color-scheme query must be held in a module binding, not a throwaway expression',
  );
  assert.doesNotMatch(
    router,
    /matchMedia\??\.?\(\s*'\(prefers-color-scheme: dark\)'\s*\)\s*\??\.?\s*addEventListener/,
    'do not attach the listener to an unreferenced MediaQueryList',
  );

  const listener = router.match(
    /darkSchemeQuery\s*\??\.?\s*addEventListener[\s\S]{0,120}?'change'[\s\S]{0,200}?;/,
  );
  assert.ok(listener, 'expected a prefers-color-scheme change listener for auto mode');
  assert.match(
    listener[0],
    /applyModuleAccentForRoute\(currentRoute\(\)\)/,
    'the auto-mode listener must recompute the module accent too',
  );



  //    neu berechnet war.
  assert.ok(
    applyTheme[0].indexOf('applyModuleAccentForRoute')
      < applyTheme[0].indexOf("localStorage.setItem('aashiyana-theme'"),
    'applyTheme must apply theme and accent before persisting the choice',
  );
});

test('the standalone status bar colour is recomputed on a runtime theme switch too', () => {
  const router = read('../public/router.js');

  const helper = router.match(/function refreshThemeColorForTheme\(\)[\s\S]*?\n\}/);
  assert.ok(helper, 'expected refreshThemeColorForTheme to own the status bar refresh');
  assert.match(
    helper[0],
    /updateThemeColorForRoute\(currentRoute\(\)\)/,
    'the helper must recompute the status bar colour for the current route',
  );

  // Schliessen ueber restoreThemeColor selbst wieder her. Zoege der Auto-Modus

  assert.match(
    helper[0],
    /shared-modal-overlay/,
    'the helper must leave the status bar alone while a modal dims it',
  );


  const applyTheme = router.match(/applyTheme:\s*\(value\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(applyTheme, 'expected the applyTheme export');
  assert.match(
    applyTheme[0],
    /refreshThemeColorForTheme\(\)/,
    'applyTheme must refresh the status bar colour',
  );

  const listener = router.match(
    /darkSchemeQuery\s*\??\.?\s*addEventListener[\s\S]{0,120}?'change'[\s\S]{0,300}?\n {4}\}\);/,
  );
  assert.ok(listener, 'expected a prefers-color-scheme change listener for auto mode');
  assert.match(
    listener[0],
    /refreshThemeColorForTheme\(\)/,
    'the auto-mode listener must refresh the status bar colour too',
  );
});

test('die Statusbar folgt der ausdruecklichen Theme-Wahl, nicht nur dem System', () => {
  const router = read('../public/router.js');
  const fn = router.match(/function setThemeColor\([\s\S]*?\n\}/);
  assert.ok(fn, 'expected setThemeColor to own the meta writes');

  assert.match(fn[0], /getAttribute\('data-theme'\)/,
    'setThemeColor muss die ausdrueckliche Wahl lesen - die Metas folgen sonst dem System');



  const init = read('../public/theme-init.js');
  assert.match(init, /meta\[name="theme-color"\]/,
    'theme-init.js muss die Statusbar auf die gewaehlte Farbe stellen - sonst haengt die Offline-Huelle');





  const docs = ['index.html', 'offline.html'];
  const scopedDocs = [];
  const unfixed = [];
  for (const name of docs) {
    const src = read(`../public/${name}`);
    const scoped = [...src.matchAll(/<meta name="theme-color"[^>]*media="\(prefers-color-scheme/g)];
    if (!scoped.length) continue;
    scopedDocs.push(name);
    assert.equal(scoped.length, 2, `${name}: erwartet zwei system-gebundene Metas, gefunden ${scoped.length}`);
    if (!/<script[^>]+src="\/theme-init\.js"/.test(src)) unfixed.push(name);
  }


  assert.deepEqual(scopedDocs, docs,
    `erwartet: beide Dokumente tragen die system-gebundenen Metas, gefunden: ${scopedDocs.join(', ')}`);
  assert.deepEqual(unfixed, [],
    'ein Dokument mit system-gebundenen theme-color-Metas muss theme-init.js laden');
});

test('modal Enter submits the form instead of advancing to the next field (audit 1.4)', () => {
  const src = read('../public/components/modal.js');
  const enterBlock = src.match(/if \(e\.key === 'Enter'\) \{[\s\S]*?\n {4}\}/);
  assert.ok(enterBlock, 'expected an Enter keydown handler');
  assert.match(enterBlock[0], /submitBtn\.click\(\)/, 'Enter must trigger the submit button');
  assert.doesNotMatch(enterBlock[0], /next\.focus\(\)/, 'Enter must not advance focus to the next field');
});

test('shared modal centrally escapes title and select labels (audit 1.8)', () => {
  const src = read('../public/components/modal.js');
  assert.match(src, /id="shared-modal-title">\$\{esc\(title\)\}/, 'modal title must be escaped');
  assert.match(src, /<option value="\$\{esc\(o\.value\)\}">\$\{esc\(o\.label\)\}/, 'select options must be escaped');
  assert.match(src, /import \{ esc \} from '\/utils\/html\.js'/, 'modal must import esc');
});

test('shared prompt and select dialogs expose persistent form labels', () => {
  const src = read('../public/components/modal.js');

  assert.match(
    src,
    /<label class="sr-only" for="prompt-modal-input">\$\{esc\(label\)\}<\/label>/,
    'promptModal input needs a connected label',
  );
  assert.match(
    src,
    /<label class="sr-only" for="select-modal-input">\$\{esc\(label\)\}<\/label>/,
    'selectModal control needs a connected label',
  );
});

test('modal lifecycle uses an explicit state machine, not the old _isClosing flag (audit 1.5)', () => {
  const src = read('../public/components/modal.js');
  assert.match(src, /let modalState = 'idle';/, 'expected an explicit modalState variable');
  assert.match(src, /modalState === 'closing'/, 'close guard must key off modalState');
  assert.doesNotMatch(src, /_isClosing/, 'legacy _isClosing flag must be removed');
});

test('budget chart exposes a screen-reader summary (audit 1.7)', () => {
  const src = read('../public/pages/budget.js');
  assert.match(src, /<p class="sr-only">\$\{esc\(chartSummary\(/, 'chart must render an .sr-only summary');
  assert.match(src, /function chartSummary\(byCategory\)/, 'expected a chartSummary helper');

  for (const file of LOCALES) {
    const json = JSON.parse(read(`../public/locales/${file}`));
    assert.ok(json.budget?.chartSummary, `${file} must define budget.chartSummary`);
    assert.match(json.budget.chartSummary, /\{\{count\}\}/, `${file} chartSummary must interpolate count`);
    assert.match(json.budget.chartSummary, /\{\{top\}\}/, `${file} chartSummary must interpolate top`);
    assert.match(json.budget.chartSummary, /\{\{pct\}\}/, `${file} chartSummary must interpolate pct`);
  }
});

test('Budget places Subscriptions between Budget and Loans with secure rendering', () => {
  const budget = read('../public/pages/budget.js');
  const subscriptions = read('../public/pages/subscriptions.js');


  const budgetTab = budget.indexOf("['budget',");
  const subscriptionsTab = budget.indexOf("['subscriptions',");
  const loansTab = budget.indexOf("['loans',");

  assert.ok(budgetTab >= 0 && subscriptionsTab > budgetTab && loansTab > subscriptionsTab);
  assert.match(budget, /renderSubscriptions/);
  assert.doesNotMatch(subscriptions, /\.innerHTML\s*=/);
  assert.match(subscriptions, /replaceChildren\(\)/);
  assert.match(subscriptions, /insertAdjacentHTML\(/);
});

test('search fields keep visible labels after users enter a query', () => {
  // The shared page-search building block renders the label+input pair once;
  // page-toolbar modules opt in by calling renderPageSearch with their field id.
  // Split-expenses keeps its own sidebar-filter markup (visible label above the
  // control, server-side reload) as a documented, distinct pattern.
  const pageSearch = read('../public/utils/page-search.js');
  assert.match(pageSearch, /<label[^>]*for="\$\{esc\(id\)\}"/);
  assert.match(pageSearch, /<input[^>]*id="\$\{esc\(id\)\}"/);

  const viaComponent = [
    ['../public/pages/birthdays.js', 'birthdays-search'],
    ['../public/pages/contacts.js', 'contacts-search'],
    ['../public/pages/notes.js', 'notes-search'],
    ['../public/pages/documents.js', 'documents-search'],
    ['../public/pages/tasks.js', 'tasks-search'],
    ['../public/pages/pantry.js', 'pantry-search'],
    ['../public/pages/recipes.js', 'recipes-search'],
  ];
  for (const [file, id] of viaComponent) {
    const source = read(file);
    assert.match(
      source,
      new RegExp(`renderPageSearch\\(\\{[^}]*id:\\s*['"]${id}['"]`),
      `${file} must render #${id} via the shared page-search component`,
    );
  }






  //





  const documentedExceptions = new Set([
    // Kalender: schwergewichtige Server-FTS-Ergebnisansicht mit eigener
    // Icon-Reveal-Leiste, kein Client-Filter (siehe utils/page-search.js).
    'calendar.js',


    'split-expenses.js',






    'subscriptions.js',
  ]);
  const pagesDir = new URL('../public/pages/', import.meta.url);
  for (const entry of readdirSync(pagesDir)) {
    if (!entry.endsWith('.js') || documentedExceptions.has(entry)) continue;
    const source = read(`../public/pages/${entry}`);
    if (!/type=['"]search['"]|\.type\s*=\s*['"]search['"]/.test(source)) continue;
    assert.match(
      source,
      /renderPageSearch\(\{/,
      `${entry} builds a search input by hand; use renderPageSearch() from `
      + 'utils/page-search.js or add it to documentedExceptions with a reason',
    );
  }

  const inlineLabel = [
    ['../public/pages/split-expenses.js', 'split-group-search'],
  ];
  for (const [file, id] of inlineLabel) {
    const source = read(file);
    assert.match(
      source,
      new RegExp(`<label[^>]*for="${id}"[^>]*>[\\s\\S]*?<input[^>]*id="${id}"|<label[^>]*>[\\s\\S]*?<input[^>]*id="${id}"`),
      `${file} must expose a persistent visible label for #${id}`,
    );
  }
});

test('split-expenses archive is reachable and offers a way back (#574)', () => {


  const page = read('../public/pages/split-expenses.js');


  assert.match(page, /data-tab-id="\$\{id\}"/, 'group list needs a status switcher');
  assert.match(page, /'active', 'splitExpenses\.statusActive'/, 'group list needs an active option');
  assert.match(page, /'archived', 'splitExpenses\.statusArchived'/, 'group list needs an archived option');
  assert.match(
    page,
    /\/split-expenses\/groups\?status=\$\{state\.groupStatus\}/,
    'group list must load the selected status, not only active groups',
  );
  assert.match(page, /groups\/\$\{groupId\}\/unarchive/, 'archived groups need a restore action');




  const css = read('../public/styles/split-expenses.css');
  const panelRules = [...css.matchAll(/\.split-groups-panel\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(
    panelRules.some((body) => /min-width:\s*0/.test(body)),
    '.split-groups-panel must not stretch past its grid track',
  );

  assertKeysExistInEveryLocale([
    'splitExpenses.statusLabel',
    'splitExpenses.statusActive',
    'splitExpenses.statusArchived',
    'splitExpenses.restoreGroup',
    'splitExpenses.emptyArchivedTitle',
    // Dynamisch gerendert (activityType.${item.type}), deshalb hier explizit.
    'splitExpenses.activityType.group_unarchived',
  ]);
});

test('German housekeeping visit copy contains no English fallback strings', () => {
  const locale = JSON.parse(read('../public/locales/de.json'));
  const expected = {
    reports: 'Berichte',
    visitRecordedAt: 'Einsatz erfasst um',
    editVisit: 'Einsatz bearbeiten',
    paymentPaid: 'Bezahlt',
    paymentPending: 'Ausstehend',
    filterMonth: 'Monat',
  };

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(locale.housekeeping[key], value, `housekeeping.${key} must be German`);
  }

  const housekeepingCss = read('../public/styles/housekeeping.css');
  assert.match(
    housekeepingCss,
    /\.housekeeping-worker-strip__identity\s*\{[\s\S]*gap:\s*var\(--space-1\)/,
    'housekeeper name and status need an explicit visual gap',
  );
});

test('der Housekeeping-Check-Knopf bleibt in beide Richtungen bedienbar (#1133)', () => {
  const page = read('../public/pages/housekeeping.js');




  const ausloeser = page.match(/data-worker-check/g) ?? [];
  assert.equal(ausloeser.length, 2,
    'Knopf-Markup und Handler-Selektor - mehr Stellen heben diesen Guard aus');




  const knopf = page.slice(page.indexOf('<button class="btn ${checkedIn'), page.indexOf('</button>', page.indexOf('<button class="btn ${checkedIn')));
  assert.ok(knopf, 'der Check-Knopf muss auffindbar bleiben');
  assert.doesNotMatch(knopf, /disabled/,
    'ein disabled Check-Knopf macht das Auschecken unerreichbar (#1133)');
  assert.match(knopf, /checkedIn \? t\('housekeeping\.checkOut'\)/,
    'im eingecheckten Zustand muss der Knopf das Auschecken anbieten');



  assert.match(page, /const checkedIn = !!worker\.current_session;/,
    'der Zustand kommt aus current_session, nicht aus today_session');
  assert.match(page, /const current = worker\?\.current_session;/,
    'toggleSession entscheidet an der offenen Session');
});

test('Housekeeping: Bezahlen laeuft durch EINE Funktion, die vorher bestaetigt (#1136)', () => {

  const page = withoutCommentsKeepingLines(read('../public/pages/housekeeping.js'));
  const lines = page.split('\n');




  const posts = [];
  lines.forEach((l, i) => { if (/\/visits\/\$\{[^}]+\}\/pay`/.test(l)) posts.push(i); });
  assert.equal(posts.length, 1,
    `die Bezahl-Route darf nur an einer Stelle gepostet werden, gefunden in Zeile ${posts.map((i) => i + 1).join(', ')}`);


  const kopf = [...lines.keys()].slice(0, posts[0]).reverse()
    .find((i) => /^(?:export )?(?:async )?function /.test(lines[i]));
  assert.equal(lines[kopf].match(/function (\w+)/)?.[1], 'payVisit', 'der Post gehoert in payVisit()');
  const bisZumPost = lines.slice(kopf, posts[0]).join('\n');
  assert.match(bisZumPost, /const confirmed = await confirmOverModal\(t\('housekeeping\.markPaidConfirm'\)/,
    'payVisit fragt vor dem Post - ueber confirmOverModal, damit der Besuchsbericht darunter ueberlebt');
  assert.match(bisZumPost, /if \(!confirmed\) return;/, 'ein Nein bucht nichts');
  assert.match(bisZumPost, /visit\.payment_task_id\s*\?\s*t\('housekeeping\.markPaidConfirmDetailTask'\)\s*:\s*t\('housekeeping\.markPaidConfirmDetail'\)/,
    'die Rueckfrage nennt die Zahlungsaufgabe, wenn es eine gibt');


  for (const selektor of ["'[data-pay-report]'", "'#visit-report-pay'", "'[data-pay-visit]'"]) {
    const at = page.indexOf(selektor);
    assert.notEqual(at, -1, `Ausloeser ${selektor} fehlt`);
    assert.match(page.slice(at, at + 300), /payVisit\(visit, async \(\) => \{/,
      `${selektor} muss payVisit() rufen, statt selbst zu buchen`);
  }


  assert.match(page, /visit\.can_mark_unpaid/, 'der Ruecknahme-Knopf haengt an can_mark_unpaid');
  assert.doesNotMatch(page, /authRole|role\s*===\s*'admin'/, 'housekeeping.js entscheidet keine Rolle selbst');
});

test('holiday chips derive readable ink from each configured color', () => {
  const calendarPage = read('../public/pages/calendar.js');
  const calendarCss = read('../public/styles/calendar.css');

  assert.match(calendarPage, /import \{ getReadableTextColor \} from '\/utils\/color\.js'/);
  assert.match(calendarPage, /--holi-ink:\$\{esc\(getReadableTextColor\(h\.color\)\)\}/);
  for (const selector of ['.month-day__holiday', '.allday-holiday']) {
    const body = cssRuleBody(calendarCss, selector);
    assert.match(body, /color:\s*var\(--holi-ink,\s*var\(--color-text-on-accent\)\)/);
    assert.doesNotMatch(body, /color:\s*#fff/);
  }
});

test('user-selected avatar colors derive readable text ink', () => {
  const dashboard = read('../public/pages/dashboard.js');
  const multiSelect = read('../public/components/user-multi-select.js');
  const color = read('../public/utils/color.js');

  // Single source of truth for the neutral avatar fallback (concrete hex —
  // getReadableTextColor needs a value it can measure luminance on).
  assert.match(color, /export const AVATAR_FALLBACK_COLOR = '#[0-9a-fA-F]{6}';/);

  assert.match(dashboard, /import \{ getReadableTextColor, AVATAR_FALLBACK_COLOR \} from '\/utils\/color\.js'/);
  assert.match(
    dashboard,
    /color:\$\{getReadableTextColor\(u\.avatar_color \|\| AVATAR_FALLBACK_COLOR\)\}/,
  );
  assert.match(multiSelect, /import \{ getReadableTextColor, AVATAR_FALLBACK_COLOR \} from '\/utils\/color\.js'/);
  assert.match(
    multiSelect,
    /color:\$\{getReadableTextColor\(u\.color \?\? AVATAR_FALLBACK_COLOR\)\}/,
  );
  assert.match(
    multiSelect,
    /color:\$\{getReadableTextColor\(u\.avatar_color \?\? AVATAR_FALLBACK_COLOR\)\}/,
  );
});

test('mobile meal actions remain visible and touch-safe after the full cascade', () => {
  const meals = read('../public/styles/meals.css');

  assert.match(
    meals,
    /@media \(hover:\s*none\),\s*\(max-width:\s*639px\)[\s\S]*?\.meal-card__actions\s*\{[\s\S]*?opacity:\s*1/,
  );
  assert.match(
    meals,
    /@media \(hover:\s*none\),\s*\(max-width:\s*639px\)[\s\S]*?\.meal-card__action-btn\s*\{[\s\S]*?width:\s*var\(--target-lg\)[\s\S]*?height:\s*var\(--target-lg\)/,
  );
  assert.match(
    meals,
    /@media \(hover:\s*none\),\s*\(max-width:\s*639px\)[\s\S]*?\.week-nav__today,[\s\S]*?\.meal-slot__add-more-btn\s*\{[\s\S]*?min-height:\s*var\(--target-lg\)/,
  );
  assert.match(
    meals,
    /@media \(hover:\s*none\),\s*\(max-width:\s*639px\)[\s\S]*?\.meal-card__action-btn\s*\{[\s\S]*?color:\s*var\(--color-text-secondary\)/,
  );
});

test('audited profile, birthday, navigation, and budget controls meet mobile touch targets', () => {
  const settings = read('../public/styles/settings.css');
  const layout = read('../public/styles/layout.css');
  const budget = read('../public/styles/budget.css');
  const contacts = read('../public/styles/contacts.css');
  const housekeeping = read('../public/styles/housekeeping.css');
  const subTabs = read('../public/styles/sub-tabs.css');

  assert.match(settings, /\.settings-avatar-action\s*\{[\s\S]*width:\s*var\(--target-md\)[\s\S]*height:\s*var\(--target-md\)/);
  assert.match(
    settings,
    /@media \(max-width:\s*639px\)[\s\S]*\.settings-avatar-action\s*\{[\s\S]*width:\s*var\(--target-lg\)[\s\S]*height:\s*var\(--target-lg\)/,
  );
  assert.match(settings, /\.settings-module-move\s*\{[\s\S]*width:\s*var\(--target-base\)[\s\S]*height:\s*var\(--target-base\)/);


  assert.match(layout, /\.row-action\s*\{[\s\S]*width:\s*var\(--target-lg\)[\s\S]*height:\s*var\(--target-lg\)/);
  // Budget-Tabs nutzen jetzt das geteilte .sub-tab (sub-tabs.css) statt eigener


  assert.match(subTabs, /\.sub-tab\s*\{[\s\S]*height:\s*var\(--target-base\)/);




  // ueberschreiben.
  assert.match(layout, /\n\.btn\s*\{[\s\S]*min-height:\s*var\(--target-lg\)/);
  assert.doesNotMatch(budget, /\.budget-nav__today\s*\{[^}]*min-height/);
  assert.match(read('../public/pages/contacts.js'), /class="filter-chip contact-filter-chip/);
  assert.match(read('../public/styles/filter-chip.css'), /\.filter-chip\s*\{[\s\S]*min-height:\s*var\(--target-lg\)/);
  assert.doesNotMatch(contacts, /\.contact-filter-chip\s*\{[^}]*min-height/);
  const housekeepingPage = read('../public/pages/housekeeping.js');
  assert.doesNotMatch(housekeeping, /\.housekeeping-log-action/,
    'die Besuchszeile darf keine eigene Aktions-Klasse mit eigener Zielgroesse wieder einfuehren');

  const visitButtons = [...housekeepingPage.matchAll(/<button\b([^>]*\bdata-(?:pay|edit|delete|open)-visit=[^>]*)>/g)]
    .map((m) => m[1]);
  assert.ok(visitButtons.length >= 4,
    `erwartet: Pay-, Edit-, Bericht- und Delete-Knopf, gefunden: ${visitButtons.length}`);
  assert.ok((housekeepingPage.match(/\$\{visitEditActionHtml\(visit, /g) || []).length >= 2,
    'beide Besuchslisten (Uebersicht und Personal-Protokoll) nehmen ihre Aktion aus visitEditActionHtml()');
  const eigenbau = visitButtons.filter((attrs) => !/class="row-action(?: row-action--danger)?"/.test(attrs));
  assert.deepEqual(eigenbau, [],
    'jeder Besuchs-Knopf traegt die geteilte .row-action-Grammatik, nicht nur der zuletzt angefasste');
});

test('remaining audited mobile controls use 48px touch targets', () => {
  const tasks = read('../public/styles/tasks.css');
  const calendar = read('../public/styles/calendar.css');
  const budget = read('../public/styles/budget.css');
  const settings = read('../public/styles/settings.css');







  // schrumpft.
  assertRuleUsesToken(read('../public/styles/filter-chip.css'), '.filter-chip', 'min-height', '--target-lg', '../public/styles/filter-chip.css');
  assert.match(read('../public/pages/tasks.js'), /toggleBtn\.className\s*=\s*`filter-chip filter-toggle-btn/);
  assert.doesNotMatch(tasks, /\.filter-toggle-btn\s*\{[^}]*min-height/);

  // Budget-Zwilling im Guard darueber.
  assert.doesNotMatch(calendar, /\.cal-toolbar__today\s*\{[^}]*min-height/);

  // nimmt --target-base (44px Zeiger / 48px Finger) statt --target-lg fest: das

  assertRuleUsesToken(read('../public/styles/panel.css'), '.segmented__item', 'min-height', '--target-base', '../public/styles/panel.css');
  assertRuleUsesToken(budget, '.budget-loan-card__filter', 'width', '--target-lg', '../public/styles/budget.css');
  assertRuleUsesToken(budget, '.budget-loan-card__filter', 'height', '--target-lg', '../public/styles/budget.css');
  assert.match(
    settings,
    /@media \(max-width:\s*767px\)[\s\S]*\.settings-breadcrumb__link\s*\{[\s\S]*min-height:\s*var\(--target-lg\)/,
  );
});

test('contacts keep one primary call action and disclose the rest through a labeled More menu', () => {
  const contactsPage = read('../public/pages/contacts.js');
  const contactsCss = read('../public/styles/contacts.css');




  assert.match(contactsPage, /href="tel:[\s\S]*class="row-action row-action--success"/);


  assert.match(contactsPage, /class="contact-menu-item"[\s\S]*contact-menu-item__icon[\s\S]*<span>/);

  assert.match(contactsPage, /contact-menu-item contact-menu-item--danger[\s\S]*data-action="delete"/);

  assert.match(contactsCss, /\.contact-menu-item\s*\{[\s\S]*min-height:\s*var\(--target-md\)/);


  assert.match(contactsCss, /\.contact-more-menu__panel\s*\{[\s\S]*position:\s*fixed/);
  assert.match(contactsPage, /popovertarget="\$\{menuId\}"/);
  assert.match(contactsPage, /id="\$\{menuId\}" popover/);
});

test('contacts keyboard shortcut and aria-live result count are wired', () => {
  const contactsPage = read('../public/pages/contacts.js');

  // sr-only Live-Region sagt die Trefferzahl an
  assert.match(contactsPage, /id="contacts-status"[^>]*role="status"[^>]*aria-live="polite"/);

  assert.match(contactsPage, /e\.key === '\/'/);
  assert.match(contactsPage, /pageRoot\.isConnected/);
});

test('contacts bulk selection is opt-in and hidden by default', () => {
  const contactsPage = read('../public/pages/contacts.js');
  const contactsCss = read('../public/styles/contacts.css');


  assert.match(contactsPage, /id="contacts-select-btn"/);
  assert.match(contactsPage, /selectMode:\s*false/);

  assert.doesNotMatch(contactsPage, /contacts-selectbar/,
    'die eigene Auswahlleiste ist entfallen - die Sammelaktion ist die geteilte Pille');
  assert.doesNotMatch(contactsCss, /\.contacts-selectbar/,
    'und ihre Regeln stehen nicht mehr im Modul-Stylesheet');
  assert.match(contactsPage, /from '\/utils\/bulk-pill\.js'/);
  assert.match(contactsPage, /if \(!state\.selectMode\) \{ clearBulkPill\(\); return; \}/,
    'ohne Auswahlmodus steht keine Pille');


  assert.match(contactsPage, /async function deleteSelected/);
  assert.match(contactsPage, /bulkDeletedToast/);

  assert.match(contactsPage, /c\.family_user_id \? ' disabled' : ''/);
});

test('documents and navigation settings use progressive disclosure instead of stacked control cards', () => {
  const documentsPage = read('../public/pages/documents.js');
  const documentsCss = read('../public/styles/documents.css');
  const navigationPage = read('../public/settings/pages/modules-navigation.js');
  const settingsCss = read('../public/styles/settings.css');




  assert.doesNotMatch(documentsPage, /documents-secondary-controls/);
  assert.match(documentsPage, /<div class="documents-filters">/);
  assert.match(documentsPage, /class="documents-filter-group" id="documents-status"/);
  assert.match(documentsPage, /class="documents-filter-chips" id="documents-category"/);



  assert.match(
    documentsCss,
    /\.documents-filter-chips\s*\{[^}]*overflow-x:\s*auto/,
  );
  assert.match(documentsCss, /\.documents-filters\s*\{[^}]*overflow:\s*hidden/);
  assert.doesNotMatch(documentsCss, /documents-secondary-controls/);
  assert.match(navigationPage, /class="settings-navigation-panel"/);
  assert.doesNotMatch(navigationPage, /<div class="settings-card">/);
  assert.match(settingsCss, /\.settings-navigation-panel\s*\{[\s\S]*border-bottom:\s*var\(--space-px\)\s+solid\s+var\(--color-border-subtle\)/);
  assert.match(
    settingsCss,
    /@media \(max-width:\s*639px\)[\s\S]*\.settings-module-drag\s*\{[\s\S]*display:\s*none/,
  );
});

test('birthday and navigation headings keep a sequential hierarchy', () => {
  const birthdays = read('../public/pages/birthdays.js');
  const navigation = read('../public/settings/pages/modules-navigation.js');

  assert.match(birthdays, /<h1 class="page-toolbar__title">|renderPageTitle\s*\(/);
  assert.doesNotMatch(birthdays, /<h3>/);
  assert.match(navigation, /<h2 class="settings-navigation-panel__title"/);
  assert.match(navigation, /<h3 class="settings-navigation-group__title"/);
  assert.doesNotMatch(navigation, /<h4 class="settings-navigation-group__title"/);
});

test('housekeeping exposes its page title as the primary heading', () => {
  const housekeeping = read('../public/pages/housekeeping.js');

  assert.match(housekeeping, /<h1 class="page-toolbar__title" id="housekeeping-title">/);
  assert.doesNotMatch(housekeeping, /<div class="page-toolbar__title" id="housekeeping-title">/);
});




//       `<h1 class="page-toolbar__title">`, verdrahtet via wireTablist. Der Tab-
//       wechsel tauscht Inhalt INNERHALB einer Route (budget/housekeeping/rewards).
//   (2) Routen-Cluster — geteilte sticky `.sub-tabs-bar` via renderSubTabs mit
//       dekorativem Inline-Titel + separater `sr-only` <h1>; die Leiste NAVIGIERT
//       zwischen Deep-Link-Routen (health, kitchen: meals/recipes/shopping).




// still zerlegt.









const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Wie cssRules(), aber jede Regel kennt zusaetzlich ihren Kontext:
//







//     und uebersieht `.foo { & { max-width: 20rem } }` vollstaendig - er
//     prueft dann still weniger, als er behauptet.
const CONDITIONAL_AT_RULE = /^@(?:media|supports|container|scope|document|starting-style)\b/i;



function ownDeclarations(body) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '{') {
      if (depth === 0) {
        const cut = Math.max(out.lastIndexOf(';'), out.lastIndexOf('}'));
        out = out.slice(0, cut + 1);
      }
      depth += 1;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      out += char;
    }
  }
  return out;
}

function scopedRules(css) {
  const live = stripCssComments(css);
  const rules = [];

  const parse = (from, to, conditional, parents) => {
    let i = from;
    let start = from;
    while (i < to) {
      const char = live[i];
      // Statement-At-Rules (@import, @charset, @layer x;) oeffnen keinen Block;


      if (char === ';' || char === '}') {
        i += 1;
        start = i;
        continue;
      }
      if (char !== '{') {
        i += 1;
        continue;
      }

      const prelude = live.slice(start, i).replace(/\s+/g, ' ').trim();
      let depth = 1;
      let j = i + 1;
      while (j < to && depth > 0) {
        if (live[j] === '{') depth += 1;
        else if (live[j] === '}') depth -= 1;
        j += 1;
      }
      const close = j - 1;

      if (prelude.startsWith('@')) {
        const inner = conditional || CONDITIONAL_AT_RULE.test(prelude);

        // Deklarationen dem Elternselektor: `.list-scroller { @media … {

        if (parents.length) {
          const own = ownDeclarations(live.slice(i + 1, close));
          if (own.trim()) rules.push({ selectors: parents, body: own, conditional: inner });
        }
        parse(i + 1, close, inner, parents);
      } else {
        const own = prelude.split(',').map((sel) => sel.trim()).filter(Boolean);
        const selectors = parents.length
          ? own.flatMap((sel) => parents.map((parent) => (sel.includes('&')
            ? sel.replace(/&/g, parent)
            : `${parent} ${sel}`)))
          : own;
        rules.push({ selectors, body: ownDeclarations(live.slice(i + 1, close)), conditional });
        parse(i + 1, close, conditional, selectors);
      }

      i = close + 1;
      start = i;
    }
  };

  parse(0, live.length, false, []);
  return rules;
}



// dann mit '@' beginnt.
function cssRules(css) {
  const rules = [];
  for (const [, rawSelector, body] of stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.replace(/\s+/g, ' ').trim();
    if (!selector || selector.startsWith('@')) continue;
    rules.push({ selectors: selector.split(',').map((s) => s.trim()), body });
  }
  return rules;
}



function horizontalPaddings(body) {
  const values = [];
  for (const [, prop, raw] of body.matchAll(/(?:^|;)\s*(padding(?:-inline(?:-start|-end)?|-left|-right)?)\s*:\s*([^;]+)/g)) {
    const value = raw.trim();
    if (prop !== 'padding') { values.push(value); continue; }


    const parts = value.match(/(?:[a-z-]+\([^()]*(?:\([^()]*\)[^()]*)*\)|\S)+/gi) || [];
    values.push(parts.length === 1 ? parts[0] : parts[1]);
  }
  return values.filter(Boolean);
}

const ALLOWED_INLINE = /^(0|0px|var\(--page-inline-pad\))$/;



//
// Der kitchen-tabs-Eintrag („.kitchen-tabs-bar .sub-tab: Button-Innenabstand








const RAIL_PAD_EXCEPTIONS = [
  {
    file: 'layout.css',
    selector: '.page-toolbar--narrow:has(> .page-toolbar__bar)',

    // gedeckelter Kopf MIT Bar-Zeile deckelt beide Zeilen ueber





    reason: 'Lesemass-Deckelung beider Kopfzeilen; der ::after-Slot deckt nur eine',
  },
];

const isException = (file, selector) => RAIL_PAD_EXCEPTIONS.some(
  (e) => file === e.file && selector.includes(e.selector),
);






//





//



//








// Screenshot-Pipeline.
test('page-inline-pad contract holds across every stylesheet (#577)', () => {

  // Canonical Page Head und behalten ihren zentrierten Block.
  const bleedModules = [
    'tasks', 'notes', 'contacts', 'documents', 'housekeeping', 'rewards',
    'budget', 'calendar', 'birthdays', 'meals', 'shopping', 'recipes', 'health',
  ];



  //


  // Interpolation im Attribut (`class="... ${x ? 'a' : ''}"`) lieferte ihm

  // anschliessend jeden Selektor jeder Datei. Beide Zusicherungen dieses Tests
  // schlugen daraufhin an Stellen fehl, die niemand angefasst hatte



  const CLASS_NAME = /^-?[A-Za-z_][\w-]*$/;
  const rails = new Set(['.page-toolbar', '.sub-tabs-bar']);
  const addRails = (classList, file) => {
    const parts = classList.split(/\s+/).filter(Boolean);




    assert.ok(!classList.includes('${'),
      `${file}: die Klassenliste eines page-toolbar-Rails enthält eine Interpolation `
      + `("${classList.slice(0, 60)}…") - dieser Scan liest sie statisch, und die `
      + 'Bruchstücke landen sonst als Rail-Aliasse in jeder Zusicherung darunter');
    parts.forEach((c) => {
      assert.match(c, CLASS_NAME, `${file}: "${c}" ist kein Klassenname`);
      rails.add(`.${c}`);
    });
  };
  for (const file of walkJsFiles('../public/pages/')) {
    const src = stripCssComments(read(file));
    for (const [, classList] of src.matchAll(/class="([^"]*\bpage-toolbar\b[^"]*)"/g)) {
      addRails(classList, file);
    }
    for (const [, classList] of src.matchAll(/className\s*=\s*'([^']*\bpage-toolbar\b[^']*)'/g)) {
      addRails(classList, file);
    }
  }
  for (const util of ['kitchen-tabs', 'health-tabs']) {
    for (const [, cls] of read(`../public/utils/${util}.js`).matchAll(/extraClass:\s*'([^']+)'/g)) {
      cls.split(/\s+/).filter(Boolean).forEach((c) => rails.add(`.${c}`));
    }
  }
  assert.ok(rails.size >= 4, 'Rail-Aliasse konnten nicht aus dem Markup gelesen werden');

  const styleFiles = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((f) => f.endsWith('.css'));

  // (1) Kein Stylesheet darf ein Rail horizontal umpolstern - egal welche Datei,





  //     dokumentierter Ausnahme-Eintrag je Fundstelle.
  for (const file of styleFiles) {
    for (const rule of cssRules(read(`../public/styles/${file}`))) {
      const hitsRail = rule.selectors.some((sel) => {
        const subject = sel.trim().split(/[\s>+~]+/).filter(Boolean).pop() ?? '';
        return [...rails].some(
          (rail) => new RegExp(`${rail.replace('.', '\\.')}(?![\\w-])`).test(subject),
        );
      });
      if (!hitsRail) continue;
      for (const value of horizontalPaddings(rule.body)) {
        if (isException(file, rule.selectors.join(', '))) continue;
        assert.ok(
          ALLOWED_INLINE.test(value),
          `${file}: "${rule.selectors.join(', ')}" setzt horizontales Padding "${value}" auf einem Full-bleed-Rail. `
          + 'Erlaubt sind nur 0 und var(--page-inline-pad) (#577)',
        );
      }
    }
  }



  //
  // Composition pages may move the gutter to `.app-page__body` in layout.css
  // (PAGE-COMPOSITION.md). That counts as the carrier when the page root uses
  // `.app-page` / `renderAppPage` and the module CSS no longer repeats the pad.
  const layoutCss = read('../public/styles/layout.css');
  const compositionBodyOwnsPad = /\.app-page--(?:reading|form|data|dashboard)\s*>\s*\.app-page__body[\s\S]{0,200}?padding-inline:\s*var\(--page-inline-pad\)/.test(layoutCss);

  for (const mod of bleedModules) {
    const css = read(`../public/styles/${mod}.css`);
    const rules = cssRules(css);
    const carriers = new Set(
      rules.filter((r) => /padding-inline:\s*var\(--page-inline-pad\)|margin-inline:\s*var\(--page-inline-pad\)/.test(r.body))
        .flatMap((r) => r.selectors),
    );
    const pageFile = `../public/pages/${mod}.js`;
    const pageSrc = existsSync(new URL(pageFile, import.meta.url)) ? read(pageFile) : '';
    const usesCompositionBody = /app-page|renderAppPage/.test(pageSrc) && compositionBodyOwnsPad;
    assert.ok(carriers.size > 0 || usesCompositionBody,
      `${mod}: kein Träger der Content-Spalte (--page-inline-pad) gefunden (#577)`);

    for (const rule of rules) {
      for (const sel of rule.selectors.filter((s) => carriers.has(s))) {
        for (const value of horizontalPaddings(rule.body)) {
          assert.ok(
            ALLOWED_INLINE.test(value),
            `${mod}.css: "${sel}" trägt die Content-Spalte, überschreibt sie aber mit "${value}" (#577)`,
          );
        }
      }
    }


    for (const rule of rules) {
      if (!rule.selectors.some((s) => new RegExp(`\\.${mod === 'split-expenses' ? 'split' : '[a-z-]+'}-page$`).test(s))) continue;
      assert.doesNotMatch(
        rule.body,
        /(?:^|;)\s*(?:max-)?(?:width|inline-size)\s*:/,
        `${mod}: Modul-Root darf sich nicht selbst deckeln — die Content-Spalte kommt aus --page-inline-pad (#577)`,
      );
    }
  }

  // (4) Die Token-Definition selbst.
  const tokens = stripCssComments(read('../public/styles/tokens.css'));
  assert.match(
    tokens,
    /--page-inline-pad:\s*max\(\s*var\(--page-gutter\),\s*calc\(\(100% - var\(--content-max-width\)\) \/ 2\)\s*\)/,
    'tokens.css muss
  );
  assert.match(
    tokens,
    /@media \(min-width:\s*1024px\)\s*\{\s*:root\s*\{\s*--page-gutter:\s*var\(--space-8\)/,
    '--page-gutter muss ab 1024px auf --space-8 gehen (eine Quelle für Kopf und Body)',
  );
});

test('wer seinen Körper aufs Lesemaß kappt, kappt auch seinen Kopf', () => {




  //



  // Gemessen bei 1280px: Liste bis x=972, Lagerort-Knopf bis x=1248.


  const narrowBody = /class(?:Name)?\s*=\s*['"`][^'"`]*\blist-scroller\b/;
  const pages = walkJsFiles('../public/pages/')
    .filter((file) => narrowBody.test(read(file)));
  assert.ok(pages.length >= 3, 'keine Seite mit .list-scroller gefunden - Scan ist blind geworden');






  // Chip-Leiste.
  //




  let headsChecked = 0;
  const headless = [];

  for (const file of pages) {
    const src = read(file);

    // Lesemass je SICHT am Koerper toggelt (page-measure--narrow / is-reading-measure), den Kopf






    // weiter geprueft.
    if (/classList\.toggle\(\s*'(?:page-measure--narrow|is-reading-measure)'/.test(src)
      && !/classList\.toggle\(\s*'page-toolbar--narrow'/.test(src)) continue;

    const heads = [
      ...src.matchAll(/class="([^"]*\bpage-toolbar\b[^"]*)"/g),
      ...src.matchAll(/className\s*=\s*'([^']*\bpage-toolbar\b[^']*)'/g),
    ].map(([, classList]) => classList);
    if (!heads.length) { headless.push(file); continue; }
    for (const classList of heads) {
      headsChecked++;
      assert.ok(
        /\bpage-toolbar--narrow\b/.test(classList),
        `${file}: "${classList}" - der Körper endet bei --content-max-width-narrow, `
        + 'der Kopf muss dieselbe Kante halten (page-toolbar--narrow)',
      );
    }
  }

  assert.ok(
    headsChecked >= 2,
    `Nur ${headsChecked} Kopf/Köpfe geprüft (kopflos: ${headless.join(', ') || 'keine'}). `
    + 'Unter zwei misst dieser Guard nichts mehr - hat sich die Schreibweise von '
    + '.page-toolbar geändert, oder haben die Küchen-Listen ihre Köpfe alle verloren?',
  );



  //








  const layout = stripCssComments(read('../public/styles/layout.css'));
  const narrowRules = cssRules(read('../public/styles/layout.css'))
    .filter((r) => r.selectors.some((sel) => /\.page-toolbar--narrow(?![\w-])/.test(sel)));



  // ginge auch `.page-toolbar--narrow { max-width: var(--content-max-width-narrow) }`

  // rail-brechend aus.
  const spacer = narrowRules.filter((r) =>
    r.selectors.some((sel) => /\.page-toolbar--narrow::after\b/.test(sel))
    && /flex(?:-basis)?:[^;]*var\(--page-measure,\s*var\(--layout-reading\)\)|flex(?:-basis)?:[^;]*var\(--layout-reading\)/.test(r.body));
  assert.equal(
    spacer.length, 1,
    'layout.css: .page-toolbar--narrow::after muss das Ende seiner Zeile als Flex-Slot auf '
    + '--page-measure/--layout-reading zurückholen (genau eine Regel, gefunden: ' + spacer.length + ')',
  );







  for (const rule of narrowRules) {
    assert.doesNotMatch(
      rule.body,
      /margin-(?:inline-end|right):\s*max\(/,
      `layout.css: "${rule.selectors.join(', ')}" setzt den Lesemaß-Abstand wieder als Marge - `
      + 'eine Marge gibt nie nach und zählt trotzdem in die Flex-Zeilenbelegung (#882)',
    );
  }



  for (const file of ['shopping.css', 'pantry.css', 'recipes.css', 'list-row.css']) {
    assert.doesNotMatch(
      stripCssComments(read(`../public/styles/${file}`)),
      /page-toolbar[^{]*>\s*\*\s*\{[^}]*max-width/,
      `${file}: Slot-Breiten kappen holt den Kopf nicht zurück - das macht .page-toolbar--narrow`,
    );
  }
});


// Er schrieb die IMPLEMENTIERUNGSWAHL fest - `wireTablist` gegen




// Muster einzureihen. Die Zusage prueft jetzt


// Routenliste statt ueber drei Modulnamen. Zwei Guards fuer dieselbe Zusage
// waeren zwei Wahrheiten.

// #565: Element.scrollIntoView() beim aktiven Tab scrollt jeden scrollbaren




test('wireTablist scrolls only its own bar, never via scrollIntoView (#565)', () => {
  const tablist = read('../public/utils/tablist.js');
  assert.doesNotMatch(
    tablist,
    /\.scrollIntoView\(/,
    'tablist.js darf scrollIntoView() nicht nutzen — es scrollt overflow:hidden-Vorfahren mit (#565)',
  );
  assert.match(
    tablist,
    /container\.scrollLeft/,
    'tablist.js muss den aktiven Tab durch container-eigenes scrollLeft ins Bild holen',
  );
});

test('priority badges and meal labels meet WCAG AA contrast in both themes', () => {
  const tokens = read('../public/styles/tokens.css');
  const rootBlock = tokens.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlock = darkAttrBlock(tokens);
  assert.ok(rootBlock, 'expected a :root token block');
  assert.ok(darkBlock, 'expected a [data-theme="dark"] block');

  const light = parseTokenMap(rootBlock[1]);
  const dark = new Map(light);
  for (const [key, value] of parseTokenMap(darkBlock[1])) dark.set(key, value);

  const pairs = [
    ['--color-priority-low', '--color-priority-low-bg'],
    ['--color-priority-medium', '--color-priority-medium-bg'],
    ['--color-priority-high', '--color-priority-high-bg'],
    ['--color-priority-urgent', '--color-priority-urgent-bg'],
  ];

  for (const [theme, map] of [['light', light], ['dark', dark]]) {
    const surface = resolveColor('--color-surface-work', map);
    for (const [foregroundToken, backgroundToken] of pairs) {
      const foreground = resolveColor(foregroundToken, map);
      const background = compositeColor(resolveColor(backgroundToken, map), surface);
      const ratio = contrastRatio(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${foregroundToken} on ${backgroundToken} is ${ratio.toFixed(2)}:1`,
      );
    }

    for (const mealToken of ['--meal-breakfast', '--meal-lunch', '--meal-dinner', '--meal-snack']) {
      const mealColor = resolveColor(mealToken, map);
      const mealRatio = contrastRatio(mealColor, surface);
      assert.ok(mealRatio >= 4.5, `${theme}: ${mealToken} is ${mealRatio.toFixed(2)}:1`);
    }
  }
});

test('recipe provider source badges meet WCAG AA contrast in both themes', () => {
  const recipesCss = read('../public/styles/recipes.css');
  const providers = [...recipesCss.matchAll(
    /\.source-badge--([\w-]+)\s*\{\s*background:\s*var\(--source-\1-light\);\s*color:\s*var\(--source-\1\);\s*\}/g,
  )].map((m) => m[1]);
  assert.ok(providers.length >= 2, `expected at least the mealie/tandoor badge rules, found ${providers.length}`);

  const { light, dark } = themeTokenMaps();
  for (const [theme, map] of [['light', light], ['dark', dark]]) {
    for (const provider of providers) {
      const foreground = resolveColor(`--source-${provider}`, map);
      const background = resolveColor(`--source-${provider}-light`, map);
      assert.ok(foreground && background, `${theme}: --source-${provider}/-light must resolve to hex colors`);
      const ratio = contrastRatio(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${theme}: --source-${provider} (${foreground}) on --source-${provider}-light (${background}) ` +
        `is ${ratio.toFixed(2)}:1, below WCAG AA 4.5:1`,
      );
    }
  }
});

test('budget bars animate with transforms instead of layout-driving widths', () => {
  const budgetPage = read('../public/pages/budget.js');
  const budgetCss = read('../public/styles/budget.css');

  assert.doesNotMatch(budgetCss, /transition:\s*width/);
  assert.match(budgetCss, /\.budget-bar-row__fill\s*\{[\s\S]*transform:\s*scaleX\(var\(--bar-scale,\s*0\)\)[\s\S]*transition:\s*transform/);
  assert.match(budgetCss, /\.budget-loan-card__progress span\s*\{[\s\S]*transform:\s*scaleX\(var\(--bar-scale,\s*0\)\)/);




  assert.match(budgetPage, /class="budget-bar-row__fill [^"]*" style="--bar-scale:\$\{/);
  assert.match(budgetPage, /style="--bar-scale:\$\{paidPct\s*\/\s*100\}"/);
  assert.doesNotMatch(budgetPage, /style="width:\$\{(?:pct|paidPct)\}%/);
});

test('ein Kategoriebalken bleibt proportional - kein Prozentboden im Anteil', () => {
  const budgetCss = read('../public/styles/budget.css');
  const builders = ['../public/pages/budget.js', '../public/pages/budget-stats.js'];

  for (const file of builders) {
    const src = read(file);
    assert.ok(
      src.includes('budget-bar-row__fill'),
      `${file} baut keine Kategoriezeile mehr - Guard-Korpus pruefen, nicht die Zusicherung streichen`,
    );
    const scaleExprs = [...src.matchAll(/--bar-scale:\$\{([^}]+)\}/g)].map((m) => m[1]);
    assert.ok(scaleExprs.length > 0, `${file}: kein --bar-scale gefunden`);
    for (const expr of scaleExprs) {
      const ident = expr.match(/^([A-Za-z_$][\w$]*)/)?.[1];
      assert.ok(ident, `${file}: "${expr}" ist kein Bezeichner - Guard anpassen, nicht umgehen`);
      const decls = [...src.matchAll(new RegExp(`\\bconst\\s+${ident}\\s*=\\s*([^;]+);`, 'g'))];
      assert.ok(decls.length > 0, `${file}: keine Zuweisung fuer "${ident}" gefunden`);
      for (const decl of decls) {
        for (const m of decl[1].matchAll(/Math\.max\(\s*(-?\d+(?:\.\d+)?)/g)) {
          assert.equal(
            Number(m[1]), 0,
            `${file}: "const ${ident} = ${decl[1].trim()}" klemmt den Anteil bei ${m[1]} `
            + 'nach oben von null weg. Ein Mindestbalken ist eine Laenge (min-inline-size im '
            + 'CSS), kein Anteil - sonst zeichnet er ungleiche Betraege gleich. '
            + 'Math.max(0, …) bleibt erlaubt.',
          );
        }
      }
    }
  }



  assert.match(
    budgetCss,
    /min-inline-size:\s*calc\(var\(--bar-visible,\s*0\)\s*\*\s*var\(--space-0h\)\)/,
    'der sichtbare Mindestbalken muss als Laenge im CSS stehen',
  );
  for (const file of builders) {
    assert.match(
      read(file),
      /--bar-visible:\$\{[^}]*!==\s*0[^}]*\}/,
      `${file}:
    );
  }
});

test('dashboard and task progress bars animate with transforms instead of widths', () => {
  const dashboardPage = read('../public/pages/dashboard.js');
  const dashboardCss = read('../public/styles/dashboard.css');
  const tasksPage = read('../public/pages/tasks.js');
  const tasksCss = read('../public/styles/tasks.css');

  assert.match(
    dashboardCss,
    /\.shopping-widget-list__bar\s*\{[\s\S]*transform-origin:\s*left[\s\S]*transform:\s*scaleX\(var\(--progress-scale,\s*0\)\)[\s\S]*transition:\s*transform/,
  );
  assert.doesNotMatch(cssRuleBody(dashboardCss, '.shopping-widget-list__bar'), /transition:\s*width/);
  assert.match(dashboardPage, /style="--progress-scale:\$\{progress\s*\/\s*100\}"/);
  assert.doesNotMatch(dashboardPage, /shopping-widget-list__bar" style="width:/);

  assert.match(
    tasksCss,
    /\.subtask-progress__bar-fill\s*\{[\s\S]*transform-origin:\s*left[\s\S]*transform:\s*scaleX\(var\(--progress-scale,\s*0\)\)[\s\S]*transition:\s*transform/,
  );
  assert.doesNotMatch(cssRuleBody(tasksCss, '.subtask-progress__bar-fill'), /transition:\s*width/);
  assert.match(tasksPage, /style="--progress-scale:\$\{progress\s*\/\s*100\}"/);
  assert.doesNotMatch(tasksPage, /subtask-progress__bar-fill" style="width:/);
});

test('toolbar "new" buttons are hidden via a shared class, not an ID list (audit 1.9)', () => {
  const layout = read('../public/styles/layout.css');
  assert.match(layout, /\.toolbar-new-btn\s*\{\s*display:\s*none\s*!important;/, 'expected .toolbar-new-btn rule');
  assert.doesNotMatch(layout, /#btn-new-task,\s*\n\s*#notes-add-btn/, 'legacy ID-list selector must be gone');

  const pages = {
    '../public/pages/tasks.js': 'btn-new-task',
    '../public/pages/notes.js': 'notes-add-btn',
    '../public/pages/contacts.js': 'contacts-add-btn',
    '../public/pages/budget.js': 'budget-add',
    '../public/pages/calendar.js': 'cal-add',
  };
  for (const [file, id] of Object.entries(pages)) {
    const src = read(file);
    const btn = src.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
    assert.ok(btn, `${file} must keep #${id}`);
    assert.match(btn[0], /toolbar-new-btn/, `${file} #${id} must carry the .toolbar-new-btn class`);
  }
});

test('every primary "new" control names its noun from newLabel.* (one register)', () => {
  const stripJs = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  const deLocale = JSON.parse(read('../public/locales/de.json'));
  const pages = walkJsFiles('../public/pages/').filter((p) => p.endsWith('.js'));

  const fabs = [];
  const toolbarButtons = [];
  for (const path of pages) {
    const src = stripJs(read(path));
    for (const tag of src.match(/<button[^>]*class="[^"]*\bpage-fab\b[^"]*"[^>]*>/g) ?? []) {
      fabs.push({ path, tag });
    }
    // Die zweite Schreibweise: per DOM-API gebaute FABs (Rezepte, Vorrat).
    for (const block of src.match(/className\s*=\s*'page-fab'[\s\S]{0,400}/g) ?? []) {
      fabs.push({ path, tag: block, built: true });
    }
    for (const tag of src.match(/<button[^>]*class="[^"]*\btoolbar-new-btn\b[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? []) {
      toolbarButtons.push({ path, tag });
    }
  }



  assert.ok(fabs.length >= 12, `expected at least 12 .page-fab declarations, found ${fabs.length}`);
  assert.ok(toolbarButtons.length >= 5, `expected at least 5 .toolbar-new-btn, found ${toolbarButtons.length}`);

  const keyOf = (text) => text.match(/newLabel\.([A-Za-z]+)/)?.[1];

  for (const { path, tag, built } of fabs) {


    if (/id="fab-main"/.test(tag)) continue;
    const attr = built ? /dataset\.dockLabel\s*=\s*t\('newLabel\.[A-Za-z]+'\)/ : /data-dock-label="\$\{t\('newLabel\.[A-Za-z]+'\)\}"/;
    assert.match(tag, attr,
      `${path}: jeder .page-fab braucht data-dock-label aus newLabel.* - ohne dockt er am Zeigergeraet still nicht an`);
    const key = keyOf(tag);
    assert.ok(deLocale.newLabel?.[key], `${path}: newLabel.${key} fehlt in de.json`);
  }

  for (const { path, tag } of toolbarButtons) {
    assert.match(tag, /<span class="toolbar-new-btn__label">\$\{t\('newLabel\.[A-Za-z]+'\)\}<\/span>/,
      `${path}: der sichtbare Text eines .toolbar-new-btn kommt aus newLabel.*, nicht aus einem aria-label-Satz`);
    assert.match(tag, /aria-label="/, `${path}: das ausfuehrliche aria-label bleibt am Knopf`);
    assert.doesNotMatch(tag, /\bbtn--icon\b/,
      `${path}: ein beschrifteter Primaerknopf ist keine Icon-Kapsel mehr (Kalender und Budget waren die letzten zwei)`);
    const key = keyOf(tag);
    assert.ok(deLocale.newLabel?.[key], `${path}: newLabel.${key} fehlt in de.json`);
  }





  // jeden Fabrik-Knopf per Konstruktion ausgeschlossen - still.




  const fabFactory = stripJs(read('../public/utils/fab.js'));
  for (const fn of ['pageFabHtml', 'createPageFab', 'setPageFabAction']) {
    const signature = fabFactory.match(new RegExp(`export function ${fn}\\s*\\([^)]*\\)`));
    assert.ok(signature, `${fn} not found in utils/fab.js`);
    assert.match(signature[0], /dockLabel/, `utils/fab.js ${fn} muss dockLabel als Parameter annehmen`);
  }

  assert.match(fabFactory, /else delete fab\.dataset\.dockLabel/,
    'setPageFabAction muss ein leeres dockLabel als Entfernen behandeln, nicht als "unveraendert"');



  const router = stripJs(read('../public/router.js'));
  const dock = router.match(/function dockFabIntoToolbar[\s\S]*?\n}/);
  assert.ok(dock, 'dockFabIntoToolbar not found');
  assert.match(dock[0], /fab\.dataset\.dockLabel/, 'dockFabIntoToolbar muss data-dock-label lesen');
  assert.doesNotMatch(dock[0], /getAttribute\('aria-label'\)/,
    'dockFabIntoToolbar darf den sichtbaren Text nicht mehr aus aria-label nehmen');
  assert.match(dock[0], /if\s*\(!label\)\s*return false/,
    'ohne data-dock-label dockt der Knopf gar nicht an, statt auf den langen Satz zurueckzufallen');
});

test('shopping hides its FAB exactly where the quick-add row opens', () => {
  const css = read('../public/styles/shopping.css');





  const regeln = [...eachRule(css)].filter((r) => /#fab-new-item/.test(r.selector));
  for (const rule of regeln) {
    assert.match(rule.at.join(' '), /\(hover:\s*hover\)/,
      'der FAB weicht unter (hover: hover) - derselben Bedingung, die .quick-add aufklappt');
  }
  const versteckt = regeln.filter((r) => /display:\s*none/.test(r.body));
  assert.equal(versteckt.length, 1,
    'erwartet genau eine Regel, die #fab-new-item am Zeigergeraet ausblendet');
  assert.ok(regeln.some((r) => /--fab-safe-zone:\s*0/.test(r.body)),
    'und daneben die, die ihm seinen Nachlauf nimmt - sonst reserviert der '
    + 'Scrollport 96px fuer einen Knopf ohne Flaeche (Etappe 6)');



  const page = read('../public/pages/shopping.js');
  assert.match(page, /class="page-fab" id="fab-new-item"/,
    'der FAB wird versteckt, nicht entfernt - sonst stirbt der click()-Aufruf still');
});

test('login keeps username-style input hints, not email (audit 1.6 — login is by username)', () => {
  const src = read('../public/pages/login.js');
  const input = src.match(/<input[\s\S]*?id="username"[\s\S]*?\/>/);
  assert.ok(input, 'expected a username input');
  assert.match(input[0], /type="text"/, 'username field stays type=text (login is by username, not email)');
  assert.match(input[0], /autocomplete="username"/);
  assert.match(input[0], /autocapitalize="none"/);
  assert.match(input[0], /autocorrect="off"/);
  assert.doesNotMatch(input[0], /type="email"|inputmode="email"/, 'must not use email keyboard for username login');
});








test('split expenses reflows from container width, not viewport width', () => {
  const split = read('../public/styles/split-expenses.css');

  assert.match(
    cssRuleBody(split, '.split-page'),
    /container:\s*split-page\s*\/\s*inline-size/,
    '.split-page muss ein inline-size-Container sein (Gast-Route und Budget-Tab teilen die Regeln)',
  );
  assert.match(
    cssRuleBody(split, '.split-main'),
    /container:\s*split-main\s*\/\s*inline-size/,
    '.split-main braucht eine eigene Ebene — es steht hinter dem Gruppen-Panel und hat weniger Platz als .split-page',
  );

  assert.match(
    split,
    /@container split-page \(max-width:\s*719px\)[\s\S]*\.split-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    '.split-layout stapelt nach eigener Breite; minmax(0, 1fr) verhindert, dass die 240px-Gruppenkachel die Spalte aufbläht',
  );
  assert.match(
    split,
    /@container split-main \(max-width:\s*639px\)[\s\S]*\.split-content-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    'das Kartenraster stapelt nach der Breite von .split-main, nicht nach dem Viewport',
  );


  assert.match(
    split,
    /\n\.split-groups-panel\s*\{[^}]*min-width:\s*0/,
    'Grid-Items haben min-width: auto — ohne 0 schiebt die Gruppen-Leiste die Seite über ihren Rand',
  );
  assert.match(
    cssRuleBody(split, '.split-card-head'),
    /flex-wrap:\s*wrap/,
    'Titel und Zusatz der Kartenköpfe brechen um, statt in die Nachbarkarte zu laufen',
  );

  assert.doesNotMatch(
    split,
    /@media \(max-width:\s*1023px\)/,
    'Spaltenumbrüche gehören in @container-Queries — der 1023px-Breakpoint misst den Viewport statt den verfügbaren Platz',
  );


  assert.doesNotMatch(
    split,
    /@media[^{]*\{[\s\S]*grid-template-columns/,
    'kein Raster darf mehr an einer Viewport-Query hängen',
  );
});



// selbst (i18n.js: `?? key`) — im Feed stand so sichtbar

// scripts/seed-demo.js erfand (expense_added, settlement_added), plus eine echte



test('split activity feed translates every type the backend writes', () => {
  const sources = {
    'server/routes/split-expenses.js': read('../server/routes/split-expenses.js'),
    'server/services/split-expenses-scheduler.js': read('../server/services/split-expenses-scheduler.js'),
    'scripts/seed-demo.js': read('../scripts/seed-demo.js'),
  };

  // activity(groupId, actor, 'type', …) bzw. insertActivity(db, …, 'type', …).


  // optionale Vorlauf-Zweig.
  const ENTITY_TYPES = String.raw`'(?:expense|group|member|settlement|recurring_expense)'`;
  const found = new Map();
  for (const [file, src] of Object.entries(sources)) {
    const pattern = new RegExp(String.raw`(?:'([a-z_]+)'\s*:\s*)?'([a-z_]+)',\s*${ENTITY_TYPES}`, 'g');
    for (const [, ternaryBranch, type] of src.matchAll(pattern)) {
      for (const found_type of [ternaryBranch, type]) {
        if (found_type && !found.has(found_type)) found.set(found_type, file);
      }
    }
  }



  assert.ok(found.size >= 15, `erwartet mindestens 15 Aktivitätstypen, gefunden: ${[...found.keys()].join(', ')}`);

  const de = JSON.parse(read('../public/locales/de.json'));
  const translated = Object.keys(de.splitExpenses.activityType);

  const untranslated = [...found].filter(([type]) => !translated.includes(type));
  assert.deepEqual(
    untranslated.map(([type, file]) => `${type} (${file})`),
    [],
    'jeder geschriebene Aktivitätstyp braucht splitExpenses.activityType.<type> — sonst rendert der Feed den rohen Key',
  );



  const unwritten = translated.filter((type) => !found.has(type));
  assert.deepEqual(unwritten, [], 'verwaiste activityType-Keys — kein Codepfad schreibt diesen Typ');
});








test('demo seed writes only reminder offsets the birthday form offers', () => {
  const page = read('../public/pages/birthdays.js');
  const optionsBlock = page.match(/const REMINDER_OFFSETS = \(\) => \[([\s\S]*?)\];/);
  assert.ok(optionsBlock, 'REMINDER_OFFSETS in public/pages/birthdays.js nicht gefunden');
  const offered = [...optionsBlock[1].matchAll(/value:\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(offered.includes('1440'), `unerwartete Formularwerte: ${offered.join(', ')}`);

  const seed = read('../scripts/seed-demo.js');
  const start = seed.indexOf("console.log('Inserting birthdays");
  const end = seed.indexOf("console.log('Inserting documents");
  assert.ok(start > 0 && end > start, 'Geburtstagsblock im Seed nicht gefunden');
  const block = seed.slice(start, end);
  const constants = Object.fromEntries([...block.matchAll(/const (\w+)\s*=\s*'([^']*)';/g)].map((m) => [m[1], m[2]]));
  // Jede Zeile endet auf `…, <reminder_offset>, <created_by>],`.
  const tokens = [...block.matchAll(/,\s*('[^']*'|[A-Z_]+),\s*\w+Id\],/g)].map((m) => m[1]);
  assert.ok(tokens.length >= 8, `erwartet mindestens 8 Geburtstagszeilen, gefunden: ${tokens.length}`);
  const invalid = tokens
    .map((token) => [token, token.startsWith("'") ? token.slice(1, -1) : constants[token]])
    .filter(([, value]) => value === undefined || value === 'custom' || !offered.includes(value))
    .map(([token, value]) => `${token} = ${value}`);
  assert.deepEqual(invalid, [], `Seed-Vorlauf ausserhalb der Formularwerte (${offered.join(', ')})`);
});

// ============================================================



// ============================================================

function stylesheetFiles() {
  return readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((file) => file.endsWith('.css'))
    .map((file) => ({ file, css: read(`../public/styles/${file}`) }));
}

test('Viewport-Breakpoints halten den Kontrakt aus tokens.css §11c', () => {
  // Vier strukturelle Grenzen plus ihre max-width-Komplemente. Alles andere



  const allowed = new Set([639, 640, 767, 768, 1023, 1024, 1439, 1440]);
  const offenders = [];

  for (const { file, css } of stylesheetFiles()) {
    for (const match of css.matchAll(/@media[^{]*?\((?:min|max)-width:\s*(\d+)px\)/g)) {
      const px = Number(match[1]);
      if (!allowed.has(px)) {
        const line = css.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} → ${px}px`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'nicht-kanonischer Viewport-Breakpoint — erlaubt sind nur 640/768/1024/1440 (+ Komplemente)',
  );
});

test('die Höhen-Achse der Größenklasse hält denselben Kontrakt', () => {





  // zwar unbemerkt, weil niemand nach ihr sucht.
  //


  //






  //

  // selbst (>= 500).
  const allowed = { max: 499, min: 500 };
  const offenders = [];

  for (const { file, css } of stylesheetFiles()) {
    for (const match of css.matchAll(/@media[^{]*?\((min|max)-height:\s*(\d+)px\)/g)) {
      const px = Number(match[2]);
      if (px !== allowed[match[1]]) {
        const line = css.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} → ${match[1]}-height: ${px}px`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'nicht-kanonische Höhen-Schwelle — erlaubt sind nur `max-height: 499px` und '
    + '`min-height: 500px`, siehe tokens.css §11c und DESIGN.md „Die Chrome-Regel"',
  );
});

test('Icon-Größen kommen aus der Utility-Skala, nie aus Inline-Styles', () => {
  const offenders = [];
  for (const path of walkFrontendFiles('../public/pages/')
    .concat(walkFrontendFiles('../public/settings/'))
    .concat(walkFrontendFiles('../public/components/'))
    .concat(walkFrontendFiles('../public/utils/'))) {
    const src = read(path);

    for (const match of src.matchAll(/<i\b[^>]*data-lucide[^>]*>/g)) {
      if (/(?:style="[^"]*(?:width|height)|(?:^|\s)(?:width|height)=)/.test(match[0])) {
        const line = src.slice(0, match.index).split('\n').length;
        offenders.push(`${path}:${line}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Icon-Größe inline gesetzt — icon-sm/md/lg/xl verwenden (Werte: --icon-* in tokens.css)',
  );
});

test('die Icon-Skala hat genau einen Namen pro Stufe', () => {
  const layout = read('../public/styles/layout.css');
  const tokens = read('../public/styles/tokens.css');

  const sizes = new Map();
  for (const match of layout.matchAll(/^\.(icon-[a-z0-9]+)\s*\{([^}]*)\}/gm)) {
    const width = match[2].match(/width:\s*var\((--icon-[a-z]+)\)/);
    assert.ok(width, `${match[1]} muss seine Breite aus einem --icon-*-Token ziehen`);
    sizes.set(match[1], width[1]);
  }

  assert.deepEqual(
    [...sizes.keys()].sort(),
    ['icon-lg', 'icon-md', 'icon-sm', 'icon-xl'],
    'genau vier Icon-Klassen — frühere Aliase (.icon-xs/.icon-11/.icon-base/.icon-2xl) trugen dieselben Werte',
  );


  const used = [...sizes.values()];
  assert.equal(new Set(used).size, used.length, 'zwei Icon-Klassen zeigen auf dasselbe --icon-*-Token');

  const values = used.map((token) => {
    const declared = tokens.match(new RegExp(`\\${token}:\\s*(\\d+)px`));
    assert.ok(declared, `${token} fehlt in tokens.css`);
    return Number(declared[1]);
  });
  assert.equal(new Set(values).size, values.length, 'zwei --icon-*-Tokens haben denselben px-Wert');
});

test('Dialoge laufen über die Modal-Komponente, nicht über native Browser-Dialoge', () => {

  // keinen Fokus-Trap und keine Danger-Farbe. confirmModal/promptModal/

  const native = /(?:\bwindow\.(?:confirm|alert|prompt)\s*\(|(?:^|[^.\w])(?:confirm|alert|prompt)\s*\()/;
  const offenders = [];

  for (const path of walkFrontendFiles('../public/pages/')
    .concat(walkFrontendFiles('../public/settings/'))
    .concat(walkFrontendFiles('../public/components/'))
    .concat(walkFrontendFiles('../public/utils/'))) {
    read(path).split('\n').forEach((line, index) => {
      if (native.test(line)) offenders.push(`${path}:${index + 1}`);
    });
  }

  assert.deepEqual(offenders, [], 'nativer Browser-Dialog — confirmModal/promptModal aus components/modal.js verwenden');
});

test('border-radius wird ausschließlich über Radius-Tokens gesetzt', () => {
  const offenders = [];
  for (const { file, css } of stylesheetFiles()) {
    if (file === 'tokens.css') continue;
    for (const match of css.matchAll(/border-radius(?:-[a-z-]+)?:\s*([^;}]+)/g)) {
      const value = match[1].trim();
      if (/^(0|none|inherit|initial|unset)$/.test(value)) continue;
      if (/%|var\(--radius/.test(value)) continue;
      const line = css.slice(0, match.index).split('\n').length;
      offenders.push(`${file}:${line} → ${value}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'roher border-radius —
  );
});

test('der neutralisierte Modal-Footer ist eine Klasse, kein Inline-Style', () => {
  // Zwanzig Stellen bauten border/padding/margin desselben Footers inline nach —

  const offenders = [];
  for (const path of walkFrontendFiles('../public/pages/')
    .concat(walkFrontendFiles('../public/settings/'))
    .concat(walkFrontendFiles('../public/components/'))) {
    const src = read(path);
    for (const match of src.matchAll(/<div[^>]*modal-panel__footer[^>]*>/g)) {
      if (/style="/.test(match[0])) {
        offenders.push(`${path}:${src.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'Modal-Footer inline neutralisiert — modal-panel__footer--plain verwenden');

  const layout = read('../public/styles/layout.css');
  assert.match(
    layout,
    /\.modal-panel__footer\.modal-panel__footer--plain\s*\{/,
    'die
  );
});




// Komponenten-Set - solange `components.js` keinen Schalter anbot, erfand jedes
// neue Blatt eine weitere Variante.
test('Settings-Schalter kommen aus createToggleRow, nicht aus handgeschriebenem Markup', () => {
  const components = read('../public/settings/components.js');
  assert.match(components, /export function toggleRowHtml\(/);
  assert.match(components, /export function createToggleRow\(/);

  const offenders = [];
  for (const path of walkFrontendFiles('../public/settings/')) {
    if (path.endsWith('components.js')) continue;
    const src = read(path);



    for (const pattern of [
      /<label[^>]*class="[^"]*\btoggle-row\b/g,
      /class="[^"]*\bsettings-toggle\b/g,
      /class="[^"]*\btoggle__track\b/g,
    ]) {
      for (const match of src.matchAll(pattern)) {
        offenders.push(`${path}:${src.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'Schalter über toggleRowHtml()/createToggleRow() bauen');



  const styles = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((file) => file.endsWith('.css'))
    .map((file) => read(`../public/styles/${file}`))
    .join('\n');
  assert.ok(!styles.includes('.settings-notice'), 'settings-notice ist keine echte Klasse');
  for (const path of walkFrontendFiles('../public/settings/')) {
    assert.ok(
      !/class(Name)?\s*=\s*["'][^"']*\bsettings-notice\b/.test(read(path)),
      `${path} referenziert die klassenlose settings-notice`,
    );
  }
});



test('Settings-Blätter lesen und schreiben Preferences über den geteilten Cache', () => {
  const offenders = [];
  for (const path of walkFrontendFiles('../public/settings/')) {
    if (path.endsWith('preferences-cache.js')) continue;
    const src = read(path);
    for (const match of src.matchAll(/api\.(get|put)\(\s*['"]\/preferences['"]/g)) {
      offenders.push(`${path}:${src.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(offenders, [], 'getPreferences()/savePreferences() aus preferences-cache.js verwenden');

  const cache = read('../public/settings/preferences-cache.js');
  assert.match(cache, /export function resetPreferencesCache\(/);


  assert.match(cache, /finally\s*\{\s*pending = null;/);


  assert.match(read('../public/settings/shell.js'), /resetPreferencesCache\(\)/);
});




test('jedes Settings-Blatt importiert die geteilten Helfer, die es aufruft', () => {
  const sharedModules = [
    'components.js',
    'preferences-cache.js',
    'weather-location.js',
    'module-order.js',
    'currency.js',
    'region-presets.js',
  ];
  const owners = new Map();
  for (const mod of sharedModules) {
    const src = read(`../public/settings/${mod}`);
    for (const match of src.matchAll(/export (?:async )?function (\w+)|export const (\w+)/g)) {
      owners.set(match[1] ?? match[2], mod);
    }
  }
  assert.ok(owners.has('toggleRowHtml'), 'Der Guard braucht die Export-Liste, sonst prüft er nichts');

  const missing = [];
  for (const path of walkFrontendFiles('../public/settings/')) {
    if (sharedModules.some((mod) => path.endsWith(mod))) continue;
    const src = read(path);
    const imported = new Set(
      [...src.matchAll(/import\s*\{([^}]*)\}\s*from/gs)]
        .flatMap((match) => match[1].split(','))
        .map((part) => part.trim().split(/\s+as\s+/).pop().trim())
        .filter(Boolean),
    );
    for (const [name, mod] of owners) {
      if (new RegExp(`\\b${name}\\s*\\(`).test(src) && !imported.has(name)) {
        missing.push(`${path}: ruft ${name}() aus ${mod}, importiert es aber nicht`);
      }
    }
  }
  assert.deepEqual(missing, []);
});





test('Rechtevergabe ist auf dem Telefon beschriftet und mit dem Finger bedienbar', () => {
  const source = read('../public/settings/pages/admin-permissions.js');

  assert.match(source, /<span class="perm-seg__label">\$\{esc\(o\.label\)\}<\/span>/);


  assert.match(source, /aria-label="\$\{esc\(label \|\| group\)\}: \$\{esc\(o\.label\)\}"/);

  const css = read('../public/styles/settings.css');



  const touchQuery = '@media (max-width: 1023px), (pointer: coarse)';
  assert.ok(css.includes(touchQuery), 'Touch endet nicht bei 767px');
  const mobile = css.slice(css.indexOf(touchQuery, css.indexOf('.perm-modeswitch {')));
  assert.ok(mobile.includes('.perm-seg__label'), 'Der Touch-Block muss das Label sichtbar schalten');
  assert.match(mobile, /\.perm-modeswitch__btn,\s*\.perm-chip \{ min-height: var\(--target-base\); \}/);
  assert.match(mobile, /\.perm-seg__opt \{[^}]*min-height: var\(--target-base\);/s);

  // neben den Modulnamen.
  assert.match(mobile, /\.perm-row \{[^}]*flex-direction: column;/s);
  assert.match(mobile, /\.perm-seg \{[^}]*grid-template-columns: repeat\(var\(--seg-count, 3\), 1fr\);/s);


  assert.match(css, /\.perm-seg__label \{ display: none; \}/);
});




// 2026-07-27), waehrend admin-system es nebenan richtig machte.
test('admin-backup sagt bei Ladefehlern, dass der Stand unbekannt ist', () => {
  const source = read('../public/settings/pages/admin-backup.js');
  assert.match(source, /import \{[\s\S]*?createRetryState[\s\S]*?\} from '\/settings\/components\.js'/);


  const silentCatches = [...source.matchAll(/catch \((\w+)\) \{\s*console\.error\([^)]*\);?\s*\}/g)];
  assert.deepEqual(
    silentCatches.map((m) => m[0].slice(0, 60)),
    [],
    'Ladefehler brauchen einen sichtbaren Zustand, nicht nur console.error',
  );
  assert.equal([...source.matchAll(/createRetryState\(\{/g)].length, 2);



  // Verbindung ueberschreiben.
  assert.match(source, /form\.hidden = true;/);




  assert.match(
    read('../public/styles/settings.css'),
    /\.settings-page \[hidden\] \{ display: none !important; \}/,
  );
});



// Oberflaeche hatte die schwaechste Behandlung (Critique 2026-07-27).
test('das einmalig sichtbare API-Token laesst sich kopieren', () => {
  const source = read('../public/settings/pages/admin-api.js');
  assert.match(source, /id="api-token-copy"/);
  assert.match(source, /settings\.apiTokenCopy/);
  assert.match(source, /navigator\.clipboard\?\.writeText\(value\)/);
  assert.match(source, /settings\.apiTokenCopied/);

  // eigenen createIcons-Aufruf.
  assert.match(source, /window\.lucide\?\.createIcons\(\{ el: output \}\)/);
  assertKeysExistInEveryLocale(['settings.apiTokenCopy', 'settings.apiTokenCopied', 'email.saveFailed']);
});

// `housekeeping.deleteTaskConfirm` schrieb `{name}` statt `{{name}}` - in allen

// `Aufgabe "{name}" wirklich loeschen?` (public/pages/housekeeping.js:507).

test('kein Locale-String traegt einen einfach geklammerten Platzhalter', () => {
  const offenders = [];
  for (const file of readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(read(`../public/locales/${file}`));
    const walk = (node, path) => {
      for (const [key, value] of Object.entries(node)) {
        const at = path ? `${path}.${key}` : key;
        if (typeof value === 'string') {

          const single = value.match(/(?<!\{)\{[a-zA-Z_][a-zA-Z0-9_]*\}(?!\})/g);
          if (single) offenders.push(`${file}: ${at} -> ${single.join(', ')}`);
        } else if (value && typeof value === 'object') {
          walk(value, at);
        }
      }
    };
    walk(data, '');
  }
  assert.deepEqual(offenders, []);
});

test('settings.css haelt Zeilenlaenge, Token-Disziplin und keine toten Regeln', () => {
  const css = read('../public/styles/settings.css');



  assert.match(
    css,
    /\.settings-page \.form-hint,\s*\.settings-page \.settings-card-description,\s*\.settings-page \.settings-leaf-header__description \{\s*max-width: 50ch;/,
  );

  // 23x `1px solid` gegen 21x `var(--space-px) solid` in derselben Datei.
  assert.equal([...css.matchAll(/\b1px solid\b/g)].length, 0, 'Rahmenbreite kommt aus --space-px');




  // nennt die entfernte Klasse absichtlich.
  assert.ok(
    !/^\s*\.settings-breadcrumb__current\b/m.test(css),
    'shell.js erzeugt settings-breadcrumb__item--current, nicht __current',
  );
  const shell = read('../public/settings/shell.js');
  for (const cls of ['settings-breadcrumb__item--current', 'settings-breadcrumb__link']) {
    assert.ok(shell.includes(cls), `${cls} muss im Markup vorkommen, sonst ist die CSS-Regel tot`);
  }

  // Design-Werte gehoeren nicht ins JS.
  const backup = read('../public/settings/pages/admin-backup.js');
  assert.ok(!/\.style\.(opacity|color)\s*=/.test(backup), 'Tone/Opazitaet ueber Klassen, nicht inline');
  assert.match(css, /\.form-hint--success \{ color: var\(--color-success\); \}/);
  assert.match(css, /\.settings-page \.form-input:disabled \{/);
});




test('Avatar-Initialen waehlen die lesbare Textfarbe', async () => {
  const { contrastRatio, prefersInkText } = await import('../public/utils/contrast.js');


  for (const bg of ['#ec4899', '#f97316']) {
    assert.equal(prefersInkText(bg), true, `${bg} traegt Weiss nicht`);
    assert.ok(contrastRatio(bg, '#000000') >= 4.5);
  }

  // Wo Weiss reicht, bleibt es Weiss: kein flaechendeckendes Umfaerben.
  for (const bg of ['#7c3aed', '#2563eb']) {
    assert.equal(prefersInkText(bg), false, `${bg} haelt die Schwelle mit Weiss`);
    assert.ok(contrastRatio(bg, '#ffffff') >= 4.5);
  }


  assert.equal(prefersInkText('var(--color-accent)'), false);
  assert.equal(prefersInkText(null), false);
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);

  assert.equal(contrastRatio('#fff', '#000000'), contrastRatio('#ffffff', '#000000'));


  for (const leaf of ['admin-family', 'personal-account', 'admin-permissions']) {
    const source = read(`../public/settings/pages/${leaf}.js`);
    assert.match(source, /import \{ prefersInkText \} from '\/utils\/contrast\.js'/, `${leaf} importiert sie nicht`);
    assert.match(source, /prefersInkText\(/, `${leaf} ruft sie nicht auf`);
  }
  assert.match(read('../public/styles/settings.css'), /\.settings-avatar--ink,\s*\.perm-chip__avatar--ink \{\s*color: var\(--color-ink-on-bright\);/);
});





// harmlosere Budget-Dialog "Zugeordnete Buchungen bleiben erhalten" sagt
// (Critique 2026-07-27, zweiter Lauf).
//


// Folgentext da, ohne dass er anschlug. Er laeuft jetzt ueber ganz public/.


//




const DIALOG_FNS = ['confirmModal', 'confirmOverModal'];




function readCall(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const prev = src[i - 1];
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      else if (quote === '`' && c === '{' && prev === '$') {
        let d = 1;
        i++;
        while (i < src.length && d > 0) {
          if (src[i] === '{') d++;
          else if (src[i] === '}') d--;
          i++;
        }
        continue;
      }
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; }
    else if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; continue; }
    else if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
    i++;
  }
  return null;
}




// Titel-Interpolation (`confirmModal(t('x', { detail: … }), { danger: true })`)
// wuerde ihn zufriedenstellen, obwohl der Dialog keine Folgen nennt.
function readOptionsArg(call) {
  const inner = call.slice(1, -1);
  const args = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === quote && inner[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { args.push(inner.slice(start, i)); start = i + 1; }
  }
  args.push(inner.slice(start));
  const rest = args.slice(1).map((arg) => arg.trim()).filter(Boolean);



  const literal = rest.filter((arg) => arg.startsWith('{') && !arg.includes('...')).pop();


  // verbuchen - sonst faellt `const o = { danger: true }; confirmModal(t, o)`

  if (!literal && rest.length) return null;
  return literal ?? '';
}




function readOptionValue(call, name) {
  const at = call.search(new RegExp(`\\b${name}\\s*:`));
  if (at === -1) return '';
  let i = call.indexOf(':', at) + 1;
  const start = i;
  let depth = 0;
  let quote = null;
  for (; i < call.length; i++) {
    const c = call[i];
    if (quote) {
      if (c === quote && call[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    else if (c === ',' && depth === 0) break;
  }
  return call.slice(start, i);
}

function collectDialogCalls() {
  const base = new URL('../public/', import.meta.url);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) return walk(child);
    return entry.name.endsWith('.js') ? [child] : [];
  });

  const calls = [];
  for (const file of walk(base)) {
    const src = readFileSync(file, 'utf8').replace(/\r/g, '');
    const label = decodeURIComponent(file.href.slice(base.href.length));
    for (const fn of DIALOG_FNS) {
      const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
      let match;
      while ((match = re.exec(src)) !== null) {

        // Definition selbst ist kein Aufruf: `export async function


        const lineStart = src.lastIndexOf('\n', match.index) + 1;
        const vorText = src.slice(lineStart, match.index);
        if (/^\s*(\*|\/\/)/.test(vorText)) continue;
        if (/\bfunction\s+$/.test(vorText)) continue;
        const call = readCall(src, match.index + match[0].length - 1);
        const line = src.slice(0, match.index).split('\n').length;
        calls.push({ file: label, line, fn, call });
      }
    }
  }
  return calls;
}

test('jeder als gefaehrlich markierte Dialog nennt seine Folgen', () => {
  const calls = collectDialogCalls();


  const unparsed = calls.filter((c) => c.call === null);
  assert.deepEqual(unparsed.map((c) => `${c.file}:${c.line}`), [],
    'Aufruf liess sich nicht bis zur schliessenden Klammer lesen');
  assert.ok(calls.length >= 40, `Scanner findet nur ${calls.length} Dialoge - laeuft er noch ueber public/?`);


  const mitOptionen = calls.map((c) => ({ ...c, options: readOptionsArg(c.call) }));







  const undurchsichtig = mitOptionen.filter((c) => {
    if (c.options !== null) return false;
    const src = readFileSync(new URL(`../public/${c.file}`, import.meta.url), 'utf8');
    return !new RegExp(`export (async )?function ${c.fn}\\b`).test(src);
  });
  assert.deepEqual(
    undurchsichtig.map((c) => `${c.file}:${c.line} (${c.fn})`),
    [],
    'Die Optionen des Dialogs stehen nicht als Objektliteral im Aufruf. So laesst sich '
    + 'nicht pruefen, ob er danger: true traegt - schreib sie direkt in den Aufruf.',
  );

  const gefaehrlich = mitOptionen.filter((c) => /\bdanger\s*:\s*true\b/.test(c.options ?? ''));
  assert.ok(gefaehrlich.length >= 30, `nur ${gefaehrlich.length} danger-Dialoge gefunden`);

  const ohneFolgen = gefaehrlich.filter((c) => !/\bdetail\s*:/.test(c.options));
  assert.deepEqual(
    ohneFolgen.map((c) => `${c.file}:${c.line} (${c.fn})`),
    [],
    'danger: true ohne detail - der Dialog sagt nicht, was er zerstoert. Nennt er keine '
    + 'unwiederbringliche Folge, gehoert danger: true weg statt ein erfundener Detailtext hin.',
  );







  const detailKeys = new Set();
  for (const call of gefaehrlich) {
    const value = readOptionValue(call.options, 'detail');
    const keys = [...value.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]);



    const delegiert = /\bt\(\s*this\._\w*[Kk]ey\b/.test(value);
    assert.ok(keys.length || delegiert,
      `${call.file}:${call.line}: detail muss aus t('key') kommen, ist aber \`${value.trim()}\``);
    assert.ok(!/(^|[^\w.])null([^\w]|$)/.test(value),
      `${call.file}:${call.line}: detail faellt in einem Zweig auf null zurueck - dann nennt der Dialog nichts`);
    keys.forEach((key) => detailKeys.add(key));
  }

  assertKeysExistInEveryLocale([...detailKeys]);





  // Key die Folge ausformuliert.
  const de = JSON.parse(read('../public/locales/de.json'));
  const laenge = (key) => {
    const value = key.split('.').reduce((o, k) => o?.[k], de);
    return typeof value === 'string' ? value.length : 0;
  };
  const zuKnapp = gefaehrlich
    .map((call) => ({ call, value: readOptionValue(call.options, 'detail') }))
    .map(({ call, value }) => ({
      call,
      value,
      keys: [...value.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]),
    }))


    .filter(({ value }) => !/\bt\(\s*this\._\w*[Kk]ey\b/.test(value))
    .filter(({ keys }) => !keys.some((key) => laenge(key) >= 80))
    .map(({ call, keys }) => `${call.file}:${call.line} (${keys.join(', ')})`);
  assert.deepEqual(zuKnapp, [], 'kein Folgentext des Dialogs ist lang genug fuer eine Folgenbeschreibung');


  assert.ok(detailKeys.size >= 25, `nur ${detailKeys.size} Folgen-Keys gefunden`);
});









test('jeder Nutzer des Category-Managers liefert seinen eigenen Folgentext', () => {
  const base = new URL('../public/', import.meta.url);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) return walk(child);
    return entry.name.endsWith('.js') ? [child] : [];
  });

  const de = JSON.parse(read('../public/locales/de.json'));
  const laenge = (key) => {
    const value = key.split('.').reduce((o, k) => o?.[k], de);
    return typeof value === 'string' ? value.length : 0;
  };

  const nutzer = [];
  for (const file of walk(base)) {
    const src = readFileSync(file, 'utf8').replace(/\r/g, '');
    const label = decodeURIComponent(file.href.slice(base.href.length));
    if (label === 'components/category-manager.js') continue;
    if (!src.includes('aashiyana-category-manager')) continue;



    // configure()-Aufrufe draussen.
    const vorher = nutzer.length;
    const re = /\.configure\s*\(/g;
    let match;
    while ((match = re.exec(src)) !== null) {
      const call = readCall(src, match.index + match[0].length - 1);
      assert.ok(call, `${label}: configure()-Aufruf liess sich nicht lesen`);
      if (!/\bbasePath\s*:/.test(call)) continue;
      const line = src.slice(0, match.index).split('\n').length;
      nutzer.push({ label: `${label}:${line}`, call });
    }
    assert.notEqual(vorher, nutzer.length,
      `${label}: bindet den Category-Manager ein, ruft aber configure() nicht auf`);
  }


  assert.ok(nutzer.length >= 5, `nur ${nutzer.length} Nutzer des Category-Managers gefunden`);

  const keys = new Set();
  for (const { label, call } of nutzer) {
    const del = readOptionValue(call, 'deleteDetailKey').match(/'([^']+)'/);
    assert.ok(del, `${label}: configure() braucht deleteDetailKey - was das Loeschen anrichtet, `
      + 'weiss nur der Server dieses Moduls');
    keys.add(del[1]);

    // zweite Dialog seinen eigenen Text.
    if (/\bsupportsSubcategories\s*:\s*true\b/.test(call)) {
      const sub = readOptionValue(call, 'subDeleteDetailKey').match(/'([^']+)'/);
      assert.ok(sub, `${label}: mit supportsSubcategories braucht configure() auch subDeleteDetailKey`);
      keys.add(sub[1]);
    }
  }

  assertKeysExistInEveryLocale([...keys]);
  const zuKnapp = [...keys].filter((key) => laenge(key) < 80);
  assert.deepEqual(zuKnapp, [], 'zu knapp fuer eine Folgenbeschreibung');
});




//



// `api.delete` laeuft erst danach, das `category-manager-changed` kommt also,

//





test('kein Nutzer des Category-Managers meldet sich vom Aenderungs-Ereignis ab', () => {
  const nutzer = walkJsFiles('../public/').filter((file) => (
    file !== '../public/components/category-manager.js' && read(file).includes('aashiyana-category-manager')
  ));


  assert.ok(nutzer.length >= 5, `nur ${nutzer.length} Nutzer des Category-Managers gefunden`);

  for (const file of nutzer) {
    const src = withoutBlockComments(read(file)).replace(/^\s*\/\/.*$/gm, '');
    const label = file.slice('../public/'.length);


    assert.match(src, /addEventListener\(\s*'category-manager-changed'/,
      `${label}: bindet den Category-Manager ein, hoert aber nicht auf seine Aenderungen`);
    assert.doesNotMatch(src, /removeEventListener\(\s*'category-manager-changed'/,
      `${label}: meldet sich vom Aenderungs-Ereignis ab und verpasst damit das Loeschen - `
      + 'die Auffrischung gehoert in den Ereignis-Handler, siehe `_notifyChanged` in der Komponente');
  }
});









// Grund.
test('der Kontakte-Filter loest sich von einer Kategorie, die geloescht wurde', () => {
  const fn = read('../public/pages/contacts.js').match(/function openContactCategoryManager[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(fn, 'openContactCategoryManager nicht gefunden');
  assert.match(fn, /state\.activeCategory[\s\S]*?state\.categories\.some\([\s\S]*?state\.activeCategory\s*=\s*null/,
    'der Handler muss den aktiven Filter loesen, wenn seine Kategorie nicht mehr in der frischen Liste steht');
});





test('der Aufgaben-Filter loest sich von einer Kategorie, die geloescht wurde', () => {
  const fn = read('../public/pages/tasks.js').match(/function openTaskCategoryManager[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(fn, 'openTaskCategoryManager nicht gefunden');
  assert.match(fn, /state\.filters\.category\.filter\([\s\S]*?state\.filters\.category = /,
    'der Handler muss geloeschte Keys aus state.filters.category werfen');


  assert.match(fn, /renderFilters\(container\);\n\s*if \(filterBereinigt\) \{/,
    'renderFilters gehoert VOR die Bedingung - das offene Panel veraltet sonst');
  assert.match(fn, /if \(filterBereinigt\) \{[\s\S]*?loadTasks\(container\)/,
    'nur die geaenderte Abfrage rechtfertigt ein Nachladen');
});

// Zwei Fallen des Einkaufs-Handlers, beide erst dadurch erreichbar, dass er

test('der Einkaufs-Handler schreibt nicht in einen abgehaengten Container', () => {
  const fn = read('../public/pages/shopping.js').match(/async function openCategoryManager[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(fn, 'openCategoryManager nicht gefunden');


  assert.match(fn, /if \(!container\.isConnected\) return;/,
    'der Handler muss aufgeben, wenn der Router die Seite schon ausgetauscht hat');


  assert.match(fn, /loadItems\(listId\)[\s\S]*?catch[\s\S]*?state\.itemsError = err/,
    'ein Fehler beim Nachladen der Artikel gehoert in state.itemsError, nicht in eine stille Rejection');
});





test('shopping: eine ueberholte Artikel-Antwort fasst den Stand nicht mehr an', () => {
  const src = read('../public/pages/shopping.js');
  const fn  = src.match(/async function loadItems\(listId\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(fn, 'loadItems nicht gefunden');

  const wache = fn.indexOf('if (state.activeListId !== listId) return;');
  assert.notEqual(wache, -1, 'loadItems braucht die Wache gegen eine ueberholte Antwort');
  assert.ok(wache < fn.indexOf('state.items'),
    'die Wache muss VOR dem Schreiben stehen - danach ist der Stand schon zerstoert');


  // falschen Liste anhaengen.
  const mgr = src.match(/async function openCategoryManager[\s\S]*?\n\}/)?.[0] ?? '';
  assert.equal((mgr.match(/state\.activeListId !== listId/g) ?? []).length, 2,
    'Erfolg UND Fehler muessen pruefen, ob die Liste noch dieselbe ist');
});





//





// (so macht es budget).
test('kein Nutzer des Category-Managers verschluckt den Fehler seiner Auffrischung', () => {
  const nutzer = walkJsFiles('../public/').filter((file) => (
    file !== '../public/components/category-manager.js' && read(file).includes('aashiyana-category-manager')
  ));
  assert.ok(nutzer.length >= 5, `nur ${nutzer.length} Nutzer des Category-Managers gefunden`);

  let geprueft = 0;
  for (const file of nutzer) {
    const src = read(file);
    const label = file.slice('../public/'.length);

    const re = /addEventListener\(\s*'category-manager-changed'/g;
    let treffer;
    while ((treffer = re.exec(src)) !== null) {


      const kopf = src.lastIndexOf('\nfunction ', treffer.index);
      const akopf = src.lastIndexOf('\nasync function ', treffer.index);
      const von = Math.max(kopf, akopf);
      assert.notEqual(von, -1, `${label}: umschliessende Funktion nicht gefunden`);
      const bis = src.indexOf('\n}', treffer.index);
      const fn = src.slice(von, bis);
      geprueft += 1;
      assert.doesNotMatch(fn, /catch\s*\{/,
        `${label}: ein bindungsloses \`catch {\` wirft das Fehlerobjekt weg und kann den `
        + 'Fehler der Auffrischung nicht melden - `catch (err)` mit Toast oder Fehlerzustand');
    }
  }

  assert.ok(geprueft >= 7, `nur ${geprueft} Handler gefunden`);
});













test('die schwersten Settings-Dialoge bleiben als gefaehrlich markiert', () => {
  const dialoge = [
    ['admin-family.js', 'settings.deleteMemberConfirm', 'settings.deleteMemberConfirmDetail'],
    ['admin-family.js', 'settings.invites.revokeConfirm', 'settings.invites.revokeConfirmDetail'],
    ['admin-api.js', 'settings.apiTokenRevokeConfirm', 'settings.apiTokenRevokeDetail'],
    ['admin-permissions.js', 'settings.permResetConfirm', 'settings.permResetConfirmDetail'],
    ['admin-backup.js', 'settings.backupRestoreConfirm', 'settings.backupRestoreDetail'],
  ];

  for (const [datei, confirmKey, detailKey] of dialoge) {
    const source = read(`../public/settings/pages/${datei}`);
    const at = source.indexOf(confirmKey);
    assert.notEqual(at, -1, `${datei}: ${confirmKey} kommt nicht mehr vor`);

    // balanciert lesen - der Confirm-Text interpoliert selbst (`{ name }`).
    const open = Math.max(source.lastIndexOf('confirmModal(', at), source.lastIndexOf('confirmOverModal(', at));
    const block = readCall(source, source.indexOf('(', open));
    assert.ok(block?.includes('danger: true'), `${datei}: ${confirmKey} braucht danger: true`);
    assert.ok(block.includes(detailKey), `${datei}: ${confirmKey} braucht den Folgen-Text ${detailKey}`);
  }
});

// --------------------------------------------------------
// Aufgaben-Tags (#586)


// --------------------------------------------------------

test('Tag-Chips auf Karten sind Filter-Buttons, keine Beschriftungen', () => {
  const source = read('../public/pages/tasks.js');
  const fn = source.slice(source.indexOf('function renderTagBadges'),
                          source.indexOf('function wireTagBadgeFilter'));

  assert.match(fn, /<button type="button" class="task-tag task-tag--filter"/,
    'Ein Tag anzuklicken und danach zu filtern ist die erwartete Geste - als <span> gibt es sie nicht');
  assert.match(fn, /data-tag-filter="\$\{esc\(tag\)\}"/, 'Der Wert muss escaped am Chip haengen');
  assert.match(fn, /aria-label="\$\{esc\(t\('tasks\.tagFilterBy'/,
    'Der Button braucht eine Beschriftung, die seine Wirkung nennt');



  const more = fn.slice(fn.indexOf('task-tag--more') - 120, fn.indexOf('task-tag--more') + 200);
  assert.match(more, /<span/, '+N ist eine Anzeige, kein Ziel');
});

test('der Tag-Klick wird in der Capture-Phase abgefangen', () => {
  const source = read('../public/pages/tasks.js');
  const fn = source.slice(source.indexOf('function wireTagBadgeFilter'),
                          source.indexOf('function wireTagBadgeFilter') + 600);

  assert.match(fn, /e\.stopPropagation\(\)/,
    'Ohne stopPropagation oeffnet derselbe Klick zusaetzlich den Bearbeiten-Dialog');


  assert.match(fn, /\}, true\);/,
    'Der Listener muss in der Capture-Phase haengen, sonst hat das Board den Dialog schon geoeffnet');
});

test('der Tag-Filter ist ueberall eine Liste, nirgends mehr ein einzelner Wert', () => {
  const source = read('../public/pages/tasks.js');



  // undefined und filtert nie.
  const singular = [...source.matchAll(/filters\.tag\b(?!s)/g)];
  assert.equal(singular.length, 0,
    `filters.tag (Singular) darf nicht mehr vorkommen, gefunden: ${singular.length}`);



  assert.match(source, /params\.append\('tag', tag\)/,
    'Jeder Tag gehoert als eigener Query-Parameter in die Anfrage');
});

// Dieselbe Handlung traegt drei Namen: `closeModal`, den Import-Alias






// wuerde.
const CLOSE_MODAL_CALL = /\b(close(Shared)?Modal|closeDetailView)\s*\(/;

test('nach einem Schreibvorgang schliesst das Modal ohne Verwerfen-Frage', () => {
  const WINDOW = 20; // Zeilen zwischen Request und Schliessen, grosszuegig gefasst
  const violations = [];

  for (const file of walkJsFiles('../public/')) {
    const lines = read(file).split('\n');
    lines.forEach((line, index) => {
      if (!/await\s+api\.(post|patch|put|delete)\s*\(/.test(line)) return;
      lines.slice(index, index + WINDOW).forEach((candidate, offset) => {
        // Kueche/Vorrat importieren dieselbe Funktion unter `closeSharedModal`;

        if (!CLOSE_MODAL_CALL.test(candidate)) return;

        if (/function closeModal|^\s*import|\bfrom\s+'/.test(candidate)) return;
        if (/force/.test(candidate)) return;
        violations.push(`${file}:${index + offset + 1}: ${candidate.trim()}`);
      });
    });
  }

  assert.deepEqual(violations, [],
    'closeModal() im Erfolgspfad eines Schreibvorgangs braucht { force: true }');
});

test('der Loeschen-Knopf im Modal schliesst ohne Verwerfen-Frage', () => {

  const DELETE_BUTTON = /querySelector(All)?\([^)]*delete[^)]*\)[^;]*addEventListener\(\s*'click'/i;
  const WINDOW = 16;
  const violations = [];

  for (const file of walkJsFiles('../public/')) {
    const lines = read(file).split('\n');
    lines.forEach((line, index) => {
      if (!DELETE_BUTTON.test(line)) return;

      // (`=> deleteMed(med));`) delegieren und schliessen selbst nichts.
      if (!/\{\s*$/.test(line)) return;
      const indent = line.search(/\S/);

      for (let offset = 1; offset <= WINDOW; offset += 1) {
        const candidate = lines[index + offset];
        if (candidate === undefined) break;

        if (/^\s*\}\)/.test(candidate) && candidate.search(/\S/) <= indent) break;
        if (!CLOSE_MODAL_CALL.test(candidate) || /force/.test(candidate)) continue;
        violations.push(`${file}:${index + offset + 1}: ${candidate.trim()}`);
      }
    });
  }

  assert.deepEqual(violations, [],
    'closeModal() im Loeschen-Pfad braucht { force: true }');
});

test('ein Dialog ueber einem offenen Modal nutzt confirmOverModal', () => {
  const violations = [];

  for (const file of walkJsFiles('../public/')) {
    if (file.endsWith('components/modal.js')) continue; // definiert beide
    const lines = read(file).split('\n');

    lines.forEach((line, index) => {
      if (!/\bconfirmModal\s*\(/.test(line)) return;
      if (/^\s*(import|\/\/|\*)/.test(line)) return;

      // Vorfahren-Kette rein ueber Einrueckung: die jeweils naechste Zeile


      let level = lines[index].search(/\S/);
      for (let i = index - 1; i >= 0 && level > 0; i -= 1) {
        const indent = lines[i].search(/\S/);
        if (indent === -1 || indent >= level) continue;
        level = indent;
        if (!/\bonSave\s*[:({]/.test(lines[i])) continue;
        violations.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        break;
      }
    });
  }

  assert.deepEqual(violations, [],
    'confirmModal() aus einem offenen Modal heraus gehoert auf confirmOverModal() umgestellt');
});

test('Render-Funktionen mit mehreren Aufrufern materialisieren ihre Icons selbst', () => {
  const violations = [];
  const withoutComments = (body) => body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');

  for (const file of [...walkJsFiles('../public/pages/'), ...walkJsFiles('../public/components/')]) {
    const fns = topLevelFunctions(read(file)).map(([name, body]) => [name, withoutComments(body)]);


    const helpers = fns
      .filter(([, body]) => /createIcons/.test(body) && !/data-lucide=/.test(body))
      .map(([name]) => name);
    const materialises = (body) => /createIcons/.test(body)
      || helpers.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(body));

    for (const [name, body] of fns) {
      if (!/\.(insertAdjacentHTML|replaceChildren)\s*\(/.test(body)) continue;
      if (!/data-lucide=/.test(body)) continue;
      if (materialises(body)) continue;
      if (/document\.createElement\(/.test(body) && /\breturn\b/.test(body)) continue; // Element-Fabrik

      const callers = fns.filter(([other, otherBody]) =>
        other !== name && new RegExp(`\\b${name}\\s*\\(`).test(otherBody));
      if (callers.length <= 1) continue;

      violations.push(`${file}: ${name}() - ${callers.length} Aufrufer `
        + `(${callers.map(([caller]) => caller).join(', ')})`);
    }
  }

  assert.deepEqual(violations, [],
    'Diese Funktionen fügen <i data-lucide> ein, überlassen das Materialisieren aber '
    + `ihren Aufrufern. Ein lucide.createIcons({ el: ... }) gehört ans Ende:\n${violations.join('\n')}`);
});

test('Jeder Sortable-Nutzer hat einen tastaturbedienbaren Reorder-Pfad', () => {





  //


  // fokussierbaren Griff (Einkaufsliste, #678).
  //
  const violations = [];






  // der Code.
  //




  //






  // Funktionsnamen, und keine Methodenaufrufe.

  function callBlock(source, openParen) {
    let depth = 0;
    for (let i = openParen; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') { depth--; if (depth === 0) return source.slice(openParen, i + 1); }
    }
    return source.slice(openParen);
  }

  function localCallsIn(block, source) {
    const defined = new Set([
      ...[...source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
      ...[...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b)/g)].map((m) => m[1]),
    ]);
    return new Set(
      [...block.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)]
        .map((m) => m[2])
        .filter((name) => defined.has(name))
    );
  }

  for (const file of [...walkJsFiles('../public/pages/'), ...walkJsFiles('../public/components/')]) {
    const source = read(file);
    if (!/\bmakeSortable\s*\(/.test(source)) continue;

    const hasArrowKeys   = /['"]ArrowUp['"]/.test(source) && /['"]ArrowDown['"]/.test(source);
    const hasMoveButtons = /data-action="(up|down)"/.test(source)
      || /'(up|down)'/.test(source) && /addEventListener\(\s*['"]click['"]/.test(source);
    if (hasArrowKeys || hasMoveButtons) continue;


    const clickNames = new Set();
    for (const m of source.matchAll(/addEventListener\(\s*['"]click['"]/g)) {
      const block = source.slice(m.index, m.index + 2500);
      for (const name of localCallsIn(block, source)) clickNames.add(name);
    }


    const offen = [];
    for (const m of source.matchAll(/\bmakeSortable\s*\(/g)) {
      const block = callBlock(source, m.index + m[0].length - 1);
      if (!/sort:\s*false/.test(block)) { offen.push(m.index); continue; }
      const geteilt = [...localCallsIn(block, source)].filter((n) => clickNames.has(n));
      if (!geteilt.length) offen.push(m.index);
    }
    if (!offen.length) continue;

    violations.push(file);
  }

  assert.deepEqual(violations, [],
    'Diese Dateien machen Listen per Drag sortierbar, ohne einen Tastaturpfad daneben. '
    + 'Drag allein ist für Tastatur- und Screenreader-Bedienung kein Weg (siehe den Kopf '
    + `von public/utils/sortable.js):\n${violations.join('\n')}`);
});

test('Die Handsortierung der Einkaufsliste sichert über einen gemeinsamen Pfad', () => {



  // der dabei zuerst verloren geht.
  const source = read('../public/pages/shopping.js');
  const persistCalls = source.match(/persistItemOrder\s*\(/g) ?? [];

  assert.ok(persistCalls.length >= 3,
    `Erwartet: Definition + Drag-Ende + Tastaturpfad rufen persistItemOrder. Gefunden: ${persistCalls.length}`);
  assert.match(source, /onEnd:\s*\([^)]*\)\s*=>\s*persistItemOrder\(/,
    'Das Drag-Ende muss über persistItemOrder sichern.');
  assert.match(source, /moveItemRow\([^)]*\)/,
    'Der Tastaturpfad braucht moveItemRow, das seinerseits persistItemOrder aufruft.');
  assert.match(source, /catch[\s\S]{0,400}updateItemsList\(container\)/,
    'Der Fehlerfall muss die Liste aus dem unveränderten State neu aufbauen (Rollback).');
});

test('Der Sortiergriff nimmt sich die Geste aus der Wischbedienung', () => {



  //




  assert.match(read('../public/pages/shopping.js'), /ignore:\s*'\.list-row__drag'/,
    'Die Einkaufsliste muss ihren Sortiergriff als Ausnahme benennen.');
  assert.match(read('../public/utils/swipe-row.js'), /touchstart[\s\S]{0,600}ignore[\s\S]{0,120}closest/,
    'Der geteilte Wisch-Helfer muss die Ausnahme im touchstart auswerten.');
});

test('Der Modulkopf trägt kein Glas, und das bleibt so', () => {



  // kollabierende Large-Title-Leiste davon lebt - Glas zeigte am Scroll-Anfang



  //


  //




  const headClasses = new Set(['page-toolbar']);
  for (const file of walkFrontendFiles('../public/')) {
    for (const [, value] of read(file).matchAll(/class="([^"]*\bpage-toolbar\b[^"]*)"/g)) {
      for (const cls of value.split(/\s+/)) {
        if (cls && !cls.startsWith('${') && !cls.includes('--')) headClasses.add(cls);
      }
    }
  }

  const offenders = [];
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body, at } of eachRule(read(`../public/styles/${file}`))) {
      if (!/backdrop-filter\s*:\s*(?!none)/.test(body)) continue;
      const hit = [...headClasses].find((cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(selector));
      if (hit) offenders.push(`${file}: ${at.join(' ')} ${selector} (über .${hit})`);
    }
  }

  assert.deepEqual(offenders, [],
    'Der Modulkopf ist opak - eine begründete Abweichung vom Kanon, siehe DESIGN.md '
    + '„Die Glas-ist-Chrome-Regel".\n  ' + offenders.join('\n  '));



  assert.ok(headClasses.size >= 4,
    `Nur ${headClasses.size} Kopf-Klassen im Markup gefunden - erwartet ist .page-toolbar `
    + 'plus die Modul-Klassen, die sich ein Element mit ihr teilen.');
});

test('Eine Wischgeste, die löscht, hat einen Rückgängig-Weg', () => {




  //





  //









  //


  //



  const pagesDir = new URL('../public/pages/', import.meta.url);
  const seen = [];




  const guardsDestructively = (body) => /confirmModal\s*\(/.test(body) && /danger:\s*true/.test(body);

  for (const file of readdirSync(pagesDir).filter((name) => name.endsWith('.js'))) {
    const source = read(`../public/pages/${file}`);

    const actions = [];
    for (const match of source.matchAll(/reveal:\s*'([^']+)'/g)) {
      if (!match[1].includes('--delete')) continue;
      const body = enclosingObject(source, match.index);
      if (body) actions.push(body);
    }



    assert.equal(source.includes('swipe-reveal--delete') && actions.length === 0, false,
      `${file} rendert ein Lösch-Reveal, aber keine Wischrichtung verweist darauf.`);

    for (const body of actions) {
      seen.push(file);
      const hasWayBack = (text) => /scheduleUndoableDelete/.test(text) || guardsDestructively(text);
      const direct = hasWayBack(body);
      const viaCall = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)]
        .some(([, name]) => hasWayBack(functionBody(source, name) ?? ''));

      assert.ok(direct || viaCall,
        `${file}: der Löschwisch braucht einen Rückweg - scheduleUndoableDelete, wenn die Tat `
        + 'in einem Satz zurückzunehmen ist, sonst eine confirmModal-Bestätigung mit danger: true, '
        + 'die die Nebenwirkung benennt. Direkt löschen ist keines von beidem.');
    }
  }

  assert.ok(seen.length >= 2,
    `Erwartet: Einkauf und Geburtstage tragen einen Löschwisch. Gefunden: ${seen.join(', ') || 'keinen'}`);
});

test('Die Einkaufsliste sagt Umsortierungen über eine Live-Region an', () => {



  const source = read('../public/pages/shopping.js');
  assert.match(source, /role="status" aria-live="polite" id="items-reorder-announce"/,
    'Die Live-Region muss im Listen-Markup stehen.');
  assert.match(source, /announceItemMove\(container, movedRow\)/,
    'Der geteilte Persistenz-Pfad muss ansagen - dann gilt es für Drag UND Tastatur.');
  assert.match(source, /t\('category\.reorderAnnounce'/,
    'Wiederverwendeter Ansage-Text statt einer zweiten Fassung in 24 Sprachen.');
});

test('Die Handsortierung schickt je Kategorie nur eine Anfrage gleichzeitig', () => {





  const source = read('../public/pages/shopping.js');

  assert.match(source, /orderRuns\s*=\s*new Map\(\)/,
    'Es braucht eine Buchführung über laufende Sicherungen je Kategorie.');
  assert.match(source, /const running = orderRuns\.get\(category\);\s*\n\s*if \(running\) \{ running\.again = true; return; \}/,
    'Ein Zug während eines Laufs darf nur eine Nachfolge vormerken, keine zweite Anfrage starten.');
  assert.match(source, /while \(run\.again/,
    'Nach dem Lauf muss eine vorgemerkte Nachfolge abgearbeitet werden.');
  assert.match(source, /orderRuns\.delete\(category\)/,
    'Der Eintrag muss auch im Fehlerfall verschwinden (finally), sonst blockiert die Kategorie dauerhaft.');




  assert.match(source, /async function sendItemOrder\(groupEl, container, listId\)[\s\S]{0,600}querySelectorAll\(':scope > \.swipe-row'\)/,
    'sendItemOrder muss die Reihenfolge beim Senden frisch aus dem DOM lesen.');
});

test('Die Handsortierung bindet ihre Anfrage an die Liste, in der gezogen wurde', () => {




  const source = read('../public/pages/shopping.js');

  assert.match(source, /const listId = state\.activeListId;/,
    'Die Listen-ID muss beim Einreihen feststehen, nicht beim Senden gelesen werden.');
  assert.match(source, /api\.patch\(`\/shopping\/\$\{listId\}\/items\/reorder`/,
    'Die Anfrage muss an die festgehaltene Liste gehen, nicht an state.activeListId.');
  assert.match(source, /if \(listId === state\.activeListId\) state\.items =/,
    'Der State darf nur nachziehen, solange dieselbe Liste offen ist.');
  assert.match(source, /if \(listId !== state\.activeListId\) return false;/,
    'Ein Fehler einer nicht mehr offenen Liste darf weder tosten noch die sichtbare Liste neu bauen.');
});

// --------------------------------------------------------------------------
// Zeilenlisten-Regel (HIG-Rollout Runde 3, dokumentiert in tokens.css)
//



// Stylesheets, sucht jede Haarlinien-Trennung `X + X { border-top: … }` und



// deckt keine Regel ab, sondern N Dateien.)
// --------------------------------------------------------------------------
test('row lists sit in exactly one carrier', () => {
  const files = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((name) => name.endsWith('.css'));






  const declared = (body, prop) => {
    const hits = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}:([^;]*)`, 'g'))];
    return hits.map((m) => m[1].trim());
  };
  const CARD_MARKERS = [
    { prop: 'box-shadow', isCard: (v) => v !== 'none' },
    { prop: 'border-radius', isCard: (v) => !/^0(px|rem)?$/.test(v) },
    { prop: 'background', isCard: (v) => /^var\(--color-surface(-work|-raised|-elevated)?\)$/.test(v) },
    { prop: 'background-color', isCard: (v) => /^var\(--color-surface(-work|-raised|-elevated)?\)$/.test(v) },
  ];

  const offenders = [];
  for (const name of files) {
    const css = read(`../public/styles/${name}`);


    // Geschwister-Abstand sein kann).
    const seen = new Set();
    for (const m of css.matchAll(/(?:^|[},])\s*(\.[\w-]+)\s*\+\s*\1\s*\{([^}]*)\}/g)) {
      const [, selector, body] = m;
      if (!/border-top:/.test(body)) continue;
      if (seen.has(selector)) continue;
      seen.add(selector);


      // `X--modifier {` (cssRuleBody matcht ungebunden, siehe Handoff-Falle).
      const base = css.match(new RegExp(`(?:^|[},])\\s*\\${selector}\\s*\\{([^}]*)\\}`, 'm'));
      if (!base) continue;
      for (const marker of CARD_MARKERS) {
        for (const value of declared(base[1], marker.prop)) {
          if (marker.isCard(value)) {
            offenders.push(`${name} ${selector} traegt ${marker.prop}: ${value} — eine Zeile in einer Liste ist keine Karte`);
          }
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

// --------------------------------------------------------------------------
// Zeilenlisten-Regel, ZWEITE HAELFTE (Runde 6, Phase 5a) - Ebene 3, Signatur.
//




//










//



//
// AUSNAHME, MECHANISCH STATT NAMENTLICH: wer `break-inside: avoid` traegt,




//

// ihres Traegers ueberlaesst (`.documents-list--list > .document-row`), sieht

// statisch nicht aufloesbar (`list.insertAdjacentHTML(..., docs.map(...))`).

// --------------------------------------------------------------------------




// Rueckgabe heraus aufgerufen wird (`renderSwipeRow(t, renderTaskCard(t))`

function repeatedRootClasses() {
  const firstClass = (text) => {
    const value = text.match(/class="([^"$]*)/)?.[1]?.trim().split(/\s+/)[0];
    return value && /^[a-z][\w-]*$/.test(value) ? value : null;
  };
  // Klammerweise statt per Regex: ein Callback enthaelt selbst Klammern.
  const callArgs = (source, parenIndex) => {
    let depth = 0;
    for (let i = parenIndex; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) return source.slice(parenIndex + 1, i);
      }
    }
    return '';
  };

  const roots = new Map();
  for (const path of walkJsFiles('../public/pages/')) {
    const source = read(path);




    const returned = new Map();
    for (const match of source.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      const slice = source.slice(match.index, match.index + 6000);
      const start = slice.indexOf('return `');
      const value = start >= 0 ? firstClass(slice.slice(start, start + 900)) : null;
      if (value) returned.set(match[1], value);
    }

    for (const match of source.matchAll(/\.map\s*\(/g)) {
      const body = callArgs(source, match.index + match[0].length - 1);
      if (!body) continue;
      const found = new Set();
      const inline = firstClass(body.slice(0, 600));
      if (inline) found.add(inline);
      for (const call of body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (returned.has(call[1])) found.add(returned.get(call[1]));
      }
      if (returned.has(body.trim())) found.add(returned.get(body.trim()));
      for (const value of found) {
        if (!roots.has(value)) roots.set(value, new Set());
        roots.get(value).add(path.replace('../public/pages/', ''));
      }
    }
  }
  return roots;
}

test('row lists: a repeated sheet that stacks itself is a card per row', () => {
  const roots = repeatedRootClasses();
  assert.ok(roots.size > 50,
    `Nur ${roots.size} wiederholte Wurzelklassen gefunden - die Ableitung aus den `
    + 'Render-Schleifen greift nicht mehr, und ein Guard, der nichts gesehen hat, '
    + 'darf nicht urteilen.');

  const rules = new Map(); // Klasse -> [{ file, body }]
  for (const name of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    for (const { selector, body } of eachRule(read(`../public/styles/${name}`))) {
      for (const part of selector.split(',')) {
        const single = part.trim().match(/^\.([\w-]+)$/);
        if (!single) continue;
        if (!rules.has(single[1])) rules.set(single[1], []);
        rules.get(single[1]).push({ file: name, body });
      }
    }
  }

  const values = (body, prop) =>
    [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}:([^;]*)`, 'g'))].map((m) => m[1].trim());
  const CARD_SURFACE = /^var\(--color-surface(-work|-raised|-elevated)?\)$/;
  const isZero = (value) => /^0(px|rem|em)?$/.test(value);

  const offenders = [];
  for (const [cls, files] of [...roots].sort()) {
    const own = rules.get(cls) ?? [];
    const sheet = own.find((rule) =>
      [...values(rule.body, 'background'), ...values(rule.body, 'background-color')]
        .some((value) => CARD_SURFACE.test(value)));
    if (!sheet) continue;
    const spacing = own.find((rule) =>
      [...values(rule.body, 'margin-bottom'), ...values(rule.body, 'margin-block-end')]
        .some((value) => !isZero(value)));
    if (!spacing) continue;

    if (own.some((rule) => values(rule.body, 'break-inside').includes('avoid'))) continue;

    offenders.push(
      `.${cls} (${[...files].join(', ')}) traegt in ${sheet.file} eine eigene Kartenflaeche `
      + 'UND ihren Stapelabstand selbst - das ist eine Karte pro Zeile. '
      + 'Flaeche und Trennung gehoeren dem Traeger (Muster: .list-rows > * + *).');
  }
  assert.deepEqual(offenders, []);
});

// --------------------------------------------------------------------------

//





// sondern dass ueberhaupt KEINE andere Regel den Buttonradius neu setzt.
// --------------------------------------------------------------------------
test('one button shape app-wide', () => {
  const files = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((name) => name.endsWith('.css'));

  const base = cssRuleBody(read('../public/styles/layout.css'), '\n.btn');
  assert.match(base, /border-radius:\s*var\(--radius-full\)/,
    'Die Kapsel steht in der .btn-Basisregel (Direction Contract: „Kapsel-Controls").');

  const offenders = [];
  for (const name of files) {
    for (const { selector, body } of eachRule(read(`../public/styles/${name}`))) {
      // Jede Regel, deren Selektorliste eine .btn-Variante enthaelt.
      if (!/\.btn[\w-]*/.test(selector)) continue;
      if (name === 'layout.css' && selector === '.btn') continue;
      const radius = body.match(/(?:^|;)\s*border-radius:\s*([^;]+)/)?.[1]?.trim();
      if (!radius) continue;



      // jede zweite Regel uebersprang (siehe eachRule).
      if (/--radius-full/.test(radius)) continue;
      offenders.push(`${name}: ${selector} setzt eine zweite Buttonform (${radius})`);
    }
  }
  assert.deepEqual(offenders, []);








  //

  // (--color-border) mit ihrer Tinte (Modul-/App-Akzent) kombiniert, baut sie

  // klickbare Element traegt die Kapsel" - Toggles, Checkboxen, Wochentags-


  // Gegenprobe am gerenderten Dokument gibt es
  // .impeccable/redesign-tools/button-shapes.mjs.
  const handCopied = [];
  for (const name of files) {
    for (const { selector, body } of eachRule(read(`../public/styles/${name}`))) {
      if (/\.btn(?![\w-])|\.btn--/.test(selector)) continue;
      if (!/border:\s*[\d.]+px\s+solid\s+var\(--color-border\)/.test(body)) continue;
      if (!/color:\s*var\(--(?:module-accent|active-module-accent|color-accent)/.test(body)) continue;





      // Pixelhoehe mit overflow: hidden.
      if (/width:\s*\d+px/.test(body) && /height:\s*\d+px/.test(body)
        && /overflow:\s*hidden/.test(body)) continue;
      handCopied.push(
        `${name}: ${selector} baut .btn--secondary nach `
        + '- die Klasse nehmen statt die Grammatik kopieren',
      );
    }
  }
  assert.deepEqual(handCopied, []);
});

test('ein quadratischer Icon-Knopf ist ein Kreis', () => {
  const files = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((name) => name.endsWith('.css'));



  const EXEMPT = new Map([
    // 1. Zustandsschalter
    ['.item-check', 'Zustandsschalter: Checkbox der Einkaufsliste'],
    ['.subtask-item__checkbox', 'Zustandsschalter: Checkbox einer Teilaufgabe'],
    ['.rrule-day', 'Zustandsschalter: Wochentagswaehler der Wiederholung'],
    ['.health-weekday', 'Zustandsschalter: Wochentagswaehler der Gesundheit'],
    ['.document-select', 'Zustandsschalter: Traeger der Auswahl-Checkbox'],
    // 3. Zellen eines Rasters
    ['.ydp-cal__day', 'Rasterzelle: Tag im Datepicker-Monat'],
    ['.cycle-cal__day', 'Rasterzelle: Tag im Zyklus-Monat'],


    ['.ydp__trigger', 'Feld: Oeffner des Datepickers, traegt Feldkante'],
  ]);

  const decl = (body, prop) =>
    body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1]?.trim();

  const offenders = [];
  for (const name of files) {
    for (const { selector, body } of eachRule(read(`../public/styles/${name}`))) {
      const radius = decl(body, 'border-radius');
      if (!radius || /--radius-full|9999px|50%/.test(radius)) continue;



      const width = decl(body, 'width') ?? decl(body, 'min-width');
      const height = decl(body, 'height') ?? decl(body, 'min-height');
      if (!width || !height || width !== height) continue;
      if (/%|auto/.test(width)) continue;




      const clickable = /cursor:\s*(?:pointer|grab)/.test(body)
        || /(?:__|-)(?:btn|button)(?![\w-])/.test(selector);
      if (!clickable) continue;

      const exemptKey = [...EXEMPT.keys()].find(
        (key) => new RegExp(`${escapeForRegExp(key)}(?![\\w-])`).test(selector),
      );
      if (exemptKey) continue;

      offenders.push(`${name}: ${selector} (${width}) traegt ${radius} statt der Kapsel`);
    }
  }

  assert.deepEqual(offenders, [],
    'Ein quadratischer, klickbarer Icon-Knopf ist ein Kreis. Wer hier steht, '
    + 'traegt entweder die Kapsel oder gehoert in EXEMPT - mit seiner Kategorie.');




  const allCss = files.map((name) => read(`../public/styles/${name}`)).join('\n');
  for (const key of EXEMPT.keys()) {
    assert.ok(allCss.includes(key), `EXEMPT nennt ${key}, das es nicht mehr gibt.`);
  }
});

test('wer sein Label verliert, bleibt ein volles Ziel', () => {
  const files = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((name) => name.endsWith('.css'));



  const LABEL_PART = /^(?:span|[a-z]*\.[\w-]+__(?:label|text|name|title))$/;




  const targetOf = (value) => {
    if (/var\(--target-(?:base|lg)\)/.test(value)) return true;
    const px = Number.parseFloat(value);
    return Number.isFinite(px) && px >= 44;
  };
  const decl = (body, prop) =>
    body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1]?.trim();








  const markupControls = new Set();
  for (const file of walkFrontendFiles('../public/')) {
    for (const tag of read(file).matchAll(/<(button|a)\b([^>]*)>/g)) {
      const attrs = tag[2];
      const classAttr = attrs.match(/class=["']([^"']*)["']/)?.[1] ?? '';
      const isControl = tag[1] === 'button'
        || /role=["']button["']/.test(attrs)
        || /\bbtn\b/.test(classAttr);
      if (!isControl) continue;
      for (const token of classAttr.split(/\s+/)) {
        if (/^[\w-]+$/.test(token)) markupControls.add(`.${token}`);
      }
    }
  }
  assert.ok(markupControls.size > 50,
    'Die Knopfklassen kommen aus dem Markup - findet der Scanner keine, prueft der Guard nichts.');

  const offenders = [];

  for (const name of files) {
    const rules = [...eachRule(read(`../public/styles/${name}`))];


    // deren TITEL ausgeblendet wird (`.kitchen-tabs-bar .sub-tabs-bar__title`),

    const pointers = new Set();
    for (const rule of rules) {
      if (!/cursor:\s*(?:pointer|grab)/.test(rule.body)) continue;
      for (const sel of rule.selector.split(',')) pointers.add(sel.trim());
    }
    const isControl = (sel) => markupControls.has(sel)
      || pointers.has(sel)
      || [...pointers].some((p) => p.startsWith(`${sel}.`) || p.startsWith(`${sel}:`))
      || /(?:__|-)(?:btn|button|opt)(?![\w-])/.test(sel);

    for (const rule of rules) {
      if (!/(?:^|;)\s*display:\s*none/.test(rule.body)) continue;

      for (const raw of rule.selector.split(',').map((s) => s.trim())) {
        const parts = raw.split(/\s+/);
        const last = parts.at(-1).replace(/:not\([^)]*\)/g, '');
        if (!LABEL_PART.test(last)) continue;



        // selbst das Bedienelement (`.perm-seg` traegt, `.perm-seg__opt` klickt).
        const owners = parts.length > 1
          ? [parts.slice(0, -1).join(' ')]
          : (() => {
            const block = last.match(/^\.([\w-]+)__/)?.[1];
            if (!block) return [];
            const kin = [...pointers].filter((p) => p.startsWith(`.${block}__`)
              && !LABEL_PART.test(p));
            return kin.length ? kin : [`.${block}`];
          })();

        for (const owner of owners) {
          if (!isControl(owner)) continue;



          const sized = rules.filter((r) => r.at.join('|') === rule.at.join('|')
            && r.selector.split(',').some((s) => s.trim() === owner));
          const width = sized.map((r) => decl(r.body, 'width') ?? decl(r.body, 'min-width'))
            .find(Boolean);
          const height = sized.map((r) => decl(r.body, 'height') ?? decl(r.body, 'min-height'))
            .find(Boolean);

          if (width && height && targetOf(width) && targetOf(height)) continue;
          const at = rule.at.join(' | ') || 'Basisebene';
          offenders.push(
            `${name} [${at}]: ${owner} verliert sein Label (${last}), `
            + `bleibt aber ohne Zielgroesse (${width ?? 'keine Breite'} x ${height ?? 'keine Hoehe'})`,
          );
        }
      }
    }
  }

  assert.deepEqual(offenders, [],
    'Ein Label zu verlieren darf ein Ziel nie verkleinern: wer ein Label '
    + 'ausblendet, gibt seinem Traeger im selben At-Block --target-base.');
});

test('ein Umschalt-Knopf traegt seinen Namen selbst, nicht in einem Kind', () => {
  const dateien = [];
  const sammle = (verzeichnis) => {
    for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
      const pfad = new URL(`${eintrag.name}${eintrag.isDirectory() ? '/' : ''}`, verzeichnis);
      if (eintrag.isDirectory()) {
        if (eintrag.name === 'vendor') continue;
        sammle(pfad);
      } else if (/\.(?:js|html)$/.test(eintrag.name)) {
        dateien.push(pfad);
      }
    }
  };
  sammle(new URL('../public/', import.meta.url));

  const namenlos = [];
  for (const datei of dateien) {
    const quelle = readFileSync(datei, 'utf8');
    for (const treffer of quelle.matchAll(/<button\b[^>]*group-toggle__btn[^>]*>/g)) {
      const tag = treffer[0];
      if (/aria-label(?:ledby)?[=\s]/.test(tag)) continue;
      const zeile = quelle.slice(0, treffer.index).split('\n').length;
      namenlos.push(`${datei.pathname.split('/public/')[1]}:${zeile}`);
    }
  }

  assert.deepEqual(namenlos, [],
    `Umschalt-Knopf ohne eigenen Namen - unter 640px faellt sein Label und mit ihm die Beschriftung: ${namenlos.join(', ')}`);
});

test('die Groesse des Icon-Knopfs gehoert der Shell', () => {
  const SIZE = /^(?:width|height|min-width|min-height)$/;
  const shell = [...eachRule(read('../public/styles/layout.css'))]
    .filter((rule) => rule.selector.split(',').some((s) => s.trim() === '.btn--icon'));

  const base = shell.find((rule) => rule.at.length === 0);
  assert.ok(base, '.btn--icon braucht eine Basisregel in layout.css.');
  assert.match(base.body, /min-height:\s*var\(--target-base\)/,
    '.btn--icon nimmt --target-base - es schaltet ueber (hover: none) von 44px auf 48px '
    + 'und ist damit das einzige Mass, das dem tokens.css-Kanon folgt.');
  assert.match(base.body, /min-width:\s*var\(--target-base\)/);



  const inAt = shell.filter((rule) => rule.at.length > 0
    && rule.body.split(';').some((d) => SIZE.test(d.split(':')[0]?.trim() ?? '')));
  assert.deepEqual(inAt.map((r) => r.at.join(' | ')), [],
    'Die Groesse von .btn--icon steht in genau einer Regel. Ein @media-Block, der '
    + 'sie umschaltet, macht die Viewport-Breite wieder zum Kriterium.');

  // Und kein Modul beantwortet sie neu.
  const offenders = [];
  for (const name of readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((file) => file.endsWith('.css') && file !== 'layout.css')) {
    for (const rule of eachRule(read(`../public/styles/${name}`))) {
      for (const raw of rule.selector.split(',').map((s) => s.trim())) {

        // Variante mit eigenem Namen, kein Override.
        if (!/(?:^|[\s>+~.])\.btn--icon(?![\w-])/.test(raw)) continue;
        if (raw === '.btn--icon') continue;
        const sized = rule.body.split(';')
          .map((d) => d.split(':')[0]?.trim())
          .filter((prop) => SIZE.test(prop ?? ''));
        if (!sized.length) continue;
        offenders.push(`${name}: ${raw} setzt ${sized.join(', ')}`);
      }
    }
  }
  assert.deepEqual(offenders.sort(), [],
    'Ein Modul, das die Groesse von .btn--icon neu setzt, gibt eine zweite Antwort '
    + 'auf eine Shell-Frage. Genau so entstanden die 40px in Kalender/Kontakten '
    + 'neben den 44px in Aufgaben/Dokumenten. Farbe und Abstand darf ein Modul '
    + 'setzen, die Zielgroesse nicht.');
});

test('eine Zeile mit eigenen Aktionen verspricht keine Navigation', () => {
  const offenders = [];
  for (const file of walkJsFiles('../public/pages/')) {
    const src = read(file);


    // Zeile statt ueber die Datei.
    for (const literal of src.match(/`[^`]*`/g) || []) {
      const chevron = literal.search(/class="[^"]*__chevron/);
      if (chevron === -1) continue;
      if (!/<button/.test(literal.slice(chevron))) continue;


      const owner = literal.slice(0, chevron).lastIndexOf('<button');
      if (owner !== -1) {
        const ownerTag = literal.slice(owner, chevron);
        if (/aria-expanded/.test(ownerTag) && !/<\/button>/.test(ownerTag)) continue;
      }
      const name = literal.slice(chevron).match(/class="([^"]*__chevron[^"]*)"/)?.[1] ?? '?';
      offenders.push(`${file.replace(/^\.\.\//, '')}: ${name} steht in einer Zeile, die danach noch einen Knopf traegt`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('der Modulkopf gehoert der Shell - kein Modul setzt seine Richtung oder seinen Lead', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);
  const cssFiles = readdirSync(styleDir).filter((name) => name.endsWith('.css'));


  const headClasses = new Set(['page-toolbar']);
  for (const file of walkFrontendFiles('../public/')) {
    for (const m of read(file).matchAll(/class="([^"]*\bpage-toolbar\b[^"]*)"/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls && !cls.startsWith('${') && !cls.startsWith('page-toolbar__')) headClasses.add(cls);
      }
    }
  }
  assert.ok(
    headClasses.size >= 4,
    `Aus dem Markup kamen nur ${headClasses.size} Kopf-Klassen - der Guard misst dann nichts. `
    + 'Hat sich die Schreibweise des class-Attributs geaendert?',
  );

  const selectorMatchesHead = (selector) =>
    [...headClasses].some((cls) => new RegExp(`\\.${escapeForRegExp(cls)}(?![\\w-])`).test(selector));

  const offenders = [];
  for (const name of cssFiles) {
    for (const { selector, body } of eachRule(read(`../public/styles/${name}`))) {
      if (selector.startsWith('@')) continue;


      if (selectorMatchesHead(selector) && /flex-direction:/.test(body)) {
        offenders.push(`${name}: ${selector} setzt flex-direction auf einer Kopf-Klasse`);
      }

      //     geschriebener Wert waere eine zweite Wahrheit ueber dieselbe Zahl.
      //     `the collapsing header is wired once, by the shell` prueft dasselbe

      if (name !== 'layout.css' && /--page-toolbar-lead:/.test(body)) {
        offenders.push(`${name}: ${selector} setzt
      }


      // waere eine zweite Wahrheit ueber dieselbe Zusage.
    }
  }
  assert.deepEqual(offenders, []);
});

test('ob ein Seitentitel ueber einer Leiste steht, entscheidet der module:-Wert der Zielroute', () => {
  const router = read('../public/router.js');


  const routes = [];
  for (const m of router.matchAll(/path:\s*'([^']+)'\s*,\s*page:\s*'([^']+)'\s*,\s*requiresAuth:\s*\w+\s*,\s*module:\s*(null|'[^']*')/g)) {
    routes.push({ path: m[1], page: m[2], module: m[3] === 'null' ? null : m[3].slice(1, -1) });
  }



  //     schreiben ihren Pfad als Shorthand (`{ path, page: …, module: … }`),



  //     importierten Konstante; von dort kommen sie jetzt.
  const importedFrom = new Map();
  for (const m of router.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    for (const symbol of m[1].split(',')) {
      const name = symbol.split(/\s+as\s+/).pop().trim();
      if (name) importedFrom.set(name, m[2]);
    }
  }
  for (const m of router.matchAll(/(\w+)\.map\(([\s\S]{0,300}?)module:\s*'([^']+)'/g)) {
    const [, symbol, block, mod] = m;
    const page = block.match(/page:\s*'([^']+)'/)?.[1];
    const file = importedFrom.get(symbol);
    if (!page || !file) continue;
    let source;
    try { source = read(`../public${file}`); } catch { continue; }
    const declaration = source.slice(source.indexOf(`export const ${symbol}`));
    const body = declaration.slice(0, declaration.indexOf('\n]'));
    const paths = [...body.matchAll(/path:\s*'([^']+)'/g)].map((p) => p[1]);
    const literals = paths.length ? paths : [...body.matchAll(/'(\/[^']*)'/g)].map((p) => p[1]);
    for (const path of literals) routes.push({ path, page, module: mod });
  }

  assert.ok(
    routes.length >= 15,
    `Aus router.js kamen nur ${routes.length} Routen - der Guard misst dann nichts. `
    + 'Hat sich die Schreibweise der ROUTES-Eintraege geaendert?',
  );
  for (const mod of ['health', 'settings', 'shopping']) {
    assert.ok(
      routes.some((r) => r.module === mod),
      `Modul "${mod}" fehlt in der abgeleiteten Routentabelle - der Guard ist genau dort blind, `
      + 'wo die Routen programmatisch entstehen.',
    );
  }


  const sectionModules = new Set(
    [...router.matchAll(/\w*LEAVES\.map\([\s\S]{0,300}?module:\s*'([^']+)'/g)].map((m) => m[1]),
  );

  const moduleOf = (path) => {
    const exact = routes.find((r) => r.path === path);
    if (exact) return exact.module;
    let best = null;
    for (const r of routes) {
      if (r.path.length <= 1) continue;
      if (path === r.path || path.startsWith(`${r.path}/`)) {
        if (!best || r.path.length > best.path.length) best = r;
      }
    }
    return best?.module ?? null;
  };



  //    Leisten-Bauteile (Sub-Tabs, Tablist, Sektions-Shell); /components/
  //    bleibt aussen vor, weil dort keine Modul-Navigation entsteht.
  const pageOf = new Map();
  for (const r of routes) if (r.module && !pageOf.has(r.module)) pageOf.set(r.module, r.page);

  const sourcesOf = (pagePath) => {
    let pageSrc;
    try { pageSrc = read(`../public${pagePath}`); } catch { return []; }
    const out = [pageSrc];
    for (const m of pageSrc.matchAll(/from\s+'(\/(?:utils|settings)\/[\w./-]+\.js)'/g)) {
      try { out.push(read(`../public${m[1]}`)); } catch { /* nicht aufloesbar - ueberspringen */ }
    }
    return out;
  };

  const TABLIST = /role="tablist"|setAttribute\(\s*'role'\s*,\s*'tablist'\s*\)|\bwireTablist\(|\brenderSubTabs\(/;



  // `utils/popover-menu.js` erwaehnt in seiner Begruendung woertlich






  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const classAttrs = (src, needle) =>
    [...src.matchAll(/(?:class="|className\s*=\s*')([^"']*)/g)]
      .map((m) => m[1])
      .filter((value) => new RegExp(`\\b${needle}\\b`).test(value));

  const offenders = [];
  for (const [mod, page] of pageOf) {
    const sources = sourcesOf(page);
    if (!sources.length) continue;



    const isSection = sectionModules.has(mod);
    if (!isSection && !sources.some((src) => TABLIST.test(stripComments(src)))) continue;





    const hasCanonicalHead = sources.some((src) =>
      classAttrs(src, 'page-toolbar').some((value) => !/\bpage-toolbar--in-group\b/.test(value)));
    const hasTitle = sources.some((src) =>
      classAttrs(src, 'page-toolbar__title').some((value) => !/\bsr-only\b/.test(value)));
    const visibleTitle = hasCanonicalHead && hasTitle;

    if (isSection) {
      const ownTitle = sources.some((src) =>
        /<h1\b(?![^>]*\bsr-only\b)/.test(src) || /createElement\(\s*'h1'\s*\)/.test(src));
      if (!ownTitle) {
        offenders.push(`${mod}: Sektion mit eigener Shell, fuehrt aber keinen eigenen sichtbaren Titel`);
      }
      if (hasTitle) {
        offenders.push(`${mod}: Sektion mit eigener Shell traegt zusaetzlich einen page-toolbar__title - zwei Koepfe fuer einen Titel`);
      }
      continue;
    }

    const targeted = new Set(
      [...new Set(sources.flatMap((src) => [...src.matchAll(/\broute:\s*'([^']+)'/g)].map((m) => m[1])))]
        .map(moduleOf)
        .filter(Boolean),
    );

    if (targeted.size > 1 && visibleTitle) {
      offenders.push(
        `${mod}: die Leiste wechselt den module:-Wert (${[...targeted].sort().join(', ')}) und ist damit `
        + 'selbst die Kopf-Navigation - ueber ihr steht kein Seitentitel',
      );
    }
    if (targeted.size <= 1 && !visibleTitle) {
      offenders.push(
        `${mod}: die Leiste wechselt keinen module:-Wert - der Modulname gehoert als sichtbarer `
        + '.page-toolbar__title in den kanonischen Kopf darueber',
      );
    }
  }
  assert.deepEqual(offenders, []);
});

// --------------------------------------------------------------------------
// KOLLABIERENDE LARGE-TITLE-LEISTE (Redesign Runde 4, C-1)
//




// Canonical-Page-Head-Rolle einmal aufgeloest hat (18/22/28px gestreut).
//


// --------------------------------------------------------------------------
test('one page-head title scale, owned by the shell', () => {
  const SHELL = new Set(['layout.css', 'typography.css']);
  const files = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((name) => name.endsWith('.css'));

  const typography = read('../public/styles/typography.css');
  assert.match(
    typography,
    /\.page-toolbar:not\(\.page-toolbar--in-group\)\s*>\s*\.page-toolbar__title\s*\{[^}]*font-size:\s*var\(--type-page-title-mobile\)/,
    'Die Large-Title-Zone traegt
  );
  assert.match(
    typography,
    /\.page-toolbar--capped\.is-collapsed\s*>\s*\.page-toolbar__title\s*\{[^}]*font-size:\s*var\(--type-toolbar-title\)/,
    'Der eingeklappte Kopf faellt auf den Inline-Schnitt zurueck.',
  );






  assert.match(
    read('../public/styles/layout.css'),
    /\.page-toolbar:not\(\.page-toolbar--in-group\)\s*>\s*\.page-toolbar__title\s*\{[^}]*flex-basis:\s*calc\(100% - var\(--seal-head-lead\)\)/,
    'Die eigene Zeile des Large Title steht in layout.css.',
  );

  const offenders = [];
  for (const name of files) {
    if (SHELL.has(name)) continue;
    for (const { selector, body } of eachRule(read(`../public/styles/${name}`))) {
      if (!selector.includes('.page-toolbar__title')) continue;
      if (!/font-size:/.test(body)) continue;
      offenders.push(`${name}: ${selector} setzt eine eigene Titelgroesse`);
    }
  }
  assert.deepEqual(offenders, []);
});

// --------------------------------------------------------------------------




// siebzehn teilen.
// --------------------------------------------------------------------------
test('the collapsing header is wired once, by the shell', () => {
  const pageFiles = readdirSync(new URL('../public/pages/', import.meta.url))
    .filter((name) => name.endsWith('.js'));
  const offenders = [];
  for (const name of pageFiles) {
    const js = read(`../public/pages/${name}`);
    if (/wireCollapsingHeader|--page-toolbar-lead/.test(js)) {
      offenders.push(`${name}: verdrahtet den Modulkopf selbst`);
    }
  }
  assert.deepEqual(offenders, [], 'Nur der Router verdrahtet die Modulkoepfe.');

  assert.match(
    read('../public/router.js'),
    /wireCollapsingHeader/,
    'Der Router verdrahtet die Koepfe der frisch gerenderten Seite.',
  );

  const styles = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((name) => name.endsWith('.css') && name !== 'layout.css');
  for (const name of styles) {
    assert.doesNotMatch(
      read(`../public/styles/${name}`),
      /--page-toolbar-lead/,
      `${name} liest den Andock-Versatz - der gehoert in layout.css.`,
    );
  }
});

// --------------------------------------------------------------------------




// --------------------------------------------------------------------------


test('jeder Blur kommt aus der --blur-Skala', () => {
  const offenders = [];
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      for (const declared of rule.body.matchAll(/(?:-webkit-)?backdrop-filter\s*:\s*([^;]+)/g)) {
        for (const blur of declared[1].matchAll(/blur\(\s*([^)]+?)\s*\)/g)) {
          if (blur[1].startsWith('var(--blur-') || blur[1] === '0') continue;
          offenders.push(`${file}: ${rule.selector} -> blur(${blur[1]})`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `Blur ausserhalb der Skala:\n${offenders.join('\n')}`);
});

test('backdrop-filter steht immer zweizweigig - Standard und -webkit-', () => {
  const files = readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'));
  const offenders = [];
  let seenRules = 0;
  let seenSupports = 0;

  for (const file of files) {
    const css = read(`../public/styles/${file}`);
    for (const rule of eachRule(css)) {


      // erklaerte jede webkit-only-Regel fuer vollstaendig.
      const std = /(?<!-webkit-)backdrop-filter\s*:/.test(rule.body);
      const webkit = /-webkit-backdrop-filter\s*:/.test(rule.body);
      if (!std && !webkit) continue;
      seenRules += 1;
      if (std !== webkit) {
        offenders.push(`${file}: ${rule.selector} schreibt nur `
          + `${std ? 'backdrop-filter' : '-webkit-backdrop-filter'}`);
      }
    }



    // er zitiert die Regel woertlich.
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@supports([^{]*)\{/g)) {
      if (!/backdrop-filter/.test(m[1])) continue;
      seenSupports += 1;
      if (!/-webkit-backdrop-filter/.test(m[1]) || !/(?<!-webkit-)backdrop-filter/.test(m[1])) {
        offenders.push(`${file}: @supports${m[1].trim()} fragt nur nach einer Schreibweise`);
      }
    }
  }


  assert.ok(seenRules >= 10 && seenSupports >= 5,
    `Nur ${seenRules} Blur-Regeln und ${seenSupports} @supports-Bloecke gefunden - der `
    + 'Guard hat nichts gemessen, statt nichts zu finden.');

  assert.deepEqual(offenders, [],
    'Die Zweizweig-Regel aus dem Kopf von glass.css: jede Regel schreibt beide '
    + 'Schreibweisen, jede @supports-Praeambel fragt nach beiden. Safari < 18 kennt '
    + `nur das Praefix - und iOS ist das Hauptgeraet dieser PWA.\n${offenders.join('\n')}`);
});

test('ein Maskenstopp kommt aus --mask-opaque, nie als roher Farbwert', () => {
  const files = readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'));
  const offenders = [];
  let seen = 0;

  for (const file of files) {
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      for (const decl of rule.body.matchAll(/(?:-webkit-)?mask-image\s*:\s*([^;]+)/g)) {
        seen += 1;


        for (const raw of decl[1].matchAll(/(?:^|[\s,(])(#000{1,3}(?:[0-9a-f]{2})?|black)(?=[\s,)])/gi)) {
          offenders.push(`${file}: ${rule.selector} -> ${raw[1]}`);
        }
      }
    }
  }

  assert.ok(seen >= 10,
    `Nur ${seen} Masken-Deklarationen gefunden - der Guard hat nichts gemessen.`);

  assert.deepEqual(offenders, [],
    'Ein Maskenstopp ist kein Farbwert - er nimmt `var(--mask-opaque)`. Ein rohes '
    + '`#000` oder `black` an dieser Stelle sieht wie eine Farbentscheidung aus, ist '
    + `aber „voll deckend" und hat mit der Farbwelt nichts zu tun.\n${offenders.join('\n')}`);
});

test('ein Inset-Specular kommt aus dem Token, nie als rohes rgba', () => {
  const files = readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'));
  const offenders = [];
  let seenShadows = 0;
  let seenInsets = 0;

  for (const file of files) {
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      for (const decl of rule.body.matchAll(/box-shadow\s*:\s*([^;]+)/g)) {
        seenShadows += 1;


        // Klammertiefe mitgezaehlt statt naiv gesplittet.
        const segments = [];
        let depth = 0;
        let current = '';
        for (const ch of decl[1]) {
          if (ch === '(') depth += 1;
          if (ch === ')') depth -= 1;
          if (ch === ',' && depth === 0) { segments.push(current); current = ''; continue; }
          current += ch;
        }
        segments.push(current);

        for (const seg of segments) {
          if (!/\binset\b/.test(seg)) continue;
          seenInsets += 1;
          const rawRgba = seg.match(/rgba?\([^)]*\)/);
          if (rawRgba) offenders.push(`${file}: ${rule.selector} -> ${rawRgba[0]}`);
        }
      }
    }
  }

  assert.ok(seenShadows >= 100 && seenInsets >= 20,
    `Nur ${seenShadows} box-shadow-Deklarationen und ${seenInsets} inset-Segmente gelesen - `
    + 'der Guard hat nichts gemessen, statt nichts zu finden.');

  assert.deepEqual(offenders, [],
    'Ein Inset-Specular nimmt ein `--glass-inset-*`-Token oder die color-mix-Formel '
    + 'ueber `--lg-specular`. Ein rohes rgba traegt den a11y-Schalter nicht: unter '
    + 'prefers-reduced-transparency und prefers-contrast muss die Lichtkante '
    + `verschwinden, und ein fester Wert tut das nie.\n${offenders.join('\n')}`);
});

test('was das Display umfaerbt, gilt nur fuers Display', () => {
  const css = read('../public/styles/tokens.css');
  const offenders = [];
  let themeRules = 0;
  let themedTokens = 0;

  for (const rule of eachRule(css)) {
    const declared = [...rule.body.matchAll(/(--_[a-z0-9-]+)\s*:/gi)];
    if (!declared.length) continue;

    const chain = rule.at.join(' ');
    const meansOneTheme = /prefers-color-scheme/.test(chain) || /\[data-theme=/.test(rule.selector);
    if (!meansOneTheme) continue;


    // entstehen koennte - nicht davor.
    themeRules += 1;
    themedTokens += declared.length;

    if (!/\bscreen\b/.test(chain)) {
      offenders.push(`${rule.selector} (At-Kette: ${chain || 'keine'}) setzt `
        + `${declared.length} Theme-Tokens ohne @media screen`);
    }
  }

  assert.ok(themeRules >= 2 && themedTokens >= 100,
    `Nur ${themeRules} Theme-Regeln mit ${themedTokens} Tokens gelesen - der Guard hat `
    + 'nichts gemessen, statt nichts zu finden. tokens.css fuehrt zwei Dark-Bloecke '
    + '(System-Praeferenz und expliziter Nutzer-Override) mit je ueber siebzig Tokens.');

  assert.deepEqual(offenders, [],
    'Ein Block, der die Farbwelt umschaltet, gehoert unter `@media screen`. Ohne ihn '
    + 'druckt die App ihre Bildschirmfarben auf Papier: erst schwarze Tinte auf '
    + 'schwarzem Grund, nach dem Neutralisieren der Flaechen vivide Dark-Akzente auf '
    + `Weiss.\n${offenders.join('\n')}`);
});

test('ein Well traegt keine eigene Kante', () => {
  const offenders = [];
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    if (file === 'tokens.css') continue;
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      if (!/background(?:-color)?\s*:[^;]*var\(--color-fill-well\)/.test(rule.body)) continue;
      for (const declared of rule.body.matchAll(/(?:^|[;{}\s])(border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?)\s*:\s*([^;]+)/g)) {
        const value = declared[2].trim();
        if (/^(none|0|unset|initial)\b/.test(value)) continue;
        offenders.push(`${file}: ${rule.selector} -> ${declared[1]}: ${value}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Ein Well ist eine Vertiefung, kein umrandeter Kasten:\n${offenders.join('\n')}`,
  );
});

test('kein Titel wird zu Gradient-Text, und der Large Title bleibt in der Textfarbe', () => {
  const gradientText = [];
  const tintedTitle = [];
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      if (/(?:-webkit-)?background-clip\s*:\s*text/.test(rule.body)
        || /-webkit-text-fill-color\s*:\s*transparent/.test(rule.body)) {
        gradientText.push(`${file}: ${rule.selector}`);
      }

      if (!/(^|[\s,>])\.page-toolbar__title\b/.test(rule.selector)) continue;
      const colour = rule.body.match(/(?:^|[;{}\s])color\s*:\s*([^;]+)/);
      if (colour && !/var\(--color-text-primary\)|inherit/.test(colour[1])) {
        tintedTitle.push(`${file}: ${rule.selector} -> color: ${colour[1].trim()}`);
      }
    }
  }
  assert.deepEqual(gradientText, [], `Gradient-Text gehoert der abgeloesten Welt:\n${gradientText.join('\n')}`);
  assert.deepEqual(tintedTitle, [], `Der Large Title traegt --color-text-primary:\n${tintedTitle.join('\n')}`);
});

test('kein Inline-Style in public/ schreibt einen Design-Wert als Literal', () => {
  const DESIGN_PROPS = /^(font-size|font-weight|letter-spacing|line-height|border-radius|box-shadow|color|background|background-color|border-color)$/;
  const offenders = [];
  for (const path of walkJsFiles('../public/')) {
    if (path.includes('/vendor/')) continue;
    for (const attr of read(path).matchAll(/style\s*=\s*(["'])([^"']*?)\1/g)) {
      for (const declared of attr[2].matchAll(/(?:^|[;\s])([a-z-]+)\s*:\s*([^;"'`]+)/g)) {
        const [, prop, raw] = declared;
        if (!DESIGN_PROPS.test(prop)) continue;
        const value = raw.trim();
        if (/var\(--|\$\{/.test(value)) continue;
        offenders.push(`${path}: ${prop}: ${value}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Design-Wert inline statt aus tokens.css - eine Klasse dafuer anlegen:\n${offenders.join('\n')}`,
  );
});

const TINT_SOURCE = /--(module-[\w-]+|meal-[\w-]+|weather-[\w-]+|cycle-[\w-]+|layer-color|note-color|holi-color|ev-color|c-accent|active-module-accent|item-module-accent|color-accent|color-warning|color-danger|color-success|today-card-accent|widget-accent|subscription-color|rw-[\w-]+)/;
const TINT_USER_COLOUR = /--(layer-color|note-color|holi-color|ev-color|subscription-color|c-accent|countdown-accent)/;
const TINT_OPAQUE_FLOOR = 45;

test('jede Toenung nimmt eine Stufe der Toenungsskala', () => {
  const offenders = [];
  let seen = 0;
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    if (file === 'tokens.css') continue; // dort stehen die Stufen selbst
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      for (const mix of rule.body.matchAll(/([a-z-]+)\s*:[^;]*?color-mix\(\s*in srgb\s*,\s*([^;{}]+?)\s+(?:(\d+)%|var\(--tint-[a-z]+\)|calc\([^)]*--tint-[a-z]+[^)]*\))\s*,/g)) {
        const [, prop, source, pct] = mix;
        if (!TINT_SOURCE.test(source)) continue;
        seen += 1;
        if (pct === undefined) continue;
        if (Number(pct) >= TINT_OPAQUE_FLOOR) continue;
        if (prop === 'color' && TINT_USER_COLOUR.test(source)) continue;
        offenders.push(`${file}: ${rule.selector} -> ${prop}: ${pct}% (${source.trim()})`);
      }
    }
  }




  assert.ok(seen >= 150, `Nur ${seen} Toenungen gesehen - die Signatur greift nicht mehr.`);
  assert.deepEqual(
    offenders,
    [],
    'Toenung mit einer eigenen Zahl statt einer Stufe aus tokens.css (6b).\n'
    + 'Waehle die Stufe nach der ROLLE: wash (untergreift fremden Inhalt), state\n'
    + '(Zustand), surface (die Toenung IST das Element), raised (Zustand darauf),\n'
    + `hint (Andeutung), ink (Text), shadow.\n${offenders.join('\n')}`,
  );
});

test('eine Nutzerfarbe als Textfarbe nimmt ein gemessenes Rezept, keine Toenungsstufe', () => {
  const offenders = [];
  let seen = 0;
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    if (file === 'tokens.css') continue;
    for (const rule of eachRule(read(`../public/styles/${file}`))) {


      for (const mix of rule.body.matchAll(/([a-z-]+)\s*:[^;]*?color-mix\(\s*in srgb\s*,\s*([^;{}]+?)\s+(?:(\d+)%|var\((--tint-[a-z]+)\))\s*,/g)) {
        const [, prop, source, pct, step] = mix;
        if (prop !== 'color' || !TINT_USER_COLOUR.test(source)) continue;
        seen += 1;
        if (pct !== undefined) continue;                       // gemessenes Rezept - erlaubt
        offenders.push(`${file}: ${rule.selector} -> color: ${step} auf ${source.trim()}`);
      }
    }
  }



  assert.ok(seen >= 4, `Nur ${seen} Nutzerfarben-Textfarben gesehen - die Signatur greift nicht mehr.`);
  assert.deepEqual(
    offenders,
    [],
    'Eine Toenungsstufe als Textfarbe auf einer frei waehlbaren Nutzerfarbe (DESIGN.md,\n'
    + 'Grenze der Akzent-auf-Toenung-Regel). Die Stufen sind an KURATIERTEN Modultoenen\n'
    + 'gemessen und brechen an den Enden der Helligkeitsachse - weiss auf light 1.92:1.\n'
    + 'Nimm das gemessene Rezept (35 % wie im Kalender) oder ein Token\n'
    + `(--color-text-primary).\n${offenders.join('\n')}`,
  );
});

test('jede Stufe der Toenungsskala hat mindestens einen Nutzer', () => {
  const tokens = read('../public/styles/tokens.css');
  const declared = [...tokens.matchAll(/^\s*(--tint-[a-z]+):/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 7, `Nur ${declared.length} Stufen gefunden - die Skala ist weg.`);

  const used = new Set();
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    if (file === 'tokens.css') continue;
    for (const hit of read(`../public/styles/${file}`).matchAll(/var\((--tint-[a-z]+)\)/g)) used.add(hit[1]);
  }
  assert.deepEqual(
    declared.filter((t) => !used.has(t)),
    [],
    'Eine Stufe ohne Nutzer ist eine Einladung, sie beim naechsten Mal falsch zu belegen.',
  );
});

const MARK_SOURCE = /--(module-[\w-]+|meal-[\w-]+|weather-[\w-]+|cycle-[\w-]+|layer-color|note-color|holi-color|ev-color|c-accent|cat|active-module-accent|item-module-accent|today-card-accent|widget-accent|subscription-color|countdown-accent|module-row-accent|seal-accent|rw-[\w-]+|color-accent)\b/;
const MARK_WASH = /var\(--tint-(wash|surface)\)/;
const MARK_VIVID_PROP = /^(background(-color|-image)?|border(-[\w-]+)?|box-shadow|outline|fill)$/;

function declarations(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out
    .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()])
    .filter(([prop]) => prop);
}

function withoutColorMix(value) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (depth === 0 && value.startsWith('color-mix(', i)) { depth = 1; i += 9; continue; }
    if (depth > 0) {
      if (value[i] === '(') depth += 1;
      else if (value[i] === ')') depth -= 1;
      continue;
    }
    out += value[i];
  }
  return out;
}

test('eine Marke nennt ihre Identitaet im Vollton, nicht zweimal als Waschung', () => {
  const offenders = [];
  let seen = 0;
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    if (file === 'tokens.css') continue;
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      const decls = declarations(rule.body);
      // Ein BEHAELTER: bemessen statt vom Text getragen.
      if (!decls.some(([p]) => p === 'width') || !decls.some(([p]) => p === 'height')) continue;
      if (!MARK_SOURCE.test(rule.body)) continue;
      seen += 1;

      const washed = decls.find(([p, v]) => /^background(-color)?$/.test(p) && MARK_WASH.test(v) && MARK_SOURCE.test(v));
      if (!washed) continue;
      const source = washed[1].match(MARK_SOURCE)[0];


      if (!decls.some(([p, v]) => p === 'color' && v.includes(`var(${source}`))) continue;

      const vivid = decls.some(([p, v]) => MARK_VIVID_PROP.test(p) && withoutColorMix(v).includes(`var(${source}`));
      if (vivid) continue;
      offenders.push(`${file}: ${rule.selector} -> ${source}`);
    }
  }




  // rot faerbt, nur weil sie dazukommt.
  assert.ok(seen >= 35, `Nur ${seen} bemessene Marken gesehen - die Signatur greift nicht mehr.`);
  assert.deepEqual(
    offenders,
    [],
    'Eine Marke nennt ihre Identitaet zweimal als Waschung (DESIGN.md, Colors: die\n'
    + 'Vollton-Regel). Eine 16-%-Toenung hellt im Dark nur auf und laesst im Light\n'
    + 'benachbarte Familientoene auf denselben Wert fallen - sie kann die Aussage\n'
    + 'nicht tragen. Zwei Antworten:\n'
    + '  kuratierter Ton  -> Vollton-Flaeche, Glyph in var(--color-ink-on-vivid)\n'
    + '                      (Klasse `vivid-mark`, layout.css)\n'
    + '  freie Nutzerfarbe -> Vollton als Kante, Ring oder Punkt NEBEN dem Inhalt\n'
    + `                      (3px border-inline-start, inset box-shadow)\n${offenders.join('\n')}`,
  );
});

const LABEL_STATE = /(:hover|:focus|:active|:checked|\.is-|--active|--selected|--current|--dragging|--loading|--open|\[aria-|\[data-)/;

test('was keine Marke ist, nennt seinen Ton auch nicht zweimal blass', () => {
  const offenders = [];
  let seen = 0;
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    if (file === 'tokens.css') continue;
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      const decls = declarations(rule.body);

      if (decls.some(([p]) => p === 'width') && decls.some(([p]) => p === 'height')) continue;

      if (decls.some(([p, v]) => p === 'cursor' && v.trim() === 'pointer')) continue;

      const washed = decls.find(([p, v]) => /^background(-color)?$/.test(p) && v.includes('color-mix') && MARK_SOURCE.test(v));
      if (!washed) continue;
      seen += 1;
      const source = washed[1].match(MARK_SOURCE)[0];




      const pale = decls.find(([p, v]) => p === 'color' && v.includes(`var(${source}`));
      if (!pale) continue;

      if (decls.some(([p, v]) => MARK_VIVID_PROP.test(p) && withoutColorMix(v).includes(`var(${source}`))) continue;

      const selectors = rule.selector.split(',').map((sel) => sel.trim()).filter((sel) => !LABEL_STATE.test(sel));
      if (!selectors.length) continue;
      offenders.push(`${file}: ${selectors.join(', ')} -> ${source}`);
    }
  }




  // greift.
  assert.ok(seen >= 15, `Nur ${seen} nicht-bemessene Waschungen gesehen - die Signatur greift nicht mehr.`);
  assert.deepEqual(
    offenders,
    [],
    'Etwas, das keine Marke ist, nennt seinen Ton zweimal blass (DESIGN.md,\n'
    + 'Colors: die Skalen-Regel). Getoente Flaeche UND gemischte Schrift derselben\n'
    + 'Farbe ist die zurueckgenommene Fassung - eine Beimischung hellt im Dark\n'
    + 'fast nur auf. Drei Antworten, je nachdem was das Element SAGT:\n'
    + '  Meldung   -> Ton in der Schrift, keine Flaeche\n'
    + '  Rangmarke -> Vollton-Punkt daneben, Schrift neutral\n'
    + '  Zuordnung -> Vollton-Flaeche mit var(--color-ink-on-vivid); nennt sie den\n'
    + '               Raum, in dem sie steht, bleibt sie neutral (--color-fill-well)\n'
    + `${offenders.join('\n')}`,
  );
});

test('eine Waschung und ihre Tinte zaehlen zusammen, auch ueber zwei Regeln', () => {
  const offenders = [];
  let seen = 0;
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    if (file === 'tokens.css') continue;
    const rules = [...eachRule(read(`../public/styles/${file}`))];

    for (const rule of rules) {
      const decls = declarations(rule.body);
      const bedienEltern = decls.some(([p, v]) => p === 'cursor' && v.trim() === 'pointer');
      const wash = decls.find(([p, v]) => /^background(-color)?$/.test(p) && v.includes('color-mix') && MARK_SOURCE.test(v));
      if (!wash) continue;
      const source = wash[1].match(MARK_SOURCE)[0];

      if (decls.some(([p, v]) => MARK_VIVID_PROP.test(p) && withoutColorMix(v).includes(`var(${source}`))) continue;

      const eltern = rule.selector.split(',').map((x) => x.trim()).filter((x) => !LABEL_STATE.test(x));
      if (!eltern.length) continue;
      seen += 1;

      for (const kind of rules) {
        if (kind === rule) continue;
        const kdecls = declarations(kind.body);
        if (kdecls.some(([p, v]) => p === 'cursor' && v.trim() === 'pointer')) continue;

        if (kdecls.some(([p, v]) => MARK_VIVID_PROP.test(p) && withoutColorMix(v).includes(`var(${source}`))) continue;
        const tinte = kdecls.find(([p, v]) => p === 'color' && v.includes(`var(${source}`));
        if (!tinte) continue;

        for (const ksel of kind.selector.split(',').map((x) => x.trim())) {
          if (LABEL_STATE.test(ksel)) continue;
          const vorfahr = eltern.find((esel) => ksel.startsWith(`${esel} `) || ksel.startsWith(`${esel}>`));
          if (!vorfahr) continue;
          if (bedienEltern) continue;
          offenders.push(`${file}: ${vorfahr} traegt die Waschung, ${ksel} die Tinte -> ${source}`);
        }
      }
    }
  }


  assert.ok(seen >= 15, `Nur ${seen} Waschungen gesehen - die Signatur greift nicht mehr.`);
  assert.deepEqual(
    offenders,
    [],
    'Eine Identitaetsfarbe steht als Flaeche im Behaelter UND als Tinte im Kind -\n'
    + 'zusammen ist das die Doppelnennung, die die Vollton-Regel abgeschafft hat,\n'
    + 'sie steht nur in zwei Regeln statt in einer. Entweder die Farbe steht\n'
    + 'irgendwo VOLL (Kante, Punkt, gefuellte Scheibe), oder beide bleiben neutral.\n'
    + `${offenders.join('\n')}`,
  );
});

const SCALE_PAINT = /^(color|background|background-color|border-color|fill|stroke)$/;
const SCALE_RESET = /^(none|transparent|inherit|initial|unset|currentcolor)$/i;
const SCALE_IGNORE = /^(content|transition|animation|will-change|cursor|font-family|--)/;

test('zwei Stufen einer Reihe sehen nie unabsichtlich gleich aus', () => {
  const families = new Map();
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    if (file === 'tokens.css') continue;
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      const mods = rule.selector.split(',').map((sel) => sel.trim())
        .map((sel) => sel.match(/^\.([a-z0-9-]+?)--([a-z0-9-]+)$/i))
        .filter(Boolean);
      if (!mods.length) continue;
      const decls = declarations(rule.body);


      if (!decls.some(([p, v]) => SCALE_PAINT.test(p) && !SCALE_RESET.test(v.trim()))) continue;



      // Farb-Filter sieht (gemessen an .btn--danger-outline gegen -ghost).
      const paint = decls
        .filter(([p]) => !SCALE_IGNORE.test(p))
        .map(([p, v]) => `${p}:${v.replace(/\s+/g, ' ').trim()}`)
        .sort()
        .join(';');
      if (!paint) continue;

      const declared = mods.map((m) => m[2]).join('+');
      for (const m of mods) {
        const key = `${file}|${m[1]}|${rule.at.join('>')}`;
        if (!families.has(key)) families.set(key, []);
        families.get(key).push({ mod: m[2], paint, declared });
      }
    }
  }

  const offenders = [];
  let compared = 0;
  for (const [key, entries] of families) {
    if (entries.length < 2) continue;
    compared += 1;
    const byPaint = new Map();
    for (const entry of entries) {
      if (!byPaint.has(entry.paint)) byPaint.set(entry.paint, []);
      byPaint.get(entry.paint).push(entry);
    }
    for (const [, group] of byPaint) {
      const declarations_ = new Set(group.map((g) => g.declared));

      if (declarations_.size < 2 && group.length === group[0].declared.split('+').length) continue;
      const mods = [...new Set(group.map((g) => g.mod))];
      if (mods.length < 2) continue;
      if (declarations_.size === 1) continue;
      offenders.push(`${key} -> ${mods.join(' == ')}`);
    }
  }
  assert.ok(compared >= 20, `Nur ${compared} Modifier-Reihen verglichen - der Scanner greift nicht mehr.`);
  assert.deepEqual(
    offenders,
    [],
    'Zwei Modifier derselben Basisklasse malen dasselbe, ohne sich eine Regel zu\n'
    + 'teilen (DESIGN.md, Colors: die Skalen-Regel). Entweder ist eine Stufe zu\n'
    + 'viel benannt, oder sie ist gemeint und gehoert in DIESELBE Regel wie ihre\n'
    + `Schwester - dort steht sie als Absicht statt als Zufall.\n${offenders.join('\n')}`,
  );
});

test('kein var() auf ein Token, das nirgends entsteht', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);
  const defined = new Set();
  const used = new Map();

  for (const name of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    const css = read(`../public/styles/${name}`).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);


    for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(name);
    }
  }

  const runtime = new Set();
  const collectJs = (dir) => {
    for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== 'vendor') collectJs(`${dir}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const src = read(`${dir}${entry.name}`);
      for (const m of src.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) runtime.add(m[1]);

      // (`style="--point-x:..;--point-slots:.."`): erst das Attribut greifen,


      for (const attr of src.matchAll(/style\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)) {
        for (const m of (attr[1] ?? attr[2] ?? attr[3] ?? '').matchAll(/(--[\w-]+)\s*:/g)) runtime.add(m[1]);
      }
    }
  };
  collectJs('../public/');

  assert.ok(defined.size >= 400, `Nur ${defined.size} Token-Definitionen gefunden - der Scanner misst nichts.`);
  assert.ok(used.size >= 100, `Nur ${used.size} fallback-freie var()-Verwendungen gefunden - dito.`);

  const orphans = [...used.keys()]
    .filter((token) => !defined.has(token) && !runtime.has(token))
    .map((token) => `${token} (in ${[...used.get(token)].join(', ')})`);

  assert.deepEqual(
    orphans,
    [],
    'var() auf ein Token, das weder in einem Stylesheet noch zur Laufzeit entsteht.\n'
    + 'Die Deklaration ist ungueltig und die Eigenschaft erbt still weiter - das faellt\n'
    + `im Betrieb nicht auf, aber sie tut nicht, was dasteht.\n${orphans.join('\n')}`,
  );
});

test('die Deaktiviert-Farbe steht an keinem erreichbaren Bedienelement', () => {
  const DISABLED_SELECTOR = /:disabled\b|\[disabled\]|\[aria-disabled(?:="true")?\]|(?:^|[\s.>+~])[\w-]*(?:--disabled|\.is-disabled)\b/;
  const DIRECT_COLOR = /(?:^|[;{\s])color:\s*var\(--color-text-disabled\s*\)/;

  const styleDir = new URL('../public/styles/', import.meta.url);
  let rulesSeen = 0;
  let usesSeen = 0;
  const offenders = [];

  for (const name of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    if (name === 'tokens.css') continue;
    for (const { selector, body } of eachRule(read(`../public/styles/${name}`))) {
      rulesSeen += 1;
      if (!DIRECT_COLOR.test(body)) continue;
      usesSeen += 1;
      if (!DISABLED_SELECTOR.test(selector)) offenders.push(`${name}: ${selector}`);
    }
  }



  // "keine Verstoesse" durchgegangen.
  assert.ok(rulesSeen >= 2000, `Nur ${rulesSeen} Regeln gelesen - der Scanner hat nichts gesehen.`);
  assert.ok(usesSeen > 0, 'Keine einzige Verwendung von --color-text-disabled gefunden. '
    + 'Wurde das Token umbenannt? Dann prueft dieser Guard seit dem Umbenennen nichts mehr.');

  assert.deepEqual(
    offenders,
    [],
    '--color-text-disabled als Ruhefarbe eines erreichbaren Elements. Die Farbe traegt\n'
    + 'nirgends 3:1 - erlaubt ist sie nur, wo der Selektor den deaktivierten Zustand\n'
    + 'auch benennt (:disabled, [disabled], [aria-disabled]). Ein Element, das nur\n'
    + `zuruecktreten soll, nimmt --color-text-tertiary (4,86 bis 6,90).\n${offenders.join('\n')}`,
  );
});

test('the status bar colour is the page background, in both themes', () => {
  const tokens = read('../public/styles/tokens.css');

  const propsOf = (wanted) => {
    const map = new Map();
    for (const { selector, body, at } of eachRule(tokens)) {
      const conditional = at.some((a) => !/^@media\s+screen$/.test(a.trim()));
      if (conditional || selector !== wanted) continue;
      for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        map.set(name, value.trim());
      }
    }
    return map;
  };

  const light = propsOf(':root');
  const dark = new Map([...light, ...propsOf('[data-theme="dark"]')]);

  /** Folgt `var(--a)` -> `var(--b)` -> `#hex`, hoechstens zehn Stufen tief. */
  const resolve = (scope, name) => {
    let value = scope.get(name);
    for (let step = 0; step < 10 && value; step += 1) {
      const ref = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
      if (!ref) break;
      value = scope.get(ref[1]);
    }
    return value?.toUpperCase();
  };

  const expected = {
    light: resolve(light, '--color-bg'),
    dark: resolve(dark, '--color-bg'),
  };


  assert.match(expected.light ?? '', /^#[0-9A-F]{6}$/, '--color-bg (hell) liess sich nicht bis auf einen Hexwert aufloesen');
  assert.match(expected.dark ?? '', /^#[0-9A-F]{6}$/, '--color-bg (dunkel) liess sich nicht bis auf einen Hexwert aufloesen');
  assert.notEqual(expected.light, expected.dark, 'Hell und Dunkel loesen auf denselben Wert auf - die Dark-Quelle wurde nicht gelesen');

  const offenders = [];

  for (const file of ['../public/index.html', '../public/offline.html']) {
    const html = read(file);
    const metas = [...html.matchAll(/<meta\b[^>]*\bname=["']theme-color["'][^>]*>/g)].map((m) => m[0]);
    assert.equal(metas.length, 2, `${file}: erwartet je ein theme-color-Meta fuer hell und dunkel, gefunden ${metas.length}`);
    for (const meta of metas) {
      const value = meta.match(/\bcontent=["']([^"']+)["']/)?.[1]?.toUpperCase();
      const scheme = /prefers-color-scheme:\s*dark/.test(meta) ? 'dark' : 'light';
      if (value !== expected[scheme]) offenders.push(`${file} (${scheme}): ${value} statt ${expected[scheme]}`);
    }
  }

  const call = read('../public/router.js').match(/setThemeColor\(\s*'(#[0-9A-Fa-f]{6})'\s*,\s*'(#[0-9A-Fa-f]{6})'\s*\)/);
  assert.ok(call, 'expected router.js to set the route-independent status bar colour from two literals');
  if (call[1].toUpperCase() !== expected.light) offenders.push(`router.js (light): ${call[1]} statt ${expected.light}`);
  if (call[2].toUpperCase() !== expected.dark) offenders.push(`router.js (dark): ${call[2]} statt ${expected.dark}`);

  assert.deepEqual(
    offenders,
    [],
    'theme-color weicht von
    + `dann neben der Seite, die sie rahmt:\n${offenders.join('\n')}`,
  );
});

test('a row body that wraps the whole row carries no aria-label and no block elements', () => {
  const ROW_BODY = 'list-row__main--interactive';
  const BLOCK_IN_BUTTON = /<(h[1-6]|p|div)[\s>]/;
  const pages = readdirSync(new URL('../public/pages/', import.meta.url)).filter((f) => f.endsWith('.js'));
  const offenders = [];
  let markupSeen = 0;
  let domSeen = 0;

  for (const file of pages) {
    const src = read(`../public/pages/${file}`).replace(/^\s*\/\/.*$/gm, '');

    // (a) Template-Markup: `<button ... class="... ROW_BODY ...">` bis zum


    // direkt hinter dem Zeilenkoerper.
    for (const open of src.matchAll(/<button\b[^>]*>/g)) {
      if (!open[0].includes(ROW_BODY)) continue;
      markupSeen += 1;
      if (/\baria-label\s*=/.test(open[0])) offenders.push(`${file}: aria-label am Zeilenkoerper (Markup)`);

      let depth = 1;
      let cursor = open.index + open[0].length;
      const tags = /<button\b[^>]*>|<\/button>/g;
      tags.lastIndex = cursor;
      let tag;
      while (depth > 0 && (tag = tags.exec(src))) {
        depth += tag[0] === '</button>' ? -1 : 1;
        if (depth === 0) cursor = tag.index;
      }
      const inner = src.slice(open.index + open[0].length, cursor);
      const block = inner.match(BLOCK_IN_BUTTON);
      if (block) offenders.push(`${file}: <${block[1]}> im Zeilenkoerper (Markup) - Content-Model ist Phrasing Content`);
    }

    // (b) DOM-Weg: `x.className = '... ROW_BODY ...'`, danach dieselbe Variable

    // schliessender Klammer - weiter reicht keine Zeilenfabrik.
    for (const assign of src.matchAll(/(\w+)\.className\s*=\s*(['"`])([^'"`]*)\2/g)) {
      if (!assign[3].includes(ROW_BODY)) continue;
      domSeen += 1;
      const rest = src.slice(assign.index, assign.index + 3000);
      const label = new RegExp(`\\b${assign[1]}\\.(?:setAttribute\\(\\s*['"]aria-label|ariaLabel\\s*=)`);
      if (label.test(rest)) offenders.push(`${file}: aria-label am Zeilenkoerper (DOM)`);
    }
  }

  // Reichweiten-Nachweis: findet der Scanner keinen Zeilenkoerper, prueft er
  // nichts - und beide Schreibweisen muessen einzeln nachgewiesen sein, sonst

  assert.ok(markupSeen >= 1, `Kein Zeilenkoerper im Template-Markup gefunden (${ROW_BODY}) - der Scanner greift nicht mehr.`);
  assert.ok(domSeen >= 2, `Nur ${domSeen} Zeilenkoerper ueber den DOM-Weg gefunden - der Scanner greift nicht mehr.`);

  assert.deepEqual(
    offenders,
    [],
    'Ein Zeilenkoerper umschliesst den ganzen Zeileninhalt. Ein aria-label ersetzt ihn\n'
    + 'fuer Hilfsmittel vollstaendig, und Blockelemente stehen ausserhalb des\n'
    + `Content-Models eines <button>:\n${offenders.join('\n')}`,
  );
});

// --------------------------------------------------------------------------

//

// (.metric-card, .health-metric-card, .housekeeping-metric, .dashboard-metric)




// deckt keine Regel ab, sondern N Dateien).
//

// BEM-Block:




//          (--color-surface oder --color-fill-well).
//




// Guards fand die Signatur sofort zwei uebersehene Nachbauten
// (.health-adherence, .health-activity-stat) - beide sind migriert.
// --------------------------------------------------------------------------
test('wer einen beschrifteten Zahlenblock als Karte baut, nimmt .metric-card', () => {
  const files = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((name) => name.endsWith('.css'));



  const EXEMPT = new Map([
    ['cycle-preg', 'Ereigniskarte: die grosse Zeile ist eine Aussage ueber ein '
      + 'Ereignis („SSW 24"), kein Kennzahlensatz - Label und Wert stehen '
      + 'nicht als Paar, die Karte traegt Icon-Well und Terminzeilen'],
  ]);

  const decl = (body, prop) =>
    body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1]?.trim();
  const blockOf = (sel) => {
    const last = sel.split(/[\s>+~]+/).filter(Boolean).pop() || '';
    const cls = last.match(/\.([a-z][\w-]*)/)?.[1];
    return cls ? cls.split('__')[0].split('--')[0] : null;
  };

  const value = new Map(); // block -> fundstelle
  const label = new Set();
  const cardRoot = new Map();

  for (const name of files) {
    for (const { selector, body } of eachRule(read(`../public/styles/${name}`))) {
      for (const sel of selector.split(',').map((s) => s.trim())) {
        const block = blockOf(sel);
        if (!block || block === 'metric-card') continue;

        const fs = decl(body, 'font-size');
        const fw = decl(body, 'font-weight');
        const big = fs && /--text-(xl|2xl|3xl)/.test(fs);
        const heavy = (fw && /--font-weight-(semibold|bold)|\b[67]00\b/.test(fw))
          || /\bstrong\b/.test(sel);
        if (big && heavy && !value.has(block)) value.set(block, `${name}: ${sel}`);

        const col = decl(body, 'color');
        if (col && /--color-text-secondary/.test(col)) label.add(block);



        const rootLike = new RegExp(`\\.${block}(--[\\w-]+)?$`).test(sel);
        const bg = decl(body, 'background') ?? decl(body, 'background-color');
        if (rootLike && bg && /--color-(surface|fill-well)\b/.test(bg)) {
          if (!cardRoot.has(block)) cardRoot.set(block, `${name}: ${sel}`);
        }
      }
    }
  }

  const offenders = [];
  for (const [block, where] of value) {
    if (!label.has(block) || !cardRoot.has(block)) continue;
    if (EXEMPT.has(block)) continue;
    offenders.push(
      `.${block} (${where}; Flaeche: ${cardRoot.get(block)}) baut die Kennzahlkarte nach `
      + '- Zahl + Sekundaer-Label auf eigener Kartenflaeche ist .metric-card (panel.css)');
  }
  assert.deepEqual(offenders, []);



  const panel = read('../public/styles/panel.css');
  assert.match(panel, /\.metric-card__value\s*\{[^}]*--text-xl/,
    'Die Wert-Signatur von .metric-card ist verschwunden - der Guard misst ins Leere.');
});

// --------------------------------------------------------------------------

//
// Achtzehn modul-eigene Leerzustandsklassen neben der geteilten Grammatik



//

//   text-align: center + Sekundaer-/Tertiaertext + spuerbarer Eigenraum
//   (padding-block ab --space-6).
//


//   - position: absolute: ein schwebender Hinweis (Now-Linie) zentriert




//     Glass-Guard in test-budget-ui.js).
// --------------------------------------------------------------------------
test('ein Flaechen-Leerzustand ist die geteilte .empty-state', () => {
  const files = readdirSync(new URL('../public/styles/', import.meta.url))
    .filter((name) => name.endsWith('.css'));

  const EXEMPT = new Map([
    ['.document-viewer__pdf-page-error', 'Viewer-Zustand: beschreibt EINE Seite '
      + 'des angezeigten Mediums im Overlay, nicht die Flaeche der App'],
    ['.document-viewer__unsupported', 'Viewer-Zustand: das Medienformat hat '
      + 'keine Vorschau - Aussage ueber das Medium, nicht ueber fehlende Daten'],
  ]);
  const TRANSIENT = /loading|status|skeleton/;

  const decl = (body, prop) =>
    body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1]?.trim();

  const paddingBlock = (body) => {
    const raw = decl(body, 'padding-block') ?? decl(body, 'padding-top')
      ?? decl(body, 'padding');
    const step = raw?.match(/--space-(\d+)/)?.[1];
    return step ? Number(step) : 0;
  };

  const offenders = [];
  let seen = 0;
  for (const name of files) {
    for (const { selector, body } of eachRule(read(`../public/styles/${name}`))) {
      if (!/text-align:\s*center/.test(body)) continue;
      const col = decl(body, 'color');
      if (!col || !/--color-text-(secondary|tertiary)/.test(col)) continue;
      if (paddingBlock(body) < 6) continue;
      seen += 1;
      if (/\.empty-state/.test(selector)) continue;
      if (/border[^;]*dashed/.test(body)) continue;
      if (/position:\s*absolute/.test(decl(body, 'position') ?? '')) continue;
      if (TRANSIENT.test(selector)) continue;
      const key = selector.split(',')[0].trim();
      if (EXEMPT.has(key)) continue;
      offenders.push(
        `${name}: ${selector} baut den Flaechen-Leerzustand nach `
        + '- zentrierter Sekundaertext mit Eigenraum ist .empty-state (layout.css)');
    }
  }
  assert.deepEqual(offenders, []);




  assert.ok(seen >= 2,
    `Nur ${seen} Treffer der Leerzustands-Signatur im ganzen Stylesheet - der Scanner greift nicht mehr.`);
});

// --------------------------------------------------------------------------

//

// pruefbar:
//

//   (Suche, „Heute wichtig", Widget-Koepfe, Mehr-Sheet, Erinnerungen). Dort



//



//




// „keine Siegel-Inflation".
//

// die Klasse zusammensetzt - gleich ob per `className`, per Template-Literal


// --------------------------------------------------------------------------
test('wer ein Markensiegel baut, benennt eine Herkunft oder ist der Kopf', () => {
  const jsFiles = walkJsFiles('../public/');
  const styleDir = new URL('../public/styles/', import.meta.url);



  // (`.more-item__icon-well`, `.today-cockpit-card__icon`, die Kuechen-Leiste).
  const classesWithOrigin = new Set();
  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body } of eachRule(read(`../public/styles/${file}`))) {
      if (!/--seal-accent\s*:/.test(body)) continue;
      for (const cls of selector.match(/\.[A-Za-z0-9_-]+/g) ?? []) classesWithOrigin.add(cls.slice(1));
    }
  }

  const offenders = [];
  let heads = 0;
  let mixers = 0;
  let sites = 0;




  // Naeherung - eng genug, dass es kein fremdes Siegel einsammelt.
  const WINDOW = 8;

  for (const rel of jsFiles) {
    const src = read(rel);
    if (!src.includes('module-seal')) continue;
    const lines = src.split('\n');
    lines.forEach((line, i) => {


      if (!/module-seal/.test(line)) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (!/className|class=|classList|classNames/.test(line)) return;
      sites += 1;

      const isHead = line.includes('module-seal--head');
      const near = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join('\n');






      const ownClasses = (line.match(/['"`][^'"`]*module-seal[^'"`]*['"`]/g) ?? [])
        .flatMap((quoted) => quoted.slice(1, -1).split(/\s+/))
        .filter((cls) => cls && !cls.startsWith('module-seal'));
      const namedInCss = ownClasses.some((cls) => classesWithOrigin.has(cls));
      const namedInline = /--seal-accent|--item-module-accent/.test(near);

      if (isHead) {
        heads += 1;





        // gebaut.
        if (!rel.startsWith('../public/utils/')) {
          offenders.push(`${rel}:${i + 1} baut die Kopfrolle des Siegels - die gehoert der Shell (public/utils/)`);
        }
        return;
      }

      if (!namedInline && !namedInCss) {
        offenders.push(
          `${rel}:${i + 1} baut ein Siegel ohne Herkunft - an einer Mischstelle benennt `
          + 'jedes Siegel sein Modul (--seal-accent inline oder ueber die eigene Klasse im Stylesheet); '
          + 'im eigenen Modul gibt es nur den Absender im Kopf',
        );
        return;
      }
      mixers += 1;
    });
  }

  assert.deepEqual(offenders, []);




  // still aufgegeben.
  assert.ok(heads >= 2,
    `Nur ${heads} Kopf-Bau-Stellen gefunden (erwartet: kollabierender Kopf + Gruppenleiste).`);
  assert.ok(mixers >= 4,
    `Nur ${mixers} Mischstellen-Siegel gefunden - die Signatur greift nicht mehr.`);
  assert.ok(sites >= heads + mixers,
    `Zaehlung inkonsistent: ${sites} Bau-Stellen, aber ${heads} + ${mixers} Rollen.`);
});

// --------------------------------------------------------------------------

//



// nichts und brach still ab - fast drei Monate lang erschien keine einzige

//




//

// ("hoechstens drei Toasts"), kein Nachschlagen einer bestimmten Region.
// --------------------------------------------------------------------------
test('ein Toast-Container hat genau einen Namensgeber', () => {
  const OWNER = '../public/utils/toast-surface.js';







  const idLiteral = /['"`]toast-container-[a-z]+['"`]/;
  const ownLookup = /(?:getElementById|querySelector(?:All)?)\(\s*['"`]#?toast-container/;

  const offenders = [];
  let ownerHits = 0;
  for (const rel of walkJsFiles('../public/')) {
    const src = read(rel);
    if (rel === OWNER) { ownerHits = (src.match(new RegExp(idLiteral, 'g')) ?? []).length; continue; }
    src.split('\n').forEach((line, i) => {
      if (idLiteral.test(line)) offenders.push(`${rel}:${i + 1} schreibt den Namen einer Toast-Region selbst - er steht in ${OWNER}`);
      else if (ownLookup.test(line)) offenders.push(`${rel}:${i + 1} sucht seine Toast-Region selbst - dafuer gibt es toastSurface() in ${OWNER}`);
    });
  }

  assert.deepEqual(offenders, []);


  assert.ok(ownerHits >= 2,
    `Nur ${ownerHits} Toast-Region-Namen in ${OWNER} - beide Dringlichkeiten gehoeren dorthin.`);
});

// --------------------------------------------------------------------------

//




//



// --------------------------------------------------------------------------
test('die Herkuenfte des Erinnerungs-Toasts sind die entity_type des Servers', () => {
  const server = read('../server/routes/reminders.js');
  const listed = server.match(/const VALID_ENTITY_TYPES\s*=\s*\[([^\]]*)\]/);
  assert.ok(listed, 'VALID_ENTITY_TYPES steht nicht mehr in server/routes/reminders.js.');
  const serverTypes = [...listed[1].matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]).sort();

  const client = read('../public/reminders.js');
  const map = client.match(/const REMINDER_ORIGINS\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(map, 'REMINDER_ORIGINS steht nicht mehr in public/reminders.js.');
  const clientTypes = [...map[1].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]).sort();





  const notifications = read('../server/services/notifications.js');
  const titleMap = notifications.match(/const REMINDER_ORIGINS\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(titleMap, 'REMINDER_ORIGINS steht nicht mehr in server/services/notifications.js.');
  const titleTypes = [...titleMap[1].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]).sort();

  assert.ok(serverTypes.length >= 3, `Nur ${serverTypes.length} entity_type im Server gefunden - das Muster greift nicht mehr.`);
  assert.deepEqual(clientTypes, serverTypes,
    'Der Toast kennt andere Herkuenfte als der Server schreibt - die unbekannten fallen still auf die Glocke zurueck.');
  assert.deepEqual(titleTypes, serverTypes,
    'Der Push-Titel kennt andere Herkuenfte als der Server schreibt - die unbekannten heissen wieder „Aashiyana".');





  const withoutTarget = [...titleMap[1].matchAll(/^\s{2}([a-z_]+):\s*\{([^}]*)\}/gm)]
    .filter(([, , body]) => !/\burl:\s*'/.test(body))
    .map(([, type]) => type);
  assert.deepEqual(withoutTarget, [],
    'Herkunft ohne Ziel - der Titel nennt das Modul und der Tipp landet woanders.');
});

// --------------------------------------------------------------------------

//





//

// public/utils/inventory-warranty.js importieren `/utils/date.js` als


// diesem Guard hat sie niemand geprueft.
// --------------------------------------------------------------------------
test('der Vorlauf einer Fristmeldung ist die Schwelle, die die Zeile faerbt', () => {
  const PAIRS = [
    {
      what: 'Vorrat: Mindesthaltbarkeit',
      client: ['../public/utils/pantry-status.js', /EXPIRY_SOON_DAYS\s*=\s*(\d+)/],
      server: ['../server/services/pantry-reminders.js', /EXPIRY_REMINDER_OFFSET_DAYS\s*=\s*(\d+)/],
    },
    {
      what: 'Inventar: Garantieende',
      client: ['../public/utils/inventory-warranty.js', /WARRANTY_ALERT_DAYS\s*=\s*(\d+)/],
      server: ['../server/routes/inventory/items.js', /WARRANTY_REMINDER_OFFSET_DAYS\s*=\s*(\d+)/],
    },
  ];

  for (const pair of PAIRS) {
    const read2 = ([file, re], side) => {
      const match = read(file).match(re);


      // Guard waere gruen und blind.
      assert.ok(match, `${pair.what}: die ${side}-Konstante steht nicht mehr in ${file.replace(/^\.\.\//, '')}.`);
      return Number(match[1]);
    };
    const client = read2(pair.client, 'Client');
    const server = read2(pair.server, 'Server');
    assert.equal(server, client,
      `${pair.what}: der Server meldet ${server} Tage vorher, die Liste faerbt ab ${client} Tagen - `
      + 'der Nutzer bekommt die Nachricht an einem Tag, an dem nichts markiert ist.');
  }
});

test('jedes Push-Ziel zeigt auf eine Route, die es gibt', () => {





  // beiden Tests las den anderen.
  //


  const routerSrc = read('../public/router.js');
  const known = new Set([...routerSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]));
  // Sub-Tab-Sektionen (Gesundheit, Schedule S-10) registrieren ihre Routen



  // beide Util-Dateien importieren selbst wieder `/i18n.js` (ein

  for (const file of ['../public/utils/health-tabs.js', '../public/utils/schedule-tabs.js']) {
    const src = read(file);
    const arrayBody = src.slice(src.indexOf('Object.freeze(['), src.indexOf('])', src.indexOf('Object.freeze([')));
    for (const match of arrayBody.matchAll(/'([^']+)'/g)) known.add(match[1]);
  }

  const settingsLeaf = /^\/settings(\/|$)/;
  assert.ok(known.size >= 15, `nur ${known.size} Routen aus router.js gelesen - Regex tot?`);

  const offenders = [];
  for (const file of ['../server/services/notifications.js', '../public/sw.js']) {
    const src = read(file);
    for (const match of src.matchAll(/\burl:\s*'(\/[^']*)'/g)) {
      const url = match[1].split(/[?#]/)[0];
      if (known.has(url) || settingsLeaf.test(url)) continue;
      const line = src.slice(0, match.index).split('\n').length;
      offenders.push(`${file.replace(/^\.\.\//, '')}:${line} → ${url}`);
    }
  }

  assert.deepEqual(offenders, [],
    'Push-Ziel zeigt auf einen Pfad, den ROUTES nicht kennt - der Router fällt dort '
    + 'still auf das Dashboard zurück');
});

test('das Überlappungszeichen kommt aus einer Hand', () => {



  //





  const offenders = [];
  for (const rel of walkFrontendFiles('../public/')) {
    if (rel.endsWith('utils/seal-pair.js')) continue;
    const src = read(rel);
    for (const match of src.matchAll(/seal-pair__who/g)) {
      const line = src.slice(0, match.index).split('\n').length;
      offenders.push(`${rel.replace(/^\.\.\//, '')}:${line}`);
    }
  }

  assert.deepEqual(offenders, [],
    'Überlappungszeichen von Hand gebaut — `whoMark()`/`withWho()` aus utils/seal-pair.js '
    + 'nehmen, sonst fehlen die Bedingungen (Person vorhanden, Haushalt > 1)');




  const pair = read('../public/utils/seal-pair.js');
  assert.match(pair, /isSoloHousehold\(\)/,
    'seal-pair.js prüft den Solo-Haushalt nicht mehr — das Zeichen erschiene dort, wo es '
    + 'laut Brief still entfallen soll');
});

// ---------------------------------------------------------------------------

//


// Chips, Zeilen-Hover, Widgets.
//




// unabhaengig vom Modul gelten:
//

//      Route dieselben sind (Leisten, FAB, Sheets, Overlays, Backdrop).

//      (Buttonvarianten, Umschalter, Checkbox, Fokusring).
//



// (--item-module-accent). Beide sind namentlich Herkunftszeichen, keine
// Zustaende.
// ---------------------------------------------------------------------------
const SHELL_ROOTS = [
  '.nav-bottom', '.nav-sidebar', '.nav-item', '.page-fab', '.fab-layer',
  '.more-sheet', '.more-item', '.more-action', '.more-backdrop',
  '.search-overlay', '.modal-overlay', '.app-shell', '.lg-blob', '.lg-backdrop',
  '.changelog-release',
];
const SHARED_CONTROLS = ['.btn--', '.toggle', '.form-check', '.page-search', '.input:focus', '.form-input:focus'];


const MODULE_TONE = /var\(\s*--(?:active-)?module-(?!accent\b)[a-z-]+|var\(\s*--(?:active-)?module-accent|var\(\s*--_?family-/;


const ORIGIN_MARKS = ['--seal-accent', '--item-module-accent'];

test('die Shell traegt die Stimme, nicht den Modulton', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);
  const offenders = [];

  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body, at } of eachRule(read(`../public/styles/${file}`))) {
      if (!MODULE_TONE.test(body)) continue;
      if (ORIGIN_MARKS.some((mark) => body.includes(mark))) continue;


      if (/^(?::root|html)\b/.test(selector.trim())) continue;

      const isShell = SHELL_ROOTS.some((root) => selector.includes(root));
      const isSharedControl = SHARED_CONTROLS.some((ctrl) => selector.includes(ctrl))
        || /--focus-ring-color/.test(body);
      if (!isShell && !isSharedControl) continue;





      // seitenabhaengigen Namen: --active-module-accent (Router, je Route) und
      // --module-accent (Modul-Root, je Seite). An einem GETEILTEN


      const followsRoute = /var\(\s*--(?:active-)?module-accent\b/.test(body);
      if (isShell && !isSharedControl && !followsRoute) continue;

      const why = isShell ? 'Shell-Wurzel' : 'geteiltes Bedienelement';
      offenders.push(`${file}${at.length ? ` [${at.join(' ')}]` : ''}: ${selector} (${why})`);
    }
  }

  assert.deepEqual(offenders, [],
    'Die Shell und geteilte Bedienelemente tragen
    + '(Eine-Stimme-Regel, DESIGN.md). Der Modulton gehoert in den INHALT: Siegel, '
    + 'modul-eigene Leisten und Segmente, Chips, Zeilen-Hover, Widgets. Wer eine Herkunft '
    + 'benennt statt einen Zustand, nimmt --seal-accent bzw. --item-module-accent.\n'
    + offenders.join('\n'));
});

test('die Sidebar zeigt die Modultoene als Legende', () => {




  // --item-module-accent Flaeche traegt.
  const layout = read('../public/styles/layout.css');



  const iconRule = [...eachRule(layout)].find(({ selector }) =>
    selector.trim() === '.nav-sidebar .nav-item__icon');
  assert.ok(iconRule, '.nav-sidebar .nav-item__icon fehlt - die Legende hat keinen Traeger mehr');
  assert.match(iconRule.body, /color:\s*var\(--item-module-accent/,
    'das Sidebar-Zeichen traegt den Ton SEINES Moduls (Legende, DESIGN.md „Colors")');

  // Ganzes violett ist, deren Icon aber allein seine Familienfarbe behielte,

  const activeIcon = [...eachRule(layout)].find(({ selector }) =>
    selector.trim() === '.nav-sidebar .nav-item[aria-current="page"] .nav-item__icon');
  assert.ok(activeIcon, 'dem aktiven Sidebar-Eintrag fehlt die Icon-Regel');
  assert.match(activeIcon.body, /color:\s*var\(--color-accent\)/);
});

// ---------------------------------------------------------------------------
// DIE TAGESMARKE (Etappe E, 2026-08-19)
//


// (`.month-day--today .month-day__number`, `.week-view__day-num--today`) und
// der Datepicker (`.ydp-cal__day.is-today`).
//





// dokumentierte Gegenfall.
//

//
//   1. FRISTMELDUNGEN („heute faellig") - `.due-date--today`,


//      Namensabschnitt `day`, also nie im Trefferraum.
//   2. DIE GEBURTSTAGSZEILE - `.birthday-item--today`, `.birthday-chip--today`.





//      waere.
//


// ---------------------------------------------------------------------------
const TODAY_MARKER = /(?:--today\b|\.is-today\b)/;

function namesADayCell(selector) {
  return selector
    .split(/[\s>+~,()]+/)
    .filter((token) => token.startsWith('.'))
    .some((token) => token
      .replace(/^\./, '')
      .split(/__|--|-|\./)
      .includes('day'));
}

test('eine Tagesmarke traegt die Stimme, nicht den Modulton', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);
  const offenders = [];

  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body, at } of eachRule(read(`../public/styles/${file}`))) {
      if (!TODAY_MARKER.test(selector)) continue;
      if (!namesADayCell(selector)) continue;
      if (!MODULE_TONE.test(body)) continue;
      offenders.push(`${file}${at.length ? ` [${at.join(' ')}]` : ''}: ${selector}`);
    }
  }

  assert.deepEqual(offenders, [],
    'Die Marke des heutigen Tages traegt
    + '„Heute" ist dieselbe Aussage in jedem Modul, und der Kalender beantwortet sie '
    + 'seit jeher mit der Stimme (.month-day--today, .week-view__day-num--today, '
    + '.ydp-cal__day.is-today). Wer eine Fristmeldung meint („heute faellig"), baut '
    + 'keine Tageszelle - und wer den Modulton wirklich braucht, begruendet ihn im '
    + 'Quelltext wie die Geburtstagszeile.\n'
    + offenders.join('\n'));
});

test('ein Modul fuehrt EIN Zeichen, und die Zuordnung steht an einer Stelle', () => {

  //


  // Kennzahl-Kachelreihe. Drei Tabellen fuer eine Zuordnung laufen auseinander,



  // Bauart.
  const navIcons = read('../public/nav-icons.js');
  assert.match(navIcons, /export const MODULE_ICON = \{/, 'die eine Zuordnung Modul → Zeichen fehlt');


  const moduleIconBlock = navIcons.slice(navIcons.indexOf('export const MODULE_ICON = {'));
  const MODULE_ICON_KEYS = Object.fromEntries(
    [...moduleIconBlock.slice(0, moduleIconBlock.indexOf('\n};')).matchAll(/^\s+'?([\w-]+)'?:\s+'/gm)]
      .map((m) => [m[1], true]),
  );
  assert.ok(Object.keys(MODULE_ICON_KEYS).length >= 20,
    `Nur ${Object.keys(MODULE_ICON_KEYS).length} Eintraege in MODULE_ICON gelesen - das Muster greift nicht mehr.`);




  //     Glyph fuer dasselbe Modul.
  const WINDOW = 3;
  const offenders = [];
  let sealSites = 0;
  for (const rel of walkJsFiles('../public/')) {
    const src = read(rel);
    if (!src.includes('module-seal')) continue;
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/module-seal/.test(line)) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (!/className|class=|classList/.test(line)) return;
      sealSites += 1;
      const near = lines.slice(i, i + WINDOW + 1).join('\n');
      if (/data-lucide|dataset\.lucide/.test(near)) {
        offenders.push(`${rel.replace(/^\.\.\//, '')}:${i + 1} baut ein Siegel mit einem rohen Lucide-Zeichen`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    'Ein Siegel holt sein Zeichen ueber moduleIconEl/moduleIconHTML (nav-icons.js) - '
    + 'so bekommt dasselbe Modul ueberall denselben Glyph in derselben Hand.\n'
    + offenders.join('\n'));


  assert.ok(sealSites >= 6, `Nur ${sealSites} Siegel-Bau-Stellen gefunden - die Signatur greift nicht mehr.`);


  //     (Router), widgetIcon() und jede widgetHeader()-Aufrufstelle


  //     einzeln zurueckkommen kann.
  const dashboard = read('../public/pages/dashboard.js');

  // Manifest (capabilities.widgets[].icon) - keine zweite Kern-Tabelle.
  assert.match(dashboard, /function widgetIcon\(id\)\s*\{[\s\S]*?getExtensionWidgetMeta\(id\)[\s\S]*?MODULE_ICON\[id\]/,
    'widgetIcon leitet Core-Widgets aus MODULE_ICON ab und Extension-Widgets aus dem Manifest');
  assert.doesNotMatch(dashboard, /const map = \{ tasks:/,
    'die zweite Modul→Zeichen-Tabelle ist wieder da');




  const headerArgs = [...dashboard.matchAll(/widgetHeader\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(headerArgs.length >= 10, `Nur ${headerArgs.length} widgetHeader-Aufrufe gefunden - die Signatur greift nicht mehr.`);
  const fremdeArgs = headerArgs.filter((id) => !(id in MODULE_ICON_KEYS));
  assert.deepEqual(fremdeArgs, [],
    'widgetHeader nimmt die Widget-Id (ein Schluessel von MODULE_ICON), nicht einen Icon-Namen.\n'
    + fremdeArgs.join('\n'));

  const moduleOrder = read('../public/settings/module-order.js');
  assert.doesNotMatch(moduleOrder, /icon:/,
    'BUILT_IN_MODULES/KITCHEN_CHILD_ICONS fuehren wieder eigene Zeichen - das war die vierte Abschrift');
  for (const leaf of ['modules-active', 'modules-navigation']) {
    assert.match(read(`../public/settings/pages/${leaf}.js`), /MODULE_ICON/,
      `${leaf} holt die Modulzeichen aus MODULE_ICON`);
  }
});

test('die Tab-Bar zeigt dieselbe Legende wie die Sidebar', () => {

  //





  //


  // Sidebar gruen und umgekehrt. Zwei Zusicherungen, zwei Namen.
  const layout = read('../public/styles/layout.css');
  const wellRule = [...eachRule(layout)].find(({ selector }) =>
    selector.trim() === '.nav-bottom .nav-item__icon-well');
  assert.ok(wellRule, '.nav-bottom .nav-item__icon-well fehlt - die mobile Legende hat keinen Traeger');
  assert.match(wellRule.body, /color:\s*var\(--item-module-accent,\s*var\(--color-text-tertiary\)\)/,
    'das Tab-Zeichen traegt den Ton SEINES Moduls; wer keines hat („Mehr"), bleibt tertiaer');

  // gemeinsame Regel fuer beide Leisten.
  const activeWell = [...eachRule(layout)].find(({ selector }) =>
    selector.includes('.nav-item[aria-current="page"] .nav-item__icon-well'));
  assert.ok(activeWell, 'dem aktiven Tab fehlt die Icon-Well-Regel');
  assert.match(activeWell.body, /color:\s*var\(--color-accent\)/);




  const labelRule = [...eachRule(layout)].find(({ selector }) =>
    selector.trim() === '.nav-bottom .nav-item__label');
  assert.ok(labelRule, '.nav-bottom .nav-item__label fehlt');
  assert.doesNotMatch(labelRule.body, /--item-module-accent/,
    'das Tab-Label bleibt Text in Textfarbe - der Modulton gehoert dem Zeichen');
});

test('kein geteiltes Bedienelement wird unter seinem eigenen Namen umgefaerbt', () => {






  //



  const SHARED = /\b(btn--primary|btn--secondary|btn--ghost|btn--danger|btn--icon|toggle__track|form-check)\b/;
  const companions = new Map();   // Begleitklasse -> Fundstelle im Markup
  for (const rel of walkFrontendFiles('../public/')) {
    if (!rel.endsWith('.js') && !rel.endsWith('.html')) continue;
    const src = read(rel);
    for (const m of src.matchAll(/class="([^"${}]+)"/g)) {
      const classes = m[1].trim().split(/\s+/);
      if (!classes.some((c) => SHARED.test(c))) continue;
      for (const c of classes) {
        if (SHARED.test(c) || c === 'btn' || c.startsWith('u-')) continue;
        if (!companions.has(c)) companions.set(c, rel.replace(/^\.\.\//, ''));
      }
    }
  }
  assert.ok(companions.size > 5,
    'keine Begleitklassen gefunden - der Guard liest das Markup nicht mehr richtig');

  const styleDir = new URL('../public/styles/', import.meta.url);
  const offenders = [];
  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body } of eachRule(read(`../public/styles/${file}`))) {
      if (!MODULE_TONE.test(body)) continue;
      if (ORIGIN_MARKS.some((mark) => body.includes(mark))) continue;


      // seinen Ton durchreichen.
      if (!/(^|[;{\s])(?:color|background|background-color|border-color)\s*:/.test(body)) continue;





      if (/--active\b|--selected\b|\[aria-pressed="true"\]|\.is-active\b/.test(selector)) continue;
      for (const [cls, where] of companions) {
        if (!selector.includes(`.${cls}`)) continue;
        offenders.push(`${file}: ${selector} faerbt ein geteiltes Bedienelement (Markup: ${where})`);
      }
    }
  }

  assert.deepEqual(offenders, [],
    'Ein Element, das eine geteilte Bedienvariante traegt, darf sie nicht unter seinem '
    + 'eigenen Klassennamen umfaerben - es traegt die Stimme (Eine-Stimme-Regel, DESIGN.md). '
    + 'Wer eine andere Farbe braucht, braucht eine andere VARIANTE, keine zweite Regel.\n'
    + offenders.join('\n'));
});

test('ein Hover auf erhoehter Flaeche nimmt die Stufe ueber DIESER Flaeche', () => {
  const ELEVATED_REST = /--color-surface-(?:3|elevated|raised)\b/;
  const restBg = new Map();
  const hoverOnSurface = new Map();
  let rulesRead = 0;

  const dirs = [
    new URL('../public/styles/', import.meta.url),
    new URL('../public/settings/styles/', import.meta.url),
  ];
  for (const dir of dirs) {
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.css')); } catch { continue; }
    for (const file of files) {
      for (const { selector, body } of eachRule(readFileSync(new URL(file, dir), 'utf8'))) {
        rulesRead++;
        const bg = body.match(/background(?:-color)?\s*:([^;]*)/);
        if (!bg) continue;
        for (const raw of selector.split(',')) {
          const s = raw.trim();
          if (/:hover/.test(s)) {
            if (/--color-surface-hover\b/.test(bg[1])) {
              hoverOnSurface.set(`${file}::${s.replace(/:hover\b/g, '').trim()}`, s);
            }
          } else {
            restBg.set(`${file}::${s}`, bg[1].trim());
          }
        }
      }
    }
  }

  assert.ok(rulesRead >= 2000,
    `Reichweiten-Nachweis: nur ${rulesRead} Regeln gelesen - greift eachRule() hier noch?`);
  assert.ok(hoverOnSurface.size >= 20,
    `Reichweiten-Nachweis: nur ${hoverOnSurface.size} Hover-Regeln mit --color-surface-hover gefunden`);

  const offenders = [];
  for (const [key, selector] of hoverOnSurface) {
    const rest = restBg.get(key);
    if (rest === undefined || !ELEVATED_REST.test(rest)) continue;
    offenders.push(`${key.split('::')[0]}: "${selector}" liegt im Ruhezustand auf ${rest}, `
      + 'nimmt im Hover aber --color-surface-hover');
  }

  assert.deepEqual(offenders, [],
    'Ein Element, dessen Ruheflaeche schon erhoeht ist, braucht '
    + '--color-surface-elevated-hover. --color-surface-hover ist der Schritt von '
    + '--color-surface aus und faellt im Dark mit der erhoehten Flaeche zusammen:\n'
    + offenders.join('\n'));
});

/* ──────────────────────────────────────────────────────────────────────────
 * Wand-Modus (Block D)
 * ────────────────────────────────────────────────────────────────────────── */

test('die Distanzskala der Wand haengt an der KNAPPEN Seite, nicht an der Hoehe', () => {






  //

  // Bildschirmhoehe selbst, keine Groessenskala.
  const css = read('../public/styles/dashboard.css');
  const offenders = [];
  let wallRules = 0;
  let declarationsRead = 0;

  for (const { selector, body } of eachRule(css)) {
    if (!/\bwall\b|--wall-|clock-widget--wall/.test(selector) && !/--wall-/.test(body)) continue;
    wallRules += 1;
    for (const declaration of body.split(';')) {
      if (!declaration.trim()) continue;
      declarationsRead += 1;
      // Nur ECHTE vh-Einheiten: `dvh`/`svh`/`lvh` tragen ihren eigenen Praefix.
      if (/(^|[^dsl\w.])\d+(\.\d+)?vh\b/.test(declaration)) {
        offenders.push(`${selector} { ${declaration.trim()} }`);
      }
    }
  }

  assert.ok(wallRules >= 15,
    `Reichweiten-Nachweis: nur ${wallRules} Wand-Regeln gelesen - greift der Selektor noch?`);
  assert.ok(declarationsRead >= 60,
    `Reichweiten-Nachweis: nur ${declarationsRead} Deklarationen gelesen`);
  assert.deepEqual(offenders, [],
    'Wand-Groessen nehmen vmin (oder vw, wo die Breite die Grenze ist):\n' + offenders.join('\n'));
});

test('der Wand-Modus laesst die Shell abtreten - und versteckt den FAB NICHT per CSS', () => {
  const css = read('../public/styles/dashboard.css');
  const hidden = new Set();
  let wallModeRules = 0;

  for (const { selector, body } of eachRule(css)) {
    if (!/\[data-wall-mode\]/.test(selector)) continue;
    wallModeRules += 1;
    if (/display:\s*none/.test(body)) {
      for (const part of selector.split(',')) hidden.add(part.trim().replace(/\[data-wall-mode\]\s*/, ''));
    }
  }

  assert.ok(wallModeRules >= 3,
    `Reichweiten-Nachweis: nur ${wallModeRules} [data-wall-mode]-Regeln gelesen`);
  for (const chrome of ['.nav-sidebar', '.nav-bottom']) {
    assert.ok(hidden.has(chrome),
      `${chrome} muss im Wand-Modus abtreten - auf zwei Metern sind das siebzehn unleserliche Ziele`);
  }




  // rendert ihn dort gar nicht erst (public/pages/dashboard.js).
  const viaCss = [...hidden].filter((s) => /page-fab/.test(s));
  assert.deepEqual(viaCss, [], 'der FAB wird nicht gerendert, nicht weggeblendet');
  assert.match(read('../public/pages/dashboard.js'), /wallMode \|\| loadFailed/,
    'der Wand-Modus raeumt den FAB im JS ab, wie es der Fehlerzustand tut');
});

test('der Vorab-Wand-Modus in theme-init.js driftet nicht von utils/wall-mode.js', () => {



  const init = read('../public/theme-init.js');
  const mod = read('../public/utils/wall-mode.js');

  const modKey = mod.match(/const WALL_KEY = '([^']+)'/)?.[1];
  assert.equal(modKey, 'aashiyana-wall-mode', 'der Schluessel steht in wall-mode.js');
  assert.ok(init.includes(`'${modKey}'`), `theme-init.js liest denselben Schluessel (${modKey})`);

  const from = Number(mod.match(/export const WALL_NIGHT_FROM = (\d+)/)?.[1]);
  const to = Number(mod.match(/export const WALL_NIGHT_TO = (\d+)/)?.[1]);
  assert.equal(from, 22);
  assert.equal(to, 6);

  const initWindow = init.match(/hour >= (\d+) \|\| hour < (\d+)/);
  assert.ok(initWindow, 'theme-init.js traegt ein Nachtfenster');
  assert.equal(Number(initWindow[1]), from, 'dieselbe Nachtgrenze wie wall-mode.js');
  assert.equal(Number(initWindow[2]), to, 'dieselbe Morgengrenze wie wall-mode.js');


  assert.match(mod, /export function isWallRoute\(path\) \{\s*return path === '\/';/);
  assert.ok(init.includes("location.pathname !== '/'"), 'theme-init.js kennt dieselbe Route');
});

test('ein Formularfeld traegt nur form-Klassen, die ein Stylesheet kennt', () => {
  const defined = new Set();
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((f) => f.endsWith('.css'))) {
    for (const { selector } of eachRule(read(`../public/styles/${file}`))) {
      for (const cls of selector.match(/\.[A-Za-z_][\w-]*/g) ?? []) defined.add(cls.slice(1));
    }
  }



  assert.ok(defined.size >= 500, `Nur ${defined.size} Klassen aus den Stylesheets gelesen - liest eachRule() noch?`);

  const offenders = [];
  for (const path of walkFrontendFiles('../public/')) {
    if (path.includes('/vendor/')) continue;
    const src = read(path);
    for (const [, tag, attrs] of src.matchAll(/<(select|input|textarea)\b([^>]*)>/g)) {
      const cls = attrs.match(/class="([^"${}]*)"/)?.[1];
      if (!cls) continue;
      for (const name of cls.split(/\s+/).filter((c) => c.startsWith('form-'))) {
        if (!defined.has(name)) offenders.push(`${path.startsWith('../') ? path.slice(3) : path}: <${tag} class="${name}">`);
      }
    }
  }

  assert.deepEqual(offenders.sort(), [],
    'Diese Felder tragen eine form-Klasse, die kein Stylesheet definiert - sie fallen '
    + 'damit auf die Browservorgabe zurueck und reissen die Zielgroesse. Der Kanon '
    + 'heisst `input` bzw. `form-input` (layout.css, Abschnitt Form-Elemente); '
    + '`select.form-input` bringt dort auch das Chevron-Polster mit.');
});



// Signatur statt Namensliste: Zustandsmarke (--active / .is-active / --selected)

const SEGMENT_ACTIVE_RE = /(?:^|[\s,>])\.[a-z][\w-]*(?:tab|seg|toggle|view-btn|switch)[\w-]*(?:--active|--selected|\.is-active|\.is-selected)/i;

test('das aktive Segment ist ueberall dieselbe Pille', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);
  const incomplete = [];
  const refilled = [];
  let seen = 0;

  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css') && f !== 'tokens.css')) {
    for (const { selector, body } of eachRule(read(`../public/styles/${file}`))) {
      const usesPill = /background(-color)?\s*:\s*var\(--seg-active-bg\)/.test(body);
      const isSegment = SEGMENT_ACTIVE_RE.test(selector);

      if (usesPill) {
        seen += 1;
        const missing = [];
        if (!/box-shadow\s*:\s*var\(--seg-active-shadow\)/.test(body)) missing.push('box-shadow: var(--seg-active-shadow)');



        // Tinte sitzt zwangslaeufig am Geschwister darueber. Am Element
        // ablesbar, nicht an seinem Namen.
        const carriesText = !/pointer-events\s*:\s*none/.test(body);
        if (carriesText && !/color\s*:\s*color-mix\([^;]*var\(--tint-ink\)[^;]*var\(--color-text-primary\)/.test(body)) {
          missing.push('color: color-mix(… var(--tint-ink), var(--color-text-primary))');
        }
        if (missing.length) incomplete.push(`${file}: ${selector.trim()} - es fehlt ${missing.join(' und ')}`);
      }



      if (isSegment
        && /background(-color)?\s*:\s*var\(--(?:active-)?module-accent/.test(body)
        && /color\s*:\s*var\(--color-ink-on-vivid\)/.test(body)) {
        refilled.push(`${file}: ${selector.trim()}`);
      }
    }
  }



  assert.ok(seen >= 6, `Nur ${seen} Pillen-Regeln gefunden - liest der Scanner die Segment-Zustaende noch?`);

  assert.deepEqual(incomplete.sort(), [],
    'Diese Segment-Zustaende nehmen die Pille nur halb. Alle drei Zeilen gehoeren '
    + 'zusammen (tokens.css, Abschnitt 6c) - eine Pille ohne Schatten ist auf dem '
    + 'Well nicht als Zustand zu erkennen (gemessen 1.20:1 hell, 1.16:1 dunkel).');

  assert.deepEqual(refilled.sort(), [],
    'Diese Umschalter fuellen ihren aktiven Zustand wieder deckend im Modulton. '
    + 'Der Ton gehoert genau einmal als FLAECHE (dem Filter-Chip) und einmal als '
    + 'TINTE (dem Segment) - eine Behandlung pro Kontrolltyp.');
});

// --------------------------------------------------------------------------






//




// --------------------------------------------------------------------------
test('die Lesemass-Liste kappt kein selbstpolsterndes Element (#758)', () => {
  const layoutCss = read('../public/styles/layout.css');


  const listBlock = layoutCss.match(/\.page-measure--narrow :is\(([\s\S]*?)\)\s*\{/);
  assert.ok(listBlock, 'die Lesemass-Liste muss auffindbar bleiben (Selektor umbenannt?)');
  const capped = listBlock[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')          // Kommentare tragen Beispiel-Selektoren
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('.'));
  assert.ok(capped.length >= 5, `die Liste sollte mehrere Selektoren fuehren, gefunden: ${capped.length}`);


  const selfPadding = new Set();
  for (const file of readdirSync(new URL('../public/styles/', import.meta.url)).filter((f) => f.endsWith('.css'))) {
    for (const rule of eachRule(read(`../public/styles/${file}`))) {
      if (!/padding-inline\s*:\s*var\(--page-inline-pad|padding(-inline)?-(left|right|start|end)\s*:\s*var\(--page-inline-pad/.test(rule.body)) continue;
      for (const sel of rule.selector.split(',')) {
        const cls = sel.trim().match(/\.[a-z0-9-]+(?=[^a-z0-9-]|$)/gi);
        if (cls) selfPadding.add(cls[cls.length - 1]);
      }
    }
  }
  assert.ok(selfPadding.size > 0, 'ohne Fundstellen prueft der Guard eine leere Menge und sagt nichts aus');

  const clash = capped.filter((sel) => selfPadding.has(sel));
  assert.deepEqual(clash, [],
    `diese Selektoren stehen in der Lesemass-Liste UND polstern sich selbst mit --page-inline-pad: ${clash.join(', ')}. `
    + 'Bei box-sizing: border-box frisst das Polster die Kappung auf. Die Kappung gehoert dorthin, wo auch das '
    + 'Polster steht, und muss es einrechnen (siehe .list-tabs-bar in shopping.css).');
});

test('ein Teilschritt lässt sich korrigieren und entfernen, nicht nur abhaken (#748)', () => {



  const tasksPage = read('../public/pages/tasks.js');

  const row = /class="subtask-item [\s\S]*?<\/div>`\)\.join\(''\)/.exec(tasksPage);
  assert.ok(row, 'die Teilschritt-Zeile ist nicht mehr auffindbar');
  for (const action of ['toggle-subtask', 'rename-subtask', 'delete-subtask']) {
    assert.match(row[0], new RegExp(`data-action="${action}"`),
      `die Teilschritt-Zeile bietet "${action}" nicht an`);
  }


  // als keiner.
  assert.match(tasksPage, /action === 'rename-subtask'[\s\S]{0,120}handleRenameSubtask/);
  assert.match(tasksPage, /action === 'delete-subtask'[\s\S]{0,120}handleDeleteSubtask/);


  assert.match(tasksPage, /handleDeleteSubtask[\s\S]{0,400}confirmModal/);



  const css = read('../public/styles/tasks.css');
  const block = /\.subtask-item__action \{([\s\S]*?)\}/.exec(css);
  assert.ok(block, '.subtask-item__action fehlt');
  assert.match(block[1], /min-height:\s*var\(--target-base\)/);
});

test('jede rechtsbuendige Knopfzeile sagt, ob sie umbricht (#872)', () => {
  const styleDir = new URL('../public/styles/', import.meta.url);
  const offenders = [];
  let seenRows = 0;

  const declarations = new Map();
  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body, at } of eachRule(read(`../public/styles/${file}`))) {
      // Gruppenselektoren aufspalten: `.a, .b { display: flex }` gibt beiden

      for (const one of selector.split(',').map((x) => x.trim()).filter(Boolean)) {
        const key = `${file}${at.length ? ` [${at.join(' ')}]` : ''}: ${one}`;
        declarations.set(key, (declarations.get(key) ?? '') + body);
      }
    }
  }

  for (const [key, body] of declarations) {
    if (!/(footer|actions)\b/.test(key)) continue;
    if (!/display\s*:\s*(inline-)?flex/.test(body)) continue;
    if (!/justify-content\s*:\s*(flex-)?end/.test(body)) continue;
    seenRows += 1;
    if (/flex-wrap\s*:/.test(body) || /\bflex-flow\s*:/.test(body)) continue;
    offenders.push(key);
  }



  assert.ok(seenRows >= 9,
    `Nur ${seenRows} rechtsbuendige Knopfzeilen gefunden - der Scanner findet `
    + 'public/styles/ nicht mehr, statt nichts zu beanstanden.');

  assert.deepEqual(offenders.sort(), [],
    'Diese Knopfzeile sagt nicht, was bei Platzmangel passieren soll. Ohne '
    + '`flex-wrap` waechst sie ueber ihren Container hinaus - rechtsbuendig also '
    + 'nach links -, und was heraussteht, schneidet der Rahmen ab (#872). '
    + 'Setze `flex-wrap: wrap` - oder `nowrap` mit einer '
    + `Begruendung, wenn der Umbruch hier falsch waere.\n${offenders.join('\n')}`);
});

test('in den Modal-Knopfzeilen darf der Knopftext umbrechen (#872)', () => {
  const css = read('../public/styles/layout.css');

  const gruppe = [...eachRule(css)].find((r) => r.selector.trim() === '.modal-panel__footer > div');
  assert.ok(gruppe, '.modal-panel__footer > div fehlt - eine Aktionsgruppe laeuft wieder als Ganzes ueber');
  assert.match(gruppe.body, /flex-wrap\s*:\s*wrap/);
  for (const selector of ['.modal-panel__footer .btn', '.modal-actions .btn']) {
    const rule = [...eachRule(css)].find((r) => r.selector.trim() === selector);
    assert.ok(rule, `${selector} fehlt - ein einzelner zu breiter Knopf wird wieder abgeschnitten.`);
    assert.match(rule.body, /white-space\s*:\s*normal/,
      `${selector} nimmt das nowrap von .btn nicht zurueck.`);
  }
});

test('jedes modale Overlay meldet sich an der Zurueck-Geste an (#871)', () => {
  const OPENS_OVERLAY = /aria-modal["']?\s*[,:=]\s*["']?true|\.showModal\s*\(/g;
  const REGISTERS = /\b(attachOverlay|pushOverlay)\s*\(/g;

  const offenders = [];
  let seenOverlays = 0;

  for (const file of walkJsFiles('../public/')) {
    if (file.includes('/vendor/')) continue;
    const src = withoutBlockComments(read(file));
    const opens = (src.match(OPENS_OVERLAY) ?? []).length;
    if (!opens) continue;
    seenOverlays += opens;
    const registers = (src.match(REGISTERS) ?? []).length;
    if (registers < opens) {
      offenders.push(`${file}: ${opens} modale Overlays, nur ${registers} Anmeldungen`);
    }
  }



  assert.ok(seenOverlays >= 11,
    `Nur ${seenOverlays} modale Overlays gefunden - das Muster greift nicht mehr, `
    + 'statt nichts zu beanstanden.');

  assert.deepEqual(offenders.sort(), [],
    'Dieses Overlay faengt die Zurueck-Geste nicht ab. Sie wechselt dann die Seite '
    + 'darunter und laesst das Overlay stehen (#871) - auf dem Telefon ist das die '
    + 'Wischgeste von links, also der haeufigste Weg hinaus. Melde es mit '
    + '`attachOverlay(el, close)` aus /utils/overlay-history.js an; `pushOverlay` '
    + `nur, wenn das Overlay einen eigenen Lebenszyklus fuehrt.\n${offenders.join('\n')}`);
});

test('der popstate-Handler fragt zuerst die offenen Overlays (#871)', () => {
  const router = read('../public/router.js');
  const handler = /window\.addEventListener\('popstate'[\s\S]*?\n\}\);/.exec(router);
  assert.ok(handler, 'der popstate-Handler ist nicht mehr auffindbar');
  assert.match(handler[0], /handleBackNavigation\(\)/,
    'der Handler fragt die offenen Overlays nicht - die Geste wechselt wieder die Seite');
  assert.match(handler[0], /if \(!handled\) navigate\(/,
    'der Handler navigiert unabhaengig von der Antwort - dann bleibt der Dialog '
    + 'stehen UND die Seite wechselt, also genau der gemeldete Zustand');
});

test('erzwungenes Schliessen raeumt auch geparkte Modals weg (#871)', () => {
  const modal = read('../public/components/modal.js');
  const fn = /async function _closeFromBackNavigation\([\s\S]*?\n\}/.exec(modal);
  assert.ok(fn, '_closeFromBackNavigation ist nicht mehr auffindbar');
  assert.match(fn[0], /if \(force\)/,
    'der Zwangspfad ist nicht vom normalen unterschieden - dann bleibt ein '
    + 'geparktes Formular ueber der Anmeldeseite stehen');
  assert.match(fn[0], /querySelectorAll\('\.modal-overlay'\)[\s\S]{0,80}remove\(\)/,
    'der Zwangspfad entfernt die geparkten Kaesten nicht');

  const resume = /function _resumeSuspendedModal\([\s\S]*?\n\}/.exec(modal);
  assert.ok(resume, '_resumeSuspendedModal ist nicht mehr auffindbar');
  assert.match(resume[0], /if \(!overlay\.isConnected\)[\s\S]{0,120}return;/,
    'ein zwangsweise entfernter Kasten wird wieder „zurueckgeholt" - Scroll-Sperre '
    + 'und Escape-Handler bleiben dann auf einem Phantom haengen');
});

test('die Registrierung des Modal-Systems folgt dem Zustand (#871)', () => {
  const modal = read('../public/components/modal.js');
  const fn = /function _syncOverlayRegistration\(\)[\s\S]*?\n\}/.exec(modal);
  assert.ok(fn, '_syncOverlayRegistration ist nicht mehr auffindbar');
  assert.match(fn[0], /querySelector\('\.modal-overlay'\)/,
    'die Registrierung fragt nicht mehr den Zustand ab');
  assert.match(fn[0], /isOverlayOpen\(_overlayToken\)/,
    'die Registrierung prueft nicht, ob ihr Token ueberhaupt noch im Register '
    + 'steht - ein wieder hervorgeholtes Formular meldet sich dann nie neu an');

  const abschnitt = (name) => {
    const start = modal.indexOf(`function ${name}(`);
    if (start === -1) return null;
    const rest = modal.slice(start);
    const ende = rest.slice(1).search(/\n(?:export )?(?:async )?function |\n\/\*\*/);
    return ende === -1 ? rest : rest.slice(0, ende + 1);
  };

  for (const name of ['openModal', '_doClose', '_resumeSuspendedModal']) {
    const block = abschnitt(name);
    assert.ok(block, `${name} ist nicht mehr auffindbar`);
    assert.match(block, /_syncOverlayRegistration\(\)/,
      `${name} zieht die Registrierung nicht nach - nach diesem Uebergang `
      + 'stimmt der Eintrag nicht mehr mit dem ueberein, was zu sehen ist');
  }
});

test('nur EINE Stelle baut die Zahl am Nav-Ziel (#868)', () => {
  const OWNER = '../public/utils/nav-badges.js';
  const offenders = [];

  for (const file of walkJsFiles('../public/')) {
    if (file === OWNER || file.includes('/vendor/')) continue;
    const src = withoutBlockComments(read(file));

    if (/className\s*=\s*['"]nav-badge['"]|classList\.add\(\s*['"]nav-badge['"]/.test(src)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders.sort(), [],
    'Diese Datei baut ihr Nav-Badge selbst. Genau daraus entstand #868: das '
    + 'Badge haengt dann am Zustand eines Moduls, das beim Anmelden noch gar '
    + 'nicht gerendert wurde, und faellt bei jedem Neuaufbau der Navigation '
    + `weg. Benutze setNavBadge() aus /utils/nav-badges.js.\n${offenders.join('\n')}`);
});

test('rebuildNavigation zeichnet die Nav-Zahlen nach (#868)', () => {
  const router = read('../public/router.js');
  const fn = /function rebuildNavigation\([\s\S]*?\n\}/.exec(router);
  assert.ok(fn, 'rebuildNavigation() ist nicht mehr auffindbar');
  assert.match(fn[0], /applyNavBadges\(\)/,
    'nach dem Neuaufbau der Navigation fehlen die Zahlen an den Nav-Zielen');


  assert.match(router, /function primeNavBadges\(/,
    'die Startwerte aus /dashboard fehlen - das Badge erschiene wieder erst '
    + 'nach dem ersten Besuch des Moduls');
  assert.match(router, /_moduleCountsAt = Date\.now\(\);\s*\n\s*primeNavBadges\(res\)/,
    'primeNavBadges haengt nicht an der /dashboard-Antwort');
});

test('das Mehr-Blatt zeichnet erst aus dem Speicher, dann nach (#868)', () => {
  const router = read('../public/router.js');
  const fn = /function openSheet\(\)[\s\S]*?\n  \}/.exec(router);
  assert.ok(fn, 'openSheet() ist nicht mehr auffindbar');

  const bare = fn[0].indexOf('paintMoreSheetBadges(sheet);');
  const guarded = fn[0].indexOf('if (fresh');
  assert.ok(bare !== -1,
    'das Blatt zeichnet die schon bekannten Zahlen nicht - innerhalb der TTL '
    + 'bleiben die Kacheln leer, obwohl die Zahlen im Speicher liegen');
  assert.ok(guarded !== -1 && bare < guarded,
    'das Zeichnen aus dem Speicher muss VOR dem Nachziehen stehen');
});

test('Server und Browser ziehen den Geburtstags-Schnitt beim selben Tag (#868)', () => {
  const client = read('../public/utils/nav-badges.js');
  const server = read('../server/routes/dashboard.js');

  const c = /BIRTHDAY_BADGE_DAYS\s*=\s*(\d+)/.exec(client);
  assert.ok(c, 'BIRTHDAY_BADGE_DAYS ist nicht mehr auffindbar');

  const s = /birthdaySoonCount\s*=\s*hydrated\.filter\(\(b\) => \(b\.days_until \?\? \d+\) <= (\d+)\)/.exec(server);
  assert.ok(s, 'der Server-Zaehler fuer nahe Geburtstage ist nicht mehr auffindbar');

  assert.equal(s[1], c[1],
    `Der Server schneidet bei ${s[1]} Tagen, der Browser bei ${c[1]}. Die Zahl `
    + 'springt dann beim ersten Besuch der Geburtstagsseite.');
});

test('das Aufgabenmodul zaehlt sein Badge nicht selbst (#868)', () => {
  const tasks = read('../public/pages/tasks.js');
  assert.doesNotMatch(tasks, /setNavBadge\s*\(/,
    'das Aufgabenmodul schreibt wieder direkt in den Badge-Slot - seine '
    + 'Liste ist gefiltert und kann die Frage nicht beantworten');
});

test('die Zaehler-Meldung haengt am Schreiben, nicht am Rendern (#868)', () => {
  const api = read('../public/api.js');
  const fn = /function notifyCountedMutation\(path\)[\s\S]*?\n\}/.exec(api);
  assert.ok(fn, 'notifyCountedMutation ist nicht mehr auffindbar');
  assert.match(fn[0], /invalidateModuleCounts/,
    'die Meldung erreicht den Zaehlstand nicht');
  assert.match(api, /if \(stateChanging\) notifyCountedMutation\(path\);/,
    'sie haengt nicht mehr am schreibenden Request');


  const tasks = read('../public/pages/tasks.js');
  assert.doesNotMatch(tasks, /invalidateModuleCounts/,
    'das Aufgabenmodul meldet wieder selbst - dann haengt die Meldung am '
    + 'Rendern und feuert bei jedem Tastenanschlag in der Suche');
});

test('der schmale Zustand der Kueche steht hinter seinem Bauteil', () => {
  const css = read('../public/styles/meals.css');
  let lastEmptyNone = -1;
  let lastSlotDisplay = -1;
  let i = 0;
  for (const rule of eachRule(css)) {
    i += 1;
    if (!/display\s*:/.test(rule.body ?? rule.declarations ?? '')) continue;
    const sels = String(rule.selector).split(',').map((s) => s.trim());
    if (sels.some((s) => /\.meal-slot--empty(?![\w-])/.test(s))
      && /display\s*:\s*none/.test(rule.body ?? rule.declarations ?? '')) {
      lastEmptyNone = i;
    } else if (sels.some((s) => /\.meal-slot(?![\w-])/.test(s))) {
      lastSlotDisplay = i;
    }
  }
  assert.ok(lastEmptyNone > -1, 'meals.css blendet die leeren Slots nicht mehr aus '
    + '(.meal-slot--empty { display: none } fehlt) - mobil stapeln sich dann wieder '
    + 'bis zu 28 gestrichelte Anlege-Boxen neben dem .day-add');
  assert.ok(lastSlotDisplay === -1 || lastEmptyNone > lastSlotDisplay,
    'die Ausblendung der leeren Slots steht VOR einer spaeteren .meal-slot-display-Regel '
    + `(Regel ${lastEmptyNone} vs. ${lastSlotDisplay}) - bei gleicher Spezifitaet gewinnt `
    + 'die spaetere Regel, und der leere Slot ist mobil wieder sichtbar (DESIGN.md, Don\'t '
    + '"eine Regel in einen Media-Block schreiben, der VOR den Bauteilen steht")');
});

test('jede auf Touch ausgeblendete Karten-Aktion hat einen Weg in der Leseansicht (#925)', () => {
  const page   = read('../public/pages/tasks.js');
  const detail = read('../public/components/task-detail.js');
  const css    = read('../public/styles/tasks.css');




  const hidesOnNarrow = [...eachRule(css)].some(({ selector, body, at }) =>
    /\.task-card__inline-action(?![\w-])/.test(selector)
    && /display\s*:\s*none/.test(body)
    && at.some((pre) => /max-width\s*:\s*639px/.test(pre)));
  assert.ok(hidesOnNarrow,
    'tasks.css blendet .task-card__inline-action nicht mehr unter 640px aus - '
    + 'entweder ist die Regel umgezogen (dann muss dieser Guard mit) oder die '
    + 'Karte zeigt ihre Aktionen jetzt auch auf dem Telefon');






  const actions = new Set(
    [...page.matchAll(/task-card__inline-action[^>]*?data-action="([^"]+)"/g)]
      .flatMap((m) => (m[1].includes('${')
        ? [...m[1].matchAll(/'([a-z][a-z-]*)'/g)].map((lit) => lit[1])
        : [m[1]])),
  );
  assert.ok(actions.size >= 3,
    `nur ${actions.size} Inline-Aktionen gefunden - das Muster im Guard passt nicht mehr `
    + 'auf das Karten-Markup und wuerde jede Luecke uebersehen');


  //    Handlung im Detail-Pfad ausloest.
  const TOUCH_PATH = {
    'add-subtask':     'addSubtask(',
    'edit-task':       'wireTaskForm(',
    'archive-task':    'toggleTaskArchive(',
    'unarchive-task':  'toggleTaskArchive(',
  };





  const detailStart = detail.indexOf('function subtaskListNode(');
  const detailEnd   = detail.indexOf('async function advanceTaskStatus(');
  assert.ok(detailStart > -1 && detailEnd > detailStart,
    'der Detail-Pfad (subtaskListNode ... openTaskDetail) ist nicht mehr auffindbar - '
    + 'der Guard misst sonst die falsche Datei-Haelfte');


  const mountStart = page.indexOf('function openTaskView(');
  const mountEnd   = page.indexOf('export async function openTaskById(');
  assert.ok(mountStart > -1 && mountEnd > mountStart,
    'der Mount-Block des Bearbeiten-Formulars ist nicht mehr auffindbar');
  const detailPath = detail.slice(detailStart, detailEnd) + page.slice(mountStart, mountEnd);

  for (const action of actions) {
    const call = TOUCH_PATH[action];
    assert.ok(call,
      `die Karte bietet "${action}" inline an, und dieser Guard kennt den Ersatzweg nicht. `
      + 'Unter 640px ist der Knopf weg: entweder traegt die Leseansicht die Handlung mit '
      + '(dann gehoert sie in TOUCH_PATH) oder es gibt sie auf dem Telefon nicht');
    assert.ok(detailPath.includes(call),
      `"${action}" verschwindet unter 640px, und der Detail-Pfad ruft ${call} nicht - `
      + 'auf dem Telefon gibt es dann keinen Weg zu dieser Handlung (genau #925)');
  }






  //



  const nodeFn = /function subtaskListNode\([\s\S]*?\n\}/.exec(detail);
  assert.ok(nodeFn, 'subtaskListNode ist nicht mehr auffindbar');
  const gate = /^\s*const (\w+) = [^\n]*canEditTaskDefinition\(task[,)]/m.exec(nodeFn[0]);
  assert.ok(gate,
    'subtaskListNode gattert den Anlege-Weg nicht mehr an canEditTaskDefinition - '
    + 'entweder darf jetzt jeder anlegen, oder der Knopf ist weg (#925)');
  const bail = /if \([^)]*\)\s*return null;/.exec(nodeFn[0]);
  assert.ok(bail, 'der Frueh-Ausstieg von subtaskListNode ist nicht mehr auffindbar');
  assert.ok(bail[0].includes(gate[1]),
    `der Abschnitt steigt bei leerer Liste aus, ohne "${gate[1]}" zu lesen - dann faellt er `
    + 'auch dann weg, wenn er den Anlege-Knopf zu zeigen haette, und auf dem Telefon '
    + 'gibt es keinen Weg zur ERSTEN Unteraufgabe (#925)');
  assert.ok(new RegExp(`if \\(${gate[1]}\\)`).test(nodeFn[0]),
    `der Anlege-Knopf haengt nicht mehr an "${gate[1]}" - der Guard misst dann eine `
    + 'Bedingung, die den Knopf gar nicht mehr gattert');
});

test('der Lucide-Ausschnitt läuft nach dem Bundle und vor jedem Modul, das ihn braucht', () => {
  const scope = read('../public/lucide-scope.js');


  const callers = walkJsFiles('../public/')
    .filter((file) => !/lucide(\.min)?\.js$/.test(file) && !file.includes('/vendor/'))
    .filter((file) => /createIcons\(\{\s*el/.test(read(file)));
  assert.ok(callers.length >= 30,
    `Nur ${callers.length} Dateien rufen createIcons({ el }) - das Muster greift nicht mehr`);


  assert.match(scope, /lucide\.createIcons\s*=/,
    'lucide-scope.js biegt createIcons nicht mehr um - der el-Parameter ist dann wieder wirkungslos');
  assert.match(scope, /\bel\.querySelectorAll\(/,
    'lucide-scope.js sucht nicht mehr unter `el` - dann ist der Ausschnitt keiner');





  //



  const scripts = [...withoutHtmlComments(read('../public/index.html')).matchAll(/<script\b[^>]*>/gi)]
    .map((m) => ({ tag: m[0], src: m[0].match(/\bsrc=["']([^"']+)["']/i)?.[1] }))
    .filter((s) => s.src);
  const isModule = (s) => /\btype=["']module["']/i.test(s.tag);


  const isDeferred = (s) => /\bdefer\b/i.test(s.tag) && !/\basync\b/i.test(s.tag);

  const positionsOf = (src) => scripts.flatMap((s, i) => (s.src === src ? [i] : []));
  const bundleAt = positionsOf('/lucide.min.js');
  const patchAt = positionsOf('/lucide-scope.js');
  assert.ok(bundleAt.length > 0, 'index.html lädt /lucide.min.js nicht mehr');
  assert.ok(patchAt.length > 0,
    'index.html lädt /lucide-scope.js nicht mehr - createIcons({ el }) durchsucht dann wieder '
    + 'das ganze Dokument, und zwar an allen Aufrufstellen auf einmal');



  assert.deepEqual([bundleAt.length, patchAt.length], [1, 1],
    'lucide.min.js und lucide-scope.js stehen nicht mehr genau einmal in index.html. '
    + 'Ein zweites Bundle-Tag hinter dem Patch ueberschreibt window.lucide und damit den Patch');
  const [bundle] = bundleAt;
  const [patch] = patchAt;
  assert.ok(patch > bundle,
    'lucide-scope.js steht vor lucide.min.js. Es findet `window.lucide` dann noch nicht und '
    + 'steigt still aus - der Ausschnitt ist wirkungslos, ohne dass irgendwo etwas bricht');




  for (const i of [bundle, patch]) {
    assert.ok(isDeferred(scripts[i]),
      `${scripts[i].src} ist nicht mehr rein deferred (defer, kein async) - die Reihenfolge `
      + 'zwischen Bundle und Patch ist damit nicht mehr garantiert');
  }




  assert.deepEqual(
    scripts.filter((s, i) => i < patch && isModule(s)).map((s) => s.src), [],
    'Diese Module stehen in index.html vor lucide-scope.js und laufen damit vor dem Patch');








  const runsBeforePatch = (s, i) => (!isDeferred(s) && !isModule(s)) || i < patch;
  const early = scripts

    .filter((s, i) => runsBeforePatch(s, i) && i !== bundle && i !== patch)
    .filter((s) => existsSync(new URL(`../public${s.src}`, import.meta.url)))
    .filter((s) => /createIcons/.test(read(`../public${s.src}`)));
  assert.deepEqual(early.map((s) => s.src), [],
    'Diese Skripte laufen vor dem Patch und rufen createIcons - der Aufruf ist dort ungescopt');
});

/* ============================================================
 * PAGE COMPOSITION SYSTEM - PAGE-001 ... PAGE-011
 * (docs/PAGE-COMPOSITION.md)
 * ============================================================ */

const COMPOSITION_MODES = ['reading', 'data', 'dashboard', 'form', 'split', 'full'];

function routerPageRows() {
  const router = read('../public/router.js');
  const rows = [...router.matchAll(
    /page:\s*'\/pages\/([\w-]+)\.js'[^}]*?requiresAuth:\s*(true|false)/g)]
    .map((r) => ({ name: `${r[1]}.js`, auth: r[2] === 'true' }));





  // geschrieben wurde, nie gesehen (claude-review, zweite Runde an #995).
  if (!rows.some((r) => !r.auth)) {
    throw new Error('Der Router-Ausdruck liest keine Route mit requiresAuth: false mehr - '
      + 'hat sich die Routentabelle in public/router.js umformatiert?');
  }
  return rows;
}

function pagesBehindAppShell() {
  const rows = routerPageRows();
  const shell = new Set(rows.filter((r) => r.auth).map((r) => r.name));
  const standalone = new Set(rows.filter((r) => !r.auth).map((r) => r.name));


  for (const file of walkJsFiles('../public/pages/')) {
    const name = file.split('/').pop();
    if (!standalone.has(name)) shell.add(name);
  }
  return [...shell].sort();
}

const COMPOSITION_PENDING = new Set([
  'shopping.js',
  'meals.js',
  'settings.js',
]);

const COMPOSITION_PENDING_MAX = 3;

function compositionScope() {
  return pagesBehindAppShell().filter((name) => !COMPOSITION_PENDING.has(name));
}

function compositionScopeCss() {
  return compositionScope()
    .map((name) => name.replace(/\.js$/, '.css'))
    .filter((css) => existsSync(new URL(`../public/styles/${css}`, import.meta.url)));
}

const COMPOSITION_BLACKLIST_WIDTH = /max-width\s*:\s*(?!none|100%|var\(--(?:page-measure|layout-|content-max-width))[0-9.]+(?:px|rem|em|vw)/i;




const COMPOSITION_NEGATIVE_MARGIN = /margin(?:-inline|-left|-right|-inline-start|-inline-end)?\s*:\s*(?:-[0-9.]|calc\(\s*-)/i;

test('PAGE-000: der Geltungsbereich ist nicht leer und deckt fast alle Seiten', () => {
  // REICHWEITEN-NACHWEIS. Ohne ihn koennte jede Regel darunter gruen sein, weil

  const rows = routerPageRows();
  const standalone = rows.filter((r) => !r.auth).length;
  assert.ok(rows.length >= 20,
    `Der Router-Ausdruck liest nur ${rows.length} Routen - ohne ihn kommt der Bereich aus dem Dateisystem und ist zu GROSS, nicht leer`);
  assert.ok(standalone >= 4,
    `Nur ${standalone} Routen ohne App-Shell erkannt (Login, Setup, Einladung, Reset) - der Ausdruck liest requiresAuth nicht mehr`);
  const shell = pagesBehindAppShell();
  const scope = compositionScope();
  const all = walkJsFiles('../public/pages/').length;
  assert.ok(shell.length >= 20,
    `Nur ${shell.length} Seiten hinter der App-Shell erkannt - liest der Router-Ausdruck noch?`);
  assert.ok(!shell.includes('login.js') && !shell.includes('setup.js'),
    'Login und Setup zeichnen ohne App-Shell und gehoeren nicht in den Geltungsbereich');
  assert.ok(scope.length >= 15,
    `Nur ${scope.length} Seiten im Geltungsbereich - die Regeln pruefen fast nichts`);
  assert.ok(scope.length >= all - 8,
    `${all - scope.length} von ${all} Seiten sind ausgenommen - das ist wieder eine Allowlist`);
  assert.ok(compositionScopeCss().length >= 12,
    'Zu wenige Seiten-CSS im Geltungsbereich - die CSS-Regeln laufen ins Leere');
});

test('PAGE-011: die Ausnahmeliste waechst nicht und enthaelt nur echte Seiten', () => {
  assert.ok(COMPOSITION_PENDING.size <= COMPOSITION_PENDING_MAX,
    `Die Ausnahmeliste ist auf ${COMPOSITION_PENDING.size} gewachsen (erlaubt: `
    + `${COMPOSITION_PENDING_MAX}). Eine neue Seite gehoert nicht auf diese Liste, `
    + 'sie erfuellt den Vertrag von Anfang an.');
  assert.equal(COMPOSITION_PENDING.size, COMPOSITION_PENDING_MAX,
    `Es sind nur noch ${COMPOSITION_PENDING.size} Ausnahmen - setze `
    + `COMPOSITION_PENDING_MAX auf ${COMPOSITION_PENDING.size} herunter, sonst haelt `
    + 'der Guard Platz frei, den niemand mehr braucht.');
  const shell = new Set(pagesBehindAppShell());
  for (const name of COMPOSITION_PENDING) {
    assert.ok(existsSync(new URL(`../public/pages/${name}`, import.meta.url)),
      `PAGE-011: ${name} steht auf der Ausnahmeliste, die Datei gibt es nicht mehr`);
    assert.ok(shell.has(name),
      `PAGE-011: ${name} liegt nicht hinter der App-Shell und braucht keine Ausnahme`);
  }
});

test('PAGE-001: every page behind the app shell declares exactly one composition mode', () => {
  for (const name of compositionScope()) {
    const src = withoutHtmlComments(read(`../public/pages/${name}`));
    const found = COMPOSITION_MODES.filter((mode) =>
      new RegExp(`app-page--${mode}|data-composition="${mode}"|mode:\\s*'${mode}'`).test(src));
    // Compat: page-measure--narrow alone counts as reading until aliases retire.
    if (/page-measure--narrow/.test(src) && !found.includes('reading')) found.push('reading');
    assert.ok(found.length >= 1, `PAGE-001 ${name}: must declare a composition mode`);
    assert.equal(found.length, 1,
      `PAGE-001 ${name}: exactly one mode expected, found ${found.join(',')}`);
  }
});

test('PAGE-002: PageHeader and PageBody share composition context', () => {
  const layout = read('../public/styles/layout.css');
  assert.match(layout, /\.app-page--reading[\s\S]*?--page-measure:\s*var\(--layout-reading\)/,
    'PAGE-002: reading mode must set --page-measure');
  assert.match(layout, /\.page-measure--narrow[\s\S]*?--page-measure:\s*var\(--layout-reading\)|\.app-page--reading,\s*\n\.app-page--form,\s*\n\.page-measure--narrow/,
    'PAGE-002: compat alias and reading mode share --page-measure');
  // Budget KPI band must read the page measure (Header/Body axis).
  assert.match(layout, /\.page-measure--narrow :is\([\s\S]*?\.metric-grid/,
    'PAGE-002: .metric-grid must share the reading measure with header/list');


  assert.match(layout, /\.app-page:has\(> \.app-page__body\)\s*\{[^}]*gap:\s*var\(--space-3\)/,
    'PAGE-002: .app-page must space toolbar and .app-page__body - the module CSS no longer does');
});

test('PAGE-003: primary content must not define arbitrary width', () => {
  for (const name of compositionScope()) {
    const src = withoutBlockComments(read(`../public/pages/${name}`));



    const hits = [...src.matchAll(/style\s*=\s*["'][^"']*?max-width\s*:\s*([^;"']+)/gi)];
    for (const hit of hits) {
      assert.ok(/var\(--(?:page-measure|layout-|content-max-width)/.test(hit[1]) || /^\s*(?:100%|none)\s*$/.test(hit[1]),
        `PAGE-003 ${name}: arbitrary inline max-width - ${hit[1]}`);
    }
  }
  for (const file of compositionScopeCss()) {
    const css = withoutBlockComments(read(`../public/styles/${file}`));
    for (const rule of eachRule(css)) {
      if (!COMPOSITION_BLACKLIST_WIDTH.test(rule.body)) continue;
      if (/--layout-|--page-measure|--content-max-width/.test(rule.body)) continue;
      // Component-internal widths (chips, avatars, icons) are fine; page roots are not.
      if (/\.(?:app-page|[\w-]+-page)\b/.test(rule.selector)) {
        assert.fail(`PAGE-003 ${file}: page-level arbitrary width in ${rule.selector}`);
      }
    }
  }
});

test('PAGE-004: layout width tokens exist and are wired', () => {
  const tokens = read('../public/styles/tokens.css');
  assert.match(tokens, /--layout-reading:\s*var\(--content-max-width-narrow\)/,
    'PAGE-004: --layout-reading');
  assert.match(tokens, /--layout-content:\s*60rem/,
    'PAGE-004: --layout-content');
  assert.match(tokens, /--layout-wide:\s*75rem/,
    'PAGE-004: --layout-wide');
  const layout = read('../public/styles/layout.css');
  assert.match(layout, /\.app-page\s*\{/, 'PAGE-004: .app-page primitive');
  assert.match(layout, /\.page-measure\s*\{/, 'PAGE-004: .page-measure primitive');
  assert.match(layout, /\.page-section--bleed\s*\{/, 'PAGE-004: bleed primitive');
  assert.ok(existsSync(new URL('../public/utils/page-layout.js', import.meta.url)),
    'PAGE-004: page-layout.js must exist');
});



// public/styles/*.css, 121 Media-Queries, keine einzige daneben. Die erste



const COMPOSITION_BREAKPOINT_SCALE = new Set([639, 640, 767, 768, 1023, 1024, 1439, 1440]);

test('PAGE-005: pages in scope avoid local page-geometry breakpoints', () => {
  let seen = 0;
  for (const file of compositionScopeCss()) {
    const css = withoutBlockComments(read(`../public/styles/${file}`));
    const widths = [...css.matchAll(/@media[^{]*?\(\s*(?:min|max)-width\s*:\s*([0-9.]+)(px|rem|em)\s*\)/g)];
    seen += widths.length;
    const odd = widths
      .filter(([, value, unit]) => unit !== 'px' || !COMPOSITION_BREAKPOINT_SCALE.has(Number(value)))
      .map(([, value, unit]) => `${value}${unit}`);
    assert.deepEqual(odd, [],
      `PAGE-005 ${file}: breakpoints off the shared scale: ${odd.join(', ')} - a page does not own its own breakpoints`);
  }
  assert.ok(seen >= 40, `PAGE-005: only ${seen} media queries seen in scope - the scan is blind`);
});

test('PAGE-006: page-level negative margins are prohibited in scope', () => {



  // Regex ueberhaupt sieht: sieht sie nichts, prueft die Schleife nichts.
  let seen = 0;
  for (const file of compositionScopeCss()) {
    const css = withoutBlockComments(read(`../public/styles/${file}`));
    for (const rule of eachRule(css)) {
      if (!COMPOSITION_NEGATIVE_MARGIN.test(rule.body)) continue;
      seen++;
      if (/\.page-section--bleed/.test(rule.selector)) continue;
      if (/\.(?:app-page|[\w-]+-page)\b/.test(rule.selector)) {
        assert.fail(`PAGE-006 ${file}: page-level negative margin in ${rule.selector}`);
      }
    }
  }
  assert.ok(seen >= 3,
    `PAGE-006: the regex matched only ${seen} negative margins in scope - it no longer sees the calc(-1 * ...) idiom`);
});

test('PAGE-007: page-layout helpers export the contract surface', () => {
  const src = read('../public/utils/page-layout.js');
  for (const name of [
    'COMPOSITION_MODES',
    'compositionModeClass',
    'renderAppPage',
    'renderPageHeader',
    'renderPageTitle',
    'renderPageActions',
    'renderPageBody',
    'renderPageSection',
    'renderListSection',
    'renderMetricBand',
  ]) {
    assert.match(src, new RegExp(`export (?:const|function) ${name}`),
      `PAGE-007: missing export ${name}`);
  }
  assert.match(src, /COMPOSITION_MODES = Object\.freeze\(\[\s*'reading'/,
    'PAGE-007: modes must include reading');
});

test('PAGE-006b: a page without a measure does not narrow its header', () => {





  // Masonry-Raster daneben bis fuenf Spalten breit. Wer je Ansicht toggelt

  let checked = 0;
  for (const file of compositionScope()) {
    const src = read(`../public/pages/${file}`);
    if (!/app-page--(?:full|split)\b|data-composition="(?:full|split)"|mode:\s*'(?:full|split)'/.test(src)) continue;
    checked++;
    const heads = [...src.matchAll(/class="([^"]*\bpage-toolbar\b[^"]*)"/g)].map((m) => m[1]);
    for (const classList of heads) {
      assert.ok(!/\bpage-toolbar--narrow\b/.test(classList),
        `PAGE-006b ${file}: "${classList}" narrows the header on a page whose body has no measure`);
    }
  }
  assert.ok(checked >= 2, `PAGE-006b: only ${checked} full/split pages found - calendar and notes should be two`);
});

test('PAGE-007b: a header keeps its slots as direct children, whatever the options', async () => {

  // (ux.js), die Large-Title-Regeln `.page-toolbar > .page-toolbar__title`


  // Ebene tiefer legte. Runde eins an #995 nahm den Rail fuer `narrow` heraus




  const { renderPageHeader } = await import('../public/utils/page-layout.js');
  const slots = {
    title: '<h1 class="page-toolbar__title">T</h1>',
    center: '<div class="page-search"></div>',
    actions: '<div class="page-toolbar__actions"></div>',
  };
  const direct = [slots.title, slots.center, slots.actions].join('\n');
  for (const opts of [{}, { narrow: true }, { narrow: false }, { measured: true, narrow: false }, { measured: true }]) {
    const html = renderPageHeader({ ...slots, ...opts });
    const inner = html.match(/^<div class="page-toolbar[^"]*">\n([\s\S]*)\n<\/div>$/);
    assert.ok(inner, `PAGE-007b: ${JSON.stringify(opts)} did not render a single toolbar element`);
    assert.equal(inner[1], direct,
      `PAGE-007b: ${JSON.stringify(opts)} must emit the slots as direct children of the toolbar, nothing between`);
  }

  assert.doesNotMatch(read('../public/pages/birthdays.js'), /measured:/,
    'PAGE-007b: birthdays passes no `measured` option - the helper has none');



  // verloren hat (Codex, dritte Runde an #995).
  const example = read('../docs/PAGE-COMPOSITION.md').match(/### Worked example[\s\S]*?```text\n([\s\S]*?)```/);
  assert.ok(example, 'PAGE-007b: the worked example in docs/PAGE-COMPOSITION.md is missing');
  assert.match(example[1], /page-toolbar--narrow/, 'PAGE-007b: the worked example shows a narrow toolbar');
  assert.doesNotMatch(example[1], /page-toolbar__rail/,
    'PAGE-007b: the worked example must not show a rail element under a narrow toolbar');
});

test('PAGE-008: DESIGN.md points at the composition system', () => {
  const design = read('../DESIGN.md');
  assert.match(design, /docs\/PAGE-COMPOSITION\.md/,
    'PAGE-008: DESIGN.md must link docs/PAGE-COMPOSITION.md');
  assert.ok(existsSync(new URL('../docs/PAGE-COMPOSITION.md', import.meta.url)),
    'PAGE-008: docs/PAGE-COMPOSITION.md must exist');
  assert.ok(!existsSync(new URL('../PAGE-COMPOSITION.md', import.meta.url)),
    'PAGE-008: the spec lives under docs/, not in the repository root');





  const spec = read('../docs/PAGE-COMPOSITION.md');
  const links = [...spec.matchAll(/\]\(([^)#]+?)(?:#[^)]*)?\)/g)]
    .map((m) => m[1])
    .filter((target) => !/^[a-z]+:/.test(target));
  assert.ok(links.length >= 6, `PAGE-008: only ${links.length} relative links found - the scan is blind`);
  const dead = links.filter((target) => !existsSync(new URL(`../docs/${target}`, import.meta.url)));
  assert.deepEqual(dead, [],
    `PAGE-008: links in docs/PAGE-COMPOSITION.md that do not resolve from docs/: ${dead.join(', ')}`);
});

test('PAGE-009: composition mode owns responsive split/full behaviour', () => {
  const layout = read('../public/styles/layout.css');











  const splitGrid = layout.match(/@container \(min-width: 768px\) \{\s*\.app-page--split > \.app-page__body \{([^}]*)\}/);
  assert.ok(splitGrid, 'PAGE-009: split mode must put its two-column grid on > .app-page__body inside a 768px container query');
  assert.match(splitGrid[1], /display:\s*grid/, 'PAGE-009: the split body is a grid');
  assert.match(splitGrid[1], /grid-template-columns:\s*minmax\(0, min\(var\(--layout-reading\), 50%\)\) minmax\(0, 1fr\)/,
    'PAGE-009: master rail up to the reading measure but never more than half, detail takes the rest');
  assert.doesNotMatch(layout, /@media \(min-width: \d+px\) \{\s*\.app-page--split > \.app-page__body/,
    'PAGE-009: the split grid must not be gated by a viewport query - the page is narrower than the viewport beside the sidebar');
  const splitRoot = [...layout.matchAll(/\.app-page--split\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(splitRoot.some((body) => /container-type:\s*inline-size/.test(body)),
    'PAGE-009: .app-page--split must be an inline-size container, or the @container query never matches');
  for (const rule of layout.matchAll(/\.app-page--split\s*(?:,[^{]*)?\{([^}]*)\}/g)) {
    assert.doesNotMatch(rule[1], /display:\s*grid|grid-template-columns/,
      'PAGE-009: .app-page--split itself must not be a grid - header and body would become its two cells');
  }


  // Rails begannen bei x=0, links vom Titel (Codex, dritte Runde an #995).

  const splitBodies = [...layout.matchAll(/\.app-page--split > \.app-page__body \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(splitBodies.some((body) => /padding-inline:\s*var\(--page-inline-pad\)/.test(body)),
    'PAGE-009: the split body must carry the page gutter (padding-inline: var(--page-inline-pad))');


  assert.match(layout, /\.app-page--split,\s*\n\.app-page--full \{\s*--page-measure:\s*100%;/,
    'PAGE-009: full/split set --page-measure: 100% (a length the header formulas can subtract)');
  assert.doesNotMatch(layout, /--page-measure:\s*none/,
    'PAGE-009: --page-measure: none makes every calc() that reads it invalid');
});

test('PAGE-013: a narrow header follows the measure of ITS page, and full/split roots take the shell height', () => {
  const layout = read('../public/styles/layout.css');




  const bar = layout.match(/\.page-toolbar--narrow:has\(> \.page-toolbar__bar\) \{([^}]*)\}/);
  assert.ok(bar, 'PAGE-013: the bar-header rule is missing');
  assert.match(bar[1], /calc\(100% - var\(--page-measure, var\(--content-max-width-narrow\)\) - var\(--page-inline-pad\)\)/,
    'PAGE-013: the bar header must subtract --page-measure, not the reading width');


  const headFormulas = [...layout.matchAll(/\.page-toolbar--narrow[^{]*\{([^}]*)\}/g)]
    .map((m) => m[1]).filter((body) => /calc\(100% -/.test(body));
  assert.ok(headFormulas.length >= 2, `PAGE-013: only ${headFormulas.length} header formulas found - the scan is blind`);
  for (const body of headFormulas) {
    assert.doesNotMatch(body, /calc\(100% - var\(--(?:content-max-width-narrow|layout-reading)\)/,
      'PAGE-013: a header formula subtracts a literal width instead of --page-measure');
  }



  // `height: 100%` (Kalender, Notizen) bleiben unberuehrt.
  assert.match(layout, /\.app-page--full:has\(> \.app-page__body\),\s*\n\.app-page--split:has\(> \.app-page__body\) \{\s*height:\s*100%;/,
    'PAGE-013: full/split roots built by renderAppPage() must take the shell height');
});

test('PAGE-014: page-layout helpers escape every attribute they emit', async () => {






  const h = await import('../public/utils/page-layout.js');
  const hostile = 'x" onclick="alert(1)';
  const cases = [
    ['renderAppPage id', h.renderAppPage({ id: hostile })],
    ['renderAppPage className', h.renderAppPage({ className: hostile })],
    ['renderAppPage attrs value', h.renderAppPage({ attrs: { 'data-x': hostile } })],
    ['renderPageHeader className', h.renderPageHeader({ className: hostile })],
    ['renderPageTitle className', h.renderPageTitle('T', { className: hostile })],
    ['renderPageActions className', h.renderPageActions('', { className: hostile })],
    ['renderPageBody id', h.renderPageBody({ id: hostile })],
    ['renderPageBody className', h.renderPageBody({ className: hostile })],
    ['renderPageSection id', h.renderPageSection({ id: hostile })],
    ['renderPageSection className', h.renderPageSection({ className: hostile })],
    ['renderListSection id', h.renderListSection({ id: hostile })],
    ['renderMetricBand className', h.renderMetricBand({ content: '', className: hostile })],
  ];
  for (const [name, html] of cases) {
    assert.doesNotMatch(html, /onclick="/, `PAGE-014: ${name} lets a quote close the attribute`);
    assert.match(html, /&quot; onclick=&quot;/, `PAGE-014: ${name} must escape the quote, not drop it`);
  }




  // `"`-Payload gruen blieb (Codex + claude-review, vierte Runde an #995).


  for (const key of [hostile, 'data-x onmouseover=alert(1) z', 'x=y', 'a\tb', '', '1x', 'data-"']) {
    assert.throws(() => h.renderAppPage({ attrs: { [key]: 'v' } }), /Invalid attribute name/,
      `PAGE-014: attrs key ${JSON.stringify(key)} must be rejected, not serialized`);
  }





  const openingTagAttrs = (html) => {
    const tag = html.match(/^<div\s([^>]*)>/);
    assert.ok(tag, 'PAGE-014: the page root must open with <div ...>');
    const attrs = new Map();
    const re = /([^\s"'>/=]+)(?:="([^"]*)")?/g;
    for (const m of tag[1].matchAll(re)) attrs.set(m[1], m[2] ?? '');
    return attrs;
  };
  const decode = (v) => v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const parsed = openingTagAttrs(h.renderAppPage({
    id: hostile,
    className: hostile,
    attrs: { 'data-x': hostile, 'aria-label': '<b>', 'data-ok': 'v' },
  }));
  assert.deepEqual([...parsed.keys()].sort(), ['aria-label', 'class', 'data-composition', 'data-ok', 'data-x', 'id'],
    'PAGE-014: the parsed root must carry exactly the six declared attributes - nothing split off, nothing live');
  assert.equal(decode(parsed.get('id')), hostile, 'PAGE-014: the hostile id round-trips as text');
  assert.equal(decode(parsed.get('data-x')), hostile, 'PAGE-014: the hostile value round-trips as text');
  assert.equal(decode(parsed.get('aria-label')), '<b>', 'PAGE-014: a value with markup round-trips as text');


  const rawSplit = openingTagAttrs('<div class="app-page" data-x onmouseover="alert(1)" z="">');
  assert.deepEqual([...rawSplit.keys()], ['class', 'data-x', 'onmouseover', 'z'],
    'PAGE-014: the tokenizer must split an unquoted key the way a browser does');

  assert.match(h.renderPageBody({ content: '<p>x</p>' }), /<p>x<\/p>/,
    'PAGE-014: content slots are markup and must pass through');

  const src = read('../public/utils/page-layout.js');
  assert.match(src, /import \{ esc \} from '\.\/html-escape\.js'/,
    'PAGE-014: the helpers use the shared esc(), not a local replace');
  assert.doesNotMatch(src, /replace\(\/"\/g/, 'PAGE-014: no hand-rolled quote replacement next to esc()');
  assert.doesNotMatch(src, /esc\(key\)/, 'PAGE-014: an attribute key is validated, not escaped - esc() does not know space or =');
  assert.match(src, /const ATTR_NAME = \/\^\[A-Za-z\]\[A-Za-z0-9:_\.-\]\*\$\//,
    'PAGE-014: attribute keys are checked against a name pattern');
});

test('PAGE-015: a tab panel inside a page declares the mode of that page', () => {







  const modeOf = (file) => {
    const m = read(file).match(/class="[^"]*\bapp-page app-page--([a-z]+)/);
    assert.ok(m, `PAGE-015: ${file} declares no composition mode`);
    return m[1];
  };
  const page = modeOf('../public/pages/budget.js');
  for (const panel of ['../public/pages/budget-stats.js', '../public/pages/budget-plans.js']) {
    assert.equal(modeOf(panel), page,
      `PAGE-015: ${panel} is a tab panel of budget.js and must declare its mode (${page}), not its own`);
  }
});

test('PAGE-016: a page whose header runs full width puts nothing on the measure', () => {
  // Codex, siebte Runde an #995: schedule stand auf `data` (960px), sein Kopf








  //


  // liest sie, damit ein neuer Konsument automatisch mitzaehlt.
  const styleDir = new URL('../public/styles/', import.meta.url);
  const consumers = new Map();
  for (const file of readdirSync(styleDir).filter((f) => f.endsWith('.css'))) {
    for (const { selector, body } of eachRule(read(`../public/styles/${file}`))) {
      if (!/max-width\s*:[^;]*--page-measure/.test(body)) continue;
      for (const fragment of selector.split(',')) {


        const subject = fragment.trim().split(/\s*[>+~]\s*|\s+/).pop();
        for (const cls of subject.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
          consumers.set(cls[1], `${file}: ${selector.replace(/\s+/g, ' ').trim().slice(0, 80)}`);
        }
      }
    }
  }
  for (const known of ['page-measure', 'list-rows', 'metric-grid']) {
    assert.ok(consumers.has(known), `PAGE-016: ${known} is not read as a consumer - the stylesheet scan is blind`);
  }
  assert.ok(consumers.size >= 10, `PAGE-016: only ${consumers.size} consumers found - the stylesheet scan is blind`);

  let measuredWithFullHeader = 0;
  for (const name of compositionScope()) {
    const src = withoutBlockComments(withoutHtmlComments(read(`../public/pages/${name}`)));
    const mode = COMPOSITION_MODES.find((m) =>
      new RegExp(`app-page--${m}|data-composition="${m}"|mode:\\s*'${m}'`).test(src));
    if (!mode || mode === 'full' || mode === 'split') continue;
    const ownHeader = /page-toolbar/.test(src) || /renderPageHeader\(/.test(src);

    // seiner Seite.
    if (!ownHeader) continue;
    const narrow = /page-toolbar--narrow/.test(src)
      || (/renderPageHeader\(/.test(src) && !/narrow:\s*false/.test(src));
    if (narrow) continue;
    measuredWithFullHeader += 1;
    for (const [cls, rule] of consumers) {
      const hit = new RegExp(`class="[^"]*(?<![\\w-])${cls}(?![\\w-])`).test(src);
      assert.ok(!hit,
        `PAGE-016 ${name}: mode ${mode} caps .${cls} (${rule}) at the measure while the header runs `
        + 'full width - either narrow the header (page-toolbar--narrow) so the measure is visible '
        + 'from the top, or declare full/split so nothing on this page is capped');
    }
  }


  assert.ok(measuredWithFullHeader >= 1,
    'PAGE-016: no measured page with a full-width header left - drop this guard or its scope changed');
});

test('PAGE-010: full-bleed is an explicit --bleed declaration', () => {
  const layout = read('../public/styles/layout.css');
  assert.match(layout, /\.page-section--bleed\s*\{[\s\S]*?padding-inline:\s*var\(--page-inline-pad\)/,
    'PAGE-010: bleed primitive must use --page-inline-pad');
  const helpers = read('../public/utils/page-layout.js');
  assert.match(helpers, /page-section--bleed/,
    'PAGE-010: helpers must emit bleed class');
});

test('PAGE-012: the router applies what an extension manifest declares', () => {





  const router = withoutBlockComments(read('../public/router.js'));
  const mount = router.slice(router.indexOf('function mountExtensionPage('));
  assert.ok(mount.length > 0, 'PAGE-012: router.js must mount an extension page root');
  const body = mount.slice(0, mount.indexOf('\n}\n'));
  assert.match(body, /page\.composition/, 'PAGE-012: the mount reads page.composition');
  assert.match(body, /COMPOSITION_MODES\.includes\(/, 'PAGE-012: an unknown mode falls back instead of leaking into a class');
  assert.match(body, /app-page app-page--\$\{mode\}/, 'PAGE-012: the root carries the mode class');
  assert.match(body, /dataset\.composition = mode/, 'PAGE-012: the root carries data-composition');
  assert.match(body, /dataset\.pageWidth/, 'PAGE-012: page.width lands on the root');

  assert.match(router, /mountExtensionPage\(pageWrapper, route\.thirdPartyModule\)/,
    'PAGE-012: the extension render path must mount through the composition root');
  assert.match(router, /page: \{ \.\.\.route\.thirdPartyModule\.page \}/,
    'PAGE-012: the module learns its declared page via context.page');



  const layout = read('../public/styles/layout.css');
  for (const [width, token] of [['reading', 'reading'], ['content', 'content'], ['wide', 'wide']]) {
    const rule = new RegExp(`\\[data-page-width="${width}"\\]\\s*\\{[^}]*--page-measure:\\s*var\\(--layout-${token}\\)`);
    assert.match(layout, rule, `PAGE-012: layout.css maps page.width=${width} to --layout-${token}`);
  }
  const widthRules = [...layout.matchAll(/^[^{]*\[data-page-width=[^{]*\{/gm)].map((m) => m[0]);
  assert.ok(widthRules.length >= 3, 'PAGE-012: three width rules expected');
  for (const sel of widthRules) {
    assert.doesNotMatch(sel, /app-page--(?:full|split)/,
      `PAGE-012: a width must not cap a page that owns its width: ${sel.trim()}`);
    assert.match(sel, /app-page--reading/, `PAGE-012: width rules are scoped to measured modes: ${sel.trim()}`);
  }
});

test('PAGE composition: no page marks itself as the reference implementation', () => {
  const offenders = walkJsFiles('../public/')
    .filter((file) => /data-composition-reference/.test(read(file)));
  assert.deepEqual(offenders, [],
    'Ein Kompositions-Marker ist zurueck im Produktionsmarkup. Die Zusicherung '
    + 'gehoert in den Guard, nicht ins ausgelieferte HTML.');
});

test('PAGE composition: birthdays stays free of page geometry in module CSS', () => {
  const src = read('../public/pages/birthdays.js');
  const css = withoutBlockComments(read('../public/styles/birthdays.css'));
  assert.match(src, /from ['"]\/utils\/page-layout\.js['"]/,
    'birthdays.js must import page-layout helpers');
  for (const name of [
    'renderAppPage',
    'renderPageHeader',
    'renderPageTitle',
    'renderPageActions',
    'renderPageBody',
    'renderPageSection',
    'renderListSection',
  ]) {
    assert.match(src, new RegExp(name), `birthdays.js must call ${name}`);
  }
  assert.match(src, /mode:\s*'reading'/, 'birthdays.js must declare reading mode');
  assert.match(src, /legacyAlias:\s*false/,
    'birthdays.js must omit the .page-measure--narrow compat alias');
  assert.doesNotMatch(src, /measured:|page-toolbar__rail/,
    'birthdays.js header has no rail element and no measured option (sixth round of #995)');
  assert.doesNotMatch(src, /page-measure--narrow/,
    'birthdays.js must not reintroduce page-measure--narrow');
  // Module CSS owns accent/list chrome only - no page geometry.
  for (const rule of eachRule(css)) {
    if (!/\.birthdays-page\b/.test(rule.selector)) continue;
    assert.doesNotMatch(rule.body, /max-width\s*:/,
      `birthdays.css must not set page max-width on ${rule.selector}`);
    assert.doesNotMatch(rule.body, /margin-inline\s*:\s*var\(--page-inline-pad\)/,
      `birthdays.css must not own page gutters on ${rule.selector}`);
  }
  assert.doesNotMatch(css, /\.birthdays-hint\s*\{[^}]*margin-inline\s*:\s*var\(--page-inline-pad\)/,
    'hint gutter must come from .app-page__body, not birthdays.css');
  assert.doesNotMatch(css, /\.birthdays-list\s*\{[^}]*margin-inline\s*:\s*var\(--page-inline-pad\)/,
    'list gutter must come from composition body, not birthdays.css');
});

test('PAGE composition: there is no toolbar rail element anywhere under public/', () => {







  const styleDir = new URL('../public/styles/', import.meta.url);
  const files = [
    ...readdirSync(styleDir).filter((f) => f.endsWith('.css')).map((f) => `../public/styles/${f}`),
    ...walkFrontendFiles('../public/').filter((f) => !f.includes('/vendor/')),
  ];
  let seen = 0;
  for (const file of files) {
    seen++;
    const src = read(file);
    const hit = src.match(/page-toolbar__rail|page-toolbar--measured/);
    const line = hit ? src.slice(0, hit.index).split('\n').length : 0;
    assert.ok(!hit,
      `${file}:${line}: "${hit?.[0]}" - the toolbar rail element is gone; the header slots are direct children (sixth round of #995)`);
  }
  assert.ok(seen > 100, `PAGE composition: only ${seen} files scanned for the rail - the walk is broken`);
  const layout = read('../public/styles/layout.css');
  assert.match(layout, /\.app-page--reading\s*>\s*\.app-page__body/,
    'reading body must own page-inline-pad gutters');
});

// --------------------------------------------------------------------------

//

// setzte `display:flex; flex-direction:column; max-height:inherit;

// buildDialog() (public/components/icon-picker.js) baut aber einen Wrapper





// (Schnellzugriffe, Kalender, Schichtplan) gleichermassen, seit #873 - auf

// --------------------------------------------------------------------------
test('die Scroll-Klasse der Symbolauswahl-CSS trifft einen wirklich erzeugten Wrapper', () => {
  const js = read('../public/components/icon-picker.js');
  const css = read('../public/styles/icon-picker.css');

  const wrapperMatch = /<div class="(icon-picker__\w+)">/.exec(js);
  assert.ok(wrapperMatch, 'buildDialog() baut keinen icon-picker__*-Wrapper mehr - Guard veraltet');
  const wrapperClass = wrapperMatch[1];

  assert.ok(css.includes(`.${wrapperClass} {`),
    `Die CSS setzt keine Regel fuer ".${wrapperClass}" - genau der Wrapper, den `
    + 'buildDialog() tatsaechlich erzeugt. Ohne eine Regel hier bekommt der Dialog keinen '
    + 'Flex-Kontext, das Ergebnis-Raster scrollt nicht und die Fusszeile (Loeschen/'
    + 'Abbrechen) kann vom `overflow: hidden` des <dialog> abgeschnitten werden - auf '
    + 'kurzen Viewports unerreichbar.');

  const rule = new RegExp(`\\.${wrapperClass}\\s*\\{[^}]*\\}`).exec(css)[0];
  for (const prop of ['display: flex', 'flex-direction: column', 'min-height: 0']) {
    assert.ok(rule.includes(prop),
      `.${wrapperClass} traegt kein "${prop}" - ohne das gibt der Wrapper seine Hoehe `
      + 'nicht an .icon-picker__results weiter, das Raster scrollt dann nicht.');
  }
});

test('Seitenmenue: der Scrollbalken ist am Desktop sichtbar (#970)', () => {
  const layout = read('../public/styles/layout.css');
  const desktop = (rule) => rule.at.some((a) => /min-width:\s*1024px/.test(a));

  let itemsRule = null;
  const versteckt = [];
  for (const rule of eachRule(layout)) {
    if (!desktop(rule)) continue;
    const sel = rule.selector.trim();
    if (sel === '.nav-sidebar__items') itemsRule = rule;
    if (!/\.nav-sidebar__items/.test(sel)) continue;
    if (/scrollbar-width:\s*none/.test(rule.body)) versteckt.push(`${sel} { scrollbar-width: none }`);
    if (/::-webkit-scrollbar\b/.test(sel) && /display:\s*none/.test(rule.body)) {
      versteckt.push(`${sel} { display: none }`);
    }
  }

  assert.ok(itemsRule,
    '.nav-sidebar__items nicht in @media (min-width: 1024px) gefunden - Guard misst nichts');
  assert.deepEqual(versteckt, [],
    `Der Balken ist am Desktop wieder versteckt: ${versteckt.join(', ')} - `
    + 'mit Maus ist er das Bedienelement, der Fade ist nur eine Andeutung (#970)');
  assert.match(itemsRule.body, /scrollbar-width:\s*thin/,
    '.nav-sidebar__items braucht am Desktop einen schmalen, sichtbaren Balken');
  assert.match(itemsRule.body, /scrollbar-color:/,
    'ohne scrollbar-color nimmt der Balken die Systemfarbe statt der Token-Farbe');
  assert.doesNotMatch(itemsRule.body, /#[0-9a-fA-F]{3,8}\b|\brgba?\(/,
    'Farbwerte kommen aus tokens.css, nicht als Literal');
});

// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------

test('router: ein AbortController je Seitenaufbau, abgebrochen vor dem naechsten render(), Signal im Kontext (#976)', () => {
  const router = withoutBlockComments(read('../public/router.js'));
  const renderPage = router.slice(router.indexOf('async function renderPage('));
  assert.ok(renderPage.length > 100, 'renderPage() nicht gefunden');
  const abortAt = renderPage.indexOf('_pageController?.abort();');
  const createAt = renderPage.indexOf('_pageController = new AbortController();');
  const renderAt = renderPage.indexOf('module.render(target, context)');
  assert.ok(abortAt > 0 && createAt > abortAt && renderAt > createAt,
    'renderPage() muss den vorigen Controller abbrechen und einen neuen anlegen, BEVOR es render() ruft');

  assert.match(renderPage, /\{ user: currentUser, signal: _pageController\.signal \}/,
    'Kern-Kontext ohne Router-Signal');
  assert.match(renderPage, /\{ user: currentUser, page: \{ \.\.\.route\.thirdPartyModule\.page \}, signal: _pageController\.signal \}/,
    'Erweiterungs-Kontext ohne Router-Signal');
});

test('dashboard: Timer und Listener haengen am Signal des eigenen Aufbaus, nicht am Modul-Feld (#976/#977)', () => {
  const dashboard = withoutBlockComments(read('../public/pages/dashboard.js'));
  assert.match(dashboard, /import \{ createPageController \} from '\/utils\/page-lifecycle\.js'/);
  const render = dashboard.slice(dashboard.indexOf('export async function render('));
  assert.match(render, /signal: routeSignal = null/, 'render() nimmt das Router-Signal aus dem Kontext');
  assert.match(render, /const controller = createPageController\(routeSignal\);/);
  assert.match(render, /const \{ signal \} = controller;/);


  assert.doesNotMatch(render, /_fabController\.signal/,
    'render() verdrahtet ueber `signal` (lokal), nicht ueber `_fabController.signal`');
  assert.match(render, /const rerender = \(\) => render\(container, \{ user, signal: routeSignal \}\);/,
    'ein Neuaufbau reicht das Router-Signal weiter, sonst ueberlebt er das Verlassen der Seite');

  // awaits, die selbst zeichnen.
  const rebuild = render.slice(render.indexOf('function rebuildDashboard(cfg) {'), render.indexOf('function rebuildDashboard(cfg) {') + 400);

  assert.match(rebuild, /function rebuildDashboard\(cfg\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(signal\.aborted\) return;/,
    'rebuildDashboard() prueft als Erstes, ob dieser Aufbau noch gilt');
  for (const fn of ['async function refreshDashboardData()', 'const doAutoRefresh = async () =>', 'const doWeatherRefresh = async () =>']) {
    const at = render.indexOf(fn);
    assert.ok(at > 0, `${fn} nicht gefunden`);
    const body = render.slice(at, at + 1200);
    assert.match(body, /await [\s\S]*?if \(signal\.aborted\) return;/, `${fn}: nach dem await fehlt die Pruefung`);
  }



  // Wetter-Auto-Refresh, Wetter-Knopf).
  assert.ok((render.match(/if \(signal\.aborted\) return;/g) ?? []).length >= 7,
    'die Pruefung steht hinter jedem await des Hauptflusses und in jedem Pfad, der selbst zeichnet');
});

const SCHLIESS_FASSADEN = ['closeDetailView'];

const ERGEBNIS_DIALOGE = ['promptModal', 'confirmModal', 'selectModal', 'confirmOverModal'];

function schliessNamen(lines) {
  const namen = new Set(['closeModal', ...SCHLIESS_FASSADEN, ...ERGEBNIS_DIALOGE]);
  const quelle = lines.join('\n');
  const block = quelle.match(/import\s*\{([\s\S]*?)\}\s*from\s*'\/components\/modal\.js'/);
  if (block) {
    for (const m of block[1].matchAll(/closeModal\s+as\s+([A-Za-z_]\w*)/g)) namen.add(m[1]);
  }

  // Aktion `closeDetailView` als `close` herein: `onClick: async ({ close }) => {
  // await close({ force: true }); await removeItem(item); }`. Unter diesem Namen


  for (const m of quelle.matchAll(/\(\s*\{([^}]*)\}\s*\)\s*=>/g)) {
    for (const p of m[1].matchAll(/\bclose\b(?:\s*:\s*([A-Za-z_]\w*))?/g)) namen.add(p[1] ?? 'close');
  }
  return namen;
}

function istSchliessen(zeile, namen) {
  for (const n of namen) if (new RegExp(`(?<![.\\w$])${n}\\s*\\(`).test(zeile)) return true;
  return false;
}

function rendererIn(lines) {
  const defs = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:export )?(?:async )?function ([A-Za-z_]\w*)/);
    if (m) defs.push({ i, name: m[1] });
  });
  const koerper = defs.map((d, k) => ({
    name: d.name,
    text: lines.slice(d.i, k + 1 < defs.length ? defs[k + 1].i : lines.length).join('\n'),
  }));
  const namen = new Set();


  for (let runde = 0; runde < 5; runde++) {
    let gewachsen = false;
    for (const { name, text } of koerper) {
      if (namen.has(name)) continue;




      if (/\breturn\s+`/.test(text)) continue;
      if (RENDER_DIREKT.test(text)
        || [...namen].some((r) => new RegExp(`\\b${r}\\s*\\(`).test(text))) {
        namen.add(name);
        gewachsen = true;
      }
    }
    if (!gewachsen) break;
  }
  for (const p of abgewarteteParameter(lines)) namen.add(p);
  return namen;
}

function abgewarteteParameter(lines) {
  const quelle = lines.join('\n');
  const params = new Set();
  for (const m of quelle.matchAll(/function\s*\w*\s*\(([^)]*)\)|\(([^()]*)\)\s*=>/g)) {
    for (const id of (m[1] ?? m[2] ?? '').matchAll(/[A-Za-z_]\w*/g)) params.add(id[0]);
  }
  return [...params].filter((p) => new RegExp(`\\bawait\\s+${p}\\s*\\(`).test(quelle));
}

const AWAIT_RUECKRUF = /\bawait\s+(\w+\.)*(on[A-Z]\w*|opts\.\w+)\s*\??\.?\(/;

function istNeuaufbau(zeile, wrapper) {
  if (RENDER_DIREKT.test(zeile)) return true;
  if (AWAIT_RUECKRUF.test(zeile)) return true;
  for (const w of wrapper) if (new RegExp(`\\b${w}\\s*\\(`).test(zeile)) return true;
  return false;
}

const RENDER_DIREKT = /\b(render[A-Z]\w*|update[A-Z]\w*List)\s*\(/;

function blockAb(lines, i, grenze = 40) {
  const tiefe = lines[i].match(/^\s*/)[0].length;
  const out = [];
  for (let j = i + 1; j < lines.length && out.length < grenze; j++) {
    if (lines[j].trim() === '') { out.push(lines[j]); continue; }
    if (lines[j].match(/^\s*/)[0].length < tiefe) break;
    out.push(lines[j]);
  }
  return out;
}

const OEFFNET_FUNKTION = /=>\s*\{\s*$|\bfunction\s*\w*\s*\(.*\)\s*\{\s*$/;

function rumpfAb(lines, i, baut, grenze = 2000) {

  // `onClick: async ({ close }) => { await close({ force: true }); await



  const einzeiler = lines[i].match(/=>\s*\{(.*)\}[\s,;)]*$/);
  if (einzeiler) return [{ x: einzeiler[1], j: i }];
  const einzug = (j) => lines[j].match(/^\s*/)[0].length;
  let tiefe = einzug(i);
  let oeffner = -1;
  for (let j = i - 1; j >= 0; j--) {
    if (lines[j].trim() === '' || einzug(j) >= tiefe) continue;
    if (OEFFNET_FUNKTION.test(lines[j])) { oeffner = j; break; }
  }
  const ende = oeffner === -1 ? -1 : einzug(oeffner);
  const out = [];

  let gebautBei = -1;
  for (let j = i + 1; j < lines.length && out.length < grenze; j++) {
    const l = lines[j];
    if (l.trim() === '') { out.push({ x: l, j }); continue; }
    const t = einzug(j);
    if (t <= ende) break;
    if (/^\s*\}/.test(l)) {
      if (t < tiefe) {

        if (gebautBei !== -1) break;



        // jeden Dialog - ein Aufruf dort griffe ins Leere.
        const davor = out.map(({ x }) => x).filter((x) => x.trim() !== '').pop() ?? lines[i];
        if (/^\s*(?:return|throw)\b/.test(davor)) break;
        tiefe = t;
      } else if (/^\s*\}\s*(?:else|catch|finally)\b/.test(l) && gebautBei > t) {




        break;
      }
    }
    out.push({ x: l, j });
    if (gebautBei === -1 && baut(l) && !inVerschachtelterFunktion(lines, i, j)) gebautBei = t;
  }
  return out;
}

test('jede Seite, die nach einem await neu rendert, zieht den Fokus nach', () => {
  const dirs = ['../public/pages', '../public/components', '../public/settings/pages'];
  const fehlend = [];
  for (const dir of dirs) {
    const basis = new URL(`${dir}/`, import.meta.url);
    for (const datei of readdirSync(basis).filter((f) => f.endsWith('.js'))) {

      const lines = withoutCommentsKeepingLines(read(`${dir}/${datei}`)).split('\n');
      fehlend.push(...fokusLuecken(datei, lines));
    }
  }
  assert.deepEqual(fehlend, [],
    'Diese Stellen rendern nach einem await erneut, ohne den Fokus nachzuziehen - '
    + 'der Focus-Restore aus closeModal() wird dort weggerendert und landet auf document.body. '
    + `Nach dem Rendern refocusAfterRender() rufen:\n  ${fehlend.join('\n  ')}`);
});

function selbstNachziehend(lines) {
  const namen = [];
  let start = -1;
  let name = null;
  lines.forEach((l, j) => {
    const m = l.match(/^(?:export )?(?:async )?function ([A-Za-z_]\w*)/);
    if (m) { start = j; name = m[1]; return; }
    if (name && !namen.includes(name) && /refocusAfterRender\s*\(/.test(l)
      && !inVerschachtelterFunktion(lines, start, j)) namen.push(name);
  });
  return namen;
}

const DEKLARATIONS_KOPF = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(/;

function fokusLuecken(datei, lines) {
  const fehlend = [];
  const wrapper = rendererIn(lines);
  const schliesst = schliessNamen(lines);



  // Schliessen selbst sonst fuer den Neuaufbau danach.
  for (const n of schliesst) wrapper.delete(n);
  const nachziehend = selbstNachziehend(lines);
  lines.forEach((zeile, i) => {





    // Wache darunter als tot gemeldet haette.


    if (!istSchliessen(zeile.replace(DEKLARATIONS_KOPF, ''), schliesst)) return;






    if (/\bsetTimeout\s*\(/.test(zeile)) return;




    //


    // `if`-Rumpf fuer einen Rueckruf: `const title = await promptModal(…);


    const fenster = rumpfAb(lines, i, (x) => istNeuaufbau(x, wrapper))
      .filter(({ j }) => !inVerschachtelterFunktion(lines, i, j))
      .map(({ x }) => x);
    let letzte = -1;
    fenster.forEach((x, k) => { if (istNeuaufbau(x, wrapper)) letzte = k; });
    if (letzte === -1) return;




    //






    const schliesstOffenen = [...schliesst].filter((n) => !ERGEBNIS_DIALOGE.includes(n));
    if (fenster.slice(letzte + 1).some((x) => istSchliessen(x, schliesstOffenen))) return;

    if (!fenster.slice(0, letzte + 1).some((x) => /\bawait\b/.test(x))) return;




    if (fenster.some((x) => /refocusAfterRender\s*\(/.test(x))) return;

    // removeItem(item)` in inventory.js, siehe selbstNachziehend() (#1083).
    if (nachziehend.some((n) => new RegExp(`(?<![.\\w$])${n}\\s*\\(`).test(fenster[letzte]))) return;
    fehlend.push(`${datei}:${i + 1} (${fenster[letzte].trim().slice(0, 48)})`);
  });
  return fehlend;
}

function inVerschachtelterFunktion(lines, start, zeile) {
  const tiefe = lines[zeile].match(/^\s*/)[0].length;
  for (let j = zeile - 1; j > start; j--) {
    const l = lines[j];
    if (l.trim() === '') continue;
    const t = l.match(/^\s*/)[0].length;
    if (t >= tiefe) continue;

    if (OEFFNET_FUNKTION.test(l)) return true;

    // weitersuchen, aber ab jetzt auf ihrer Ebene.
  }
  return false;
}

test('ein Handler, der bei offenem Dialog asynchron rendert, zieht den Fokus nach', () => {
  const fehlend = [];
  for (const dir of ['../public/pages', '../public/components', '../public/settings/pages']) {
    const basis = new URL(`${dir}/`, import.meta.url);
    for (const datei of readdirSync(basis).filter((f) => f.endsWith('.js'))) {
      const lines = withoutCommentsKeepingLines(read(`${dir}/${datei}`)).split('\n');
      const wrapper = rendererIn(lines);
      const starts = [];
      lines.forEach((l, i) => { if (/^(?:export )?(?:async )?function [A-Za-z_]/.test(l)) starts.push(i); });
      starts.forEach((s, k) => {
        const e = k + 1 < starts.length ? starts[k + 1] : lines.length;

        if (!lines.slice(s, e).some((l) => /open(Shared)?Modal\s*\(\s*\{/.test(l))) return;
        for (let j = s; j < e; j++) {
          if (!/\bawait\s+(load|refresh)[A-Z]\w*\s*\(/.test(lines[j])) continue;

          //





          //
          //   const onChanged = async () => { await loadX(); renderY(); };
          //   openSharedModal({ … onChanged … });
          //




          //



          if (!inVerschachtelterFunktion(lines, s, j)) continue;
          const fenster = blockAb(lines, j);
          if (!fenster.some((x) => istNeuaufbau(x, wrapper))) continue;

          if (fenster.some((x) => istSchliessen(x, schliessNamen(lines)))) continue;
          if (fenster.some((x) => /refocusAfterRender\s*\(/.test(x))) continue;
          fehlend.push(`${datei}:${j + 1} (${lines[j].trim().slice(0, 44)})`);
        }
      });
    }
  }
  assert.deepEqual(fehlend, [],
    'Diese Handler rendern asynchron, waehrend ihr Dialog noch offen sein kann. Schliesst der '
    + 'Nutzer waehrenddessen, trifft der Focus-Restore den noch verbundenen Ausloeser und das '
    + 'Rendern danach haengt ihn ab - der Fokus faellt auf document.body. '
    + `Nach dem Rendern refocusAfterRender() rufen:\n  ${fehlend.join('\n  ')}`);
});


test('refocusAfterRender steht nach dem LETZTEN Neuaufbau im Block', () => {
  const zuFrueh = [];
  for (const dir of ['../public/pages', '../public/components', '../public/settings/pages']) {
    const basis = new URL(`${dir}/`, import.meta.url);
    for (const datei of readdirSync(basis).filter((f) => f.endsWith('.js'))) {
      const lines = withoutCommentsKeepingLines(read(`${dir}/${datei}`)).split('\n');
      const wrapper = rendererIn(lines);
      lines.forEach((zeile, i) => {
        if (!/^\s*refocusAfterRender\(\);\s*$/.test(zeile)) return;

        const tiefe = zeile.match(/^\s*/)[0].length;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === '') continue;
          if (lines[j].match(/^\s*/)[0].length < tiefe) break;


          // dieses Weges (Fehlalarm an budget-plans.js gemessen).
          if (lines[j].match(/^\s*/)[0].length > tiefe) continue;
          if (!/\bawait\b/.test(lines[j])) continue;

          // ein erkannter Neuaufbau.
          if (/\bawait\s+\w*(opts|options)\.\w+\?\.\(/.test(lines[j]) || istNeuaufbau(lines[j], wrapper)) {
            zuFrueh.push(`${datei}:${i + 1} (danach: ${lines[j].trim().slice(0, 40)})`);
            break;
          }
        }
      });
    }
  }
  assert.deepEqual(zuFrueh, [],
    'Diese Aufrufe stehen VOR einem await, das die Seite noch einmal umbaut - der Fokus, den sie '
    + 'setzen, ist danach wieder weg. Den Aufruf ans Ende des Blocks ziehen:\n  '
    + zuFrueh.join('\n  '));
});


test('jede exportierte close-Fassade steht in SCHLIESS_FASSADEN', () => {
  const fehlend = [];
  for (const dir of ['../public/components', '../public/utils']) {
    const basis = new URL(`${dir}/`, import.meta.url);
    for (const datei of readdirSync(basis).filter((f) => f.endsWith('.js'))) {
      const lines = withoutCommentsKeepingLines(read(`${dir}/${datei}`)).split('\n');
      const grenzen = [];
      lines.forEach((l, i) => { if (/^(?:export )?(?:async )?function [A-Za-z_]/.test(l)) grenzen.push(i); });
      lines.forEach((l, i) => {
        const m = l.match(/^export (?:async )?function (close[A-Za-z_]\w*)/);
        if (!m || m[1] === 'closeModal') return;
        const ende = grenzen.find((x) => x > i) ?? lines.length;
        if (!/\bcloseModal\s*\(/.test(lines.slice(i, ende).join('\n'))) return;
        if (SCHLIESS_FASSADEN.includes(m[1])) return;
        fehlend.push(`${datei}: ${m[1]}`);
      });
    }
  }
  assert.deepEqual(fehlend, [],
    'Diese exportierten Funktionen schliessen den Dialog, stehen aber nicht in SCHLIESS_FASSADEN - '
    + 'die Focus-Guards sehen ihren Schliess-und-Rendern-Weg deshalb nicht:\n  ' + fehlend.join('\n  '));
});


test('kein refocusAfterRender ohne ein Schliessen, auf das es sich beziehen kann', () => {
  const tot = [];
  for (const dir of ['../public/pages', '../public/components', '../public/settings/pages']) {
    const basis = new URL(`${dir}/`, import.meta.url);
    for (const datei of readdirSync(basis).filter((f) => f.endsWith('.js'))) {
      const lines = withoutCommentsKeepingLines(read(`${dir}/${datei}`)).split('\n');
      const schliesst = schliessNamen(lines);
      const grenzen = [];
      lines.forEach((l, i) => { if (/^(?:export )?(?:async )?function [A-Za-z_]/.test(l)) grenzen.push(i); });
      lines.forEach((zeile, i) => {
        if (!/^\s*refocusAfterRender\(\);\s*$/.test(zeile)) return;
        const start = [...grenzen].reverse().find((g) => g <= i) ?? 0;
        const ende = grenzen.find((g) => g > i) ?? lines.length;
        const funktion = lines.slice(start, ende);


        const tiefe = zeile.match(/^\s*/)[0].length;
        for (let j = i + 1; j < ende; j++) {
          if (lines[j].trim() === '') continue;
          if (lines[j].match(/^\s*/)[0].length < tiefe) break;
          if (lines[j].match(/^\s*/)[0].length > tiefe) continue;
          if (istSchliessen(lines[j], schliesst)) {
            tot.push(`${datei}:${i + 1} - steht VOR dem Schliessen in Zeile ${j + 1}`);
            return;
          }
        }





        let schliessZeile = -1;
        for (let j = i - 1; j >= start; j--) {
          if (!istSchliessen(lines[j], schliesst)) continue;
          // Ein VERZOEGERTES Schliessen traegt keinen Aufruf: `setTimeout(() =>



          if (/\bsetTimeout\s*\(/.test(lines[j])) {
            tot.push(`${datei}:${i + 1} - das Schliessen in Zeile ${j + 1} ist verzoegert, der Merker existiert hier noch nicht`);
            return;
          }
          schliessZeile = j;
          break;
        }
        if (schliessZeile !== -1) {
          const dazwischen = lines.slice(schliessZeile + 1, i);
          if (!dazwischen.some((x) => istNeuaufbau(x, rendererIn(lines)))) {
            tot.push(`${datei}:${i + 1} - zwischen dem Schliessen und dem Aufruf wird nichts neu gebaut`);
            return;
          }
        }

        const beteiligt = funktion.some((x) => istSchliessen(x, schliesst) || /open(Shared)?Modal\s*\(/.test(x));
        if (!beteiligt) tot.push(`${datei}:${i + 1} - die Funktion oeffnet und schliesst keinen Dialog`);
      });
    }
  }
  assert.deepEqual(tot, [],
    'Diese Aufrufe koennen nichts bewirken - refocusAfterRender() braucht ein vorangegangenes '
    + `Schliessen, sonst ist der Merker leer und das Overlay noch offen:\n  ${tot.join('\n  ')}`);
});


test('rendererIn erkennt exportierte Funktionen als Grenze', () => {



  const quelle = [
    'function harmlos() {',
    '  const x = 1;',
    '}',
    'export async function render(container) {',
    '  renderListe();',
    '}',
  ];
  const namen = rendererIn(quelle);
  assert.ok(namen.has('render'), '`export async function render` muss als eigene Funktion erkannt werden');
  assert.ok(!namen.has('harmlos'),
    'ohne das export-Praefix in der Grenze faellt der Rumpf von `render` in den Block davor, '
    + 'und `harmlos` gilt als Renderer, obwohl sie nichts rendert');
});


test('withoutCommentsKeepingLines laesst Regex-Literale und URLs heil', () => {
  const mitRegex = String.raw`if (/^https?:\/\//i.test(u)) refocusAfterRender();`;
  assert.equal(withoutCommentsKeepingLines(mitRegex), mitRegex,
    'ein Regex-Literal mit Schraegstrichen darf die Zeile nicht abschneiden - sonst wird alles '
    + 'dahinter fuer die Ratchets unsichtbar');

  const mitUrl = "const u = 'http://x'; renderAll();";
  assert.equal(withoutCommentsKeepingLines(mitUrl), mitUrl, 'eine URL ist kein Kommentar');

  assert.equal(withoutCommentsKeepingLines('renderAll(); // weg').trim(), 'renderAll();',
    'ein echter Zeilenkommentar muss weiter fallen');
});

test('wer refocusAfterRender importiert, ruft es auch', () => {
  const tot = [];
  for (const dir of ['../public/pages', '../public/components', '../public/settings/pages']) {
    const basis = new URL(`${dir}/`, import.meta.url);
    for (const datei of readdirSync(basis).filter((f) => f.endsWith('.js'))) {
      const src = withoutCommentsKeepingLines(read(`${dir}/${datei}`));
      const importiert = /import\s*\{[^}]*\brefocusAfterRender\b[^}]*\}\s*from\s*'\/components\/modal\.js'/.test(src);
      if (!importiert) continue;
      if (/refocusAfterRender\s*\(/.test(src)) continue;
      tot.push(datei);
    }
  }
  assert.deepEqual(tot, [],
    `Diese Dateien importieren refocusAfterRender, ohne es zu rufen:\n  ${tot.join('\n  ')}`);
});


test('rumpfAb liest bis zum Neuaufbau auf demselben Weg (#1083)', () => {
  const baut = (x) => /\brender[A-Z]\w*\s*\(|\bawait\s+load[A-Z]\w*\s*\(/.test(x);
  const zeilen = (quelle, anker) => {
    const i = quelle.findIndex((l) => l.includes(anker));
    assert.ok(i !== -1, `Anker ${anker} fehlt in der Probe`);
    return rumpfAb(quelle, i, baut)
      .filter(({ j }) => !inVerschachtelterFunktion(quelle, i, j))
      .map(({ x }) => x.trim());
  };


  const imTry = zeilen([
    'async function umbenennen(id) {',
    '  const titel = await promptModal(label);',
    '  if (!titel) return;',
    '  try {',
    '    await api.put(url, { titel });',
    '    await loadTasks(container);',
    '  } catch (err) {',
    '    renderFehler(err);',
    '  }',
    '}',
  ], 'promptModal');
  assert.ok(imTry.includes('await loadTasks(container);'), 'ein try-Rumpf ist kein Rueckruf');
  assert.ok(!imTry.includes('renderFehler(err);'), 'der catch-Zweig gehoert nicht zum Weg nach dem Speichern');


  const nachDemIf = zeilen([
    'async function entscheiden(action) {',
    '  if (action === "reject") {',
    '    const ok = await confirmModal(frage);',
    '    if (!ok) return;',
    '  }',
    '  try {',
    '    await api.patch(url, { action });',
    '    renderTab();',
    '  } catch (err) {',
    '    zeige(err);',
    '  }',
    '}',
  ], 'confirmModal');
  assert.ok(nachDemIf.includes('renderTab();'), 'nach dem if geht derselbe Weg weiter');


  const geschwister = zeilen([
    'function verdrahten() {',
    '  root.addEventListener("click", async () => {',
    '    if (action === "rename") {',
    '      const name = await promptModal(label);',
    '      if (!name) return;',
    '      renderTabs(container);',
    '    }',
    '    if (action === "delete") {',
    '      renderLeer(container);',
    '    }',
    '  });',
    '}',
  ], 'promptModal');
  assert.ok(geschwister.includes('renderTabs(container);'));
  assert.ok(!geschwister.includes('renderLeer(container);'), 'der Loeschen-Zweig gehoert nicht zum Umbenennen');


  const mitReturn = zeilen([
    'async function aktion(action) {',
    '  if (action === "push") {',
    '    const konto = await selectModal(label, optionen);',
    '    if (!konto) return;',
    '    await api.post(url, { konto });',
    '    return;',
    '  }',
    '  if (action === "delete") renderListe();',
    '}',
  ], 'selectModal');
  assert.ok(!mitReturn.includes('if (action === "delete") renderListe();'), 'nach return endet der Weg');


  const elseDanach = zeilen([
    'async function speichern() {',
    '  if (serie) {',
    '    closeModal({ force: true });',
    '    const scope = await frageScope();',
    '    if (scope === "series") {',
    '      await api.put(serienUrl, body);',
    '    } else {',
    '      await api.put(url, body);',
    '    }',
    '    await loadMonth(monat);',
    '    renderBody();',
    '    refocusAfterRender();',
    '  } else {',
    '    renderAnders();',
    '  }',
    '}',
  ], 'closeModal');
  assert.ok(elseDanach.includes('refocusAfterRender();'), 'das else der Scope-Frage ist keine Grenze');
  assert.ok(!elseDanach.includes('renderAnders();'), 'das else des aeusseren if schon');


  const rueckruf = zeilen([
    'async function loeschen() {',
    '  if (!await confirmModal(frage)) return;',
    '  zeigeToast({',
    '    undo: async () => {',
    '      renderUndo();',
    '    },',
    '  });',
    '}',
  ], 'confirmModal');
  assert.ok(!rueckruf.includes('renderUndo();'), 'der Undo-Rueckruf ist ein anderer Weg');
});

test('Ergebnis-Dialoge zaehlen als Schliessen, abgewartete Parameter als Neuaufbau (#1083)', () => {
  const namen = schliessNamen(['import { promptModal } from \'/components/modal.js\';']);
  for (const n of ['promptModal', 'confirmModal', 'selectModal', 'confirmOverModal']) {
    assert.ok(namen.has(n), `${n} schliesst den Dialog, bevor es aufloest`);
  }
  assert.ok(istSchliessen('  if (!await confirmModal(frage)) return;', namen));

  const quelle = [
    'function renderKonto(container, konto, refresh) {',
    '  knopf.addEventListener("click", async () => {',
    '    closeModal({ force: true });',
    '    await refresh();',
    '  });',
    '}',
    'function speichern(save) {',
    '  return save;',
    '}',
  ];
  const param = abgewarteteParameter(quelle);
  assert.ok(param.includes('refresh'), 'ein abgewarteter Parameter baut Unbekanntes um');
  assert.ok(!param.includes('save'), 'ein Parameter, der nie abgewartet aufgerufen wird, zaehlt nicht');
  assert.ok(istNeuaufbau('    await refresh();', rendererIn(quelle)));
});

test('Fokus-Guard: close-Parameter, Einzeiler, Signaturen, Dialog nach dem Neuaufbau, Wrapper (Review zu #1123)', () => {
  const stellen = (datei, quelle) => fokusLuecken(datei, quelle).map((s) => s.split(' ')[0]);


  const detail = [
    'function oeffne(item) {',
    '  openDetailView({',
    '    actions: [{',
    '      onClick: async ({ close }) => {',
    '        await close({ force: true });',
    '        await api.delete(url);',
    '        renderListe();',
    '      },',
    '    }],',
    '  });',
    '}',
  ];
  assert.deepEqual(stellen('detail.js', detail), ['detail.js:5'], 'das close einer Aktion ist ein Schliessen');
  const methode = detail.map((l) => l.replace('await close({ force: true });', 'dialog.close();'));
  assert.deepEqual(stellen('detail.js', methode), [], 'dialog.close() ist keines');


  const einzeiler = [
    'function oeffne(ev) {',
    '  const actions = [{',
    '    onClick: async ({ close }) => { await close({ force: true }); await weg(ev); },',
    '  }];',
    '  if (spaeter) await nachladen();',
    '  renderDetail();',
    '}',
  ];
  assert.deepEqual(stellen('einzeiler.js', einzeiler), [],
    'renderDetail() unter der Aktion loest der Knopf nie aus');


  const signatur = [
    'function vorher() {',
    '  knopf.addEventListener("click", async () => {',
    '    tu();',
    '  });',
    '}',
    'export async function render(container, { user } = {}) {',
    '  if (user) {',
    '    closeModal();',
    '    await api.put(url);',
    '  }',
    '  await laden();',
    '  renderSeite();',
    '}',
  ];
  assert.deepEqual(stellen('signatur.js', signatur), ['signatur.js:8'],
    'das Fenster liest bis zum Neuaufbau nach dem if, nicht bis zum Rueckruf der Funktion davor');
  for (const zeile of [
    'export async function render(container, { user } = {}) {',
    'async function addSubtask(parentId, { onChanged = () => {} } = {}) {',
    '  el.addEventListener("click", async function (event) {',
    '  const x = async () => {',
  ]) assert.ok(OEFFNET_FUNKTION.test(zeile), `oeffnet eine Funktion: ${zeile}`);
  assert.ok(!OEFFNET_FUNKTION.test("  if (typeof cb === 'function') {"), 'ein typeof-Vergleich oeffnet keine');


  const danach = [
    'async function loeschen() {',
    '  closeModal({ force: true });',
    '  await api.delete(url);',
    '  renderListe();',
    '  if (await confirmModal(frage)) tuNochWas();',
    '}',
  ];
  assert.deepEqual(stellen('danach.js', danach), ['danach.js:2'], 'confirmModal danach findet den Knopf nicht wieder');
  const offen = danach.map((l) => l.replace('if (await confirmModal(frage)) tuNochWas();', 'closeModal();'));
  assert.deepEqual(stellen('danach.js', offen), [], 'ein Dialog, der schon offen war, setzt den Fokus beim Schliessen selbst');




  const deklaration = [
    'export function confirmModal(frage) {',
    '  return new Promise((resolve) => {',
    '    resolve(true);',
    '  });',
    '}',
    'async function beenden(',
    '  bestaetigt,',
    '  { close = closeModal } = {},',
    ') {',
    '  if (bestaetigt) await close({ force: true });',
    '  return bestaetigt;',
    '}',
  ];
  assert.deepEqual(stellen('deklaration.js', deklaration), [],
    'die Signatur von confirmModal ist kein Anker');
  const standard = deklaration.map((l, k) => (k === 0 ? 'export default function confirmModal(frage) {' : l));
  assert.deepEqual(stellen('standard.js', standard), [],
    'auch nicht als Default-Export (Codex-Review zu #1131)');
  const gleichzeile = [
    'async function speichern() { closeModal({ force: true });',
    '  await api.put(url);',
    '  renderListe();',
    '}',
  ];
  assert.deepEqual(stellen('gleichzeile.js', gleichzeile), ['gleichzeile.js:1'],
    'ein Schliessen hinter dem Kopf in derselben Zeile bleibt ein Anker');


  const wrapper = [
    'async function entfernen(item) {',
    '  if (!await confirmModal(frage)) return;',
    '  await api.delete(url);',
    '  renderListe();',
    '  refocusAfterRender();',
    '}',
    'function oeffne(item) {',
    '  openDetailView({ actions: [{',
    '    onClick: async ({ close }) => {',
    '      await close({ force: true });',
    '      await entfernen(item);',
    '    },',
    '  }] });',
    '}',
  ];
  assert.deepEqual(stellen('wrapper.js', wrapper), [], 'entfernen() zieht selbst nach');
  const imUndo = [
    ...wrapper.slice(0, 4),
    '  zeigeToast({',
    '    undo: () => {',
    '      refocusAfterRender();',
    '    },',
    '  });',
    ...wrapper.slice(5),
  ];
  assert.deepEqual(stellen('wrapper.js', imUndo), ['wrapper.js:2', 'wrapper.js:14'],
    'ein Aufruf im Undo-Rueckruf deckt weder den Wrapper noch seinen Aufrufer');
});

test('inVerschachtelterFunktion trennt Rueckruf von Dialogvorbereitung', () => {
  const imRueckruf = [
    'function openManager() {',
    '  const onChanged = async () => {',
    '    await loadMeta();',
    '  };',
    '  openSharedModal({ onChanged });',
    '}',
  ];
  assert.equal(inVerschachtelterFunktion(imRueckruf, 0, 2), true,
    'ein `await` im Rueckruf ist eine Auffrischung - genau die Bauart, die der Ratchet halten muss');

  const vorbereitung = [
    'async function openEditor(member) {',
    '  const ids = await loadIds(member.id);',
    '  openModal({ content: ids });',
    '}',
  ];
  assert.equal(inVerschachtelterFunktion(vorbereitung, 0, 1), false,
    'ein `await` auf der Ebene der oeffnenden Funktion bestueckt den Dialog und baut nichts neu auf');


  const imTry = [
    'async function speichern() {',
    '  try {',
    '    await loadMeta();',
    '  } catch (err) {}',
    '  openModal({});',
    '}',
  ];
  assert.equal(inVerschachtelterFunktion(imTry, 0, 2), false,
    'ein try-Block oeffnet keinen Rueckruf');
});
