
import { esc } from '/utils/html.js';

function bildUrl(recipeId, { hasImage, hasOwnImage }) {
  if (!recipeId) return null;
  if (hasOwnImage) return `/api/v1/recipes/${Number(recipeId)}/image`;
  if (hasImage) return `/api/v1/recipes/${Number(recipeId)}/provider-thumbnail`;
  return null;
}

export function recipeThumbEl({ recipeId, hasImage, hasOwnImage, className, iconClass = 'icon-sm' }) {
  const slot = document.createElement('span');
  slot.className = className;

  const placeholder = () => {
    slot.classList.add(`${className}--placeholder`);
    slot.insertAdjacentHTML('beforeend', `<i data-lucide="utensils" class="${iconClass}" aria-hidden="true"></i>`);
  };

  const url = bildUrl(recipeId, { hasImage, hasOwnImage });
  if (!url) {
    placeholder();
    return slot;
  }

  const img = document.createElement('img');
  img.className = `${className}-img`;
  img.src = url;


  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    img.remove();
    placeholder();
    if (window.lucide) window.lucide.createIcons({ el: slot });
  }, { once: true });
  slot.appendChild(img);
  return slot;
}

export function recipeThumbHtml({ recipeId, hasImage, hasOwnImage, className, iconClass = 'icon-sm' }) {
  const url = bildUrl(recipeId, { hasImage, hasOwnImage });
  if (!url) {
    return `<span class="${className} ${className}--placeholder"><i data-lucide="utensils" class="${iconClass}" aria-hidden="true"></i></span>`;
  }
  return `<span class="${className}"><img class="${className}-img" src="${esc(url)}" alt="" loading="lazy" data-recipe-thumb="${esc(className)}" data-thumb-icon="${esc(iconClass)}"></span>`;
}

export function wireRecipeThumbs(root) {
  for (const img of root?.querySelectorAll?.('img[data-recipe-thumb]') ?? []) {
    const className = img.dataset.recipeThumb;
    const iconClass = img.dataset.thumbIcon || 'icon-sm';
    delete img.dataset.recipeThumb;
    delete img.dataset.thumbIcon;

    const fallback = () => {
      const slot = img.parentElement;
      img.remove();
      if (!slot) return;
      slot.classList.add(`${className}--placeholder`);
      slot.insertAdjacentHTML('beforeend', `<i data-lucide="utensils" class="${iconClass}" aria-hidden="true"></i>`);
      if (window.lucide) window.lucide.createIcons({ el: slot });
    };






    if (img.complete && img.naturalWidth === 0) { fallback(); continue; }
    img.addEventListener('error', fallback, { once: true });
  }
}
