
export function trendValence(delta, betterWhen) {
  if (betterWhen == null || delta === 0) return 'neutral';
  const rising = delta > 0;
  const improved = betterWhen === 'lower' ? !rising : rising;
  return improved ? 'positive' : 'negative';
}

export function trendIcon(delta) {
  if (delta > 0) return 'trending-up';
  if (delta < 0) return 'trending-down';
  return 'minus';
}

export function trendMarkup({ delta, betterWhen = null, text, icon = true }) {
  const valence = trendValence(delta, betterWhen);
  const iconHtml = icon
    ? `<i data-lucide="${trendIcon(delta)}" class="icon-sm" aria-hidden="true"></i>`
    : '';
  return `<span class="metric-card__trend metric-card__trend--${valence}">${iconHtml}${text}</span>`;
}
