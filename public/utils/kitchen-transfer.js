
import { t } from '/i18n.js';
import { api } from '/api.js';
import { selectModal } from '/components/modal.js';
import { refreshKitchenBadges } from '/utils/kitchen-tabs.js';

export const TRANSFER_TOAST_MS = 5000;

function shoppingReachable() {
  return !window.aashiyana?.isModuleDisabled?.('shopping');
}

export function missingShoppingListAnswer({ beforeLeave } = {}) {
  return {
    message: t('kitchen.noShoppingLists'),
    action: shoppingReachable()
      ? {
          label: t('kitchen.createShoppingList'),
          onClick: () => {
            beforeLeave?.();
            window.aashiyana?.navigate('/shopping');
          },
        }
      : null,
  };
}

export async function resolveShoppingTarget(lists, opts) {
  const available = Array.isArray(lists) ? lists : [];

  if (!available.length) {
    const { message, action } = missingShoppingListAnswer(opts);
    window.aashiyana?.showToast(message, 'warning', TRANSFER_TOAST_MS, action);
    return null;
  }

  if (available.length === 1) {
    return { id: available[0].id, name: available[0].name };
  }

  const chosen = await selectModal(
    t('common.toShoppingListWhich'),
    available.map((list) => ({ value: String(list.id), label: list.name })),
  );
  if (chosen === null || chosen === undefined) return null;

  const id = Number(chosen);
  return { id, name: available.find((list) => list.id === id)?.name ?? '' };
}

export function mountMissingShoppingList(target, opts) {
  if (!target) return null;
  const { message, action } = missingShoppingListAnswer(opts);

  const hint = document.createElement('p');
  hint.className = 'shopping-transfer__hint';
  hint.textContent = message;
  target.replaceChildren(hint);

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--secondary shopping-transfer__btn';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    target.appendChild(btn);
  }
  return target;
}

export function announceTransfer({ message, addedIds = [], onUndone } = {}) {
  refreshKitchenBadges();

  const ids = Array.isArray(addedIds) ? addedIds.filter((id) => Number.isFinite(Number(id))) : [];
  const undo = ids.length
    ? async () => {
        try {
          await api.post('/shopping/items/undo-transfer', { ids });
          refreshKitchenBadges();
          await onUndone?.();



          // die nichts Neues sagt.
          window.aashiyana?.showToast(t('kitchen.transferUndone'), 'info');
        } catch (err) {
          window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
        }
      }
    : null;

  window.aashiyana?.showToast(message, 'success', TRANSFER_TOAST_MS, undo);
}
