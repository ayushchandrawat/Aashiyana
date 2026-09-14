
import { t } from '/i18n.js';
import {
  openModal, closeModal, mountFooter, refreshDirtySnapshot, forgetRestore,
  focusFirstField, updateHeaderAction, rememberFocus, restoreFocusAfterClose,
} from '/components/modal.js';
import { pushOverlay, dropOverlay } from '/utils/overlay-history.js';





const POPOVER_MIN_WIDTH = 768;


const POPOVER_GAP = 8;
const POPOVER_MARGIN = 8;

let activePopover = null;




let viewSeq = 0;
let activeViewToken = 0;

function reduceMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function renderIcons(el) {
  if (window.lucide) window.lucide.createIcons({ el });
}

// --------------------------------------------------------
// Renderer
// --------------------------------------------------------

export function detailRowEl({ icon, label, value, node, multiline = false } = {}) {
  const hasContent = node instanceof HTMLElement || (typeof value === 'string' && value.trim().length > 0);
  if (!hasContent) return null;

  const row = document.createElement('div');
  row.className = multiline ? 'detail-row detail-row--multiline' : 'detail-row';

  if (icon) {
    const i = document.createElement('i');
    i.className = 'detail-row__icon';
    i.dataset.lucide = icon;
    i.setAttribute('aria-hidden', 'true');
    row.appendChild(i);
  }

  const text = document.createElement('div');
  text.className = 'detail-row__text';

  if (label) {
    const lab = document.createElement('span');
    lab.className = 'detail-row__label';
    lab.textContent = label;
    text.appendChild(lab);
  }

  if (node instanceof HTMLElement) {
    node.classList.add('detail-row__value');
    text.appendChild(node);
  } else {
    const val = document.createElement('span');
    val.className = 'detail-row__value';
    val.textContent = value;
    text.appendChild(val);
  }

  row.appendChild(text);
  return row;
}

export function visibilityRow(visibility) {
  const restricted = visibility && visibility !== 'all';
  return {
    icon: visibility === 'private' ? 'lock' : 'users',
    label: t('common.visibility.label'),
    value: restricted
      ? (visibility === 'private' ? t('common.visibility.private') : t('common.visibility.assignees'))
      : '',
  };
}

export function assignedRow(users, label, fallbackName = '') {
  const names = (users ?? []).map((u) => u.display_name).filter(Boolean);
  return {
    icon: names.length > 1 ? 'users' : 'user',
    label,
    value: names.length ? names.join(', ') : fallbackName,
  };
}

function detailBodyEl({ accentColor, sections = [] }) {
  const view = document.createElement('div');
  view.className = 'detail-view';

  if (accentColor) {
    const accent = document.createElement('div');
    accent.className = 'detail-view__accent';
    accent.style.setProperty('--detail-accent', accentColor);
    view.appendChild(accent);
  }

  const rows = document.createElement('div');
  rows.className = 'detail-view__rows';
  sections
    .filter((s) => s && !s.hidden)
    .map(detailRowEl)
    .filter(Boolean)
    .forEach((row) => rows.appendChild(row));
  view.appendChild(rows);

  return view;
}

function detailFooterEl(actions = []) {
  const visible = actions.filter((a) => a && !a.hidden);
  if (!visible.length) return null;

  const footer = document.createElement('div');
  footer.className = 'modal-panel__footer modal-panel__footer--plain detail-view__footer';

  visible.forEach((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn--${action.variant ?? 'secondary'}`;
    if (action.id) btn.id = action.id;
    if (action.align === 'start') btn.classList.add('detail-view__action--start');
    if (action.icon) {
      const i = document.createElement('i');
      i.className = 'icon-md';
      i.dataset.lucide = action.icon;
      i.setAttribute('aria-hidden', 'true');
      btn.appendChild(i);
    }
    btn.append(document.createTextNode(action.label ?? ''));
    if (typeof action.onClick === 'function') {
      btn.addEventListener('click', () => action.onClick({ close: closeDetailView, button: btn }));
    }
    footer.appendChild(btn);
  });

  return footer;
}

// --------------------------------------------------------
// Pane-Wechsel: Detailansicht → Formular
// --------------------------------------------------------

function withHeightTransition(panel, swap) {
  if (reduceMotion() || typeof panel.getBoundingClientRect !== 'function') {
    swap();
    return;
  }

  const from = panel.getBoundingClientRect().height;
  swap();
  const to = panel.getBoundingClientRect().height;
  if (!from || !to || Math.abs(to - from) < 2) return;





  // gar nicht.
  panel.style.height = `${from}px`;
  panel.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    panel.classList.add('modal-panel--resizing');
    requestAnimationFrame(() => { panel.style.height = `${to}px`; });
  });




  // Wechsel noch einmal ins Leere.
  let fallback = null;
  const done = () => {
    if (fallback) { clearTimeout(fallback); fallback = null; }
    panel.classList.remove('modal-panel--resizing');
    panel.style.height = '';
    panel.style.overflow = '';
  };
  panel.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'height') done();
  }, { once: true });
  fallback = setTimeout(done, 400);
}

function crossFade(el) {
  if (!el || reduceMotion()) return;
  el.classList.remove('detail-pane--enter');
  void el.offsetWidth; // Reflow: Animation bei jedem Wechsel neu starten
  el.classList.add('detail-pane--enter');
}

function setPanelTitle(panel, text) {
  const el = panel.querySelector('.modal-panel__title');
  if (el) el.textContent = text;
}

function detachFooter(panel) {
  const footer = [...panel.children].find((el) => el.classList?.contains('modal-panel__footer'));
  footer?.remove();
  return footer ?? null;
}

async function switchToForm(panel, opts, state) {
  const body = panel.querySelector('.modal-panel__body');
  if (!body || state.mode !== 'detail') return;



  // ersten Aufbaus.
  state.mode = 'switching';
  if (opts.edit?.ready) {
    try {
      await opts.edit.ready;
    } catch {


    }

    if (state.mode !== 'switching' || !panel.isConnected) return;
  }

  let firstMount = false;

  withHeightTransition(panel, () => {
    state.detailPane.hidden = true;
    state.detailFooter = detachFooter(panel) ?? state.detailFooter;

    if (!state.formPane) {
      firstMount = true;
      const pane = document.createElement('div');
      pane.className = 'detail-view__form';
      body.appendChild(pane);
      state.formPane = pane;
      opts.edit.mount(panel, pane);




      // (#1141).
      renderIcons(pane);



      state.formFooter = mountFooter(panel);
    } else {


      state.formPane.hidden = false;
      if (state.formFooter) panel.appendChild(state.formFooter);
    }
  });






  // verloren - dieselbe Klasse Fehler, gegen die refreshDirtySnapshot antritt.
  if (firstMount) refreshDirtySnapshot();

  crossFade(state.formPane);



  if (opts.edit.title) setPanelTitle(panel, opts.edit.title);
  focusFirstField(panel);

  updateHeaderAction(panel, {





    label: t('common.back'),
    onClick: () => switchToDetail(panel, opts, state),
  });
  state.mode = 'form';
}

function switchToDetail(panel, opts, state) {


  if (state.mode !== 'form') return;

  withHeightTransition(panel, () => {
    if (state.formPane) state.formPane.hidden = true;
    state.formFooter = detachFooter(panel) ?? state.formFooter;
    state.detailPane.hidden = false;
    if (state.detailFooter) panel.appendChild(state.detailFooter);
  });

  crossFade(state.detailPane);

  setPanelTitle(panel, opts.title ?? '');
  const btn = updateHeaderAction(panel, {
    label: opts.edit.label ?? t('common.edit'),
    onClick: () => switchToForm(panel, opts, state),
  });
  btn?.focus();
  state.mode = 'detail';
}

// --------------------------------------------------------

// --------------------------------------------------------

function openAsSheet(opts, token) {
  const state = {
    mode: 'detail',
    detailPane: null, formPane: null,
    detailFooter: null, formFooter: null,
  };
  let panelRef = null;

  openModal({
    title: opts.title,
    content: '',
    size: opts.size ?? 'md',


    initialFocus: 'none',
    onClose() {


      if (activeViewToken === token) activeViewToken = 0;
      opts.onClose?.();
    },
    headerAction: opts.edit ? { label: opts.edit.label ?? t('common.edit'), id: 'detail-view-edit' } : null,
    onSave(panel) {
      panelRef = panel;
      const body = panel.querySelector('.modal-panel__body');

      const pane = document.createElement('div');
      pane.className = 'detail-view__pane';
      pane.appendChild(detailBodyEl(opts));
      body.replaceChildren(pane);
      state.detailPane = pane;

      const footer = detailFooterEl(opts.actions);
      if (footer) {
        body.appendChild(footer);

        // ein zweites Mal anheben.
        state.detailFooter = mountFooter(panel);
      }

      renderIcons(panel);

      if (opts.edit) {
        updateHeaderAction(panel, { onClick: () => switchToForm(panel, opts, state) });
        panel.querySelector('.modal-panel__action')?.focus();
      } else {
        panel.querySelector('.modal-panel__close')?.focus();
      }
    },
  });

  return (sections) => {
    if (!state.detailPane || !panelRef) return;
    state.detailPane.replaceChildren(detailBodyEl({ ...opts, sections }));
    renderIcons(state.detailPane);
  };
}

// --------------------------------------------------------

// --------------------------------------------------------

function positionPopover(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  const fitsBelow = rect.bottom + POPOVER_GAP + popRect.height <= viewportHeight - POPOVER_MARGIN;
  const top = fitsBelow
    ? rect.bottom + POPOVER_GAP
    : Math.max(POPOVER_MARGIN, rect.top - POPOVER_GAP - popRect.height);
  const left = Math.min(
    Math.max(POPOVER_MARGIN, rect.left),
    Math.max(POPOVER_MARGIN, viewportWidth - popRect.width - POPOVER_MARGIN),
  );
  const maxTop = Math.max(POPOVER_MARGIN, viewportHeight - popRect.height - POPOVER_MARGIN);

  popover.style.top = `${Math.min(Math.max(POPOVER_MARGIN, top), maxTop)}px`;
  popover.style.left = `${left}px`;
}

function openAsPopover(opts) {



  const popover = document.createElement('div');
  popover.id = 'detail-view-popover';
  popover.className = 'detail-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.tabIndex = -1;

  const heading = document.createElement('h2');
  heading.className = 'detail-popover__title';
  heading.id = 'detail-popover-title';
  heading.textContent = opts.title ?? '';
  popover.setAttribute('aria-labelledby', heading.id);
  popover.appendChild(heading);

  let bodyEl = detailBodyEl(opts);
  popover.appendChild(bodyEl);




  const actions = [];
  if (opts.edit?.standalone) {
    actions.push({
      label: opts.edit.label ?? t('common.edit'),
      variant: 'secondary',
      id: 'detail-popover-edit',
      onClick: () => { closeDetailView(); opts.edit.standalone(); },
    });
  }
  (opts.actions ?? []).forEach((a) => actions.push(a));

  const footer = detailFooterEl(actions);
  if (footer) {
    footer.classList.add('detail-popover__footer');
    popover.appendChild(footer);
  }

  document.body.appendChild(popover);
  renderIcons(popover);
  positionPopover(popover, opts.anchor);

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();

      closeDetailView();
      return;
    }
    if (e.key !== 'Tab') return;


    const focusable = popover.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onOutsideClick = (e) => {


    if (!popover.isConnected || !popover.contains(e.target)) closeDetailView({ fokus: false });
  };

  activePopover = {
    el: popover,
    anchor: opts.anchor,

    // einem Neuaufbau wiederfindet (#1083).
    merker: rememberFocus(opts.anchor),
    onClose: opts.onClose,




    overlayToken: pushOverlay(() => { closeDetailView(); }),
    teardown() {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('click', onOutsideClick);
    },
  };

  document.addEventListener('keydown', onKeydown);


  setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
  popover.focus();

  return (sections) => {
    if (!popover.isConnected) return;
    const next = detailBodyEl({ ...opts, sections });
    popover.replaceChild(next, bodyEl);
    bodyEl = next;
    renderIcons(next);

    // oder ragte unten heraus.
    positionPopover(popover, opts.anchor);
  };
}

// --------------------------------------------------------

// --------------------------------------------------------

export function openDetailView(opts = {}) {
  const usePopover = window.innerWidth >= POPOVER_MIN_WIDTH && !!opts.anchor;








  if (activePopover) closeDetailView({ fokus: false });

  const token = ++viewSeq;
  activeViewToken = token;

  const applySections = usePopover ? openAsPopover(opts, token) : openAsSheet(opts, token);

  return {
    isOpen: () => activeViewToken === token,
    update(sections) {
      if (activeViewToken !== token) return false;
      applySections(sections);
      return true;
    },
  };
}

export function closeDetailView({ force = false, fokus = true } = {}) {
  activeViewToken = 0;
  if (activePopover) {
    const { el, teardown, onClose, overlayToken, merker } = activePopover;
    activePopover = null;
    teardown();
    el.remove();
    dropOverlay(overlayToken);
    if (typeof onClose === 'function') onClose();




    // fremden Zusammenhang.
    if (fokus && merker) restoreFocusAfterClose(merker);
    else forgetRestore();
    return Promise.resolve();
  }
  return closeModal({ force });
}
