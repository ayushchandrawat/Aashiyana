
import { esc } from '/utils/html.js';

export const CHART = Object.freeze({ W: 600, H: 200, PAD_L: 56, PAD_R: 12, PAD_T: 14, PAD_B: 26 });

export function chartScales() {
  const { W, H, PAD_L, PAD_R, PAD_T, PAD_B } = CHART;
  return { left: PAD_L, right: W - PAD_R, top: PAD_T, bottom: H - PAD_B };
}

export function chartGridMarkup(min, max, formatTick) {
  const { W, PAD_L, PAD_R } = CHART;
  const { top, bottom } = chartScales();
  const out = [];
  const wholeTicks = (max - min) >= 4;
  for (let k = 0; k <= 4; k++) {
    const gy = top + (k * (bottom - top)) / 4;
    const val = max - (k * (max - min)) / 4;
    out.push(`<line class="chart__grid" x1="${PAD_L}" y1="${gy.toFixed(1)}" x2="${W - PAD_R}" y2="${gy.toFixed(1)}" vector-effect="non-scaling-stroke" />`);
    out.push(`<text x="${PAD_L - 6}" y="${(gy + 3.5).toFixed(1)}" class="chart__axis chart__axis--y" text-anchor="end">${esc(formatTick(val, wholeTicks))}</text>`);
  }
  return out.join('');
}

export function chartXLabelsMarkup(labels) {
  if (!labels.length) return '';
  const { H, W, PAD_L, PAD_R } = CHART;
  const y = H - 7;
  const picks = labels.length <= 2
    ? labels.slice()
    : [labels[0], labels[Math.floor((labels.length - 1) / 2)], labels[labels.length - 1]];
  return picks.map((label, idx) => {
    const anchor = idx === 0 ? 'start' : idx === picks.length - 1 ? 'end' : 'middle';
    const px = anchor === 'start' ? PAD_L : anchor === 'end' ? W - PAD_R : (PAD_L + (W - PAD_R)) / 2;
    return `<text x="${px.toFixed(1)}" y="${y}" class="chart__axis" text-anchor="${anchor}">${esc(label)}</text>`;
  }).join('');
}

export function chartY(value, min, max) {
  const { top, bottom } = chartScales();
  if (max === min) return (top + bottom) / 2;
  return bottom - ((value - min) / (max - min)) * (bottom - top);
}

export function chartX(index, count) {
  const { left, right } = chartScales();
  if (count <= 1) return left;
  return left + (index * (right - left)) / (count - 1);
}
