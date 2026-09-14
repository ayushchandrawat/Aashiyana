import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

global.HTMLElement = class HTMLElement {};
global.customElements = { define() {}, get() { return undefined; } };

function makeBulkPillLayer() {
  const handlers = {};
  return {
    dataset: {},
    contains: () => false,
    addEventListener(type, handler) { handlers[type] = handler; },
    replaceChildren() { this.replaceChildrenCalls = (this.replaceChildrenCalls ?? 0) + 1; },
    replaceChildrenCalls: 0,
    querySelector: () => null,
    fire(type, evt = {}) { handlers[type]?.(evt); },
  };
}
const bulkPillLayer = makeBulkPillLayer();

global.window = {
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  aashiyana: {},
};
global.document = {
  getElementById: (id) => (id === 'bulk-pill-layer' ? bulkPillLayer : null),
  createElement: () => Object.assign(new global.HTMLElement(), {
    style: {}, setAttribute() {}, appendChild() {}, addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
  }),
  addEventListener() {},
  documentElement: { lang: 'de' },
};



function makeMemoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
  };
}
global.localStorage = makeMemoryStorage();

const { __test } = await import('../public/pages/shopping.js');

function resetShoppingState() {



  __test.intents.clear();
  __test.pendingRemovals.clear();
  __test.resetLoadOrderForTest();
  __test.state.items = [];
  __test.state.categories = [];


  __test.state.listsError = null;
  __test.state.itemsError = null;
  __test.state.activeListId = 1;
  __test.state.currentUserId = 7;
  __test.state.collapsedCategories = new Set();
  __test.resetPillMachine();
  __test.setPillInteractingForTest(false);
  __test.setBulkPillHoldMsForTest(null);
  bulkPillLayer.replaceChildrenCalls = 0;
  global.localStorage.clear();
}

function makeCategoryGroup(key, { collapsed = false } = {}) {
  const rowsEl = { hidden: collapsed };
  const chevron = {
    _collapsed: collapsed,
    classList: {
      toggle(cls, on) { if (cls === 'list-group__chevron--collapsed') chevron._collapsed = on; },
    },
  };
  const groupEl = {
    _sel: '.list-group',
    querySelector(sel) {
      if (sel === '.list-rows') return rowsEl;
      return null;
    },
  };
  const button = {
    dataset: { categoryToggle: key },
    _attrs: { 'aria-expanded': String(!collapsed) },
    setAttribute(k, v) { button._attrs[k] = v; },
    getAttribute(k) { return button._attrs[k] ?? null; },
    closest(sel) { return sel === '.list-group' ? groupEl : null; },
    querySelector(sel) { return sel === '.list-group__chevron' ? chevron : null; },
  };
  return { button, rowsEl, chevron };
}

// --------------------------------------------------------
// Kategorie-Einklappen: stabiler Schluessel
// --------------------------------------------------------

test('categoryStorageKey: bekannte Kategorie traegt ihre ID, nicht ihren Namen', () => {
  resetShoppingState();
  __test.state.categories = [{ id: 42, name: 'Obst & Gemüse', icon: 'apple' }];
  assert.equal(__test.categoryStorageKey('Obst & Gemüse'), 'id:42');


  __test.state.categories[0].name = 'Frisches Obst & Gemüse';
  assert.equal(__test.categoryStorageKey('Frisches Obst & Gemüse'), 'id:42');
});

test('categoryStorageKey: unbekannte/geloeschte Kategorie faellt auf den normalisierten Namen zurueck', () => {
  resetShoppingState();
  __test.state.categories = [];
  assert.equal(__test.categoryStorageKey('Sonstiges'), 'name:sonstiges');
  assert.equal(__test.categoryStorageKey('  SONSTIGES  '), 'name:sonstiges');
});

// --------------------------------------------------------
// Kategorie-Einklappen: Speicherung, Scoping, Validierung
// --------------------------------------------------------

test('loadCollapsedCategories/saveCollapsedCategories: Rundreise ueber localStorage', () => {
  resetShoppingState();
  __test.saveCollapsedCategories(7, 1, new Set(['id:1', 'id:2']));
  const loaded = __test.loadCollapsedCategories(7, 1);
  assert.deepEqual([...loaded].sort(), ['id:1', 'id:2']);
});

test('loadCollapsedCategories: scoped je Nutzer UND je Liste - keine Ueberdeckung', () => {
  resetShoppingState();
  __test.saveCollapsedCategories(7, 1, new Set(['id:1']));

  // Anderer Nutzer, gleiche Liste: sieht nichts vom ersten.
  assert.deepEqual([...__test.loadCollapsedCategories(9, 1)], []);
  // Gleicher Nutzer, andere Liste: sieht ebenfalls nichts.
  assert.deepEqual([...__test.loadCollapsedCategories(7, 2)], []);
  // Genau dieselbe Kombination: sieht den gespeicherten Zustand.
  assert.deepEqual([...__test.loadCollapsedCategories(7, 1)], ['id:1']);
});

test('loadCollapsedCategories: kaputte/fremde Werte fallen sicher auf eine leere Menge zurueck', () => {
  resetShoppingState();
  const key = __test.collapsedCategoriesStorageKey(7, 1);

  global.localStorage.setItem(key, 'kein-json{{{');
  assert.deepEqual([...__test.loadCollapsedCategories(7, 1)], [], 'kaputtes JSON darf nicht werfen');

  global.localStorage.setItem(key, JSON.stringify({ version: 999, collapsed: ['id:1'] }));
  assert.deepEqual([...__test.loadCollapsedCategories(7, 1)], [], 'eine fremde Version darf nicht blind uebernommen werden');

  global.localStorage.setItem(key, JSON.stringify({ version: 1, collapsed: 'id:1' }));
  assert.deepEqual([...__test.loadCollapsedCategories(7, 1)], [], 'collapsed muss ein Array sein');
});

test('pruneCollapsedCategories: entfernt Schluessel geloeschter Kategorien, behaelt gueltige', () => {
  resetShoppingState();
  __test.state.categories = [{ id: 1, name: 'Obst', icon: 'apple' }];
  __test.state.collapsedCategories = new Set(['id:1', 'id:99', 'name:veraltet']);


  __test.pruneCollapsedCategories([['Obst', [{ id: 100 }]]]);

  assert.deepEqual([...__test.state.collapsedCategories], ['id:1'],
    'id:99 (geloeschte Kategorie) und name:veraltet (verschwundene Unbekannt-Gruppe) muessen weg sein');

  assert.deepEqual([...__test.loadCollapsedCategories(7, 1)], ['id:1']);
});

test('pruneCollapsedCategories: ruehrt nichts an, wenn alles noch gueltig ist (kein unnoetiger Schreibzugriff)', () => {
  resetShoppingState();
  __test.state.categories = [{ id: 1, name: 'Obst', icon: 'apple' }];
  __test.state.collapsedCategories = new Set(['id:1']);
  __test.saveCollapsedCategories(7, 1, new Set(['id:1']));

  __test.pruneCollapsedCategories([['Obst', [{ id: 100 }]]]);
  assert.deepEqual([...__test.state.collapsedCategories], ['id:1']);
});

// --------------------------------------------------------
// Kategorie-Einklappen: der Umschalter selbst
// --------------------------------------------------------

test('toggleCategoryCollapse: klappt zu, meldet aria-expanded/hidden/Chevron und speichert', () => {
  resetShoppingState();
  const { button, rowsEl, chevron } = makeCategoryGroup('id:1', { collapsed: false });

  __test.toggleCategoryCollapse(button);

  assert.equal(rowsEl.hidden, true, 'die Zeilen bleiben im DOM, werden aber ausgeblendet');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(chevron._collapsed, true);
  assert.deepEqual([...__test.state.collapsedCategories], ['id:1']);
  assert.deepEqual([...__test.loadCollapsedCategories(7, 1)], ['id:1'], 'persistiert sofort');
});

test('toggleCategoryCollapse: klappt wieder auf (Gegenprobe der Umkehrung)', () => {
  resetShoppingState();
  __test.state.collapsedCategories = new Set(['id:1']);
  const { button, rowsEl, chevron } = makeCategoryGroup('id:1', { collapsed: true });

  __test.toggleCategoryCollapse(button);

  assert.equal(rowsEl.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(chevron._collapsed, false);
  assert.deepEqual([...__test.state.collapsedCategories], []);
});

test('toggleCategoryCollapse: eine neue Kategorie ist ohne Zutun aufgeklappt', () => {



  resetShoppingState();
  assert.equal(__test.state.collapsedCategories.has('id:123'), false);
});

// --------------------------------------------------------
// Sammelaktions-Pille: Zustandsautomat
// --------------------------------------------------------

const fakeContainer = () => ({ isConnected: true });

test('updateCheckedActions: vorbelegte (geladene) Artikel zeigen KEINE Pille', () => {



  resetShoppingState();
  __test.state.items = [{ id: 1, is_checked: 1 }, { id: 2, is_checked: 0 }];
  __test.updateCheckedActions(fakeContainer());
  assert.equal(__test.getPillPhaseForTest(), 'idle');
});

test('updateCheckedActions: ein echter Abhak-Treffer aus dem Ruhezustand oeffnet die Pille', () => {
  resetShoppingState();
  __test.state.items = [{ id: 1, is_checked: 1 }];
  __test.updateCheckedActions(fakeContainer(), { userChecked: true });
  assert.equal(__test.getPillPhaseForTest(), 'visible');
});

test('updateCheckedActions: zurueck auf 0 setzt den Automaten in den Ruhezustand', () => {
  resetShoppingState();
  __test.state.items = [{ id: 1, is_checked: 1 }];
  __test.updateCheckedActions(fakeContainer(), { userChecked: true });
  assert.equal(__test.getPillPhaseForTest(), 'visible');

  __test.state.items = [{ id: 1, is_checked: 0 }];
  __test.updateCheckedActions(fakeContainer());
  assert.equal(__test.getPillPhaseForTest(), 'idle');
});

test('updateCheckedActions: die Frist startet NICHT bei jedem weiteren Treffer neu', async () => {
  resetShoppingState();
  __test.setBulkPillHoldMsForTest(50);

  __test.state.items = [{ id: 1, is_checked: 1 }];
  __test.updateCheckedActions(fakeContainer(), { userChecked: true }); // t=0, Frist bis ~50ms

  await new Promise((r) => setTimeout(r, 30));
  __test.state.items = [{ id: 1, is_checked: 1 }, { id: 2, is_checked: 1 }];


  __test.updateCheckedActions(fakeContainer(), { userChecked: true }); // t=30ms
  assert.equal(__test.getPillPhaseForTest(), 'visible', 'Zahl/Aktionen aktualisiert, Frist unangetastet');




  // laengst abgelaufen.
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(__test.getPillPhaseForTest(), 'suppressed',
    'die Frist muss ab dem ERSTEN Treffer laufen, nicht ab dem letzten');
});

test('updateCheckedActions: derselbe Batch zeigt sich nach dem Ausblenden nicht erneut', async () => {
  resetShoppingState();
  __test.setBulkPillHoldMsForTest(20);

  __test.state.items = [{ id: 1, is_checked: 1 }];
  __test.updateCheckedActions(fakeContainer(), { userChecked: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(__test.getPillPhaseForTest(), 'suppressed');



  __test.state.items = [{ id: 1, is_checked: 1 }, { id: 2, is_checked: 1 }];
  __test.updateCheckedActions(fakeContainer(), { userChecked: true });
  assert.equal(__test.getPillPhaseForTest(), 'suppressed');


  __test.state.items = [{ id: 1, is_checked: 0 }, { id: 2, is_checked: 0 }];
  __test.updateCheckedActions(fakeContainer());
  assert.equal(__test.getPillPhaseForTest(), 'idle');

  __test.state.items = [{ id: 1, is_checked: 1 }, { id: 2, is_checked: 0 }];
  __test.updateCheckedActions(fakeContainer(), { userChecked: true });
  assert.equal(__test.getPillPhaseForTest(), 'visible');
});

test('updateCheckedActions: Hover/Fokus auf der Pille schiebt das Ausblenden auf, bis die Interaktion endet', async () => {
  resetShoppingState();
  __test.setBulkPillHoldMsForTest(20);

  __test.state.items = [{ id: 1, is_checked: 1 }];
  __test.updateCheckedActions(fakeContainer(), { userChecked: true });
  __test.setPillInteractingForTest(true);

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(__test.getPillPhaseForTest(), 'deferred',
    'die Frist ist um, aber die Interaktion haelt die Pille noch offen');


  bulkPillLayer.fire('mouseleave');
  assert.equal(__test.getPillPhaseForTest(), 'suppressed');
});

test('das Ende einer Interaktion loescht die geteilte Schicht nicht mehr, wenn die Seite laengst verlassen ist', async () => {




  // Einkaufsbesuch war.
  resetShoppingState();
  __test.setBulkPillHoldMsForTest(20);

  const container = fakeContainer();
  __test.state.items = [{ id: 1, is_checked: 1 }];
  __test.updateCheckedActions(container, { userChecked: true });
  __test.setPillInteractingForTest(true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(__test.getPillPhaseForTest(), 'deferred');

  // Seite verlassen, BEVOR die Interaktion endet.
  container.isConnected = false;
  const callsBefore = bulkPillLayer.replaceChildrenCalls;

  bulkPillLayer.fire('mouseleave');
  assert.equal(__test.getPillPhaseForTest(), 'suppressed', 'der interne Zustand darf trotzdem aufraeumen');
  assert.equal(bulkPillLayer.replaceChildrenCalls, callsBefore,
    'eine verlassene Seite darf die geteilte Schicht (moeglicherweise mit einer fremden Pille) nicht anfassen');
});

test('updateCheckedActions: eine veraltete Frist nach einem Listenwechsel bleibt folgenlos', async () => {
  resetShoppingState();
  __test.setBulkPillHoldMsForTest(20);

  __test.state.items = [{ id: 1, is_checked: 1 }];
  __test.updateCheckedActions(fakeContainer(), { userChecked: true });
  assert.equal(__test.getPillPhaseForTest(), 'visible');


  __test.resetPillMachine();
  assert.equal(__test.getPillPhaseForTest(), 'idle');

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(__test.getPillPhaseForTest(), 'idle',
    'die alte Frist darf den frischen Ruhezustand der neuen Liste nicht ueberschreiben');
});

test('updateCheckedActions: eine veraltete Frist nach dem Verlassen der Seite bleibt folgenlos (isConnected)', async () => {
  resetShoppingState();
  __test.setBulkPillHoldMsForTest(20);

  const container = fakeContainer();
  __test.state.items = [{ id: 1, is_checked: 1 }];
  __test.updateCheckedActions(container, { userChecked: true });
  assert.equal(__test.getPillPhaseForTest(), 'visible');



  container.isConnected = false;

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(__test.getPillPhaseForTest(), 'visible',
    'eine Frist ohne lebende Wurzel darf weder den Zustand noch die geteilte Schicht anfassen');
});

// --------------------------------------------------------
// Laden-Verwaltung (#1003)
// --------------------------------------------------------

test('der Laden-Manager meldet sich beim Schliessen NICHT vom Aenderungs-Ereignis ab', () => {




  // Schliessen abmeldet, verpasst genau diese Aenderung: `state.stores` boete

  // Speichern liefe in dessen 400-Antwort.
  //




  const src = readFileSync(new URL('../public/pages/shopping.js', import.meta.url), 'utf8');
  const fn = src.match(/function openStoreManager\(container\)[\s\S]*?\n\}/);
  assert.ok(fn, 'openStoreManager nicht gefunden');
  assert.doesNotMatch(fn[0], /removeEventListener\(\s*'category-manager-changed'/,
    'openStoreManager meldet sich wieder ab und verpasst damit das Loeschen');


  assert.match(fn[0], /const onChanged = async \(\) => \{[\s\S]*?loadStores\(\)/,
    'die Auffrischung gehoert in den Ereignis-Handler');
});

// --------------------------------------------------------
// Mengenangabe -> Vorrats-Uebertrag (#1003, Nachzug zur Preis-Umschrift)
// --------------------------------------------------------

function withFormatLocale(locale, fn) {
  const vorher = globalThis.__formatLocale;
  globalThis.__formatLocale = locale;
  try { fn(); } finally { globalThis.__formatLocale = vorher; }
}

test('parseShoppingQuantity: die Schreibweisen aus dem Seed bleiben, wie sie waren', () => {



  const p = __test.parseShoppingQuantity;
  assert.deepEqual(p('250 g'), { quantity: 250, unit: 'g' });
  assert.deepEqual(p('1 kg'), { quantity: 1, unit: 'kg' });
  assert.deepEqual(p('2 l'), { quantity: 2, unit: 'l' });
  assert.deepEqual(p('12'), { quantity: 12, unit: 'pcs' });


  assert.deepEqual(p('1 Laib'), { quantity: 1, unit: 'pcs' });
  assert.deepEqual(p('1 Kopf'), { quantity: 1, unit: 'pcs' });
  assert.deepEqual(p('6 × 1 l'), { quantity: 6, unit: 'pcs' });
  assert.deepEqual(p('4er-Pack'), { quantity: 4, unit: 'pcs' });
  assert.deepEqual(p(''), { quantity: 1, unit: 'pcs' });
  assert.deepEqual(p(null), { quantity: 1, unit: 'pcs' });
});

test('parseShoppingQuantity: der Dezimaltrenner kommt aus der Region, nicht aus dem Quelltext', () => {


  withFormatLocale('de', () => {
    assert.deepEqual(__test.parseShoppingQuantity('1,5 kg'), { quantity: 1.5, unit: 'kg' });
  });

  withFormatLocale('en-US', () => {
    assert.deepEqual(__test.parseShoppingQuantity('1.5 kg'), { quantity: 1.5, unit: 'kg' });
  });
  withFormatLocale('de-CH', () => {
    assert.deepEqual(__test.parseShoppingQuantity('0.5 l'), { quantity: 0.5, unit: 'l' });
  });
});

test('parseShoppingQuantity: eine gruppierte Menge wird abgewiesen, nicht geraten', () => {




  //




  withFormatLocale('en-US', () => {
    assert.deepEqual(__test.parseShoppingQuantity('1,000 g'), { quantity: 1, unit: 'pcs' });
  });
  withFormatLocale('de', () => {
    assert.deepEqual(__test.parseShoppingQuantity('1.000 g'), { quantity: 1, unit: 'pcs' });
  });

  withFormatLocale('en-US', () => {
    assert.deepEqual(__test.parseShoppingQuantity('1.25 kg'), { quantity: 1.25, unit: 'kg' });
  });
});

test('parseShoppingQuantity: oestliche Ziffern kommen ueberhaupt an', () => {



  withFormatLocale('fa', () => {
    assert.deepEqual(__test.parseShoppingQuantity('۲۵۰ g'), { quantity: 250, unit: 'g' });
    assert.deepEqual(__test.parseShoppingQuantity('۱٫۵ kg'), { quantity: 1.5, unit: 'kg' });


    assert.deepEqual(__test.parseShoppingQuantity('۲۵۰ گرم'), { quantity: 250, unit: 'pcs' });
  });
  withFormatLocale('ar-EG', () => {
    assert.deepEqual(__test.parseShoppingQuantity('٢٥٠ g'), { quantity: 250, unit: 'g' });





    assert.deepEqual(__test.parseShoppingQuantity('٢٬٠٠٠ g'), { quantity: 1, unit: 'pcs' });
  });
});

test('parseShoppingQuantity: eine mitten im Trenner abgeschnittene Menge wird abgewiesen', () => {




  withFormatLocale('ar-EG', () => {
    assert.deepEqual(__test.parseShoppingQuantity('٢٬٥٠ g'), { quantity: 1, unit: 'pcs' });
  });

  withFormatLocale('fa', () => {
    assert.deepEqual(__test.parseShoppingQuantity('1,5 kg'), { quantity: 1, unit: 'pcs' });
  });

  withFormatLocale('de', () => {
    assert.deepEqual(__test.parseShoppingQuantity("1'000 g"), { quantity: 1, unit: 'pcs' });
  });

  withFormatLocale('de', () => {
    assert.deepEqual(__test.parseShoppingQuantity('6 × 1 l'), { quantity: 6, unit: 'pcs' });
  });



  // ausdruecklich lesbar halten will.
  withFormatLocale('de', () => {
    assert.deepEqual(__test.parseShoppingQuantity('2x500 g'), { quantity: 2, unit: 'pcs' });
    assert.deepEqual(__test.parseShoppingQuantity('3x'), { quantity: 3, unit: 'pcs' });
    assert.deepEqual(__test.parseShoppingQuantity('4er-Pack'), { quantity: 4, unit: 'pcs' });

    assert.deepEqual(__test.parseShoppingQuantity('2×500 ml'), { quantity: 2, unit: 'pcs' });
  });
});

test('parseShoppingQuantity: eine Gruppierung im REST laesst die fuehrende Menge stehen', () => {



  withFormatLocale('de', () => {
    assert.deepEqual(__test.parseShoppingQuantity('6 × 1.000 ml'), { quantity: 6, unit: 'pcs' });
  });
  withFormatLocale('en-US', () => {
    assert.deepEqual(__test.parseShoppingQuantity('6 × 1,000 ml'), { quantity: 6, unit: 'pcs' });
  });
  withFormatLocale('ar-EG', () => {
    assert.deepEqual(__test.parseShoppingQuantity('٦ × ١٬٠٠٠ ml'), { quantity: 6, unit: 'pcs' });
  });

  withFormatLocale('de', () => {
    assert.deepEqual(__test.parseShoppingQuantity('1.000 g'), { quantity: 1, unit: 'pcs' });
  });
});

test('parseShoppingQuantity: der Trenner der Region bleibt der Trenner, auch nach der Gruppierungspruefung', () => {




  withFormatLocale('de', () => {
    assert.deepEqual(__test.parseShoppingQuantity('1,000 g'), { quantity: 1, unit: 'g' });
  });
  withFormatLocale('en-US', () => {
    assert.deepEqual(__test.parseShoppingQuantity('1.000 g'), { quantity: 1, unit: 'g' });
  });
});

// --------------------------------------------------------
// Abhaken gegen eine ueberholende Auffrischung
//







// --------------------------------------------------------

function makeNullContainer() {
  return { querySelector: () => null, querySelectorAll: () => [] };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function milk(isChecked) {
  return { id: 10, name: 'Milch', is_checked: isChecked, category: 'Sonstiges', sort_order: 0 };
}

test('Abhaken ueberlebt eine Auffrischung, deren GET aelter ist als der PATCH', async () => {
  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  const gate = deferred();
  globalThis.__apiStub = {

    get: () => gate.promise,
    patch: async () => ({ data: null }),
  };

  // 1. Eine Auffrischung geht los (Kategorie-Manager, Ladenverwaltung, Import).
  const loading = __test.loadItems(1);

  await __test.toggleShoppingItem(10, 0, makeNullContainer());
  assert.equal(__test.checkedOf(__test.state.items[0]), 1, 'optimistisch abgehakt');

  gate.resolve({ data: [milk(0)] });
  await loading;

  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'die alte Antwort darf die Bearbeitung nicht zurueckdrehen');
  delete globalThis.__apiStub;
});

test('ein spaeter begonnenes Laden raeumt den Merker - fremde Aenderungen kommen durch', async () => {
  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  globalThis.__apiStub = { get: async () => ({ data: [milk(0)] }), patch: async () => ({ data: null }) };
  await __test.toggleShoppingItem(10, 0, makeNullContainer());
  assert.equal(__test.checkedOf(__test.state.items[0]), 1);




  await __test.loadItems(1);
  assert.equal(__test.checkedOf(__test.state.items[0]), 0,
    'ein Merker, der nie geraeumt wird, macht den Server unwirksam');
  assert.equal(__test.intents.size, 0, 'kein Rest im Merker');
  delete globalThis.__apiStub;
});

test('scheitert der PATCH, bleibt kein Merker stehen', async () => {
  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  const toasts = [];
  global.window.aashiyana.showToast = (msg, tone) => toasts.push([msg, tone]);
  globalThis.__apiStub = {
    get: async () => ({ data: [milk(0)] }),
    patch: async () => { throw Object.assign(new Error('nope'), { data: { error: 'kaputt' } }); },
  };

  await __test.toggleShoppingItem(10, 0, makeNullContainer());
  assert.equal(__test.checkedOf(__test.state.items[0]), 0, 'zurueckgedreht');
  assert.equal(__test.intents.size, 0, 'ein gescheiterter Wunsch darf nichts auftragen');
  assert.equal(toasts.length, 1);


  await __test.loadItems(1);
  assert.equal(__test.checkedOf(__test.state.items[0]), 0);
  delete globalThis.__apiStub;
  delete global.window.aashiyana.showToast;
});

test('eine aeltere Antwort, die NACH einer juengeren landet, fasst den Stand nicht mehr an', async () => {



  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  const alt = deferred();
  const neu = deferred();
  const gates = [alt, neu];
  globalThis.__apiStub = { get: () => gates.shift().promise, patch: async () => ({ data: null }) };

  const ladenAlt = __test.loadItems(1);            // beginnt zuerst
  await __test.toggleShoppingItem(10, 0, makeNullContainer());
  const ladenNeu = __test.loadItems(1);            // beginnt danach


  neu.resolve({ data: [milk(1)] });
  await ladenNeu;
  assert.equal(__test.checkedOf(__test.state.items[0]), 1);
  assert.equal(__test.intents.size, 0, 'die juengere Antwort kennt den Wert, der Merker darf gehen');


  alt.resolve({ data: [milk(0)] });
  await ladenAlt;
  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'eine ueberholte Antwort darf den bereits angewandten Stand nicht mehr ueberschreiben');
  delete globalThis.__apiStub;
});

test('scheitert der PATCH, springt die Zeile auf den FRISCHEN Serverstand zurueck', async () => {



  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  const toasts = [];
  global.window.aashiyana.showToast = (msg) => toasts.push(msg);
  const patchGate = deferred();
  globalThis.__apiStub = {

    get: async () => ({ data: [milk(1)] }),
    patch: () => patchGate.promise,
  };

  const abhaken = __test.toggleShoppingItem(10, 0, makeNullContainer());
  await __test.loadItems(1);
  assert.equal(__test.checkedOf(__test.state.items[0]), 1);

  patchGate.promise.catch(() => {});
  patchGate.resolve(Promise.reject(Object.assign(new Error('nope'), { data: { error: 'kaputt' } })));
  await abhaken;

  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'der Ruecksprung muss den frischen Serverstand treffen, nicht den Stand von vor dem Antippen');
  assert.equal(__test.state.lists[0].item_checked, 1, 'und der Zaehler muss dazu passen');
  assert.equal(toasts.length, 1);
  delete globalThis.__apiStub;
  delete global.window.aashiyana.showToast;
});

// --------------------------------------------------------

//





// --------------------------------------------------------

test('eine gecachte Antwort raeumt den Merker NICHT', async () => {
  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  globalThis.__apiStub = {

    getWithSource: async () => ({ data: { data: [milk(0)] }, fromCache: true }),
    patch: async () => ({ data: null }),
  };

  await __test.toggleShoppingItem(10, 0, makeNullContainer());
  assert.equal(__test.checkedOf(__test.state.items[0]), 1);


  await __test.loadItems(1);
  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'offline darf die Zeile nicht auf den Cache-Stand zurueckspringen');
  assert.equal(__test.intents.size, 1, 'der Merker muss stehen bleiben');


  globalThis.__apiStub.getWithSource = async () => ({ data: { data: [milk(1)] }, fromCache: false });
  await __test.loadItems(1);
  assert.equal(__test.intents.size, 0, 'die netzfrische Antwort raeumt');
  delete globalThis.__apiStub;
});

test('eine gecachte Antwort setzt die Ruecksprung-Grundlage nicht neu', async () => {


  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  global.window.aashiyana.showToast = () => {};
  const patchGate = deferred();
  globalThis.__apiStub = {

    getWithSource: async () => ({ data: { data: [milk(1)] }, fromCache: false }),
    patch: () => patchGate.promise,
  };

  const abhaken = __test.toggleShoppingItem(10, 0, makeNullContainer());
  await __test.loadItems(1);


  globalThis.__apiStub.getWithSource = async () => ({ data: { data: [milk(0)] }, fromCache: true });
  await __test.loadItems(1);

  patchGate.promise.catch(() => {});
  patchGate.resolve(Promise.reject(Object.assign(new Error('nope'), { data: { error: 'kaputt' } })));
  await abhaken;

  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'die Grundlage bleibt die frische 1, nicht die gecachte 0');
  delete globalThis.__apiStub;
  delete global.window.aashiyana.showToast;
});

test('eine gecachte Antwort verdraengt keine echte, die spaeter eintrifft', async () => {


  // frueher begonnene, aber ECHTE Antwort danach „veraltet" - der Cache haette

  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  const frisch = deferred();
  const antworten = [
    () => frisch.promise,                                             // beginnt zuerst, antwortet spaet
    async () => ({ data: { data: [milk(0)] }, fromCache: true }),
  ];
  globalThis.__apiStub = { getWithSource: () => antworten.shift()(), patch: async () => ({ data: null }) };

  const ladenFrisch = __test.loadItems(1);   // startedAt 1
  await __test.loadItems(1);

  frisch.resolve({ data: { data: [milk(1)] }, fromCache: false });
  await ladenFrisch;

  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'die echte Antwort muss ankommen, auch wenn eine gecachte spaeter begann');
  delete globalThis.__apiStub;
});

test('ein zweites Antippen springt nicht am ersten, erfolgreichen vorbei zurueck', async () => {




  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  global.window.aashiyana.showToast = () => {};
  const alt = deferred();
  let patchZaehler = 0;
  globalThis.__apiStub = {
    getWithSource: () => alt.promise,
    patch: async () => {
      patchZaehler += 1;
      if (patchZaehler === 1) return { data: null };                  // erstes Antippen: Erfolg
      throw Object.assign(new Error('nope'), { data: { error: 'kaputt' } });
    },
  };

  const laden = __test.loadItems(1);                                   // Schnappschuss: 0
  await __test.toggleShoppingItem(10, 0, makeNullContainer());         // 0 -> 1, bestaetigt
  assert.equal(__test.checkedOf(__test.state.items[0]), 1);

  const zweites = __test.toggleShoppingItem(10, 1, makeNullContainer()); // 1 -> 0, ausstehend
  alt.resolve({ data: { data: [milk(0)] }, fromCache: false });
  await laden;
  await zweites;

  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'der Ruecksprung gehoert auf die bestaetigte 1, nicht auf die 0 des alten Schnappschusses');
  delete globalThis.__apiStub;
  delete global.window.aashiyana.showToast;
});

// --------------------------------------------------------

// --------------------------------------------------------

test('eine Auffrischung von Liste B raeumt den Merker von Liste A nicht', async () => {
  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [
    { id: 1, name: 'A', item_total: 1, item_checked: 0 },
    { id: 2, name: 'B', item_total: 0, item_checked: 0 },
  ];
  __test.state.activeListId = 1;
  __test.state.items = [milk(0)];

  globalThis.__apiStub = {
    getWithSource: async () => ({ data: { data: [] }, fromCache: false }),
    patch: async () => ({ data: null }),
  };

  await __test.toggleShoppingItem(10, 0, makeNullContainer());
  assert.equal(__test.intents.size, 1);


  __test.state.activeListId = 2;
  await __test.loadItems(2);
  assert.equal(__test.intents.size, 1,
    'der Merker von Liste A gehoert nicht Liste B');


  __test.state.activeListId = 1;
  globalThis.__apiStub.getWithSource = async () => ({ data: { data: [milk(0)] }, fromCache: true });
  await __test.loadItems(1);
  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'der abgehakte Artikel muss den Umweg ueber B ueberstehen');
  delete globalThis.__apiStub;
});

test('die Wasserstandsmarke gilt je Liste, nicht global', async () => {
  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [
    { id: 1, name: 'A', item_total: 1, item_checked: 0 },
    { id: 2, name: 'B', item_total: 0, item_checked: 0 },
  ];
  __test.state.activeListId = 1;
  __test.state.items = [];

  const aLauf = deferred();
  const antworten = [
    () => aLauf.promise,                                                 // A, beginnt zuerst
    async () => ({ data: { data: [] }, fromCache: false }),              // B, beginnt danach
  ];
  globalThis.__apiStub = { getWithSource: () => antworten.shift()() };

  const ladenA = __test.loadItems(1);      // startedAt 1, Liste A
  __test.state.activeListId = 2;
  await __test.loadItems(2);               // startedAt 2, Liste B - zieht global die Marke hoch
  __test.state.activeListId = 1;

  aLauf.resolve({ data: { data: [milk(0)] }, fromCache: false });
  await ladenA;

  assert.equal(__test.state.items.length, 1,
    'die brauchbare A-Antwort darf nicht daran scheitern, dass B dazwischen lief');
  delete globalThis.__apiStub;
});

test('zweimal antippen vor dem ersten Rundlauf: der Ruecksprung bleibt der Serverstand', async () => {



  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.items = [milk(0)];

  global.window.aashiyana.showToast = () => {};
  const tore = [deferred(), deferred()];
  let n = 0;
  globalThis.__apiStub = {
    getWithSource: async () => ({ data: { data: [milk(0)] }, fromCache: false }),
    patch: () => tore[n++].promise,
  };

  const erstes  = __test.toggleShoppingItem(10, 0, makeNullContainer());   // 0 -> 1
  const zweites = __test.toggleShoppingItem(10, 1, makeNullContainer());   // 1 -> 0

  for (const tor of tore) {
    tor.promise.catch(() => {});
    tor.resolve(Promise.reject(Object.assign(new Error('nope'), { data: { error: 'kaputt' } })));
  }
  await Promise.all([erstes, zweites]);

  assert.equal(__test.checkedOf(__test.state.items[0]), 0,
    'nach zwei Fehlschlaegen gehoert der Stand von vor dem ERSTEN Antippen in die Zeile');
  assert.equal(__test.state.lists[0].item_checked, 0, 'und der Zaehler dazu');
  delete globalThis.__apiStub;
  delete global.window.aashiyana.showToast;
});

test('ein ueberholter, aber ERFOLGREICHER Rundlauf bleibt die Ruecksprung-Grundlage', async () => {



  // (Codex-Befund P2 zu PR #1072, sechste Runde).
  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.activeListId = 1;
  __test.state.items = [milk(0)];

  global.window.aashiyana.showToast = () => {};
  const tore = [deferred(), deferred()];
  let n = 0;
  globalThis.__apiStub = {
    getWithSource: async () => ({ data: { data: [milk(0)] }, fromCache: false }),
    patch: () => tore[n++].promise,
  };

  const erstes  = __test.toggleShoppingItem(10, 0, makeNullContainer());   // 0 -> 1
  const zweites = __test.toggleShoppingItem(10, 1, makeNullContainer());   // 1 -> 0

  tore[0].resolve({ data: null });                                          // erster: Erfolg
  await erstes;
  tore[1].promise.catch(() => {});
  tore[1].resolve(Promise.reject(Object.assign(new Error('nope'), { data: { error: 'kaputt' } })));
  await zweites;

  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'der Server steht auf dem Wert des ERSTEN Rundlaufs, dorthin gehoert der Ruecksprung');
  assert.equal(__test.state.lists[0].item_checked, 1, 'und der Zaehler dazu');
  delete globalThis.__apiStub;
  delete global.window.aashiyana.showToast;
});

test('ein Fehlschlag nach dem Listenwechsel dreht den Zaehler der URSPRUNGSLISTE zurueck', async () => {




  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [
    { id: 1, name: 'A', item_total: 1, item_checked: 0 },
    { id: 2, name: 'B', item_total: 0, item_checked: 0 },
  ];
  __test.state.activeListId = 1;
  __test.state.items = [milk(0)];

  global.window.aashiyana.showToast = () => {};
  const tor = deferred();
  globalThis.__apiStub = {
    getWithSource: async () => ({ data: { data: [] }, fromCache: false }),
    patch: () => tor.promise,
  };

  const abhaken = __test.toggleShoppingItem(10, 0, makeNullContainer());
  assert.equal(__test.state.lists[0].item_checked, 1, 'optimistisch gebucht');

  // Listenwechsel, waehrend der PATCH laeuft.
  __test.state.activeListId = 2;
  __test.state.items = [];

  tor.promise.catch(() => {});
  tor.resolve(Promise.reject(Object.assign(new Error('nope'), { data: { error: 'kaputt' } })));
  await abhaken;

  assert.equal(__test.state.lists[0].item_checked, 0,
    'der Zaehler von Liste A gehoert zurueckgedreht, auch ohne sichtbare Zeile');
  assert.equal(__test.state.lists[1].item_checked, 0, 'und Liste B bleibt unberuehrt');
  delete globalThis.__apiStub;
  delete global.window.aashiyana.showToast;
});

test('ein geloeschter Artikel bucht seinen Zaehler nicht doppelt zurueck', async () => {




  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [{ id: 1, name: 'Einkauf', item_total: 1, item_checked: 0 }];
  __test.state.activeListId = 1;
  __test.state.items = [milk(0)];

  global.window.aashiyana.showToast = () => {};
  const tor = deferred();
  globalThis.__apiStub = {
    getWithSource: async () => ({ data: { data: [] }, fromCache: false }),
    patch: () => tor.promise,
    delete: async () => ({ data: null }),
  };

  const abhaken = __test.toggleShoppingItem(10, 0, makeNullContainer());
  assert.equal(__test.state.lists[0].item_checked, 1);

  __test.deleteItemUndoable(10, makeNullContainer());
  assert.equal(__test.state.lists[0].item_total, 0);
  assert.equal(__test.state.lists[0].item_checked, 0, 'das Loeschen hat schon korrigiert');



  assert.equal(__test.intents.size, 1, 'die Absicht ueberlebt fuer das Zuruecknehmen');
  assert.equal(__test.intents.get(10).delta, 0, 'ihre Buchung ist mit dem Loeschen abgegolten');

  tor.promise.catch(() => {});
  tor.resolve(Promise.reject(Object.assign(new Error('nope'), { data: { error: 'kaputt' } })));
  await abhaken;

  assert.equal(__test.state.lists[0].item_checked, 0,
    'der Fehlschlag darf nicht ein zweites Mal buchen');
  delete globalThis.__apiStub;
  delete global.window.aashiyana.showToast;
});

test('offline zurueck zu Liste A zeigt A, nicht die liegengebliebenen Artikel von B', async () => {




  // (Codex-Befund P1 zu PR #1072, neunte Runde).
  resetShoppingState();
  __test.state.lists = [
    { id: 1, name: 'A', item_total: 1, item_checked: 0 },
    { id: 2, name: 'B', item_total: 1, item_checked: 0 },
  ];
  const aWare = { ...milk(0), id: 10, name: 'Milch' };
  const bWare = { ...milk(0), id: 20, name: 'Brot' };

  const antworten = [
    async () => ({ data: { data: [aWare] }, fromCache: false }),   // A, netzfrisch
    async () => ({ data: { data: [bWare] }, fromCache: false }),   // B, netzfrisch
    async () => ({ data: { data: [aWare] }, fromCache: true }),    // A, offline
  ];
  globalThis.__apiStub = { getWithSource: () => antworten.shift()() };

  __test.state.activeListId = 1; await __test.loadItems(1);
  assert.deepEqual(__test.state.items.map((i) => i.id), [10]);

  __test.state.activeListId = 2; await __test.loadItems(2);
  assert.deepEqual(__test.state.items.map((i) => i.id), [20]);

  __test.state.activeListId = 1; await __test.loadItems(1);
  assert.deepEqual(__test.state.items.map((i) => i.id), [10],
    'die gecachte A-Antwort gehoert angewandt, solange der Bestand einer anderen Liste gehoert');
  delete globalThis.__apiStub;
});

test('nach einem Fehlschlag derselben Liste wird die gecachte Antwort angenommen', async () => {



  // (Codex-Befund P2 zu PR #1072, zehnte Runde).
  resetShoppingState();
  __test.state.lists = [{ id: 1, name: 'A', item_total: 1, item_checked: 0 }];

  const antworten = [
    async () => ({ data: { data: [milk(0)] }, fromCache: false }),   // erst netzfrisch
    async () => { throw Object.assign(new Error('500'), { data: { error: 'kaputt' } }); },
    async () => ({ data: { data: [milk(0)] }, fromCache: true }),
  ];
  globalThis.__apiStub = { getWithSource: () => antworten.shift()() };

  await __test.loadItems(1);
  assert.equal(__test.state.items.length, 1);


  await __test.loadItems(1).catch(() => { __test.clearItems(); });
  assert.equal(__test.state.items.length, 0);

  await __test.loadItems(1);
  assert.equal(__test.state.items.length, 1,
    'ist der Bestand verworfen, ist die gecachte Antwort das Beste, was es gibt');
  delete globalThis.__apiStub;
});

// --------------------------------------------------------
// Live-Aktualisierung: fremde Aenderungen erreichen den Zettel
// --------------------------------------------------------

const bread = (isChecked = 0) => ({ id: 11, name: 'Brot', is_checked: isChecked, category: 'Backwaren', sort_order: 0 });
const eier  = () => ({ id: 12, name: 'Eier', is_checked: 0, category: 'Sonstiges', sort_order: 0 });
const listRow = (checked) => ({ id: 1, name: 'Einkauf', item_total: 2, item_checked: checked });

test('liveRefreshPlan: bewegt sich nur der Haken, bleiben die Zeilen stehen - auch in anderer Reihenfolge', () => {
  const previous = [milk(0), bread(0)];

  const fresh = [bread(0), milk(1)];
  const plan = __test.liveRefreshPlan(previous, fresh);
  assert.equal(plan.rebuild, false, 'dieselben Artikel, dieselben Namen: kein Neuaufbau, keine Animation, kein Sprung');
  assert.deepEqual(plan.changed.map((i) => i.id), [10], 'nur die Zeile mit dem neuen Haken wird umgefaerbt');
});

test('liveRefreshPlan: ein neuer, fehlender, umbenannter oder umsortierter Artikel baut die Liste neu', () => {
  const previous = [milk(0), bread(0)];
  const rebuilds = {
    'dazugekommen':      [milk(0), bread(0), { id: 12, name: 'Eier', is_checked: 0, category: 'Sonstiges' }],
    'verschwunden':      [milk(0)],
    'umbenannt':         [{ ...milk(0), name: 'Hafermilch' }, bread(0)],
    'andere Kategorie':  [{ ...milk(0), category: 'Kuehlregal' }, bread(0)],
    'andere Menge':      [{ ...milk(0), quantity: '2 l' }, bread(0)],



    'umsortiert':        [bread(0), { ...milk(0), sort_order: 2 }],
  };
  for (const [why, fresh] of Object.entries(rebuilds)) {
    assert.equal(__test.liveRefreshPlan(previous, fresh).rebuild, true, why);
  }
  assert.equal(__test.liveRefreshPlan([], []).rebuild, false, 'leer zu leer ist keine Bewegung');
});

test('refreshFromFeed: die aktive Liste laedt Listen UND Artikel, eine andere nur die Listenzeile', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0), { id: 2, name: 'Baumarkt', item_total: 0, item_checked: 0 }];
  __test.state.items = [milk(0), bread(0)];

  const calls = [];
  globalThis.__apiStub = {
    get: async (path) => { calls.push(path); return { data: [listRow(1), { id: 2, name: 'Baumarkt', item_total: 3, item_checked: 0 }] }; },
    getWithSource: async (path) => { calls.push(path); return { data: { data: [bread(0), milk(1)] }, fromCache: false }; },
  };
  const signal = new AbortController().signal;

  await __test.refreshFromFeed(makeNullContainer(), 1, signal);
  assert.deepEqual([...calls].sort(), ['/shopping', '/shopping/1/items']);
  assert.equal(__test.state.items.find((i) => i.id === 10).is_checked, 1, 'der fremde Haken steht im Serverstand');
  assert.equal(__test.state.lists[0].item_checked, 1, 'der Zaehler im Reiter folgt');

  calls.length = 0;
  await __test.refreshFromFeed(makeNullContainer(), 2, signal);
  assert.deepEqual(calls, ['/shopping'], 'fuer eine andere Liste reicht der Zaehler - switchList laedt ohnehin frisch');
  assert.equal(__test.state.lists[1].item_total, 3);
  delete globalThis.__apiStub;
});

test('refreshFromFeed: ein Fehler beim Nachladen bleibt still und laesst den letzten Stand stehen', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0)];
  globalThis.__apiStub = {
    get: async () => { throw Object.assign(new Error('500'), { data: { error: 'kaputt' } }); },
    getWithSource: async () => { throw Object.assign(new Error('500'), { data: { error: 'kaputt' } }); },
  };
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  await assert.doesNotReject(() => __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal));
  console.warn = origWarn;
  assert.equal(__test.state.items.length, 1, 'der Bestand bleibt');
  assert.equal(__test.state.itemsError, null, 'kein Fehlerbild fuer eine stille Auffrischung');


  // Meldung abweist.
  assert.equal(__test.state.lists.length, 1, 'die Reiter bleiben stehen');
  assert.equal(__test.state.listsError, null, 'kein Merker, der die naechste Meldung stumm schaltet');
  delete globalThis.__apiStub;
});

test('refreshFromFeed: scheitert nur die Listenzeile, kommt der frische Bestand trotzdem auf den Schirm', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0)];



  globalThis.__apiStub = {
    get: async () => { throw Object.assign(new Error('500'), { data: { error: 'kaputt' } }); },
    getWithSource: async () => ({ data: { data: [milk(0), eier()] }, fromCache: false }),
  };
  const asked = [];
  const container = { querySelector: (sel) => { asked.push(sel); return null; }, querySelectorAll: () => [] };
  const origError = console.error;
  console.error = () => {};
  await __test.refreshFromFeed(container, 1, new AbortController().signal);
  console.error = origError;
  assert.deepEqual(__test.state.items.map((i) => i.id), [10, 12], 'die Artikel-Antwort ist angewandt');



  assert.ok(asked.includes('#items-list'), 'der frische Bestand wird gezeichnet');
  assert.equal(__test.state.listsError, null, 'kein Merker, der die naechste Meldung stumm schaltet');
  assert.equal(__test.state.lists.length, 1, 'die Reiter bleiben stehen');
  delete globalThis.__apiStub;
});

test('refreshFromFeed: scheitern die Artikel sofort und die Listenzeile SPAETER, bleibt kein Merker zurueck', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0)];
  const fail = () => Object.assign(new Error('500'), { data: { error: 'kaputt' } });



  globalThis.__apiStub = {
    get: () => new Promise((_, reject) => setTimeout(() => reject(fail()), 5)),
    getWithSource: async () => { throw fail(); },
  };
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = () => {};
  console.error = () => {};
  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  await new Promise((r) => setTimeout(r, 25));
  console.warn = origWarn;
  console.error = origError;
  assert.equal(__test.state.listsError, null, 'der spaete Fehler der Listenzeile darf nicht stehen bleiben');
  assert.deepEqual(__test.state.lists.map((l) => l.id), [1], 'die Reiter bleiben stehen');

  const calls = [];
  globalThis.__apiStub = {
    get: async (path) => { calls.push(path); return { data: [listRow(0)] }; },
    getWithSource: async (path) => { calls.push(path); return { data: { data: [milk(0)] }, fromCache: false }; },
  };
  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  assert.deepEqual([...calls].sort(), ['/shopping', '/shopping/1/items'], 'die naechste Meldung laedt');
  delete globalThis.__apiStub;
});

test('refreshFromFeed: die eigene, noch unbestaetigte Bearbeitung ueberlebt die Meldung des Feeds', async () => {
  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0)];

  const gate = deferred();
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(0)] }),

    getWithSource: async () => ({ data: { data: [milk(0)] }, fromCache: false }),
    patch: () => gate.promise,
  };

  const toggling = __test.toggleShoppingItem(10, 0, makeNullContainer());
  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  assert.equal(__test.checkedOf(__test.state.items[0]), 1,
    'die Absicht ueberlagert den alten Serverstand - die Zeile springt nicht zurueck');
  assert.equal(__test.intents.size, 1, 'die Absicht steht, bis eine Antwort sie traegt');

  gate.resolve({ data: null });
  await toggling;
  delete globalThis.__apiStub;
});

test('refreshFromFeed: die Meldung der EIGENEN Aenderung erfuellt die Absicht, statt sie zurueckzudrehen', async () => {
  resetShoppingState();
  __test.intents.clear();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0)];

  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(1)] }),
    getWithSource: async () => ({ data: { data: [milk(1)] }, fromCache: false }),
    patch: async () => ({ data: null }),
  };
  await __test.toggleShoppingItem(10, 0, makeNullContainer());
  assert.equal(__test.intents.size, 1);


  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  assert.equal(__test.intents.size, 0, 'die Antwort traegt den gewollten Wert - die Absicht ist erfuellt');
  assert.equal(__test.checkedOf(__test.state.items[0]), 1);
  delete globalThis.__apiStub;
});

test('refreshFromFeed: ein abgebrochener Aufbau zeichnet nichts mehr', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0)];
  const gate = deferred();
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(1)] }),
    getWithSource: () => gate.promise,
  };
  const ac = new AbortController();
  const refreshing = __test.refreshFromFeed(makeNullContainer(), 1, ac.signal);
  ac.abort();
  gate.resolve({ data: { data: [milk(1)] }, fromCache: false });
  await refreshing;
  assert.equal(__test.state.lists[0].item_checked, 1,
    'der Serverstand kommt an - er ist die Wahrheit, gleich wer sie noch anschaut');
  delete globalThis.__apiStub;
});

test('refreshFromFeed: ist die aktive Liste weg, wechselt der Zettel auf die erste verbliebene', async () => {
  resetShoppingState();
  __test.state.activeListId = 1;
  __test.state.lists = [listRow(0), { id: 2, name: 'Baumarkt', item_total: 0, item_checked: 0 }];
  __test.state.items = [milk(0)];
  const calls = [];
  globalThis.__apiStub = {

    get: async (path) => { calls.push(path); return { data: [{ id: 2, name: 'Baumarkt', item_total: 1, item_checked: 0 }] }; },
    getWithSource: async (path) => { calls.push(path); return { data: { data: [bread(0)], list: { id: 2, name: 'Baumarkt' } }, fromCache: false }; },
  };
  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  assert.equal(__test.state.activeListId, 2, 'die erste verbliebene Liste wird aktiv');
  assert.ok(calls.includes('/shopping/2/items'), 'und geladen');
  assert.deepEqual(__test.state.items.map((i) => i.id), [11]);
  delete globalThis.__apiStub;
});

// --------------------------------------------------------

//




// --------------------------------------------------------

function captureUndo() {
  const box = { last: null };
  globalThis.__undoStub = (opts) => { box.last = opts; };
  return box;
}

test('eine Auffrischung im Undo-Fenster bringt den geloeschten Artikel NICHT zurueck', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0), bread(0)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  const deletes = [];
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(0)] }),

    getWithSource: async () => ({ data: { data: [milk(0), bread(1)] }, fromCache: false }),
    delete: async (path) => { deletes.push(path); return { data: null, list_change: { list_id: 1, before: 5, after: 6 } }; },
  };

  __test.deleteItemUndoable(10, makeNullContainer());
  assert.deepEqual(__test.state.items.map((i) => i.id), [11], 'die Zeile ist sofort weg');
  assert.ok(__test.pendingRemovals.has(10), 'und als schwebend vermerkt');

  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  assert.deepEqual(__test.state.items.map((i) => i.id), [11], 'die Auffrischung laesst die Milch draussen');
  assert.equal(__test.state.items[0].is_checked, 1, 'traegt aber den fremden Haken am Brot ein');
  assert.equal(__test.state.lists[0].item_total, 1, 'der Zaehler zaehlt die Milch nicht wieder mit');

  await undo.last.commit({ keepalive: false });
  assert.deepEqual(deletes, ['/shopping/items/10']);
  assert.equal(__test.pendingRemovals.size, 0, 'mit dem DELETE ist nichts mehr schwebend');
  assert.deepEqual(__test.state.items.map((i) => i.id), [11], 'und der Bestand ist der Serverstand nach dem DELETE');

  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

test('Zuruecknehmen nach einer Auffrischung im Fenster bringt den Artikel genau EINMAL zurueck', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0), bread(0)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(0)] }),
    getWithSource: async () => ({ data: { data: [milk(0), bread(0)] }, fromCache: false }),
  };

  __test.deleteItemUndoable(10, makeNullContainer());
  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  undo.last.restore();

  assert.deepEqual(__test.state.items.map((i) => i.id), [10, 11], 'einmal Milch, nicht zweimal');
  assert.equal(__test.pendingRemovals.size, 0, 'nichts mehr schwebend');
  assert.equal(__test.state.lists[0].item_total, 2, 'der Zaehler steht wieder auf dem Serverstand');


  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  assert.deepEqual(__test.state.items.map((i) => i.id), [10, 11]);

  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

test('ein fehlgeschlagener DELETE raeumt die Schwebe und bringt die Zeile zurueck', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0), bread(0)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  globalThis.__apiStub = {
    delete: async () => { throw Object.assign(new Error('500'), { data: { error: 'kaputt' } }); },
  };

  __test.deleteItemUndoable(10, makeNullContainer());
  await assert.rejects(() => undo.last.commit({ keepalive: false }));
  assert.equal(__test.pendingRemovals.size, 0, 'der Fehlschlag laesst nichts schwebend zurueck');

  undo.last.restore(new Error('500'));
  assert.deepEqual(__test.state.items.map((i) => i.id), [10, 11]);

  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

test('Abgehakte loeschen: die Auffrischung im Fenster bringt sie nicht zurueck, das Zuruecknehmen nicht doppelt', async () => {
  resetShoppingState();
  __test.state.lists = [{ ...listRow(2), item_total: 3 }];
  __test.state.items = [milk(1), bread(1), eier()];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  const deletes = [];
  globalThis.__apiStub = {
    get: async () => ({ data: [{ ...listRow(2), item_total: 3 }] }),
    getWithSource: async () => ({ data: { data: [milk(1), bread(1), eier()] }, fromCache: false }),
    delete: async (path) => { deletes.push(path); return { data: null, list_change: { list_id: 1, before: 5, after: 6 } }; },
  };

  __test.clearCheckedUndoable(makeNullContainer());
  assert.deepEqual(__test.state.items.map((i) => i.id), [12]);
  assert.equal(__test.pendingRemovals.size, 2);

  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  assert.deepEqual(__test.state.items.map((i) => i.id), [12], 'die Abgehakten bleiben draussen');
  assert.equal(__test.state.lists[0].item_total, 1, 'der Zaehler ohne die Abgehakten');
  assert.equal(__test.state.lists[0].item_checked, 0);

  undo.last.restore();
  assert.deepEqual(__test.state.items.map((i) => i.id), [10, 11, 12], 'jede genau einmal zurueck');
  assert.equal(__test.pendingRemovals.size, 0);
  assert.equal(__test.state.lists[0].item_total, 3);
  assert.equal(__test.state.lists[0].item_checked, 2);
  assert.deepEqual(deletes, [], 'zurueckgenommen - kein DELETE');

  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

test('Abgehakte loeschen: das Schliessen des Fensters raeumt die Schwebe', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(1)];
  __test.state.items = [milk(1), bread(0)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  globalThis.__apiStub = {
    delete: async () => ({ data: null, list_change: { list_id: 1, before: 5, after: 6 } }),
  };
  __test.clearCheckedUndoable(makeNullContainer());
  await undo.last.commit({ keepalive: false });
  assert.equal(__test.pendingRemovals.size, 0);
  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

// --------------------------------------------------------

// PR #1109, Runde 3)
//






// --------------------------------------------------------

test('ein GET, der VOR dem DELETE begann und NACH ihm antwortet, bringt die Zeile nicht zurueck', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0), bread(0)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  let releaseGet;
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(0)] }),

    getWithSource: () => new Promise((resolve) => {
      releaseGet = () => resolve({ data: { data: [milk(0), bread(0)] }, fromCache: false });
    }),
    delete: async () => ({ data: null, list_change: { list_id: 1, before: 5, after: 6 } }),
  };

  __test.deleteItemUndoable(10, makeNullContainer());
  const refresh = __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  await new Promise((r) => setImmediate(r));
  await undo.last.commit({ keepalive: false });
  assert.ok(__test.pendingRemovals.has(10), 'bestaetigt, aber noch nicht geraeumt: ein aelterer GET ist unterwegs');
  releaseGet();
  await refresh;
  assert.deepEqual(__test.state.items.map((i) => i.id), [11], 'die aeltere Antwort bringt die Milch nicht zurueck');
  assert.equal(__test.pendingRemovals.size, 0, 'mit der letzten aelteren Antwort ist die Schwebe geraeumt');

  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

test('ein Listen-Laden, das VOR dem DELETE begann und NACH ihm antwortet, zaehlt den Artikel nicht mehr mit', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(1)];
  __test.state.items = [milk(1), bread(0)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  let releaseLists;
  globalThis.__apiStub = {

    get: () => new Promise((resolve) => { releaseLists = () => resolve({ data: [listRow(1)] }); }),
    getWithSource: async () => ({ data: { data: [milk(1), bread(0)] }, fromCache: false }),
    delete: async () => ({ data: null, list_change: { list_id: 1, before: 5, after: 6 } }),
  };

  __test.deleteItemUndoable(10, makeNullContainer());
  assert.equal(__test.state.lists[0].item_total, 1);
  const refresh = __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  await new Promise((r) => setImmediate(r));
  await undo.last.commit({ keepalive: false });
  releaseLists();
  await refresh;
  assert.equal(__test.state.lists[0].item_total, 1, 'der Zaehler traegt den Serverstand ohne die Milch');
  assert.equal(__test.state.lists[0].item_checked, 0);
  assert.deepEqual(__test.state.items.map((i) => i.id), [11]);
  assert.equal(__test.pendingRemovals.size, 0);

  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

test('Abgehakte loeschen: ein GET, der VOR dem DELETE begann und NACH ihm antwortet, bringt sie nicht zurueck', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(2)];
  __test.state.items = [milk(1), bread(1)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  let releaseGet;
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(2)] }),
    getWithSource: () => new Promise((resolve) => {
      releaseGet = () => resolve({ data: { data: [milk(1), bread(1)] }, fromCache: false });
    }),
    delete: async () => ({ data: null, deleted: 2, list_change: { list_id: 1, before: 5, after: 6 } }),
  };

  __test.clearCheckedUndoable(makeNullContainer());
  const refresh = __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  await new Promise((r) => setImmediate(r));
  await undo.last.commit({ keepalive: false });
  releaseGet();
  await refresh;
  assert.deepEqual(__test.state.items, [], 'die aeltere Antwort bringt keine der Abgehakten zurueck');
  assert.equal(__test.state.lists[0].item_total, 0);
  assert.equal(__test.pendingRemovals.size, 0);

  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

test('eine NACH dem DELETE begonnene Antwort ist die Wahrheit des Servers - auch wenn eine aeltere noch unterwegs ist', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0), bread(0)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  const gates = [];
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(0)] }),
    getWithSource: () => new Promise((resolve) => { gates.push(resolve); }),
    delete: async () => ({ data: null, list_change: { list_id: 1, before: 5, after: 6 } }),
  };

  __test.deleteItemUndoable(10, makeNullContainer());
  const older = __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  await new Promise((r) => setImmediate(r));
  await undo.last.commit({ keepalive: false });
  const newer = __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  await new Promise((r) => setImmediate(r));
  assert.equal(gates.length, 2);




  gates[1]({ data: { data: [milk(0), bread(0)] }, fromCache: false });
  await newer;
  assert.deepEqual(__test.state.items.map((i) => i.id), [10, 11], 'die juengere Antwort wird ungefiltert angewandt');


  gates[0]({ data: { data: [bread(0)] }, fromCache: false });
  await older;
  assert.deepEqual(__test.state.items.map((i) => i.id), [10, 11], 'die aeltere Antwort ueberschreibt die juengere nicht');
  assert.equal(__test.pendingRemovals.size, 0, 'nichts mehr unterwegs, nichts mehr schwebend');

  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

test('ein fehlgeschlagener DELETE raeumt sofort, auch wenn ein aelterer GET noch unterwegs ist', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0), bread(0)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  let releaseGet;
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(0)] }),
    getWithSource: () => new Promise((resolve) => {
      releaseGet = () => resolve({ data: { data: [milk(0), bread(0)] }, fromCache: false });
    }),
    delete: async () => { throw Object.assign(new Error('500'), { data: { error: 'kaputt' } }); },
  };

  __test.deleteItemUndoable(10, makeNullContainer());
  const refresh = __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  await new Promise((r) => setImmediate(r));
  await assert.rejects(() => undo.last.commit({ keepalive: false }));
  assert.equal(__test.pendingRemovals.size, 0, 'der Server hat die Milch noch - nichts ist schwebend');
  undo.last.restore(new Error('500'));
  assert.deepEqual(__test.state.items.map((i) => i.id), [10, 11], 'restore bringt die Zeile zurueck');
  releaseGet();
  await refresh;
  assert.deepEqual(__test.state.items.map((i) => i.id), [10, 11], 'und die Antwort traegt sie genau einmal');
  assert.equal(__test.state.lists[0].item_total, 2);

  delete globalThis.__apiStub;
  delete globalThis.__undoStub;
  delete global.window.aashiyana.showToast;
});

// --------------------------------------------------------





// --------------------------------------------------------

test('Abgehakte loeschen: der DELETE nennt genau die Artikel, die die Seite entfernt hat', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(2)];
  __test.state.items = [milk(1), bread(1), eier()];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  const sent = [];
  globalThis.__apiStub = {
    delete: async (path, opts) => {
      sent.push({ path, keepalive: opts.keepalive, body: JSON.parse(opts.body) });
      return { deleted: 2, list_change: { list_id: 1, before: 4, after: 5 } };
    },
  };
  try {
    __test.clearCheckedUndoable(makeNullContainer());
    await undo.last.commit({ keepalive: true });
    assert.deepEqual(sent, [{ path: '/shopping/1/items/checked', keepalive: true, body: { ids: [10, 11] } }],
      'nicht "alles, was beim Eintreffen abgehakt ist" - und die Fetch-Option bleibt erhalten');
  } finally {
    delete globalThis.__apiStub;
    delete globalThis.__undoStub;
    delete global.window.aashiyana.showToast;
  }
});

async function reloadsOnNextPoll({ deleted, version }) {
  resetShoppingState();
  __test.state.lists = [listRow(1)];
  __test.state.items = [milk(1), bread(0)];
  global.window.aashiyana.showToast = () => {};
  const undo = captureUndo();
  let versions = [{ list_id: 1, version: 4 }];
  const calls = [];
  globalThis.__apiStub = {
    get: async (path) => {
      calls.push(path);
      if (path === '/shopping/versions') return { data: versions };
      return { data: [listRow(0)] };
    },
    getWithSource: async (path) => { calls.push(path); return { data: { data: [bread(0)] }, fromCache: false }; },
    delete: async () => ({ deleted, list_change: { list_id: 1, before: 4, after: 5 } }),
  };
  const route = new AbortController();
  try {
    __test.wireLiveUpdates(makeNullContainer(), route.signal);
    await settle();

    __test.clearCheckedUndoable(makeNullContainer()); // entfernt EINEN Artikel
    await undo.last.commit({ keepalive: false });

    versions = [{ list_id: 1, version }];
    calls.length = 0;
    await __test.getLiveFeedForTest().poll();
    await settle();
    return calls.includes('/shopping/1/items');
  } finally {
    route.abort();
    __test.abortLiveUpdatesForTest();
    delete globalThis.__apiStub;
    delete globalThis.__undoStub;
    delete global.window.aashiyana.showToast;
  }
}

test('Abgehakte loeschen: hat der Server genau so viele entfernt wie die Seite, erspart die Quittung das Nachladen', async () => {
  assert.equal(await reloadsOnNextPoll({ deleted: 1, version: 5 }), false);
});

test('Abgehakte loeschen: hat der Server WENIGER entfernt als die Seite, laedt die naechste Abfrage nach', async () => {
  assert.equal(await reloadsOnNextPoll({ deleted: 0, version: 5 }), true,
    'die Zeile, die jemand im Undo-Fenster zurueckgeholt hat, kommt nur durch das Nachladen her');
});

test('loadItems: die Laufnummer der Artikel-Antwort wird der Stand des Feeds - in beide Richtungen', async () => {
  const run = async ({ feedSays, itemsCarry, thenFeedSays }) => {
    resetShoppingState();
    __test.state.lists = [listRow(0)];
    __test.state.items = [];
    let versions = [{ list_id: 1, version: feedSays }];
    const calls = [];
    globalThis.__apiStub = {
      get: async (path) => {
        calls.push(path);
        if (path === '/shopping/versions') return { data: versions };
        return { data: [listRow(0)] };
      },
      getWithSource: async (path) => { calls.push(path); return { data: { data: [milk(0)], version: itemsCarry }, fromCache: false }; },
    };
    const route = new AbortController();
    try {
      __test.wireLiveUpdates(makeNullContainer(), route.signal);
      await settle();
      await __test.loadItems(1);
      calls.length = 0;
      versions = [{ list_id: 1, version: thenFeedSays }];
      await __test.getLiveFeedForTest().poll();
      await settle();
      return calls.includes('/shopping/1/items');
    } finally {
      route.abort();
      __test.abortLiveUpdatesForTest();
      delete globalThis.__apiStub;
    }
  };



  assert.equal(await run({ feedSays: 4, itemsCarry: 5, thenFeedSays: 5 }), false,
    'die Artikel-Antwort war die juengere: nichts nachzuladen');



  assert.equal(await run({ feedSays: 6, itemsCarry: 5, thenFeedSays: 6 }), true,
    'die Artikel-Antwort war die aeltere: die Aenderung dazwischen wird nachgeladen');
});

function makeDialogPanel(values) {
  const fields = {};
  for (const [id, value] of Object.entries(values)) fields[`#${id}`] = { value, addEventListener() {} };
  const handlers = {};
  const form = { addEventListener(type, fn) { handlers[type] = fn; } };
  return {
    querySelector(sel) {
      if (sel === '#item-details-form') return form;
      return fields[sel] ?? null;
    },
    submit: () => handlers.submit({ preventDefault() {} }),
  };
}

const dialogFields = (name, qty = '') => ({
  'item-details-name': name, 'item-details-qty': qty, 'item-details-cat': 'Sonstiges',
  'item-details-url': '', 'item-details-notes': '', 'item-details-price': '', 'item-details-store': '',
  'item-details-link': '', 'item-details-cancel': '',
});

test('Speichern im Artikeldialog nach einer Auffrischung trifft die Zeile im BESTAND, nicht das alte Objekt', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0), bread(0)];
  __test.state.categories = [{ id: 1, name: 'Sonstiges' }, { id: 2, name: 'Backwaren' }];
  let onSave = null;
  globalThis.__openModal = (opts) => { onSave = opts.onSave; };
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(0)] }),

    getWithSource: async () => ({ data: { data: [milk(0), bread(1)] }, fromCache: false }),
    patch: async (path, payload) => ({
      data: { ...milk(0), ...payload },
      list_change: { list_id: 1, before: 6, after: 7 },
    }),
  };

  __test.openItemDetails(10, makeNullContainer());
  assert.equal(typeof onSave, 'function', 'der Dialog ist offen');
  const panel = makeDialogPanel(dialogFields('Hafermilch', '2'));
  onSave(panel);


  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  await panel.submit();

  const zeile = __test.state.items.find((i) => i.id === 10);
  assert.equal(zeile.name, 'Hafermilch', 'die Bearbeitung steht im Bestand, aus dem die Liste zeichnet');
  assert.equal(zeile.quantity, '2');
  assert.equal(__test.state.items.find((i) => i.id === 11).is_checked, 1, 'der fremde Haken bleibt');

  delete globalThis.__apiStub;
  delete globalThis.__openModal;
});

test('Speichern im Artikeldialog: ist der Artikel inzwischen weg, wirft das Speichern nicht', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0)];
  __test.state.categories = [{ id: 1, name: 'Sonstiges' }];
  let onSave = null;
  globalThis.__openModal = (opts) => { onSave = opts.onSave; };
  globalThis.__apiStub = {
    get: async () => ({ data: [listRow(0)] }),
    getWithSource: async () => ({ data: { data: [] }, fromCache: false }),
    patch: async (path, payload) => ({ data: { ...milk(0), ...payload }, list_change: { list_id: 1, before: 6, after: 7 } }),
  };
  __test.openItemDetails(10, makeNullContainer());
  const panel = makeDialogPanel(dialogFields('Hafermilch'));
  onSave(panel);
  await __test.refreshFromFeed(makeNullContainer(), 1, new AbortController().signal);
  await assert.doesNotReject(() => panel.submit());
  assert.deepEqual(__test.state.items, [], 'kein Geisterobjekt im Bestand');
  delete globalThis.__apiStub;
  delete globalThis.__openModal;
});

const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

test('wireLiveUpdates: die Abfrage haengt am Router-Signal, eine bewegte Nummer laedt nach, die eigene Quittung erspart das Nachladen', async () => {
  resetShoppingState();
  __test.state.lists = [listRow(0)];
  __test.state.items = [milk(0)];

  let versions = [{ list_id: 1, version: 4 }];
  const calls = [];
  globalThis.__apiStub = {
    get: async (path) => {
      calls.push(path);
      if (path === '/shopping/versions') return { data: versions };
      return { data: [listRow(1)] };
    },
    getWithSource: async (path) => { calls.push(path); return { data: { data: [milk(1)] }, fromCache: false }; },
    patch: async () => ({ data: null, list_change: { list_id: 1, before: 4, after: 6 } }),
  };

  const route = new AbortController();
  try {
    __test.wireLiveUpdates(makeNullContainer(), route.signal);
    await settle();
    assert.deepEqual(calls, ['/shopping/versions'], 'die erste Abfrage setzt nur die Marken');



    await __test.toggleShoppingItem(10, 0, makeNullContainer());
    versions = [{ list_id: 1, version: 6 }];
    calls.length = 0;
    await __test.getLiveFeedForTest().poll();
    await settle();
    assert.deepEqual(calls, ['/shopping/versions'], 'das eigene Werk loest kein Nachladen aus');


    versions = [{ list_id: 1, version: 7 }];
    calls.length = 0;
    await __test.getLiveFeedForTest().poll();
    await settle();
    assert.ok(calls.includes('/shopping/1/items'), 'eine fremde Bewegung laedt die aktive Liste nach');

    const first = __test.getLiveFeedForTest();
    __test.wireLiveUpdates(makeNullContainer(), route.signal);
    assert.notEqual(__test.getLiveFeedForTest(), first, 'der naechste Aufbau derselben Seite hat seinen eigenen Feed');
    await settle();
    calls.length = 0;
    await first.poll();
    assert.deepEqual(calls, [], 'der Feed des vorigen Aufbaus fragt nicht mehr');

    route.abort();
    assert.equal(__test.getLiveFeedForTest(), null, 'die Seite verlassen beendet den Feed');
  } finally {

    // die Suite endete dann nie.
    route.abort();
    __test.abortLiveUpdatesForTest();
    delete globalThis.__apiStub;
  }
});
// --------------------------------------------------------------------------
// Autocomplete-Vorschlag uebernehmen (#1103)
//
// GET /shopping/suggestions liefert seit #1103 { name, category, quantity }




// Client-Seite (wireAutocomplete) rief weiterhin `esc(s)`/`.dataset.value`

// --------------------------------------------------------------------------

function fakeInput(initial = '') {
  return { value: initial };
}

function fakeSelect(optionValues, initial = optionValues[0] ?? '') {
  return { value: initial, options: optionValues.map((v) => ({ value: v })) };
}

function fakeFormContainer({ name, qty, cat }) {
  const els = {
    '#item-name-input': name,
    '#item-qty-input': qty,
    '#item-cat-select': cat,
  };
  return { querySelector: (sel) => els[sel] ?? null };
}

test('applyAutocompleteSuggestion: übernimmt Name, Kategorie und Menge aus dem Vorschlagsobjekt', () => {
  const name = fakeInput('');
  const qty  = fakeInput('');
  const cat  = fakeSelect(['Obst & Gemüse', 'Backwaren', 'Sonstiges'], 'Sonstiges');
  const container = fakeFormContainer({ name, qty, cat });

  const el = { dataset: { name: 'Bananen', category: 'Obst & Gemüse', quantity: '1 Bund' } };
  __test.applyAutocompleteSuggestion(container, el);

  assert.equal(name.value, 'Bananen', 'der Name darf nie das Objekt selbst als String zeigen ("[object Object]")');
  assert.equal(cat.value, 'Obst & Gemüse');
  assert.equal(qty.value, '1 Bund');
});

test('applyAutocompleteSuggestion: eine nicht mehr vorhandene Kategorie überschreibt das Feld nicht', () => {
  const name = fakeInput('');
  const qty  = fakeInput('');
  const cat  = fakeSelect(['Obst & Gemüse', 'Backwaren'], 'Backwaren');
  const container = fakeFormContainer({ name, qty, cat });



  const el = { dataset: { name: 'Wasser', category: 'Getränke', quantity: '' } };
  __test.applyAutocompleteSuggestion(container, el);

  assert.equal(name.value, 'Wasser');
  assert.equal(cat.value, 'Backwaren', 'eine unbekannte Kategorie darf das Feld nicht auf einen ungültigen Wert setzen');
  assert.equal(qty.value, '', 'eine leere Menge überschreibt das Feld nicht mit einem leeren String');
});

test('shopping.js: der Vorschlags-Renderer zeigt s.name, nicht das ganze Vorschlagsobjekt', () => {
  // Ergaenzende Textprobe (Verhaltenstest oben deckt die eigentliche Logik ab):

  const source = readFileSync(new URL('../public/pages/shopping.js', import.meta.url), 'utf8');
  assert.match(source, /data-name="\$\{esc\(s\.name\)\}"/,
    'Der Vorschlags-Eintrag muss s.name rendern, nicht das ganze Vorschlagsobjekt.');
  assert.doesNotMatch(source, /esc\(s\)/,
    'Ein Vorschlagsobjekt darf nie als Ganzes in esc() laufen - das ergibt "[object Object]".');
});

// --------------------------------------------------------------------------

//


// "Milchprodukte" stehen - ein danach eingetippter, unverwandter Artikel


//




// Submit-Handler sie wirklich aufruft.
// --------------------------------------------------------------------------
test('resetQuickAddCategory: setzt die Auswahl auf den Standard zurueck', () => {
  const cat = fakeSelect(['Obst & Gemüse', 'Milchprodukte', 'Sonstiges'], 'Milchprodukte');
  __test.resetQuickAddCategory(cat);
  assert.equal(cat.value, 'Sonstiges',
    'nach dem Anlegen muss die Auswahl auf DEFAULT_CATEGORY_NAME zurueckfallen, ' +
    'sonst bleibt eine per Vorschlag oder von Hand gewaehlte Kategorie fuer den naechsten Artikel stehen.');
});

test('resetQuickAddCategory: ohne "Sonstiges" in den Optionen bleibt die Auswahl stehen', () => {


  const cat = fakeSelect(['Obst & Gemüse', 'Backwaren'], 'Backwaren');
  __test.resetQuickAddCategory(cat);
  assert.equal(cat.value, 'Backwaren');
});

test('wireQuickAdd: der Submit-Handler ruft den Kategorie-Rueckfall wirklich auf', () => {


  const source = readFileSync(new URL('../public/pages/shopping.js', import.meta.url), 'utf8');
  const submitBlock = source.slice(
    source.indexOf("form.addEventListener('submit'"),
    source.indexOf("form.addEventListener('submit'") + 2500,
  );
  assert.match(submitBlock, /nameInput\.value = '';/);
  assert.match(submitBlock, /resetQuickAddCategory\(catSelect\);/,
    'der Submit-Handler muss resetQuickAddCategory(catSelect) aufrufen.');
});
