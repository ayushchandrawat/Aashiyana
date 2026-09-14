

export function pageFabHtml({ id = 'page-fab', label = '', icon = 'plus', dockLabel = '' } = {}) {
  return `<button type="button" class="page-fab" id="${id}"${label ? ` aria-label="${label}"` : ''}${dockLabel ? ` data-dock-label="${dockLabel}"` : ''}>
      <i data-lucide="${icon}" aria-hidden="true"></i>
    </button>`;
}

/** Gemeinsamer FAB als DOM-Element, optional an onClick gebunden. */
export function createPageFab({ id = 'page-fab', label = '', icon = 'plus', onClick, dockLabel = '' } = {}) {
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'page-fab';
  fab.id = id;
  if (label) fab.setAttribute('aria-label', label);
  if (dockLabel) fab.dataset.dockLabel = dockLabel;
  const glyph = document.createElement('i');
  glyph.dataset.lucide = icon;
  glyph.setAttribute('aria-hidden', 'true');
  fab.appendChild(glyph);
  if (onClick) fab.addEventListener('click', onClick);
  return fab;
}

export function findPageFab(id) {
  return document.getElementById(id);
}

export function setPageFabAction(fab, { label = '', onClick = null, hidden = false, dockLabel = '' } = {}) {
  if (!fab) return;


  fab.hidden = hidden;
  fab.style.display = hidden ? 'none' : '';
  if (label) fab.setAttribute('aria-label', label);



  if (dockLabel) fab.dataset.dockLabel = dockLabel;
  else delete fab.dataset.dockLabel;





  // weitergezogen ist.
  const dockedLabel = fab.querySelector('.toolbar-new-btn__label');
  if (dockedLabel && dockLabel) dockedLabel.textContent = dockLabel;
  fab.onclick = hidden ? null : onClick;
}
