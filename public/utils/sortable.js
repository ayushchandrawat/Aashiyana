import { vibrate } from './ux.js';

let sortablePromise = null;
let SortableCtor = null;
function loadSortable() {
  if (!sortablePromise) {
    sortablePromise = import('/vendor/sortablejs/sortable.esm.min.js')
      .then((mod) => { SortableCtor = mod.default; return mod.default; })
      .catch((err) => {
        // Fehlgeschlagenen Import nicht dauerhaft cachen: sonst liefert jeder



        sortablePromise = null;
        throw err;
      });
  }
  return sortablePromise;
}

export function isDragActive() {
  return !!(SortableCtor && SortableCtor.active);
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export async function makeSortable(listEl, { handle, draggable, filter, group, sort = true, onEnd } = {}) {
  if (!listEl || typeof onEnd !== 'function') return null;
  const Sortable = await loadSortable();
  const reduced = prefersReducedMotion();
  return Sortable.create(listEl, {
    handle,
    draggable,
    filter,






    preventOnFilter: false,
    group,
    sort,
    animation: reduced ? 0 : 150,
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    delay: 120,
    delayOnTouchOnly: true,
    touchStartThreshold: 5,
    // Statt nativem HTML5-DnD: eigene Maus/Touch-Simulation. Konsistentes


    // einem Browser-eigenen Screenshot-Ghost).
    forceFallback: true,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onEnd(evt) {


      // gleicher Platz hiess dann "nichts passiert". Mit `group` (#808:



      //


      if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
      vibrate(15);
      onEnd(evt);
    },
  });
}
