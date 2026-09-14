import { wireScrollFade } from '/utils/ux.js';

function scrollTabIntoView(container, btn) {
  const c = container.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  if (b.left < c.left) {
    container.scrollLeft -= c.left - b.left;
  } else if (b.right > c.right) {
    container.scrollLeft += b.right - c.right;
  }
}

export function wireTablist(container, { activeId, onChange, activeClass = 'sub-tab--active', mode = 'tabs', manualActivation = false } = {}) {
  if (!container) return { setActive() {} };
  let current = activeId;

  const buttons = () => [...container.querySelectorAll('[data-tab-id]')];

  const paint = () => {
    let activeBtn = null;
    buttons().forEach((b) => {
      const on = b.dataset.tabId === current;
      b.classList.toggle(activeClass, on);


      if (mode === 'select') {
        b.setAttribute('aria-checked', String(on));
      } else {
        b.setAttribute('aria-selected', String(on));
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      }
      b.tabIndex = on ? 0 : -1;
      if (on) activeBtn = b;
    });







    if (activeBtn) scrollTabIntoView(container, activeBtn);
  };

  const setActive = (id, { focus = false } = {}) => {
    if (!id || id === current) return;
    current = id;
    paint();
    if (focus) buttons().find((b) => b.dataset.tabId === id)?.focus();
    onChange?.(id);
  };

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab-id]');
    if (btn) setActive(btn.dataset.tabId);
  });




  // ausdruecklich tut.
  const focusTab = (btn) => {
    buttons().forEach((b) => { b.tabIndex = b === btn ? 0 : -1; });
    btn.focus();
    scrollTabIntoView(container, btn);
  };

  container.addEventListener('keydown', (e) => {
    const moveKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (manualActivation && (e.key === 'Enter' || e.key === ' ')) {
      const btn = e.target.closest('[data-tab-id]');
      if (!btn) return;
      e.preventDefault();
      setActive(btn.dataset.tabId, { focus: true });
      return;
    }
    if (!moveKeys.includes(e.key)) return;
    const b = buttons();
    if (!b.length) return;
    const focusedIndex = b.indexOf(document.activeElement);
    const currentIndex = Math.max(0, b.findIndex((x) => x.dataset.tabId === current));
    const index = focusedIndex >= 0 ? focusedIndex : currentIndex;
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % b.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + b.length) % b.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = b.length - 1;
    e.preventDefault();
    if (manualActivation) focusTab(b[next]);
    else setActive(b[next]?.dataset.tabId, { focus: true });
  });




  const sync = (id) => { current = id; paint(); };



  wireScrollFade(container);

  paint();
  return { setActive, sync };
}
