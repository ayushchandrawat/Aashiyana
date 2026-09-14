
import { t } from '/i18n.js';
import { confirmModal } from '/components/modal.js';



const dirtyForms = new Set();
let unloadBound = false;

function savableForm(target) {
  const form = typeof target?.closest === 'function' ? target.closest('form') : null;
  if (!form) return null;
  return form.querySelector('button[type="submit"], input[type="submit"]') ? form : null;
}




function hasOpenEdits() {
  for (const form of dirtyForms) {
    if (!form.isConnected) dirtyForms.delete(form);
  }
  return dirtyForms.size > 0;
}

function onBeforeUnload(event) {
  if (!hasOpenEdits()) return;
  event.preventDefault();
  event.returnValue = '';
}

export function watchLeafForms(container) {
  clearLeafEdits();

  const mark = (event) => {


    if (!event.isTrusted) return;
    const form = savableForm(event.target);
    if (form) dirtyForms.add(form);
  };
  const release = (event) => {
    const form = event.target?.closest?.('form');
    if (form) dirtyForms.delete(form);
  };

  container.addEventListener('input', mark, true);
  container.addEventListener('change', mark, true);
  container.addEventListener('submit', release, true);
  container.addEventListener('reset', release, true);

  if (!unloadBound) {
    window.addEventListener('beforeunload', onBeforeUnload);
    unloadBound = true;
  }
}

export function clearLeafEdits() {
  dirtyForms.clear();
}

export async function confirmLeafExit() {
  if (!hasOpenEdits()) return true;
  const confirmed = await confirmModal(t('modal.unsavedChanges'), {
    danger: false,
    confirmLabel: t('modal.discardChanges'),
    detail: t('modal.unsavedChangesDetail'),
  });
  if (confirmed) clearLeafEdits();
  return confirmed;
}
