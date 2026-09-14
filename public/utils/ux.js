
export function stagger(elements, { delay = 30, duration = 180, max = 5 } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = Array.from(elements);
  els.forEach((el, i) => {
    const itemDelay = i < max ? i * delay : max * delay;
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = `opacity ${duration}ms ease, transform ${duration}ms ease`;
    setTimeout(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, itemDelay);
  });
}

export function vibrate(pattern) {
  if (!navigator.vibrate) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  navigator.vibrate(pattern);
}

export function animationSettled(el, { fallback = 260 } = {}) {
  if (!el) return Promise.resolve();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('animationend', finish);
      resolve();
    };
    el.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, fallback);
  });
}

// --------------------------------------------------------

// --------------------------------------------------------

const _pendingDeletes = new Set();
let _deleteFlushBound = false;

function bindDeleteFlush() {
  if (_deleteFlushBound) return;
  _deleteFlushBound = true;



  window.addEventListener('pagehide', () => {
    for (const entry of [..._pendingDeletes]) entry.flush();
  });
}

export function scheduleUndoableDelete({
  commit,
  restore,
  message,
  duration = 5000,
  restoreOnKeepaliveError = false,
}) {
  bindDeleteFlush();
  let settled = false;
  const entry = {};
  const finish = async ({ keepalive = false } = {}) => {
    if (settled) return;
    settled = true;
    _pendingDeletes.delete(entry);
    clearTimeout(entry.timer);
    try {
      await commit({ keepalive });
    } catch (err) {


      if (!keepalive || restoreOnKeepaliveError) restore?.(err);
    }
  };
  entry.flush = () => { finish({ keepalive: true }); };
  entry.timer = setTimeout(() => finish(), duration);
  _pendingDeletes.add(entry);
  window.aashiyana?.showToast(message, 'default', duration, () => {
    if (settled) return;
    settled = true;
    _pendingDeletes.delete(entry);
    clearTimeout(entry.timer);
    restore?.();
  });
}

export function wireScrollFade(el, { axis = 'x' } = {}) {
  if (!el) return { update: () => {}, destroy: () => {} };






  el.classList.add('u-scroll-fade');



  // trug trotzdem keinen End-Fade (Sonde 20). 2px decken Rundung; ein
  // Ueberlauf darueber ist Inhalt, kein Offset.
  const eps = 2;


  const posEps = 0.5;
  const update = () => {





    const pos = axis === 'y' ? el.scrollTop : Math.abs(el.scrollLeft);
    const max = axis === 'y'
      ? el.scrollHeight - el.clientHeight
      : el.scrollWidth - el.clientWidth;


    //




    // abgezogen wird.
    //








    //

    // traegt sie mindestens einen Fade.
    if (max <= eps) {
      el.classList.remove('has-fade-start', 'has-fade-end');
      return;
    }
    el.classList.toggle('has-fade-start', pos > posEps);
    el.classList.toggle('has-fade-end', max - pos > posEps);
  };
  el.addEventListener('scroll', update, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(el);
  const mo = new MutationObserver(update);
  mo.observe(el, { childList: true, subtree: true });
  update();
  return {
    update,
    destroy: () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      mo.disconnect();
    },
  };
}

export function wireCollapsingHeader(toolbar, opts = {}) {
  const noop = { update: () => {}, destroy: () => {} };
  if (!toolbar) return null;

  if (toolbar.dataset.collapsingHeader) return noop;
  toolbar.dataset.collapsingHeader = '1';

  const scrollport = (() => {
    let el = toolbar.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
      el = el.parentElement;
    }
    return null;
  })();




  const capped = (() => {
    let el = toolbar.parentElement;
    while (el && el !== scrollport && el !== document.body) {
      if (getComputedStyle(el).overflowY === 'hidden') return el;
      el = el.parentElement;
    }
    return null;
  })();

  let io = null;
  let lead = 0;
  let dockTitle = null;
  let headSeal = null;


  //




  //


  const syncHeadSeal = () => {
    const heading = toolbar.classList.contains('page-toolbar--in-group')
      ? null
      : toolbar.querySelector(':scope > .page-toolbar__title');
    if (!opts.sealIcon || !heading) {
      headSeal?.remove();
      return;
    }
    if (!headSeal) {
      const icon = opts.sealIcon();
      if (!icon) return;
      headSeal = document.createElement('span');
      headSeal.className = 'module-seal module-seal--head';


      // die dritte Ansage desselben Wortes.
      headSeal.setAttribute('aria-hidden', 'true');
      headSeal.appendChild(icon);
    }



    if (headSeal.parentElement !== toolbar || headSeal.nextElementSibling !== heading) {
      toolbar.insertBefore(headSeal, heading);
    }
  };


  const onInnerScroll = (e) => {
    const port = e.target;
    if (!(port instanceof Element) || port === toolbar || toolbar.contains(port)) return;
    const reserve = port.scrollHeight - port.clientHeight;







    if (reserve <= 0 && port.scrollWidth > port.clientWidth) return;



    if (reserve < lead + 48) { toolbar.classList.remove('is-collapsed', 'is-docked'); return; }
    const top = port.scrollTop;
    if (top > 24) toolbar.classList.add('is-collapsed', 'is-docked');
    else if (top < 8) toolbar.classList.remove('is-collapsed', 'is-docked');
  };
  const update = () => {


    syncHeadSeal();



    if (toolbar.classList.contains('is-collapsed')) return;









    // der er andockt, hinge an ihm selbst.
    const rows = [...toolbar.children].filter(
      (c) => c !== dockTitle
        && (c.offsetParent !== null || c.getClientRects().length)
        && c.getBoundingClientRect().height > 0,
    );
    const tb = toolbar.getBoundingClientRect();
    const padTop = parseFloat(getComputedStyle(toolbar).paddingBlockStart) || 0;








    // Oberkante der letzten so gebildeten Zeile.
    const boxes = rows
      .map((c) => {
        const r = c.getBoundingClientRect();
        return { el: c, top: r.top - tb.top, bottom: r.bottom - tb.top };
      })
      .sort((a, b) => a.top - b.top);
    const lines = [];
    for (const b of boxes) {
      const line = lines.find((l) => b.top < l.bottom - 1 && b.bottom > l.top + 1);
      if (line) {
        line.top = Math.min(line.top, b.top);
        line.bottom = Math.max(line.bottom, b.bottom);
        line.els.push(b.el);
      } else {
        lines.push({ top: b.top, bottom: b.bottom, els: [b.el] });
      }
    }



    const lastTop = lines.length ? lines[lines.length - 1].top : 0;


    const firstEl = lines.length
      ? lines[0].els.reduce((a, b) => (b.getBoundingClientRect().height > a.getBoundingClientRect().height ? b : a))
      : null;
    lead = Math.max(0, Math.round(lastTop - padTop));
    toolbar.style.setProperty('--page-toolbar-lead', `${lead}px`);
    toolbar.classList.toggle('page-toolbar--stacked', lead > 0);
    toolbar.classList.toggle('page-toolbar--capped', Boolean(capped) && lead > 0);


    //






    //















    const lastLine = lines.length ? lines[lines.length - 1] : null;
    const tbCS = getComputedStyle(toolbar);
    const innerWidth = toolbar.clientWidth
      - (parseFloat(tbCS.paddingInlineStart) || 0)
      - (parseFloat(tbCS.paddingInlineEnd) || 0);
    const colGap = parseFloat(tbCS.columnGap) || 0;
    const usedWidth = lastLine
      ? lastLine.els.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0)
        + colGap * lastLine.els.length
      : 0;

    const roomForDockTitle = innerWidth - usedWidth >= 88;

    const heading = toolbar.querySelector(':scope > .page-toolbar__title');
    if (lead > 0 && !capped && heading && roomForDockTitle) {
      if (!dockTitle) {
        dockTitle = document.createElement('span');
        dockTitle.className = 'page-toolbar__dock-title';
        dockTitle.setAttribute('aria-hidden', 'true');
      }



      // triggert sich damit selbst.
      const text = heading.textContent.trim();
      if (dockTitle.textContent !== text) dockTitle.textContent = text;
      const anchor = toolbar.querySelector(':scope > .page-toolbar__actions');
      if (dockTitle.parentElement !== toolbar || dockTitle.nextElementSibling !== anchor) {
        toolbar.insertBefore(dockTitle, anchor);
      }
    } else if (dockTitle?.parentElement) {
      dockTitle.remove();
    }






    io?.disconnect();
    io = null;
    if (!lead || !firstEl || !scrollport || capped) {
      toolbar.classList.toggle('is-docked', !lead);
      return;
    }






    // Observer wechselt nie auf `false`. Gemessen an drei Modulen (Gesundheit,



    io = new IntersectionObserver(
      ([entry]) => toolbar.classList.toggle('is-docked', !entry.isIntersecting),
      { root: scrollport, threshold: 0, rootMargin: '-1px 0px 0px 0px' },
    );
    io.observe(firstEl);
  };

  const ro = new ResizeObserver(update);
  ro.observe(toolbar);
  const mo = new MutationObserver(update);
  mo.observe(toolbar, { childList: true, subtree: true });

  // Capture-Phase am Modul-Root gelauscht. Damit ist jede innere Liste erfasst,

  capped?.addEventListener('scroll', onInnerScroll, { capture: true, passive: true });
  update();

  return {
    update,
    destroy: () => {
      io?.disconnect();
      ro.disconnect();
      mo.disconnect();
      capped?.removeEventListener('scroll', onInnerScroll, { capture: true });
      dockTitle?.remove();
      dockTitle = null;
      headSeal?.remove();
      headSeal = null;
      delete toolbar.dataset.collapsingHeader;
      toolbar.style.removeProperty('--page-toolbar-lead');
      toolbar.classList.remove('page-toolbar--stacked', 'page-toolbar--capped', 'is-collapsed', 'is-docked');
    },
  };
}

export async function withBusy(control, task, { loadingClass = null } = {}) {
  const hadFocus = document.activeElement === control;
  if (loadingClass) control.classList.add(loadingClass);
  control.setAttribute('aria-busy', 'true');
  control.disabled = true;
  try {
    return await task();
  } finally {
    control.disabled = false;
    control.removeAttribute('aria-busy');
    if (loadingClass) control.classList.remove(loadingClass);
    if (hadFocus && control.isConnected && document.activeElement !== control) {
      control.focus({ preventScroll: true });
    }
  }
}

export function wireSwipeToDismiss(el, { onDismiss, threshold = 40, slop = 10, fade = 120 } = {}) {
  let startX = 0;
  let pressed = false;
  let swiping = false;

  const settle = () => {
    pressed = false;
    swiping = false;
    el.style.transform = '';
    el.style.opacity = '';
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    pressed = true;
    swiping = false;
  });

  el.addEventListener('pointermove', (e) => {
    if (!pressed) return;
    const dx = e.clientX - startX;
    if (!swiping) {
      if (Math.abs(dx) <= slop) return;
      swiping = true;
      el.setPointerCapture(e.pointerId);
    }
    el.style.transform = `translateX(${dx}px)`;
    el.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / fade));
  });

  el.addEventListener('pointerup', (e) => {
    if (!pressed) return;
    const dismissed = swiping && Math.abs(e.clientX - startX) > threshold;
    settle();
    if (dismissed) onDismiss?.();
  });

  el.addEventListener('pointercancel', settle);
}
