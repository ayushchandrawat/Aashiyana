import { test } from 'node:test';
import assert from 'node:assert/strict';


global.HTMLElement = class HTMLElement {};

const { installPopoverMenus } = await import('../public/utils/popover-menu.js');

function el(selector, attrs = {}) {
  const node = Object.assign(new global.HTMLElement(), {
    _sel: selector,
    _attrs: { ...attrs },
    parent: null,
    children: [],
    style: {},
    tabIndex: 0,
    focused: false,
    offsetWidth: 200,
    offsetHeight: 48,
    getAttribute(key) { return node._attrs[key] ?? null; },
    setAttribute(key, value) { node._attrs[key] = value; },
    matches(sel) { return node._sel === sel; },
    focus() { node.focused = true; },
    closest(sel) {
      for (let n = node; n; n = n.parent) if (n._sel === sel) return n;
      return null;
    },
    querySelectorAll(sel) {
      const wantsEnabled = sel.includes(':not([disabled])');
      return node.children.filter((c) => c._sel === '.popover-menu__item'
        && (!wantsEnabled || !c.disabled));
    },
    getBoundingClientRect() { return { top: 100, bottom: 140, right: 300, left: 200 }; },
  });
  return node;
}

/** Panel mit `count` Eintraegen; `checkedIndex` traegt aria-checked. */
function makeMenu({ count = 3, checkedIndex = -1, disabledIndex = -1 } = {}) {
  const panel = el('.popover-menu');
  panel.id = 'menu-1';
  for (let i = 0; i < count; i += 1) {
    const item = el('.popover-menu__item',
      i === checkedIndex ? { 'aria-checked': 'true' } : {});
    item.parent = panel;
    item.disabled = i === disabledIndex;
    panel.children.push(item);
  }
  return panel;
}

function makeRoot() {
  const listeners = [];
  const root = {
    dataset: {},
    addEventListener(type, handler, opts) { listeners.push({ type, handler, opts }); },
    fire(type, event) {
      for (const l of listeners) if (l.type === type) l.handler(event);
    },
    has(type) { return listeners.some((l) => l.type === type); },
  };
  installPopoverMenus(root);
  return root;
}

const trigger = el('.popover-menu__trigger');
global.document = { querySelector: () => trigger };
global.window = { innerWidth: 1024, innerHeight: 768 };

const open = (root, panel) => root.fire('toggle', { target: panel, newState: 'open' });

const keydown = (root, target, key) => {
  let prevented = false;
  root.fire('keydown', { target, key, preventDefault() { prevented = true; } });
  return prevented;
};

const focusedIndex = (panel) => panel.children.findIndex((i) => i.focused);
const clearFocus = (panel) => panel.children.forEach((i) => { i.focused = false; });

test('das Oeffnen zieht den Fokus auf den ersten Eintrag', () => {
  const root = makeRoot();
  const panel = makeMenu();
  open(root, panel);
  assert.equal(focusedIndex(panel), 0, 'der Fokus bleibt am Trigger stehen');
});

test('ein Radiomenue oeffnet auf der aktiven Wahl, nicht am Anfang', () => {


  const root = makeRoot();
  const panel = makeMenu({ checkedIndex: 2 });
  open(root, panel);
  assert.equal(focusedIndex(panel), 2);
});

test('Tab fuehrt aus dem Menue hinaus, nicht durch alle Eintraege', () => {


  const root = makeRoot();
  const panel = makeMenu({ count: 4, checkedIndex: 1 });
  open(root, panel);
  assert.deepEqual(panel.children.map((i) => i.tabIndex), [-1, 0, -1, -1]);
});

test('Pfeiltasten wandern und laufen an beiden Enden um', () => {
  const root = makeRoot();
  const panel = makeMenu({ count: 3 });
  open(root, panel);

  clearFocus(panel);
  assert.ok(keydown(root, panel.children[0], 'ArrowDown'), 'ArrowDown scrollt sonst die Seite');
  assert.equal(focusedIndex(panel), 1);

  clearFocus(panel);
  keydown(root, panel.children[2], 'ArrowDown');
  assert.equal(focusedIndex(panel), 0, 'das Ende laeuft auf den Anfang um');

  clearFocus(panel);
  keydown(root, panel.children[0], 'ArrowUp');
  assert.equal(focusedIndex(panel), 2, 'der Anfang laeuft auf das Ende um');
});

test('Home und End springen an die Raender', () => {
  const root = makeRoot();
  const panel = makeMenu({ count: 5 });
  open(root, panel);

  clearFocus(panel);
  keydown(root, panel.children[2], 'End');
  assert.equal(focusedIndex(panel), 4);

  clearFocus(panel);
  keydown(root, panel.children[2], 'Home');
  assert.equal(focusedIndex(panel), 0);
});

test('fremde Tasten bleiben unangetastet', () => {


  const root = makeRoot();
  const panel = makeMenu();
  open(root, panel);
  for (const key of ['Escape', 'Tab', 'a', 'Enter']) {
    assert.equal(keydown(root, panel.children[0], key), false, `${key} wurde abgefangen`);
  }
});

test('ein deaktivierter Eintrag ist kein Ziel der Pfeiltasten', () => {
  const root = makeRoot();
  const panel = makeMenu({ count: 3, disabledIndex: 1 });
  open(root, panel);
  clearFocus(panel);
  keydown(root, panel.children[0], 'ArrowDown');
  assert.equal(focusedIndex(panel), 2, 'der deaktivierte Eintrag wurde uebersprungen');
});

test('aria-expanded am Trigger folgt dem Zustand des Panels', () => {


  const root = makeRoot();
  const panel = makeMenu();
  open(root, panel);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  root.fire('toggle', { target: panel, newState: 'closed' });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('ein keydown ausserhalb eines Panels laeuft ins Leere', () => {
  const root = makeRoot();
  const outside = el('.something-else');
  assert.equal(keydown(root, outside, 'ArrowDown'), false);
});
