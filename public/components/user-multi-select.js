
import { esc } from '/utils/html.js';
import { t } from '/i18n.js';
import { getReadableTextColor, AVATAR_FALLBACK_COLOR } from '/utils/color.js';

export function renderAvatarStack(users, { size = 28, maxVisible = 3 } = {}) {
  if (!users?.length) return '';
  const visible = users.slice(0, maxVisible);
  const overflow = users.length - visible.length;




  // undersized-ui-text, 13 Fundstellen). Ab 20px Scheibe tragen 11px-Initialen



  const fs = Math.max(11, Math.round(size * 0.4));
  const showText = size >= 20;
  const avatars = visible.map((u) => {
    const initials = (u.display_name ?? '')
      .split(' ')
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
      .slice(0, 2);
    const inner = u.avatar_data
      ? `<img src="${esc(u.avatar_data)}" alt="${esc(u.display_name ?? '')}" loading="lazy">`
      : (showText ? esc(initials) : '');
    return `<span class="avatar-stack__item"
      style="width:${size}px;height:${size}px;font-size:${fs}px;background-color:${esc(u.color ?? AVATAR_FALLBACK_COLOR)};color:${getReadableTextColor(u.color ?? AVATAR_FALLBACK_COLOR)}"
      title="${esc(u.display_name ?? '')}">
      ${inner}
    </span>`;
  });
  if (overflow > 0) {
    avatars.push(`<span class="avatar-stack__item avatar-stack__overflow"
      style="width:${size}px;height:${size}px;font-size:${fs}px"
      title="${overflow} ${t('userMultiSelect.moreUsers')}">${showText ? `+${overflow}` : ''}</span>`);
  }
  return `<span class="avatar-stack">${avatars.join('')}</span>`;
}

export function renderUserMultiSelect(allUsers, selectedIds, inputName, labelKey, noneLabelKey = 'userMultiSelect.nobody') {
  const selectedSet = new Set(selectedIds ?? []);
  const items = allUsers.map((u) => {
    const checked = selectedSet.has(u.id) ? 'checked' : '';
    const initials = (u.display_name ?? '')
      .split(' ')
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
      .slice(0, 2);
    const inner = u.avatar_data
      ? `<img src="${esc(u.avatar_data)}" alt="${esc(u.display_name ?? '')}" loading="lazy">`
      : esc(initials);
    return `
      <label class="user-ms__option">
        <input type="checkbox" class="user-ms__checkbox" value="${u.id}" ${checked}
               data-ms-input="${esc(inputName)}">
        <span class="user-ms__avatar" style="background-color:${esc(u.avatar_color ?? AVATAR_FALLBACK_COLOR)};color:${getReadableTextColor(u.avatar_color ?? AVATAR_FALLBACK_COLOR)}">
          ${inner}
        </span>
        <span class="user-ms__name">${esc(u.display_name)}</span>
      </label>`;
  });

  const noneLabel = t(noneLabelKey);
  return `
    <div class="user-ms" data-ms-name="${esc(inputName)}">
      <label class="label">${t(labelKey)}</label>
      <div class="user-ms__options">
        <label class="user-ms__option">
          <input type="checkbox" class="user-ms__checkbox user-ms__none" value=""
                 data-ms-input="${esc(inputName)}" ${selectedSet.size === 0 ? 'checked' : ''}>
          <span class="user-ms__avatar user-ms__avatar--none">–</span>
          <span class="user-ms__name">${noneLabel}</span>
        </label>
        ${items.join('')}
      </div>
    </div>`;
}

export function getSelectedUserIds(container, inputName) {
  const checkboxes = container.querySelectorAll(
    `[data-ms-input="${CSS.escape(inputName)}"]:not(.user-ms__none):checked`
  );
  return Array.from(checkboxes).map((cb) => Number(cb.value)).filter(Boolean);
}

export function bindUserMultiSelect(container, inputName) {
  const widget = container.querySelector(`.user-ms[data-ms-name="${CSS.escape(inputName)}"]`);
  if (!widget) return;

  widget.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb.matches('.user-ms__checkbox')) return;

    if (cb.classList.contains('user-ms__none') && cb.checked) {
      widget.querySelectorAll('.user-ms__checkbox:not(.user-ms__none)').forEach((c) => { c.checked = false; });
    } else if (!cb.classList.contains('user-ms__none') && cb.checked) {
      const none = widget.querySelector('.user-ms__none');
      if (none) none.checked = false;
    }
  });
}
