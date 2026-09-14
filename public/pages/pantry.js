
import { api } from '/api.js';
import { t, getFormatLocale, formatDate } from '/i18n.js';
import { esc } from '/utils/html.js';
import {
  openModal as openSharedModal,
  closeModal as closeSharedModal,
  advancedSection,
  wireBlurValidation,
  reportFieldError,
  refocusAfterRender,
} from '/components/modal.js';
import { renderKitchenTabsBar } from '/utils/kitchen-tabs.js';
import { resolveShoppingTarget, announceTransfer } from '/utils/kitchen-transfer.js';
import { renderSkeletonList } from '/utils/skeleton.js';
import { renderPageSearch, wirePageSearch } from '/utils/page-search.js';


import { emptyStateEl as emptyStateComponentEl, mountLoadError } from '/utils/empty-state.js';
import { scheduleUndoableDelete, vibrate, wireScrollFade } from '/utils/ux.js';
import { todayKey } from '/utils/date.js';
import { DEFAULT_CATEGORY_NAME, categoryLabel } from '/utils/shopping-categories.js';
import { locationLabel } from '/utils/pantry-locations.js';
import { setBulkPill, clearBulkPill } from '/utils/bulk-pill.js';
import { PANTRY_UNITS, normalizePantryQuantity, pantryUnitStep } from '/utils/pantry-units.js';
import {
  PANTRY_FILTERS,
  daysUntil,
  matchesPantryFilter,
  pantryFilterCounts,
  pantryItemStatus,
} from '/utils/pantry-status.js';

let _container = null;
let _search = null;

const state = {
  items: [],
  locations: [],
  categories: [],
  lists: null,
  query: '',
  filter: 'all',
  todayKey: todayKey(),
};

const intents = new Map();
let QUANTITY_DEBOUNCE_MS_OVERRIDE = null; // nur fuer Tests, siehe __test unten
const QUANTITY_DEBOUNCE_MS = 450;
let _quantitySeq = 0;
let _pantryLoadSeq = 0;
let _pantryAppliedLoad = 0;
const settledAt = new Map();

function quantityOf(item) {
  const intent = intents.get(item?.id);
  return intent ? intent.quantity : Number(item?.quantity ?? 0);
}

function withIntent(item) {
  const intent = intents.get(item?.id);
  return intent ? { ...item, quantity: intent.quantity } : item;
}

// --------------------------------------------------------
// Formatierung
// --------------------------------------------------------

function formatQuantity(value) {
  return new Intl.NumberFormat(getFormatLocale(), { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function unitLabel(unit) {
  const key = `pantry.units.${unit}`;
  const label = t(key);
  return label === key ? String(unit ?? '') : label;
}

function quantityText(item) {
  return `${formatQuantity(item.quantity)} ${unitLabel(item.unit)}`;
}

function expiryBadge(item) {
  const { expiry } = pantryItemStatus(item, state.todayKey);
  if (!expiry) return null;

  const days = daysUntil(item.expires_on, state.todayKey);
  if (expiry === 'expired') {
    return {
      tone: 'danger',
      text: days === -1 ? t('pantry.badgeExpiredYesterday') : t('pantry.badgeExpiredDays', { count: Math.abs(days) }),
    };
  }
  if (days === 0) return { tone: 'warning', text: t('pantry.badgeExpiresToday') };
  if (days === 1) return { tone: 'warning', text: t('pantry.badgeExpiresTomorrow') };
  return { tone: 'warning', text: t('pantry.badgeExpiresDays', { count: days }) };
}

function stockBadge(item) {
  const { out, low } = pantryItemStatus(item, state.todayKey);
  if (out) return { tone: 'danger', text: t('pantry.badgeOut') };
  if (low) return { tone: 'warning', text: t('pantry.badgeLow') };
  return null;
}

// --------------------------------------------------------
// Laden
// --------------------------------------------------------


async function loadPantry() {
  const startedAt = ++_pantryLoadSeq;
  const res = await api.get('/pantry');

  if (startedAt < _pantryAppliedLoad) return;
  _pantryAppliedLoad = startedAt;






  const vorherige = new Map(state.items.map((i) => [i.id, i]));
  const frisch = res.data ?? [];
  for (const item of frisch) {
    const bestaetigt = settledAt.get(item.id);
    if (bestaetigt != null && bestaetigt >= startedAt) {
      const alt = vorherige.get(item.id);
      if (alt) item.quantity = alt.quantity;
    }
  }
  state.items = frisch;
  state.locations = res.locations ?? [];
  state.categories = res.categories ?? [];
}

async function ensureLists() {
  if (state.lists) return state.lists;
  const res = await api.get('/shopping');
  state.lists = res.data ?? [];
  return state.lists;
}

// --------------------------------------------------------
// Auswahl / Gruppierung
// --------------------------------------------------------

function visibleItems() {
  const q = state.query.toLowerCase();


  return state.items.map(withIntent).filter((item) => {
    if (!matchesPantryFilter(item, state.filter, state.todayKey)) return false;
    if (!q) return true;
    return item.name?.toLowerCase().includes(q)
      || item.notes?.toLowerCase().includes(q)
      || (item.location_name && locationLabel(item.location_name).toLowerCase().includes(q));
  });
}

function groupedItems(items) {
  if (state.filter !== 'all') {
    const flat = [...items];
    if (state.filter === 'expired' || state.filter === 'soon') {
      flat.sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)));
    } else {
      flat.sort((a, b) => Number(a.quantity) - Number(b.quantity));
    }
    return [{ key: 'flat', label: null, items: flat }];
  }

  const byLocation = new Map();
  for (const item of items) {
    const key = item.location_id ?? 'none';
    if (!byLocation.has(key)) byLocation.set(key, []);
    byLocation.get(key).push(item);
  }

  const groups = [];
  for (const loc of state.locations) {
    const rows = byLocation.get(loc.id);
    if (rows?.length) groups.push({ key: loc.id, label: locationLabel(loc.name), icon: loc.icon, items: rows });
  }
  const orphans = byLocation.get('none');
  if (orphans?.length) {
    groups.push({ key: 'none', label: t('pantry.unlocated'), icon: 'package', items: orphans });
  }
  return groups;
}

// --------------------------------------------------------
// Render
// --------------------------------------------------------

export async function render(container) {
  _container = container;
  state.todayKey = todayKey();

  _scrolledFilter = null;

  const page = document.createElement('div');
  page.className = 'pantry-page app-page app-page--reading page-measure--narrow';
  page.dataset.composition = 'reading';


  // dieselbe Kopf-Grammatik wie Mahlzeiten/Rezepte/Einkauf.
  const title = document.createElement('h1');
  title.className = 'sr-only';
  title.textContent = t('nav.pantry');


  const live = document.createElement('div');
  live.id = 'pantry-live';
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');




  const toolbar = document.createElement('div');


  toolbar.className = 'page-toolbar page-toolbar--in-group page-toolbar--narrow';
  toolbar.insertAdjacentHTML('beforeend', `
    <div class="page-toolbar__center">
      ${renderPageSearch({
        id: 'pantry-search',



        label: t('pantry.searchPlaceholder'),
        placeholder: t('pantry.searchPlaceholder'),
        value: state.query,
        clearLabel: t('common.searchClear'),
        className: 'pantry-search',
      })}
    </div>
    <div class="page-toolbar__actions">
      <button class="btn btn--ghost btn--icon" data-action="manage-locations"
              aria-label="${esc(t('pantry.manageLocations'))}" title="${esc(t('pantry.manageLocations'))}">
        <i data-lucide="archive" class="icon-md" aria-hidden="true"></i>
      </button>
    </div>`);

  const filters = document.createElement('div');
  filters.className = 'pantry-filters';
  filters.id = 'pantry-filters';






  const list = document.createElement('div');
  list.className = 'list-scroller page-scrollport pantry-list';
  list.id = 'pantry-list';
  list.setAttribute('aria-busy', 'true');
  list.insertAdjacentHTML('beforeend', renderSkeletonList({ rows: 6, lines: 2 }));

  const fab = document.createElement('button');
  fab.className = 'page-fab';
  fab.type = 'button';
  fab.id = 'fab-new-pantry-item';
  fab.setAttribute('aria-label', t('pantry.addItem'));
  fab.dataset.dockLabel = t('newLabel.pantry');
  fab.insertAdjacentHTML('beforeend', '<i data-lucide="plus" aria-hidden="true"></i>');

  page.append(title, live, toolbar, filters, list, fab);
  container.replaceChildren(page);
  renderKitchenTabsBar(container, '/pantry');

  if (window.lucide) window.lucide.createIcons({ el: container });

  // Geteilter Baustein statt eigenem Input (utils/page-search.js): Lupe,







  _search = wirePageSearch(toolbar, {
    id: 'pantry-search',
    onQuery: (value) => {
      state.query = value.trim();
      renderList();
    },
  });

  toolbar.querySelector('[data-action="manage-locations"]').addEventListener('click', openLocationManager);
  fab.addEventListener('click', () => openItemModal('create'));

  filters.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    renderFilters();
    renderList();
  });

  list.addEventListener('click', onListClick);

  try {
    await loadPantry();
  } catch (err) {
    renderLoadError(list, err);
    return;
  }

  renderFilters();
  renderList();
}

function renderLoadError(list, err) {
  list.removeAttribute('aria-busy');
  mountLoadError(list, {
    title: t('pantry.loadErrorTitle'),
    description: t('common.loadErrorDescription'),
    error: err,
    retryLabel: t('common.retry'),
    onRetry: () => render(_container),
  });
}

let _scrolledFilter = null;

function renderFilters() {
  const bar = _container?.querySelector('#pantry-filters');
  if (!bar) return { wasReset: false };

  // Kanten-Anriss der Chip-Leiste. Sie scrollt horizontal (gemessen 135px



  // (Critique 2026-07-30). wireScrollFade setzt die geteilten has-fade-*-


  // deckt die replaceChildren-Rerenders darunter ab.
  if (!bar.dataset.fadeWired) {
    bar.dataset.fadeWired = 'true';
    wireScrollFade(bar);
  }

  const counts = pantryFilterCounts(state.items.map(withIntent), state.todayKey);
  const active = PANTRY_FILTERS.filter((key) => counts[key] > 0);


  const previousFilter = state.filter;
  if (state.filter !== 'all' && !active.includes(state.filter)) state.filter = 'all';
  const wasReset = state.filter !== previousFilter;



  const hadFocus = bar.contains(document.activeElement);

  bar.replaceChildren();
  if (!active.length || !state.items.length) {
    bar.hidden = true;
    return { wasReset };
  }
  bar.hidden = false;

  const labels = {
    expired: { key: 'pantry.filterExpired', icon: 'circle-alert' },
    soon: { key: 'pantry.filterSoon', icon: 'clock' },
    low: { key: 'pantry.filterLow', icon: 'package-open' },
  };

  const chips = [{ id: 'all', label: t('pantry.filterAll'), icon: 'boxes', count: null }];
  for (const key of active) {
    chips.push({ id: key, label: t(labels[key].key), icon: labels[key].icon, count: counts[key] });
  }

  bar.insertAdjacentHTML('beforeend', chips.map((chip) => `
    <button type="button" class="filter-chip${chip.id === state.filter ? ' filter-chip--active' : ''}"
            data-filter="${esc(chip.id)}" aria-pressed="${chip.id === state.filter}">
      <i data-lucide="${esc(chip.icon)}" class="icon-sm" aria-hidden="true"></i>
      <span>${esc(chip.label)}</span>
      ${chip.count != null ? `<span class="filter-chip__count">${chip.count}</span>` : ''}
    </button>`).join(''));

  if (window.lucide) window.lucide.createIcons({ el: bar });

  const activeChip = bar.querySelector('.filter-chip--active');
  if (hadFocus) activeChip?.focus({ preventScroll: true });





  if (_scrolledFilter !== state.filter) {
    activeChip?.scrollIntoView({ inline: 'center', block: 'nearest' });
    _scrolledFilter = state.filter;
  }

  return { wasReset };
}

function renderBulkBar() {
  const items = visibleItems();
  if (state.filter !== 'low' || !state.items.length || !items.length) {
    clearBulkPill();
    return;
  }
  setBulkPill({
    label: t('pantry.bulkPillLabel', { count: items.length }),
    actions: [{
      label: t('pantry.toShoppingAll'),
      count: items.length,
      onClick: (btn) => sendToShopping(visibleItems(), btn),
    }],
  });
}

function renderList() {
  const list = _container?.querySelector('#pantry-list');
  if (!list) return;
  list.removeAttribute('aria-busy');
  list.replaceChildren();
  renderBulkBar();

  if (!state.items.length) {
    list.appendChild(emptyStateEl());
    if (window.lucide) window.lucide.createIcons({ el: list });
    return;
  }

  const items = visibleItems();


  if (state.filter !== 'all' || state.query) {
    announce(t('pantry.resultCount', { count: items.length }));
  }

  if (!items.length) {



    list.appendChild(noResultsEl());
    if (window.lucide) window.lucide.createIcons({ el: list });
    return;
  }



  // sie weg, obwohl sie die ganze gefilterte Liste betrifft.

  for (const group of groupedItems(items)) {
    const section = document.createElement('section');


    section.className = 'list-group pantry-group';

    if (group.label) {
      const heading = document.createElement('h2');
      heading.className = 'list-group__title';
      heading.insertAdjacentHTML('beforeend',
        `<i data-lucide="${esc(group.icon || 'package')}" class="icon-sm" aria-hidden="true"></i>`);
      const name = document.createElement('span');
      name.textContent = group.label;
      const count = document.createElement('span');
      count.className = 'list-group__count';
      count.textContent = String(group.items.length);
      heading.append(name, count);
      section.appendChild(heading);
    }

    const rows = document.createElement('ul');
    rows.className = 'list-rows pantry-rows';
    for (const item of group.items) rows.appendChild(rowEl(withIntent(item)));
    section.appendChild(rows);
    list.appendChild(section);
  }

  if (window.lucide) window.lucide.createIcons({ el: list });
}

function noResultsEl() {
  const active = [];
  if (state.query) active.push(`„${state.query}"`);
  if (state.filter !== 'all') {
    active.push(t({ expired: 'pantry.filterExpired', soon: 'pantry.filterSoon', low: 'pantry.filterLow' }[state.filter]));
  }

  return emptyStateComponentEl({
    variant: 'no-results',
    title: t('pantry.noResultsTitle'),
    description: t('pantry.noResultsDescription'),
    hint: active.length ? active.join(' · ') : undefined,
    action: {
      label: t('pantry.resetFilters'),
      onClick: () => {
        state.query = '';
        state.filter = 'all';


        _search?.clear();
        renderFilters();
        renderList();
        _search?.input.focus();
      },
    },
  });
}

function emptyStateEl() {
  return emptyStateComponentEl({
    icon: 'archive',
    title: t('pantry.emptyTitle'),
    description: t('pantry.emptyDescription'),
    hint: t('emptyHint.pantry'),
    action: {
      label: t('pantry.emptyAction'),
      icon: 'plus',
      onClick: () => openItemModal('create'),
    },
  });
}

/** Eine Vorratszeile. */
function rowEl(item) {
  const status = pantryItemStatus(item, state.todayKey);

  const li = document.createElement('li');


  // am Anfang der Bedienzone (siehe unten).
  li.className = 'list-row pantry-row';
  li.dataset.id = String(item.id);
  if (status.out) li.classList.add('pantry-row--out');








  // Zusatz ans Ende.
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'list-row__main list-row__main--interactive pantry-row__main';
  main.dataset.action = 'edit';




  const headline = document.createElement('span');
  headline.className = 'pantry-row__headline';

  const name = document.createElement('span');
  name.className = 'list-row__name';
  name.textContent = item.name;
  headline.appendChild(name);




  // Zeile drei, also 109,5px gegen 86,3px derselben Liste mit zwei Badges
  // nebeneinander. Was zusammen gelesen wird, bricht zusammen um.
  const badges = [expiryBadge(item), stockBadge(item)].filter(Boolean);
  if (badges.length) {
    const wrap = document.createElement('span');
    wrap.className = 'pantry-row__badges';
    for (const badge of badges) {
      const el = document.createElement('span');
      el.className = `pantry-badge pantry-badge--${badge.tone}`;
      el.textContent = badge.text;
      wrap.appendChild(el);
    }
    headline.appendChild(wrap);
  }
  main.appendChild(headline);






  // langen Ortsnamen fiel sonst genau das Kerndatum weg - dieselbe Trunkierung,


  //




  //




  //


  // an zwei Orte.
  //




  const meta = document.createElement('span');
  meta.className = 'list-row__meta';
  const quantity = document.createElement('span');
  quantity.className = 'pantry-row__quantity';
  quantity.textContent = quantityText(item);
  meta.appendChild(quantity);

  if (item.expires_on) {
    const expiry = document.createElement('span');
    expiry.className = 'pantry-row__expiry';
    expiry.textContent = ` · ${t('pantry.bestBefore', { date: formatDate(item.expires_on) })}`;
    meta.appendChild(expiry);
  }


  if (state.filter !== 'all') {
    const place = document.createElement('span');
    place.className = 'pantry-row__place';
    place.textContent = ` · ${item.location_name ? locationLabel(item.location_name) : t('pantry.unlocated')}`;
    meta.appendChild(place);
  }
  main.appendChild(meta);


  const action = document.createElement('span');
  action.className = 'sr-only';
  action.textContent = t('common.edit');
  main.appendChild(action);





  //






  const actions = document.createElement('div');
  actions.className = 'list-row__actions';


  // Zeilenkante.
  //




  //




  //



  const cartSlot = document.createElement('div');
  cartSlot.className = 'pantry-row__cart-slot';
  if (status.out || status.low) cartSlot.appendChild(cartEl(item));
  actions.appendChild(cartSlot);

  const stepper = document.createElement('div');
  stepper.className = 'pantry-stepper';
  const step = pantryUnitStep(item.unit);

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'pantry-stepper__btn';
  minus.dataset.action = 'decrease';
  minus.disabled = Number(item.quantity) <= 0;
  minus.setAttribute('aria-label', `${t('pantry.decrease')}: ${item.name}`);
  minus.insertAdjacentHTML('beforeend', '<i data-lucide="minus" class="icon-sm" aria-hidden="true"></i>');








  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'pantry-stepper__btn';
  plus.dataset.action = 'increase';
  plus.setAttribute('aria-label', `${t('pantry.increase')}: ${item.name}`);
  plus.insertAdjacentHTML('beforeend', '<i data-lucide="plus" class="icon-sm" aria-hidden="true"></i>');

  stepper.dataset.step = String(step);
  stepper.append(minus, plus);
  actions.appendChild(stepper);






  li.append(main, actions);
  return li;
}

function cartEl(item) {
  const cart = document.createElement('button');
  cart.type = 'button';
  cart.className = 'row-action pantry-row__cart';
  cart.dataset.action = 'to-shopping';
  cart.setAttribute('aria-label', `${t('common.toShoppingList')}: ${item.name}`);
  cart.title = t('common.toShoppingList');
  cart.insertAdjacentHTML('beforeend', '<i data-lucide="shopping-cart" class="icon-md" aria-hidden="true"></i>');
  return cart;
}

// --------------------------------------------------------
// Interaktion
// --------------------------------------------------------

function onListClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const row = btn.closest('.pantry-row[data-id]');
  if (!row) return;
  const item = state.items.find((i) => i.id === Number(row.dataset.id));
  if (!item) return;

  if (btn.dataset.action === 'edit') { openItemModal('edit', item); return; }
  if (btn.dataset.action === 'to-shopping') { sendToShopping([item], btn); return; }
  if (btn.dataset.action === 'increase') { adjustQuantity(item, +1, row); return; }
  if (btn.dataset.action === 'decrease') { adjustQuantity(item, -1, row); }
}

function adjustQuantity(item, direction, row) {
  const step = Number(row.querySelector('.pantry-stepper')?.dataset.step) || 1;

  // eingeschlossen, sonst zaehlte jeder Schritt vom Serverstand aus neu.
  const previous = quantityOf(item);
  const next = normalizePantryQuantity(previous + direction * step, { fallback: previous });
  if (next === previous) return;

  const vorher = intents.get(item.id);
  if (vorher) clearTimeout(vorher.timer);
  const seq = ++_quantitySeq;

  const timer = setTimeout(async () => {
    try {
      const res = await api.patch(`/pantry/${item.id}`, { quantity: next });



      // zurueckfaellt.
      const aktuell = intents.get(item.id);



      const bestaetigt = normalizePantryQuantity(res.data?.quantity, { fallback: next });
      const current = state.items.find((i) => i.id === item.id);
      if (current) current.quantity = bestaetigt;
      settledAt.set(item.id, _pantryLoadSeq);
      if (aktuell?.seq !== seq) return;


      intents.delete(item.id);
      const rowNow = liveRow(item.id, row);
      if (rowNow && current) refreshRowQuantity(rowNow, withIntent(current));
    } catch (err) {
      const aktuell = intents.get(item.id);
      if (aktuell?.seq !== seq) return;



      intents.delete(item.id);
      const current = state.items.find((i) => i.id === item.id);


      const rowNow = liveRow(item.id, row);
      if (!rowNow) return;
      if (current) refreshRowQuantity(rowNow, withIntent(current));
      if (renderFilters().wasReset) renderList();
      window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    }
  }, QUANTITY_DEBOUNCE_MS_OVERRIDE ?? QUANTITY_DEBOUNCE_MS);

  intents.set(item.id, {
    quantity: next,
    seq,
    timer,



    flush: () => {
      clearTimeout(timer);


      api.patch(`/pantry/${item.id}`, { quantity: next }, { keepalive: true })
        .catch(() => { /* Die Seite ist weg; ein Toast hätte kein Ziel mehr. */ });
    },
  });

  vibrate(8);
  refreshRowQuantity(row, withIntent(item));
  if (renderFilters().wasReset) renderList();
  bindQuantityFlush();
}

let _quantityFlushBound = false;

function bindQuantityFlush() {
  if (_quantityFlushBound) return;
  _quantityFlushBound = true;
  window.addEventListener('pagehide', () => {
    for (const intent of [...intents.values()]) intent.flush?.();
  });
}

function announce(message) {
  const region = _container?.querySelector('#pantry-live');
  if (region) region.textContent = message;
}

function liveRow(id, fallback) {
  const el = _container?.querySelector(`.pantry-row[data-id="${id}"]`);
  if (el?.isConnected) return el;
  return fallback?.isConnected ? fallback : null;
}

function refreshRowQuantity(row, item) {
  const value = row.querySelector('.pantry-row__quantity');
  if (value) value.textContent = quantityText(item);
  announce(`${item.name}: ${quantityText(item)}`);

  const minus = row.querySelector('[data-action="decrease"]');
  if (minus) {
    const willDisable = Number(item.quantity) <= 0;



    if (willDisable && !minus.disabled && document.activeElement === minus) {
      row.querySelector('[data-action="increase"]')?.focus();
    }
    minus.disabled = willDisable;
  }

  const status = pantryItemStatus(item, state.todayKey);
  row.classList.toggle('pantry-row--out', status.out);




  const fresh = rowEl(item);
  row.querySelector('.pantry-row__main')?.replaceWith(fresh.querySelector('.pantry-row__main'));
  row.querySelector('.pantry-row__cart-slot')?.replaceWith(fresh.querySelector('.pantry-row__cart-slot'));

  if (window.lucide) window.lucide.createIcons({ el: row });
}

// --------------------------------------------------------
// Einkaufsliste
// --------------------------------------------------------

function shortfallText(item) {
  if (item.min_quantity == null) return null;
  const missing = normalizePantryQuantity(Number(item.min_quantity) - Number(item.quantity), { fallback: 0 });
  if (missing <= 0) return null;
  return `${formatQuantity(missing)} ${unitLabel(item.unit)}`;
}

async function sendToShopping(items, btn) {
  if (!items.length) return;

  let lists;
  try {
    lists = await ensureLists();
  } catch (err) {
    window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    return;
  }


  // geteilten Baustein (utils/kitchen-transfer.js) - dieselbe Abfolge stand

  const target = await resolveShoppingTarget(lists);
  if (!target) return;




  if (btn) btn.disabled = true;
  try {
    const res = await api.post(`/shopping/${target.id}/import-pantry`, {
      items: items.map((item) => ({ pantry_item_id: item.id, quantity: shortfallText(item) })),
    });
    const { added = 0, skipped = 0, added_ids: addedIds = [] } = res.data ?? {};
    if (!added) {
      window.aashiyana?.showToast(t('pantry.toShoppingNone'), 'info');
      return;
    }










    const message = skipped
      ? `${t('pantry.toShoppingDone', { count: added, list: target.name })} ${t('pantry.toShoppingSkipped', { count: skipped })}`
      : t('pantry.toShoppingDone', { count: added, list: target.name });




    // bedeuten das Gegenteil voneinander (Critique 2026-07-30).
    announceTransfer({ message, addedIds });
  } catch (err) {
    window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --------------------------------------------------------
// Artikel-Formular
// --------------------------------------------------------

function openItemModal(mode, item = null) {
  const isEdit = mode === 'edit';
  const locations = state.locations;
  const categories = state.categories;

  const unitOptions = PANTRY_UNITS
    .map((unit) => `<option value="${esc(unit)}">${esc(unitLabel(unit))}</option>`)
    .join('');
  const locationOptions = [
    `<option value="">${esc(t('pantry.unlocated'))}</option>`,
    ...locations.map((loc) => `<option value="${loc.id}">${esc(locationLabel(loc.name))}</option>`),
  ].join('');
  const categoryOptions = categories
    .map((cat) => `<option value="${esc(cat.name)}">${esc(categoryLabel(cat.name))}</option>`)
    .join('');

  openSharedModal({
    title: isEdit ? t('common.editItem') : t('pantry.addItem'),
    size: 'md',
    content: `
      <div class="form-group">
        <label class="form-label" for="pantry-name">${esc(t('common.nameLabel'))}</label>
        <input id="pantry-name" class="form-input" type="text" required
               placeholder="${esc(t('pantry.namePlaceholder'))}">
      </div>
      <div class="pantry-form-row">
        <div class="form-group">
          <label class="form-label" for="pantry-quantity">${esc(t('pantry.quantityLabel'))}</label>
          <input id="pantry-quantity" class="form-input" type="number" min="0" step="any" inputmode="decimal">
        </div>
        <div class="form-group">
          <label class="form-label" for="pantry-unit">${esc(t('pantry.unitLabel'))}</label>
          <select id="pantry-unit" class="form-input">${unitOptions}</select>
        </div>
      </div>
      <div class="pantry-form-row">
        <div class="form-group">
          <label class="form-label" for="pantry-location">${esc(t('pantry.locationLabel'))}</label>
          <select id="pantry-location" class="form-input">${locationOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="pantry-category">${esc(t('pantry.categoryLabel'))}</label>
          <select id="pantry-category" class="form-input">${categoryOptions}</select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="pantry-expires">${esc(t('pantry.expiresLabel'))}</label>
        <aashiyana-datepicker id="pantry-expires" type="date"
                           value="${esc(isEdit && item.expires_on ? item.expires_on : '')}"></aashiyana-datepicker>
        <p class="form-hint">${esc(t('pantry.expiresHint'))}</p>
      </div>
      ${advancedSection(`
        <div class="form-group">
          <label class="form-label" for="pantry-min">${esc(t('pantry.minQuantityLabel'))}</label>
          <input id="pantry-min" class="form-input" type="number" min="0" step="any" inputmode="decimal">
          <p class="form-hint">${esc(t('pantry.minQuantityHint'))}</p>
        </div>
        <div class="form-group">
          <label class="form-label" for="pantry-notes">${esc(t('pantry.notesLabel'))}</label>
          <textarea id="pantry-notes" class="form-input" rows="3"
                    placeholder="${esc(t('pantry.notesPlaceholder'))}"></textarea>
        </div>`,
      { open: isEdit && (item.min_quantity != null || !!item.notes) })}
      <div class="modal-panel__footer modal-panel__footer--plain">
        ${isEdit ? `<button type="button" class="btn btn--danger-ghost pantry-form__delete" id="pantry-delete">${esc(t('common.delete'))}</button>` : ''}
        <button type="button" class="btn btn--secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
        <button type="button" class="btn btn--primary" id="pantry-save">${esc(isEdit ? t('common.save') : t('common.add'))}</button>
      </div>`,
    onSave(panel) {
      panel.querySelector('#pantry-name').value = isEdit ? item.name : '';
      panel.querySelector('#pantry-quantity').value = isEdit ? String(item.quantity) : '1';
      panel.querySelector('#pantry-unit').value = isEdit ? item.unit : 'pcs';
      panel.querySelector('#pantry-location').value = isEdit && item.location_id ? String(item.location_id) : '';
      panel.querySelector('#pantry-category').value = isEdit
        ? item.category
        : (categories.find((c) => c.name === DEFAULT_CATEGORY_NAME)?.name ?? categories[0]?.name ?? DEFAULT_CATEGORY_NAME);
      panel.querySelector('#pantry-min').value = isEdit && item.min_quantity != null ? String(item.min_quantity) : '';
      panel.querySelector('#pantry-notes').value = isEdit && item.notes ? item.notes : '';

      panel.querySelector('#pantry-save').addEventListener('click', () => saveItem(panel, mode, item));
      panel.querySelector('#pantry-delete')?.addEventListener('click', async () => {
        closeSharedModal({ force: true });
        await removeItem(item);
        refocusAfterRender();
      });

      wireBlurValidation(panel);
      if (window.lucide) window.lucide.createIcons({ el: panel });
    },
  });
}

async function saveItem(panel, mode, item) {
  const saveBtn = panel.querySelector('#pantry-save');
  const nameInput = panel.querySelector('#pantry-name');
  const name = nameInput.value.trim();

  if (!name) {
    reportFieldError(nameInput, t('common.nameRequired'));
    return;
  }

  const minRaw = panel.querySelector('#pantry-min').value.trim();
  const payload = {
    name,
    quantity: normalizePantryQuantity(panel.querySelector('#pantry-quantity').value, { fallback: 1 }),
    unit: panel.querySelector('#pantry-unit').value,
    location_id: panel.querySelector('#pantry-location').value || null,
    category: panel.querySelector('#pantry-category').value,
    expires_on: panel.querySelector('#pantry-expires').value || null,
    min_quantity: minRaw === '' ? null : normalizePantryQuantity(minRaw, { fallback: 0 }),
    notes: panel.querySelector('#pantry-notes').value.trim() || null,
  };

  saveBtn.disabled = true;
  try {
    if (mode === 'create') {
      const res = await api.post('/pantry', payload);
      state.items.push(res.data);
    } else {
      const res = await api.put(`/pantry/${item.id}`, payload);
      const idx = state.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) state.items[idx] = res.data;
    }


    // Gruppierung und Meta-Zeile stimmen.
    await loadPantry();
    closeSharedModal({ force: true });
    renderFilters();
    renderList();
    window.aashiyana?.showToast(mode === 'create' ? t('pantry.created') : t('pantry.updated'), 'success');
  } catch (err) {
    saveBtn.disabled = false;
    window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  }
}

async function removeItem(item) {
  const rowEl_ = _container?.querySelector(`.pantry-row[data-id="${item.id}"]`);
  if (rowEl_) rowEl_.style.display = 'none';

  scheduleUndoableDelete({
    message: t('pantry.deleted'),
    commit: async ({ keepalive }) => {
      await api.delete(`/pantry/${item.id}`, { keepalive });
      if (keepalive) return;
      state.items = state.items.filter((i) => i.id !== item.id);
      renderFilters();
      renderList();
    },
    restore: (err) => {
      if (rowEl_) rowEl_.style.display = '';
      if (err) window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
    },
  });
}

// --------------------------------------------------------
// Lagerort-Verwaltung
// --------------------------------------------------------

async function openLocationManager() {
  await import('/components/category-manager.js');


  // raeumt `confirmOverModal` das Modal darunter ab, bevor `api.delete` laeuft



  const onChanged = async () => {
    try {
      await loadPantry();
      renderFilters();
      renderList();
      refocusAfterRender();
    } catch (err) {




      console.error('[Pantry] Auffrischen nach Ort-Aenderung fehlgeschlagen:', err);
      window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    }
  };

  openSharedModal({
    title: t('pantry.manageLocations'),
    content: '<aashiyana-category-manager></aashiyana-category-manager>',
    onSave: (panel) => {
      const manager = panel.querySelector('aashiyana-category-manager');
      if (!manager) return;
      manager.addEventListener('category-manager-changed', onChanged);

      // bietet exakt deren CRUD-Vertrag (GET/POST basePath, PUT/DELETE :id,
      // PATCH /reorder).
      manager.configure({
        basePath: '/pantry/locations',
        labelResolver: (loc) => locationLabel(loc.name),
        titleKey: 'pantry.manageLocations',
        hintKey: 'pantry.manageLocationsHint',
        addPlaceholderKey: 'pantry.addLocation',


        deleteDetailKey: 'pantry.locationDeleteConfirmDetail',
        groups: [{ key: '', labelKey: '', addLabelKey: 'common.add' }],
      });
    },


  });
}





export const __test = {
  state,
  adjustQuantity,
  loadPantry,
  intents,
  quantityOf,
  withIntent,
  setContainerForTest: (el) => { _container = el; },

  // Sammelaktions-Automaten des Einkaufs.
  setQuantityDebounceMsForTest: (ms) => { QUANTITY_DEBOUNCE_MS_OVERRIDE = ms; },


  // naechsten vor seiner eigenen Auffrischung.
  resetLoadOrderForTest: () => { _pantryAppliedLoad = 0; settledAt.clear(); },
};
