
import { esc } from '/utils/html.js';

export function popoverMenuHtml({ id, label, items = [], triggerClass = 'btn btn--ghost btn--icon' }) {
  const entries = items.map((item) => `
    <button type="button" role="menuitem"
            class="popover-menu__item${item.danger ? ' popover-menu__item--danger' : ''}"
            data-action="${esc(item.action)}"${item.id == null ? '' : ` data-id="${esc(String(item.id))}"`}>
      <i data-lucide="${esc(item.icon)}" class="icon-md" aria-hidden="true"></i>
      <span>${esc(item.label)}</span>
    </button>`).join('');

  return `
    <button type="button" class="${triggerClass} popover-menu__trigger"
            popovertarget="${esc(id)}" aria-haspopup="menu" aria-expanded="false"
            aria-label="${esc(label)}" title="${esc(label)}">
      <i data-lucide="ellipsis" class="icon-md" aria-hidden="true"></i>
    </button>
    <div class="popover-menu" id="${esc(id)}" popover role="menu">${entries}</div>`;
}

function onBeforeToggle(event) {
  const panel = event.target;
  if (!(panel instanceof HTMLElement) || !panel.matches('.popover-menu')) return;
  if (event.newState === 'open') panel.style.opacity = '0';
}

function onToggle(event) {
  const panel = event.target;
  if (!(panel instanceof HTMLElement) || !panel.matches('.popover-menu')) return;




  const trigger = document.querySelector(`[popovertarget="${panel.id}"]`);
  trigger?.setAttribute('aria-expanded', String(event.newState === 'open'));

  if (event.newState !== 'open') { panel.style.opacity = ''; return; }

  if (trigger) {
    const rect = trigger.getBoundingClientRect();
    const width = panel.offsetWidth || 200;
    const height = panel.offsetHeight || 48;
    const gap = 4;

    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    let top = rect.bottom + gap;


    if (top + height > window.innerHeight - 8) top = rect.top - height - gap;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(Math.max(8, top))}px`;
  }
  panel.style.opacity = '1';






  const items = itemsOf(panel);
  if (!items.length) return;
  const checked = items.findIndex((item) => item.getAttribute('aria-checked') === 'true');
  focusItem(items, checked === -1 ? 0 : checked);
}

function itemsOf(panel) {
  return [...panel.querySelectorAll('.popover-menu__item:not([disabled])')];
}

function focusItem(items, index) {
  const target = items[(index + items.length) % items.length];
  for (const item of items) item.tabIndex = item === target ? 0 : -1;
  target.focus();
}

function onKeydown(event) {
  const panel = event.target?.closest?.('.popover-menu');
  if (!panel) return;
  const items = itemsOf(panel);
  if (!items.length) return;

  const current = items.indexOf(event.target.closest('.popover-menu__item'));
  const next = {
    ArrowDown: current + 1,
    ArrowUp: current === -1 ? items.length - 1 : current - 1,
    Home: 0,
    End: items.length - 1,
  }[event.key];
  if (next === undefined) return;

  event.preventDefault();
  focusItem(items, next);
}

function onItemClick(event) {
  const item = event.target?.closest?.('.popover-menu__item');
  if (!item) return;
  item.closest('.popover-menu')?.hidePopover?.();
}

export function installPopoverMenus(root) {
  if (!root || root.dataset.popoverMenus) return;
  root.dataset.popoverMenus = 'true';
  root.addEventListener('beforetoggle', onBeforeToggle, { capture: true });
  root.addEventListener('toggle', onToggle, { capture: true });
  root.addEventListener('click', onItemClick, { capture: true });
  root.addEventListener('keydown', onKeydown);
}
