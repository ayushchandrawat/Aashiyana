
const LINE_WIDTHS = ['medium', 'full', 'short'];

export function renderSkeletonCard({ lines = 2 } = {}) {
  const count = Math.max(1, Math.floor(lines));
  let out = '';
  for (let i = 0; i < count; i++) {

    const variant = i === 0 ? 'title' : LINE_WIDTHS[(i - 1) % LINE_WIDTHS.length];
    out += `<div class="skeleton skeleton-line skeleton-line--${variant}"></div>`;
  }
  return `<div class="skeleton-card">${out}</div>`;
}

export function renderSkeletonList({ rows = 5, lines = 2 } = {}) {
  const count = Math.max(0, Math.floor(rows));
  let cards = '';
  for (let i = 0; i < count; i++) cards += renderSkeletonCard({ lines });
  return `<div class="skeleton-list" aria-hidden="true">${cards}</div>`;
}
