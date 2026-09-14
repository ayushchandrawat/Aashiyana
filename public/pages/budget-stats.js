/**
 * Modul: Budget-Statistik-View
 * Zweck: Statistik-Tab (Zeitraum-Filter, Summary-Cards, Trendlinie, Donut, CSV-Export).
 */
import { api } from '/api.js';
import { t, formatDate, getLocale } from '/i18n.js';
import { wireTablist } from '/utils/tablist.js';
import { renderSkeletonList } from '/utils/skeleton.js';
import { mountEmptyState, mountLoadError } from '/utils/empty-state.js';
import { CHART, chartX, chartY, chartGridMarkup, chartXLabelsMarkup } from '/utils/chart.js';
import { formatMoneyAxis } from '/utils/money.js';




const view = { range: 'month', anchor: null, data: null, error: false, ctx: null, root: null };

const RANGE_LABELS = {
  week: 'budget.statsRangeWeek',
  month: 'budget.statsRangeMonth',
  year: 'budget.statsRangeYear',
};

export async function renderStats(panel, ctx) {
  view.ctx = ctx;
  view.root = panel;
  view.range = ctx.range;
  view.anchor = ctx.anchor;
  renderShell();
  await loadStats();
}

function fmtAmount(v) { return view.ctx.formatAmount(v); }



function scopeQuery() {
  return view.ctx?.budgetMode === 'personal' ? `&scope=${view.ctx.scope}` : '';
}

async function loadStats() {
  const body = view.root.querySelector('#budget-stats-body');


  if (body) {
    body.replaceChildren();
    body.insertAdjacentHTML('beforeend', renderSkeletonList({ rows: 4, lines: 2 }));
  }
  try {
    const res = await api.get(`/budget/stats?range=${view.range}&anchor=${view.anchor}${scopeQuery()}`);
    view.data = res.data;
    view.error = false;
  } catch (err) {
    console.error('[Budget] stats load error:', err);
    view.data = null;


    view.error = err;
  }
  renderBodyContent(body);
}

function renderShell() {
  view.root.replaceChildren();
  view.root.insertAdjacentHTML('beforeend', `
    <!-- reading, wie die Budget-Seite, in der dieses Panel steckt: dashboard
         hier setzte
         Kennzahlenband der Berichte lief auf 1200px, waehrend der Budget-Kopf
         und jeder andere Reiter bei 720px enden (auf main war es 720). Ein
         eigener Modus je Reiter hiesse, auch den Kopf je Reiter umzuschalten -
         das ist Welle C in docs/PAGE-COMPOSITION.md, keine Nebenwirkung. -->
    <div class="budget-stats app-page app-page--reading page-measure--narrow" data-composition="reading">
      <!-- Nur noch die Auflösung: der Zeitraum selbst wird über den geteilten
           Kopf-Stepper des Moduls gewählt. Optik aus dem geteilten
           .segmented-Baustein. -->
      <div class="budget-stats__controls">
        <div class="segmented budget-stats__ranges" role="tablist" aria-label="${t('budget.statsRangeLabel')}">
          ${['week', 'month', 'year'].map((r) => {
            const on = r === view.range;
            return `
            <button type="button" role="tab" class="segmented__item${on ? ' is-active' : ''}"
              data-tab-id="${r}" aria-selected="${on}" tabindex="${on ? '0' : '-1'}"
              aria-controls="budget-stats-body">${t(RANGE_LABELS[r])}</button>`;
          }).join('')}
        </div>
      </div>
      <div id="budget-stats-body" role="tabpanel" tabindex="0"></div>
    </div>
  `);
  if (window.lucide) lucide.createIcons({ el: view.root });
  wire();
}

function wire() {
  // Geteilte Tablist-Grammatik (Klick + Pfeiltasten/Home/End + Roving-Tabindex)


  //


  wireTablist(view.root.querySelector('.budget-stats__ranges'), {
    activeId: view.range,
    activeClass: 'is-active',
    onChange: (id) => view.ctx.onRangeChange(id),
  });
}

function renderBodyContent(body) {


  // buchungsfreie Woche weiter den alten Bereich.
  updatePeriodLabel();


  if (view.error) {
    body.replaceChildren();
    mountLoadError(body, {
      title: t('budget.statsError'),
      description: t('budget.statsErrorDescription'),
      error: view.error,
      retryLabel: t('budget.statsRetry'),
      onRetry: () => loadStats(),
    });
    return;
  }
  const d = view.data;
  if (!d || (d.totals.income === 0 && d.totals.expenses === 0 && !d.series.some((s) => s.income || s.expenses))) {
    body.replaceChildren();
    mountEmptyState(body, {
      icon: 'chart-column',
      title: t('budget.statsEmptyTitle'),
      description: t('budget.statsEmptyDescription'),
    });
    return;
  }
  body.replaceChildren();
  body.insertAdjacentHTML('beforeend', `
    <div class="metric-grid">
      <div class="metric-card metric-card--income">
        <div class="metric-card__label">${t('budget.statsIncome')}</div>
        <div class="metric-card__value">${fmtAmount(d.totals.income)}</div>
      </div>
      <div class="metric-card metric-card--expenses">
        <div class="metric-card__label">${t('budget.statsExpenses')}</div>
        <div class="metric-card__value">${fmtAmount(Math.abs(d.totals.expenses))}</div>
      </div>
      <div class="metric-card ${d.totals.balance >= 0 ? 'metric-card--balance-positive' : 'metric-card--balance-negative'}">
        <div class="metric-card__label">${t('budget.statsBalance')}</div>
        <div class="metric-card__value">${fmtAmount(d.totals.balance)}</div>
      </div>
    </div>
    <div id="budget-stats-trend"></div>
    <div id="budget-stats-cat"></div>
    <div id="budget-stats-donut"></div>
    <div class="budget-stats__export"></div>
  `);
  renderTrendChart();
  renderCatBars();
  renderDonut();
  renderExport();
}

// Eigene Datenreihen-Palette (tokens.css) statt geborgter Fremdmodul-Akzente:


// DONUT_SEGMENTS begrenzt, damit sich keine zwei Segmente dieselbe Farbe teilen.
const DONUT_COLORS = [
  'var(--chart-series-1)', 'var(--chart-series-2)', 'var(--chart-series-3)',
  'var(--chart-series-4)', 'var(--chart-series-5)', 'var(--chart-series-6)',
  'var(--chart-series-7)',
];
const DONUT_SEGMENTS = DONUT_COLORS.length;

function renderCatBars() {
  const host = view.root.querySelector('#budget-stats-cat');
  const cats = view.data.byCategory.filter((c) => c.total !== 0);
  if (!host || !cats.length) return;
  const maxAbs = Math.max(...cats.map((c) => Math.abs(c.total)), 1);


  const plans = view.data.range === 'month' ? (view.data.plans || {}) : {};
  const rows = cats.map((c) => {
    const isExp = c.total < 0;




    const scale = Math.abs(c.total) / maxAbs;
    const target = isExp ? plans[c.category] : undefined;
    const targetPos = target != null ? Math.min(1, target / maxAbs) : null;
    const targetMarker = targetPos != null
      ? `<div class="budget-bar-row__target" style="--target-pos:${targetPos.toFixed(4)}"
             title="${t('budget.planTarget', { amount: view.ctx.formatAmount(target) })}"></div>`
      : '';
    const catLabel = view.ctx.esc(view.ctx.categoryLabel(c.category));


    return `
      <div class="budget-bar-row budget-bar-row--mirrored">
        <div class="budget-bar-row__label" title="${catLabel}">${catLabel}</div>
        <div class="budget-bar-row__track">
          <div class="budget-bar-row__fill ${isExp ? 'budget-bar-row__fill--expenses' : 'budget-bar-row__fill--income'}"
               style="--bar-scale:${scale.toFixed(4)};--bar-visible:${c.total !== 0 ? 1 : 0}"></div>
          ${targetMarker}
        </div>
        <div class="budget-bar-row__amount" style="color:${isExp ? 'var(--color-danger)' : 'var(--color-success)'};">
          ${isExp ? '' : '+'}${view.ctx.formatAmount(c.total)}
        </div>
      </div>`;
  }).join('');
  host.replaceChildren();
  host.insertAdjacentHTML('beforeend', `
    <div class="budget-chart-section">
      <div class="budget-chart-section__title">${t('budget.statsCategoryTitle')}</div>
      <div class="budget-chart">${rows}</div>
    </div>`);
}




function donutSlices(byCategory) {
  const exp = byCategory
    .filter((c) => c.expenses < 0)
    .map((c) => ({ label: view.ctx.categoryLabel(c.category), value: Math.abs(c.expenses) }))
    .sort((a, b) => b.value - a.value);
  if (exp.length <= DONUT_SEGMENTS) return exp;
  const head = exp.slice(0, DONUT_SEGMENTS - 1);
  const restValue = exp.slice(DONUT_SEGMENTS - 1).reduce((s, e) => s + e.value, 0);
  return [...head, { label: t('budget.statsOtherCategories'), value: restValue }];
}

function renderDonut() {
  const host = view.root.querySelector('#budget-stats-donut');
  const exp = donutSlices(view.data.byCategory);
  const total = exp.reduce((s, e) => s + e.value, 0);
  if (!host || total === 0) return;

  const pctOf = (value) => Math.round((value / total) * 100);
  const C = 2 * Math.PI * 60; // r=60
  let offset = 0;
  const segs = exp.map((e, i) => {
    const frac = e.value / total;
    const seg = `
      <circle r="60" cx="80" cy="80" fill="none" stroke="${DONUT_COLORS[i]}"
        stroke-width="22" stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)" />`;
    offset += frac * C;
    return seg;
  }).join('');


  const legend = exp.map((e, i) => `
    <span class="budget-stats__legend-item">
      <i class="budget-stats__swatch" style="background:${DONUT_COLORS[i]};"></i>
      ${view.ctx.esc(e.label)} · ${fmtAmount(e.value)} · ${pctOf(e.value)}%
    </span>`).join('');
  const summary = t('budget.statsDonutSummary', {
    count: exp.length,
    top: exp[0].label,
    pct: pctOf(exp[0].value),
    total: fmtAmount(total),
  });

  host.replaceChildren();
  host.insertAdjacentHTML('beforeend', `
    <div class="budget-chart-section">
      <div class="budget-chart-section__title">${t('budget.statsDonutTitle')}</div>
      <p class="sr-only">${view.ctx.esc(summary)}</p>
      <div class="budget-stats__donut-wrap">
        <svg viewBox="0 0 160 160" class="budget-stats__donut" aria-hidden="true">${segs}</svg>
        <div class="budget-stats__legend budget-stats__legend--wrap">${legend}</div>
      </div>
    </div>`);
}

function renderExport() {
  const host = view.root.querySelector('.budget-stats__export');
  if (!host) return;
  const { from, to } = view.data;
  host.replaceChildren();
  host.insertAdjacentHTML('beforeend', `
    <a class="btn btn--secondary" href="/api/v1/budget/export?from=${from}&to=${to}${scopeQuery()}">
      <i data-lucide="download" class="icon-md" aria-hidden="true"></i> ${t('budget.statsExport')}
    </a>`);
  if (window.lucide) lucide.createIcons({ el: host });
}

function renderTrendChart() {
  const host = view.root.querySelector('#budget-stats-trend');
  if (!host) return;
  const s = view.data.series;
  const incomes  = s.map((p) => p.income);
  const expenses = s.map((p) => Math.abs(p.expenses));
  const max = Math.max(1, ...incomes, ...expenses);
  const points = (arr) => arr.map((v, i) => `${chartX(i, s.length).toFixed(1)},${chartY(v, 0, max).toFixed(1)}`).join(' ');
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);


  //








  //
  // Zweiter Kanal neben der Farbe (Critique P2): Einnahmen solide, Ausgaben


  // rein visuelle SVG bleibt daher bewusst aria-hidden.
  const summary = t('budget.statsTrendSummary', {
    periods: s.length,
    income: fmtAmount(sum(incomes)),
    expenses: fmtAmount(sum(expenses)),
    peak: fmtAmount(max),
  });





  const hotspots = s.map((p, i) => {
    const label = t('budget.statsPointLabel', {
      period: periodLabel(p.period),
      income: fmtAmount(p.income),
      expenses: fmtAmount(Math.abs(p.expenses)),
    });
    const frac = chartX(i, s.length) / CHART.W;
    return `<button type="button" class="budget-stats__point" data-index="${i}"
              style="--point-x:${frac.toFixed(4)};--point-slots:${s.length}"
              tabindex="${i === s.length - 1 ? '0' : '-1'}"
              aria-label="${view.ctx.esc(label)}"></button>`;
  }).join('');

  host.replaceChildren();
  host.insertAdjacentHTML('beforeend', `
    <div class="budget-chart-section">
      <div class="budget-chart-section__title">${t('budget.statsTrendTitle')}</div>
      <p class="sr-only">${view.ctx.esc(summary)}</p>
      <div class="budget-stats__trend-wrap">
        <div class="budget-stats__plot">
          <svg class="budget-stats__trend" viewBox="0 0 ${CHART.W} ${CHART.H}" aria-hidden="true">
            ${chartGridMarkup(0, max, (val) => formatMoneyAxis(val, view.ctx.currency))}
            ${chartXLabelsMarkup(s.map((p) => periodLabel(p.period)))}
            <polyline fill="none" stroke="var(--color-success)" stroke-width="2"
                      vector-effect="non-scaling-stroke" points="${points(incomes)}" />
            <polyline fill="none" stroke="var(--color-danger)" stroke-width="2" stroke-dasharray="6 4"
                      vector-effect="non-scaling-stroke" points="${points(expenses)}" />
          </svg>
          <div class="budget-stats__points" role="group" aria-label="${t('budget.statsPointsLabel')}">${hotspots}</div>
        </div>
      </div>
      <div class="budget-stats__readout" id="budget-stats-readout" aria-hidden="true"></div>
      <div class="budget-stats__legend">
        <span><i class="budget-stats__swatch budget-stats__swatch--income"></i>${t('budget.statsIncome')} · ${fmtAmount(sum(incomes))}</span>
        <span><i class="budget-stats__swatch budget-stats__swatch--expense"></i>${t('budget.statsExpenses')} · ${fmtAmount(sum(expenses))}</span>
      </div>
    </div>`);
  wireTrendPoints(host, s);
}


function periodLabel(period) {
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    return new Intl.DateTimeFormat(getLocale(), { month: 'short', year: 'numeric' }).format(new Date(y, m - 1, 1));
  }
  return formatDate(period);
}





function wireTrendPoints(host, series) {
  const group = host.querySelector('.budget-stats__points');
  const readout = host.querySelector('#budget-stats-readout');
  if (!group || !readout) return;
  const buttons = [...group.querySelectorAll('.budget-stats__point')];
  if (!buttons.length) return;

  const show = (index, { focus = false } = {}) => {
    const point = series[index];
    if (!point) return;
    buttons.forEach((b, i) => {
      b.classList.toggle('is-active', i === index);
      b.tabIndex = i === index ? 0 : -1;
    });
    readout.textContent = t('budget.statsPointLabel', {
      period: periodLabel(point.period),
      income: fmtAmount(point.income),
      expenses: fmtAmount(Math.abs(point.expenses)),
    });
    if (focus) buttons[index].focus();
  };

  group.addEventListener('focusin', (e) => {
    const btn = e.target.closest('.budget-stats__point');
    if (btn) show(Number(btn.dataset.index));
  });
  group.addEventListener('pointerover', (e) => {
    const btn = e.target.closest('.budget-stats__point');
    if (btn) show(Number(btn.dataset.index));
  });
  group.addEventListener('keydown', (e) => {
    const current = buttons.findIndex((b) => b.tabIndex === 0);
    let next = current;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else return;
    e.preventDefault();
    show(next, { focus: true });
  });




  let initial = series.length - 1;
  while (initial > 0 && !series[initial].income && !series[initial].expenses) initial--;
  show(initial);
}



function updatePeriodLabel() {
  if (view.data) view.ctx.onPeriod({ from: view.data.from, to: view.data.to });
}
