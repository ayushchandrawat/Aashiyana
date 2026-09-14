
import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import {
  ROUTES,
  ANON_ROUTES,
  SETTINGS_ROUTES,
  startHarness,
  openPage,
  openAnonPage,
  gotoRoute,
  gotoAnonRoute,
  parseColor,
  composite,
  contrastRatio,
  toHex,
} from './document-guards-harness.js';
import { eachRule } from './css-rules.js';

const ROUTE_NAMES = Object.keys(ROUTES);
const SETTINGS_NAMES = Object.keys(SETTINGS_ROUTES);
const ALL_ROUTES = { ...ROUTES, ...SETTINGS_ROUTES };
let harness;

const LEAVES_SKIPPED = new Map([
  ['Sonde 1', 'misst `.page-toolbar`. Ein Settings-Blatt traegt keine - sein Kopf ist '
    + '`.settings-leaf-header` (settings/shell.js:509), und das ist die Leisten-Regel (§2) '
    + 'und keine Auslassung: `/settings` fuehrt der Router als EINE Route mit einem '
    + 'Modulkopf, die Blaetter darunter sind Detailseiten. Die Sonde faende dort null '
    + 'Leisten und meldete 69 gruene Zustaende, die nie gemessen wurden. Den '
    + 'Dokument-Ueberlauf der Blaetter misst Sonde 10, und die faehrt sie.'],
  ['Sonde 20', 'misst Kopf-Tablists (`.page-toolbar [role="tablist"]`) und die Kuechen-Rail '
    + '(`.sub-tabs-bar`). Ein Settings-Blatt traegt keine `.page-toolbar` (siehe Sonde 1), und '
    + '`.sub-tabs-bar` kommt in `public/settings/**` nicht vor (geprueft, 0 Treffer). Die Sonde '
    + 'faende dort null Leisten und kostete 23 Blaetter Ladezeit fuer nichts.'],
  ['Sonde 19', 'misst `.page-toolbar` und zaehlt ihre Zeilen. Ein Settings-Blatt traegt '
    + 'keine - derselbe Grund wie bei Sonde 1, und dieselbe Folge: 23 Blaetter mal zwei '
    + 'Sprachen mal drei Breiten waeren 138 Zustaende ohne eine einzige Messung, die '
    + 'anschliessend als gruen zaehlten.'],
  ['Sonde 5', 'faehrt eine Wischgeste auf `.swipe-row`. In `public/settings/**` kommt die '
    + 'Klasse nicht vor (geprueft, 0 Treffer); die Sonde ueberspringt einen Zustand ohne '
    + 'Wischzeile ohnehin. 23 Blaetter mal zwei Sprachen waeren reine Ladezeit ohne eine '
    + 'einzige Messung.'],
  ['Sonde 6', 'misst `.metric-grid`. Kommt in `public/settings/**` nicht vor (0 Treffer). '
    + 'Kennzahlreihen sind eine Bauform der Module, nicht der Einstellungen.'],
  ['Sonde 8', 'prueft das Andocken eines Kopfes MIT `--page-toolbar-lead`. Den setzt nur '
    + '`.page-toolbar`, und die gibt es auf einem Blatt nicht (siehe Sonde 1). Ohne '
    + 'Lead-Zone faellt jedes Blatt in die triviale Haelfte der Regel, die die Sonde dann '
    + '23-mal bestaetigt.'],
  ['Sonde 12', 'misst Glasflaechen, und die sitzen in der SHELL - Tab-Bar, Sidebar, Sheets, '
    + 'Toast, Datepicker-Popover, FAB. Die ist auf jeder Route dieselbe, also kaeme ein Befund '
    + 'dort 39-mal statt 16-mal. (Hier stand „dieselbe Begruendung wie bei Sonde 11" - Sonde 11 '
    + 'steht gar nicht in dieser Map, sie FAEHRT die Blaetter. Der Kopf oben verspricht „gegen '
    + 'den Bestand geprueft, nicht vermutet"; dieser Verweis war es nicht.) Gegengeprueft, dass '
    + 'die Blaetter keine eigene Glasflaeche mitbringen: `public/settings/**` setzt nirgends '
    + '`backdrop-filter`, und der einzige Glastraeger ihrer Shell ist die Sidebar der App.'],
  ['Sonde 13', 'oeffnet Modals ueber den FAB, und die Einstellungen haben keinen - weder die '
    + 'Uebersicht noch eines der 23 Blaetter. Die Sonde wuerde 23 Zustaende laden und '
    + '23-mal „kein FAB" in den Uebersprungsbeleg schreiben. Der Eintrag steht hier, weil sie '
    + 'bis Session 24 `ROUTE_NAMES` direkt nahm und die Blaetter damit STILLSCHWEIGEND '
    + 'ausliess: die Auslassung war richtig, aber nicht an der Stelle begruendet, an der '
    + 'jemand sie sucht - und genau dafuer gibt es diese Map.'],
  ['Sonde 15', 'misst die Bauhoehe von `.page-toolbar` - dieselbe Begruendung wie Sonde 1: '
    + 'ein Settings-Blatt traegt keine, sein Kopf ist `.settings-leaf-header`. Die Sonde '
    + 'faende dort null Koepfe, und ihre eigene „nichts gemessen"-Zusicherung (seen >= 12) '
    + 'wuerde von 23 leeren Zustaenden nicht beruehrt - sie meldete gruen aus dem falschen '
    + 'Grund. Die Chrome-Regel gilt fuer die Blaetter trotzdem; wer sie dort pruefen will, '
    + 'misst `.settings-leaf-header` und nicht diesen Selektor.'],
]);

function sweep(probe) {
  return LEAVES_SKIPPED.has(probe) ? ROUTE_NAMES : [...ROUTE_NAMES, ...SETTINGS_NAMES];
}

const isLeaf = (name) => name.startsWith('settings/');

test('die Auslassungen der Settings-Blaetter nennen eine Sonde, die es gibt', () => {



  //




  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const stale = [...LEAVES_SKIPPED.keys()]
    .filter((probe) => !new RegExp(`(?:test|describe)\\(\\s*'${probe} -`).test(source));
  assert.deepEqual(stale, [],
    'LEAVES_SKIPPED begruendet eine Auslassung fuer eine Sonde, die es nicht mehr gibt.');





  assert.ok(SETTINGS_NAMES.length >= 20,
    `Nur ${SETTINGS_NAMES.length} Settings-Blaetter aus der Registry abgeleitet - `
    + 'die Ableitung greift nicht mehr, und die Sonden faehren wieder nur `/settings`.');
});


/** Jede Regel aller App-Stylesheets, mit ihrer Datei. */
function allStyleRules() {
  const styles = new URL('../public/styles/', import.meta.url);
  const out = [];
  for (const entry of readdirSync(styles).filter((name) => name.endsWith('.css'))) {
    const css = readFileSync(new URL(entry, styles), 'utf8');
    for (const rule of eachRule(css)) out.push({ ...rule, file: entry });
  }
  return out;
}

function selectorClasses(rules = allStyleRules()) {
  const out = new Set();
  for (const rule of rules) {
    for (const match of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(match[1]);
  }
  return out;
}

async function visitViews(page, where, visit) {
  await visit(where);

  const groups = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const out = [];
    for (const list of document.querySelectorAll('[role="tablist"]')) {
      const tabs = [...list.querySelectorAll('[role="tab"]')].filter(vis);
      const cls = [...list.classList][0];
      if (tabs.length > 1 && cls) out.push({ sel: `.${cls} [role="tab"]`, n: tabs.length });
    }
    const byParent = new Map();
    for (const btn of document.querySelectorAll('[aria-pressed]')) {
      if (!vis(btn) || btn.closest('[role="tablist"]')) continue;
      const parent = btn.parentElement;
      if (!parent) continue;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(btn);
    }
    for (const [parent, btns] of byParent) {
      const cls = [...parent.classList][0];
      if (btns.length > 1 && cls) out.push({ sel: `.${cls} > [aria-pressed]`, n: btns.length });
    }
    return out;
  });

  const active = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)]
    .findIndex((e) => e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-pressed') === 'true'), sel);
  const clickAt = (sel, idx) => page.evaluate((s, i) => {
    const el = document.querySelectorAll(s)[i];
    if (!el) return false;
    el.click();
    return true;
  }, sel, idx);

  for (const group of groups) {
    const before = await active(group.sel);
    for (let i = 0; i < group.n; i += 1) {
      if (!(await clickAt(group.sel, i))) continue;


      // was zum Messzeitpunkt existiert").
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await visit(`${where}:${i}`);
    }
    if (before >= 0) {
      await clickAt(group.sel, before);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
}

before(async () => {
  harness = await startHarness();
});










beforeEach(async () => {
  await harness.reset();
});

after(async () => {
  await harness?.close();
});

test('save confirmations preserve the same editor across repeated gates and keep legacy delete closing', async () => {
  const page = await openPage(harness, { device: 'desktop', locale: 'de' });
  try {
    await page.evaluate(async () => {
      const modal = await import('/components/modal.js');
      let closeCount = 0;
      modal.openModal({
        title: 'Unsaved editor',
        content: '<form><input id="gate-title" value="Original title"><textarea id="gate-description">Original notes</textarea><button type="button" id="gate-save">Save</button></form>',
        onClose: () => { closeCount += 1; },
      });
      window.saveGateTest = {
        modal,
        editor: document.getElementById('shared-modal-overlay'),
        title: document.getElementById('gate-title'),
        description: document.getElementById('gate-description'),
        closeCount: () => closeCount,
      };
      modal.refreshDirtySnapshot();
      window.saveGateTest.title.value = 'Unsaved title';
      window.saveGateTest.description.value = 'Unsaved multiline\nnotes';
    });

    for (const confirmed of [false, true, true, false]) {
      await page.evaluate(() => {
        document.getElementById('gate-save').focus();
        const state = window.saveGateTest;
        state.pending = state.modal.confirmOverModal('Continue saving?', { closeOnConfirm: false });
      });
      await page.click(confirmed ? '#confirm-modal-ok' : '#confirm-modal-cancel');
      const state = await page.evaluate(async () => {
        const state = window.saveGateTest;
        const confirmed = await state.pending;
        return {
          confirmed,
          sameEditor: document.getElementById('shared-modal-overlay') === state.editor,
          sameTitle: document.getElementById('gate-title') === state.title,
          sameDescription: document.getElementById('gate-description') === state.description,
          title: document.getElementById('gate-title')?.value,
          description: document.getElementById('gate-description')?.value,
          interactive: state.editor.isConnected && !state.editor.inert,
          closeCount: state.closeCount(),
          focus: document.activeElement?.id,
          overlayCount: document.querySelectorAll('.modal-overlay').length,
        };
      });
      assert.deepEqual(state, {
        confirmed,
        sameEditor: true,
        sameTitle: true,
        sameDescription: true,
        title: 'Unsaved title',
        description: 'Unsaved multiline\nnotes',
        interactive: true,
        closeCount: 0,
        focus: 'gate-save',
        overlayCount: 1,
      });
    }

    // Resuming a save gate must preserve the editor's original dirty baseline.
    await page.evaluate(() => { window.saveGateTest.pending = window.saveGateTest.modal.closeModal(); });
    await page.waitForSelector('#confirm-modal-cancel');
    await page.click('#confirm-modal-cancel');
    assert.equal(await page.evaluate(async () => {
      await window.saveGateTest.pending;
      return document.getElementById('shared-modal-overlay') === window.saveGateTest.editor;
    }), true);

    // Delete callers omit the new option and still close on confirmation.
    await page.evaluate(() => {
      window.saveGateTest.pending = window.saveGateTest.modal.confirmOverModal('Delete this event?');
    });
    await page.click('#confirm-modal-ok');
    assert.deepEqual(await page.evaluate(async () => {
      const confirmed = await window.saveGateTest.pending;
      return { confirmed, closeCount: window.saveGateTest.closeCount(), editorConnected: window.saveGateTest.editor.isConnected };
    }), { confirmed: true, closeCount: 1, editorConnected: false });
  } finally {
    await page.close();
  }
});

async function openCalendarSaveGateEditor(page, { wholeSeriesOnly = false } = {}) {
  const seriesId = await page.evaluate(async (wholeSeriesOnly) => {
    const { api } = await import('/api.js');
    const { data: event } = await api.post('/calendar', {
      title: 'Calendar save gate original',
      start_datetime: '2048-04-03T09:00:00',
      end_datetime: '2048-04-03T10:00:00',
      recurrence_rule: 'FREQ=DAILY;COUNT=3',
    });
    await api.put(`/calendar/${event.id}/occurrences/2048-04-04`, { title: 'Linked second occurrence' });
    if (wholeSeriesOnly) {
      // Preserve the real response shape while exercising the server capability
      // contract for local series that cannot offer occurrence edits.
      const get = api.get.bind(api);
      api.get = async (...args) => {
        const response = await get(...args);
        for (const row of Array.isArray(response.data) ? response.data : [response.data]) {
          if (row?.id === event.id) {
            row.can_override_occurrence = false;
            row.can_detach_occurrence = false;
          }
        }
        return response;
      };
    }
    return event.id;
  }, wholeSeriesOnly);
  await page.evaluate((path) => window.aashiyana.navigate(path), `/calendar?open=${seriesId}&date=2048-04-03`);
  await page.waitForSelector('#detail-popover-edit, #detail-view-edit');
  await page.click('#detail-popover-edit, #detail-view-edit');
  await page.waitForSelector('#modal-title');
  await page.evaluate(() => {
    window.calendarGateTest = {
      editor: document.getElementById('shared-modal-overlay'),
      title: document.getElementById('modal-title'),
      description: document.getElementById('modal-description'),
    };
    window.calendarGateTest.title.value = 'Calendar save gate unsaved';
    window.calendarGateTest.description.value = 'Typed notes must survive';
  });
  return seriesId;
}

async function assertCalendarSaveGateEditor(page) {
  assert.deepEqual(await page.evaluate(() => {
    const state = window.calendarGateTest;
    return {
      sameEditor: document.getElementById('shared-modal-overlay') === state.editor,
      sameTitle: document.getElementById('modal-title') === state.title,
      sameDescription: document.getElementById('modal-description') === state.description,
      title: document.getElementById('modal-title')?.value,
      description: document.getElementById('modal-description')?.value,
      interactive: state.editor.isConnected && !state.editor.inert,
      saveEnabled: document.getElementById('modal-save')?.disabled === false,
    };
  }), {
    sameEditor: true,
    sameTitle: true,
    sameDescription: true,
    title: 'Calendar save gate unsaved',
    description: 'Typed notes must survive',
    interactive: true,
    saveEnabled: true,
  });
}

test('calendar save gates retain unsaved fields after orphan confirmation, server failure and canceled retry', async () => {
  const page = await openPage(harness, { device: 'desktop', locale: 'de' });
  try {
    const seriesId = await openCalendarSaveGateEditor(page);
    const attempts = [];
    page.removeAllListeners('request');
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/sw.js') return void request.abort();
      if (pathname === `/api/v1/calendar/${seriesId}` && request.method() === 'PUT') {
        const body = JSON.parse(request.postData());
        attempts.push(body);
        if (body.confirmed_orphan_count === 1) {
          return void request.respond({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Save gate test server failure', code: 500 }),
          });
        }
      }
      void request.continue();
    });
    await page.select('#modal-edit-scope', 'series');
    await page.evaluate(() => { document.getElementById('event-rrule-count').value = '1'; });
    await page.click('#modal-save');
    await page.waitForSelector('#confirm-modal-ok');
    assert.equal(attempts.length, 1, 'the real server must reject the rule that orphans its linked child');
    await page.click('#confirm-modal-ok');
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"], .toast')]
      .some((element) => element.textContent.includes('Save gate test server failure')));
    await assertCalendarSaveGateEditor(page);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].confirmed_orphan_count, 1);
    assert.equal(attempts[1].title, 'Calendar save gate unsaved');

    await page.waitForFunction(() => ![...document.querySelectorAll('.toast')]
      .some((element) => element.textContent.includes('Save gate test server failure')));
    await page.click('#modal-save');
    await page.waitForSelector('#confirm-modal-cancel');
    await page.click('#confirm-modal-cancel');
    await page.waitForFunction(() => !document.getElementById('confirm-modal-cancel')
      && document.getElementById('modal-save')?.disabled === false);
    await assertCalendarSaveGateEditor(page);
    assert.equal(attempts.length, 3, 'canceling the repeated gate must not send a confirmed write');
    const persisted = await page.evaluate(async (id) => {
      const { api } = await import('/api.js');
      return (await api.get(`/calendar/${id}`)).data;
    }, seriesId);
    assert.equal(persisted.title, 'Calendar save gate original');
    assert.equal(persisted.recurrence_rule, 'FREQ=DAILY;COUNT=3');
  } finally {
    await page.close();
  }
});

test('calendar whole-series save confirmation leaves invalid UNTIL editable', async () => {
  const page = await openPage(harness, { device: 'desktop', locale: 'de' });
  try {
    await openCalendarSaveGateEditor(page, { wholeSeriesOnly: true });
    assert.equal(await page.$('#modal-edit-scope'), null, 'the fixture must use the whole-series-only capability');
    await page.select('#event-rrule-end', 'until');
    await page.evaluate(() => {
      const picker = document.getElementById('event-rrule-until');
      const input = picker.querySelector('input');
      input.value = '31.02.2048';
      // The picker currently exposes invalid text as an empty canonical value.
      // Supply its raw-value boundary explicitly to exercise saveEvent's real
      // valid_until=false branch without changing datepicker behavior here.
      Object.defineProperty(picker, 'value', { get: () => input.value, configurable: true });
    });
    await page.click('#modal-save');
    await page.waitForSelector('#confirm-modal-ok');
    await page.click('#confirm-modal-ok');
    await page.waitForFunction(() => document.getElementById('event-rrule-until')?.getAttribute('aria-invalid') === 'true');
    await assertCalendarSaveGateEditor(page);
    assert.equal(await page.$eval('#event-rrule-until', (input) => input.value), '31.02.2048');
  } finally {
    await page.close();
  }
});

test('PR2
  const page = await openPage(harness, { device: 'desktop', locale: 'de' });
  const title = 'PR2 Serienprobe 975';
  try {
    await gotoRoute(page, '/calendar');
    await page.click('#cal-add');
    await page.waitForSelector('#modal-title');

    const hints = await page.evaluate((eventTitle) => {
      const change = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
      const setDate = (selector, value) => {
        const el = document.querySelector(selector);
        el.value = value;
        change(el);
      };
      const text = () => document.querySelector('#event-rrule-monthday-hint')?.textContent || '';

      document.querySelector('#modal-title').value = eventTitle;
      setDate('#modal-start-date', '2026-09-15');
      const freq = document.querySelector('#event-rrule-freq');
      freq.value = 'MONTHLY';
      change(freq);
      const lastDay = document.querySelector('#event-rrule-last-day');
      lastDay.checked = true;
      change(lastDay);
      const timed = text();

      const end = document.querySelector('#event-rrule-end');
      end.value = 'until';
      change(end);
      setDate('#event-rrule-until', '2026-09-20');
      const ended = text();

      end.value = 'never';
      change(end);
      const allDay = document.querySelector('#modal-allday');
      allDay.checked = true;
      change(allDay);
      setDate('#modal-allday-start', '2026-10-20');
      const allDayOctober = text();

      allDay.checked = false;
      change(allDay);
      setDate('#modal-start-date', '2026-09-15');
      return { timed, ended, allDayOctober };
    }, title);

    assert.match(hints.timed, /30\.09\.2026/,
      'das echte Zeitfeld bestimmt den ersten Monatsletzten');
    assert.doesNotMatch(hints.ended, /30\.09\.2026/,
      'ein live gesetztes fruehes UNTIL darf keinen unmoeglichen Termin versprechen');
    assert.match(hints.allDayOctober, /31\.10\.2026/,
      'nach dem Umschalten bestimmt das echte Ganztagsfeld die Vorschau');

    await page.click('#modal-save');
    await page.waitForFunction((eventTitle) => [...document.querySelectorAll('.month-day__event span')]
      .some((el) => el.textContent === eventTitle), {}, title);
    const monthA11y = await page.evaluate((eventTitle) => {
      const chip = [...document.querySelectorAll('.month-day__event')]
        .find((el) => el.querySelector('span:last-child')?.textContent === eventTitle);
      const repeat = chip?.querySelector('.calendar-repeat-icon');
      return {
        repeatLabel: repeat?.getAttribute('aria-label') || '',
        repeatIsSvg: Boolean(repeat?.querySelector('svg')),
        dayLabel: chip?.closest('.month-day')?.getAttribute('aria-label') || '',
      };
    }, title);
    assert.ok(monthA11y.repeatLabel, 'die Serienmarke hat nach der Lucide-Ersetzung einen Namen');
    assert.equal(monthA11y.repeatIsSvg, true, 'die echte Lucide-Ersetzung ist Teil der Komposition');
    assert.match(monthA11y.dayLabel, new RegExp(title),
      'das Tages-aria-label verschluckt den zugänglichen Serientitel nicht');

    await page.click('#cal-view-tab-agenda');
    await page.waitForFunction((eventTitle) => [...document.querySelectorAll('.agenda-event')]
      .some((el) => el.textContent.includes(eventTitle)), {}, title);
    const agendaLabel = await page.evaluate((eventTitle) => [...document.querySelectorAll('.agenda-event')]
      .find((el) => el.textContent.includes(eventTitle))?.getAttribute('aria-label') || '', title);
    assert.match(agendaLabel, new RegExp(title));
    assert.match(agendaLabel, new RegExp(monthA11y.repeatLabel),
      'das eigene Agenda-aria-label muss dieselbe Serienbedeutung tragen');
  } finally {
    await page.close();
  }
});


const OVERFLOW_LOCALES = ['de', 'uk', 'vi'];

async function measureHeadOverflow(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const selector = (el) => {
      const cls = [...el.classList].filter((c) => !c.startsWith('is-')).join('.');
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
    };
    for (const bar of document.querySelectorAll('.page-toolbar')) {
      const barRect = bar.getBoundingClientRect();
      if (!barRect.width || !barRect.height) continue;
      const walk = (el, clipped) => {
        for (const child of el.children) {
          const cs = getComputedStyle(child);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = child.getBoundingClientRect();
          if (!r.width && !r.height) continue;
          if (!clipped) {
            const over = Math.round(Math.max(r.right - vw, -r.left));
            if (over > 1) {
              out.push({
                toolbar: selector(bar),
                el: selector(child),
                over,
                width: Math.round(r.width),
              });
            }
          }
          const clips = cs.overflowX !== 'visible';
          walk(child, clipped || clips);
        }
      };
      const barOver = Math.round(Math.max(barRect.right - vw, -barRect.left));
      if (barOver > 1) {
        out.push({ toolbar: selector(bar), el: '(die Leiste selbst)', over: barOver, width: Math.round(barRect.width) });
      }
      walk(bar, false);
    }
    return out;
  });
}

describe('Sonde 1 - kein Modulkopf laeuft bei 375px ueber die Viewport-Kante', () => {
  for (const locale of OVERFLOW_LOCALES) {
    test(`Locale ${locale}`, async () => {
      const page = await openPage(harness, { device: 'mobile', theme: 'light', locale });
      const findings = [];
      for (const name of sweep('Sonde 1')) {
        await gotoRoute(page, ALL_ROUTES[name]);
        for (const f of await measureHeadOverflow(page)) {
          findings.push(`${name}/${locale}: ${f.el} in ${f.toolbar} ragt ${f.over}px hinaus (Breite ${f.width}px)`);
        }
      }
      await page.close();
      assert.deepEqual(
        findings,
        [],
        `Kopf-Ueberlauf bei 375px. Die Shell-Regel lautet: eine .page-toolbar bleibt in ` +
          `Zeilenrichtung, und eine Tab-Leiste im Kopf ist eine eigene, horizontal ` +
          `scrollende Zeile darunter (layout.css, Sektion "Tab-Leiste im Modulkopf").\n  ` +
          findings.join('\n  '),
      );
    });
  }
});


async function collectTextSamples(page) {
  return page.evaluate(() => {
    const out = [];
    const selector = (el) => {
      const cls = [...el.classList].filter((c) => !c.startsWith('is-')).join('.');
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el = walker.currentNode;
    while (el) {
      el = walker.nextNode();
      if (!el) break;
      if (el.closest('[aria-hidden="true"], .sr-only, aashiyana-install-prompt')) continue;
      if (el.matches(':disabled') || el.closest(':disabled, [aria-disabled="true"]')) continue;
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join(' ')
        .trim();
      if (!text) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.5) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;




      // zwei Sprachen.
      //










      const layers = [];
      let node = el;
      while (node) {
        const ncs = getComputedStyle(node);
        layers.push({ bg: ncs.backgroundColor, image: ncs.backgroundImage });
        node = node.parentElement;
      }
      out.push({
        selector: selector(el),
        text: text.slice(0, 40),
        color: cs.color,
        size: parseFloat(cs.fontSize),
        weight: Number(cs.fontWeight) || 400,
        layers,
      });
    }
    return out;
  });
}

function gradientStops(image) {
  if (!image || image === 'none') return [];
  if (/url\(/i.test(image)) return null;
  return [...image.matchAll(/color\(srgb[^)]*\)|rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi)].map((m) => m[0]);
}

function evaluateSample(sample, pageBase) {
  // Erste deckende Ebene suchen; alles darunter ist wirkungslos.
  let opaqueAt = sample.layers.length - 1;
  for (let i = 0; i < sample.layers.length; i += 1) {
    if (parseColor(sample.layers[i].bg)[3] >= 1) {
      opaqueAt = i;
      break;
    }
  }
  let bg = pageBase;
  const candidates = [];
  for (let i = opaqueAt; i >= 0; i -= 1) {
    const layer = parseColor(sample.layers[i].bg);
    if (layer[3] > 0) bg = composite(layer, bg);
    const stops = gradientStops(sample.layers[i].image);
    if (stops === null) return null;
    candidates.push(...stops);
  }

  const fgRaw = parseColor(sample.color);
  const large = sample.size >= 24 || (sample.size >= 18.66 && sample.weight >= 700);
  const min = large ? 3 : 4.5;

  let worst = { ratio: Infinity, bg, fg: composite(fgRaw, bg) };
  for (const variant of [null, ...candidates]) {
    const under = variant === null ? bg : composite(parseColor(variant), bg);
    const fg = composite(fgRaw, under);
    const ratio = contrastRatio(fg, under);
    if (ratio < worst.ratio) worst = { ratio, bg: under, fg };
  }
  return { ...worst, min };
}

describe('Sonde 2 - jeder sichtbare Text haelt WCAG AA auf seinem KOMPONIERTEN Untergrund', () => {
  for (const theme of ['light', 'dark']) {
    for (const device of ['mobile', 'desktop']) {
      test(`${theme} / ${device}`, async () => {
        const page = await openPage(harness, { device, theme, locale: 'de' });
        const base = parseColor(
          await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
        );
        const pageBase = base[3] > 0 ? composite(base, [255, 255, 255]) : [255, 255, 255];
        const findings = [];
        let unpainted = 0;
        let measured = 0;
        for (const name of sweep('Sonde 2')) {
          await gotoRoute(page, ALL_ROUTES[name]);
          for (const sample of await collectTextSamples(page)) {
            const result = evaluateSample(sample, pageBase);
            if (!result) {
              unpainted += 1;
              continue;
            }

            // entstehen koennte - siehe der Nachweis unten.
            measured += 1;
            const { ratio, min, bg, fg } = result;
            if (ratio + 0.005 < min) {
              findings.push(
                `${name}/${theme}/${device}: ${ratio.toFixed(2)}:1 (soll ${min})  ` +
                  `${toHex(fg)} auf ${toHex(bg)}  ${sample.size}px/${sample.weight}  ` +
                  `${sample.selector}  "${sample.text}"`,
              );
            }
          }
        }
        await page.close();




        // `collectTextSamples()` auf jeder Route `[]` (umbenanntes
        // `#main-content`, `settle()`-Regress, abgelaufene Sitzung), sind beide

        assert.ok(
          measured >= 600,
          `Nur ${measured} Textproben im ganzen Dokument gerechnet - die Sonde hat nichts ` +
            'gemessen, statt nichts gefunden. Seiten nicht aufgebaut?',
        );
        assert.deepEqual(
          findings,
          [],
          `Textkontrast unter AA im gerenderten Dokument (${unpainted} Elemente standen ` +
            `hinter einem echten Bild und waren nicht rechenbar):\n  ${findings.join('\n  ')}`,
        );
      });
    }
  }
});




const SHAPE_EXEMPT = new Map([
  // 1. Zustandsschalter
  ['item-check', 'Zustandsschalter: Checkbox der Einkaufsliste'],
  ['group-toggle__btn', 'Zustandsschalter: Segment der Aufgaben-Gruppierung'],
  ['cal-toolbar__view-btn', 'Zustandsschalter: Segment der Kalender-Ansicht'],
  ['ydp__trigger', 'Griff: Feld-Oeffner des Datepickers, traegt Feldkante'],
  ['more-sheet__search', 'Griff: Suchfeld des More-Sheets, traegt Feldkante'],
  ['theme-toggle__btn', 'Zustandsschalter: Segment der Farbwelt-Wahl'],
  // 3. Zellen eines Rasters
  ['month-day', 'Rasterzelle: Tag im Kalender-Monat'],
  ['more-action', 'Rasterzelle: Kachel im More-Sheet-Raster'],
  ['metric-card--select', 'Rasterzelle: waehlbare Kennzahlkachel (.metric-card, Block-2-Konsolidierung)'],
  // 4. Zeilen einer Zeilenliste
  ['nav-item', 'Zeile: Eintrag der Sidebar-Navigation'],
  ['settings-shell__navigation-toggle', 'Zeile: Domaenenkopf der Settings-Navigation (Akkordeon)'],
  ['note-item', 'Zeile: Notiz im Dashboard-Widget'],
  ['rewards-widget-row', 'Zeile: Rang im Belohnungs-Widget'],
  ['rw-standing__id', 'Zeile: Oeffner einer Mitglieds-Zeile'],
  ['documents-folder-item__select', 'Zeile: Ordner in der Dokumentenliste'],






  ['cal-task-chip', 'Zeile: Aufgabe in der Eintragsliste einer Kalenderzelle, gleiche Bar wie .month-day__event'],
]);

test('Sonde 3 - es gibt EINE Buttonform, und die Ausnahmen sind Kategorien', async () => {
  const page = await openPage(harness, { device: 'desktop', theme: 'light', locale: 'de' });
  const found = new Map();
  const seen = new Set();

  for (const name of sweep('Sonde 3')) {
    await gotoRoute(page, ALL_ROUTES[name]);
    const rows = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, a.btn, [role="button"]')) {
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const style = getComputedStyle(el);
        const radius = parseFloat(style.borderTopLeftRadius);


        const pill = radius >= rect.height / 2 - 1;
        // Formlos: kein Radius, keine Flaeche, kein KASTEN -> Textaktion oder
        // Zeile, keine zweite Buttonform.
        //





        const boxed = ['Top', 'Right', 'Bottom', 'Left']
          .every((side) => parseFloat(style[`border${side}Width`]) > 0);
        const flat = radius === 0
          && style.backgroundColor === 'rgba(0, 0, 0, 0)'
          && !boxed;


        // die Regel jetzt" unterscheiden.
        const shaped = !pill && !flat;
        const key = [...el.classList].filter((cls) => !cls.startsWith('is-')).join('.')
          || `(klassenlos:${el.id || el.tagName})`;
        out.push({ key, radius, height: Math.round(rect.height), shaped });
      }
      return out;
    });
    for (const row of rows) {
      row.key.split('.').forEach((cls) => seen.add(cls));
      if (!row.shaped) continue;
      if (!found.has(row.key)) found.set(row.key, { ...row, pages: new Set() });
      found.get(row.key).pages.add(name);
    }
  }
  await page.close();




  // Stale-Pruefung unten meldet dann ihre gesamte Liste als verschwunden.
  assert.ok(seen.size >= 20,
    `Nur ${seen.size} Knopf-Klassen im ganzen Dokument gesehen - die Sonde hat `
    + 'nichts gemessen, statt nichts gefunden. Seiten nicht aufgebaut?');

  const offenders = [];
  for (const [key, value] of found) {
    const classes = key.split('.');
    if (classes.some((cls) => SHAPE_EXEMPT.has(cls))) continue;
    offenders.push(
      `${key} (${value.radius}px auf h=${value.height}) auf ${[...value.pages].join(', ')}`,
    );
  }

  assert.deepEqual(offenders.sort(), [],
    'Knoepfe mit eigener Form ausserhalb der vier Ausnahme-Kategorien. Entweder '
    + 'die Kapsel tragen oder in SHAPE_EXEMPT stehen - mit der Kategorie, nicht '
    + 'mit dem Grund „gewachsen".');
});


const TARGET_EXEMPT = new Map([]);

const CROWDING_GAP = 16;

function baseKey(key) {
  return String(key).split('.')[0].split('--')[0];
}

async function measureTargets(page, min) {
  return page.evaluate(({ min, gap }) => {
    const SEL = 'button, a[href], [role="button"], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
    const key = (el) => [...el.classList].filter((c) => !c.startsWith('is-')).join('.')
      || `(${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''})`;

    const els = [];
    for (const el of document.querySelectorAll(SEL)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
      if (el.closest('.sr-only, [aria-hidden="true"], aashiyana-install-prompt')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      els.push(el);
    }
    const rects = els.map((el) => el.getBoundingClientRect());
    const classes = els.map((el) => new Set([...el.classList].filter((c) => !c.startsWith('is-'))));

    const out = [];
    els.forEach((el, i) => {
      const r = rects[i];
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);


      // etwas Falsches zu messen.
      const mine = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit));
      };
      if (!mine(cx, cy)) return;
      const reach = (dx, dy) => {
        let n = 0;
        while (n < min && mine(cx + dx * (n + 1), cy + dy * (n + 1))) n += 1;
        return n;
      };


      let w = Math.max(r.width, reach(-1, 0) + reach(1, 0) + 1);
      let h = Math.max(r.height, reach(0, -1) + reach(0, 1) + 1);



      // (settings/components.js) baut `<label class="toggle-row"><input
      // type="checkbox" 18x18>…<span>Text</span></label>`; die Zeile traegt



      //




      // Ausnahmeliste: `label.control` bzw. `label[for]` sagt verbindlich,
      // welches Element das Label bedient.
      const label = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      if (label && (label.control === el || label.contains(el))) {
        const lr = label.getBoundingClientRect();
        if (lr.width > 0 && lr.height > 0) {
          w = Math.max(w, lr.width);
          h = Math.max(h, lr.height);
        }
      }




      let crowded = false;
      // Fuer die Spacing-Ausnahme (WCAG 2.5.8): naechstes Zielzentrum.
      let nearestCenter = Infinity;
      for (let j = 0; j < els.length && !(crowded && nearestCenter < 24); j += 1) {
        if (j === i || els[j].contains(el) || el.contains(els[j])) continue;
        const o = rects[j];
        const dEdge = Math.hypot(
          Math.max(o.left - r.right, r.left - o.right, 0),
          Math.max(o.top - r.bottom, r.top - o.bottom, 0),
        );
        if (dEdge < gap && [...classes[i]].some((c) => classes[j].has(c))) crowded = true;
        const dCenter = Math.hypot(
          o.left + o.width / 2 - cx,
          o.top + o.height / 2 - cy,
        );
        if (dCenter < nearestCenter) nearestCenter = dCenter;
      }


      //





      // Anzahl").
      //




      // Critique 2026-08-10 mass denselben Fall gegen einen pauschalen

      //


      // was naeher liegt. Wer damit ueber 24 kaeme, hat kein Platzproblem.
      //


      // `.cal-task-chip`. Formal zu Recht - sie stehen NEBENeinander, koennten






      //





      // einzeln haengenden Tagfilter blieben trotzdem gemeldet.
      //




      // `<p class="form-hint">` (18px hoch, weil eine Textzeile 18px hoch

      // Fliesstext um sie herum auseinanderzuziehen.
      const inline = /^inline($|-)/.test(getComputedStyle(el).display)
        && !!el.parentElement
        && el.parentElement.textContent.trim() !== el.textContent.trim();

      let roomy = false;
      if (h < 24 && !inline && el.parentElement) {
        const pr = el.parentElement.getBoundingClientRect();
        const sibs = [...el.parentElement.children]
          .filter((c) => c !== el)
          .map((c) => c.getBoundingClientRect())
          .filter((s) => s.height > 0);
        const above = Math.min(
          r.top - pr.top,
          ...sibs.filter((s) => s.bottom <= r.top + 1).map((s) => r.top - s.bottom),
        );
        const below = Math.min(
          pr.bottom - r.bottom,
          ...sibs.filter((s) => s.top >= r.bottom - 1).map((s) => s.top - r.bottom),
        );
        roomy = h + Math.max(0, above) + Math.max(0, below) >= 24;
      }




      const wcag = (w >= 24 && h >= 24) || nearestCenter >= 24;

      const full = w >= min || h >= min;


      out.push({
        key: key(el),
        w: Math.round(w),
        h: Math.round(h),
        crowded,
        wcag,
        roomy,
        full,
        center: Math.round(nearestCenter),
      });
    });
    return out;
  }, { min, gap: CROWDING_GAP });
}

async function measureScrolled(page, min, maxSteps = 6) {
  const pick = () => {
    const el = document.scrollingElement;
    let best = el;
    let bestOver = el.scrollHeight - el.clientHeight;
    for (const node of document.querySelectorAll('*')) {
      const cs = getComputedStyle(node);
      if (!/auto|scroll/.test(cs.overflowY)) continue;
      const over = node.scrollHeight - node.clientHeight;
      if (over > bestOver) { best = node; bestOver = over; }
    }
    return best;
  };
  const out = [];
  await page.evaluate(pick).catch(() => {});
  for (let step = 0; step < maxSteps; step += 1) {
    out.push(await measureTargets(page, min));
    const moved = await page.evaluate((pickSrc) => {
      // eslint-disable-next-line no-new-func
      const el = new Function(`return (${pickSrc})()`)();
      const before = el.scrollTop;


      el.scrollTop = before + el.clientHeight * 0.7;
      return el.scrollTop > before + 1;
    }, pick.toString());
    if (!moved) break;


    await new Promise((r) => { setTimeout(r, 250); });
  }
  return out;
}

describe('Sonde 4 - eine Reihe traegt ihre Dichte, ein Einzelziel ist allein treffbar', () => {
  // Beide Geraetewelten, denn --target-base schaltet ueber (hover: none): am


  for (const [device, min] of [['mobile', 48], ['desktop', 40]]) {
    test(`${device} (Minimum ${min}px)`, async () => {
      const page = await openPage(harness, { device, theme: 'light', locale: 'de' });
      const found = new Map();








      const rowBuilt = new Set();
      let seen = 0;
      for (const name of sweep('Sonde 4')) {
        await gotoRoute(page, ALL_ROUTES[name]);
        for (const rows of await measureScrolled(page, min)) {
          for (const row of rows) {

            // zaehlte er `querySelectorAll(...).length` - rohe DOM-Knoten, in




            // zwischen „nichts gefunden" und „nichts gemessen".
            seen += 1;






            // blieben drei `--high`-Chips gemeldet, waehrend `--medium` und


            //


            // freistehende Haelfte der Sonde app-weit abgeschaltet: zwei




            // baut, ist keiner.
            if (row.crowded) {
              rowBuilt.add(row.key);
              rowBuilt.add(baseKey(row.key));
            }
            if (row.wcag && row.full && !row.roomy) continue;
            const id = `${row.key}|${row.w}x${row.h}`;
            if (!found.has(id)) found.set(id, { ...row, pages: new Set() });
            found.get(id).pages.add(name);
          }
        }
      }
      await page.close();





      assert.ok(seen >= 600,
        `Nur ${seen} Ziele im ganzen Dokument getastet - die Sonde hat nichts `
        + 'gemessen, statt nichts gefunden. Bricht elementFromPoint?');








      const offenders = [];
      for (const value of found.values()) {
        if (value.key.split('.').some((cls) => TARGET_EXEMPT.has(cls))) continue;
        const inRow = rowBuilt.has(value.key) || rowBuilt.has(baseKey(value.key));
        if (value.wcag && inRow) continue;
        offenders.push(
          `${value.key}: ${value.w}x${value.h} - `
          + `${value.roomy ? 'nimmt die Spacing-Ausnahme, obwohl sein Traeger Platz laesst'
            : !value.wcag ? 'unter 24x24 ohne Spacing-Abstand' : 'freistehend und in KEINER Achse voll'}`
          + ` (naechstes Zielzentrum ${value.center}px) auf ${[...value.pages].join(', ')}`,
        );
      }

      assert.deepEqual(offenders.sort(), [],
        `Ziele unter der Zielgroesse bei ${device}. Die Regel steht in tokens.css `
        + '(„Die Zielgroessen-Regel"): ein freistehendes Ziel haelt die volle '
        + 'Zielgroesse in mindestens einer Achse, ein eingeengtes erfuellt WCAG '
        + '2.5.8. Wer kompakt aussehen und voll treffen will, dehnt seine Flaeche '
        + 'per ::before aus - .weather-widget__refresh ist der Musterfall.');
    });
  }
});

test('Sonde 3+4 - keine Form- und keine Zielgroessen-Ausnahme ueberlebt ihre Klasse', () => {





  //


  // „verschwunden" - die Pruefung urteilte dann ueber Timing statt ueber

  const classes = selectorClasses();



  // ihre gesamte Liste statt ihres Defekts.
  assert.ok(classes.size >= 500,
    `Nur ${classes.size} Klassennamen aus den Stylesheets gelesen - der Regelscanner `
    + 'hat nichts gefunden, statt nichts zu finden.');

  const stale = [];
  for (const [label, list] of [['SHAPE_EXEMPT', SHAPE_EXEMPT], ['TARGET_EXEMPT', TARGET_EXEMPT]]) {
    for (const cls of list.keys()) if (!classes.has(cls)) stale.push(`${label}: .${cls}`);
  }
  assert.deepEqual(stale, [],
    'Eine Ausnahme fuer einen Knopf, den es nicht mehr gibt, ist eine Allowlist, die '
    + 'niemand mehr liest. Diese Klassen nennt kein Selektor mehr.');
});






const ROLE_SIDE = { 'swipe-reveal--delete': 'trailing', 'swipe-reveal--done': 'leading' };

async function uncoveredPanel(page, sign) {





  //


  const scrolled = await page.evaluate(() => {
    const row = document.querySelector('.swipe-row');
    if (!row) return false;
    row.scrollIntoView({ block: 'center' });
    return true;
  });
  if (!scrolled) return null;
  await new Promise((resolve) => setTimeout(resolve, 250));

  const box = await page.evaluate(() => {
    const row = document.querySelector('.swipe-row');
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!box) return null;

  await page.touchscreen.touchStart(box.x, box.y);
  for (const step of [20, 60, 120]) {
    await page.touchscreen.touchMove(box.x + sign * step, box.y);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const shown = await page.evaluate(() => [...document.querySelectorAll('.swipe-row:first-of-type .swipe-reveal')]
    .filter((el) => Number(el.style.opacity) > 0.5)
    .map((el) => [...el.classList].filter((c) => c !== 'swipe-reveal')));

  await page.touchscreen.touchMove(box.x, box.y);
  await page.touchscreen.touchEnd();
  await new Promise((resolve) => setTimeout(resolve, 250));
  return shown[0] ?? [];
}

describe('Sonde 5 - eine Wischzeile antwortet, und jede Rolle liegt an ihrer Kante', () => {
  for (const locale of ['de', 'ar']) {
    test(`Locale ${locale}`, async () => {
      const page = await openPage(harness, { device: 'mobile', theme: 'light', locale });
      const rtl = locale === 'ar';
      const findings = [];
      let listsSeen = 0;

      const measure = async (name) => {
        const hasRows = await page.evaluate(() => Boolean(document.querySelector('.swipe-row .swipe-reveal')));
        if (!hasRows) return;
        listsSeen += 1;



        for (const [sign, side] of [[1, rtl ? 'trailing' : 'leading'], [-1, rtl ? 'leading' : 'trailing']]) {
          const classes = await uncoveredPanel(page, sign);
          const move = sign > 0 ? 'nach rechts' : 'nach links';

          if (!classes?.length) {
            findings.push(`${name}: der Wisch ${move} deckt nichts auf - die Zeilen sind nicht verdrahtet.`);
            continue;
          }
          if (!classes.includes(`swipe-reveal--${side}`)) {
            findings.push(`${name}: der Wisch ${move} deckt ${classes.join('.')} auf, erwartet war die ${side}-Kante.`);
            continue;
          }
          for (const cls of classes) {
            if (ROLE_SIDE[cls] && ROLE_SIDE[cls] !== side) {
              findings.push(`${name}: die Rolle ${cls} liegt an der ${side}-Kante, app-weit gehoert sie an die ${ROLE_SIDE[cls]}-Kante.`);
            }
          }
        }
      };

      for (const name of sweep('Sonde 5')) {
        await gotoRoute(page, ALL_ROUTES[name]);


        // gefahren wird.
        await visitViews(page, name, measure);
      }
      await page.close();



      assert.ok(listsSeen >= 4,
        `Nur ${listsSeen} Wischlisten gesehen - erwartet sind mindestens Aufgaben, Einkauf, Geburtstage `
        + 'und Abonnements. Entweder hat der Seed keine Zeilen geliefert, oder die Bauart hat sich geaendert.');

      assert.deepEqual(findings, [],
        'Wischsemantik im gerenderten Dokument. Die Regel lautet: rechts (zum Zeilenanfang hin) '
        + 'traegt die primaere positive Aktion, links das Destruktive oder Sekundaere - und in RTL '
        + 'spiegelt die Fingerbewegung, nicht die Kante.\n  ' + findings.join('\n  '));
    });
  }
});


async function metricRowHeights(page) {
  return page.evaluate(() => {
    const carriers = new Map();
    for (const card of document.querySelectorAll('.metric-card')) {
      const parent = card.parentElement;
      if (!parent) continue;
      if (!carriers.has(parent)) carriers.set(parent, []);
      carriers.get(parent).push(card);
    }
    const out = [];
    for (const [grid, cards] of carriers) {
      if (cards.length < 2) continue;
      const name = grid.className || grid.tagName.toLowerCase();

      // Unterschied ist keine Unruhe, sondern Layout-Arithmetik.
      const box = (c) => c.getBoundingClientRect();
      const lines = new Map();
      for (const card of cards) {
        const top = Math.round(box(card).top);
        if (!lines.has(top)) lines.set(top, []);
        lines.get(top).push(Math.round(box(card).height));
      }


      for (const heights of lines.values()) {
        if (heights.length > 1) out.push({ grid: name, scope: 'Zeile', heights });
      }






      if (getComputedStyle(grid).gridAutoRows === '1fr' && lines.size > 1) {
        out.push({ grid: name, scope: 'Umbruch', heights: cards.map((c) => Math.round(box(c).height)) });
      }
    }
    return out;
  });
}

describe('Sonde 6 - die Kacheln einer Kennzahlreihe sind gleich hoch', () => {
  for (const device of ['mobile', 'desktop']) {
    test(`Geraet ${device}`, async () => {
      const page = await openPage(harness, { device, theme: 'light', locale: 'de' });
      const findings = [];
      let rowsSeen = 0;

      const check = (where, rows) => {
        for (const row of rows) {
          rowsSeen += 1;
          const spread = Math.max(...row.heights) - Math.min(...row.heights);
          if (spread > 0) {
            findings.push(`${where} · ${row.grid} (${row.scope}): Hoehen ${row.heights.join(', ')} (Streuung ${spread}px).`);
          }
        }
      };




      for (const name of sweep('Sonde 6')) {
        await gotoRoute(page, ALL_ROUTES[name]);
        await visitViews(page, name, async (where) => check(where, await metricRowHeights(page)));
      }
      await page.close();






      assert.ok(rowsSeen >= 5,
        `Nur ${rowsSeen} Kennzahlreihen gesehen - erwartet sind mindestens Budget, Abos, Aufteilen, `
        + 'Darlehen und die Aktivitaets-Reihe der Gesundheit. Entweder hat der Seed keine Zahlen '
        + 'geliefert, oder die Bauart hat sich geaendert.');

      assert.deepEqual(findings, [],
        'Kennzahlreihen im gerenderten Dokument. Gleichartige Kacheln nebeneinander sind gleich hoch, '
        + 'auch wenn die Reihe umbricht - die Hoehe gehoert dem Traeger (.metric-grid, panel.css), '
        + 'nicht dem laengsten Text einer Zelle.\n  ' + findings.join('\n  '));
    });
  }
});


async function cardColumns(page) {
  return page.evaluate(() => {
    const shown = (n) => {
      const r = n.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const opaque = (bg) => bg && bg !== 'rgba(0, 0, 0, 0)' && !/\/\s*0?\.\d+\)/.test(bg);
    const inFlow = (el) => [...el.children].filter((c) => {
      const pos = getComputedStyle(c).position;
      return pos !== 'absolute' && pos !== 'fixed';
    });
    const hits = [];
    const seen = new Set();

    for (const el of document.querySelectorAll('*')) {
      const parent = el.parentElement;
      if (!parent) continue;
      const cls = [...el.classList][0];
      if (!cls) continue;
      const key = `${parent.className}>${cls}`;
      if (seen.has(key)) continue;


      // inaktives Tab-Panel bleibt stehen, und seine Karten messen 0x0.
      const sibs = [...parent.children].filter((s) => s.classList.contains(cls) && shown(s));
      if (sibs.length < 3) continue;


      const rowGap = parseFloat(getComputedStyle(parent).rowGap) || 0;
      if (!(rowGap > 0)) continue;



      const first = sibs[0].getBoundingClientRect();
      const second = sibs[1].getBoundingClientRect();
      if (!(second.top >= first.bottom - 1 && Math.abs(second.left - first.left) < 2)) continue;

      let card = el;
      let via = '';
      if (!opaque(getComputedStyle(el).backgroundColor)) {
        const kids = inFlow(el).filter(shown);
        if (kids.length !== 1) continue;
        [card] = kids;
        via = `${cls} > .`;
      }
      const cs = getComputedStyle(card);
      if (!opaque(cs.backgroundColor)) continue;
      if (cs.breakInside === 'avoid') continue;
      if (el.draggable || card.draggable) continue;
      if (cs.borderTopStyle === 'dashed') continue;

      const rect = card.getBoundingClientRect();
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      if (radius <= 0) continue;
      if (radius >= rect.height / 2 - 0.5) continue;

      seen.add(key);
      hits.push({
        cls: `${via}${[...card.classList][0]}`,
        parent: parent.className.split(' ')[0] || parent.tagName.toLowerCase(),
        count: sibs.length,
        gap: rowGap,
      });
    }
    return hits;
  });
}

const CARD_OBJECT_EXEMPT = new Map([
  ['kanban-card', 'Drag-Objekt zwischen Board-Spalten; die Kartenoptik ist die '
    + 'Greif-Affordance, und ein Schatten je Karte ist dort die Aussage, nicht der Streifen.'],
]);

test('Sonde 7 - eine Zeilenfolge ist keine Spalte aus Karten', async () => {
  const perDevice = new Map();
  let viewsSeen = 0;

  for (const device of ['desktop', 'mobile']) {
    const page = await openPage(harness, { device, theme: 'light', locale: 'de' });
    const found = new Map();
    const note = async (where) => {
      viewsSeen += 1;
      for (const hit of await cardColumns(page)) {
        if (!found.has(hit.cls)) found.set(hit.cls, { ...hit, where });
      }
    };
    for (const name of sweep('Sonde 7')) {
      await gotoRoute(page, ALL_ROUTES[name]);


      if (isLeaf(name)) await note(name);
      else await visitViews(page, name, note);
    }
    await page.close();
    perDevice.set(device, found);
  }



  const desktop = perDevice.get('desktop');
  const mobile = perDevice.get('mobile');
  const seenExempt = new Set();
  const findings = [...desktop.entries()]
    .filter(([cls]) => mobile.has(cls))
    .filter(([cls]) => {
      if (CARD_OBJECT_EXEMPT.has(cls)) { seenExempt.add(cls); return false; }
      return true;
    })
    .map(([cls, hit]) => `${hit.where} · .${cls}: ${hit.count} Karten in .${hit.parent}, getrennt ueber gap ${hit.gap}px.`);



  for (const cls of CARD_OBJECT_EXEMPT.keys()) {
    assert.ok(seenExempt.has(cls),
      `CARD_OBJECT_EXEMPT('${cls}') ohne Fundstelle im Lauf - die Bauform gibt es `
      + 'so nicht mehr, der Eintrag ist eine Leiche und gehoert neu bewertet.');
  }







  const reach = ROUTE_NAMES.length + SETTINGS_NAMES.length;
  assert.ok(viewsSeen >= 2 * (reach + 30),
    `Nur ${viewsSeen} Sichten besucht (erwartet: deutlich mehr als die ${2 * reach} Zustaende). `
    + 'Der Reichweiten-Helfer erreicht die Sichten hinter den Leisten nicht mehr - '
    + 'Budget-Untertabs, Health-Routen, Housekeeping-Tabs, Raster/Liste der Dokumente - '
    + 'oder die Settings-Blaetter fallen wieder aus der Ableitung.');

  assert.deepEqual(findings, [],
    'Kartenspalten im gerenderten Dokument. Eine Folge gleichartiger Zeilen liegt in GENAU EINEM '
    + 'Traeger (randlose Karte, `overflow: hidden`); die Zeilen darin sind flaechenlos und trennen '
    + 'sich ueber `> * + *`. Eine Karte je Zeile sagt „jedes davon ist ein eigenes Objekt", wo die '
    + 'Gruppe gemeint ist - und ein Schatten je Zeile erzeugt in einer langen Liste Streifen.\n  '
    + findings.join('\n  '));
});


async function headDocking(page) {
  return page.evaluate(() => {
    const head = document.querySelector('.page-toolbar');
    if (!head) return null;
    const cs = getComputedStyle(head);
    const visible = (c) => !/rgba\(0, 0, 0, 0\)|\/\s*0\)/.test(c);
    const boxes = [...head.children]
      .filter((c) => c.offsetParent !== null || c.getClientRects().length)
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .sort((a, b) => a.top - b.top);
    const lines = [];
    for (const r of boxes) {
      const line = lines.find((l) => r.top < l.bottom - 1 && r.bottom > l.top + 1);
      if (line) { line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom); }
      else lines.push({ top: r.top, bottom: r.bottom });
    }
    return {
      lead: parseFloat(cs.getPropertyValue('--page-toolbar-lead')) || 0,
      rows: lines.length,
      docked: head.classList.contains('is-docked'),
      line: visible(cs.borderBottomColor) && parseFloat(cs.borderBottomWidth) > 0,
    };
  });
}

async function scrollEveryPort(page) {
  return page.evaluate(() => {
    let most = 0;
    for (const el of document.querySelectorAll('*')) {
      const oy = getComputedStyle(el).overflowY;
      const reserve = el.scrollHeight - el.clientHeight;
      if ((oy === 'auto' || oy === 'scroll') && reserve > 8) {
        el.scrollTop = reserve;
        most = Math.max(most, reserve);
      }
    }
    return most;
  });
}

test('Sonde 8 - ein Kopf mit Lead-Zone traegt seine Linie erst angedockt, und dockt auch an', async () => {
  const page = await openPage(harness, { device: 'mobile', theme: 'light', locale: 'de' });
  const findings = [];
  let headsSeen = 0;
  let leadHeads = 0;

  for (const name of sweep('Sonde 8')) {
    await gotoRoute(page, ALL_ROUTES[name]);


    // Aufbau liest den Zwischenstand.
    await new Promise((r) => setTimeout(r, 700));
    const before = await headDocking(page);
    if (!before) continue;
    headsSeen += 1;




    // Zeilenmessung fuer eine zweite Zeile hielt.
    if (!before.lead) {
      if (!before.line) {
        findings.push(`${name}: ohne Lead-Zone und ohne Linie - der Kopf hat in keinem Zustand eine Kante.`);
      }
      continue;
    }
    leadHeads += 1;






    if (before.rows < 2) {
      findings.push(
        `${name}: Lead-Zone ${before.lead}px, aber der Kopfinhalt steht in EINER Zeile - `
        + 'eine Lead-Zone ohne zweite Zeile verbirgt die Linie dauerhaft.',
      );
      continue;
    }




    if (!before.docked && before.line) {
      findings.push(`${name}: Lead-Zone ${before.lead}px, nicht angedockt, traegt aber schon die Linie.`);
    }

    const reserve = await scrollEveryPort(page);
    await new Promise((r) => setTimeout(r, 700));



    if (reserve <= before.lead) continue;
    const after = await headDocking(page);
    if (!after.docked || !after.line) {
      findings.push(
        `${name}: Lead-Zone ${before.lead}px und ${reserve}px Scroll-Reserve, aber nach dem Scrollen `
        + `${after.docked ? 'angedockt ohne Linie' : 'nicht angedockt'} - die Kopfkante erscheint nie.`,
      );
    }
  }
  await page.close();





  assert.ok(headsSeen >= ROUTE_NAMES.length - 3,
    `Nur ${headsSeen} Modulkoepfe von ${ROUTE_NAMES.length} Routen gesehen - die Sonde erreicht die Koepfe nicht mehr.`);
  assert.ok(leadHeads >= 5,
    `Nur ${leadHeads} Koepfe mit Lead-Zone gesehen (gemessen: 10). Ohne sie prueft diese Sonde nur, `
    + 'dass einzeilige Koepfe eine Linie tragen.');

  assert.deepEqual(findings, [],
    'Die Trennlinie erscheint beim Andocken, und andocken kann nur ein Kopf mit Lead-Zone - wer eine '
    + 'hat, muss es dann aber auch tun. Wo keine ist, steht die Linie durchgehend und markiert die '
    + 'Kopfkante.\n  '
    + findings.join('\n  '));
});

// ============================================================
// Sonde 9 - Compositor-Ebenen im Ruhezustand
// ============================================================




const LAYER_PROPS = ['transform', 'filter', 'backdrop-filter'];

async function restingLayers(page) {
  return page.evaluate((props) => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const wc = getComputedStyle(el).willChange;
      if (!wc || wc === 'auto') continue;
      if (!props.some((p) => wc.includes(p))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cls = (typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.');
      out.push({ sig: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`, wc });
    }
    return out;
  }, LAYER_PROPS);
}

test('Sonde 9 - ein Compositor-Versprechen im Ruhezustand ist einmalig, nie eine Zeile', async () => {
  const page = await openPage(harness, { device: 'mobile', theme: 'light', locale: 'de' });
  const findings = [];
  let routesSeen = 0;
  let layersSeen = 0;

  const routes = sweep('Sonde 9');
  for (const name of routes) {
    await gotoRoute(page, ALL_ROUTES[name]);


    await new Promise((r) => setTimeout(r, 500));
    routesSeen += 1;

    const counts = new Map();
    for (const { sig, wc } of await restingLayers(page)) {
      layersSeen += 1;
      const entry = counts.get(sig) ?? { count: 0, wc };
      entry.count += 1;
      counts.set(sig, entry);
    }

    for (const [sig, { count, wc }] of counts) {
      if (count < 2) continue;
      findings.push(`${name}: ${count}x ${sig} traegt "will-change: ${wc}" im Ruhezustand.`);
    }
  }
  await page.close();




  // (Sidebar-Pille, Sidebar-Hover, Tab-Indikator) plus die Backdrop-Blobs.

  assert.ok(routesSeen >= routes.length - 1,
    `Nur ${routesSeen} von ${routes.length} Zustaenden gesehen.`);
  assert.ok(layersSeen >= routesSeen,
    `Nur ${layersSeen} Ebenen ueber ${routesSeen} Routen gefunden - die Shell allein traegt `
    + 'mehrere je Seite. Die Sonde misst nicht mehr, was sie messen soll.');

  assert.deepEqual(findings, [],
    'Wiederholte Compositor-Versprechen im Ruhezustand. Eine Signatur, die zweimal vorkommt, kommt '
    + 'auch 200-mal: die Ebenen-Last waechst dann mit der Zeilenzahl, auf genau den aelteren '
    + 'Telefonen, die laut PRODUCT.md die Hauptszene sind. Das Versprechen gehoert an die GESTE '
    + '(.swipe-row--armed in layout.css), nicht an die Zeile.\n  '
    + findings.join('\n  '));
});

// ============================================================

// ============================================================

async function settleAnimations(page) {
  try {
    await page.evaluate(() => {
      const finite = document.getAnimations().filter((a) => {
        try { return a.effect?.getTiming().iterations !== Infinity; } catch { return false; }
      });
      return Promise.race([
        Promise.all(finite.map((a) => a.finished.catch(() => {}))),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    });
  } catch {
  }
}

async function documentStructure(page) {
  return page.evaluate(() => {
    const path = (el) => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 3; n = n.parentElement) {
        let s = n.tagName.toLowerCase();
        if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
        const cls = (typeof n.className === 'string' ? n.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) s += `.${cls.join('.')}`;
        parts.unshift(s);
      }
      return parts.join(' > ');
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
        && cs.opacity !== '0' && !el.closest('[hidden],[aria-hidden="true"]');
    };
    const accName = (el) => {
      const a = el.getAttribute('aria-label'); if (a?.trim()) return a.trim();
      const lb = el.getAttribute('aria-labelledby');
      if (lb) {
        const txt = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
        if (txt) return txt;
      }
      const ti = el.getAttribute('title'); if (ti?.trim()) return ti.trim();
      const tx = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (tx) return tx;
      return el.querySelector('img[alt]')?.alt.trim() || '';
    };

    const out = { nameless: [], inputsNoLabel: [], dupIds: [], headings: [], badRefs: [], smallTargets: [] };

    for (const el of document.querySelectorAll('button, a[href], [role="button"], summary, input[type="submit"]')) {
      if (visible(el) && !accName(el)) out.nameless.push(path(el));
    }
    for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
      if (!visible(el)) continue;
      const labelled = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
      if (!labelled && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
        out.inputsNoLabel.push(`${path(el)} (${el.getAttribute('type') || el.tagName.toLowerCase()})`);
      }
    }
    const seen = new Map();
    for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) || 0) + 1);
    for (const [id, n] of seen) if (n > 1) out.dupIds.push(`#${id} (${n}x)`);

    const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
    let prev = 0;
    for (const h of hs) {
      const lvl = Number(h.tagName[1]);
      if (prev && lvl > prev + 1) out.headings.push(`${path(h)}: h${prev} -> h${lvl}`);
      prev = lvl;
    }

    for (const el of document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]')) {
      for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        const missing = v.split(/\s+/).filter((id) => id && !document.getElementById(id));
        if (missing.length) out.badRefs.push(`${path(el)} ${attr}="${missing.join(' ')}"`);
      }
    }

    const min = window.innerWidth < 768 ? 44 : 24;
    for (const el of document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < min && r.height < min) {
        out.smallTargets.push(`${path(el)} ${Math.round(r.width)}x${Math.round(r.height)} (min ${min})`);
      }
    }


    return {
      ...out,
      h1: hs.filter((h) => h.tagName === 'H1').length,
      main: document.querySelectorAll('main,[role="main"]').length,
      lang: document.documentElement.lang || null,
      title: document.title,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test('Sonde 10 - jedes Dokument traegt dieselbe Struktur, angemeldet wie davor', async () => {
  const anonNames = Object.keys(ANON_ROUTES);
  const authNames = sweep('Sonde 10');
  const findings = [];
  let seen = 0;

  const judge = (at, r, { targets }) => {
    seen += 1;



    if (r.h1 !== 1) findings.push(`${at}: ${r.h1} h1 (erwartet: genau eins)`);
    if (r.main !== 1) findings.push(`${at}: ${r.main} main-Landmarken (erwartet: genau eine)`);
    if (!r.lang) findings.push(`${at}: kein lang-Attribut am Dokument`);



    const parts = r.title.split('·').map((s) => s.trim());
    if (!r.title.trim()) findings.push(`${at}: leerer Dokumenttitel`);
    else if (parts.length > 1 && parts[0] === parts[1]) {
      findings.push(`${at}: Dokumenttitel "${r.title}" wiederholt nur den App-Namen`);
    }

    for (const sel of r.nameless) findings.push(`${at}: Ziel ohne zugaenglichen Namen - ${sel}`);
    for (const sel of r.inputsNoLabel) findings.push(`${at}: Eingabefeld ohne Label - ${sel}`);
    for (const id of r.dupIds) findings.push(`${at}: doppelte ID ${id}`);
    for (const h of r.headings) findings.push(`${at}: Ueberschriftensprung ${h}`);
    for (const ref of r.badRefs) findings.push(`${at}: ARIA-Verweis ins Leere - ${ref}`);
    if (targets) {
      for (const s of r.smallTargets) findings.push(`${at}: Zielgroesse unter dem Minimum - ${s}`);
    }
    if (r.overflowX > 1) findings.push(`${at}: ${r.overflowX}px horizontaler Ueberlauf`);
  };

  for (const device of ['mobile', 'desktop']) {

    // diesen Routen wegleiten).
    const anon = await openAnonPage(harness, { device, theme: 'light' });
    for (const name of anonNames) {
      await gotoAnonRoute(anon, ANON_ROUTES[name]);
      await settleAnimations(anon);
      judge(`${device}/${name}`, await documentStructure(anon), { targets: true });
    }
    await anon.close();


    const auth = await openPage(harness, { device, theme: 'light', locale: 'de' });
    for (const name of authNames) {
      await gotoRoute(auth, ALL_ROUTES[name]);
      await settleAnimations(auth);
      judge(`${device}/${name}`, await documentStructure(auth), { targets: false });
    }
    await auth.close();
  }



  const expected = 2 * (anonNames.length + authNames.length);
  assert.equal(seen, expected, `Nur ${seen} von ${expected} Zustaenden gesehen.`);

  assert.deepEqual(findings, [],
    'Struktur-Befunde im gerenderten Dokument. Die Seiten VOR der Anmeldung sind der Erstkontakt '
    + 'und der Weg jedes neuen Familienmitglieds; die dahinter halten dieselbe Grundlage.\n  '
    + findings.join('\n  '));
});

async function keyboardlessClickTargets(page) {
  const cdp = await page.createCDPSession();
  try {

    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const scope = document.querySelector('#main-content') || document.body;
          window.__kbCandidates = [...scope.querySelectorAll('*')].filter((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'
              && !el.closest('[hidden],[aria-hidden="true"]');
          });
          return window.__kbCandidates.length;
        })()
      `,
      returnByValue: true,
    });

    const findings = [];



    // danach Freispruch. Degradiert der CDP-Pfad (DOMDebugger weg, Handles tot),

    // unveraendert aussehen.
    let withClick = 0;
    for (let i = 0; i < result.value; i += 1) {
      const { result: handle } = await cdp.send('Runtime.evaluate', { expression: `window.__kbCandidates[${i}]` });
      try {
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: handle.objectId, depth: 0 });
        if (!listeners.some((l) => l.type === 'click')) continue;
        withClick += 1;
        const hasKeyListener = listeners.some((l) => l.type === 'keydown' || l.type === 'keypress');

        const { result: meta } = await cdp.send('Runtime.callFunctionOn', {
          objectId: handle.objectId,
          returnByValue: true,
          functionDeclaration: `function () {
            const native = this.matches('a[href],button,input,select,textarea,summary,[contenteditable]');
            const tabindex = this.getAttribute('tabindex');
            return {
              tag: this.tagName.toLowerCase(),
              cls: (typeof this.className === 'string' ? this.className : '').trim().slice(0, 60),
              focusable: native || (tabindex !== null && Number(tabindex) >= 0),
              delegates: Boolean(this.querySelector('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')),



              // kinderloses Textelement (der Leerzustand).
              targetless: this.childElementCount === 0
                || (this.childElementCount === 1
                  && this.firstElementChild.childElementCount === 0
                  && this.firstElementChild.textContent.trim().length > 0),
            };
          }`,
        });
        const el = meta.value;
        if (el.focusable || hasKeyListener || el.delegates || el.targetless) continue;
        findings.push(`<${el.tag}${el.cls ? ` class="${el.cls}"` : ''}>`);
      } finally {
        await cdp.send('Runtime.releaseObject', { objectId: handle.objectId });
      }
    }
    return { findings, withClick };
  } finally {
    await cdp.detach();
  }
}

test('Sonde 11 - was einen Klick annimmt, nimmt auch eine Taste an', async () => {
  const findings = [];
  let seen = 0;
  let withClick = 0;

  const routes = sweep('Sonde 11');
  const page = await openPage(harness, { device: 'desktop', theme: 'light', locale: 'de' });
  for (const name of routes) {
    await gotoRoute(page, ALL_ROUTES[name]);
    await settleAnimations(page);
    seen += 1;
    const probed = await keyboardlessClickTargets(page);
    withClick += probed.withClick;
    for (const el of probed.findings) {
      findings.push(`${name}: ${el}`);
    }
  }
  await page.close();





  assert.equal(seen, routes.length, `Nur ${seen} von ${routes.length} Zustaenden gesehen.`);
  assert.ok(withClick >= 250,
    `Nur ${withClick} Elemente mit click-Listener gefunden - der CDP-Pfad misst nicht `
    + '(DOMDebugger.getEventListeners tot, Handles nicht aufloesbar?), statt nichts zu finden.');

  assert.deepEqual(findings, [],
    'Element mit click-Listener, ohne eigenen Tastaturzugang UND ohne inneres Bedienelement, '
    + 'an das es delegieren koennte - hier endet der Klick und die Tastatur kommt nicht an '
    + '(WCAG 2.1.1, Level A).\n  '
    + findings.join('\n  '));
});


async function withMedia(page, features) {
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', { features });
  const applied = await page.evaluate(
    (list) => list.map((f) => matchMedia(`(${f.name}: ${f.value})`).matches),
    features,
  );
  return { cdp, applied };
}

async function glassBackedSurfaces(page) {
  return page.evaluate(() => {
    const path3 = (el) => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 3; n = n.parentElement) {
        let s = n.tagName.toLowerCase();
        if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
        const cls = (typeof n.className === 'string' ? n.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) s += `.${cls.join('.')}`;
        parts.unshift(s);
      }
      return parts.join(' > ');
    };
    const selectors = new Set();
    const walk = (rules) => {
      for (const rule of rules) {


        if (rule.cssRules?.length) { walk(rule.cssRules); continue; }
        if (!rule.style || !rule.selectorText) continue;
        if (/background(-color)?:[^;]*var\(--glass-bg-/.test(rule.cssText)) selectors.add(rule.selectorText);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* fremde Herkunft - hier gibt es keine */ }
    }

    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      let hits = [];
      try { hits = [...document.querySelectorAll(selector)]; } catch { continue; }
      for (const el of hits) {
        if (seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const bf = cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : cs.webkitBackdropFilter;
        const blur = [...String(bf || '').matchAll(/blur\(\s*([\d.]+)px\s*\)/g)].map((m) => Number(m[1])).filter((v) => v > 0);
        out.push({ sel: path3(el), blur: blur.length ? Math.max(...blur) : 0, bg: cs.backgroundColor });
      }
    }
    return out;
  });
}

async function declaredGlassInMain(page) {
  return page.evaluate(() => {
    const selectors = new Set();
    const walk = (rules) => {
      for (const rule of rules) {

        // Verzweigungskriterium, jede CSSStyleRule traegt eine leere Liste.
        if (rule.cssRules?.length) { walk(rule.cssRules); continue; }
        if (!rule.style || !rule.selectorText) continue;




        // beim ersten Lauf gemeldet.
        const declared = /backdrop-filter:\s*([^;}]+)/i.exec(rule.cssText)?.[1] ?? '';
        if (/^\s*none\s*$/i.test(declared)) continue;          // das Abraeumen selbst
        const viaToken = /var\(\s*--blur-/.test(declared);
        const viaLiteral = [...declared.matchAll(/blur\(\s*([\d.]+)px\s*\)/g)].some((m) => Number(m[1]) > 0);
        if (!viaToken && !viaLiteral) continue;                 // u.a. blur(0px)
        selectors.add(rule.selectorText);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* fremde Herkunft - hier gibt es keine */ }
    }

    const main = document.querySelector('#main-content');
    const out = [];
    for (const selector of selectors) {
      let hits = [];
      try { hits = [...document.querySelectorAll(selector)]; } catch { continue; }


      if (main && hits.some((el) => el !== main && main.contains(el))) out.push(selector);
    }
    return { selectorsSeen: selectors.size, offenders: out };
  });
}

async function glassSurfaces(page) {
  return page.evaluate(() => {
    const path3 = (el) => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 3; n = n.parentElement) {
        let s = n.tagName.toLowerCase();
        if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
        const cls = (typeof n.className === 'string' ? n.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) s += `.${cls.join('.')}`;
        parts.unshift(s);
      }
      return parts.join(' > ');
    };
    const main = document.querySelector('#main-content');
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const bf = cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : cs.webkitBackdropFilter;
      if (!bf || bf === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;

      // und kein Verstoss.
      const blur = [...bf.matchAll(/blur\(\s*([\d.]+)px\s*\)/g)].map((m) => Number(m[1])).filter((v) => v > 0);
      out.push({
        sel: path3(el),
        inMain: Boolean(main && main.contains(el)),
        blur: blur.length ? Math.max(...blur) : 0,
        bg: cs.backgroundColor,
      });
    }
    return out;
  });
}

test('Sonde 12 - Glas sitzt auf Chrome, nie im Seiteninhalt', async () => {
  const findings = [];
  const declaredFindings = [];
  const seen = new Set();
  let declaredSeen = 0;
  for (const device of ['mobile', 'desktop']) {
    const page = await openPage(harness, { device, theme: 'light', locale: 'de' });
    for (const name of sweep('Sonde 12')) {
      await gotoRoute(page, ALL_ROUTES[name]);
      await settleAnimations(page);

      // Compositor-Gegenmassnahme raeumt jeden backdrop-filter im Scrollport ab.

      for (const g of await glassSurfaces(page)) {
        seen.add(g.sel);
        if (g.inMain) findings.push(`${device}/${name}: ${g.sel}`);
      }

      const declared = await declaredGlassInMain(page);
      declaredSeen = Math.max(declaredSeen, declared.selectorsSeen);




      for (const sel of declared.offenders) declaredFindings.push(`${device}/${name}: ${sel}`);
    }
    await page.close();
  }


  assert.ok(seen.size >= 5,
    `Nur ${seen.size} Glasflaechen im Dokument gesehen - Ebene 1 hat nichts gemessen.`);
  assert.ok(declaredSeen >= 5,
    `Nur ${declaredSeen} Regeln mit deklariertem Blur gefunden - Ebene 2 hat nichts gemessen. `
    + 'Traegt das CSSOM die Regeln noch, oder ist die Blur-Schreibweise eine andere?');

  assert.deepEqual([...findings, ...declaredFindings], [],
    'backdrop-filter INNERHALB von #main-content. Glas ist Chrome: Tab-Bar, Sidebar, Sheets, '
    + 'Toast, Datepicker-Popover, FAB samt Backdrop. Inhalte - Karten, Listen, Widgets, Text - '
    + 'sind opak (Die Glas-ist-Chrome-Regel).\n'
    + 'Treffer aus der zweiten Ebene sind DEKLARIERT und heute womoeglich wirkungslos, weil '
    + '`.app-content *` sie mit !important abraeumt - sie wirken, sobald das Element aus dem '
    + `Scrollport wandert oder jene Regel faellt.\n  ${[...findings, ...declaredFindings].join('\n  ')}`);
});

for (const [label, features] of [
  ['reduzierter Transparenz', [{ name: 'prefers-reduced-transparency', value: 'reduce' }]],
  ['erhoehtem Kontrast', [{ name: 'prefers-contrast', value: 'more' }]],
]) {
  test(`Sonde 12 - unter ${label} bleibt keine Glasflaeche durchsichtig`, async () => {
    const page = await openPage(harness, { device: 'mobile', theme: 'light', locale: 'de' });
    const { cdp, applied } = await withMedia(page, [
      { name: 'prefers-color-scheme', value: 'light' },
      ...features,
    ]);


    assert.ok(applied.every(Boolean),
      `Der Medienzustand liegt nicht an (${JSON.stringify(applied)}) - die Sonde misst den Normalfall.`);

    const findings = [];
    let blurred = 0;
    let backed = 0;
    for (const name of sweep('Sonde 12')) {
      await gotoRoute(page, ALL_ROUTES[name]);
      await settleAnimations(page);
      // (1) KEIN wirksamer Blur mehr - ueber alles, was `backdrop-filter` traegt.
      for (const g of await glassSurfaces(page)) {
        blurred += 1;
        if (g.blur > 0) findings.push(`${name}: ${g.sel} traegt weiter blur(${g.blur}px)`);
      }

      for (const g of await glassBackedSurfaces(page)) {
        backed += 1;
        const alpha = parseColor(g.bg)[3];
        if (alpha < 1) {
          findings.push(`${name}: ${g.sel} bleibt durchsichtig (alpha ${alpha.toFixed(2)}) - `
            + 'ohne Blur scheint der Inhalt darunter unverwischt durch');
        }
      }
    }
    await cdp.detach();
    await page.close();

    assert.ok(blurred > 0, 'Keine Glasflaeche gesehen - die Sonde hat nichts gemessen.');
    assert.ok(backed > 0, 'Keine Flaeche mit Glas-Grund gesehen - die CSSOM-Suche greift nicht mehr.');
    assert.deepEqual(findings, [],
      `Die Fallback-Regel kommt im Dokument nicht an (${label}). Das Stylesheet kippt `
      + '--blur-2xs..lg auf blur(0px) und die --glass-bg-* auf --color-surface-Werte; '
      + `gemessen wird, ob das die Flaeche erreicht.\n  ${findings.join('\n  ')}`);
  });
}


async function openFabModal(page) {
  return page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));


    const fab = document.querySelector('#fab-layer .page-fab, .page-fab');
    if (!fab) return { skipped: 'kein FAB' };
    fab.click();
    await wait(700);

    let panel = document.querySelector('.modal-panel');
    if (!panel) {
      const action = document.querySelector('.fab-action__btn, .fab-actions button');
      if (!action) return { skipped: 'kein Modal und kein Aktionsmenue' };
      action.click();
      await wait(700);
      panel = document.querySelector('.modal-panel');
    }
    if (!panel) return { skipped: 'Aktionsmenue oeffnete kein Modal' };

    const path3 = (el) => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 3; n = n.parentElement) {
        let s = n.tagName.toLowerCase();
        if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
        const cls = (typeof n.className === 'string' ? n.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) s += `.${cls.join('.')}`;
        parts.unshift(s);
      }
      return parts.join(' > ');
    };

    const vis = (el) => {
      if (el.closest('[aria-hidden="true"], .sr-only')) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };

    const fields = [...panel.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(vis);
    const targets = [...panel.querySelectorAll('button, [role="button"], a[href], input[type=checkbox], input[type=radio], select')].filter(vis);
    const min = window.innerWidth < 768 ? 44 : 24;

    return {
      title: (panel.querySelector('.modal-panel__title, h2, h3')?.textContent || '').trim().slice(0, 40),
      fields: fields.length,
      targets: targets.length,
      unlabelled: fields.filter((el) => {
        const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
        return !lab && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby');
      }).map((el) => `${path3(el)} (${el.getAttribute('type') || el.tagName.toLowerCase()})`),
      badRefs: [...panel.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]')].flatMap((el) =>
        ['aria-labelledby', 'aria-describedby', 'aria-controls'].flatMap((attr) => {
          const v = el.getAttribute(attr);
          if (!v) return [];
          const missing = v.split(/\s+/).filter((id) => id && !document.getElementById(id));
          return missing.length ? [`${path3(el)} ${attr}="${missing.join(' ')}"`] : [];
        })),
      small: targets.filter((el) => {
        const r = el.getBoundingClientRect();






        const label = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        const box = label && (label.control === el || label.contains(el)) ? label.getBoundingClientRect() : r;
        const w = Math.max(r.width, box.width);
        const h = Math.max(r.height, box.height);
        return w < min && h < min;
      }).map((el) => {
        const r = el.getBoundingClientRect();
        return `${path3(el)} ${Math.round(r.width)}x${Math.round(r.height)} (min ${min})`;
      }),
    };
  });
}

test('Sonde 13 - die Formulare hinter dem FAB halten dieselbe Grundlage wie die Seiten', async () => {
  const findings = [];
  const shapes = new Set();
  let opened = 0;
  const skipped = [];

  for (const device of ['mobile', 'desktop']) {
    const page = await openPage(harness, { device, theme: 'light', locale: 'de' });
    for (const name of sweep('Sonde 13')) {
      await gotoRoute(page, ALL_ROUTES[name]);
      await settleAnimations(page);
      const r = await openFabModal(page);
      if (r.skipped) { skipped.push(`${device}/${name}: ${r.skipped}`); continue; }
      opened += 1;
      shapes.add(`${device}|${r.title}|${r.fields}|${r.targets}`);
      const at = `${device}/${name} „${r.title}"`;
      for (const f of r.unlabelled) findings.push(`${at}: Eingabefeld ohne Label - ${f}`);
      for (const b of r.badRefs) findings.push(`${at}: ARIA-Verweis ins Leere - ${b}`);
      for (const s of r.small) findings.push(`${at}: Zielgroesse unter dem Minimum - ${s}`);
    }
    await page.close();
  }


  // denselben Dialog oeffnet, waere gruen und haette nichts gesehen.
  assert.ok(opened >= 18, `Nur ${opened} Modals geoeffnet (uebersprungen: ${skipped.join(', ')}).`);
  assert.ok(shapes.size >= 16,
    `${opened} Modals geoeffnet, aber nur ${shapes.size} unterscheidbare - die Sonde misst `
    + 'moeglicherweise mehrfach denselben Dialog.');

  assert.deepEqual(findings, [],
    'Befund in einem Modal. Dort stehen die Formulare der App, und bis Session 23 hat sie '
    + 'keine Sonde gesehen - ein Feld ohne Label ist WCAG 3.3.2 (Level A).\n  '
    + findings.join('\n  '));
});


async function collectIconSamples(page) {
  return page.evaluate(() => {
    const path3 = (el) => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 3; n = n.parentElement) {
        let s = n.tagName.toLowerCase();
        if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
        const cls = (typeof n.className === 'string' ? n.className : n.className?.baseVal || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) s += `.${cls.join('.')}`;
        parts.unshift(s);
      }
      return parts.join(' > ');
    };


    const painted = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (!cs.backgroundColor || cs.backgroundColor === 'rgba(0, 0, 0, 0)') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      painted.push({ el, r, bg: cs.backgroundColor });
    }

    const out = [];
    for (const icon of document.querySelectorAll('svg')) {

      if (icon.closest('[aria-hidden="true"] > *') && !icon.closest('button, a[href], [role="button"]')) continue;
      if (icon.closest(':disabled, [aria-disabled="true"], .sr-only, aashiyana-install-prompt')) continue;
      const cs = getComputedStyle(icon);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.5) continue;
      const r = icon.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;

      // Sonde 2 schon misst.
      const stroke = cs.stroke && cs.stroke !== 'none' ? cs.stroke : null;
      const fill = cs.fill && cs.fill !== 'none' && cs.fill !== 'rgba(0, 0, 0, 0)' ? cs.fill : null;
      const ink = stroke || fill || cs.color;
      if (!ink) continue;

      // PSEUDOELEMENTE ZAEHLEN MIT. `.item-check` traegt seine gefuellte




      // `.weather-widget__refresh` seine Trefferflaeche per `::before` dehnt:

      const layers = [];
      for (let n = icon.parentElement; n; n = n.parentElement) {
        const ncs = getComputedStyle(n);
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(n, pseudo);
          if (!ps.content || ps.content === 'none') continue;
          if (!ps.backgroundColor || ps.backgroundColor === 'rgba(0, 0, 0, 0)') continue;

          // (Badge, Punkt, Specular) ist kein Untergrund.
          const pr = { w: parseFloat(ps.width), h: parseFloat(ps.height) };
          if (!(pr.w >= r.width && pr.h >= r.height)) continue;
          layers.push({ bg: ps.backgroundColor, image: ps.backgroundImage });
        }
        layers.push({ bg: ncs.backgroundColor, image: ncs.backgroundImage });
      }



      let sibling = null;
      for (const p of painted) {
        if (p.el === icon || p.el.contains(icon) || icon.contains(p.el)) continue;
        if (!(p.r.left < r.right && p.r.right > r.left && p.r.top < r.bottom && p.r.bottom > r.top)) continue;
        if (!(p.el.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;



        // (`.nav-bottom__items` > `.nav-bottom__indicator` neben





        let depth = 0;
        let common = icon.parentElement;
        while (common && !common.contains(p.el) && depth < 3) { common = common.parentElement; depth += 1; }
        if (!common || !common.contains(p.el) || depth >= 3) continue;
        if (p.el.parentElement !== common) continue;
        sibling = { bg: p.bg, sel: path3(p.el) };
        break;
      }

      out.push({ sel: path3(icon), ink, layers, sibling });
    }
    return out;
  });
}

test('Sonde 14 - ein Icon auf getoentem Grund haelt 3:1', async () => {
  const findings = [];
  let seen = 0;
  let withSibling = 0;

  for (const theme of ['light', 'dark']) {
    for (const device of ['mobile', 'desktop']) {
      const page = await openPage(harness, { device, theme, locale: 'de' });
      const base = parseColor(
        await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
      );
      const pageBase = base[3] > 0 ? composite(base, [255, 255, 255]) : [255, 255, 255];
      for (const name of sweep('Sonde 14')) {
        await gotoRoute(page, ALL_ROUTES[name]);
        await settleAnimations(page);
        for (const s of await collectIconSamples(page)) {

          // ersten deckenden Ebene.
          let opaqueAt = s.layers.length - 1;
          for (let i = 0; i < s.layers.length; i += 1) {
            if (parseColor(s.layers[i].bg)[3] >= 1) { opaqueAt = i; break; }
          }
          let bg = pageBase;




          if (s.sibling) {
            withSibling += 1;
            const sib = parseColor(s.sibling.bg);
            if (sib[3] > 0) bg = composite(sib, bg);
          }
          let unpaintable = false;
          for (let i = opaqueAt; i >= 0; i -= 1) {
            if (/url\(/i.test(s.layers[i].image || '')) { unpaintable = true; break; }
            const layer = parseColor(s.layers[i].bg);
            if (layer[3] > 0) bg = composite(layer, bg);
          }
          if (unpaintable) continue;
          seen += 1;
          const fg = composite(parseColor(s.ink), bg);
          const ratio = contrastRatio(fg, bg);
          if (ratio + 0.005 < 3) {
            findings.push(
              `${name}/${theme}/${device}: ${ratio.toFixed(2)}:1 (soll 3)  ${toHex(fg)} auf ${toHex(bg)}  `
              + `${s.sel}${s.sibling ? `  [ueber ${s.sibling.sel}]` : ''}`,
            );
          }
        }
      }
      await page.close();
    }
  }

  assert.ok(seen >= 200, `Nur ${seen} Icons gemessen - die Sonde hat nichts gesehen.`);


  assert.ok(withSibling > 0,
    'Keine einzige Geschwister-Flaeche gefunden - die Bauform, wegen der Sonde 2 an der '
    + 'Tab-Bar-Pille zu milde urteilt, wird nicht mehr erkannt.');

  assert.deepEqual(findings, [],
    `Icon unter 3:1 auf seinem komponierten Untergrund (WCAG 1.4.11, grafische Objekte; `
    + `${withSibling} davon auf einer Flaeche, die die Vorfahrenkette nicht sieht).\n  `
    + findings.join('\n  '));
});


const BAR_ROW = 48 + 2 * 4;
const HEAD_MAX = 2 * BAR_ROW + 16;
const HEAD_ROWS_MAX = 2;

describe('Sonde 15 - in der kompakten Hoehe traegt der Kopf hoechstens eine Bedienzeile', () => {
  test('short 640x400', async () => {
    const page = await openPage(harness, { device: 'short', theme: 'light', locale: 'de' });
    const offenders = [];
    let seen = 0;

    for (const name of sweep('Sonde 15')) {
      await gotoRoute(page, ALL_ROUTES[name]);
      const heads = await page.evaluate(() => [...document.querySelectorAll('.page-toolbar')]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => {

          const spans = [...el.children]
            .map((c) => c.getBoundingClientRect())
            .filter((r) => r.height > 0)
            .map((r) => [r.top, r.bottom])
            .sort((a, b) => a[0] - b[0]);
          let rows = 0;
          let end = -Infinity;
          for (const [top, bottom] of spans) {
            if (top >= end) rows += 1;
            end = Math.max(end, bottom);
          }
          return { h: el.getBoundingClientRect().height, rows, cls: el.className };
        }));
      for (const head of heads) {
        seen += 1;
        if (head.rows <= HEAD_ROWS_MAX && head.h <= HEAD_MAX) continue;
        offenders.push(
          `${name}: ${head.rows} Zeilen / ${Math.round(head.h)}px `
          + `(max ${HEAD_ROWS_MAX} / ${HEAD_MAX}) - ${head.cls}`,
        );
      }
    }
    await page.close();



    assert.ok(seen >= 12,
      `Nur ${seen} Modulkoepfe gefunden - die Sonde hat nichts gemessen, statt nichts `
      + 'zu finden. Rendert die App in dieser Groessenklasse ueberhaupt?');

    assert.deepEqual(offenders.sort(), [],
      'Modulkopf baut in der kompakten Hoehe hoeher als zwei Bar-Zeilen - damit steht '
      + 'ueber dem Inhalt mehr als der Kopf und eine Bedienzeile (DESIGN.md, Die '
      + `Chrome-Regel).\n  ${offenders.join('\n  ')}`);
  });
});


describe('Sonde 16 - kein dauerlaufendes Element rastert pro Frame einen Filter', () => {
  test('desktop 1280x900', async () => {
    const page = await openPage(harness, { device: 'desktop', theme: 'light', locale: 'de' });
    const offenders = [];
    let seen = 0;

    for (const name of sweep('Sonde 16')) {
      await gotoRoute(page, ALL_ROUTES[name]);
      const found = await page.evaluate(() => {
        const out = { animated: 0, offenders: [] };
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);


          const endless = cs.animationIterationCount.split(',')
            .some((v) => v.trim() === 'infinite');


          const running = cs.animationPlayState.split(',').some((v) => v.trim() === 'running')
            && cs.animationDuration.split(',').some((v) => parseFloat(v) > 0);
          if (!endless || !running) continue;
          out.animated += 1;
          const filter = cs.filter;
          if (filter && filter !== 'none') {
            out.offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(ohne Klasse)'} -> ${filter}`);
          }
        }
        return out;
      });
      seen += found.animated;
      for (const o of found.offenders) offenders.push(`${name}: ${o}`);
    }
    await page.close();






    assert.ok(seen >= 4 * sweep('Sonde 16').length,
      `Nur ${seen} dauerlaufende Animationen ueber ${sweep('Sonde 16').length} Zustaende `
      + '- die Sonde hat nichts gemessen, statt nichts zu finden. Laeuft der lebende '
      + 'Backdrop (.lg-blob) noch?');

    assert.deepEqual(offenders.sort(), [],
      'Ein endlos animiertes Element traegt einen `filter` und rastert ihn damit pro '
      + 'Frame neu - im Leerlauf, solange die Seite offen ist (Issue #716). Bewegung '
      + 'und Filter gehoeren auf zwei Knoten: die aeussere Huelle bewegt sich, das '
      + `Kind traegt den Filter und steht still (siehe .lg-blob in glass.css).\n  ${offenders.join('\n  ')}`);
  });
});


describe('Sonde 17 - die Zustellnotiz des ResizeObservers ist kein Anwendungsfehler', () => {
  test('desktop 1280x900', async () => {
    const page = await openPage(harness, { device: 'desktop', theme: 'light', locale: 'de' });
    await gotoRoute(page, ALL_ROUTES[ROUTE_NAMES[0]]);

    const seen = await page.evaluate(async () => {
      const count = () => document.querySelectorAll('.toast-container .toast--danger').length;
      const settleFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
      const fire = (message, error) => window.dispatchEvent(
        new ErrorEvent('error', { message, error, bubbles: false, cancelable: true }));


      const clear = () => document.querySelectorAll('.toast-container .toast')
        .forEach((el) => el.remove());

      clear();
      const start = count();

      fire('ResizeObserver loop completed with undelivered notifications.', null);
      await settleFrame();
      const afterNotice = count();
      // Die aeltere Fassung derselben Notiz.
      fire('ResizeObserver loop limit exceeded', null);
      await settleFrame();
      const afterOldNotice = count();




      // error-Objekt" prueft.
      clear();
      fire('Kaputt', new Error('Kaputt'));
      await settleFrame();
      const afterRealWithObject = count();
      clear();
      fire('Kaputt ohne Objekt', null);
      await settleFrame();
      const afterRealWithoutObject = count();
      return { start, afterNotice, afterOldNotice, afterRealWithObject, afterRealWithoutObject };
    });
    await page.close();

    assert.equal(seen.afterNotice, seen.start,
      'Die ResizeObserver-Zustellnotiz hat einen Fehler-Toast erzeugt. Sie ist kein '
      + 'Fehler, sondern die spezifikationsgemaesse Meldung, dass eine weitere '
      + 'Observer-Runde einen Frame spaeter zugestellt wird (router.js, '
      + 'RESIZE_OBSERVER_NOTICE).');
    assert.equal(seen.afterOldNotice, seen.start,
      'Die aeltere Schreibweise „ResizeObserver loop limit exceeded" kommt noch durch.');
    assert.equal(seen.afterRealWithObject, 1,
      'Ein ECHTER unbehandelter Fehler erzeugt keinen Toast mehr - der Filter ist zu '
      + 'breit geworden und verschluckt jetzt, was er melden soll. Das ist der '
      + 'schlimmere der beiden Fehler.');
    assert.equal(seen.afterRealWithoutObject, 1,
      'Ein Fehler OHNE `error`-Objekt wird verschluckt. So kommen Fehler aus fremdem '
      + 'Ursprung an ("Script error."); wer auf das fehlende Objekt statt auf die '
      + 'Meldung filtert, macht sie unsichtbar.');
  });
});


async function installScrollportFinder(page) {
  await page.evaluate(() => {
    window.__aashiyanaScrollport = () => {
      const outer = document.querySelector('.app-content');
      const kandidaten = [...document.querySelectorAll('#main-content *')].filter((el) => {
        const s = getComputedStyle(el);
        return (s.overflowY === 'auto' || s.overflowY === 'scroll')
          && el.scrollHeight > el.clientHeight + 4;
      });
      kandidaten.sort((a, b) => b.clientHeight - a.clientHeight);
      return kandidaten[0] || outer;
    };
  });
}

async function fabAtScrollEnd(page) {
  await installScrollportFinder(page);
  const toEnd = () => page.evaluate(() => {
    const scroller = window.__aashiyanaScrollport();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await new Promise((r) => setTimeout(r, 700));
  await toEnd();
  await new Promise((r) => setTimeout(r, 700));
  await toEnd();
  await new Promise((r) => setTimeout(r, 550));

  return page.evaluate(() => {
    const px = (n) => Math.round(n * 10) / 10;
    const outer = document.querySelector('.app-content');
    const scroller = window.__aashiyanaScrollport();
    const inner = scroller === outer ? null : scroller;
    const fab = document.querySelector('.page-fab:not([hidden])');
    const o = outer.getBoundingClientRect();
    const clip = (inner || outer).getBoundingClientRect();
    const res = {
      scrollportUnten: px(o.bottom),
      viewportHoehe: window.innerHeight,
      amEnde: !scroller || scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2,
      scrollbar: !!scroller && scroller.scrollHeight > scroller.clientHeight + 4,
    };
    if (!fab) return { ...res, keinFab: true };

    const f = fab.getBoundingClientRect();

    const schwebend = !!fab.closest('.fab-layer') && f.width > 0 && f.height > 0;
    if (!schwebend) {
      return { ...res, keinFab: true, angedockt: !fab.closest('.fab-layer'), eingeklappt: f.width < 1 || f.height < 1 };
    }



    const SEL = ['button', 'a[href]', '[role="button"]', 'input:not([type=hidden])',
      'select', 'textarea', 'summary', '[tabindex]:not([tabindex="-1"])']
      .map((s) => `#main-content ${s}`).join(', ');
    res.unterFab = [];
    for (const el of document.querySelectorAll(SEL)) {
      if (el === fab || fab.contains(el) || el.contains(fab)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;




      // (`row-action` 13 %, `pantry-stepper__btn` 10 %,


      // Nav-Zone. Dieselbe Falle 2, die Sonde 4 an ihren Kanten beschreibt.
      if (b.bottom <= clip.top || b.top >= clip.bottom) continue;
      const w = Math.min(b.right, f.right) - Math.max(b.left, f.left);
      const h = Math.min(b.bottom, Math.min(f.bottom, clip.bottom)) - Math.max(b.top, Math.max(f.top, clip.top));
      if (w <= 0 || h <= 0) continue;
      res.unterFab.push({
        sel: [...el.classList].slice(0, 2).join('.') || el.tagName.toLowerCase(),
        anteil: Math.round((w * h) / (b.width * b.height) * 100),
      });
    }
    return res;
  });
}

describe('Sonde 18 - am Scroll-Ende liegt nichts Bedienbares unter dem FAB', () => {
  for (const device of ['mobile', 'desktop']) {
    test(`Geraet ${device}`, async () => {
      const page = await openPage(harness, { device, theme: 'light', locale: 'de' });
      const findings = [];
      let seen = 0;
      let angedockt = 0;
      let eingeklappt = 0;
      let ohneFab = 0;

      for (const name of sweep('Sonde 18')) {
        await gotoRoute(page, ALL_ROUTES[name]);
        const m = await fabAtScrollEnd(page);
        if (m.angedockt) angedockt += 1;
        if (m.eingeklappt) eingeklappt += 1;

        if (device === 'desktop' && m.scrollportUnten < m.viewportHoehe - 1) {
          findings.push(`${name}: der Scrollport endet ${Math.round(m.viewportHoehe - m.scrollportUnten)}px `
            + 'ueber der Fensterkante - die FAB-Reserve verkuerzt ihn wieder statt als Nachlauf zu reiten.');
        }

        // Drei Module fuehren ihre Primaeraktion ohne FAB - kein Befund.
        if (m.keinFab) {
          if (!m.angedockt && !m.eingeklappt) ohneFab += 1;
          continue;
        }

        if (!m.amEnde) continue;
        seen += 1;

        if (m.unterFab.length) {
          findings.push(`${name}: am Scroll-Ende liegt ${m.unterFab.map((h) => `${h.sel} (${h.anteil} %)`).join(', ')} `
            + 'unter dem FAB - dort laesst sich nichts mehr wegscrollen, das Ziel ist unerreichbar.');
        }
      }
      await page.close();

      if (device === 'desktop') {
        assert.equal(seen, 1,
          `Auf dem Zeigergeraet schwebt genau ein FAB ueber dem Inhalt (das Dashboard-Speed-Dial), `
          + `gemessen wurden ${seen}. Entweder dockt ein Modul nicht mehr an, oder die Einklapp-Regel greift nicht.`);


        assert.deepEqual({ angedockt, eingeklappt }, { angedockt: 5, eingeklappt: 6 },
          'Erwartet auf dem Zeiger: 5 FABs in der Kopfleiste (Vorrat, Mahlzeiten, Rezepte, '
          + 'Geburtstage, Dokumente) und 6 eingeklappte (dort traegt der Modulkopf seinen eigenen '
          + `Knopf). Gezaehlt wurden ${angedockt} und ${eingeklappt}, dazu ${ohneFab} Seiten ohne FAB. `
          + 'Aendert sich das, aendert sich die Reichweite dieser Sonde.');
      } else {

        assert.ok(seen >= 12,
          `Nur ${seen} Zustaende am Scroll-Ende gemessen - erwartet sind mindestens 12. Entweder `
          + 'fehlt Modulen ihr FAB, oder keine Seite kam an ihr Scroll-Ende.');
        assert.equal(angedockt, 0, 'am Finger dockt kein FAB an - der Platz dafuer ist die Nav-Kapsel');
      }

      assert.deepEqual(findings, [],
        'Der FAB am Scroll-Ende. Dort gehoert ihm der Nachlauf allein.\n  ' + findings.join('\n  '));
    });
  }
});


const REGULAR_WIDTHS = [
  { w: 1024, why: 'Kante der Groessenklasse', rows: false },
  { w: 1280, why: 'Breite der Content-Spalte', rows: true },
  { w: 1960, why: 'gemeldete Breite (#882)',   rows: true },
];

describe('Sonde 19 - in der regulaeren Groessenklasse traegt der Modulkopf eine Zeile', () => {
  for (const locale of ['de', 'uk']) {
    test(`Locale ${locale}`, async () => {
      const findings = [];
      let seen = 0;

      for (const { w, why, rows: pruefeZeilen } of REGULAR_WIDTHS) {
        const page = await openPage(harness, { device: 'desktop', theme: 'light', locale });
        await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

        for (const name of sweep('Sonde 19')) {
          await gotoRoute(page, ALL_ROUTES[name]);
          await visitViews(page, name, async (where) => {
            const heads = await page.evaluate(() => [...document.querySelectorAll('.page-toolbar')]
              .filter((el) => el.getBoundingClientRect().height > 0)
              .map((el) => {


                // mittig ausgerichtete Slots unterschiedlicher Hoehe beginnen
                // auseinander, ein Zaehler ueber Oberkanten meldete sonst fuer
                // einen einzeiligen Kopf vier "Zeilen".
                //




                const kids = [...el.children]
                  .map((c) => ({ c, r: c.getBoundingClientRect(), cs: getComputedStyle(c) }))
                  .filter((x) => x.r.height > 0 && x.cs.display !== 'none' && x.cs.visibility !== 'hidden');
                const clusters = (items) => {
                  const spans = items.map((x) => [x.r.top, x.r.bottom]).sort((a, b) => a[0] - b[0]);
                  let n = 0;
                  let end = -Infinity;
                  for (const [top, bottom] of spans) {
                    if (top >= end) n += 1;
                    end = Math.max(end, bottom);
                  }
                  return n;
                };
                const rows = clusters(kids.filter((x) => !x.c.classList.contains('page-toolbar__bar')));
                const barRows = clusters(kids.filter((x) => x.c.classList.contains('page-toolbar__bar')));



                let narrowEnd = null;
                let measure = null;
                if (el.classList.contains('page-toolbar--narrow')) {
                  const cs = getComputedStyle(el);
                  const contentLeft = el.getBoundingClientRect().left + parseFloat(cs.paddingInlineStart);
                  const inner = el.clientWidth - parseFloat(cs.paddingInlineStart) - parseFloat(cs.paddingInlineEnd);






                  // `app-page--data` (--layout-content, 60rem), sein Kopf endete

                  //
                  // Zwei Fallen dabei. Erstens liefert getComputedStyle fuer eine








                  const raw = (getComputedStyle(el).getPropertyValue('--page-measure') || '').trim()
                    || (getComputedStyle(document.documentElement)
                      .getPropertyValue('--content-max-width-narrow') || '').trim();
                  if (raw.includes('%')) {
                    measure = null;
                  } else {
                    const ruler = document.createElement('div');
                    ruler.style.cssText = `position:absolute;visibility:hidden;height:0;width:${raw}`;
                    document.documentElement.appendChild(ruler);
                    measure = ruler.getBoundingClientRect().width;
                    ruler.remove();
                  }



                  if (measure !== null && inner > measure) {
                    const last = [...el.children]
                      .filter((c) => getComputedStyle(c).display !== 'none')
                      .pop();
                    if (last) narrowEnd = Math.round(last.getBoundingClientRect().right - contentLeft);
                  }
                }
                return {
                  rows, barRows, h: Math.round(el.getBoundingClientRect().height), cls: el.className,
                  narrowEnd, measure,
                };
              }));
            for (const head of heads) {
              seen += 1;


              // Lesemass-Abstand existiert, damit Kopf und Koerper dieselbe




              if (head.narrowEnd !== null && head.measure !== null
                && Math.abs(head.narrowEnd - head.measure) > 1) {
                findings.push(
                  `${w}px (${why}) ${where}: Kopfende bei ${head.narrowEnd}px statt `
                  + `${Math.round(head.measure)}px (Mass der Seite) - ${head.cls}`,
                );
              }










              // sie selbst darf ebenfalls nicht umbrechen (sie scrollt).
              if (!pruefeZeilen) continue;
              if (head.rows > 1) {
                findings.push(
                  `${w}px (${why}) ${where}: Titelzeile baut ${head.rows} Zeilen (${head.h}px) - ${head.cls}`,
                );
              }
              if (head.barRows > 1) {
                findings.push(
                  `${w}px (${why}) ${where}: Bar-Zeile baut ${head.barRows} Zeilen statt zu scrollen - ${head.cls}`,
                );
              }
            }
          });
        }
        await page.close();
      }

      assert.ok(seen >= 3 * 12,
        `Nur ${seen} Kopfzustaende gemessen - erwartet sind mindestens 36 (drei Breiten mal `
        + 'zwoelf Koepfe). Hat sich die Schreibweise von .page-toolbar geaendert, oder faehrt '
        + 'die Sonde ihre Routen nicht mehr?');

      assert.deepEqual(findings, [],
        'Ab 1024px traegt der Modulkopf eine einzeilige Titelzeile plus hoechstens die '
        + 'scrollende Bar-Zeile (Werkzeugzeilen-Regel), und ein gedeckelter Kopf endet auf '
        + 'der Kante seines Koerpers - der Titelzeilen-Umbruch war #882.\n  '
        + findings.join('\n  '));
    });
  }
});


describe('Sonde 20 - ein Werkzeug des Kopfs ist sichtbar oder sichtbar angeschnitten', () => {
  for (const locale of ['de', 'uk']) {
    test(`Locale ${locale}`, async () => {
      const findings = [];
      let seen = 0;
      let overflowed = 0;

      for (const { device, w } of [{ device: 'mobile', w: 375 }, { device: 'desktop', w: 1280 }]) {
        const page = await openPage(harness, { device, theme: 'light', locale });
        if (device === 'desktop') {
          await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
        }

        for (const name of sweep('Sonde 20')) {
          await gotoRoute(page, ALL_ROUTES[name]);
          const bars = await page.evaluate(() => {
            const lists = new Set([
              ...document.querySelectorAll('.page-toolbar [role="tablist"]'),
              ...document.querySelectorAll('.sub-tabs-bar[role="tablist"], nav.sub-tabs-bar'),
            ]);
            return [...lists]
              .filter((el) => el.getBoundingClientRect().width > 0)
              .map((el) => {
                const r = el.getBoundingClientRect();
                const overflow = el.scrollWidth - el.clientWidth;







                // kreuzt.
                let gapAtEdge = null;
                if (overflow > 1 && el.scrollLeft < overflow - 1) {
                  const edge = r.left + el.clientWidth;
                  let lastEnd = r.left;
                  for (const child of el.children) {
                    const cr = child.getBoundingClientRect();
                    if (cr.width <= 0) continue;
                    if (cr.left < edge) lastEnd = Math.max(lastEnd, Math.min(cr.right, edge));
                  }
                  gapAtEdge = edge - lastEnd;
                }
                return {
                  cls: el.className,
                  overflow: Math.round(overflow),
                  fade: el.classList.contains('has-fade-end') || el.classList.contains('has-fade-start'),
                  gapAtEdge: gapAtEdge === null ? null : Math.round(gapAtEdge),
                };
              });
          });

          for (const bar of bars) {
            seen += 1;
            if (bar.overflow <= 1) continue;
            overflowed += 1;
            if (!bar.fade) {
              findings.push(`${w}px ${name}: Leiste laeuft ${bar.overflow}px ueber, traegt aber `
                + `keinen Scroll-Fade (wireScrollFade nicht verdrahtet oder eps zu grob) - ${bar.cls}`);
            }
            if (bar.gapAtEdge !== null && bar.gapAtEdge > 12) {
              findings.push(`${w}px ${name}: ${bar.gapAtEdge}px Leerraum vor der Endkante - der `
                + `12px-Fade faded Leere, das naechste Werkzeug ist unauffindbar - ${bar.cls}`);
            }
          }
        }
        await page.close();
      }


      // Sonde 15): gezaehlt werden GEFUNDENE Leisten ueber beide Breiten.
      assert.ok(seen >= 14,
        `Nur ${seen} Kopf-Leisten gefunden - erwartet sind mindestens 14 (sieben Leisten `
        + 'mal zwei Breiten). Hat sich die Schreibweise der Tablists geaendert?');




      // zweite Zusicherung ist leer.
      assert.ok(overflowed > 0,
        'Keine einzige ueberlaufende Kopf-Leiste gefunden - die Anschnitt-Zusicherung '
        + 'hat nichts gemessen. Rendert der Seed noch alle Budget-Tabs?');

      assert.deepEqual(findings, [],
        'Eine ueberlaufende Kopf-Leiste zeigt ihre Fortsetzung: Scroll-Fade plus sichtbar '
        + 'angeschnittenes naechstes Werkzeug (Werkzeugzeilen-Regel).\n  '
        + findings.join('\n  '));
    });
  }
});
// Notes probes deliberately live at the existing end-of-file boundary. #1055
// also adds a browser block immediately after the shared after() hook; keeping
// this complete independent block here avoids a placement-only merge conflict.
function holdNextRequest(page, { method, pathname, label }) {
  let request = null;
  let settled = false;
  let actionInFlight = false;
  let responseAbort = null;
  let markSeen;
  const captured = new Promise((resolve) => { markSeen = resolve; });
  page.__aashiyanaRequestInterceptor = (candidate) => {
    if (
      !request
      && candidate.method() === method
      && new URL(candidate.url()).pathname === pathname
    ) {
      request = candidate;
      markSeen();
      return true;
    }
    return false;
  };
  const waitForCapture = async () => {
    let timeout;
    try {
      return await Promise.race([
        captured,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${label} was not captured within 5 seconds`)),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  const finish = async (action, ...args) => {
    if (settled) return;
    if (actionInFlight) throw new Error(`${label} release is already in progress`);
    if (!request) await waitForCapture();
    actionInFlight = true;
    page.__aashiyanaRequestInterceptor = null;
    // Register before releasing the intercepted request: `request.continue()`
    // only starts the network operation. The async predicate also consumes the
    // body, so fulfillment means the complete response reached Chromium rather
    // than only its headers. Attach both handlers immediately: if continue() or
    // respond() rejects, cancelling this waiter must never leave a later timeout
    // as an unhandled rejection.
    const controller = new AbortController();
    responseAbort = controller;
    const responseCompleted = page.waitForResponse(
      async (response) => {
        if (response.request() !== request) return false;
        await response.buffer();
        return true;
      },
      { timeout: 5000, signal: controller.signal },
    ).then(
      (response) => ({ response, error: null }),
      (error) => ({ response: null, error }),
    );
    try {
      try {
        await request[action](...args);
      } catch (actionError) {
        controller.abort();
        await responseCompleted;
        throw actionError;
      }
      const outcome = await responseCompleted;
      if (outcome.error) throw outcome.error;
      settled = true;
      return outcome.response;
    } finally {
      actionInFlight = false;
      responseAbort = null;
    }
  };
  return {
    get seen() { return waitForCapture(); },
    release: () => finish('continue'),
    respond: (response) => finish('respond', response),
    reject: () => finish('respond', {
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: `${label} delayed failure` }),
    }),
    async dispose() {
      page.__aashiyanaRequestInterceptor = null;
      responseAbort?.abort();
      if (settled) return;
      if (request) await request.abort();
      settled = true;
    },
  };
}

function holdNextNoteCategoryCreate(page) {
  return holdNextRequest(page, {
    method: 'POST',
    pathname: '/api/v1/notes/categories',
    label: 'note category POST',
  });
}

function holdNextNoteSave(page, { method = 'POST', noteId = null } = {}) {
  return holdNextRequest(page, {
    method,
    pathname: noteId === null ? '/api/v1/notes' : `/api/v1/notes/${noteId}`,
    label: `${method} note save`,
  });
}

async function openReadyNoteModal(page) {
  await page.click('#notes-add-btn');
  await page.waitForSelector('#note-content');
  // Shared-modal initialization applies its first focus after 50 ms and takes
  // the dirty baseline after 150 ms. The 300 ms barrier includes both timers
  // before Puppeteer's real keyboard events start moving through the fields.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function typeExactly(page, selector, value) {
  await page.type(selector, value);
  assert.equal(await page.$eval(selector, (field) => field.value), value);
}

async function replaceExactly(page, selector, value) {
  await page.focus(selector);
  // Puppeteer's keyboard shortcuts do not select all on macOS; the editing
  // command does on every platform.
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(modifier);
  await page.keyboard.press('KeyA', { commands: ['SelectAll'] });
  await page.keyboard.up(modifier);
  const length = await page.$eval(selector, (field) => field.value.length);
  assert.deepEqual(
    await page.$eval(selector, (field) => [field.selectionStart, field.selectionEnd]),
    [0, length],
    `select-all did not select the whole value of ${selector}`,
  );
  await page.type(selector, value);
  assert.equal(await page.$eval(selector, (field) => field.value), value);
}

async function openExistingNoteEditor(page, noteId) {
  await page.click(`.note-card[data-id="${noteId}"] .note-card__open`);
  await page.waitForSelector('#note-content');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.click('.note-mode-switch [data-view="edit"]');
  await page.waitForSelector('#note-pane-edit:not([hidden])');
}

async function discardOpenNoteEditor(page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('#confirm-modal-ok');
  await page.click('#confirm-modal-ok');
  await page.waitForFunction(() => !document.querySelector('.note-modal'));
}

async function clearMatchingToast(page, { tone, text }) {
  await page.evaluate(({ tone: expectedTone, text: expectedText }) => {
    for (const toast of document.querySelectorAll(`.toast--${expectedTone}`)) {
      if (toast.querySelector('span')?.textContent === expectedText) toast.remove();
    }
  }, { tone, text });
}

async function waitForMatchingToast(page, { tone, text }) {
  await page.waitForFunction(({ tone: expectedTone, text: expectedText }) => (
    [...document.querySelectorAll(`.toast--${expectedTone}`)]
      .some((toast) => toast.querySelector('span')?.textContent === expectedText)
  ), {}, { tone, text });
}

test('eine unbenutzte Request-Sperre laesst sich ohne Warten entsorgen', async () => {
  const page = {};
  const hold = holdNextNoteCategoryCreate(page);
  const disposed = await Promise.race([
    hold.dispose().then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 50)),
  ]);

  assert.equal(disposed, true, 'dispose must not wait for a request that never started');
  assert.equal(page.__aashiyanaRequestInterceptor, null);
});

for (const action of ['continue', 'respond']) {
  test(`eine bei ${action} gescheiterte Request-Sperre bricht die gehaltene Anfrage ab`, async () => {
    let aborted = false;
    const page = {
      waitForResponse: (_predicate, { signal }) => new Promise((_, reject) => {
        const timeout = setTimeout(() => reject(new Error('response timeout')), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('response wait aborted'));
        }, { once: true });
      }),
    };
    const request = {
      method: () => 'POST',
      url: () => 'http://127.0.0.1/api/v1/notes/categories',
      [action]: async () => { throw new Error(`${action} action failed`); },
      abort: async () => { aborted = true; },
    };
    const hold = holdNextNoteCategoryCreate(page);
    assert.equal(page.__aashiyanaRequestInterceptor(request), true);

    const startedAt = Date.now();
    await assert.rejects(action === 'continue' ? hold.release() : hold.reject(), {
      message: `${action} action failed`,
    });
    assert.ok(Date.now() - startedAt < 100, 'failed release must cancel its five-second response waiter');
    await hold.dispose();

    assert.equal(aborted, true, 'a failed release attempt must remain disposable');
  });
}

test('eine freigegebene Request-Sperre wartet auf den vollstaendigen Response-Body', async () => {
  let finishBody;
  const bodyComplete = new Promise((resolve) => { finishBody = resolve; });
  let request;
  const page = {
    waitForResponse: async (predicate) => {
      const response = {
        request: () => request,
        buffer: () => bodyComplete,
      };
      return (await predicate(response)) ? response : null;
    },
  };
  request = {
    method: () => 'POST',
    url: () => 'http://127.0.0.1/api/v1/notes/categories',
    continue: async () => {},
    abort: async () => {},
  };
  const hold = holdNextNoteCategoryCreate(page);
  assert.equal(page.__aashiyanaRequestInterceptor(request), true);

  const released = hold.release().then(() => true);
  assert.equal(await Promise.race([
    released,
    new Promise((resolve) => setTimeout(() => resolve(false), 20)),
  ]), false, 'response headers alone must not complete release');

  finishBody();
  assert.equal(await released, true);
});

async function removeNoteProbeRecords(page, { titles, categoryNames }) {
  await page.evaluate(async (fixture) => {
    const { api } = await import('/api.js');
    const notes = (await api.get('/notes')).data;
    for (const note of notes.filter(({ title }) => fixture.titles.includes(title))) {
      await api.delete(`/notes/${note.id}`);
    }
    const categories = (await api.get('/notes/categories')).data;
    for (const category of categories.filter(({ name }) => fixture.categoryNames.includes(name))) {
      await api.delete(`/notes/categories/${category.id}`);
    }
  }, { titles, categoryNames });
}

test('Sonde 21 - Notiz-Kategorien behalten Fokus, Gruppenrolle und Reader-Icons', async () => {
  const page = await openPage(harness, { device: 'desktop', locale: 'en' });
  const fixtureName = `Sonde 21 ${randomUUID()}`;
  const categoryIds = [];
  let noteId = null;
  let probeError = null;
  try {
    const first = await page.evaluate(async (name) => {
      const { api } = await import('/api.js');
      return (await api.post('/notes/categories', {
        name: `${name} one`,
        scope: 'personal',
      })).data;
    }, fixtureName);
    categoryIds.push(first.id);
    const second = await page.evaluate(async (name) => {
      const { api } = await import('/api.js');
      return (await api.post('/notes/categories', {
        name: `${name} two`,
        scope: 'personal',
      })).data;
    }, fixtureName);
    categoryIds.push(second.id);
    const third = await page.evaluate(async (name) => {
      const { api } = await import('/api.js');
      return (await api.post('/notes/categories', {
        name: `${name} three`,
        scope: 'personal',
      })).data;
    }, fixtureName);
    categoryIds.push(third.id);
    const note = await page.evaluate(async ({ name, ids }) => {
      const { api } = await import('/api.js');
      return (await api.post('/notes', {
        title: name,
        content: 'Reader icons survive repeated pane replacement.',
        category_ids: ids,
      })).data;
    }, { name: fixtureName, ids: categoryIds.slice(0, 2) });
    noteId = note.id;

    await gotoRoute(page, '/notes');
    await page.waitForSelector(`[data-category-id="${first.id}"]`);
    await page.$eval(`[data-category-id="${first.id}"]`, (chip) => {
      chip.focus();
      chip.click();
    });
    await page.waitForFunction(
      (id) => document.activeElement?.dataset.categoryId === String(id),
      {},
      first.id,
    );
    const focusState = await page.evaluate(() => ({
      focusedCategory: document.activeElement?.dataset.categoryId ?? null,
      categoryPressed: document.activeElement?.getAttribute('aria-pressed') ?? null,
    }));

    await page.click(`.note-card[data-id="${noteId}"] .note-card__open`);
    await page.waitForSelector('.note-modal[data-view="read"]');
    const readTurns = [];
    for (let turn = 0; turn < 2; turn += 1) {
      await page.click('.note-mode-switch [data-view="edit"]');
      await page.click('.note-mode-switch [data-view="read"]');
      readTurns.push(await page.evaluate(() => ({
        icons: document.querySelectorAll('.note-read__categories svg').length,
        placeholders: document.querySelectorAll('.note-read__categories i[data-lucide]').length,
      })));
    }

    const actual = await page.evaluate(({ noteId }) => ({
      outerFilterLabel: document.querySelector('#notes-filters')?.getAttribute('aria-label'),
      cardRole: document.querySelector(`.note-card[data-id="${noteId}"] .note-card__categories`)?.getAttribute('role'),
      readRole: document.querySelector('.note-read__categories')?.getAttribute('role'),
    }), { noteId });

    assert.deepEqual({ ...focusState, ...actual, readTurns }, {
      focusedCategory: String(first.id),
      categoryPressed: 'true',
      outerFilterLabel: null,
      cardRole: 'group',
      readRole: 'group',
      readTurns: [
        { icons: 2, placeholders: 0 },
        { icons: 2, placeholders: 0 },
      ],
    });

    // Escape belongs to the open combobox first, then to the containing modal.
    // With a dirty search field the second press must reach the discard guard.
    await page.click('.note-mode-switch [data-view="edit"]');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await page.focus('#note-category-search');
    await page.type('#note-category-search', third.name);
    await page.waitForSelector('#note-category-suggestions:not([hidden])');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => ({
      listHidden: document.querySelector('#note-category-suggestions')?.hidden,
      editorConnected: document.querySelector('.note-modal')?.isConnected,
      focus: document.activeElement?.id,
    })), { listHidden: true, editorConnected: true, focus: 'note-category-search' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#confirm-modal-cancel', { timeout: 1000 });
    await page.click('#confirm-modal-cancel');
  } catch (err) {
    probeError = err;
  } finally {
    const cleanupErrors = [];
    if (noteId !== null) {
      try {
        await page.evaluate(async (id) => {
          const { api } = await import('/api.js');
          await api.delete(`/notes/${id}`);
        }, noteId);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    for (const id of categoryIds) {
      try {
        await page.evaluate(async (categoryId) => {
          const { api } = await import('/api.js');
          await api.delete(`/notes/categories/${categoryId}`);
        }, id);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    try {
      await page.evaluate(async ({ expectedNoteId, expectedCategoryIds }) => {
        const { api } = await import('/api.js');
        const [notes, categories] = await Promise.all([
          api.get('/notes'),
          api.get('/notes/categories'),
        ]);
        if (expectedNoteId !== null && notes.data.some(({ id }) => id === expectedNoteId)) {
          throw new Error(`note ${expectedNoteId} survived Sonde 21 cleanup`);
        }
        const survivors = categories.data
          .filter(({ id }) => expectedCategoryIds.includes(id))
          .map(({ id }) => id);
        if (survivors.length) {
          throw new Error(`categories ${survivors.join(', ')} survived Sonde 21 cleanup`);
        }
      }, { expectedNoteId: noteId, expectedCategoryIds: categoryIds });
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      await page.close();
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        probeError ? [probeError, ...cleanupErrors] : cleanupErrors,
        'Sonde 21 cleanup failed',
      );
    }
  }
  if (probeError) throw probeError;
});
test('Sonde 22 - Anlegen einer Kategorie blockiert Speichern und beruehrt keinen Ersatzdialog', async () => {
  const page = await openPage(harness, { device: 'desktop', locale: 'en' });
  const suffix = randomUUID();
  const savedTitle = `Sonde 22 saved ${suffix}`;
  const savedCategory = `Sonde 22 assigned ${suffix}`;
  const failedCategory = `Sonde 22 failed ${suffix}`;
  const closedCategory = `Sonde 22 closed ${suffix}`;
  const replacementTitle = `Sonde 22 replacement ${suffix}`;
  const replacementContent = 'Replacement content must keep its exact value and focus.';
  const noteApiResponses = [];
  const recordNoteApiResponse = (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/v1/notes')) {
      noteApiResponses.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    }
  };
  page.on('response', recordNoteApiResponse);
  let heldRequest = null;
  let probeError = null;
  try {
    await gotoRoute(page, '/notes');
    await openReadyNoteModal(page);
    await typeExactly(page, '#note-title', savedTitle);
    await typeExactly(page, '#note-content', 'The delayed category must be assigned before this note is saved.');
    await typeExactly(page, '#note-category-search', savedCategory);
    await page.waitForSelector('#note-category-create:not([hidden])');

    heldRequest = holdNextNoteCategoryCreate(page);
    await page.click('#note-category-create');
    await heldRequest.seen;
    assert.deepEqual(await page.evaluate(() => ({
      createDisabled: document.querySelector('#note-category-create')?.disabled,
      saveDisabled: document.querySelector('#note-modal-save')?.disabled,
    })), { createDisabled: true, saveDisabled: true });

    await page.$eval('#note-modal-save', (button) => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await page.evaluate(async (title) => {
      const { api } = await import('/api.js');
      return (await api.get('/notes')).data.some((note) => note.title === title);
    }, savedTitle), false, 'a programmatic Save must not bypass the pending category create');

    await heldRequest.release();
    heldRequest = null;
    await page.waitForSelector(`[data-selected-category-id] .note-category-selection__name`);
    await page.waitForFunction(() => !document.querySelector('#note-modal-save')?.disabled);
    await page.click('#note-modal-save');
    await page.waitForSelector('#shared-modal-overlay', { hidden: true });

    const persisted = await page.evaluate(async ({ title, categoryName }) => {
      const { api } = await import('/api.js');
      const note = (await api.get('/notes')).data.find((item) => item.title === title);
      const category = (await api.get('/notes/categories')).data.find((item) => item.name === categoryName);
      return {
        noteFound: !!note,
        categoryFound: !!category,
        assigned: !!note?.categories?.some(({ id }) => id === category?.id),
      };
    }, { title: savedTitle, categoryName: savedCategory });
    assert.deepEqual(persisted, { noteFound: true, categoryFound: true, assigned: true });

    await openReadyNoteModal(page);
    await typeExactly(page, '#note-content', 'A failed category request must unlock this editor.');
    await typeExactly(page, '#note-category-search', failedCategory);
    await page.waitForSelector('#note-category-create:not([hidden])');
    heldRequest = holdNextNoteCategoryCreate(page);
    await page.click('#note-category-create');
    await heldRequest.seen;
    await heldRequest.reject();
    heldRequest = null;
    await page.waitForFunction(() => (
      !document.querySelector('#note-category-create')?.disabled
      && !document.querySelector('#note-modal-save')?.disabled
    ));
    assert.equal(await page.evaluate(async (name) => {
      const { api } = await import('/api.js');
      return (await api.get('/notes/categories')).data.some((category) => category.name === name);
    }, failedCategory), false);
    await page.evaluate(async () => {
      const { closeModal } = await import('/components/modal.js');
      await closeModal({ force: true });
    });

    await openReadyNoteModal(page);
    await typeExactly(page, '#note-content', 'This editor will close while its category request is pending.');
    await typeExactly(page, '#note-category-search', closedCategory);
    await page.waitForSelector('#note-category-create:not([hidden])');
    await page.evaluate(() => {
      const choices = document.querySelector('#note-category-choices');
      window.__sonde22DetachedMutations = 0;
      new MutationObserver((records) => {
        window.__sonde22DetachedMutations += records.length;
      }).observe(choices, { childList: true, subtree: true });
    });

    heldRequest = holdNextNoteCategoryCreate(page);
    await page.click('#note-category-create');
    await heldRequest.seen;
    await page.evaluate(async () => {
      const { closeModal } = await import('/components/modal.js');
      await closeModal({ force: true });
    });
    await openReadyNoteModal(page);
    await typeExactly(page, '#note-title', replacementTitle);
    await typeExactly(page, '#note-content', replacementContent);
    await page.focus('#note-content');
    const replacementBefore = await page.evaluate(() => ({
      open: document.querySelector('.note-modal')?.isConnected ?? false,
      title: document.querySelector('#note-title')?.value,
      content: document.querySelector('#note-content')?.value,
      focus: document.activeElement?.id,
    }));

    await heldRequest.release();
    heldRequest = null;
    const closedCategoryPersisted = await page.evaluate(async (name) => {
      const { api } = await import('/api.js');
      return (await api.get('/notes/categories')).data.some((category) => category.name === name);
    }, closedCategory);
    assert.equal(closedCategoryPersisted, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const replacementAfter = await page.evaluate(() => ({
      open: document.querySelector('.note-modal')?.isConnected ?? false,
      title: document.querySelector('#note-title')?.value,
      content: document.querySelector('#note-content')?.value,
      focus: document.activeElement?.id,
      detachedMutations: window.__sonde22DetachedMutations,
    }));
    assert.deepEqual(replacementAfter, {
      ...replacementBefore,
      detachedMutations: 0,
    });
  } catch (err) {
    probeError = err;
  } finally {
    const cleanupErrors = [];
    if (heldRequest) {
      try {
        await heldRequest.dispose();
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    try {
      await removeNoteProbeRecords(page, {
        titles: [savedTitle, replacementTitle],
        categoryNames: [savedCategory, closedCategory],
      });
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      const rateLimited = noteApiResponses.filter(({ status }) => status === 429);
      const categoryReads = noteApiResponses.filter(({ method, path }) => (
        method === 'GET' && path === '/api/v1/notes/categories'
      ));
      if (process.env.SONDE_REQUEST_COUNTS === '1') {
        console.log(`Sonde 22 request counts: total=${noteApiResponses.length}, categoryGET=${categoryReads.length}, 429=${rateLimited.length}`);
      }
      assert.deepEqual(rateLimited, [], `Sonde 22 received 429 responses: ${JSON.stringify(rateLimited)}`);
      assert.ok(categoryReads.length <= 6,
        `Sonde 22 used ${categoryReads.length} category GETs; bounded budget is 6`);
      assert.ok(noteApiResponses.length <= 24,
        `Sonde 22 used ${noteApiResponses.length} Notes API responses; bounded budget is 24`);
    } catch (err) {
      cleanupErrors.push(err);
    }
    page.off('response', recordNoteApiResponse);
    try {
      await page.close();
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        probeError ? [probeError, ...cleanupErrors] : cleanupErrors,
        'Sonde 22 cleanup failed',
      );
    }
  }
  if (probeError) throw probeError;
});

test('Sonde 23 - spaete Notizantworten respektieren Ersatz- und Bestaetigungsdialoge', async () => {
  const page = await openPage(harness, { device: 'desktop', locale: 'en' });
  const suffix = randomUUID();
  const successTitle = `Sonde 23 late success ${suffix}`;
  const successContent = 'A completed delayed POST must persist without closing a replacement.';
  const successReplacementTitle = `Sonde 23 success replacement ${suffix}`;
  const failureFixtureTitle = `Sonde 23 PUT fixture ${suffix}`;
  const failureReplacementTitle = `Sonde 23 failure replacement ${suffix}`;
  const replacementContent = 'Unrelated replacement content must stay exact and focused.';
  const retryContent = 'An in-place failed PUT can be retried without losing these exact characters.';
  const confirmationTitle = `Sonde 23 confirmation ${suffix}`;
  const confirmationContent = 'A delayed success must not answer the discard question for the user.';
  const cleanupTitles = [
    successTitle,
    successReplacementTitle,
    failureFixtureTitle,
    failureReplacementTitle,
    confirmationTitle,
  ];
  const noteApiResponses = [];
  const recordNoteApiResponse = (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/v1/notes')) {
      noteApiResponses.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    }
  };
  page.on('response', recordNoteApiResponse);
  let heldRequest = null;
  let probeError = null;
  try {
    await gotoRoute(page, '/notes');

    // A late successful POST belongs to this original editor, not to whichever
    // modal occupies the shared slot when the response finally arrives.
    await openReadyNoteModal(page);
    await typeExactly(page, '#note-title', successTitle);
    await typeExactly(page, '#note-content', successContent);
    await clearMatchingToast(page, { tone: 'success', text: 'Note created' });
    heldRequest = holdNextNoteSave(page);
    await page.click('#note-modal-save');
    await heldRequest.seen;
    await discardOpenNoteEditor(page);
    await openReadyNoteModal(page);
    await typeExactly(page, '#note-title', successReplacementTitle);
    await typeExactly(page, '#note-content', replacementContent);
    await page.focus('#note-content');
    await heldRequest.release();
    heldRequest = null;
    await waitForMatchingToast(page, { tone: 'success', text: 'Note created' });

    const afterLateSuccess = await page.evaluate(() => ({
      replacementOpen: document.querySelector('.note-modal')?.isConnected ?? false,
      title: document.querySelector('#note-title')?.value,
      content: document.querySelector('#note-content')?.value,
      focus: document.activeElement?.id,
    }));
    assert.deepEqual(afterLateSuccess, {
      replacementOpen: true,
      title: successReplacementTitle,
      content: replacementContent,
      focus: 'note-content',
    });
    const savedPost = await page.evaluate(async (title) => {
      const { api } = await import('/api.js');
      return (await api.get('/notes')).data.find((note) => note.title === title) ?? null;
    }, successTitle);
    assert.equal(savedPost?.content, successContent);

    await page.evaluate(async () => {
      const { closeModal } = await import('/components/modal.js');
      await closeModal({ force: true });
    });
    await page.waitForFunction(() => !document.querySelector('.note-modal'));

    // Exercise the PUT path independently. Its late failure must remain globally
    // visible after the originating editor was discarded, without mutating the
    // replacement editor's values, focus, or controls.
    const failureFixture = await page.evaluate(async ({ title, content }) => {
      const { api } = await import('/api.js');
      return (await api.post('/notes', { title, content })).data;
    }, { title: failureFixtureTitle, content: 'Original PUT fixture content.' });
    await gotoRoute(page, '/notes');
    await openExistingNoteEditor(page, failureFixture.id);
    await replaceExactly(page, '#note-content', 'This PUT is expected to fail after its editor closes.');
    await clearMatchingToast(page, { tone: 'danger', text: 'PUT note save delayed failure' });
    heldRequest = holdNextNoteSave(page, { method: 'PUT', noteId: failureFixture.id });
    await page.click('#note-modal-save');
    await heldRequest.seen;
    await discardOpenNoteEditor(page);
    await openReadyNoteModal(page);
    await typeExactly(page, '#note-title', failureReplacementTitle);
    await typeExactly(page, '#note-content', replacementContent);
    await page.focus('#note-content');
    await heldRequest.reject();
    heldRequest = null;
    await waitForMatchingToast(page, { tone: 'danger', text: 'PUT note save delayed failure' });

    const afterLateFailure = await page.evaluate((errorText) => ({
      replacementOpen: document.querySelector('.note-modal')?.isConnected ?? false,
      title: document.querySelector('#note-title')?.value,
      content: document.querySelector('#note-content')?.value,
      focus: document.activeElement?.id,
      errorVisible: [...document.querySelectorAll('.toast--danger')]
        .some((toast) => toast.textContent.includes(errorText)),
    }), 'PUT note save delayed failure');
    assert.deepEqual(afterLateFailure, {
      replacementOpen: true,
      title: failureReplacementTitle,
      content: replacementContent,
      focus: 'note-content',
      errorVisible: true,
    });
    const afterRejectedPut = await page.evaluate(async (id) => {
      const { api } = await import('/api.js');
      return (await api.get('/notes')).data.find((note) => note.id === id) ?? null;
    }, failureFixture.id);
    assert.equal(afterRejectedPut?.content, 'Original PUT fixture content.');

    await page.evaluate(async () => {
      const { closeModal } = await import('/components/modal.js');
      await closeModal({ force: true });
    });
    await page.waitForFunction(() => !document.querySelector('.note-modal'));

    // Preserve the established in-place recovery contract as the stale-editor
    // guards get stricter: the same editor unlocks and a real retry persists.
    await gotoRoute(page, '/notes');
    await openExistingNoteEditor(page, failureFixture.id);
    await replaceExactly(page, '#note-content', retryContent);
    await clearMatchingToast(page, { tone: 'danger', text: 'PUT note save delayed failure' });
    heldRequest = holdNextNoteSave(page, { method: 'PUT', noteId: failureFixture.id });
    await page.click('#note-modal-save');
    await heldRequest.seen;
    await heldRequest.reject();
    heldRequest = null;
    await waitForMatchingToast(page, { tone: 'danger', text: 'PUT note save delayed failure' });
    await page.waitForFunction(() => !document.querySelector('#note-modal-save')?.disabled);
    assert.deepEqual(await page.evaluate(() => ({
      open: document.querySelector('.note-modal')?.isConnected ?? false,
      content: document.querySelector('#note-content')?.value,
      saveDisabled: document.querySelector('#note-modal-save')?.disabled,
    })), { open: true, content: retryContent, saveDisabled: false });

    await clearMatchingToast(page, { tone: 'success', text: 'Note saved' });
    heldRequest = holdNextNoteSave(page, { method: 'PUT', noteId: failureFixture.id });
    await page.click('#note-modal-save');
    await heldRequest.seen;
    await heldRequest.release();
    heldRequest = null;
    await waitForMatchingToast(page, { tone: 'success', text: 'Note saved' });
    await page.waitForFunction(() => !document.querySelector('.note-modal'));
    const afterRetry = await page.evaluate(async (id) => {
      const { api } = await import('/api.js');
      return (await api.get('/notes')).data.find((note) => note.id === id) ?? null;
    }, failureFixture.id);
    assert.equal(afterRetry?.content, retryContent);

    // A dirty-close confirmation temporarily parks the editor without detaching
    // it. A successful response must not force-close that active question. If
    // the user cancels the discard, normal successful-save closure resumes only
    // after the editor owns the shared modal slot again.
    await gotoRoute(page, '/notes');
    await openReadyNoteModal(page);
    await typeExactly(page, '#note-title', confirmationTitle);
    await typeExactly(page, '#note-content', confirmationContent);
    await clearMatchingToast(page, { tone: 'success', text: 'Note created' });
    heldRequest = holdNextNoteSave(page);
    await page.click('#note-modal-save');
    await heldRequest.seen;
    await page.keyboard.press('Escape');
    await page.waitForSelector('#confirm-modal-cancel');
    assert.deepEqual(await page.evaluate(() => ({
      confirmationOpen: document.querySelector('#confirm-modal-cancel')?.isConnected ?? false,
      originalConnected: document.querySelector('.note-modal')?.isConnected ?? false,
      originalInert: document.querySelector('.note-modal')?.closest('.modal-overlay')?.inert ?? false,
    })), { confirmationOpen: true, originalConnected: true, originalInert: true });

    await heldRequest.release();
    heldRequest = null;
    await waitForMatchingToast(page, { tone: 'success', text: 'Note created' });
    assert.deepEqual(await page.evaluate(() => ({
      confirmationOpen: document.querySelector('#confirm-modal-cancel')?.isConnected ?? false,
      originalConnected: document.querySelector('.note-modal')?.isConnected ?? false,
      originalInert: document.querySelector('.note-modal')?.closest('.modal-overlay')?.inert ?? false,
    })), { confirmationOpen: true, originalConnected: true, originalInert: true });
    await page.click('#confirm-modal-cancel');
    await page.waitForFunction(() => !document.querySelector('.note-modal'));
    const confirmationSave = await page.evaluate(async (title) => {
      const { api } = await import('/api.js');
      return (await api.get('/notes')).data.find((note) => note.title === title) ?? null;
    }, confirmationTitle);
    assert.equal(confirmationSave?.content, confirmationContent);
  } catch (err) {
    probeError = err;
  } finally {
    const cleanupErrors = [];
    if (heldRequest) {
      try {
        await heldRequest.dispose();
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    try {
      await page.evaluate(async () => {
        const { closeModal } = await import('/components/modal.js');
        await closeModal({ force: true });
      });
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      await removeNoteProbeRecords(page, { titles: cleanupTitles, categoryNames: [] });
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      const rateLimited = noteApiResponses.filter(({ status }) => status === 429);
      if (process.env.SONDE_REQUEST_COUNTS === '1') {
        console.log(`Sonde 23 request counts: total=${noteApiResponses.length}, 429=${rateLimited.length}`);
      }
      assert.deepEqual(rateLimited, [], `Sonde 23 received 429 responses: ${JSON.stringify(rateLimited)}`);
      assert.ok(noteApiResponses.length <= 32,
        `Sonde 23 used ${noteApiResponses.length} Notes API responses; bounded budget is 32`);
    } catch (err) {
      cleanupErrors.push(err);
    }
    page.off('response', recordNoteApiResponse);
    try {
      await page.close();
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        probeError ? [probeError, ...cleanupErrors] : cleanupErrors,
        'Sonde 23 cleanup failed',
      );
    }
  }
  if (probeError) throw probeError;
});

test('Sonde 24 - spaeter Umbenennungskonflikt ersetzt keinen neuen Notizeditor', async () => {
  const page = await openPage(harness, { device: 'desktop', locale: 'en' });
  const suffix = randomUUID();
  const renamedCategory = `Sonde 24 renamed ${suffix}`;
  const conflictingCategory = `Sonde 24 conflict ${suffix}`;
  const replacementTitle = `Sonde 24 replacement ${suffix}`;
  const replacementContent = 'A stale rename retry must not replace this unsaved note.';
  const conflictError = 'Sonde 24 delayed rename conflict';
  let heldRequest = null;
  let probeError = null;
  try {
    await gotoRoute(page, '/notes');
    const categoryIds = await page.evaluate(async ({ firstName, secondName }) => {
      const { api } = await import('/api.js');
      const first = await api.post('/notes/categories', { name: firstName, scope: 'personal' });
      const second = await api.post('/notes/categories', { name: secondName, scope: 'personal' });
      return [first.data.id, second.data.id];
    }, { firstName: renamedCategory, secondName: conflictingCategory });
    await gotoRoute(page, '/notes');

    await page.click('#notes-manage-categories');
    await page.waitForSelector(`aashiyana-category-manager .cat-row[data-key="${categoryIds[0]}"]`);
    await page.click(`aashiyana-category-manager .cat-row[data-key="${categoryIds[0]}"] .cat-row__name`);
    await page.waitForSelector('#prompt-modal-input');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await replaceExactly(page, '#prompt-modal-input', conflictingCategory);
    await clearMatchingToast(page, { tone: 'danger', text: conflictError });
    heldRequest = holdNextRequest(page, {
      method: 'PUT',
      pathname: `/api/v1/notes/categories/${categoryIds[0]}`,
      label: 'note category rename PUT',
    });
    await page.click('#prompt-modal-ok');
    await heldRequest.seen;

    await openReadyNoteModal(page);
    await typeExactly(page, '#note-title', replacementTitle);
    await typeExactly(page, '#note-content', replacementContent);
    await page.focus('#note-content');
    const replacementBefore = await page.evaluate(() => ({
      open: document.querySelector('.note-modal')?.isConnected ?? false,
      title: document.querySelector('#note-title')?.value,
      content: document.querySelector('#note-content')?.value,
      focus: document.activeElement?.id,
    }));

    await heldRequest.respond({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: conflictError, code: 409 }),
    });
    heldRequest = null;
    await waitForMatchingToast(page, { tone: 'danger', text: conflictError });

    assert.deepEqual(await page.evaluate(() => ({
      open: document.querySelector('.note-modal')?.isConnected ?? false,
      title: document.querySelector('#note-title')?.value,
      content: document.querySelector('#note-content')?.value,
      focus: document.activeElement?.id,
      renamePromptOpen: document.querySelector('#prompt-modal-input')?.isConnected ?? false,
    })), { ...replacementBefore, renamePromptOpen: false });
  } catch (err) {
    probeError = err;
  } finally {
    const cleanupErrors = [];
    if (heldRequest) {
      try {
        await heldRequest.dispose();
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    try {
      await page.evaluate(async () => {
        const { closeModal } = await import('/components/modal.js');
        await closeModal({ force: true });
      });
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      await removeNoteProbeRecords(page, {
        titles: [replacementTitle],
        categoryNames: [renamedCategory, conflictingCategory],
      });
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      await page.close();
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        probeError ? [probeError, ...cleanupErrors] : cleanupErrors,
        'Sonde 24 cleanup failed',
      );
    }
  }
  if (probeError) throw probeError;
});
