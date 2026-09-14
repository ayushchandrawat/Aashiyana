
import { vibrate } from '/utils/ux.js';
import { t } from '/i18n.js';

export const SWIPE_THRESHOLD = 80;
export const SWIPE_MAX_VERT  = 12;   // px - vertikaler Toleranzbereich
export const SWIPE_LOCK_VERT = 30;



const SWIPE_RESET_MS = 250;

const SWIPE_HINT_KEY = 'aashiyana:swipeHintSeen';
const SWIPE_HINT_MAX = 3;
const SWIPE_SWAP_KEY = 'aashiyana:swipeSidesSwapped';
const SWIPE_PRIOR_KEY = 'aashiyana:swipePriorInstall';

function rememberPriorInstall() {
  try {
    if (localStorage.getItem(SWIPE_PRIOR_KEY)) return;
    localStorage.setItem(SWIPE_PRIOR_KEY, localStorage.getItem(SWIPE_HINT_KEY) ? '1' : '0');
  } catch { /* Storage gesperrt (Safari privat): dann eben ohne Hinweis */ }
}
rememberPriorInstall();

function noticeSwappedSides() {
  try {
    if (localStorage.getItem(SWIPE_PRIOR_KEY) !== '1') return;
    if (localStorage.getItem(SWIPE_SWAP_KEY)) return;
    localStorage.setItem(SWIPE_SWAP_KEY, '1');
  } catch { return; }
  window.aashiyana?.showToast(t('common.swipeSidesSwapped'), 'default', 6000);
}

export function wireSwipeRows(listEl, {
  card, ignore = null, leading = null, trailing = null, sidesSwapped = false,
} = {}) {
  if (!listEl || !card) return;

  const panels = [leading?.reveal, trailing?.reveal].filter(Boolean);



  const sideFor = (dx) => (document.documentElement.dir === 'rtl'
    ? (dx < 0 ? leading : trailing)
    : (dx < 0 ? trailing : leading));

  listEl.querySelectorAll('.swipe-row').forEach((row) => {
    const cardEl = row.querySelector(card);
    if (!cardEl) return;

    let startX = 0, startY = 0;
    let dx = 0;
    let locked = false;       // false = unentschieden, 'swipe' | 'scroll'
    let thresholdHit = false; // Haptik am Schwellwert nur einmal

    const revealEl = (sel) => (sel ? row.querySelector(sel) : null);




    // Aufgabenkarten gleichzeitig, jede mit eigener Ebene samt Speicher


    // Geste, also genau dorthin, wo sie stoert.
    let disarmTimer = null;
    function arm() {
      clearTimeout(disarmTimer);
      row.classList.add('swipe-row--armed');
    }
    function disarm(afterMs = 0) {
      clearTimeout(disarmTimer);
      if (!afterMs) { row.classList.remove('swipe-row--armed'); return; }

      // einloesen, sonst verliert genau die letzte Bewegung ihre Ebene.
      disarmTimer = setTimeout(() => row.classList.remove('swipe-row--armed'), afterMs);
    }

    function resetCard(animate = true) {
      cardEl.style.transition = animate ? `transform ${SWIPE_RESET_MS}ms ease` : '';
      cardEl.style.transform = '';
      row.classList.remove('swipe-row--swiping');
      disarm(animate ? SWIPE_RESET_MS : 0);
      for (const sel of panels) {
        const el = revealEl(sel);
        if (el) el.style.opacity = '0';
      }
    }

    row.addEventListener('touchstart', (e) => {

      if (document.getElementById('shared-modal-overlay')) return;



      if (ignore && e.target.closest?.(ignore)) { locked = 'scroll'; return; }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
      locked = false;
      thresholdHit = false;
      cardEl.style.transition = '';
      arm();
    }, { passive: true });



    // gerendert wird.
    row.addEventListener('touchcancel', () => { resetCard(false); }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      if (locked === 'scroll') return;

      dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);


      if (locked === false) {
        if (dy > SWIPE_MAX_VERT && Math.abs(dx) < dy) {
          locked = 'scroll';
          resetCard(false);
          return;
        }
        if (Math.abs(dx) > SWIPE_MAX_VERT) locked = 'swipe';
      }
      if (locked !== 'swipe') return;


      if (dy < SWIPE_LOCK_VERT) e.preventDefault();


      const dampened = dx > 0
        ? Math.min(dx, SWIPE_THRESHOLD + (dx - SWIPE_THRESHOLD) * 0.2)
        : Math.max(dx, -(SWIPE_THRESHOLD + (-dx - SWIPE_THRESHOLD) * 0.2));
      cardEl.style.transform = `translateX(${dampened}px)`;
      row.classList.add('swipe-row--swiping');


      const progress = String(Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1));
      const shown = sideFor(dx)?.reveal;
      for (const sel of panels) {
        const el = revealEl(sel);
        if (el) el.style.opacity = sel === shown ? progress : '0';
      }

      if (!thresholdHit && Math.abs(dx) >= SWIPE_THRESHOLD) {
        thresholdHit = true;
        vibrate(15);
      }
    }, { passive: false });

    row.addEventListener('touchend', async () => {
      if (locked !== 'swipe') { resetCard(false); return; }

      const dir = Math.abs(dx) > SWIPE_THRESHOLD ? sideFor(dx) : null;
      if (!dir) { resetCard(true); return; }

      if (sidesSwapped) noticeSwappedSides();

      if (dir.flyOut) {


        cardEl.style.transition = 'transform 0.2s ease';
        cardEl.style.transform = `translateX(${dx < 0 ? '-' : ''}110%)`;
        vibrate(40);
        setTimeout(async () => {
          resetCard(false);
          await dir.run(row);
        }, 200);
        return;
      }

      resetCard(true);
      vibrate(20);
      await dir.run(row);
    }, { passive: true });
  });
}

let hintShownForPath = null;

export function maybeShowSwipeHint(container) {
  if (window.innerWidth >= 1024) return;
  if (hintShownForPath === location.pathname) return;




  let count = 0;
  try {
    count = parseInt(localStorage.getItem(SWIPE_HINT_KEY) ?? '0', 10) || 0;
  } catch { return; }
  if (count >= SWIPE_HINT_MAX) return;

  const firstRow = container.querySelector('.swipe-row');
  if (!firstRow) return;

  firstRow.classList.add('swipe-row--hint');
  firstRow.addEventListener('animationend', () => {
    firstRow.classList.remove('swipe-row--hint');
  }, { once: true });

  hintShownForPath = location.pathname;
  try {
    localStorage.setItem(SWIPE_HINT_KEY, String(count + 1));
  } catch { /* der Hinweis lief, nur das Merken schlug fehl */ }
}
