import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

global.HTMLElement = class HTMLElement {};
global.customElements = { define() {}, get() { return undefined; } };
global.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, aashiyana: {} };
global.document = {
  getElementById: () => null,
  createElement: () => Object.assign(new global.HTMLElement(), {
    style: {}, setAttribute() {}, appendChild() {}, addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
  }),
  addEventListener() {},
  documentElement: { lang: 'de' },
};

const { __test } = await import('../public/pages/waste.js');
const {
  findScheduleOrigin, parseDeepLinkParams, deepLinkSelectors, recurrenceSummary, originBadges,
  defaultLabelDecision, unresolvedBlockingDiagnostics, buildMappingDecisions, sourceHealthBadgeInfo,
  splitUpcomingByType, deepLinkNeedsExpand, nearestOrdinalAnchorDateKey,
  typeCardHtml, scheduleRowHtml, sourceRowHtml, TYPE_PRESETS, WASTE_TYPE_COLORS,
  activeSwatchColor, resolveSwatchColors,
} = __test;





const WASTE_SRC = readFileSync(new URL('../public/pages/waste.js', import.meta.url), 'utf8');

// NENNEN die abgeschafften Dinge ausdruecklich (`toolbar-new-btn`,
// `<input type="color">`), damit der naechste Leser weiss, warum sie fehlen.

const WASTE_CODE = WASTE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// -------------------------------------------------------------------------
// findScheduleOrigin - backs move/skip/restore
// -------------------------------------------------------------------------

test('findScheduleOrigin: returns the schedule id and original date for a schedule-origin occurrence', () => {
  const occurrences = [{
    key: '1:2026-01-05', date_key: '2026-01-05',
    origins: [{ kind: 'schedule', schedule_id: 10, original_date: null, moved: false }],
  }];
  const found = findScheduleOrigin('1:2026-01-05', occurrences);
  assert.equal(found.scheduleId, 10);
  assert.equal(found.originalDate, '2026-01-05', 'falls back to the occurrence date when original_date is null (unmoved)');
});

test('findScheduleOrigin: uses the recorded original_date for a moved occurrence', () => {
  const occurrences = [{
    key: '1:2026-01-14', date_key: '2026-01-14',
    origins: [{ kind: 'schedule', schedule_id: 10, original_date: '2026-01-12', moved: true }],
  }];
  const found = findScheduleOrigin('1:2026-01-14', occurrences);
  assert.equal(found.originalDate, '2026-01-12');
});

test('findScheduleOrigin: returns null for a one-off-only occurrence (nothing to move/skip)', () => {
  const occurrences = [{
    key: '1:2026-01-12', date_key: '2026-01-12',
    origins: [{ kind: 'one_off', one_off_id: 5, original_date: null, moved: false }],
  }];
  assert.equal(findScheduleOrigin('1:2026-01-12', occurrences), null);
});

test('findScheduleOrigin: returns null for an unknown key', () => {
  assert.equal(findScheduleOrigin('missing', []), null);
});

// -------------------------------------------------------------------------
// Deep-link contract: ?type=<id>&date=<YYYY-MM-DD>
// -------------------------------------------------------------------------

test('parseDeepLinkParams: reads a well-formed type + date', () => {
  assert.deepEqual(parseDeepLinkParams('?type=7&date=2026-03-01'), { typeId: 7, date: '2026-03-01' });
});

test('parseDeepLinkParams: type alone (no date) is valid', () => {
  assert.deepEqual(parseDeepLinkParams('?type=7'), { typeId: 7, date: null });
});

test('parseDeepLinkParams: no type at all yields typeId: null regardless of date', () => {
  assert.deepEqual(parseDeepLinkParams('?date=2026-03-01'), { typeId: null, date: '2026-03-01' });
  assert.deepEqual(parseDeepLinkParams(''), { typeId: null, date: null });
});

test('parseDeepLinkParams: rejects a malformed date instead of passing it through unescaped', () => {
  assert.deepEqual(parseDeepLinkParams('?type=7&date=not-a-date'), { typeId: 7, date: null });
  assert.deepEqual(parseDeepLinkParams('?type=7&date=2026-3-1'), { typeId: 7, date: null });
});

test('parseDeepLinkParams: rejects a non-positive or non-numeric type', () => {
  assert.deepEqual(parseDeepLinkParams('?type=0'), { typeId: null, date: null });
  assert.deepEqual(parseDeepLinkParams('?type=-1'), { typeId: null, date: null });
  assert.deepEqual(parseDeepLinkParams('?type=abc'), { typeId: null, date: null });
});

test('deepLinkSelectors: null when there is no type to link to', () => {
  assert.equal(deepLinkSelectors({ typeId: null, date: null }), null);
});

test('deepLinkSelectors: a type + date targets the occurrence row, with a card fallback', () => {
  const selectors = deepLinkSelectors({ typeId: 7, date: '2026-03-01' });
  assert.equal(selectors.rowSelector, '.waste-occurrence-row[data-type-id="7"][data-date="2026-03-01"]');
  assert.equal(selectors.cardSelector, '.waste-type-card[data-type-id="7"]');
});

test('deepLinkSelectors: a type alone has no row selector, only the card fallback', () => {
  const selectors = deepLinkSelectors({ typeId: 7, date: null });
  assert.equal(selectors.rowSelector, null);
  assert.equal(selectors.cardSelector, '.waste-type-card[data-type-id="7"]');
});

// -------------------------------------------------------------------------
// splitUpcomingByType / deepLinkNeedsExpand - the collapsed "rest" section
// -------------------------------------------------------------------------

function occ(typeId, dateKey) {
  return { key: `${typeId}:${dateKey}`, date_key: dateKey, type_id: typeId };
}

test('splitUpcomingByType: one primary row per type (its earliest, since occurrences arrive date-sorted), everything else in rest', () => {
  const occurrences = [
    occ(1, '2026-01-05'), occ(2, '2026-01-06'), occ(1, '2026-01-12'), occ(1, '2026-01-19'), occ(2, '2026-01-13'),
  ];
  const { primary, rest } = splitUpcomingByType(occurrences);
  assert.deepEqual(primary.map((o) => o.key), ['1:2026-01-05', '2:2026-01-06'], 'the first occurrence encountered per type is primary');
  assert.deepEqual(rest.map((o) => o.key), ['1:2026-01-12', '1:2026-01-19', '2:2026-01-13']);
});

test('splitUpcomingByType: a single occurrence per type leaves rest empty', () => {
  const { primary, rest } = splitUpcomingByType([occ(1, '2026-01-05'), occ(2, '2026-01-06')]);
  assert.equal(primary.length, 2);
  assert.equal(rest.length, 0);
});

test('deepLinkNeedsExpand: false without a type/date, or when the target is a type\'s own primary row', () => {
  const occurrences = [occ(1, '2026-01-05'), occ(1, '2026-01-12')];
  assert.equal(deepLinkNeedsExpand(occurrences, { typeId: null, date: null }), false);
  assert.equal(deepLinkNeedsExpand(occurrences, { typeId: 1, date: null }), false);
  assert.equal(deepLinkNeedsExpand(occurrences, { typeId: 1, date: '2026-01-05' }), false, 'the primary row is already visible without expanding');
});

test('deepLinkNeedsExpand: true when the target date only exists in the collapsed rest section', () => {
  const occurrences = [occ(1, '2026-01-05'), occ(1, '2026-01-12')];
  assert.equal(deepLinkNeedsExpand(occurrences, { typeId: 1, date: '2026-01-12' }), true);
});

// -------------------------------------------------------------------------
// recurrenceSummary - the text a schedule row actually shows
// -------------------------------------------------------------------------

test('recurrenceSummary: weekly, single interval, joins weekday labels', () => {
  const schedule = { recurrence_kind: 'weekly', weekdays: 'MO,TH', interval: 1 };
  const days = 'waste.weekdayMon, waste.weekdayThu';
  assert.equal(recurrenceSummary(schedule), `waste.summaryWeekly{"days":"${days}"}`);
});

test('recurrenceSummary: weekly with interval > 1 uses the interval-aware key', () => {
  const schedule = { recurrence_kind: 'weekly', weekdays: 'MO', interval: 2 };
  assert.equal(recurrenceSummary(schedule), 'waste.summaryWeeklyInterval{"interval":2,"days":"waste.weekdayMon"}');
});

test('recurrenceSummary: monthly fixed day', () => {
  const schedule = { recurrence_kind: 'monthly_fixed_day', month_day: 15, interval: 1 };
  assert.equal(recurrenceSummary(schedule), 'waste.summaryMonthly{"day":"waste.summaryMonthDayN{\\"day\\":15}"}');
});

test('recurrenceSummary: monthly last-day-of-month uses the dedicated label, not summaryMonthDayN', () => {
  const schedule = { recurrence_kind: 'monthly_fixed_day', month_day: -1, interval: 1 };
  assert.equal(recurrenceSummary(schedule), 'waste.summaryMonthly{"day":"waste.monthDayLastDay"}');
});

test('recurrenceSummary: monthly with interval > 1 uses the interval-aware key', () => {
  const schedule = { recurrence_kind: 'monthly_fixed_day', month_day: 1, interval: 3 };
  assert.equal(recurrenceSummary(schedule), 'waste.summaryMonthlyInterval{"interval":3,"day":"waste.summaryMonthDayN{\\"day\\":1}"}');
});

// -------------------------------------------------------------------------
// originBadges - provenance visibility (invariant #3/#4)
// -------------------------------------------------------------------------

test('originBadges: an unmoved, non-coalesced occurrence shows no badges', () => {
  const occurrence = { moved: false, coalesced: false, origins: [{ kind: 'schedule', moved: false }] };
  assert.equal(originBadges(occurrence), '');
});

test('originBadges: a moved occurrence names its original date', () => {
  const occurrence = {
    moved: true, coalesced: false,
    origins: [{ kind: 'schedule', moved: true, original_date: '2026-01-12' }],
  };
  assert.match(originBadges(occurrence), /waste-badge--moved/);
  assert.match(originBadges(occurrence), /waste\.movedFromBadge/);
});

test('originBadges: a coalesced occurrence names the overlap, so editing one origin never looks like it erased the other', () => {
  const occurrence = {
    moved: false, coalesced: true,
    origins: [{ kind: 'schedule', moved: false }, { kind: 'one_off', moved: false }],
  };
  assert.match(originBadges(occurrence), /waste-badge--coalesced/);
});

test('originBadges: a moved AND coalesced occurrence shows both badges', () => {
  const occurrence = {
    moved: true, coalesced: true,
    origins: [{ kind: 'schedule', moved: true, original_date: '2026-01-12' }, { kind: 'one_off', moved: false }],
  };
  const html = originBadges(occurrence);
  assert.match(html, /waste-badge--moved/);
  assert.match(html, /waste-badge--coalesced/);
});

// -------------------------------------------------------------------------
// Import wizard pure helpers (#1063 Phase 3)
// -------------------------------------------------------------------------

test('defaultLabelDecision: remembered_ignored beats remembered_type_id beats suggested_type_id beats "create new"', () => {
  assert.equal(defaultLabelDecision({ remembered_ignored: true, remembered_type_id: 5, suggested_type_id: 9 }), '');
  assert.equal(defaultLabelDecision({ remembered_ignored: false, remembered_type_id: 5, suggested_type_id: 9 }), '5');
  assert.equal(defaultLabelDecision({ remembered_ignored: false, remembered_type_id: null, suggested_type_id: 9 }), '9');
  assert.equal(defaultLabelDecision({ remembered_ignored: false, remembered_type_id: null, suggested_type_id: null }), '__new__');
});

test('unresolvedBlockingDiagnostics: only blocking diagnostics count, and an explicit skip resolves one', () => {
  const diagnostics = [
    { severity: 'info', code: 'cancelled_excluded', event_key: null },
    { severity: 'blocking', code: 'unbounded_recurrence', event_key: 'uid:a' },
    { severity: 'blocking', code: 'unsupported_rdate', event_key: 'uid:b' },
  ];
  assert.equal(unresolvedBlockingDiagnostics(diagnostics, []).length, 2);
  assert.equal(unresolvedBlockingDiagnostics(diagnostics, ['uid:a']).length, 1);
  assert.equal(unresolvedBlockingDiagnostics(diagnostics, ['uid:a', 'uid:b']).length, 0);
});

test('buildMappingDecisions: builds type_id / new_type / ignored entries from each row\'s decision', () => {
  const rows = [
    { normalized_label: 'restmüll', decision: '5', newTypeName: '' },
    { normalized_label: 'papier', decision: '__new__', newTypeName: 'Papier' },
    { normalized_label: 'sperrmüll', decision: '', newTypeName: '' },
  ];
  const { mappings, error } = buildMappingDecisions(rows);
  assert.equal(error, undefined);
  assert.deepEqual(mappings, [
    { normalized_label: 'restmüll', type_id: 5 },
    { normalized_label: 'papier', new_type: { name: 'Papier' } },
    { normalized_label: 'sperrmüll', ignored: true },
  ]);
});

test('buildMappingDecisions: a "create new" decision without a name reports an error instead of committing a blank type', () => {
  const rows = [{ normalized_label: 'papier', decision: '__new__', newTypeName: '  ' }];
  const result = buildMappingDecisions(rows);
  assert.equal(result.error, 'missing_new_type_name');
  assert.equal(result.label, 'papier');
});

test('sourceHealthBadgeInfo: an error takes priority over needs_refresh, and a healthy source shows nothing', () => {
  assert.equal(sourceHealthBadgeInfo({ last_error: 'boom', needs_refresh: true }).code, 'error');
  assert.equal(sourceHealthBadgeInfo({ last_error: null, needs_refresh: true }).code, 'needs-refresh');
  assert.equal(sourceHealthBadgeInfo({ last_error: null, needs_refresh: false }), null);
});

// -------------------------------------------------------------------------
// nearestOrdinalAnchorDateKey - Anker-Vorbelegung fuer Ordinal-Schedules
// (#1063 Phase 9)
// -------------------------------------------------------------------------






function inTimezone(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
}

test('nearestOrdinalAnchorDateKey: this month\'s occurrence when it is today or later, else next month\'s - in any timezone', () => {
  for (const tz of ['America/Los_Angeles', 'Pacific/Auckland', 'UTC']) {
    inTimezone(tz, () => {

      assert.equal(nearestOrdinalAnchorDateKey(2, 'MO', '2026-09-13'), '2026-09-14', `zweiter Montag unter ${tz}`);

      assert.equal(nearestOrdinalAnchorDateKey(1, 'MO', '2026-09-13'), '2026-10-05', `erster Montag unter ${tz}`);
      // "Letzter Freitag": Rueckwaertssuche vom Monatsletzten (Mi, 30.09.) aus.
      assert.equal(nearestOrdinalAnchorDateKey(-1, 'FR', '2026-09-13'), '2026-09-25', `letzter Freitag unter ${tz}`);

      assert.equal(nearestOrdinalAnchorDateKey(2, 'MO', '2026-09-14'), '2026-09-14', `heutiges Vorkommen unter ${tz}`);
    });
  }
});

// -------------------------------------------------------------------------
// Zeilengrammatik: EIN "..."-Menue statt nackter Icon-Knoepfe (Audit UX,




// jeweilige Pfeil, statt ausgegraut dazustehen.
// -------------------------------------------------------------------------

const TYPE = { id: 7, name: 'Restmüll', icon: 'trash-2', color: '#64748B', archived: false };

test('typeCardHtml: die drei nackten Icon-Knoepfe sind einem einzigen "..."-Menue gewichen', () => {
  const html = typeCardHtml(TYPE, 1, 3);

  assert.equal((html.match(/class="row-action"/g) ?? []).length, 1);
  assert.match(html, /popovertarget="waste-type-menu-7"/);
  assert.match(html, /<div class="popover-menu" id="waste-type-menu-7" popover role="menu">/);


  // popoverMenuHtml() fuer sein eigenes Menue setzt.
  assert.match(html, /class="row-action" popovertarget="waste-type-menu-7" aria-haspopup="menu" aria-expanded="false"/);


  for (const action of ['move-type-up', 'move-type-down', 'add-schedule']) {
    assert.match(html, new RegExp(`class="popover-menu__item" data-action="${action}"`), `${action} fehlt im Menue`);
  }

  assert.doesNotMatch(html, /popover-menu__item--danger/);
});

test('typeCardHtml: der Datenschluessel jeder Aktion ueberlebt den Umzug ins Menue', () => {
  const html = typeCardHtml(TYPE, 1, 3);
  // Der delegierte Handler liest `dataset.id` bzw. `dataset.typeId` DIREKT am

  // wirkungslos geworden.
  assert.match(html, /data-action="move-type-up" data-id="7"/);
  assert.match(html, /data-action="add-schedule" data-type-id="7"/);
});

test('typeCardHtml: an den Enden der Liste fehlt der jeweilige Pfeil, statt tot dazustehen', () => {
  const first = typeCardHtml(TYPE, 0, 3);
  assert.doesNotMatch(first, /move-type-up/, 'die erste Abfallart kann nicht weiter nach oben');
  assert.match(first, /move-type-down/);

  const last = typeCardHtml(TYPE, 2, 3);
  assert.match(last, /move-type-up/);
  assert.doesNotMatch(last, /move-type-down/, 'die letzte Abfallart kann nicht weiter nach unten');


  assert.doesNotMatch(first + last, /\bdisabled\b/);
});

test('typeCardHtml: bei genau einer Abfallart bleibt nur das Anlegen einer Serie uebrig', () => {
  const only = typeCardHtml(TYPE, 0, 1);
  assert.doesNotMatch(only, /move-type-up|move-type-down/, 'Sortieren gibt es bei einer einzigen Art nicht');
  assert.match(only, /data-action="add-schedule"/);
});

test('scheduleRowHtml: die Loeschung liegt hinter dem Menue und ist als gefaehrlich markiert', () => {
  const html = scheduleRowHtml({ id: 42, type_id: 7, active: true, freq: 'weekly', weekday: 1, interval: 1 });
  assert.equal((html.match(/class="row-action"/g) ?? []).length, 1);
  assert.match(html, /popovertarget="waste-schedule-menu-42"/);
  assert.match(html, /<div class="popover-menu" id="waste-schedule-menu-42" popover role="menu">/);
  assert.match(html, /class="row-action" popovertarget="waste-schedule-menu-42" aria-haspopup="menu" aria-expanded="false"/);
  assert.match(html, /class="popover-menu__item popover-menu__item--danger" data-action="delete-schedule" data-id="42"/);

  // daneben loeschte vorher sofort eine ganze Serie.
  assert.doesNotMatch(html, /class="row-action" data-action="delete-schedule"/);
});

test('scheduleRowHtml: eine pausierte Serie traegt ihren eigenen Chip', () => {
  const paused = scheduleRowHtml({ id: 43, type_id: 7, active: false, freq: 'weekly', weekday: 1, interval: 1 });
  assert.match(paused, /class="waste-badge waste-badge--paused"/);
  const active = scheduleRowHtml({ id: 44, type_id: 7, active: true, freq: 'weekly', weekday: 1, interval: 1 });
  assert.doesNotMatch(active, /waste-badge--paused/);
});

test('sourceRowHtml: die wechselnde Zeilenaktion traegt im Menue endlich ihren Satz', () => {


  const url = sourceRowHtml({ id: 3, kind: 'url', name: 'Stadt', needs_mapping: false });
  assert.match(url, /popovertarget="waste-source-menu-3"/);
  assert.match(url, /data-action="refresh-source" data-id="3"/);
  assert.match(url, /waste\.refreshNowAction/, 'der Eintrag traegt seine eigene Beschriftung');
  assert.match(url, /class="row-action" popovertarget="waste-source-menu-3" aria-haspopup="menu" aria-expanded="false"/);

  const needsMapping = sourceRowHtml({ id: 4, kind: 'url', name: 'Stadt', needs_mapping: true });
  assert.match(needsMapping, /data-action="review-source-mapping" data-id="4"/);

  const file = sourceRowHtml({ id: 5, kind: 'file', name: 'kalender.ics', needs_mapping: false });
  assert.match(file, /data-action="reimport-source" data-id="5"/);


  assert.doesNotMatch(url + file, /delete-source|popover-menu__item--danger/);
});

test('sourceRowHtml: jede Quelle bekommt ihr eigenes Menue', () => {
  const a = sourceRowHtml({ id: 3, kind: 'url', name: 'A', needs_mapping: false });
  const b = sourceRowHtml({ id: 9, kind: 'url', name: 'B', needs_mapping: false });
  assert.match(a, /id="waste-source-menu-3"/);
  assert.match(b, /id="waste-source-menu-9"/);
});

// -------------------------------------------------------------------------

//








// Symbol ueber statt neben den Namen.
//




// -------------------------------------------------------------------------

test('alle vier "..."-Knoepfe kuendigen ein Menue an, auch der vorbestehende der Abholzeile (Review PR #1146)', () => {
  // popoverMenuHtml() setzt aria-haspopup="menu" aria-expanded="false" fuer
  // sein eigenes Menue; die vier `.row-action`-Knoepfe (Abholung, Serie,



  const rowActionButtons = WASTE_SRC.match(/<button type="button" class="row-action"[^>]*>/g) ?? [];
  assert.equal(rowActionButtons.length, 4, 'Abholung, Serie, Abfallart und Quelle');
  for (const btn of rowActionButtons) {
    assert.match(btn, /aria-haspopup="menu"/, `${btn} kuendigt kein Menue an`);
    assert.match(btn, /aria-expanded="false"/, `${btn} traegt keinen Anfangszustand`);
  }
});

test('jede Zeile des Moduls traegt die gemeinsame Marke waste-row', () => {

  // haengen alle an `.waste-row > .list-row__main`.
  const rows = [
    typeCardHtml({ id: 1, name: 'A', color: '#16A34A' }, 0, 1),
    scheduleRowHtml({ id: 2, type_id: 1, recurrence_kind: 'weekly', interval: 1, weekdays: 'MO', active: true }),
    sourceRowHtml({ id: 3, kind: 'url', name: 'Q', needs_mapping: false }),
  ];
  for (const html of rows) {
    assert.match(html, /class="list-row waste-row /, 'die Marke steht direkt neben .list-row');
  }


  assert.match(WASTE_SRC, /class="list-row waste-row waste-occurrence-row"/);
});

test('der Zeilenkoerper traegt IMMER die Basisklasse, --interactive nur zusaetzlich', () => {



  const solo = WASTE_CODE.match(/class="[^"]*list-row__main--interactive[^"]*"/g) ?? [];
  assert.ok(solo.length >= 3, 'die drei schreibbaren Zeilenkoerper muessen auffindbar bleiben');
  for (const cls of solo) {
    assert.match(cls, /list-row__main(?!--)/, `${cls} braucht die Basisklasse list-row__main`);
  }
});

// -------------------------------------------------------------------------
// Farbpalette der Abfallart (Audit UX, 2026-09-12)
// -------------------------------------------------------------------------

test('WASTE_TYPE_COLORS: jede Preset-Farbe liegt im Raster', () => {


  for (const preset of TYPE_PRESETS) {
    assert.ok(WASTE_TYPE_COLORS.includes(preset.color),
      `Preset ${preset.key} (${preset.color}) fehlt in WASTE_TYPE_COLORS`);
  }
});

test('WASTE_TYPE_COLORS: eine kuratierte Auswahl ohne Dubletten und ohne Extremwerte', () => {
  assert.equal(new Set(WASTE_TYPE_COLORS).size, WASTE_TYPE_COLORS.length, 'keine doppelten Farben');
  assert.ok(WASTE_TYPE_COLORS.length >= 8, 'zu wenig Auswahl ist auch keine');
  for (const hex of WASTE_TYPE_COLORS) {
    assert.match(hex, /^#[0-9A-F]{6}$/, `${hex} ist kein normalisierter Hex-Wert`);



    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    assert.ok(luminance > 0.08 && luminance < 0.72,
      `${hex} liegt ausserhalb des Helligkeitsbands der Palette (${luminance.toFixed(3)})`);
  }
});

// -------------------------------------------------------------------------
// Quelltext-Zusicherungen (Audit UX, 2026-09-12).
//







// Nur-lesen-Mitglied ins Markup rutscht.
// -------------------------------------------------------------------------

test('die Seite hat einen sichtbaren, beschrifteten Weg zur ersten Abfallart, und das Ueberlaufmenue bietet ihn nicht doppelt an', () => {

  // frische Installation zeigte keinen einzigen sichtbaren Weg zur ersten
  // Abfallart.
  //








  assert.match(WASTE_SRC, /class="btn btn--secondary" id="waste-add-type-btn" data-action="add-type"/);
  assert.doesNotMatch(WASTE_CODE, /class="btn btn--primary" id="waste-add-type-btn"/);

  assert.equal((WASTE_SRC.match(/data-action="add-type"/g) ?? []).length, 1);
  assert.doesNotMatch(WASTE_SRC, /action: 'add-type'/, 'add-type darf nicht mehr im Ueberlaufmenue stehen');

  for (const a of ['open-import', 'open-url-source', 'open-reminder-settings']) {
    assert.match(WASTE_SRC, new RegExp(`action: '${a}'`), `${a} gehoert weiter ins Ueberlaufmenue`);
  }
});

test('der neue Kopfknopf traegt bewusst KEIN toolbar-new-btn', () => {

  // (`body:has(.toolbar-new-btn:not([hidden])) #fab-layer .page-fab`). Der FAB

  // Klasse waere die Abholung am Desktop ersatzlos verschwunden.
  assert.doesNotMatch(WASTE_CODE, /toolbar-new-btn/);
  assert.match(WASTE_SRC, /class="page-fab" id="waste-fab-new-pickup"/, 'der FAB bleibt, wo er war');
});

test('der FAB fuehrt ohne Abfallart nicht mehr ins Leere', () => {


  const branch = WASTE_SRC.match(/if \(!state\.types\.filter\([\s\S]{0,400}?\n {4}\}/);
  assert.ok(branch, 'der Zweig ohne Abfallart muss auffindbar bleiben');
  assert.match(branch[0], /openTypeModal\(\)/, 'der Hinweis muss jetzt auch den Weg oeffnen');


  assert.match(branch[0], /waste\.addTypeFirstHint/);
});

test('beide Leerzustaende bieten ihren Weg an - und beide nur dem, der schreiben darf', () => {

  // anzubieten ("Importiere eine ICS-Datei deiner Kommune...").
  assert.match(WASTE_SRC, /action: readOnly\(\) \? null : \{ label: t\('waste\.addType'\)/);
  assert.match(WASTE_SRC, /action: readOnly\(\) \? null : \{ label: t\('waste\.importFileAction'\)/);
  assert.match(WASTE_SRC, /#waste-empty-add-source'\)\?\.addEventListener\('click', \(\) => openImportWizard\(\)\)/);
});

test('jeder Schreib-Weg im Kopf bleibt hinter dem Nur-lesen-Riegel', () => {


  assert.match(WASTE_SRC, /actions: readOnly\(\) \? '' : renderPageActions\(\[/);

  assert.equal((WASTE_SRC.match(/\$\{ro \? '' : `\n\s*<div class="row-actions">/g) ?? []).length, 2,
    'Serien- und Typzeile unterdruecken ihre Aktionen ueber dasselbe `ro`');
  assert.match(WASTE_SRC, /\$\{readOnly\(\) \? '' : `\n\s*<div class="row-actions">/, 'die Quellenzeile ebenso');
});

test('der freie Farbwaehler ist aus dem Abfallart-Dialog verschwunden', () => {


  assert.doesNotMatch(WASTE_CODE, /type="color"/);
  assert.doesNotMatch(WASTE_CODE, /form-input--color/);
  assert.match(WASTE_SRC, /class="waste-color-picker" role="radiogroup" aria-labelledby="wtm-color-label"/);
  // Die gespeicherte Farbe gewinnt ihren eigenen Swatch, statt still ersetzt

  // Hex-Werte.
  assert.match(WASTE_SRC, /WASTE_TYPE_COLORS\.includes\(selColorUpper\) \? WASTE_TYPE_COLORS : \[\.\.\.WASTE_TYPE_COLORS, selColor\]/);
});

// -------------------------------------------------------------------------
// resolveSwatchColors - Gross-/Kleinschreibung des gespeicherten Hex-Werts
// (Review PR #1146, "should fix" 1). `<input type="color">` liefert seinen






// -------------------------------------------------------------------------

test('resolveSwatchColors: ein kleingeschriebener gespeicherter Wert trifft seinen Palette-Swatch statt einen elften anzuhaengen', () => {
  const { swatchColors, selColorUpper } = resolveSwatchColors('#16a34a');
  assert.equal(selColorUpper, '#16A34A');
  assert.deepEqual(swatchColors, WASTE_TYPE_COLORS, 'kein elfter "Aktuelle Farbe"-Swatch fuer eine Palettenfarbe, nur anders geschrieben');
  assert.ok(swatchColors.some((c) => c.toUpperCase() === selColorUpper), 'ein Swatch des Rasters muss auf den Wert passen');
});

test('resolveSwatchColors: eine Farbe ausserhalb der Palette bekommt weiterhin genau einen zusaetzlichen Swatch', () => {
  const { swatchColors, selColorUpper } = resolveSwatchColors('#123456');
  assert.equal(selColorUpper, '#123456');
  assert.equal(swatchColors.length, WASTE_TYPE_COLORS.length + 1);
  assert.equal(swatchColors.at(-1), '#123456', 'der Altwert bleibt in seiner eigenen Schreibweise erhalten');
});

test('resolveSwatchColors: bereits grossgeschriebene Palettenfarben verhalten sich unveraendert', () => {
  const { swatchColors } = resolveSwatchColors('#2563EB');
  assert.deepEqual(swatchColors, WASTE_TYPE_COLORS);
});

// -------------------------------------------------------------------------
// activeSwatchColor - Speichern liest den TATSAECHLICH aktiven Swatch




// Dateikopf: Full modal open/save braucht einen echten DOM).
// -------------------------------------------------------------------------

function stubSwatchPanel(activeColor) {
  return {
    querySelector(selector) {
      if (selector === '.waste-color-swatch--active') {
        return activeColor === null ? null : { dataset: { color: activeColor } };
      }
      return null;
    },
  };
}

test('activeSwatchColor: liest die Farbe des aktiven Swatch, nicht die Oeffnungsfarbe', () => {
  const panel = stubSwatchPanel('#DC2626');
  assert.equal(activeSwatchColor(panel, '#16A34A'), '#DC2626', 'ein neu angeklickter Swatch muss gewinnen, nicht der Stand beim Oeffnen');
});

test('activeSwatchColor: faellt ohne aktiven Swatch auf die uebergebene Oeffnungsfarbe zurueck', () => {
  const panel = stubSwatchPanel(null);
  assert.equal(activeSwatchColor(panel, '#16A34A'), '#16A34A');
});
