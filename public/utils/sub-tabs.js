import { wireScrollFade } from '/utils/ux.js';

let subTabsCounter = 0;

export function renderSubTabs(anchorEl, {
  semantics,
  tabs,
  activeId,
  onChange,
  panelFor,
  hrefFor = (id) => id,
  storageKey,
  extraClass,
  ariaLabel,
  title,
  sealIcon,
  insertPosition = 'afterbegin',
}) {
  if (semantics !== 'nav' && semantics !== 'tabs') {
    throw new Error(`renderSubTabs: semantics muss 'nav' oder 'tabs' sein (bekam: ${semantics}).`);
  }

  //







  if (sealIcon && semantics !== 'nav') {
    throw new Error("renderSubTabs: sealIcon gehört nur einer Leiste, die das Modul wechselt (semantics 'nav') - im Modulkopf trägt der Kopf das Siegel.");
  }


  if (semantics === 'tabs' && typeof panelFor !== 'function') {
    throw new Error("renderSubTabs: semantics 'tabs' braucht panelFor(id) - ohne Panels ist es eine Navigation.");
  }
  const isNav = semantics === 'nav';
  let current = activeId;

  if (storageKey) {
    try { sessionStorage.setItem(storageKey, current); } catch { /* ignore */ }
  }

  const bar = document.createElement(isNav ? 'nav' : 'div');
  const barId = `sub-tabs-${++subTabsCounter}`;
  bar.className = 'sub-tabs-bar' + (extraClass ? ' ' + extraClass : '');
  if (!isNav) bar.setAttribute('role', 'tablist');
  if (ariaLabel) bar.setAttribute('aria-label', ariaLabel);





  if (sealIcon) {
    const sealEl = document.createElement('span');
    sealEl.className = 'module-seal module-seal--head';
    sealEl.setAttribute('aria-hidden', 'true');
    sealEl.appendChild(sealIcon());
    bar.appendChild(sealEl);
  }

  // Optionaler Modul-Titel links der Tabs (Canonical Page Head). Dekorativ:


  if (title) {
    const titleEl = document.createElement('span');
    titleEl.className = 'sub-tabs-bar__title';
    titleEl.setAttribute('aria-hidden', 'true');
    titleEl.textContent = title;
    bar.appendChild(titleEl);
  }

  for (const { id, label, icon, separatorBefore } of tabs) {
    if (separatorBefore) {
      const sep = document.createElement('span');
      sep.className = 'sub-tabs-separator';
      sep.setAttribute('aria-hidden', 'true');
      bar.appendChild(sep);
    }

    const btn = document.createElement(isNav ? 'a' : 'button');
    const safeId = safeDomId(id);
    btn.id = `${barId}-tab-${safeId}`;
    btn.className = 'sub-tab' + (id === current ? ' sub-tab--active' : '');
    btn.dataset.tabId = id;

    if (isNav) {
      btn.href = hrefFor(id);




      if (id === current) btn.setAttribute('aria-current', 'page');
    } else {
      btn.type = 'button';


      btn.dataset.panelId = `${barId}-panel-${safeId}`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', id === current ? 'true' : 'false');
      btn.tabIndex = id === current ? 0 : -1;
    }

    if (icon) {
      const i = document.createElement('i');
      i.dataset.lucide = icon;
      i.className = 'sub-tab__icon';
      i.setAttribute('aria-hidden', 'true');
      btn.appendChild(i);
    }

    const span = document.createElement('span');
    span.className = 'sub-tab__label';
    span.textContent = label;
    btn.appendChild(span);




    const badge = document.createElement('span');
    badge.className = 'sub-tab__badge';
    badge.hidden = true;
    btn.appendChild(badge);

    bar.appendChild(btn);
  }


  // sichtbar sein, sonst wirkt die Seite tab-los (Audit A2-18). block:'nearest'

  const scrollActiveIntoView = () => {
    bar.querySelector('.sub-tab--active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  };

  const activateTab = (tabId, { focus = false } = {}) => {
    if (!tabId || tabId === current) return;

    current = tabId;

    if (storageKey) {
      try { sessionStorage.setItem(storageKey, current); } catch { /* ignore */ }
    }

    bar.querySelectorAll('[data-tab-id]').forEach((b) => {
      const active = b.dataset.tabId === current;
      b.classList.toggle('sub-tab--active', active);
      if (isNav) {
        if (active) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      } else {
        b.setAttribute('aria-selected', String(active));
        b.tabIndex = active ? 0 : -1;
      }
      if (active && focus) b.focus();
    });
    scrollActiveIntoView();
    syncTabPanels(bar, current, panelFor);

    onChange(current);
  };

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab-id]');
    if (!btn) return;





    if (isNav) {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
    }

    activateTab(btn.dataset.tabId);
  });

  bar.addEventListener('keydown', (e) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;

    const buttons = [...bar.querySelectorAll('[data-tab-id]')];
    const focusedIndex = buttons.indexOf(document.activeElement);
    const currentIndex = Math.max(0, buttons.findIndex((btn) => btn.dataset.tabId === current));
    const index = focusedIndex >= 0 ? focusedIndex : currentIndex;
    let nextIndex = index;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIndex = (index + 1) % buttons.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
    if (e.key === 'Home') nextIndex = 0;
    if (e.key === 'End') nextIndex = buttons.length - 1;

    e.preventDefault();





    if (isNav) buttons[nextIndex]?.focus();
    else activateTab(buttons[nextIndex]?.dataset.tabId, { focus: true });
  });

  anchorEl.insertAdjacentElement(insertPosition, bar);
  syncTabPanels(bar, current, panelFor);
  // Scroll-Affordanz (geteilte has-fade-Masken, filter-chip.css) + der via

  wireScrollFade(bar);
  scrollActiveIntoView();

  if (window.lucide) window.lucide.createIcons({ el: bar });

  return bar;
}

export function scrollActiveSubTabIntoView(bar) {
  bar?.querySelector('.sub-tab--active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

export function setSubTabBadge(bar, tabId, state) {
  const btn = bar?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`);
  if (!btn) return;
  const badge = btn.querySelector('.sub-tab__badge');
  if (!badge) return;

  const count = Number(state?.count ?? 0);
  if (!Number.isFinite(count) || count <= 0) {
    badge.hidden = true;
    badge.textContent = '';
    badge.className = 'sub-tab__badge';
    btn.removeAttribute('aria-label');
    return;
  }

  badge.hidden = false;
  badge.textContent = String(count);
  badge.className = `sub-tab__badge${state.tone ? ` sub-tab__badge--${state.tone}` : ''}`;

  badge.setAttribute('aria-hidden', 'true');
  if (state.label) btn.setAttribute('aria-label', state.label);
}

function safeDomId(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tab';
}

function syncTabPanels(bar, current, panelFor) {
  if (typeof panelFor !== 'function') return;

  bar.querySelectorAll('[data-tab-id]').forEach((btn) => {
    const panel = panelFor(btn.dataset.tabId);
    if (!panel) {
      btn.removeAttribute('aria-controls');
      return;
    }

    if (!panel.id) panel.id = btn.dataset.panelId;
    btn.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', btn.id);



    panel.removeAttribute('aria-label');
    panel.hidden = btn.dataset.tabId !== current;
  });
}
