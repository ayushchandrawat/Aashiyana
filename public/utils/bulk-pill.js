import { t } from '/i18n.js';

export const BULK_PILL_LAYER = 'bulk-pill-layer';

const CONFIRM_GRACE_MS = 400;

export function bulkPillLayer() {
  return document.getElementById(BULK_PILL_LAYER);
}

function actionButton({ label, ariaLabel, count, danger, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'list-bulkbar__action';



  if (danger) btn.classList.add('list-bulkbar__action--danger');
  btn.textContent = label;
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);




  //




  //






  // `display: none` bei 320px.
  if (count != null) {
    const badge = document.createElement('span');
    badge.className = 'list-bulkbar__action-count';
    badge.textContent = String(count);
    badge.setAttribute('aria-hidden', 'true');
    btn.appendChild(badge);
  }
  btn.addEventListener('click', () => onClick(btn));
  return btn;
}

function paint(spec, pending) {
  const layer = bulkPillLayer();
  if (!layer) return null;

  const bar = document.createElement('div');
  bar.className = 'list-bulkbar';



  bar.setAttribute('role', 'group');
  if (pending) bar.classList.add('list-bulkbar--confirming');







  //



  const subject = document.createElement('span');
  subject.className = 'list-bulkbar__subject';
  subject.id = 'bulk-pill-subject';
  subject.textContent = pending ? pending.confirm.question : spec.label;
  bar.setAttribute('aria-labelledby', subject.id);
  bar.appendChild(subject);

  if (pending) {






    const choices = document.createElement('div');
    choices.className = 'list-bulkbar__choices';




    const cancel = actionButton({
      label: t('common.cancel'),
      onClick: () => {
        const back = paint(spec, null);


        back?.querySelectorAll('.list-bulkbar__action')[spec.actions.indexOf(pending)]?.focus();
      },
    });
    choices.appendChild(cancel);


    // Ruhezustand vermeidet.
    const confirmBtn = actionButton({
      label: pending.confirm.confirmLabel ?? pending.label,
      ariaLabel: pending.ariaLabel,
      danger: pending.danger,
      onClick: (btn) => pending.onClick(btn),
    });





    //






    //

    confirmBtn.disabled = true;
    setTimeout(() => { confirmBtn.disabled = false; }, CONFIRM_GRACE_MS);
    choices.appendChild(confirmBtn);
    bar.appendChild(choices);



    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      cancel.click();
    });
  } else {
    for (const action of spec.actions) {
      bar.appendChild(actionButton({
        ...action,



        onClick: action.confirm
          ? () => { paint(spec, action)?.querySelector('.list-bulkbar__action')?.focus(); }
          : (btn) => action.onClick(btn),
      }));
    }
  }

  const alt = layer.querySelector('.list-bulkbar');
  const fokusIndex = alt && alt.contains(document.activeElement)
    ? [...alt.querySelectorAll('button')].indexOf(document.activeElement)
    : -1;

  layer.replaceChildren(bar);

  if (fokusIndex >= 0) {
    const knoepfe = [...bar.querySelectorAll('button')];
    (knoepfe[fokusIndex] ?? knoepfe[knoepfe.length - 1])?.focus();
  }
  return bar;
}

export function setBulkPill(spec) {
  return paint({ actions: [], ...spec }, null);
}

export function clearBulkPill() {
  bulkPillLayer()?.replaceChildren();
}
