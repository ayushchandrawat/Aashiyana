import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { withoutHtmlComments } from './source-text.js';
import { eachRule } from './css-rules.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r/g, '');

const budget = read('../public/pages/budget.js');
const stats = read('../public/pages/budget-stats.js');
const plans = read('../public/pages/budget-plans.js');
const subscriptions = read('../public/pages/subscriptions.js');
const splitExpenses = read('../public/pages/split-expenses.js');
const housekeeping = read('../public/pages/housekeeping.js');
const money = read('../public/utils/money.js');
const layoutCss = read('../public/styles/layout.css');
const tokensCss = read('../public/styles/tokens.css');
const budgetCss = read('../public/styles/budget.css');
// Die geteilten Auswertungs-Bauteile (.panel-head, .segmented, .metric-grid,



const panelCss = read('../public/styles/panel.css');
const subscriptionsCss = read('../public/styles/subscriptions.css');
const splitCss = read('../public/styles/split-expenses.css');

// --------------------------------------------------------
// Monatsnavigation und Neu-Aktion je Untertab
// --------------------------------------------------------

test('TAB_CAPS ist die einzige Quelle für Monatsnavigation und Neu-Aktion', () => {
  const table = budget.match(/const TAB_CAPS = \{[\s\S]*?\n\};/);
  assert.ok(table, 'TAB_CAPS-Tabelle fehlt');



  for (const id of ['budget', 'accounts', 'plan', 'subscriptions', 'loans', 'reports', 'split-expenses']) {
    assert.match(table[0], new RegExp(`'${id}':`), `TAB_CAPS ohne Eintrag für '${id}'`);
  }



  for (const id of ['budget', 'plan', 'reports']) {
    assert.match(table[0], new RegExp(`'${id}':\\s*\\{ month: true`), `'${id}' braucht den Kopf-Stepper`);
  }
  for (const id of ['accounts', 'subscriptions', 'loans', 'split-expenses']) {
    assert.match(table[0], new RegExp(`'${id}':\\s*\\{ month: false`), `'${id}' darf keine Monatsnavigation zeigen`);
  }

  // Berichte kennt keine Neu-Aktion — dort bleiben Toolbar-Button und FAB weg.
  assert.match(table[0], /'reports':\s*\{ month: true,\s*range: true,\s*add: null/);
});

test('der Kopf-Slot bleibt auf jedem Tab besetzt', () => {


  const table = budget.match(/const TAB_CAPS = \{[\s\S]*?\n\};/);
  for (const entry of table[0].matchAll(/'([a-z-]+)':\s*\{([^}]*)\}/g)) {
    const [, id, caps] = entry;
    if (/month:\s*true/.test(caps)) continue;
    assert.match(caps, /note:\s*'budget\.periodNote/, `'${id}' hat weder Stepper noch Kontexttext`);
  }

  assert.match(budget, /note\.hidden = !caps\.note/);
  assert.match(budget, /note\.textContent = t\(caps\.note\)/);
});

test('Monats-Bedienelemente werden als Block geschaltet, nicht einzeln', () => {

  const block = budget.match(/\['#budget-prev', '#budget-next', '#budget-today', '#budget-label'\][\s\S]{0,220}/);
  assert.ok(block, 'Monats-Bedienelemente werden nicht gemeinsam geschaltet');
  assert.match(block[0], /el\.hidden = !caps\.month/);
});

test('das Modul führt genau eine Zeitachse', () => {






  assert.match(budget, /reportAnchor:\s*todayKey\(\)/);
  assert.match(budget, /state\.reportAnchor = anchorForMonth\(state\.month\)/, 'Hinweg Budget → Berichte fehlt');
  assert.match(budget, /const ym = state\.reportAnchor\.slice\(0, 7\)/, 'Rückweg Berichte → Budget fehlt');


  assert.doesNotMatch(stats, /data-step=/, 'budget-stats.js baut wieder einen zweiten Stepper');
  assert.doesNotMatch(stats, /budget-stats__period/, 'der Zeitraum gehört in den geteilten Kopf');
  assert.match(stats, /view\.anchor = ctx\.anchor/, 'der Anker muss vom Modul kommen');
  assert.match(stats, /view\.ctx\.onRangeChange\(id\)/, 'die Auflösung muss ans Modul zurückgemeldet werden');
});

test('Toolbar-Aktion und FAB teilen sich Sichtbarkeit und Label', () => {
  assert.match(budget, /const addLabel = caps\.add \? t\(caps\.add\) : ''/);
  assert.match(budget, /addBtn\.hidden = !caps\.add/);
  assert.match(budget, /fab\.hidden = !caps\.add/);

  assert.doesNotMatch(budget, /splitActive \|\| subscriptionsActive/);
});

test('hidden greift bei geteilten Bedienelementen trotz display-Klasse', () => {
  // `.page-fab { display:flex }` bzw. `.btn { display:inline-flex }` schlagen


  // `.form-group` ab (RRULE-Endefelder, Audit A1-10).
  //






  const sameBlock = (selector) => new RegExp(`${selector}[^{}]*\\{\\s*display:\\s*none\\s*!important`);




  for (const selector of ['\\.page-fab\\[hidden\\]', '\\.btn\\[hidden\\]', '\\.form-group\\[hidden\\]']) {
    assert.match(layoutCss, sameBlock(selector), `${selector} steht nicht im Durchsetzungsblock`);
  }
});

// --------------------------------------------------------

// --------------------------------------------------------

test('neue Einträge landen im angezeigten Monat, nicht im heutigen', () => {

  // verlangte die Zeile buchstabengetreu





  assert.match(budget, /defaultDateInPeriod/,
    'das Standarddatum kommt nicht mehr aus defaultDateInPeriod() (utils/date.js)');
  assert.match(budget, /monthPeriodKeys\(state\.month\)/,
    'der Zeitraum ist nicht mehr der angezeigte Monat');
  assert.match(budget, /const defaultDate = defaultDateInPeriod\(/,
    'defaultDate wird nicht mehr aus der Regel abgeleitet');

  assert.match(budget, /id="bm-date"\s*\n?\s*value="\$\{isEdit \? entry\.date : defaultDate\}"/);
  assert.doesNotMatch(budget, /id="bm-date"[\s\S]{0,80}entry\.date : today\}/);
});

// --------------------------------------------------------
// Tab-Leisten und Filter-ARIA
// --------------------------------------------------------

test('keine Umschalter-Leiste im Modul versteckt sich hinter role="group"', () => {





  //



  // automatisch im Guard darunter.
  for (const [file, src] of BUDGET_PAGES) {
    for (const bar of withoutComments(src).matchAll(/role="group"[\s\S]{0,900}?<\/div>/g)) {
      assert.doesNotMatch(
        bar[0],
        /aria-selected=|aria-pressed=|aria-checked=/,
        `${file}: eine Leiste mit role="group" meldet einen Auswahlzustand - `
        + 'role="tablist" (Sicht) oder role="radiogroup" (Wert) benennt das richtig',
      );
    }
  }
});

test('jede Umschalter-Leiste des Moduls läuft durch die geteilte Verhaltensschicht', () => {



  const wired = BUDGET_PAGES.flatMap(([, src]) =>
    [...src.matchAll(/wireTablist\(\s*[^)]*?querySelector\('([^']+)'\)/g)].map((m) => m[1]));

  for (const [file, src] of BUDGET_PAGES) {
    for (const bar of src.matchAll(/<div class="([^"]+)"([^>]*)role="(tablist|radiogroup)"/g)) {
      const [, classes, attrs] = bar;
      const id = attrs.match(/id="([^"]+)"/)?.[1];
      const selectors = [...classes.trim().split(/\s+/).map((c) => `.${c}`), ...(id ? [`#${id}`] : [])];
      assert.ok(
        selectors.some((s) => wired.includes(s)),
        `${file}: Leiste "${classes}" ist an keinem wireTablist verdrahtet (${selectors.join(' / ')})`,
      );
    }
  }

  assert.doesNotMatch(budget, /data-scope=/);
});

test('es gibt genau eine Umschalter-Optik im Modul', () => {



  assert.ok(/\n\.segmented\s*\{/.test(panelCss), '.segmented fehlt in panel.css');
  assert.ok(/\n\.segmented__item\s*\{/.test(panelCss), '.segmented__item fehlt');

  for (const [file, src] of BUDGET_PAGES) {
    for (const bar of src.matchAll(/<div class="([^"]+)"([^>]*)role="(tablist|radiogroup)"/g)) {
      const [, classes] = bar;


      if (/budget-tabs|budget-scope|budget-color-picker/.test(classes)) continue;
      assert.match(
        classes,
        /segmented/,
        `${file}: Leiste "${classes}" baut eine eigene Optik statt .segmented`,
      );
    }
  }


  const liveCss = withoutComments(budgetCss);
  for (const dead of ['budget-loans__filter\\b', 'budget-stats__range\\b']) {
    assert.doesNotMatch(liveCss, new RegExp(`\\.${dead}`), `.${dead} ist durch .segmented ersetzt`);
  }
});

test('das Touch-Maß der Umschalter kommt aus dem Token, nicht aus der Leiste', () => {

  const item = panelCss.match(/\n\.segmented__item\s*\{([^}]*)\}/);
  assert.ok(item, '.segmented__item fehlt');
  assert.match(item[1], /min-height:\s*var\(--target-base\)/);
});

test('Auflösungs-Umschalter der Berichte trägt echtes Tab-ARIA', () => {
  const bar = stats.match(/class="[^"]*budget-stats__ranges"[\s\S]*?<\/div>/);
  assert.ok(bar, 'Auflösungs-Leiste nicht gefunden');
  assert.match(bar[0], /role="tablist"/);
  assert.match(bar[0], /aria-label=/);
  assert.match(stats, /role="tab"[\s\S]{0,140}aria-selected="\$\{on\}"/);
  assert.match(stats, /tabindex="\$\{on \? '0' : '-1'\}"/);
});

test('Einfachauswahl-Leisten melden ihren Zustand über aria-checked', () => {




  assert.match(budget, /role="radio" data-tab-id="\$\{id\}" aria-checked="\$\{on\}"/, 'Darlehensstatus');
  assert.match(splitExpenses, /role="radio" data-tab-id="\$\{id\}" aria-checked="\$\{on\}"/, 'Gruppenstatus');
  assert.match(budget, /role="radio"[\s\S]{0,200}aria-checked="\$\{on\}"/, 'Kontofarbe');

  assert.match(budget, /data-action="loan-filter"[\s\S]{0,160}aria-pressed=/);
});

// --------------------------------------------------------
// Charts: Textalternative, Palette, Achsen
// --------------------------------------------------------

test('Trendkurve und Donut haben eine Textalternative mit Werten', () => {


  assert.match(budget, /class="sr-only">\$\{esc\(chartSummary/);
  assert.match(stats, /statsTrendSummary/);
  assert.match(stats, /statsDonutSummary/);
  assert.match(stats, /<p class="sr-only">\$\{view\.ctx\.esc\(summary\)\}<\/p>/);

  assert.match(stats, /class="budget-stats__trend"[\s\S]{0,120}aria-hidden="true"/);
  assert.match(stats, /class="budget-stats__donut" aria-hidden="true"/);
});

test('Donut-Palette wiederholt keine Farbe und borgt keine Modul-Akzente', () => {
  const palette = stats.match(/const DONUT_COLORS = \[[\s\S]*?\];/);
  assert.ok(palette, 'DONUT_COLORS fehlt');
  assert.doesNotMatch(palette[0], /--module-/, 'Modul-Akzente tragen eine andere Bedeutung');
  const colors = [...palette[0].matchAll(/--chart-series-\d/g)].map((m) => m[0]);
  assert.equal(new Set(colors).size, colors.length, 'doppelte Farbe in der Palette');

  assert.match(stats, /const DONUT_SEGMENTS = DONUT_COLORS\.length/);
  assert.match(stats, /statsOtherCategories/);
  assert.match(stats, /stroke="\$\{DONUT_COLORS\[i\]\}"/, 'kein Modulo-Recycling mehr');
});

test('die Datenreihen-Tokens existieren in beiden Themes', () => {
  for (let i = 1; i <= 7; i++) {
    assert.match(tokensCss, new RegExp(`--chart-series-${i}:\\s*var\\(--_chart-series-${i}\\)`));
  }

  const defs = [...tokensCss.matchAll(/--_chart-series-1:/g)];
  assert.equal(defs.length, 3, 'Dark-Mode-Variante fehlt in einem der beiden Dark-Blöcke');
});

test('keine Datenreihe deckt sich mit dem Modulton einer Seite, die Diagramme zeigt', () => {


  const pagesDir = new URL('../public/pages/', import.meta.url);
  const users = readdirSync(pagesDir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => read(`../public/pages/${f}`).includes('--chart-series-'));
  assert.ok(
    users.length >= 2,
    `Nur ${users.length} Seite(n) beziehen
    + 'Ein Guard über eine leere Menge sichert nichts zu.',
  );


  const router = read('../public/router.js');
  const moduleOf = new Map();
  for (const m of router.matchAll(/page:\s*'\/pages\/([^']+)'[^}]*?module:\s*'([^']+)'/g)) {
    moduleOf.set(m[1], m[2]);
  }
  const modules = [...new Set(users.map((f) => moduleOf.get(f)).filter(Boolean))];
  assert.ok(
    modules.length >= 1,
    `Keine der Chart-Seiten (${users.join(', ')}) fand ein Modul in router.js - der Guard misst dann nichts.`,
  );



  const familyOf = new Map();
  for (const m of tokensCss.matchAll(/--module-([\w-]+):\s*var\(--_family-([\w-]+)\)/g)) {
    familyOf.set(m[1], m[2]);
  }
  const valuesOf = (token) => [...tokensCss.matchAll(new RegExp(`${token}:\\s*(#[\\da-fA-F]{6})`, 'g'))].map((x) => x[1]);



  const JND = 2.3;
  const lab = (value) => {
    const [r, g, b] = value.match(/[\da-f]{2}/gi)
      .map((p) => parseInt(p, 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const deltaE = (one, two) => {
    const [L1, a1, b1] = lab(one);
    const [L2, a2, b2] = lab(two);
    const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
    const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
    const [A1, A2] = [a1 * (1 + g), a2 * (1 + g)];
    const [C1, C2] = [Math.hypot(A1, b1), Math.hypot(A2, b2)];
    const angle = (x, y) => (x === 0 && y === 0 ? 0 : ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
    const [h1, h2] = [angle(A1, b1), angle(A2, b2)];
    const dL = L2 - L1;
    const dC = C2 - C1;
    let dh = 0;
    if (C1 * C2 !== 0) {
      dh = h2 - h1;
      if (dh > 180) dh -= 360;
      else if (dh < -180) dh += 360;
    }
    const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh * Math.PI) / 360);
    const lBar = (L1 + L2) / 2;
    const cBarP = (C1 + C2) / 2;
    let hBar = h1 + h2;
    if (C1 * C2 !== 0 && Math.abs(h1 - h2) > 180) hBar += hBar < 360 ? 360 : -360;
    if (C1 * C2 !== 0) hBar /= 2;
    const rad = (deg) => (deg * Math.PI) / 180;
    const T = 1 - 0.17 * Math.cos(rad(hBar - 30)) + 0.24 * Math.cos(rad(2 * hBar))
      + 0.32 * Math.cos(rad(3 * hBar + 6)) - 0.20 * Math.cos(rad(4 * hBar - 63));
    const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
    const sC = 1 + 0.045 * cBarP;
    const sH = 1 + 0.015 * cBarP * T;
    const rT = -Math.sin(rad(60 * Math.exp(-(((hBar - 275) / 25) ** 2))))
      * 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
    return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH));
  };




  assert.equal(deltaE('#0F766E', '#0F766E'), 0, 'deltaE misst identische Farben nicht als 0');
  assert.ok(deltaE('#0F766E', '#C2410C') > 20, 'deltaE trennt Teal und Orange nicht');

  let checked = 0;
  for (const mod of modules) {
    const family = familyOf.get(mod);
    assert.ok(family, `--module-${mod} löst in tokens.css auf keinen Familienton auf`);
    const familyValues = valuesOf(`--_family-${family}`);
    assert.ok(familyValues.length >= 2, `--_family-${family} fehlt ein Theme-Wert`);

    for (const [themeIndex, theme] of [[0, 'light'], [1, 'dark']]) {
      for (let i = 1; i <= 7; i++) {
        const series = valuesOf(`--_chart-series-${i}`)[themeIndex];
        assert.ok(series, `--_chart-series-${i} fehlt für Theme ${theme}`);
        const distance = deltaE(series, familyValues[themeIndex]);
        checked++;
        assert.ok(
          distance >= JND,
          `${theme}: --chart-series-${i} (${series}) liegt ${distance.toFixed(1)} von `
          + `--_family-${family} (${familyValues[themeIndex]}) - der Modulton von "${mod}", `
          + `das die Palette selbst zeigt (${users.join(', ')}). Unter ${JND} sieht das Auge `
          + 'denselben Ton: ein Segment behauptet dann die Zugehörigkeit zum umgebenden Chrome. '
          + 'Serie verschieben, nicht die Schwelle.',
        );
      }
    }
  }
  assert.ok(checked >= 14, `Nur ${checked} Paare gemessen - erwartet werden 7 Serien x 2 Themes je Modul.`);
});

test('die Trendkurve beschriftet Skala und Zeitraum - IM Bild', () => {






  // Diagramm skaliert (gemessen: 600x180-viewBox auf 720x216 gestreckt).
  //



  assert.match(stats, /chartGridMarkup\(0, max,/, 'die Werteachse kommt aus der geteilten Geometrie');
  assert.match(stats, /chartXLabelsMarkup\(/, 'die Zeitachse kommt aus der geteilten Geometrie');
  assert.doesNotMatch(stats, /preserveAspectRatio="none"/, 'eine Kurve mit Achse darf nicht gestreckt werden - der Text im Bild verzerrt mit');
  assert.doesNotMatch(stats, /budget-stats__axis-(max|mid|x)/, 'die Achse steht im SVG, nicht als HTML daneben');
});

test('die Trendkurve macht Einzelwerte ohne Zeigegerät ablesbar', () => {


  assert.match(stats, /class="budget-stats__point"/);
  assert.match(stats, /aria-label="\$\{view\.ctx\.esc\(label\)\}"/);
  assert.match(stats, /statsPointLabel/);
  assert.match(stats, /role="group" aria-label="\$\{t\('budget\.statsPointsLabel'\)\}"/);

  assert.match(stats, /tabindex="\$\{i === s\.length - 1 \? '0' : '-1'\}"/);
  const wiring = stats.match(/function wireTrendPoints[\s\S]*?\n\}/);
  assert.ok(wiring, 'wireTrendPoints fehlt');
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    assert.match(wiring[0], new RegExp(key), `Tastaturnavigation ohne ${key}`);
  }

  assert.match(wiring[0], /addEventListener\('focusin'/);
  assert.match(wiring[0], /addEventListener\('pointerover'/);
});

test('die Datenreihen-Farben tragen ≥3:1 gegen den Seitengrund (WCAG 1.4.11)', () => {
  const hex = (value) => value.match(/[\da-f]{2}/gi).map((p) => parseInt(p, 16));
  const luminance = ([r, g, b]) => {
    const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };


  const backgrounds = [...tokensCss.matchAll(/--_neutral-100:\s*(#[\da-fA-F]{6})/g)].map((m) => m[1]);
  assert.ok(backgrounds.length >= 2, 'Hintergrund-Token für beide Themes erwartet');

  const seriesFor = (themeIndex) => {
    const values = [];
    for (let i = 1; i <= 7; i++) {
      const all = [...tokensCss.matchAll(new RegExp(`--_chart-series-${i}:\\s*(#[\\da-fA-F]{6})`, 'g'))].map((m) => m[1]);
      assert.ok(all[themeIndex], `--_chart-series-${i} fehlt für Theme ${themeIndex}`);
      values.push(all[themeIndex]);
    }
    return values;
  };

  for (const [themeIndex, theme] of [[0, 'light'], [1, 'dark']]) {
    const bg = hex(backgrounds[themeIndex]);
    seriesFor(themeIndex).forEach((color, i) => {
      const ratio = contrast(hex(color), bg);
      assert.ok(ratio >= 3, `${theme}: --chart-series-${i + 1} (${color}) nur ${ratio.toFixed(2)}:1 gegen ${backgrounds[themeIndex]}`);
    });
  }
});

// --------------------------------------------------------
// Hard Constraints: keine Literale
// --------------------------------------------------------

test('keine hartkodierten Anzeigetexte in den Budget-Views', () => {
  assert.doesNotMatch(budget, /Loan repayment:/);
  assert.doesNotMatch(budget, /'Geschenke & Transfers'/);

  assert.doesNotMatch(budget, /\}\s*vs\.\s*\$\{prevLabel\}/);
  assert.match(budget, /t\('budget\.trendDelta'/);
});

// --------------------------------------------------------
// Geteilte Bausteine des Moduls (Critique 2026-07-30, P0)
//




// --------------------------------------------------------


const BUDGET_PAGES = [
  ['budget.js', budget],
  ['budget-stats.js', stats],
  ['budget-plans.js', plans],
  ['subscriptions.js', subscriptions],
  ['split-expenses.js', splitExpenses],
];


// KEIN Budget-Stylesheet, aber .metric-card und .segmented wohnen dort - waere


const AUDITED_STYLESHEETS = [
  ['budget.css', budgetCss],
  ['panel.css', panelCss],
  ['subscriptions.css', subscriptionsCss],
  ['split-expenses.css', splitCss],
];


// `.replace().replace()`-Kette OHNE Fixpunkt - zwei Fassungen desselben









const withoutComments = (src) => {
  let out = src;
  let previous;
  do {
    previous = out;
    out = out.replace(/\/\*[\s\S]*?\*\//g, '');
    out = withoutHtmlComments(out);
    out = out.replace(/^\s*\/\/.*$/gm, '');
  } while (out !== previous);
  return out;
};




const MONEY_INPUT_PAGES = [...BUDGET_PAGES, ['housekeeping.js', housekeeping]];

test('Betragsfelder holen ihre Schrittweite aus der Währung, nicht aus 0.01', () => {







  for (const [file, src] of MONEY_INPUT_PAGES) {


    // exponentielles Backtracking (CodeQL js/redos).
    const inputs = withoutComments(src).match(/<input[^>]*>/g) || [];
    for (const input of inputs) {
      if (!/inputmode="decimal"/.test(input)) continue;
      if (!/step="0\.01"/.test(input)) continue;
      assert.match(
        input,
        /max="100"/,
        `${file}: Betragsfeld mit fester Schrittweite 0.01 - amountStep(currency, wert) aus utils/money.js nutzen:\n${input.replace(/\s+/g, ' ')}`,
      );
    }
  }
});

test('Geldbeträge gehen als Punkt-Dezimalstring an den Server', () => {




  const src = withoutComments(splitExpenses);
  assert.match(src, /toDecimalString[^\n]*from '\/utils\/money\.js'/, 'die Umschrift kommt aus utils/money.js');
  assert.match(src, /decimalString\s*=\s*toDecimalString/, 'die Umschrift fehlt');


  const posted = src.match(/data\.amount\s*=\s*[^\n;]+/g) || [];
  assert.ok(posted.length >= 2, 'Ausgabe und Zahlung müssen den Betrag umschreiben');
  for (const line of posted) {
    assert.match(line, /decimalString\(/, `Betrag ohne Umschrift an den Server: ${line}`);
  }




  const impl = withoutComments(money).match(/export function toDecimalString[\s\S]*?\n\}/);
  assert.ok(impl, 'toDecimalString fehlt in utils/money.js');
  assert.match(impl[0], /getNumberFormat\(/, 'die Ziffern müssen aus Intl kommen, nicht aus einer Tabelle');


  // Zweifel um den Faktor tausend daneben.
  assert.doesNotMatch(impl[0], /replace\([^)]*groupSep/, 'Gruppierung darf nicht still entfernt werden');
  assert.match(impl[0], /return ''/, 'ein gruppierter Betrag muss abgewiesen werden');
});

test('jeder Speicherpfad prüft die Schrittweite selbst', () => {




  // Anzeige ihn gerundet darstellt.



  //





  for (const [file, src] of MONEY_INPUT_PAGES) {
    const clean = withoutComments(src);
    if (!/step="\$\{amountStep\(/.test(clean)) continue;
    assert.match(
      clean,
      /amountIsSavable\(|rejectOffGridAmount\(/,
      `${file}: währungsgerasterte Felder, aber keine Prüfung im Speicherpfad`,
    );
  }
  assert.match(money, /export function fitsCurrencyGrid/);

  // Keine feste Toleranz gegen Float-Ungenauigkeit: 131072.02 * 100 ergibt




  const clean = withoutComments(money);
  assert.doesNotMatch(clean, /1e-9/, 'Rasterprüfung darf nicht an einer festen Toleranz hängen');
  assert.doesNotMatch(clean, /Math\.round\([^)]*10 \*\* /, 'Rasterprüfung über die Dezimaldarstellung, nicht über skalierte Floats');
});

test('ein unangetasteter Bestandsbetrag bleibt speicherbar', () => {




  const clean = withoutComments(budget);
  assert.match(clean, /original(?:Currency)?\s*[=:]/, 'rejectOffGridAmount kennt den Bestandswert nicht');

  const calls = clean.match(/rejectOffGridAmount\([\s\S]*?\)\) return;/g) || [];
  assert.ok(calls.length >= 4, `erwartet 4 Prüfungen, gefunden ${calls.length}`);
  for (const call of calls) {
    assert.match(call, /original:/, `Prüfung ohne Bestandsschutz: ${call.replace(/\s+/g, ' ').slice(0, 90)}`);
  }
});

test('jedes Formular prüft den Betrag auch selbst, nicht nur über step', () => {






  assert.match(money, /export function amountIsSavable/);
  for (const [file, src] of MONEY_INPUT_PAGES) {
    const clean = withoutComments(src);
    if (!/step="\$\{amountStep\(/.test(clean)) continue;
    assert.match(
      clean,
      /amountIsSavable\(|rejectOffGridAmount\(/,
      `${file}: währungsgerasterte Felder ohne eigene Prüfung im Speicherpfad`,
    );
  }
});

test('das inaktive Tarif-Feld ist von der Formularprüfung ausgenommen', () => {



  const clean = withoutComments(housekeeping);
  const fn = clean.match(/function updateRateFields\(\)[\s\S]*?\n  \}/);
  assert.ok(fn, 'updateRateFields nicht gefunden');
  assert.match(fn[0], /\.disabled = /, 'das inaktive Feld muss disabled werden, nicht nur versteckt');
  assert.match(clean, /\n  updateRateFields\(\);/, 'updateRateFields muss beim Öffnen einmal laufen');
});

test('nur der Trenner der Region wird zum Dezimalpunkt', () => {



  const impl = withoutComments(money).match(/export function toDecimalString[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(impl, /char === ','/, "das ASCII-Komma darf nicht pauschal als Dezimaltrenner gelten");
  assert.match(impl, /char === decimalSep/, 'der Trenner der Region fehlt');



  assert.match(impl, /groupSep/, 'die Gruppierung muss erkannt werden');
  assert.match(impl, /\\\\d\{3\}/, 'erkannt wird das Muster (drei Ziffern), nicht das blosse Zeichen');





  //     Mengenangabe die 2 las);

  //     das Gruppierungszeichen - "1,000" (also eins) floege raus.


  // Verhaltenstest nur ihre Folgen.
  const ziffernSchritt = impl.search(/digits\.get\(char\)/);
  const gruppenSchritt = impl.search(/groupSep &&/);
  const trennerSchritt = impl.search(/char === decimalSep/);
  assert.ok(ziffernSchritt >= 0 && gruppenSchritt >= 0 && trennerSchritt >= 0,
    'die drei Schritte von toDecimalString sind nicht mehr erkennbar');
  assert.ok(ziffernSchritt < gruppenSchritt,
    'die Ziffern muessen VOR der Gruppierungspruefung nach ASCII - sonst sieht `\\d` sie nicht');
  assert.ok(gruppenSchritt < trennerSchritt,
    'die Gruppierung muss VOR dem Ersetzen des Dezimaltrenners geprueft werden - sonst ist der Trenner in de-DE ununterscheidbar vom Gruppierungszeichen');
});

test('keine Seite schreibt einen Dezimaltrenner von Hand um', () => {






  const clean = withoutComments(money);
  assert.match(clean, /export function centsToAmountInput/, 'centsToAmountInput fehlt in utils/money.js');
  assert.match(clean, /export function amountInputToCents/, 'amountInputToCents fehlt in utils/money.js');

  const rein = clean.match(/export function amountInputToCents[\s\S]*?\n\}/)[0];
  assert.match(rein, /toDecimalString\(/, 'die Eingabe muss durch toDecimalString laufen');




  const raus = clean.match(/export function centsToAmountInput[\s\S]*?\n\}/)[0];
  assert.match(raus, /useGrouping:\s*false/, 'der Ausgabewert darf nicht gruppiert sein');


  // stand bis 09.09.2026 hier, weil shopping.js daneben Mengenangaben zerlegt





  const einkauf = withoutComments(read('../public/pages/shopping.js'));
  assert.doesNotMatch(einkauf, /function (centsToInput|inputToCents)\b/,
    'shopping.js rechnet Preise wieder selbst um');
  assert.match(einkauf, /amountInputToCents\(priceRoh/,
    'der Preis muss durch amountInputToCents laufen');


  // dahinter (de "1.000 g", en-US "1,000 g", fa/ar-EG in oestlichen Ziffern) misst

  // den Rueckfall.
  const menge = einkauf.match(/function parseShoppingQuantity[\s\S]*?\n\}/);
  assert.ok(menge, 'parseShoppingQuantity nicht gefunden');
  assert.match(menge[0], /toDecimalString\(/,
    'die Mengenangabe muss durch dieselbe Umschrift laufen wie der Preis');






  const rezept = withoutComments(read('../public/pages/meals.js'));
  const skalieren = rezept.match(/function scaleQuantityText[\s\S]*?\n\}/);
  assert.ok(skalieren, 'scaleQuantityText nicht gefunden');
  assert.match(skalieren[0], /toDecimalString\(/,
    'die gelesene Menge muss durch dieselbe Umschrift laufen');
  assert.doesNotMatch(skalieren[0], /useComma/,
    'der Trenner der Ausgabe darf nicht aus der Eingabe abgeschaut werden - getNumberFormat nutzen');
  assert.match(rezept, /function formatScaledQuantity[\s\S]*?toStoredNumber\(/,
    'die skalierte Menge muss ueber toStoredNumber geschrieben werden');




  //    deutsche Oberflaeche "4.5");


  //    Summierung fiel. Seit er dieselbe Umschrift benutzt (utils/digits.js), ist


  //    parseQuantity statt gegen einen Nachbau seiner Regex;

  //    beim naechsten Skalieren abweist.
  const gespeichert = clean.match(/export function toStoredNumber[\s\S]*?\n\}/);
  assert.ok(gespeichert, 'toStoredNumber fehlt in utils/money.js');
  assert.match(gespeichert[0], /getNumberFormat\(/, 'der Trenner muss aus der Region kommen');
  assert.doesNotMatch(gespeichert[0], /numberingSystem/,
    'der gespeicherte Wert folgt der Region - der Server liest sie inzwischen mit');
  assert.match(gespeichert[0], /useGrouping:\s*false/, 'der gespeicherte Wert darf nicht gruppiert sein');




  const abbruch = clean.match(/export function breaksOffAtSeparator[\s\S]*?\n\}/);
  assert.ok(abbruch, 'breaksOffAtSeparator fehlt in utils/money.js');
  assert.doesNotMatch(abbruch[0], /\[\^\\s\\d\]/,
    'die Trennzeichen duerfen nicht als „alles ausser Leerraum und Ziffer" geraten werden');
  assert.match(clean, /function numberSeparators[\s\S]*?REGION_CODES/,
    'die Trennzeichen muessen aus den waehlbaren Regionen abgeleitet werden');

  assert.match(abbruch[0], /\\p\{Nd\}/u,
    'die Ziffernpruefung muss Unicode-Ziffern kennen, nicht nur ASCII');
  for (const [datei, quelle] of [['shopping.js', einkauf], ['meals.js', rezept]]) {
    assert.match(quelle, /breaksOffAtSeparator\(/,
      `pages/${datei} muss die geteilte Abschneide-Pruefung nutzen`);
    assert.doesNotMatch(quelle, /\[\^\\s\\d\]\\d/,
      `pages/${datei} hat wieder eine eigene, zu breite Trennerpruefung`);
  }




  const seiten = readdirSync(new URL('../public/pages/', import.meta.url)).filter((f) => f.endsWith('.js'));
  assert.ok(seiten.length > 10, `zu wenige Seiten gefunden (${seiten.length})`);
  for (const datei of seiten) {
    assert.doesNotMatch(
      withoutComments(read(`../public/pages/${datei}`)),
      /\.replace\(\s*(?:'[,.]'|"[,.]"|\/[,.]\/[a-z]*)\s*,\s*(?:'[,.]'|"[,.]")\s*\)/,
      `pages/${datei} schreibt einen Trenner von Hand um - toDecimalString aus utils/money.js nutzen`,
    );
  }
});

test('ein Abo darf null kosten', () => {



  const field = withoutComments(subscriptions).match(/<input[^>]*id="subscription-amount"[^>]*>/);
  assert.ok(field, 'Abo-Betragsfeld nicht gefunden');
  assert.match(field[0], /min="0"/, 'Abo-Preis braucht die Untergrenze null, nicht amountMin()');
});

test('gespeicherte Beträge werden beim Öffnen nicht gerundet', () => {



  assert.doesNotMatch(
    withoutComments(budget),
    /\.toFixed\(currencyFractionDigits\(/,
    'budget.js: Bestandsbetrag wird beim Rendern gerundet - amountStep fängt off-grid-Werte ab',
  );
});

test('wählbare Währungen ziehen das Betragsfeld nach', () => {



  assert.match(money, /export function applyAmountFormat/);
  for (const [file, src] of [['budget.js', budget], ['subscriptions.js', subscriptions], ['split-expenses.js', splitExpenses]]) {
    assert.match(
      withoutComments(src),
      /applyAmountFormat\(|amountPlaceholder\(/,
      `${file}: Währungswechsel im Formular ohne Nachziehen des Betragsfeldes`,
    );
  }




  const body = withoutComments(money).match(/export function applyAmountFormat[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(body, /amountStep\([^)]*input\.value/, 'applyAmountFormat darf den Bestandswert nicht weiterreichen');
  assert.doesNotMatch(body, /amountMin\([^)]*input\.value/, 'applyAmountFormat darf den Bestandswert nicht weiterreichen');
});

test('Geldbeträge laufen über den Modul-Formatierer, nicht über eigene', () => {
  // Drei eigene Formatierer bedeuteten vier Vorzeichenkonventionen: dieselbe


  for (const [file, src] of BUDGET_PAGES) {
    assert.doesNotMatch(
      src,
      /getNumberFormat\(\{[^}]*style:\s*'currency'/,
      `${file}: Währungsformat gehört in utils/money.js, nicht in die Page`,
    );
  }
  assert.match(money, /export function formatSignedAmount/);
  assert.match(money, /export function formatMoney/);
});

test('jede Rolle des Geld-Vokabulars ist in money.js dokumentiert und behandelt', () => {


  const roles = money.match(/export const MONEY_ROLES = \[([^\]]*)\]/);
  assert.ok(roles, 'MONEY_ROLES fehlt in utils/money.js');
  for (const role of ['flow', 'total', 'balance', 'plain']) {
    assert.ok(roles[1].includes(`'${role}'`), `Rolle '${role}' fehlt in MONEY_ROLES`);
    assert.ok(
      new RegExp(`\\|\\s*\`${role}\``).test(money),
      `Rolle '${role}' ist in der Rollentabelle von money.js nicht dokumentiert`,
    );
  }

  for (const [file, src] of BUDGET_PAGES) {
    for (const call of src.matchAll(/formatSignedAmount\([^)]*role:\s*'([a-z]+)'/g)) {
      assert.ok(roles[1].includes(`'${call[1]}'`), `${file}: unbekannte Geld-Rolle '${call[1]}'`);
    }
    for (const call of src.matchAll(/amountByRole\([^,]+,\s*'([a-z]+)'/g)) {
      assert.ok(roles[1].includes(`'${call[1]}'`), `${file}: unbekannte Geld-Rolle '${call[1]}'`);
    }
  }
});

test('es gibt genau eine Kennzahlkarte im Modul', () => {


  for (const [file, css] of AUDITED_STYLESHEETS) {
    for (const match of css.matchAll(/^\.([a-z-]*summary-card[a-z_-]*)/gm)) {
      assert.ok(
        match[1].startsWith('metric-card'),
        `${file}: .${match[1]} ist eine zweite Kennzahlkarte - .metric-card ist der Baustein`,
      );
    }
  }
  for (const [file, src] of BUDGET_PAGES) {
    for (const match of src.matchAll(/class="([^"]*summary-card[^"]*)"/g)) {
      assert.ok(
        /metric-card/.test(match[1]),
        `${file}: Kennzahlkarte "${match[1]}" nutzt nicht .metric-card`,
      );
    }
  }
});

test('Arbeitsflächen des Moduls sind opak, Glass bleibt den Overlays', () => {





  const OVERLAY_ROLES = /modal|dialog|popover|overlay|picker-panel|form__section|tooltip|menu/;
  for (const [file, css] of AUDITED_STYLESHEETS) {

    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = rule[1].split('*/').pop().trim();
      if (!/--glass-bg-card|--glass-shadow/.test(rule[2])) continue;
      assert.match(
        selector,
        OVERLAY_ROLES,
        `${file}: "${selector}" ist eine Arbeitsfläche und darf kein Glass tragen`,
      );
    }
  }
});

test('kein Kontrast im Modul hängt an der Datenlage', () => {




  //




  const DATA_COLORS = new Set(
    BUDGET_PAGES.flatMap(([, src]) =>
      [...src.matchAll(/style="[^"]*?(--[a-z][a-z0-9-]*)\s*:/g)].map((m) => m[1])),
  );
  assert.ok(DATA_COLORS.size > 0, 'keine Datenfarben gefunden - der Guard misst nichts');

  const varsIn = (decls) => [...decls.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]);
  for (const [file, css] of AUDITED_STYLESHEETS) {
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const body = rule[2];
      const fg = [...body.matchAll(/(?:^|;)\s*color\s*:([^;]*)/g)].map((m) => m[1]).join(' ');
      const bg = [...body.matchAll(/(?:^|;)\s*background(?:-color)?\s*:([^;]*)/g)].map((m) => m[1]).join(' ');
      if (!fg.trim() || !bg.trim()) continue;
      const shared = varsIn(fg).filter((v) => DATA_COLORS.has(v) && varsIn(bg).includes(v));
      assert.equal(
        shared.length, 0,
        `${file}: "${rule[1].split('*/').pop().trim()}" zieht ${shared.join(', ')} `
        + 'für Schrift UND Fläche - der Kontrast hängt damit an den Nutzerdaten',
      );
    }
  }
});

test('eingebettete Untertabs bringen kein eigenes Seiten-Chrome mit', () => {



  for (const [file, css, selector] of [
    ['subscriptions.css', subscriptionsCss, '.budget-page .subscriptions-page'],
    ['split-expenses.css', splitCss, '.budget-page .split-page'],
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `${file}: ${selector}-Override fehlt`);
    assert.match(rule[1], /background:\s*none/, `${file}: ${selector} muss den eigenen Gradient ablegen`);
    assert.match(rule[1], /padding-block:\s*0/, `${file}: ${selector} muss den eigenen Rand ablegen`);
  }
});

test('Panel-Fläche und Kopfleiste sind geteilt, nicht pro Tab gebaut', () => {


  const panel = budgetCss.match(/\n\.budget-tab-panel\s*\{([^}]*)\}/);
  assert.ok(panel, '.budget-tab-panel fehlt in budget.css');
  assert.match(panel[1], /overflow-y:\s*auto/);
  assert.match(panel[1], /padding-block-start:\s*var\(--space/);

  assert.ok(/\n\.panel-head\s*\{/.test(panelCss), '.panel-head fehlt in panel.css');
  assert.ok(/\n\.panel-head__title\s*\{/.test(panelCss), '.panel-head__title fehlt');



  const ALLOWED_PANEL_OVERRIDES = /budget-tab-panel--budget/;
  for (const rule of budgetCss.matchAll(/(\.budget-tab-panel--[a-z-]+)(?:[^{}]*)\{([^}]*)\}/g)) {
    if (!/overflow-y|padding-block-start|padding-top/.test(rule[2])) continue;
    assert.match(
      rule[1],
      ALLOWED_PANEL_OVERRIDES,
      `${rule[1]} setzt Scroll-Achse oder Padding selbst - beides gehört .budget-tab-panel`,
    );
  }
});

test('die Transaktionsliste bleibt auf kurzen Desktop-Viewports erreichbar (#904)', () => {













  //    trifft - `.budget-page .budget-tab-panel--budget` clippt genauso, war
  //    aber am exakten Selektorvergleich vorbei.






  const subjectIs = (selector, cls) => selector.split(',').some((einzel) => {
    const compounds = einzel.trim().split(/[\s>+~]+/).filter(Boolean);
    return compounds.length > 0 && compounds[compounds.length - 1].includes(cls);
  });

  let panelSeen = false;
  let floorSeen = false;
  for (const { selector, body, at } of eachRule(budgetCss)) {
    if (at.some((a) => /max-width:\s*639px/.test(a))) continue;
    if (subjectIs(selector, '.budget-tab-panel--budget')) {
      panelSeen = true;




      for (const [, prop, value] of body.matchAll(/(?:^|;)\s*(overflow(?:-y|-block)?)\s*:\s*([^;]+)/g)) {
        assert.ok(
          !/\b(?:hidden|clip)\b/.test(value),
          `"${selector.trim()}" clippt das Budget-Panel (${prop}: ${value.trim()}): wächst `
          + 'der feste Teil über den Viewport, ist die Transaktionsliste '
          + 'unerreichbar (#904) - die Scroll-Achse der Basisregel muss offen bleiben',
        );
      }
    }
    if (subjectIs(selector, '.budget-list-section')) {
      const decls = [...body.matchAll(/min-height\s*:\s*([^;]+)/g)];
      if (decls.length === 0) continue;
      const value = decls[decls.length - 1][1].trim();
      const px = value.match(/(\d+(?:\.\d+)?)px/);
      assert.ok(
        px && Number(px[1]) >= 200,
        `"${selector.trim()}" setzt min-height: ${value} - die Sektion braucht eine `
        + 'nutzbare px-Untergrenze (>= 200px, ggf. per min() ans Panel gekappt): '
        + 'auto, 0 oder Kleinstwerte kollabieren sie neben dem inhaltshohen '
        + 'Kategorie-Chart wieder auf Kopfzeilenhöhe (#904)',
      );
      floorSeen = true;
    }
  }
  assert.ok(panelSeen, '.budget-tab-panel--budget fehlt in budget.css');
  assert.ok(
    floorSeen,
    '.budget-list-section deklariert ausserhalb des Mobil-Reflows keine '
    + 'min-height-Untergrenze mehr (#904)',
  );
});

test('Trendpfeile sind Icons, keine Textglyphen', () => {


  const metricCard = read('../public/utils/metric-card.js');
  assert.doesNotMatch(budget, /'▲'/);
  assert.doesNotMatch(budget, /'▼'/);
  assert.doesNotMatch(metricCard, /'▲'/);
  assert.doesNotMatch(metricCard, /'▼'/);
  assert.match(metricCard, /trending-up/);
  assert.match(metricCard, /trending-down/);
  assert.match(budget, /trendMarkup\(/);
});

test('Konto-Farben kommen aus Tokens und tragen sprechende Labels', () => {
  const palette = budget.match(/const ACCOUNT_COLORS = \[[\s\S]*?\];/);
  assert.ok(palette, 'ACCOUNT_COLORS fehlt');
  assert.doesNotMatch(palette[0], /#[0-9a-fA-F]{6}/, 'Hex-Literale gehören in tokens.css');
  assert.match(palette[0], /nameKey: 'budget\.color/);

  assert.match(budget, /t\(c\.nameKey\)/);
});

test('kein toter Toast-Typ: nur gestylte Varianten werden verwendet', () => {
  const styled = new Set(['success', 'danger', 'warning', 'default']);
  for (const [file, src] of [['budget.js', budget], ['budget-stats.js', stats], ['budget-plans.js', plans], ['subscriptions.js', subscriptions]]) {
    for (const match of src.matchAll(/showToast\([^)]*?,\s*'([a-z]+)'/g)) {
      assert.ok(styled.has(match[1]), `${file}: showToast-Typ '${match[1]}' hat keine Styles`);
    }
  }
});

// --------------------------------------------------------
// Saldo entdramatisieren bei reinem Ausgaben-Tracking (#504)
// --------------------------------------------------------

test('Saldo wird neutral, wenn keine Einnahmen erfasst sind', () => {


  assert.match(budget, /const balanceNeutral = s\.income === 0 && s\.balance < 0;/);
  assert.match(budget, /balanceNeutral[\s\S]{0,80}metric-card--balance-neutral/);

  assert.match(budget, /metric-card--balance-positive/);
  assert.match(budget, /metric-card--balance-negative/);
});

test('der Saldo-Trend entfällt im neutralen Ausgaben-Fall', () => {


  assert.match(budget, /p && !balanceNeutral \? renderTrend\(s\.balance/);
});

test('die neutrale Saldo-Farbe kommt aus einem Token, nicht als Literal', () => {
  const rule = panelCss.match(/\.metric-card--balance-neutral[^\n]*\{[^}]*\}/);
  assert.ok(rule, '.metric-card--balance-neutral fehlt in panel.css');
  assert.match(rule[0], /var\(--color-text-primary\)/);
  assert.doesNotMatch(rule[0], /var\(--color-danger\)|var\(--color-success\)/);
});

// --------------------------------------------------------
// „Nur Ausgaben"-Umschalter (#504)
// --------------------------------------------------------

test('„Nur Ausgaben" reduziert die Zusammenfassung auf die Ausgaben-Karte', () => {


  assert.match(budget, /expensesOnly \? expensesCard : incomeCard \+ expensesCard \+ balanceCard/);
});

test('der „Nur Ausgaben"-Umschalter meldet seinen Zustand als echter Switch', () => {
  assert.match(budget, /id="budget-expenses-only"[\s\S]{0,120}role="switch"/);
  assert.match(budget, /aria-checked="\$\{expensesOnly \? 'true' : 'false'\}"/);
});

test('der „Nur Ausgaben"-Zustand ist client-persistent und geräte-lokal', () => {


  assert.match(budget, /const EXPENSES_ONLY_KEY = 'aashiyana-budget-expenses-only';/);
  assert.match(budget, /state\.expensesOnly = localStorage\.getItem\(EXPENSES_ONLY_KEY\) === '1';/);
  assert.match(budget, /localStorage\.setItem\(EXPENSES_ONLY_KEY, state\.expensesOnly \? '1' : '0'\)/);
});

test('die Ausgaben-Karte trägt im „Nur Ausgaben"-Modus die volle Breite', () => {



  const rule = panelCss.match(/\.metric-grid--expenses-only[^\n]*\{[^}]*\}/);
  assert.ok(rule, '.metric-grid--expenses-only fehlt in panel.css');
  assert.match(rule[0], /--summary-cards:\s*1/);

  const base = panelCss.match(/\n\.metric-grid\s*\{[^}]*\}/);
  assert.ok(base, '.metric-grid fehlt in panel.css');
  assert.match(base[0], /grid-template-columns:\s*repeat\(var\(--summary-cards[^)]*\)/);
});

test('der „Nur Ausgaben"-Umschalter nutzt Tokens, keine Farbliterale', () => {
  const rule = budgetCss.match(/\.budget-expenses-toggle\s*\{[^}]*\}/);
  assert.ok(rule, '.budget-expenses-toggle fehlt in budget.css');
  assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,8}\b/);
});

// --------------------------------------------------------
// Zustand, Fokus, Ladewahrnehmung
// --------------------------------------------------------

test('Filterzustand überlebt den Modulwechsel nicht', () => {


  const enter = budget.match(/export async function render\([\s\S]*?renderBody\(\);/);
  assert.ok(enter);
  for (const field of ['accountFilterId', 'loanFilterId', 'loanStatusFilter', 'accountsShowArchived']) {
    assert.match(enter[0], new RegExp(`state\\.${field} = `), `${field} wird beim Betreten nicht zurückgesetzt`);
  }
});

test('der Konto-Drilldown verliert den Fokus nicht', () => {
  assert.match(budget, /_container\.querySelector\('#budget-body'\)\?\.focus\(\)/);
});

test('das Inline-Kategorie-Overlay ist ein vollwertiger Dialog', () => {
  const overlay = budget.match(/function requestNameInPanel[\s\S]*?\n\}/);
  assert.ok(overlay);
  assert.match(overlay[0], /e\.key === 'Escape'/);
  assert.match(overlay[0], /e\.key !== 'Tab'/, 'Fokus-Trap fehlt');
  assert.match(overlay[0], /opener\?\.isConnected/, 'Fokus kehrt nicht zum Auslöser zurück');
});

test('Berichte und Plan zeigen beim Laden ein Skelett', () => {
  assert.match(stats, /renderSkeletonList/);
  assert.match(plans, /renderSkeletonList/);
});

// --------------------------------------------------------
// Abo-Filterleiste
// --------------------------------------------------------

test('Abo-Filter tragen sichtbare Labels und lassen sich zurücksetzen', () => {
  for (const key of ['filterLabelCategory', 'filterLabelMethod', 'filterLabelStatus', 'filterLabelSort']) {
    assert.match(subscriptions, new RegExp(`subscriptions\\.${key}`), `sichtbares Label ${key} fehlt`);
  }
  assert.match(subscriptions, /function hasActiveFilters/);
  assert.match(subscriptions, /async function resetFilters/);

  assert.match(subscriptions, /subscriptions\.noMatchesTitle/);
});

// --------------------------------------------------------
// i18n
// --------------------------------------------------------

test('alle neuen Keys existieren in jeder Locale', () => {
  const keys = [
    'budget.trendDelta', 'budget.statsRangeLabel', 'budget.statsOtherCategories',
    'budget.statsTrendSummary', 'budget.statsDonutSummary',
    'budget.colorTeal', 'budget.colorBlue', 'budget.colorViolet', 'budget.colorMagenta',
    'budget.colorOrange', 'budget.colorGreen', 'budget.colorOcher',
    'budget.statsPointLabel', 'budget.statsPointsLabel',
    'budget.expensesOnly', 'budget.expensesOnlyHint',
    'subscriptions.resetFilters', 'subscriptions.noMatchesTitle', 'subscriptions.noMatchesDescription',
    'subscriptions.filterLabelCategory', 'subscriptions.filterLabelMethod',
    'subscriptions.filterLabelStatus', 'subscriptions.filterLabelSort',
  ];
  const files = readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 23, 'unerwartet wenige Locale-Dateien');
  for (const file of files) {
    const data = JSON.parse(read(`../public/locales/${file}`));
    for (const key of keys) {
      const value = key.split('.').reduce((v, part) => (v != null ? v[part] : undefined), data);
      assert.equal(typeof value, 'string', `${file}: ${key} fehlt`);
      assert.ok(value.trim().length > 0, `${file}: ${key} ist leer`);
    }
  }
});

test('die Platzhalter der neuen Sätze bleiben in jeder Locale erhalten', () => {
  const expected = {
    'budget.trendDelta': ['{{amount}}', '{{month}}'],
    'budget.statsTrendSummary': ['{{periods}}', '{{income}}', '{{expenses}}', '{{peak}}'],
    'budget.statsDonutSummary': ['{{count}}', '{{top}}', '{{pct}}', '{{total}}'],
    'budget.statsPointLabel': ['{{period}}', '{{income}}', '{{expenses}}'],
  };
  const files = readdirSync(new URL('../public/locales/', import.meta.url)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const data = JSON.parse(read(`../public/locales/${file}`));
    for (const [key, placeholders] of Object.entries(expected)) {
      const value = key.split('.').reduce((v, part) => v[part], data);
      for (const placeholder of placeholders) {
        assert.ok(value.includes(placeholder), `${file}: ${key} ohne ${placeholder}`);
      }
    }
  }
});

// --------------------------------------------------------
// Wiederholung: Einheit + Anzahl (#636)
// --------------------------------------------------------

test('das Intervall-Feld bietet Einheit und Anzahl, ohne half_year', () => {
  const start = budget.indexOf('id="bm-recurrence-options"');
  const modal = budget.slice(start, budget.indexOf('renderDocumentAttachField', start));
  for (const key of ['budget.intervalWeekly', 'budget.intervalMonthly', 'budget.intervalYearly']) {
    assert.ok(modal.includes(key), `${key} fehlt im Intervall-Feld`);
  }
  assert.ok(!budget.includes('intervalHalfYear'), 'half_year ist als Rhythmus abgelöst (monatlich x 6)');
  assert.ok(!budget.includes("'half_year'"), 'kein half_year-Literal mehr im Frontend');
  assert.match(modal, /id="bm-interval-count"[\s\S]*?min="1"[\s\S]*?max="99"/, 'Anzahl-Feld mit Grenzen 1..99');
  assert.ok(modal.includes('id="bm-interval-unit"'), 'Einheitenwort neben der Zahl');
});

test('das Einheitenwort kommt aus der geteilten Quelle, nicht aus einer zweiten Zuordnung', () => {


  assert.match(budget, /import \{ intervalUnitLabel \} from '\/rrule-ui\.js'/);
  assert.ok(budget.includes('intervalUnitLabel('), 'Label über die geteilte Funktion');
  for (const key of ['rrule.unitWeek', 'rrule.unitMonths', 'rrule.unitYears']) {
    assert.ok(!budget.includes(key), `${key} gehört nicht ins Budget-Modal`);
  }
});

test('die Anzahl reist mit dem Eintrag zum Server', () => {
  assert.ok(budget.includes('recurrence_interval_count: intervalN'), 'Anzahl fehlt im Request-Body');
  assert.match(budget, /Math\.min\(99, Math\.max\(1,[^)]*bm-interval-count/, 'Anzahl wird vor dem Senden geklemmt');
});

// --------------------------------------------------------

// --------------------------------------------------------

test('eine erwartete Buchung ist in der Liste als solche erkennbar und buchbar', () => {
  assert.ok(budget.includes('budget-badge--pending'), 'Marke an der Zeile fehlt');
  assert.ok(budget.includes('budget.pendingBadge'), 'Beschriftung der Marke fehlt');
  assert.match(budget, /data-action="confirm"/, 'Buchen-Aktion fehlt an der Zeile');
  assert.ok(budget.includes('budget-entry--pending'), 'Zeile trägt keinen eigenen Zustand');
  assert.ok(budgetCss.includes('.budget-badge--pending'), 'Marke ohne Stil');
  assert.ok(budgetCss.includes('.budget-entry--pending'), 'Zeilenzustand ohne Stil');
});

test('der Bestätigen-Dialog lässt Betrag und Datum korrigieren', () => {
  const modal = budget.slice(budget.indexOf('async function openConfirmBookingModal'));
  assert.ok(modal.includes('cb-amount'), 'Betragsfeld fehlt');
  assert.ok(modal.includes('cb-date'), 'Datumsfeld fehlt');
  assert.ok(modal.includes('aashiyana-datepicker'), 'Datum über die geteilte Komponente');
  assert.match(modal, /api\.patch\(`\/budget\/\$\{id\}\/confirm`/, 'ruft die Bestätigungs-Route nicht auf');
  assert.ok(modal.includes('rejectOffGridAmount'), 'Betrag ohne Währungsraster-Prüfung');
});

test('was noch aussteht, steht unter den Summenkarten', () => {


  assert.ok(budget.includes('budget.pendingSummary'), 'Hinweiszeile fehlt');
  assert.ok(budget.includes('budget-pending-note'), 'Hinweiszeile ohne eigene Klasse');
  assert.ok(budgetCss.includes('.budget-pending-note'), 'Hinweiszeile ohne Stil');
});

test('die Bestätigungspflicht ist eine Eigenschaft der Serie', () => {
  const modal = budget.slice(budget.indexOf('id="bm-recurrence-options"'), budget.indexOf('renderDocumentAttachField', budget.indexOf('id="bm-recurrence-options"')));
  assert.ok(modal.includes('bm-confirm-first'), 'Schalter fehlt im Wiederholungs-Block');
  assert.ok(modal.includes('budget.confirmFirstLabel'), 'Beschriftung fehlt');
  assert.ok(budget.includes('recurrence_confirm: confirmFirst'), 'Feld reist nicht zum Server');
});

// --------------------------------------------------------

// --------------------------------------------------------

test('der Typ-Umschalter nimmt bei einer Darlehensrate keine Eingabe entgegen', () => {




  const toggle = budget.slice(budget.indexOf('class="amount-type-toggle'), budget.indexOf('id="bm-title"'));
  const buttons = [...toggle.matchAll(/id="type-(expense|income)"[^>]*/g)].map((m) => m[0]);
  assert.equal(buttons.length, 2, 'die beiden Typ-Schalter sind nicht mehr auffindbar');
  for (const btn of buttons) {
    assert.match(btn, /isLoanPayment \? 'disabled' : ''/,
      `${btn.slice(0, 24)} ist bei einer Darlehensrate weiter bedienbar`);
  }
  assert.ok(toggle.includes('budget.loanPaymentTypeLocked'), 'die Sperre bleibt unerklärt');
});

test('das Bearbeiten-Modal bekommt immer einen echten Eintrag, nie einen nachgebauten', () => {





  const built = budget.slice(budget.indexOf('function loanPaymentToEntry'), budget.indexOf('function renderLoanPaymentEntry'));
  assert.doesNotMatch(built, /openBudgetModal/, 'der Nachbau oeffnet selbst das Modal');

  const handler = budget.slice(budget.indexOf("data-action=\"loan-payment-edit\"]').forEach"));
  const body = handler.slice(0, handler.indexOf('});'));
  assert.doesNotMatch(body, /loanPaymentToEntry/,
    'der Bearbeiten-Knopf oeffnet das Modal mit dem nachgebauten Objekt');
  assert.match(body, /openLoanPaymentEntry/, 'der Bearbeiten-Knopf laedt den Eintrag nicht nach');

  const loader = budget.slice(budget.indexOf('async function openLoanPaymentEntry'));
  const loaderBody = loader.slice(0, loader.indexOf('\nfunction '));
  assert.match(loaderBody, /api\.get\(`\/budget\?loan_id=/, 'der Eintrag kommt nicht aus dem Drilldown');
  assert.match(loaderBody, /loan_payment_id === paymentId/, 'die geladene Zeile wird nicht der Rate zugeordnet');
  assert.match(loaderBody, /openBudgetModal\(\{ mode: 'edit', entry \}\)/, 'das Modal wird nicht mit dem geladenen Eintrag geoeffnet');
});

test('Serien-Speichern reicht ein leeres Konto einer kontolosen Instanz nicht weiter (#973)', () => {
  const start = budget.indexOf("if (scope === 'series')");
  assert.ok(start >= 0, 'der Serien-Zweig muss auffindbar sein');
  const zweig = budget.slice(start, start + 1400);

  assert.match(zweig, /const seriesBody = \{ \.\.\.body \}/,
    'der Serien-Aufruf braucht einen eigenen Body, sonst wirkt jede Korrektur auch auf den Einzel-PUT');
  assert.match(zweig, /seriesBody\.account_id === null && entry\.account_id == null/,
    'ein leeres Feld zählt nur als "Konto entfernen", wenn die Instanz vorher eines trug');
  assert.match(zweig, /delete seriesBody\.account_id/,
    'sonst muss das Feld ungesendet bleiben - weglassen heißt serverseitig "unverändert"');
  assert.match(zweig, /api\.put\(`\/budget\/\$\{entry\.id\}\/series`, seriesBody\)/,
    'gesendet wird der bereinigte Body, nicht der ursprüngliche');
});

// --------------------------------------------------------

// --------------------------------------------------------

test('Split-Ausgaben bietet keine zweite, generische Neu-Aktion aus dem Budget-Kopf', () => {
  const table = budget.match(/const TAB_CAPS = \{[\s\S]*?\n\};/);
  assert.ok(table, 'TAB_CAPS-Tabelle fehlt');
  assert.match(table[0], /'split-expenses':\s*\{[^}]*add:\s*null/,
    'Split-Ausgaben bringt seinen eigenen Kopfknopf/FAB mit - Budgets generischer ' +
    '#budget-add/#fab-new-budget-Knopf darf hier keine zweite Aktion anbieten');


  assert.doesNotMatch(withoutComments(budget), /case 'split-expenses':/,
    'addHandler darf für Split-Ausgaben keinen eigenen Zweig mehr brauchen - ' +
    'der Tab hat keine generische Neu-Aktion mehr');
});

test('eingebettete Split-Ausgaben tragen keine zweite <h1> und keinen zweiten Primärknopf', () => {
  assert.match(splitExpenses, /const TitleTag = embedded \? 'h2' : 'h1'/,
    'die Überschrift muss im eingebetteten Fall eine Bereichs-Überschrift sein, kein zweites <h1>');
  assert.match(splitExpenses, /const addExpenseBtnVariant = embedded \? 'btn--secondary' : 'btn--primary'/,
    'der Kopfknopf muss im eingebetteten Fall zurücktreten - die Primäraktion ist der FAB');
  assert.match(splitExpenses, /<\$\{TitleTag\} class="split-title">/,
    'die Überschrift muss über TitleTag gerendert werden, nicht fest als <h1>');
  assert.match(splitExpenses, /<button class="btn \$\{addExpenseBtnVariant\}" id="split-add-expense">/,
    'der Kopfknopf muss über addExpenseBtnVariant gerendert werden, nicht fest als --primary');
});

test('Gruppe löschen trägt eine andere Gewichtung als bearbeiten/archivieren', () => {
  assert.match(splitExpenses, /id="split-edit-group"[^>]*>/);
  assert.match(splitExpenses, /class="btn btn--secondary btn--icon" id="split-edit-group"/,
    'Bearbeiten bleibt eine gewöhnliche Sekundäraktion');
  assert.match(splitExpenses, /class="btn btn--secondary btn--icon" id="split-archive-group"/,
    'Archivieren bleibt eine gewöhnliche Sekundäraktion');
  assert.match(splitExpenses, /class="btn btn--icon btn--danger-outline" id="split-delete-group"/,
    'Löschen muss sich sichtbar von Bearbeiten/Archivieren abheben, ohne die Zeile zu dominieren');
});
