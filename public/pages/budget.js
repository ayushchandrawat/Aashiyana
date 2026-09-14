
import { api } from '/api.js';
import { openModal as openSharedModal, closeModal, confirmOverModal, advancedSection, wireBlurValidation, reportFieldError, refocusAfterRender } from '/components/modal.js';
import { renderDocumentAttachField, bindDocumentAttachField } from '/components/document-attach.js';
import { stagger, vibrate, scheduleUndoableDelete } from '/utils/ux.js';
import { wireTablist } from '/utils/tablist.js';
import { t, formatDate, formatDayMonth, getLocale, getNumberFormat } from '/i18n.js';
import { esc } from '/utils/html.js';
import { renderSkeletonList } from '/utils/skeleton.js';
import { render as renderSplitExpenses, prefillSplitExpense } from '/pages/split-expenses.js';
import { openSubscriptionModal, render as renderSubscriptions } from '/pages/subscriptions.js';
import { renderStats } from '/pages/budget-stats.js';
import { renderPlans } from '/pages/budget-plans.js';
import { toLocalDateKey, parseLocalDateKey, addLocalDays,
         monthPeriodKeys, defaultDateInPeriod,
        todayKey} from '/utils/date.js';
import { formatMoney, formatSignedAmount, amountPlaceholder, amountStep, amountMin, applyAmountFormat, amountIsSavable, smallestUnitLabel } from '/utils/money.js';
import { budgetCategoryLabel } from '/utils/category-labels.js';
import { trendMarkup } from '/utils/metric-card.js';
import { intervalUnitLabel } from '/rrule-ui.js';
import { appendCurrencyOptions } from '/settings/currency.js';
import '/components/category-manager.js';
import { findPageFab } from '/utils/fab.js';
import { emptyStateHTML, mountLoadError } from '/utils/empty-state.js';
import { attachOverlay } from '/utils/overlay-history.js';
import { renderUserMultiSelect, getSelectedUserIds, bindUserMultiSelect, renderAvatarStack } from '/components/user-multi-select.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------



// Reine Client-Ansicht (kein Server-Pref), analog zu documents-view/Kalender-Layern.
const EXPENSES_ONLY_KEY = 'aashiyana-budget-expenses-only';


const GROUP_RESPONSIBLE_KEY = 'aashiyana:budget:group-responsible';

const SUBCATEGORY_I18N = () => ({
  rent_mortgage:            t('budget.subcatRentMortgage'),
  condominium:              t('budget.subcatCondominium'),
  utilities:                t('budget.subcatUtilities'),
  internet_tv_phone:        t('budget.subcatInternetTvPhone'),
  renovation_maintenance:   t('budget.subcatRenovationMaintenance'),
  cleaning:                 t('budget.subcatCleaning'),
  groceries:                t('budget.subcatGroceries'),
  restaurants_bars:         t('budget.subcatRestaurantsBars'),
  snacks_fast_food:         t('budget.subcatSnacksFastFood'),
  bakery:                   t('budget.subcatBakery'),
  fuel:                     t('budget.subcatFuel'),
  parking_tolls:            t('budget.subcatParkingTolls'),
  public_transport:         t('budget.subcatPublicTransport'),
  apps_taxi:                t('budget.subcatAppsTaxi'),
  maintenance_insurance:    t('budget.subcatMaintenanceInsurance'),
  pharmacy:                 t('budget.subcatPharmacy'),
  health_insurance:         t('budget.subcatHealthInsurance'),
  gym_sports:               t('budget.subcatGymSports'),
  beauty_cosmetics:         t('budget.subcatBeautyCosmetics'),
  travel:                   t('budget.subcatTravel'),
  streaming:                t('budget.subcatStreaming'),
  events:                   t('budget.subcatEvents'),
  hobbies:                  t('budget.subcatHobbies'),
  clothes_shoes:            t('budget.subcatClothesShoes'),
  electronics:              t('budget.subcatElectronics'),
  gifts:                    t('budget.subcatGifts'),
  courses_college:          t('budget.subcatCoursesCollege'),
  school_supplies:          t('budget.subcatSchoolSupplies'),
  languages:                t('budget.subcatLanguages'),
  loans_interest:           t('budget.subcatLoansInterest'),
  bank_fees:                t('budget.subcatBankFees'),
  insurance_other:          t('budget.subcatInsuranceOther'),
  investments:              t('budget.subcatInvestments'),
  taxes:                    t('budget.subcatTaxes'),
  subscription_entertainment: t('budget.subcatSubscriptionEntertainment'),
  subscription_productivity:  t('budget.subcatSubscriptionProductivity'),
  subscription_utilities:     t('budget.subcatSubscriptionUtilities'),
  subscription_health:        t('budget.subcatSubscriptionHealth'),
  subscription_education:     t('budget.subcatSubscriptionEducation'),
  subscription_other:         t('budget.subcatSubscriptionOther'),
});

const MASKED_CATEGORY = '__private__';

const VISIBILITY_LEVELS = ['private', 'shared_amount', 'shared'];

function categoryLabel(category) {



  if (category === MASKED_CATEGORY) return t('budget.maskedCategory');
  const item = typeof category === 'object'
    ? category
    : [...expenseCategories(), ...incomeCategories()].find((c) => c.key === category);
  const key = item?.key ?? category;
  const name = item?.name ?? category;
  return budgetCategoryLabel(key, name, t);
}

function subcategoryLabel(subcategory) {
  const item = typeof subcategory === 'object'
    ? subcategory
    : Object.values(state.meta.subcategories ?? {}).flat().find((s) => s.key === subcategory);
  const key = item?.key ?? subcategory;
  const name = item?.name ?? subcategory;
  return SUBCATEGORY_I18N()[key] ?? name;
}

function expenseCategories() {
  return state.meta.expenseCategories ?? [];
}

function incomeCategories() {
  return state.meta.incomeCategories ?? [];
}

function getSubcategories(category) {
  return state.meta.subcategories?.[category] || [];
}

function defaultSubcategory(category) {
  return getSubcategories(category)[0]?.key || '';
}

function defaultCategory(type) {
  const cats = type === 'income' ? incomeCategories() : expenseCategories();
  return cats[0]?.key || '';
}

function getMonthName(monthIndex) {
  // monthIndex: 0-based (0=Januar, 11=Dezember)
  const date = new Date(2000, monthIndex, 1);
  return new Intl.DateTimeFormat(getLocale(), { month: 'long' }).format(date);
}

// --------------------------------------------------------
// Konten (#495)
// --------------------------------------------------------


const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'credit', 'investment', 'other'];
const ACCOUNT_TYPE_ICONS = {
  checking:   'landmark',
  savings:    'piggy-bank',
  cash:       'wallet',
  credit:     'credit-card',
  investment: 'trending-up',
  other:      'circle-dollar-sign',
};



// nirgends Hex-Literale im JS stehen. Leerer Wert = Modul-Akzent (Teal).


const ACCOUNT_COLORS = [
  { value: 'var(--chart-series-2)', nameKey: 'budget.colorTeal' },
  { value: 'var(--chart-series-4)', nameKey: 'budget.colorBlue' },
  { value: 'var(--chart-series-1)', nameKey: 'budget.colorViolet' },
  { value: 'var(--chart-series-6)', nameKey: 'budget.colorMagenta' },
  { value: 'var(--chart-series-3)', nameKey: 'budget.colorOrange' },
  { value: 'var(--chart-series-7)', nameKey: 'budget.colorGreen' },
  { value: 'var(--chart-series-5)', nameKey: 'budget.colorOcher' },
];

function accountTypeLabel(type) {
  return t(`budget.accountType_${ACCOUNT_TYPES.includes(type) ? type : 'other'}`);
}


function accountAccent(color) {
  return esc(color) || 'var(--module-accent)';
}

function accountName(id) {
  if (id == null) return '';
  return state.accounts.find((a) => a.id === id)?.name || '';
}

// --------------------------------------------------------
// State
// --------------------------------------------------------

let state = {
  month:       '',   // YYYY-MM
  entries:     [],

  // `mountLoadError` liest daraus den Statuscode.
  loadError:   null,
  summary:     null,
  prevSummary: null,
  loans:       { loans: [], summary: { active_count: 0, remaining_amount: 0, remaining_installments: 0 } },
  accounts:    [],
  netWorth:    0,
  accountFilterId: null,
  accountsShowArchived: false,
  activeTab:   'budget',
  loanFilterId: null,
  loanStatusFilter: 'active',
  currency:    'EUR',
  budgetMode:  'shared',      // 'shared' (Altverhalten) | 'personal' (#476/#505)
  members:     [],            // Haushaltsmitglieder fuer den Zustaendigen-Picker (#1057)
  responsibleFilterId: null,  // aktiver Zustaendigen-Filter der Liste (#1057)
  groupByResponsible: false,  // Liste nach Zustaendigem gruppieren (#1057)
  scope:       'mine',        // Ansichts-Filter im personal-Modus: 'mine' | 'household'
  expensesOnly: false,        // Anzeige „Nur Ausgaben" (#504): Einnahmen+Saldo ausblenden
  meta:        { expenseCategories: [], incomeCategories: [], subcategories: {} },



  range:        'month',      // 'week' | 'month' | 'year'
  reportAnchor: todayKey(),
  reportPeriod: '',
};
let _container = null;
let _user = null;
let _tablist = null;   // wireTablist-Handle: erlaubt programmatische Tab-Wechsel (sync)
let _scopeTablist = null;






//



// Monat noch gilt (Critique 2026-07-30, P1).
//




const TAB_CAPS = {
  'budget':         { month: true,  add: 'budget.newEntryFabLabel' },
  'plan':           { month: true,  add: 'budget.planAddBudget' },
  'accounts':       { month: false, note: 'budget.periodNoteAccounts',      add: 'budget.addAccount' },
  'subscriptions':  { month: false, note: 'budget.periodNoteSubscriptions', add: 'subscriptions.add' },
  'loans':          { month: false, note: 'budget.periodNoteLoans',         add: 'budget.newLoan' },
  'reports':        { month: true,  range: true, add: null },
  // `add: null` wie Berichte: Split-Ausgaben bringt seine eigene Primaeraktion




  // der Unterseite VIER Ausloeser fuer dieselbe Handlung (Cross-Modul-Review:


  // Budgets generische Knoepfe, weil sie keinen eigenen mitbringen.
  'split-expenses': { month: false, note: 'budget.periodNoteSplit',         add: null },
};



const DEFAULT_COLOR_ID = 'default';

function tabCaps() {
  if (_user?.access_scope === 'split_guest') return TAB_CAPS['split-expenses'];
  return TAB_CAPS[state.activeTab] ?? TAB_CAPS.budget;
}

// --------------------------------------------------------
// Formatierung
// --------------------------------------------------------





function formatAmount(n, currency = state.currency) {
  return formatMoney(n, currency);
}



function amountByRole(n, role, { currency = state.currency, tone, block } = {}) {
  return formatSignedAmount(n, { currency, role, tone, block });
}


function formatLoanAmount(n, loan) {
  return formatAmount(n, loan?.currency || state.currency);
}



function loanBudgetEquivalent(n, loan) {
  if (!loan?.is_foreign_currency) return '';
  return t('budget.loanConvertedAmount', { amount: formatAmount(Number(n || 0) * Number(loan.exchange_rate || 1)) });
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${getMonthName(parseInt(m, 10) - 1)} ${y}`;
}

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}




function currentMonth() {
  return todayKey().slice(0, 7);
}




function anchorForMonth(ym) {
  return ym === currentMonth() ? todayKey() : `${ym}-01`;
}


function stepAnchor(anchor, range, dir) {
  if (range === 'week') return addLocalDays(anchor, 7 * dir);
  const d = parseLocalDateKey(anchor);
  if (range === 'month') d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  return toLocalDateKey(d);
}






function reportPeriodLabel() {
  if (state.range === 'year') return String(parseLocalDateKey(state.reportAnchor).getFullYear());
  if (state.range === 'month') return formatMonthLabel(state.reportAnchor.slice(0, 7));
  return state.reportPeriod;
}

function setHtml(element, html) {
  element.replaceChildren();
  element.insertAdjacentHTML('afterbegin', html);
}

// --------------------------------------------------------
// API
// --------------------------------------------------------

async function loadMonth(month) {
  const prevMonth = addMonths(month, -1);

  const accountQuery = state.accountFilterId ? `&account_id=${state.accountFilterId}` : '';

  const scopeQuery = state.budgetMode === 'personal' ? `&scope=${state.scope}` : '';
  try {
    const [entriesRes, summaryRes, prevSummaryRes, loansRes] = await Promise.all([
      api.get(`/budget?month=${month}${accountQuery}${scopeQuery}`),
      api.get(`/budget/summary?month=${month}${scopeQuery}`),
      api.get(`/budget/summary?month=${prevMonth}${scopeQuery}`),
      api.get('/budget/loans'),
    ]);
    state.loadError   = null;
    state.month       = month;
    state.entries     = entriesRes.data;
    state.summary     = summaryRes.data;
    state.prevSummary = prevSummaryRes.data;
    state.loans       = loansRes.data;
  } catch (err) {
    console.error('[Budget] loadMonth Fehler:', err);





    state.loadError   = err;
    state.month       = month;
    state.entries     = [];
    state.summary     = { income: 0, expenses: 0, balance: 0, byCategory: [] };
    state.prevSummary = null;
    state.loans       = { loans: [], summary: { active_count: 0, remaining_amount: 0, remaining_installments: 0 } };
  }
}

async function loadAccounts() {
  try {


    // den optionalen „Archivierte anzeigen"-Modus. net_worth ignoriert archivierte
    // serverseitig; die Kachel-Liste filtert clientseitig.
    const res = await api.get('/budget/accounts?include_archived=1');
    state.accounts = res.data?.accounts ?? [];
    state.netWorth = res.data?.net_worth ?? 0;
  } catch (err) {
    console.error('[Budget] loadAccounts Fehler:', err);
  }
}

async function loadBudgetMeta() {
  try {
    const res = await api.get('/budget/meta');
    state.meta = {
      expenseCategories: res.data?.expenseCategories ?? [],
      incomeCategories: res.data?.incomeCategories ?? [],
      subcategories: res.data?.subcategories ?? {},
    };
  } catch (err) {
    console.error('[Budget] meta Fehler:', err);
    state.meta = { expenseCategories: [], incomeCategories: [], subcategories: {} };
    window.aashiyana?.showToast(t('budget.metaLoadError'), 'danger');
  }
}

// --------------------------------------------------------
// Entry Point
// --------------------------------------------------------

export async function render(container, { user }) {
  _container = container;
  _user = user;
  state.month = currentMonth();




  state.accountFilterId = null;
  state.loanFilterId = null;
  state.loanStatusFilter = 'active';
  state.accountsShowArchived = false;
  if (user?.access_scope === 'split_guest') state.activeTab = 'split-expenses';

  if (user?.access_scope !== 'split_guest') {
    try {
      const [prefsRes, usersRes] = await Promise.all([
        api.get('/preferences'),



        api.get('/auth/users').catch(() => ({ data: [] })),
        loadBudgetMeta(),
      ]);
      state.currency = prefsRes.data?.currency ?? 'EUR';
      state.budgetMode = prefsRes.data?.budget_mode === 'personal' ? 'personal' : 'shared';
      state.members = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data?.users ?? []);
    } catch (_) { /* Fallback auf EUR */ }
  }
  state.expensesOnly = localStorage.getItem(EXPENSES_ONLY_KEY) === '1';
  state.groupByResponsible = localStorage.getItem(GROUP_RESPONSIBLE_KEY) === '1';

  setHtml(container, `
    <div class="budget-page app-page app-page--reading page-measure--narrow" data-composition="reading">
      <div class="page-toolbar page-toolbar--wrap page-toolbar--narrow budget-nav">
        <h1 class="page-toolbar__title">${t('budget.title')}</h1>
        <!-- Der Kopf-Slot bleibt auf jedem Tab besetzt: entweder Stepper oder
             ein ruhiger Kontexttext. Eine Lücke machte jeden Tabwechsel zur
             Neuorientierung (Critique 2026-07-30, P1). -->
        <div class="page-toolbar__center budget-nav__month">
          <button class="btn btn--icon" id="budget-prev" aria-label="${t('budget.prevMonth')}">
            <i data-lucide="chevron-left" aria-hidden="true"></i>
          </button>
          <span class="budget-nav__label" id="budget-label" aria-live="polite"></span>
          <button class="btn btn--icon" id="budget-next" aria-label="${t('budget.nextMonth')}">
            <i data-lucide="chevron-right" aria-hidden="true"></i>
          </button>
          <!-- „Aktuell" ist ein Reset, kein Navigationsschritt: hinter dem
               Stepper statt zwischen Pfeil und Wert. -->
          <button class="btn btn--secondary budget-nav__today" id="budget-today">${t('budget.currentMonth')}</button>
          <span class="budget-nav__note" id="budget-period-note" hidden></span>
        </div>
        ${state.budgetMode === 'personal' ? `
        <div class="budget-scope" role="tablist" aria-label="${t('budget.scopeLabel')}">
          ${[['mine', t('budget.scopeMine')], ['household', t('budget.scopeHousehold')]].map(([id, label]) => {
            const on = id === state.scope;
            return `<button class="sub-tab${on ? ' sub-tab--active' : ''}" type="button" role="tab" data-tab-id="${id}" aria-selected="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}"><span class="sub-tab__label">${label}</span></button>`;
          }).join('')}
        </div>` : ''}
        <div class="page-toolbar__actions">
          <button class="btn btn--primary toolbar-new-btn" id="budget-add" aria-label="${t('budget.addEntryLabel')}">
            <i data-lucide="plus" aria-hidden="true"></i>
            <span class="toolbar-new-btn__label">${t('newLabel.budget')}</span>
          </button>
        </div>
        <!-- Bar-Zeile des Kopfs (Werkzeugzeilen-Regel): die 7 Tabs teilten sich
             den Actions-Slot mit dem Primaerknopf und hatten bei 1280px 138px
             fuer 606px Inhalt - 1 von 7 Tabs sichtbar. -->
        <div class="budget-tabs page-toolbar__bar" role="tablist" aria-label="${t('budget.tabsLabel')}">
          ${[
            ...(user?.access_scope === 'split_guest' ? [] : [
              ['budget',        t('budget.budgetTab')],
              ['accounts',      t('budget.accountsTab')],
              ['plan',          t('budget.planTab')],
              ['subscriptions', t('subscriptions.tabLabel')],
              ['loans',         t('budget.loansTab')],
              ['reports',       t('budget.reportsTab')],
            ]),
            ['split-expenses',  t('splitExpenses.tabLabel')],
          ].map(([id, label]) => {
            const on = id === state.activeTab;
            return `<button class="sub-tab${on ? ' sub-tab--active' : ''}" id="budget-tab-${id}" type="button" role="tab" data-tab-id="${id}" aria-controls="budget-body" aria-selected="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}"><span class="sub-tab__label">${label}</span></button>`;
          }).join('')}
        </div>
      </div>
      <div id="budget-body" role="tabpanel" tabindex="0" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        ${renderSkeletonList({ rows: 6, lines: 2 })}
      </div>
      <button class="page-fab" id="fab-new-budget" aria-label="${t('budget.newEntryFabLabel')}" data-dock-label="${t('newLabel.budget')}">
        <i data-lucide="plus" class="icon-xl" aria-hidden="true"></i>
      </button>
    </div>
  `);

  if (window.lucide) lucide.createIcons({ el: container });

  if (user?.access_scope !== 'split_guest') {

    // Nachladen pro Monatswechsel). Namensliste versorgt die Transaktions-Meta.
    await Promise.all([loadMonth(state.month), loadAccounts()]);
  } else {
    state.summary = { income: 0, expenses: 0, balance: 0, byCategory: [] };
    state.prevSummary = null;
    state.entries = [];
  }
  renderBody();
  wireNav();
}

// --------------------------------------------------------
// Navigation
// --------------------------------------------------------

function wireNav() {



  const stepPeriod = async (dir) => {
    if (state.activeTab === 'reports') {
      state.reportAnchor = stepAnchor(state.reportAnchor, state.range, dir);
      renderBody();
      return;
    }
    await loadMonth(addMonths(state.month, dir));
    renderBody();
    updateLabel();
  };
  _container.querySelector('#budget-prev').addEventListener('click', () => stepPeriod(-1));
  _container.querySelector('#budget-next').addEventListener('click', () => stepPeriod(1));
  _container.querySelector('#budget-today').addEventListener('click', async () => {
    if (state.activeTab === 'reports') {
      const today = todayKey();
      if (today === state.reportAnchor) return;
      state.reportAnchor = today;
      renderBody();
      return;
    }
    const m = currentMonth();
    if (m === state.month) return;
    await loadMonth(m);
    renderBody();
    updateLabel();
  });



  _scopeTablist = wireTablist(_container.querySelector('.budget-scope'), {
    activeId: state.scope,
    onChange: async (id) => {
      state.scope = id;
      await loadMonth(state.month);
      renderBody();
    },
  });
  // Neu-Aktion je Tab — spiegelt TAB_CAPS.add. Tabs ohne Neu-Aktion (Berichte,


  const addHandler = () => {
    switch (state.activeTab) {
      case 'subscriptions':  openSubscriptionModal(); return;
      case 'plan':           _container.querySelector('#budget-plan-add')?.click(); return;
      case 'accounts':       openAccountModal(); return;
      case 'loans':          openLoanModal(); return;
      case 'reports':        return;
      default:               openBudgetModal({ mode: 'create' });
    }
  };
  _container.querySelector('#budget-add').addEventListener('click', addHandler);
  findPageFab('fab-new-budget').addEventListener('click', addHandler);
  // Geteilte Tablist-Verhaltensschicht (Klick + Pfeiltasten/Home/End + Roving-

  // modul-eigenen Nachbildung (utils/tablist.js). wireTablist malt den aktiven

  _tablist = wireTablist(_container.querySelector('.budget-tabs'), {
    activeId: state.activeTab,
    onChange: async (id) => {
      const prev = state.activeTab;
      state.activeTab = id;



      // weiter als Juli erschien (Critique 2026-07-30, P1).
      if (id === 'reports' && prev !== 'reports') {
        state.reportAnchor = anchorForMonth(state.month);
      }
      renderBody();
      if (prev === 'reports' && id !== 'reports') {
        const ym = state.reportAnchor.slice(0, 7);
        if (ym !== state.month) {
          await loadMonth(ym);
          if (state.activeTab === id) renderBody();
        }
      }
    },
  });


  updateLabel();
}




function refocusSegmented(barSelector) {
  _container.querySelector(`${barSelector} .segmented__item.is-active`)?.focus();
}

function updateLabel() {
  const lbl = _container.querySelector('#budget-label');
  if (lbl) lbl.textContent = state.activeTab === 'reports' ? reportPeriodLabel() : formatMonthLabel(state.month);
}

// --------------------------------------------------------
// Body
// --------------------------------------------------------

function renderBody() {
  const body = _container.querySelector('#budget-body');
  if (!body) return;
  updateLabel();




  if (state.loadError) {
    updateTabs();
    setHtml(body, '<div class="budget-tab-panel page-scrollport" id="budget-error-panel"></div>');
    mountLoadError(body.querySelector('#budget-error-panel'), {
      title: t('budget.loadError'),
      description: t('common.loadErrorDescription'),
      error: state.loadError,
      retryLabel: t('common.retry'),
      onRetry: async () => { await loadMonth(state.month); renderBody(); },
    });
    return;
  }

  const s    = state.summary;
  const p    = state.prevSummary;
  updateTabs();
  if (state.activeTab === 'reports') {
    setHtml(body, '<div class="budget-tab-panel page-scrollport budget-tab-panel--reports" id="budget-reports-panel"></div>');
    renderStats(body.querySelector('#budget-reports-panel'), {
      user: _user, currency: state.currency,
      budgetMode: state.budgetMode, scope: state.scope,
      formatAmount, categoryLabel, esc,


      range: state.range,
      anchor: state.reportAnchor,
      onRangeChange: (r) => {
        state.range = r;
        renderBody();
        refocusSegmented('.budget-stats__ranges');
      },


      onPeriod: ({ from, to }) => {
        state.reportPeriod = `${formatDate(from)} – ${formatDate(to)}`;
        if (state.activeTab === 'reports' && state.range === 'week') updateLabel();
      },
    }).catch((err) => console.error('[Budget] stats render error:', err));
    return;
  }
  if (state.activeTab === 'plan') {
    setHtml(body, '<div class="budget-tab-panel page-scrollport budget-tab-panel--reading budget-tab-panel--plan" id="budget-plan-panel"></div>');
    renderPlans(body.querySelector('#budget-plan-panel'), {
      user: _user, currency: state.currency, month: state.month,
      formatAmount, categoryLabel, esc,
      expenseCategories: expenseCategories(),
    }).catch((err) => console.error('[Budget] plans render error:', err));
    return;
  }
  if (state.activeTab === 'loans') {
    setHtml(body, renderLoansPage());
    wireLoansPage();
    if (window.lucide) lucide.createIcons({ el: body });
    return;
  }
  if (state.activeTab === 'accounts') {
    const paint = () => {
      setHtml(body, renderAccountsPage());
      wireAccountsPage();
      if (window.lucide) lucide.createIcons({ el: body });
    };
    paint();

    loadAccounts().then(() => { if (state.activeTab === 'accounts') paint(); });
    return;
  }
  if (state.activeTab === 'subscriptions') {
    setHtml(body, '<div class="budget-tab-panel page-scrollport budget-tab-panel--subscriptions" id="budget-subscriptions-panel"></div>');
    renderSubscriptions(body.querySelector('#budget-subscriptions-panel'), { user: _user }).catch((err) => {
      console.error('[Budget] subscriptions render error:', err);
    });
    return;
  }
  if (state.activeTab === 'split-expenses') {
    setHtml(body, '<div class="budget-tab-panel page-scrollport budget-tab-panel--split-expenses" id="budget-split-expenses-panel"></div>');
    const panel = body.querySelector('#budget-split-expenses-panel');




    const loadSplitExpenses = () => renderSplitExpenses(panel, { embedded: true, user: _user })
      .catch((err) => {
        console.error('[Budget] split expenses render error:', err);
        mountLoadError(panel, {
          title: t('splitExpenses.loadError'),
          description: t('common.loadErrorDescription'),
          error: err,
          retryLabel: t('common.retry'),
          onRetry: loadSplitExpenses,
        });
      });
    loadSplitExpenses();
    return;
  }






  const balanceNeutral = s.income === 0 && s.balance < 0;
  const balanceClass = balanceNeutral
    ? 'metric-card--balance-neutral'
    : s.balance >= 0
      ? 'metric-card--balance-positive'
      : 'metric-card--balance-negative';
  const prevLabel = p ? formatMonthLabel(p.month).split(' ')[0].slice(0, 3) : '';





  const pendingTotal = (s.pending?.income || 0) + (s.pending?.expenses || 0);
  const pendingNote = s.pending?.count
    ? `<p class="budget-pending-note">
         <i data-lucide="clock" class="icon-sm" aria-hidden="true"></i>
         <span>${esc(t('budget.pendingSummary', {
           count: s.pending.count,
           amount: amountByRole(pendingTotal, 'flow').text,
         }))}</span>
       </p>`
    : '';





  const expensesOnly = state.expensesOnly;



  const incomeCard = `
      <div class="metric-card metric-card--income">
        <div class="metric-card__label">${t('budget.income')}</div>
        <div class="metric-card__value">${amountByRole(s.income, 'total').text}</div>
        ${p ? renderTrend(s.income, p.income, prevLabel, 'higher') : ''}
      </div>`;



  const expensesCard = `
      <div class="metric-card metric-card--expenses">
        <div class="metric-card__label">${t('budget.expenses')}</div>
        <div class="metric-card__value">${amountByRole(s.expenses, 'total').text}</div>
        ${p ? renderTrend(Math.abs(s.expenses), Math.abs(p.expenses), prevLabel, 'lower') : ''}
      </div>`;

  const balanceCard = `
      <div class="metric-card ${balanceClass}">
        <div class="metric-card__label">${t('budget.balance')}</div>
        <div class="metric-card__value">${amountByRole(s.balance, 'balance').text}</div>
        ${p && !balanceNeutral ? renderTrend(s.balance, p.balance, prevLabel, 'higher') : ''}
      </div>`;

  setHtml(body, `
    <div class="budget-tab-panel page-scrollport budget-tab-panel--budget">
    <!-- Anzeige-Umschalter: nur Ausgaben vs. volle Zusammenfassung -->
    <div class="budget-summary-bar">
      <button class="budget-expenses-toggle${expensesOnly ? ' budget-expenses-toggle--active' : ''}"
              id="budget-expenses-only" type="button" role="switch"
              aria-checked="${expensesOnly ? 'true' : 'false'}"
              title="${t('budget.expensesOnlyHint')}">
        <i data-lucide="receipt" class="icon-sm" aria-hidden="true"></i>
        <span>${t('budget.expensesOnly')}</span>
      </button>
    </div>
    <!-- Zusammenfassung -->
    <div class="metric-grid${expensesOnly ? ' metric-grid--expenses-only' : ''}">
      ${expensesOnly ? expensesCard : incomeCard + expensesCard + balanceCard}
    </div>
    ${pendingNote}

    <!-- Kategorie-Balken -->
    ${s.byCategory.length ? `
    <div class="budget-chart-section">
      <div class="budget-chart-section__title u-section-title">${t('budget.byCategory')}</div>
      <p class="sr-only">${esc(chartSummary(s.byCategory))}</p>
      <div class="budget-chart">
        ${renderCategoryBars(s.byCategory)}
      </div>
    </div>` : ''}

    <!-- Transaktionsliste -->
    <div class="budget-list-section">
      <div class="budget-list-header">
        <div>
          <span class="budget-list-header__title u-section-title">${t('budget.transactions')}</span>
          ${state.accountFilterId ? `
          <button class="budget-account-chip" id="budget-clear-account-filter" type="button"
                  aria-label="${t('budget.clearAccountFilter')}">
            <i data-lucide="wallet" class="icon-sm" aria-hidden="true"></i>
            <span>${esc(accountName(state.accountFilterId))}</span>
            <i data-lucide="x" class="icon-sm" aria-hidden="true"></i>
          </button>` : ''}
          ${state.responsibleFilterId != null ? `
          <button class="budget-account-chip" id="budget-clear-responsible-filter" type="button"
                  aria-label="${esc(t('budget.clearResponsibleFilter'))}">
            <i data-lucide="user-round" class="icon-sm" aria-hidden="true"></i>
            <span>${esc(state.members.find((u) => u.id === state.responsibleFilterId)?.display_name ?? '')}</span>
            <i data-lucide="x" class="icon-sm" aria-hidden="true"></i>
          </button>` : ''}
        </div>
        <div class="budget-list-header__actions">
        ${state.entries.some((e) => e.responsible_users?.length) ? `
        <button class="btn btn--secondary${state.groupByResponsible ? ' is-active' : ''}" id="budget-group-responsible"
          type="button" aria-pressed="${state.groupByResponsible ? 'true' : 'false'}"
          title="${esc(t('budget.groupByResponsible'))}">
          <i data-lucide="users" class="icon-sm" aria-hidden="true"></i>${esc(t('budget.groupByResponsible'))}
        </button>` : ''}
        <button class="btn btn--secondary budget-manage-categories" id="budget-manage-categories"
          title="${t('budget.manageCategories')}">
          <i data-lucide="tags" class="icon-sm" aria-hidden="true"></i>${t('budget.manageCategories')}
        </button>
        ${state.entries.length ? `
        <a href="/api/v1/budget/export?month=${state.month}${state.budgetMode === 'personal' ? `&scope=${state.scope}` : ''}" class="btn btn--secondary budget-csv-export">
          <i data-lucide="download" class="icon-sm" aria-hidden="true"></i>CSV
        </a>` : ''}
        </div>
      </div>
      <div class="budget-list page-scrollport" id="budget-list">
        ${renderEntries()}
      </div>
    </div>
    </div>
  `);

  if (window.lucide) lucide.createIcons({ el: body });
  _container.querySelector('#empty-cta-budget')?.addEventListener('click', () => {
    document.querySelector('.page-fab')?.click();
  });
  _container.querySelector('#budget-expenses-only')?.addEventListener('click', () => {
    state.expensesOnly = !state.expensesOnly;
    try { localStorage.setItem(EXPENSES_ONLY_KEY, state.expensesOnly ? '1' : '0'); } catch (_) { /* Private-Mode: nur diese Sitzung */ }
    vibrate(10);
    renderBody();
  });
  _container.querySelector('#budget-manage-categories')?.addEventListener('click', openCategoryManager);
  _container.querySelector('#budget-clear-account-filter')?.addEventListener('click', async () => {
    state.accountFilterId = null;
    await loadMonth(state.month);
    renderBody();
  });


  _container.querySelector('#budget-clear-responsible-filter')?.addEventListener('click', () => {
    state.responsibleFilterId = null;
    renderBody();
  });
  _container.querySelector('#budget-group-responsible')?.addEventListener('click', () => {
    state.groupByResponsible = !state.groupByResponsible;
    try { localStorage.setItem(GROUP_RESPONSIBLE_KEY, state.groupByResponsible ? '1' : '0'); } catch (_) { /* Private-Mode */ }
    vibrate(10);
    renderBody();
  });
  stagger(_container.querySelector('#budget-list')?.querySelectorAll('.budget-entry') ?? []);

  _container.querySelector('#budget-list')?.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) { await deleteEntry(parseInt(delBtn.dataset.id, 10)); return; }

    const confirmBtn = e.target.closest('[data-action="confirm"]');
    if (confirmBtn) { await openConfirmBookingModal(parseInt(confirmBtn.dataset.id, 10)); return; }




    const respBtn = e.target.closest('[data-responsible]');
    if (respBtn) {
      const id = parseInt(respBtn.dataset.responsible, 10);
      state.responsibleFilterId = state.responsibleFilterId === id ? null : id;
      renderBody();
      return;
    }

    const item = e.target.closest('.budget-entry[data-id]');
    if (item && !e.target.closest('[data-action]')) {
      const entry = state.entries.find((e) => e.id === parseInt(item.dataset.id, 10));
      if (entry) openBudgetModal({ mode: 'edit', entry });
    }
  });



}

function updateTabs() {
  _container.classList.toggle('budget-page--split-active', state.activeTab === 'split-expenses' || _user?.access_scope === 'split_guest');
  _container.classList.toggle('budget-page--loans-active', state.activeTab === 'loans');
  _container.classList.toggle('budget-page--subscriptions-active', state.activeTab === 'subscriptions');


  const panel = _container.querySelector('#budget-body');
  if (panel) panel.setAttribute('aria-labelledby', `budget-tab-${state.activeTab}`);




  const caps = tabCaps();
  ['#budget-prev', '#budget-next', '#budget-today', '#budget-label'].forEach((selector) => {
    const el = _container.querySelector(selector);
    if (el) el.hidden = !caps.month;
  });


  const note = _container.querySelector('#budget-period-note');
  if (note) {
    note.hidden = !caps.note;
    if (caps.note) note.textContent = t(caps.note);
  }


  // gar nichts (Berichte hat keine Neu-Aktion).
  const addLabel = caps.add ? t(caps.add) : '';
  const addBtn = _container.querySelector('#budget-add');
  if (addBtn) {
    addBtn.hidden = !caps.add;
    if (caps.add) {
      addBtn.setAttribute('aria-label', addLabel);
      addBtn.setAttribute('title', addLabel);
      const labelSpan = addBtn.querySelector('.toolbar-new-btn__label');
      if (labelSpan) labelSpan.hidden = caps.add !== 'budget.newEntryFabLabel';
    }
  }
  const fab = findPageFab('fab-new-budget');
  if (fab) {
    fab.hidden = !caps.add;
    if (caps.add) fab.setAttribute('aria-label', addLabel);
  }
}

// Screenreader-Zusammenfassung des Kategorie-Diagramms (Audit 1.7): Anzahl

// visuellen Balken-Chart ausgegeben.
function chartSummary(byCategory) {
  const total = byCategory.reduce((sum, c) => sum + Math.abs(c.total), 0) || 1;
  const top = byCategory.reduce((a, b) => (Math.abs(b.total) > Math.abs(a.total) ? b : a));
  const pct = Math.round((Math.abs(top.total) / total) * 100);
  return t('budget.chartSummary', {
    count: byCategory.length,
    top: categoryLabel(top.category),
    pct,
  });
}

function renderCategoryBars(byCategory) {
  const maxAbs = Math.max(...byCategory.map((c) => Math.abs(c.total)), 1);

  return byCategory.map((c) => {
    const isExpense = c.total < 0;
    const scale     = Math.abs(c.total) / maxAbs;
    const cls       = isExpense ? 'budget-bar-row__fill--expenses' : 'budget-bar-row__fill--income';



    // Farbton. Jetzt spiegeln beide um eine gemeinsame Mittelachse.
    return `
      <div class="budget-bar-row budget-bar-row--mirrored">
        <div class="budget-bar-row__label" title="${esc(categoryLabel(c.category))}">${esc(categoryLabel(c.category))}</div>
        <div class="budget-bar-row__track">
          <div class="budget-bar-row__fill ${cls}" style="--bar-scale:${scale.toFixed(4)};--bar-visible:${c.total !== 0 ? 1 : 0}"></div>
        </div>
        <div class="budget-bar-row__amount" style="color:${isExpense ? 'var(--color-danger)' : 'var(--color-success)'};">
          ${isExpense ? '' : '+'}${formatAmount(c.total)}
        </div>
      </div>
    `;
  }).join('');
}

function groupEntriesByResponsible(entries) {
  const groups = new Map();
  const unassigned = [];
  for (const e of entries) {
    const people = e.responsible_users ?? [];
    if (!people.length) { unassigned.push(e); continue; }
    for (const person of people) {
      if (!groups.has(person.id)) groups.set(person.id, { person, entries: [] });
      groups.get(person.id).entries.push(e);
    }
  }
  const ordered = [...groups.values()].sort((a, b) =>
    String(a.person.display_name ?? '').localeCompare(String(b.person.display_name ?? '')));
  if (unassigned.length) ordered.push({ person: null, entries: unassigned });
  return ordered;
}

function visibleEntries() {
  if (state.responsibleFilterId == null) return state.entries;
  return state.entries.filter((e) =>
    (e.responsible_users ?? []).some((u) => u.id === state.responsibleFilterId));
}

function renderEntries() {
  if (!state.entries.length) {
    return emptyStateHTML({
      icon: 'dollar-sign',
      title: t('budget.emptyTitle'),
      description: t('budget.emptyDescription'),
      hint: t('emptyHint.budget'),
      action: { label: t('budget.emptyAction'), icon: 'plus', attrs: { id: 'empty-cta-budget' } },
    });
  }

  const rows = visibleEntries();
  if (!rows.length) {


    // der Monat leer.
    return emptyStateHTML({
      icon: 'user-round-x',
      title: t('budget.responsibleFilterEmptyTitle'),
      description: t('budget.responsibleFilterEmptyDescription'),
    });
  }

  if (state.groupByResponsible) {
    return groupEntriesByResponsible(rows).map((group) => `
      <div class="budget-responsible-group">
        <div class="budget-responsible-group__head">
          ${group.person
            ? `${renderAvatarStack([group.person], { size: 20, maxVisible: 1 })}<span>${esc(group.person.display_name ?? '')}</span>`
            : `<span>${esc(t('budget.responsibleNobody'))}</span>`}
          <span class="budget-responsible-group__count">${group.entries.length}</span>
        </div>
        ${entryRows(group.entries)}
      </div>`).join('');
  }

  return entryRows(rows);
}

function entryRows(list) {
  return list.map((e) => {
    const isIncome  = e.amount > 0;
    const amtClass  = isIncome ? 'budget-entry__amount--income' : 'budget-entry__amount--expenses';
    const indClass  = isIncome ? 'budget-entry__indicator--income' : 'budget-entry__indicator--expenses';



    const amountText = amountByRole(e.amount, 'flow').text;
    const date      = formatDayMonth(e.date);
    const recurTag  = e.is_recurring
      ? ` <span class="budget-recur-mark" role="img" aria-label="${t('budget.recurringLabel')}"><i data-lucide="repeat" class="icon-sm" aria-hidden="true"></i></span>${e.recurrence_virtual ? ' ' + t('budget.virtualBudgetBadge') : ''}`
      : (e.recurrence_parent_id ? ` <span class="budget-recur-mark" role="img" aria-label="${t('budget.recurringInstanceLabel')}"><i data-lucide="corner-down-left" class="icon-sm" aria-hidden="true"></i></span>` : '');
    const categoryMeta = categoryLabel(e.category);
    const acctName = accountName(e.account_id);
    const acctMeta = acctName
      ? `<span class="budget-entry__account"> · <i data-lucide="wallet" class="icon-sm" aria-hidden="true"></i>${esc(acctName)}</span>`
      : '';

    const sharedBadge = (state.budgetMode === 'personal' && e.visibility === 'shared')
      ? ` <span class="budget-badge budget-badge--shared">${esc(t('budget.householdBadge'))}</span>`
      : '';





    const masked = !!e.details_hidden;
    const maskedBadge = masked
      ? ` <span class="budget-badge budget-badge--masked">${esc(t('budget.amountOnlyBadge'))}</span>`
      : '';
    const displayTitle = masked ? t('budget.maskedEntryTitle') : e.title;



    const receiptCount = masked ? 0 : (e.attachments?.length ?? 0);
    const receiptMark = receiptCount
      ? ` <span class="budget-recur-mark" role="img" aria-label="${esc(t('budget.receiptsAttachedLabel', { count: receiptCount }))}"><i data-lucide="paperclip" class="icon-sm" aria-hidden="true"></i></span>`
      : '';



    // die Monatsuebersicht falsch.
    const pending = !!e.is_pending;
    const pendingBadge = pending
      ? ` <span class="budget-badge budget-badge--pending">${esc(t('budget.pendingBadge'))}</span>`
      : '';
    const confirmBtn = pending
      ? `<button class="row-action" data-action="confirm" data-id="${e.id}" aria-label="${esc(t('budget.confirmAction'))}: ${esc(e.title)}">
          <i data-lucide="check" class="icon-md" aria-hidden="true"></i>
        </button>`
      : '';

    const rowInteraction = masked ? '' : `data-id="${e.id}"`;
    const titleCell = masked
      ? `<div class="list-row__name budget-entry__title">${esc(displayTitle)}${sharedBadge}${maskedBadge}${pendingBadge}</div>`
      : `<button class="list-row__name budget-entry__title" type="button"
           aria-label="${esc(t('budget.editEntry'))}: ${esc(e.title)}, ${amountText}">${esc(displayTitle)}${sharedBadge}${maskedBadge}${pendingBadge}</button>`;



    // wer sich darum kuemmert, gehoert dazu (#659).
    const responsibleMark = (!masked && (e.responsible_users?.length))
      ? ` · <button type="button" class="budget-responsible-chip" data-responsible="${e.responsible_users[0].id}"
             aria-label="${esc(t('budget.responsibleFilterTo', { name: e.responsible_users[0].display_name ?? '' }))}"
           >${renderAvatarStack(e.responsible_users, { size: 16, maxVisible: 3 })}</button>`
      : '';
    const rowActions = masked ? '' : `
          ${confirmBtn}
          <button class="row-action row-action--danger" data-action="delete" data-id="${e.id}" aria-label="${t('budget.deleteLabel')}">
            <i data-lucide="trash-2" class="icon-md" aria-hidden="true"></i>
          </button>`;

    return `
      <div class="list-row budget-entry${pending ? ' budget-entry--pending' : ''}${masked ? ' budget-entry--masked' : ''}" ${rowInteraction}>
        <div class="budget-entry__indicator ${indClass}"></div>
        <div class="list-row__main">
          ${titleCell}
          <div class="list-row__meta budget-entry__meta">${date} · ${esc(categoryMeta)}${acctMeta}${recurTag}${receiptMark}${responsibleMark}</div>
        </div>
        <div class="budget-entry__amount ${amtClass}">${amountText}</div>
        <div class="list-row__actions">${rowActions}
        </div>
      </div>
    `;
  }).join('');
}

function renderAccountsPage() {
  const all = state.accounts ?? [];
  const hasArchived = all.some((a) => a.archived);
  const visible = all.filter((a) => state.accountsShowArchived || !a.archived);



  const netWorth = amountByRole(state.netWorth, 'balance', { block: 'metric-card' });

  const archiveToggle = hasArchived ? `
      <button class="budget-accounts__toggle" id="budget-toggle-archived" type="button" aria-pressed="${state.accountsShowArchived}">
        <i data-lucide="${state.accountsShowArchived ? 'eye-off' : 'archive'}" class="icon-sm" aria-hidden="true"></i>
        ${state.accountsShowArchived ? t('budget.hideArchivedAccounts') : t('budget.showArchivedAccounts')}
      </button>` : '';




  const header = `
    <div class="panel-head">
      <span class="panel-head__title">${t('budget.accountsTab')}</span>
      <div class="panel-head__actions">
        ${archiveToggle}
        <button class="btn btn--secondary" id="budget-add-account" type="button">
          <i data-lucide="plus" class="icon-sm" aria-hidden="true"></i>${t('budget.addAccount')}
        </button>
      </div>
    </div>
    <div class="metric-grid">
      <div class="metric-card ${netWorth.className}">
        <div class="metric-card__label">${t('budget.netWorth')}</div>
        <div class="metric-card__value">${netWorth.text}</div>
      </div>
    </div>`;

  if (!all.length) {
    return `
      <div class="budget-tab-panel page-scrollport budget-tab-panel--accounts">
        ${header}
        ${emptyStateHTML({
    icon: 'wallet',
    title: t('budget.accountsEmptyTitle'),
    description: t('budget.accountsEmptyDescription'),
    action: { label: t('budget.addAccount'), icon: 'plus', attrs: { id: 'budget-add-account-empty' } },
  })}
      </div>`;
  }

  const cards = visible.map((a) => {
    const balClass = a.current_balance >= 0 ? 'budget-account__balance--positive' : 'budget-account__balance--negative';
    const icon = ACCOUNT_TYPE_ICONS[a.type] || ACCOUNT_TYPE_ICONS.other;
    const archivedBadge = a.archived
      ? `<span class="budget-account__badge">${t('budget.archivedBadge')}</span>`
      : '';


    const creditMeta = a.type === 'credit' && (a.credit_bank || a.available_limit != null)
      ? `<span class="budget-account__meta">${[
          a.credit_bank ? esc(a.credit_bank) : '',
          a.available_limit != null ? `${t('budget.availableLimitShort')} ${formatAmount(a.available_limit)}` : '',
        ].filter(Boolean).join(' · ')}</span>`
      : '';
    return `
      <div class="budget-account ${a.archived ? 'budget-account--archived' : ''}" style="--account-accent:${accountAccent(a.color)}">
        <button class="budget-account__main" type="button" data-drill="${a.id}"
                aria-label="${t('budget.viewAccountTransactions', { name: a.name })} · ${t('budget.currentBalance')} ${formatAmount(a.current_balance)}">
          <span class="budget-account__icon"><i data-lucide="${icon}" class="icon-md" aria-hidden="true"></i></span>
          <span class="budget-account__body">
            <span class="budget-account__name"><span class="budget-account__name-text">${esc(a.name)}</span>${archivedBadge}</span>
            <span class="budget-account__type">${esc(accountTypeLabel(a.type))}</span>
            ${creditMeta}
          </span>
          <span class="budget-account__figures">
            <span class="budget-account__balance ${balClass}">${formatAmount(a.current_balance)}</span>
            <span class="budget-account__starting">${t('budget.startingBalanceShort')} ${formatAmount(a.starting_balance)}</span>
          </span>
        </button>
        <button class="budget-account__edit" type="button" data-edit="${a.id}" aria-label="${t('budget.editAccount')}">
          <i data-lucide="pencil" class="icon-sm" aria-hidden="true"></i>
        </button>
      </div>`;
  }).join('');

  return `
    <div class="budget-tab-panel page-scrollport budget-tab-panel--accounts">
      ${header}
      <div class="budget-accounts__list">${cards}</div>
    </div>`;
}

function wireAccountsPage() {
  _container.querySelector('#budget-add-account')?.addEventListener('click', () => openAccountModal());
  _container.querySelector('#budget-add-account-empty')?.addEventListener('click', () => openAccountModal());
  _container.querySelector('#budget-toggle-archived')?.addEventListener('click', () => {
    state.accountsShowArchived = !state.accountsShowArchived;
    renderBody();
  });

  _container.querySelectorAll('.budget-account__main[data-drill]').forEach((el) => {
    el.addEventListener('click', async () => {
      state.accountFilterId = parseInt(el.dataset.drill, 10);
      state.activeTab = 'budget';


      _tablist?.sync('budget');
      await loadMonth(state.month);
      renderBody();



      _container.querySelector('#budget-body')?.focus();
    });
  });
  _container.querySelectorAll('.budget-account__edit[data-edit]').forEach((el) => {
    el.addEventListener('click', () => {
      const account = state.accounts.find((a) => a.id === parseInt(el.dataset.edit, 10));
      if (account) openAccountModal(account);
    });
  });
}

function openAccountModal(account = null) {
  const isEdit = !!account;




  const accountCurrency = account?.currency || state.currency;
  const typeOpts = ACCOUNT_TYPES.map((key) =>
    `<option value="${key}" ${isEdit && account.type === key ? 'selected' : ''}>${esc(accountTypeLabel(key))}</option>`
  ).join('');

  const currentColor = isEdit ? (account.color || '') : '';
  const activeType = isEdit ? account.type : 'checking';

  // geteilte Verhaltensschicht statt role="group" mit eigenem Klick-Handler.


  const swatch = (value, styleColor, label) => {
    const on = currentColor === value;
    return `<button type="button" role="radio" class="budget-color-swatch${on ? ' is-active' : ''}"
             data-tab-id="${esc(value || DEFAULT_COLOR_ID)}" style="--swatch:${esc(styleColor)}"
             aria-label="${esc(label)}" aria-checked="${on}" tabindex="${on ? '0' : '-1'}"></button>`;
  };
  const colorSwatches = swatch('', 'var(--module-accent)', t('budget.accountColorDefault'))
    + ACCOUNT_COLORS.map((c) => swatch(c.value, c.value, t(c.nameKey))).join('');

  const content = `
    <div class="form-group">
      <label class="form-label" for="am-name">${t('budget.accountNameLabel')}<span class="required-marker" aria-hidden="true"> *</span></label>
      <input type="text" class="form-input" id="am-name" maxlength="100"
             placeholder="${t('budget.accountNamePlaceholder')}" value="${esc(isEdit ? account.name : '')}">
    </div>
    <div class="form-group">
      <label class="form-label" for="am-type">${t('budget.accountTypeLabel')}</label>
      <select class="form-input" id="am-type">${typeOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label" for="am-balance">${t('budget.startingBalanceLabel')}</label>
      <input type="number" class="form-input" id="am-balance"
             step="${amountStep(accountCurrency, isEdit ? account.starting_balance : '')}" inputmode="decimal"
             placeholder="${amountPlaceholder(accountCurrency)}" value="${isEdit ? account.starting_balance : ''}">
      <p class="form-hint">${t('budget.startingBalanceHint')}</p>
    </div>
    <div id="am-credit-fields" ${activeType === 'credit' ? '' : 'hidden'}>
      <div class="form-group">
        <label class="form-label" for="am-credit-bank">${t('budget.creditBankLabel')}</label>
        <input type="text" class="form-input" id="am-credit-bank" maxlength="100"
               placeholder="${t('budget.creditBankPlaceholder')}" value="${esc(isEdit ? (account.credit_bank ?? '') : '')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="am-credit-limit">${t('budget.creditLimitLabel')}</label>
        <!-- Schrittweite und Platzhalter aus der Kontowährung: bei JPY ist ein
             Hundertstel keine Einheit, die es gibt. min bleibt 0 - ein Rahmen
             ist nie negativ, und leer heisst "kein Rahmen gepflegt". -->
        <input type="number" class="form-input" id="am-credit-limit" min="0" inputmode="decimal"
               step="${amountStep(accountCurrency, isEdit ? (account.credit_limit ?? '') : '')}"
               placeholder="${amountPlaceholder(accountCurrency)}" value="${isEdit ? (account.credit_limit ?? '') : ''}">
        <p class="form-hint">${t('budget.creditLimitHint')}</p>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${t('budget.accountColorLabel')}</label>
      <div class="budget-color-picker" id="am-color" role="radiogroup" aria-label="${t('budget.accountColorLabel')}">${colorSwatches}</div>
    </div>

    <div class="modal-panel__footer modal-panel__footer--plain">
      <div style="display:flex;gap:var(--space-2)">
      ${isEdit ? `<button class="btn btn--danger btn--icon" id="am-delete" aria-label="${t('budget.deleteAccount')}">
        <i data-lucide="trash-2" class="icon-md" aria-hidden="true"></i>
      </button>
      <button class="btn btn--secondary btn--icon" id="am-archive"
              aria-label="${account.archived ? t('budget.unarchiveAccount') : t('budget.archiveAccount')}"
              title="${account.archived ? t('budget.unarchiveAccount') : t('budget.archiveAccount')}">
        <i data-lucide="${account.archived ? 'archive-restore' : 'archive'}" class="icon-md" aria-hidden="true"></i>
      </button>` : '<div></div>'}
      </div>
      <div style="display:flex;gap:var(--space-3)">
        <button class="btn btn--secondary" id="am-cancel">${t('common.cancel')}</button>
        <button class="btn btn--primary" id="am-save">${isEdit ? t('common.save') : t('common.add')}</button>
      </div>
    </div>`;

  openSharedModal({
    title: isEdit ? t('budget.editAccount') : t('budget.newAccount'),
    content,
    size: 'sm',
    onSave(panel) {
      let selectedColor = currentColor;
      wireTablist(panel.querySelector('#am-color'), {
        activeId: currentColor || DEFAULT_COLOR_ID,
        activeClass: 'is-active',
        mode: 'select',
        onChange: (id) => { selectedColor = id === DEFAULT_COLOR_ID ? '' : id; },
      });

      panel.querySelector('#am-cancel').addEventListener('click', closeModal);



      const creditFields = panel.querySelector('#am-credit-fields');
      panel.querySelector('#am-type').addEventListener('change', (ev) => {
        creditFields.hidden = ev.target.value !== 'credit';
      });

      panel.querySelector('#am-archive')?.addEventListener('click', async () => {
        const nextArchived = !account.archived;
        try {
          await api.put(`/budget/accounts/${account.id}`, { archived: nextArchived });
          closeModal({ force: true });
          await loadAccounts();
          renderBody();
          refocusAfterRender();
          window.aashiyana?.showToast(nextArchived ? t('budget.accountArchivedToast') : t('budget.accountRestoredToast'), 'success');
        } catch (err) {
          window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
        }
      });

      panel.querySelector('#am-delete')?.addEventListener('click', async () => {
        // confirmOverModal statt confirmModal: „Abbrechen" gibt das Konto-Modal


        const ok = await confirmOverModal(
          t('budget.deleteAccountConfirm', { name: account.name }),
          { confirmLabel: t('common.delete'), danger: true, detail: t('budget.deleteAccountConfirmDetail') },
        );
        if (!ok) return;
        try {
          await api.delete(`/budget/accounts/${account.id}`);
          await loadMonth(state.month);
          renderBody();
          refocusAfterRender();
          window.aashiyana?.showToast(t('budget.accountDeletedToast'), 'success');
        } catch (err) {
          window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
        }
      });

      panel.querySelector('#am-save').addEventListener('click', async () => {
        const saveBtn = panel.querySelector('#am-save');
        const name    = panel.querySelector('#am-name').value.trim();
        const type    = panel.querySelector('#am-type').value;
        const rawBal  = panel.querySelector('#am-balance').value;
        const startingBalance = rawBal === '' ? 0 : parseFloat(rawBal);
        const rawLimit = panel.querySelector('#am-credit-limit').value.trim();
        const creditLimit = rawLimit === '' ? null : parseFloat(rawLimit);

        if (!name) {
          reportFieldError(panel.querySelector('#am-name'), t('common.titleRequired'));
          return;
        }
        if (isNaN(startingBalance)) {
          reportFieldError(panel.querySelector('#am-balance'), t('budget.validAmountRequired'));
          return;
        }
        if (rejectOffGridAmount(panel.querySelector('#am-balance'), startingBalance, accountCurrency, {
          original: isEdit ? account.starting_balance : null,
        })) return;
        if (type === 'credit' && creditLimit !== null && (isNaN(creditLimit) || creditLimit < 0)) {
          reportFieldError(panel.querySelector('#am-credit-limit'), t('budget.validAmountRequired'));
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = '…';
        try {
          const body = { name, type, starting_balance: startingBalance, color: selectedColor || null };


          body.credit_bank  = type === 'credit' ? (panel.querySelector('#am-credit-bank').value.trim() || null) : null;
          body.credit_limit = type === 'credit' ? creditLimit : null;
          if (isEdit) {
            await api.put(`/budget/accounts/${account.id}`, body);
          } else {
            await api.post('/budget/accounts', body);
          }
          closeModal({ force: true });
          await loadAccounts();
          renderBody();
          refocusAfterRender();
          window.aashiyana?.showToast(isEdit ? t('budget.accountSavedToast') : t('budget.accountAddedToast'), 'success');
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? t('common.save') : t('common.add');
          window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
        }
      });
    },
  });
}

function renderLoansDashboard() {
  const loans = state.loans?.loans ?? [];
  if (!loans.length) return '';

  const summary = state.loans?.summary ?? {};
  const visibleLoans = filteredLoans();

  return `
    <section class="budget-loans">
      <div class="panel-head budget-loans__header">
        <div>
          <div class="panel-head__title">${t('budget.loansTitle')}</div>
          <div class="budget-loans__summary">${t('budget.loansSummary', {
            count: summary.active_count ?? 0,
            amount: formatAmount(summary.remaining_principal ?? summary.remaining_amount ?? 0),
          })}</div>
          ${state.loanFilterId ? `<div class="budget-list-header__filter">${esc(activeLoanLabel())}</div>` : ''}
        </div>
        <div class="panel-head__actions">
          ${state.loanFilterId ? `
          <button class="btn btn--secondary btn--sm" type="button" id="budget-clear-loan-filter">
            <i data-lucide="x" aria-hidden="true"></i>${t('budget.clearLoanFilter')}
          </button>` : ''}
          <!-- Einfachauswahl, keine Sicht: role="radiogroup" statt des früheren
               role="group", damit der Zustand angesagt wird UND die geteilte
               Verhaltensschicht Pfeiltasten liefert (Critique 2026-07-30, P1). -->
          <div class="segmented budget-loans__filters" role="radiogroup" aria-label="${t('budget.loanStatusFilterLabel')}">
            ${[['active', 'budget.loanStatusActive'], ['paid', 'budget.loanStatusPaid'], ['all', 'budget.loanStatusAll']]
              .map(([id, key]) => {
                const on = state.loanStatusFilter === id;
                return `<button class="segmented__item${on ? ' is-active' : ''}"
                    type="button" role="radio" data-tab-id="${id}" aria-checked="${on}"
                    tabindex="${on ? '0' : '-1'}">${t(key)}</button>`;
              }).join('')}
          </div>
        </div>
      </div>
      <!-- Geteilte Kennzahl-Zeile statt der früheren eigenen budget-loans__stats
           (fünfte Kartenbauart des Moduls, Critique 2026-07-30, P0). Rolle
           total: die Richtung steht im Label, nicht im Vorzeichen. -->
      <div class="metric-grid">
        <div class="metric-card">
          <div class="metric-card__label">${t(summary.has_interest ? 'budget.loanRemainingPrincipal' : 'budget.loanRemainingAmount')}</div>
          <div class="metric-card__value">${amountByRole(summary.remaining_principal ?? summary.remaining_amount ?? 0, 'total').text}</div>
        </div>
        <div class="metric-card">
          <div class="metric-card__label">${t('budget.loanRemainingInstallments')}</div>
          <div class="metric-card__value">${summary.remaining_installments ?? 0}</div>
        </div>
        <div class="metric-card">
          <div class="metric-card__label">${t('budget.loanPaidAmount')}</div>
          <div class="metric-card__value">${amountByRole(summary.paid_amount ?? 0, 'total').text}</div>
        </div>
      </div>
      ${summary.has_foreign_currency ? `<p class="form-hint budget-loan-hint">${t('budget.loanSummaryConverted', {
        currency: esc(summary.currency || state.currency),
      })}</p>` : ''}
      ${visibleLoans.length ? `
        <div class="budget-loans__list">
          ${visibleLoans.map(renderLoanCard).join('')}
        </div>
      ` : `
        <div class="budget-loans__empty">${t('budget.loansEmpty')}</div>
      `}
      ${renderLoanTransactions(visibleLoans)}
    </section>
  `;
}

function filteredLoans() {
  const loans = state.loans?.loans ?? [];
  return loans.filter((loan) => {
    const matchesStatus = state.loanStatusFilter === 'all' || loan.status === state.loanStatusFilter;
    const matchesLoan = !state.loanFilterId || loan.id === state.loanFilterId;
    return matchesStatus && matchesLoan;
  });
}

function activeLoanLabel() {
  const loan = state.loans.loans.find((item) => item.id === state.loanFilterId);
  return loan ? t('budget.loanFilterActive', { title: loan.title }) : '';
}

function loanPaymentsFor(loans) {
  return loans.flatMap((loan) => (loan.payments ?? []).map((payment) => ({ ...payment, loan })))
    .sort((a, b) => new Date(b.paid_date) - new Date(a.paid_date) || b.installment_number - a.installment_number);
}

function renderLoanTransactions(loans) {
  const payments = loanPaymentsFor(loans);
  if (!payments.length) return '';

  return `<div class="budget-loan-transactions">
    <div class="budget-loan-transactions__title">${t('budget.loanTransactions')}</div>
    <div class="budget-loan-transactions__list">
      ${payments.map(({ loan, ...payment }) => renderLoanPaymentEntry(loan, payment)).join('')}
    </div>
  </div>`;
}



function isBorrowedLoan(loan) {
  return loan?.direction === 'borrowed';
}

function loanPaymentToEntry(loan, payment) {
  if (!payment.budget_entry_id) return null;
  return {
    id: payment.budget_entry_id,



    title: payment.entry_title || t('budget.loanPaymentTitle', { borrower: loan.borrower }),



    amount: (isBorrowedLoan(loan) ? -1 : 1) * Number(payment.amount || 0),
    category: payment.entry_category || '',
    subcategory: payment.entry_subcategory || '',
    date: payment.paid_date,
    is_recurring: payment.entry_is_recurring || 0,
    recurrence_parent_id: payment.entry_recurrence_parent_id || null,
  };
}

function renderLoanPaymentEntry(loan, payment) {
  const entry = loanPaymentToEntry(loan, payment);
  const meta = `${formatEntryDate(payment.paid_date)} · ${esc(loan.title)} · ${t('budget.loanInstallmentNumber', {
    number: payment.installment_number,
    total: loan.installment_count,
  })}`;
  const borrowed = isBorrowedLoan(loan);
  const flow = borrowed ? 'expenses' : 'income';


  const amountText = amountByRole(
    (borrowed ? -1 : 1) * Number(payment.amount || 0),
    'flow',
    { currency: loan?.currency || state.currency }
  ).text;

  return `
    <div class="list-row budget-entry budget-entry--loan" data-loan-payment-id="${payment.id}" data-loan-id="${loan.id}" ${entry ? `data-entry-id="${entry.id}"` : ''}>
      <div class="budget-entry__indicator budget-entry__indicator--${flow}"></div>
      <div class="list-row__main">
        <div class="list-row__name budget-entry__title">${esc(payment.entry_title || t('budget.loanPaymentTitle', { borrower: loan.borrower }))}</div>
        <div class="list-row__meta budget-entry__meta">${meta}</div>
      </div>
      <div class="budget-entry__amount budget-entry__amount--${flow}">${amountText}</div>
      <div class="list-row__actions">
        ${entry ? `
        <button class="row-action" data-action="loan-payment-edit" data-loan-id="${loan.id}" data-payment-id="${payment.id}" data-entry-id="${entry.id}" aria-label="${t('common.edit')}">
          <i data-lucide="pencil" class="icon-md" aria-hidden="true"></i>
        </button>` : ''}
        <button class="row-action row-action--danger" data-action="loan-payment-delete" data-loan-id="${loan.id}" data-payment-id="${payment.id}" data-entry-id="${entry?.id ?? ''}" aria-label="${t('budget.deleteLabel')}">
          <i data-lucide="trash-2" class="icon-md" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

function renderLoansPage() {
  const loans = state.loans?.loans ?? [];
  if (!loans.length) {
    return `<div class="budget-tab-panel page-scrollport budget-tab-panel--loans">
      ${emptyStateHTML({
    icon: 'hand-coins',
    title: t('budget.loansEmpty'),
    description: t('budget.loansEmptyDescription'),
    action: { label: t('budget.newLoan'), icon: 'plus', attrs: { id: 'budget-empty-loan' } },
  })}
    </div>`;
  }

  return `<div class="budget-tab-panel page-scrollport budget-tab-panel--loans">
    ${renderLoansDashboard()}
  </div>`;
}

function wireLoansPage() {
  _container.querySelector('#budget-empty-loan')?.addEventListener('click', () => openBudgetModal({ mode: 'create', initialType: 'loan' }));
  _container.querySelector('#budget-clear-loan-filter')?.addEventListener('click', () => {
    state.loanFilterId = null;
    renderBody();
  });
  // Geteilte Verhaltensschicht statt eigener Klick-Handler: dieselbe Grammatik

  wireTablist(_container.querySelector('.budget-loans__filters'), {
    activeId: state.loanStatusFilter,
    activeClass: 'is-active',
    mode: 'select',
    onChange: (id) => {
      state.loanStatusFilter = id;
      renderBody();
      refocusSegmented('.budget-loans__filters');
    },
  });
  _container.querySelectorAll('.budget-loan-card[data-loan-id]').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('button, a')) return;
      const loan = state.loans.loans.find((item) => item.id === parseInt(card.dataset.loanId, 10));
      if (loan) openLoanReport(loan);
    });
  });
  _container.querySelectorAll('[data-action="loan-pay"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await markLoanPayment(parseInt(btn.dataset.id, 10));
    });
  });
  _container.querySelectorAll('[data-action="loan-edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const loan = state.loans.loans.find((item) => item.id === parseInt(btn.dataset.id, 10));
      if (loan) openLoanModal(loan);
    });
  });
  _container.querySelectorAll('[data-action="loan-delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteLoan(parseInt(btn.dataset.id, 10));
    });
  });
  _container.querySelectorAll('[data-action="loan-filter"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      state.loanFilterId = state.loanFilterId === id ? null : id;
      renderBody();
    });
  });
  _container.querySelectorAll('[data-action="loan-payment-edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openLoanPaymentEntry(parseInt(btn.dataset.loanId, 10), parseInt(btn.dataset.paymentId, 10));
    });
  });
  _container.querySelectorAll('[data-action="loan-payment-delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteLoanPayment(parseInt(btn.dataset.loanId, 10), parseInt(btn.dataset.paymentId, 10));
    });
  });
}

async function openLoanPaymentEntry(loanId, paymentId) {
  try {
    const res = await api.get(`/budget?loan_id=${loanId}`);
    const entry = (res.data ?? []).find((e) => e.loan_payment_id === paymentId);
    if (!entry) {
      window.aashiyana?.showToast(t('common.unknownError'), 'danger');
      return;
    }
    openBudgetModal({ mode: 'edit', entry });
  } catch (err) {
    window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
  }
}

function openLoanReport(loan) {
  const payments = (loan.payments ?? []).slice()
    .sort((a, b) => new Date(b.paid_date) - new Date(a.paid_date) || b.installment_number - a.installment_number);



  const interest = loan.interest;
  const cells = interest
    ? [
      [t('budget.loanPrincipalAmount'), formatLoanAmount(interest.principal, loan)],
      [t('budget.loanRemainingPrincipal'), formatLoanAmount(loan.remaining_principal, loan)],
      [t('budget.loanStillToPay'), formatLoanAmount(loan.remaining_amount, loan)],
      [t('budget.loanPaidAmount'), formatLoanAmount(loan.paid_amount, loan)],
      [t('budget.loanRemainingInstallments'),
        (loan.remaining_installments_forecast != null
          && loan.remaining_installments_forecast !== loan.remaining_installments)
          ? t('budget.loanRemainingInstallmentsForecast', {
            forecast: loan.remaining_installments_forecast,
            plan: loan.remaining_installments,
          })
          : String(loan.remaining_installments)],
    ]
    : [
      [t('budget.loanAmountLabel'), formatLoanAmount(loan.total_amount, loan)],
      [t('budget.loanRemainingAmount'), formatLoanAmount(loan.remaining_amount, loan)],
      [t('budget.loanPaidAmount'), formatLoanAmount(loan.paid_amount, loan)],
      [t('budget.loanRemainingInstallments'), String(loan.remaining_installments)],
    ];
  const content = `
    <div class="loan-report">
      <div class="loan-report__hero">
        <div>
          <div class="loan-report__borrower">${esc(loan.borrower)}</div>
          <div class="loan-report__title">${esc(loan.title)}</div>
        </div>
        <span class="loan-report__status loan-report__status--${loan.status}">
          ${loan.status === 'paid' ? t('budget.loanStatusPaid') : t('budget.loanStatusActive')}
        </span>
      </div>
      <div class="loan-report__grid">
        ${cells.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${value}</strong></div>`).join('')}
      </div>
      ${loan.is_foreign_currency ? `<p class="form-hint budget-loan-hint">${t('budget.loanRateInfo', {
        currency: esc(loan.currency),
        rate: getNumberFormat({ maximumFractionDigits: 6 }).format(Number(loan.exchange_rate || 1)),
        base: esc(state.currency),
        amount: formatAmount(Number(interest ? loan.remaining_principal : loan.remaining_amount) * Number(loan.exchange_rate || 1)),
      })}</p>` : ''}
      <div class="loan-report__section-title">${t('budget.loanTransactions')}</div>
      ${payments.length ? `
        <div class="loan-report__transactions">
          ${payments.map((payment) => `
            <div class="budget-loan-transaction">
              <div>
                <strong>${t('budget.loanInstallmentNumber', { number: payment.installment_number, total: loan.installment_count })}</strong>
                <span>${formatEntryDate(payment.paid_date)}</span>
              </div>
              <div>
                <strong>${formatLoanAmount(payment.amount, loan)}</strong>
              </div>
            </div>
          `).join('')}
        </div>
      ` : `<div class="budget-loans__empty">${t('budget.loanNoTransactions')}</div>`}
    </div>
    <div class="modal-panel__footer modal-panel__footer--plain">
      <div></div>
      <button class="btn btn--primary" id="loan-report-close">${t('common.close')}</button>
    </div>`;

  openSharedModal({
    title: t('budget.loanReportTitle'),
    content,
    size: 'md',
    onSave(panel) {
      panel.querySelector('#loan-report-close')?.addEventListener('click', closeModal);
    },
  });
}



function formatRate(r) {
  return `${getNumberFormat({ maximumFractionDigits: 2 }).format(Number(r))} %`;
}



function loanInterestMeta(it, loan) {
  const monthly = t('budget.loanMonthlyRate', { amount: formatLoanAmount(it.monthly_payment, loan) });


  const hasVariablePhase = it.mode === 'fixed_then_variable' && it.remaining_after_binding > 0;
  let phase;
  if (hasVariablePhase) {
    phase = t('budget.loanRateFixedThenVariable', {
      fixed: formatRate(it.fixed_rate),
      until: it.binding_end_month ? formatMonthLabel(it.binding_end_month) : '',
      variable: formatRate(it.followup_rate),
    });
  } else if (it.mode === 'variable') {

    phase = t('budget.loanRateVariable', { rate: formatRate(it.fixed_rate) });
  } else {
    phase = t('budget.loanRateFixed', { rate: formatRate(it.fixed_rate) });
  }
  return `${monthly} · ${phase}`;
}

function renderLoanCard(loan) {
  const paidPct = Math.min(100, Math.round((loan.paid_amount / loan.total_amount) * 100));
  const nextDue = loan.next_due_month ? formatMonthLabel(loan.next_due_month) : t('budget.loanPaidStatus');



  const payDisabled = loan.is_settled ? 'disabled' : '';





  const interest = loan.interest;
  const leadAmount = interest ? loan.remaining_principal : loan.remaining_amount;
  const leadTotal = interest ? interest.principal : loan.total_amount;

  return `
    <article class="budget-loan-card" data-loan-id="${loan.id}">
      <div class="budget-loan-card__main">
        <div class="budget-loan-card__title-row">
          <div class="budget-loan-card__title">${esc(loan.title)}</div>
          <button class="budget-loan-card__filter ${state.loanFilterId === loan.id ? 'budget-loan-card__filter--active' : ''}"
                  type="button" data-action="loan-filter" data-id="${loan.id}"
                  aria-pressed="${state.loanFilterId === loan.id}" aria-label="${t('budget.filterLoanTransactions')}">
            <i data-lucide="filter" aria-hidden="true"></i>
          </button>
        </div>
        <div class="budget-loan-card__meta">${t(isBorrowedLoan(loan)
          ? 'budget.loanDirectionBorrowedBadge'
          : 'budget.loanDirectionLentBadge')} · ${esc(loan.borrower)} · ${t('budget.loanInstallmentMeta', {
          paid: loan.paid_installments,
          total: loan.installment_count,
        })}</div>
        ${loan.interest ? `<div class="budget-loan-card__meta budget-loan-card__interest">${esc(loanInterestMeta(loan.interest, loan))}</div>` : ''}
      </div>
      <div class="budget-loan-card__amounts">
        ${interest ? `<span class="budget-loan-card__amount-label">${t('budget.loanRemainingPrincipal')}</span>` : ''}
        <strong>${formatLoanAmount(leadAmount, loan)}</strong>
        <span>${t('budget.loanRemainingOf', { total: formatLoanAmount(leadTotal, loan) })}</span>
        ${loan.is_foreign_currency
          ? `<span class="budget-loan-card__converted">${loanBudgetEquivalent(leadAmount, loan)}</span>`
          : ''}
      </div>
      <div class="budget-loan-card__progress" role="progressbar"
           aria-valuenow="${paidPct}" aria-valuemin="0" aria-valuemax="100"
           aria-label="${t('budget.loanProgressLabel')}">
        <span style="--bar-scale:${paidPct / 100}"></span>
      </div>
      <div class="budget-loan-card__footer">
        <span>${t('budget.loanNextDue', { month: nextDue })}</span>
        <div class="budget-loan-card__actions">
          <button class="btn btn--secondary btn--icon" data-action="loan-edit" data-id="${loan.id}" aria-label="${t('budget.editLoan')}">
            <i data-lucide="pencil" aria-hidden="true"></i>
          </button>
          <button class="btn btn--secondary btn--icon" data-action="loan-delete" data-id="${loan.id}" aria-label="${t('budget.deleteLoan')}">
            <i data-lucide="trash-2" aria-hidden="true"></i>
          </button>
          <button class="btn btn--primary" data-action="loan-pay" data-id="${loan.id}" ${payDisabled}>
            ${t('budget.markLoanPaid')}
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderTrend(current, prev, prevLabel, betterWhen = 'higher') {
  const delta = current - prev;
  if (Math.abs(delta) < 0.005) {
    return trendMarkup({
      delta: 0, text: esc(t('budget.trendNeutral', { month: prevLabel })), icon: false,
    });
  }


  // Pfeil entscheidet utils/metric-card.js (Farbe = Valenz via betterWhen,

  const deltaText = amountByRole(delta, 'flow').text;
  return trendMarkup({
    delta, betterWhen,
    text: esc(t('budget.trendDelta', { amount: deltaText, month: prevLabel })),
  });
}

function formatEntryDate(dateStr) {
  return formatDate(dateStr);
}

// --------------------------------------------------------
// Modal
// --------------------------------------------------------

function openCategoryManager() {

  // raeumt `confirmOverModal` das Modal darunter ab, bevor `api.delete` laeuft
  // (siehe `_notifyChanged` in components/category-manager.js).
  const onChanged = async () => {
    await loadBudgetMeta();


    // Schicht: `refocusAfterRender()` findet ihn ueber seine id wieder. Der


    renderBody();
    refocusAfterRender();
  };
  openSharedModal({
    title: t('budget.manageCategories'),
    content: '<aashiyana-category-manager></aashiyana-category-manager>',
    size: 'lg',
    onSave: (panel) => {
      const manager = panel.querySelector('aashiyana-category-manager');
      manager.addEventListener('category-manager-changed', onChanged);
      manager.configure({
        basePath: '/budget/categories',
        groups: [
          { key: 'expense', labelKey: 'budget.expenses', addLabelKey: 'budget.addCategory', subcategories: true },
          { key: 'income',  labelKey: 'budget.income',   addLabelKey: 'budget.addCategory', subcategories: true },
        ],
        supportsSubcategories: true,
        labelResolver: (item) => item.label ?? budgetCategoryLabel(item.key, item.name, t),
        titleKey: 'budget.manageCategories',
        hintKey: 'category.manageHint',

        // Kategorien mit 409 ab.
        deleteDetailKey: 'budget.categoryDeleteConfirmDetail',
        subDeleteDetailKey: 'budget.subcategoryDeleteConfirmDetail',
      });
    },


  });
}

function openBudgetModal({ mode, entry = null, initialType = '' }) {
  const isEdit = mode === 'edit';
  const today  = todayKey();





  const { from, to } = monthPeriodKeys(state.month);
  const defaultDate = defaultDateInPeriod(from, to, today);

  const isExpense  = isEdit ? entry.amount < 0 : true;




  const isLoanPayment = isEdit && (entry.loan_payment_id != null || entry.loan_id != null);

  const editAmount = isEdit && entry.recurrence_virtual && entry.recurrence_full_amount != null
    ? entry.recurrence_full_amount
    : (isEdit ? entry.amount : 0);





  const absAmount  = isEdit ? String(Math.abs(editAmount)) : '';
  const curInterval = isEdit && entry.recurrence_interval ? entry.recurrence_interval : 'monthly';

  const curCount = Math.min(99, Math.max(1, Number(isEdit && entry.recurrence_interval_count) || 1));
  const intervalOption = (val, key) =>
    `<option value="${val}" ${curInterval === val ? 'selected' : ''}>${t(key)}</option>`;

  const initialCats = isExpense ? expenseCategories() : incomeCategories();
  const catOpts     = initialCats.map((c) =>
    `<option value="${esc(c.key)}" ${isEdit && entry.category === c.key ? 'selected' : ''}>${esc(categoryLabel(c))}</option>`
  ).join('');
  const initialCategory = isEdit ? entry.category : initialCats[0]?.key;
  const initialSubcategory = isEdit ? entry.subcategory : defaultSubcategory(initialCategory);
  const subcatOpts = getSubcategories(initialCategory).map((s) =>
    `<option value="${esc(s.key)}" ${initialSubcategory === s.key ? 'selected' : ''}>${esc(subcategoryLabel(s))}</option>`
  ).join('');

  const hasAccounts = (state.accounts?.length ?? 0) > 0;
  const accountOpts = `<option value="">${t('budget.noAccount')}</option>` + (state.accounts ?? []).map((a) =>
    `<option value="${a.id}" ${isEdit && entry.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`
  ).join('');
  const accountField = hasAccounts ? `
        <div class="form-group">
          <label class="form-label" for="bm-account">${t('budget.accountLabel')}</label>
          <select class="form-input" id="bm-account">${accountOpts}</select>
        </div>` : '';

  const content = `
    <div class="amount-type-toggle ${isEdit ? 'amount-type-toggle--entry-only' : ''}">
      <button class="amount-type-btn amount-type-btn--expenses ${isExpense ? 'amount-type-btn--active' : ''}"
              id="type-expense" type="button" ${isLoanPayment ? 'disabled' : ''}>${t('budget.typeExpense')}</button>
      <button class="amount-type-btn amount-type-btn--income ${!isExpense ? 'amount-type-btn--active' : ''}"
              id="type-income" type="button" ${isLoanPayment ? 'disabled' : ''}>${t('budget.typeIncome')}</button>
      ${!isEdit ? `<button class="amount-type-btn amount-type-btn--loan"
              id="type-loan" type="button">${t('budget.typeLoan')}</button>` : ''}
    </div>
    ${isLoanPayment ? `<p class="budget-type-locked-hint">${t('budget.loanPaymentTypeLocked')}</p>` : ''}

    <div class="form-group js-entry-field">
      <label class="form-label" for="bm-title">${t('budget.titleLabel')}<span class="required-marker" aria-hidden="true"> *</span></label>
      <input type="text" class="form-input" id="bm-title"
             placeholder="${t('budget.titlePlaceholder')}" value="${esc(isEdit ? entry.title : '')}">
    </div>

    <div class="form-group js-entry-field">
      <label class="form-label" for="bm-amount">${t('budget.amountLabel')}<span class="required-marker" aria-hidden="true"> *</span></label>
      <input type="number" class="form-input" id="bm-amount"
             placeholder="${amountPlaceholder(state.currency)}"
             step="${amountStep(state.currency, absAmount)}" min="${amountMin(state.currency, absAmount)}"
             inputmode="decimal" value="${absAmount}">
    </div>

    <div class="form-group js-entry-field">
      <div class="budget-field-header">
        <label class="form-label" for="bm-category">${t('budget.categoryLabel')}</label>
        <button class="btn btn--secondary budget-inline-add" type="button" id="bm-add-category">${t('budget.addCategory')}</button>
      </div>
      <select class="form-input" id="bm-category">${catOpts}</select>
    </div>

    <div class="form-group js-entry-field" id="bm-subcategory-group">
      <div class="budget-field-header">
        <label class="form-label" for="bm-subcategory">${t('budget.subcategoryLabel')}</label>
        <button class="btn btn--secondary budget-inline-add" type="button" id="bm-add-subcategory">${t('budget.addSubcategory')}</button>
      </div>
      <select class="form-input" id="bm-subcategory">${subcatOpts}</select>
    </div>

    <div class="form-group js-entry-field">
      <label class="form-label" for="bm-date">${t('budget.dateLabel')}</label>
      <aashiyana-datepicker type="date" id="bm-date"
             value="${isEdit ? entry.date : defaultDate}"></aashiyana-datepicker>
    </div>

    ${state.budgetMode === 'personal' ? `
    <div class="form-group js-entry-field">
      <label class="form-label" for="bm-visibility">${t('budget.visibilityLabel')}</label>
      <select class="form-input" id="bm-visibility">
        ${VISIBILITY_LEVELS.map((level) => `
          <option value="${level}" ${(isEdit ? entry.visibility : 'shared') === level ? 'selected' : ''}>
            ${esc(t(`budget.visibility_${level}`))}
          </option>`).join('')}
      </select>
      <p class="form-hint" id="bm-visibility-hint">${esc(t(`budget.visibilityHint_${isEdit ? entry.visibility : 'shared'}`))}</p>
    </div>` : ''}

    ${/* ZUSTAENDIG (#1057) - ein Etikett, das kein Geld bewegt.
        *
        * Steht bewusst NEBEN der Sichtbarkeit und nicht in ihr: `owner_id` ist
        * die Datenschutz-Achse und liegt fest, die Zustaendigkeit ist die
        * zweite Achse und darf wechseln. Wer die Wasserrechnung uebernimmt,
        * bekommt damit keine private Buchung und schuldet auch nichts - das
        * Abrechnen bleibt in den geteilten Ausgaben.
        *
        * Verschwindet im Solo-Haushalt: eine Zustaendigkeitsfrage mit genau
        * einer moeglichen Antwort ist ein Formularfeld ohne Frage (dieselbe
        * Regel wie in utils/household.js). */ ''}
    ${state.members.length > 1 ? `<div class="form-group js-entry-field">
      ${renderUserMultiSelect(state.members, isEdit ? (entry.responsible_users ?? []).map((u) => u.id) : [], 'bm-responsible', 'budget.responsibleLabel')}
      <p class="form-hint">${esc(t('budget.responsibleHint'))}</p>
      ${/* Der Weg von der Zuschreibung zur Forderung (#1057) - und er ist
          * ausdruecklich ein Weg und keine Verschmelzung: hier entsteht nichts,
          * dort bestaetigt die Person, was entsteht. Nur beim Bearbeiten, weil
          * eine noch nicht gespeicherte Buchung nichts zu uebergeben hat. */ ''}
      ${isEdit && (entry.responsible_users ?? []).length ? `
      <button type="button" class="btn btn--secondary btn--sm" id="bm-to-split">
        <i data-lucide="arrow-right-left" class="icon-sm" aria-hidden="true"></i>${esc(t('budget.handoverToSplit'))}
      </button>` : ''}
    </div>` : ''}

    <div class="js-entry-field">
      ${advancedSection(`
        ${accountField}
        <div class="form-group">
          <label class="toggle">
            <input type="checkbox" id="bm-recurring" ${isEdit && entry.is_recurring ? 'checked' : ''}>
            <span class="toggle__track"></span>
            <span>${t('budget.recurringLabel')}</span>
          </label>
        </div>

        <div class="form-group" id="bm-recurrence-options" ${isEdit && entry.is_recurring ? '' : 'hidden'}>
          <label class="form-label" for="bm-interval">${t('budget.recurringIntervalLabel')}</label>
          <select class="form-input" id="bm-interval">
            ${intervalOption('weekly', 'budget.intervalWeekly')}
            ${intervalOption('monthly', 'budget.intervalMonthly')}
            ${intervalOption('yearly', 'budget.intervalYearly')}
          </select>
          <div class="rrule-interval-wrap" style="margin-top:var(--space-3)">
            <label class="form-label" for="bm-interval-count" style="margin:0">${t('rrule.labelEvery')}</label>
            <input class="form-input" type="number" id="bm-interval-count" min="1" max="99"
                   value="${curCount}" inputmode="numeric" style="width:64px;text-align:center">
            <span class="rrule-interval-unit" id="bm-interval-unit">${intervalUnitLabel(curInterval, curCount)}</span>
          </div>
          <label class="toggle" style="margin-top:var(--space-3)">
            <input type="checkbox" id="bm-virtual" ${isEdit && entry.recurrence_virtual ? 'checked' : ''}>
            <span class="toggle__track"></span>
            <span>${t('budget.virtualBudgetLabel')}</span>
          </label>
          <p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-top:var(--space-1)">${t('budget.virtualBudgetHint')}</p>
          <label class="toggle" style="margin-top:var(--space-3)">
            <input type="checkbox" id="bm-confirm-first" ${isEdit && entry.recurrence_confirm ? 'checked' : ''}>
            <span class="toggle__track"></span>
            <span>${t('budget.confirmFirstLabel')}</span>
          </label>
          <p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-top:var(--space-1)">${t('budget.confirmFirstHint')}</p>
        </div>

        ${renderDocumentAttachField({
          attachments: isEdit ? (entry.attachments || []) : [],
          label: t('budget.receiptsLabel'),
          hint: t('budget.receiptsHint'),
          icon: 'receipt',
        })}`,
        { open: isEdit && (entry.is_recurring || !!entry.subcategory || entry.account_id != null
          || (entry.attachments?.length ?? 0) > 0) })}
    </div>

    <div id="bm-loan-fields" hidden>
      ${loanIdentityFieldsHtml(null)}
      ${loanCurrencyFieldsHtml(null)}
      <div class="form-grid-2" id="lm-manual-fields">
        <div class="form-group">
          <label class="form-label" for="lm-amount">${t('budget.loanAmountLabel')}</label>
          <input type="number" class="form-input" id="lm-amount"
                 step="${amountStep(state.currency, '')}" min="${amountMin(state.currency, '')}"
                 placeholder="${amountPlaceholder(state.currency)}" inputmode="decimal">
        </div>
        <div class="form-group">
          <label class="form-label" for="lm-installments">${t('budget.loanInstallmentsLabel')}</label>
          <input type="number" class="form-input" id="lm-installments" step="1" min="1" max="360" inputmode="numeric">
        </div>
      </div>
      ${loanInterestFieldsHtml(null)}
      <div class="form-group">
        <label class="form-label" for="lm-start">${t('budget.loanStartMonthLabel')}</label>
        <input type="month" class="form-input" id="lm-start" value="${defaultDate.slice(0, 7)}">
      </div>
      <div class="form-group">
        <label class="form-label" for="lm-notes">${t('budget.loanNotesLabel')}</label>
        <textarea class="form-input" id="lm-notes" rows="3"></textarea>
      </div>
    </div>

    <div class="modal-panel__footer modal-panel__footer--plain">
      ${isEdit ? `<button class="btn btn--danger btn--icon" id="bm-delete" aria-label="${t('budget.deleteLabel')}">
        <i data-lucide="trash-2" class="icon-md" aria-hidden="true"></i>
      </button>` : '<div></div>'}
      <div style="display:flex;gap:var(--space-3)">
        <button class="btn btn--secondary" id="bm-cancel">${t('common.cancel')}</button>
        <button class="btn btn--primary" id="bm-save">${isEdit ? t('common.save') : t('common.add')}</button>
      </div>
    </div>`;

  openSharedModal({
    title: isEdit ? t('budget.editEntry') : t('budget.newEntry'),
    content,
    size: 'sm',
    onSave(panel) {
      let currentType = !isEdit && initialType === 'loan' ? 'loan' : (isExpense ? 'expense' : 'income');



      // anwaehlbar.
      bindUserMultiSelect(panel, 'bm-responsible');




      panel.querySelector('#bm-to-split')?.addEventListener('click', async () => {
        prefillSplitExpense({
          title: entry.title,
          amount: Math.abs(entry.amount),
          date: entry.date,
          currency: state.currency,
          participantIds: (entry.responsible_users ?? []).map((u) => u.id),
        });
        await closeModal({ force: true });
        state.activeTab = 'split-expenses';
        _tablist?.setActive?.('split-expenses');
        renderBody();
      });

      const setType = (type) => {
        currentType = type;
        panel.querySelector('#type-expense').classList.toggle('amount-type-btn--active', type === 'expense');
        panel.querySelector('#type-income').classList.toggle('amount-type-btn--active', type === 'income');
        panel.querySelector('#type-loan')?.classList.toggle('amount-type-btn--active', type === 'loan');
        panel.querySelectorAll('.js-entry-field').forEach((el) => { el.hidden = type === 'loan'; });
        panel.querySelector('#bm-loan-fields').hidden = type !== 'loan';

        if (type !== 'loan') {
          panel.querySelector('#bm-recurrence-options').hidden = !panel.querySelector('#bm-recurring').checked;
        }
        panel.querySelector('#bm-save').textContent = type === 'loan'
          ? t('budget.createLoan')
          : (isEdit ? t('common.save') : t('common.add'));
        if (type !== 'loan') updateCategoryOptions();
      };

      const updateCategoryOptions = (preferredCategory = '') => {
        const cats = currentType === 'income' ? incomeCategories() : expenseCategories();
        const catSelect = panel.querySelector('#bm-category');
        const currentValue = preferredCategory || catSelect.value;

        const options = cats.map((c) => {
          const opt = document.createElement('option');
          opt.value = c.key;
          opt.textContent = categoryLabel(c);
          opt.selected = currentValue === c.key;
          return opt;
        });
        catSelect.replaceChildren(...options);
        if (!cats.some((c) => c.key === catSelect.value)) catSelect.value = cats[0]?.key || '';
        updateSubcategoryOptions();
      };

      const updateSubcategoryOptions = (preferredSubcategory = '') => {
        const catSelect = panel.querySelector('#bm-category');
        const subcatGroup = panel.querySelector('#bm-subcategory-group');
        const subcatSelect = panel.querySelector('#bm-subcategory');
        const subcategories = getSubcategories(catSelect.value);
        const currentValue = preferredSubcategory || subcatSelect.value;

        subcatGroup.hidden = false;
        subcatSelect.replaceChildren(...subcategories.map((s) => {
          const opt = document.createElement('option');
          opt.value = s.key;
          opt.textContent = subcategoryLabel(s);
          opt.selected = currentValue === s.key;
          return opt;
        }));
        if (subcategories.length && !subcategories.some((s) => s.key === subcatSelect.value)) {
          subcatSelect.value = subcategories[0].key;
        }
      };

      const addCategory = async () => {
        const name = await requestNameInPanel(panel, {
          title: t('budget.newCategoryTitle'),
          label: t('budget.newCategoryPrompt'),
          placeholder: t('budget.newCategoryPlaceholder'),
        });
        if (!name?.trim()) return;
        try {
          const res = await api.post('/budget/categories', { name: name.trim(), type: currentType });
          await loadBudgetMeta();
          updateCategoryOptions(res.data.key);
          window.aashiyana?.showToast(t('budget.categoryAddedToast'), 'success');
        } catch (err) {
          window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
        }
      };

      const addSubcategory = async () => {
        const category = panel.querySelector('#bm-category').value;
        if (!category) return;
        const name = await requestNameInPanel(panel, {
          title: t('budget.newSubcategoryTitle'),
          label: t('budget.newSubcategoryPrompt'),
          placeholder: t('budget.newSubcategoryPlaceholder'),
        });
        if (!name?.trim()) return;
        try {
          const res = await api.post(`/budget/categories/${encodeURIComponent(category)}/subcategories`, { name: name.trim() });
          await loadBudgetMeta();
          updateSubcategoryOptions(res.data.key);
          window.aashiyana?.showToast(t('budget.subcategoryAddedToast'), 'success');
        } catch (err) {
          window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
        }
      };

      panel.querySelector('#type-expense').addEventListener('click', () => {
        setType('expense');
      });
      panel.querySelector('#type-income').addEventListener('click', () => {
        setType('income');
      });
      panel.querySelector('#type-loan')?.addEventListener('click', () => {
        setType('loan');
      });
      wireLoanDirectionField(panel);
      wireLoanCurrencyFields(panel);
      wireLoanInterestFields(panel);
      wireLoanPaidInstallmentsField(panel);



      const receipts = bindDocumentAttachField(panel, {
        category: 'finance',
        folderKey: 'budget',
        folderName: t('documents.budgetFolder'),
        documentName: (file) => t('budget.receiptDocumentName', {
          title: panel.querySelector('#bm-title').value.trim() || file.name,
          date: formatDate(panel.querySelector('#bm-date').value),
        }),
      });
      panel.querySelector('#bm-category').addEventListener('change', () => updateSubcategoryOptions());
      panel.querySelector('#bm-recurring').addEventListener('change', (e) => {
        panel.querySelector('#bm-recurrence-options').hidden = !e.target.checked;
      });

      const visibilitySel = panel.querySelector('#bm-visibility');
      if (visibilitySel) {
        visibilitySel.addEventListener('change', () => {
          panel.querySelector('#bm-visibility-hint').textContent =
            t(`budget.visibilityHint_${visibilitySel.value}`);
        });
      }



      const intervalSel   = panel.querySelector('#bm-interval');
      const intervalCount = panel.querySelector('#bm-interval-count');
      const intervalUnit  = panel.querySelector('#bm-interval-unit');
      const syncIntervalUnit = () => {
        intervalUnit.textContent = intervalUnitLabel(
          intervalSel.value,
          parseInt(intervalCount.value, 10) || 1,
        );
      };
      intervalSel.addEventListener('change', syncIntervalUnit);
      intervalCount.addEventListener('input', syncIntervalUnit);
      panel.querySelector('#bm-add-category').addEventListener('click', addCategory);
      panel.querySelector('#bm-add-subcategory').addEventListener('click', addSubcategory);
      panel.querySelector('#bm-cancel').addEventListener('click', closeModal);

      panel.querySelector('#bm-delete')?.addEventListener('click', async () => {
        closeModal({ force: true });
        await deleteEntry(entry.id);
        refocusAfterRender();
      });

      panel.querySelector('#bm-save').addEventListener('click', async () => {
        const saveBtn    = panel.querySelector('#bm-save');
        if (currentType === 'loan') {
          await saveLoanFromPanel(panel, saveBtn, { closeAfterSave: true });
          return;
        }

        const title      = panel.querySelector('#bm-title').value.trim();
        const absVal     = parseFloat(panel.querySelector('#bm-amount').value);
        const category   = panel.querySelector('#bm-category').value;
        const subcategory = panel.querySelector('#bm-subcategory').value;
        const date       = panel.querySelector('#bm-date').value;
        const recurring  = panel.querySelector('#bm-recurring').checked ? 1 : 0;
        const interval   = panel.querySelector('#bm-interval').value;
        const intervalN  = Math.min(99, Math.max(1, parseInt(panel.querySelector('#bm-interval-count').value, 10) || 1));
        const virtual    = recurring && panel.querySelector('#bm-virtual').checked ? 1 : 0;
        const confirmFirst = recurring && panel.querySelector('#bm-confirm-first').checked ? 1 : 0;
        const accountSel = panel.querySelector('#bm-account');


        const accountId  = accountSel ? (accountSel.value === '' ? null : parseInt(accountSel.value, 10)) : undefined;

        if (!title) {
          reportFieldError(panel.querySelector('#bm-title'), t('common.titleRequired'));
          return;
        }
        if (isNaN(absVal) || absVal <= 0) {
          reportFieldError(panel.querySelector('#bm-amount'), t('budget.validAmountRequired'));
          return;
        }
        if (rejectOffGridAmount(panel.querySelector('#bm-amount'), absVal, state.currency, {
          original: isEdit ? Math.abs(editAmount) : null,
        })) return;
        if (!date) {
          reportFieldError(panel.querySelector('#bm-date'), t('calendar.invalidDate'));
          return;
        }

        const amount = currentType === 'expense' ? -absVal : absVal;

        saveBtn.disabled    = true;
        saveBtn.textContent = '…';

        try {
          const body = {
            title, amount, category, subcategory, date,
            is_recurring: recurring,
            recurrence_interval: interval,
            recurrence_interval_count: intervalN,
            recurrence_virtual: virtual,
            recurrence_confirm: confirmFirst,
          };
          if (accountId !== undefined) body.account_id = accountId;



          if (panel.querySelector('[data-ms-name="bm-responsible"]')) {
            body.responsible_user_ids = getSelectedUserIds(panel, 'bm-responsible');
          }

          const visibilityEl = panel.querySelector('#bm-visibility');
          if (visibilityEl && VISIBILITY_LEVELS.includes(visibilityEl.value)) {
            body.visibility = visibilityEl.value;
          }

          // verarbeiten (#583). Bricht der Nutzer vorher ab, bleibt keine

          const withReceipts = async () => {
            if (receipts) body.attachment_document_ids = await receipts.commit();
            return body;
          };
          if (mode === 'create') {
            const res = await api.post('/budget', await withReceipts());
            state.entries.unshift(res.data);
            await loadMonth(state.month);
            closeModal({ force: true });
            renderBody();
            window.aashiyana?.showToast(t('budget.addedToast'), 'success');
          } else if (entry.recurrence_parent_id) {

            saveBtn.disabled = false;
            saveBtn.textContent = t('common.save');
            closeModal({ force: true });
            const scope = await recurringChoiceModal({
              title: t('budget.recurringSeriesScope'),
              thisLabel: t('budget.recurringThisOnly'),
              seriesLabel: t('budget.recurringEditSeries'),

              // `PUT /budget/:id/series` schreibt Titel, Betrag, Kategorie und

              // (`WHERE id = ?`, routes/budget/entries.js). Bis die beiden


              note: t('budget.recurringEditSeriesHint'),
            });
            if (scope === null) { openBudgetModal({ mode: 'edit', entry }); return; }
            if (scope === 'series') {


              const seriesBody = { ...body };







              if (seriesBody.account_id === null && entry.account_id == null) {
                delete seriesBody.account_id;
              }
              await api.put(`/budget/${entry.id}/series`, seriesBody);
              window.aashiyana?.showToast(t('budget.recurringSeriesSaved'), 'success');
            } else {
              const res = await api.put(`/budget/${entry.id}`, await withReceipts());
              const idx = state.entries.findIndex((e) => e.id === entry.id);
              if (idx !== -1) state.entries[idx] = res.data;
              window.aashiyana?.showToast(t('budget.savedToast'), 'success');
            }
            await loadMonth(state.month);
            renderBody();
            refocusAfterRender();
          } else {
            const res = await api.put(`/budget/${entry.id}`, await withReceipts());
            const idx = state.entries.findIndex((e) => e.id === entry.id);
            if (idx !== -1) state.entries[idx] = res.data;
            await loadMonth(state.month);
            closeModal({ force: true });
            renderBody();
            window.aashiyana?.showToast(t('budget.savedToast'), 'success');
          }
        } catch (err) {
          window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
          saveBtn.disabled    = false;
          saveBtn.textContent = isEdit ? t('common.save') : t('common.add');
        }
      });
      setType(currentType);
    },
  });
}

function requestNameInPanel(panel, { title, label, placeholder }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'budget-inline-modal';
    setHtml(overlay, `
      <div class="budget-inline-modal__panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="budget-inline-modal__header">
          <strong>${esc(title)}</strong>
          <button class="btn btn--icon" type="button" data-action="inline-cancel" aria-label="${t('common.cancel')}">
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
        </div>
        <div class="form-group">
          <label class="form-label" for="budget-inline-name">${esc(label)}</label>
          <input class="form-input" id="budget-inline-name" type="text" placeholder="${esc(placeholder)}">
        </div>
        <div class="budget-inline-modal__footer">
          <button class="btn btn--secondary" type="button" data-action="inline-cancel">${t('common.cancel')}</button>
          <button class="btn btn--primary" type="button" data-action="inline-save">${t('common.add')}</button>
        </div>
      </div>
    `);
    panel.append(overlay);
    if (window.lucide) lucide.createIcons({ el: overlay });

    const input = overlay.querySelector('#budget-inline-name');


    const opener = document.activeElement;
    const cleanup = (value = '') => {
      overlay.remove();
      if (opener?.isConnected) opener.focus();
      resolve(value);
    };

    // (#871). Leerer Wert heisst: abgebrochen.
    attachOverlay(overlay, () => cleanup(''));
    overlay.querySelectorAll('[data-action="inline-cancel"]').forEach((btn) => {
      btn.addEventListener('click', () => cleanup(''));
    });
    overlay.querySelector('[data-action="inline-save"]').addEventListener('click', () => {
      cleanup(input.value.trim());
    });

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) cleanup('');
    });


    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); cleanup(''); return; }
      if (e.key === 'Enter' && e.target === input) { cleanup(input.value.trim()); return; }
      if (e.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll('button, input')].filter((el) => !el.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    input.focus();
  });
}





function rejectOffGridAmount(input, value, currency, { original = null, originalCurrency = null } = {}) {
  if (amountIsSavable(value, currency, { original, originalCurrency })) return false;
  reportFieldError(input, t('common.amountPrecisionRequired', {
    currency,
    step: smallestUnitLabel(currency),
  }));
  return true;
}

function loanCurrencyFieldsHtml(loan) {
  const currency = loan?.currency || state.currency;
  const foreign = currency !== state.currency;
  const rate = Number(loan?.exchange_rate ?? 1);
  return `
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label" for="lm-currency">${t('budget.loanCurrencyLabel')}</label>
        <select class="form-input" id="lm-currency" data-selected="${esc(currency)}"></select>
      </div>
      <div class="form-group" id="lm-rate-group" ${foreign ? '' : 'hidden'}>
        <label class="form-label" for="lm-exchange-rate">${t('budget.loanExchangeRateLabel')}</label>
        <input type="number" class="form-input" id="lm-exchange-rate" step="0.000001" min="0.000001"
               inputmode="decimal" value="${foreign ? esc(String(rate)) : ''}">
      </div>
    </div>
    <p class="form-hint budget-loan-hint" id="lm-rate-hint" ${foreign ? '' : 'hidden'}></p>`;
}




function wireLoanCurrencyFields(panel) {
  const select = panel.querySelector('#lm-currency');
  if (!select) return;
  appendCurrencyOptions(select, select.dataset.selected || state.currency);

  const rateGroup = panel.querySelector('#lm-rate-group');
  const rateInput = panel.querySelector('#lm-exchange-rate');
  const hint = panel.querySelector('#lm-rate-hint');

  const update = ({ currencyChanged = false } = {}) => {



    applyAmountFormat(panel.querySelector('#lm-amount'), select.value, { required: true });
    applyAmountFormat(panel.querySelector('#lm-principal'), select.value, { required: true });

    const foreign = select.value !== state.currency;
    rateGroup.hidden = !foreign;
    hint.hidden = !foreign;
    if (!foreign) return;



    if (currencyChanged) rateInput.value = '';
    hint.textContent = t('budget.loanExchangeRateHint', {
      currency: select.value,
      base: state.currency,
    });
  };

  select.addEventListener('change', () => update({ currencyChanged: true }));
  update();
}





function loanIdentityFieldsHtml(loan) {
  const borrowed = isBorrowedLoan(loan);
  return `
    <div class="form-group">
      <label class="form-label" for="lm-direction">${t('budget.loanDirectionLabel')}</label>
      <select class="form-input" id="lm-direction">
        <option value="lent" ${borrowed ? '' : 'selected'}>${t('budget.loanDirectionLent')}</option>
        <option value="borrowed" ${borrowed ? 'selected' : ''}>${t('budget.loanDirectionBorrowed')}</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label" for="lm-borrower" id="lm-borrower-label">${
        t(borrowed ? 'budget.loanLenderLabel' : 'budget.loanBorrowerLabel')
      }</label>
      <input type="text" class="form-input" id="lm-borrower"
             placeholder="${t(borrowed ? 'budget.loanLenderPlaceholder' : 'budget.loanBorrowerPlaceholder')}"
             value="${esc(loan?.borrower ?? '')}">
    </div>
    <div class="form-group">
      <label class="form-label" for="lm-title">${t('budget.loanTitleLabel')}</label>
      <input type="text" class="form-input" id="lm-title"
             placeholder="${t('budget.loanTitlePlaceholder')}" value="${esc(loan?.title ?? '')}">
    </div>
    ${loanAccountFieldHtml(loan)}`;
}




function loanAccountFieldHtml(loan) {
  if (!(state.accounts?.length)) return '';
  const opts = `<option value="">${t('budget.noAccount')}</option>` + state.accounts.map((a) =>
    `<option value="${a.id}" ${loan?.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`
  ).join('');
  return `
    <div class="form-group">
      <label class="form-label" for="lm-account">${t('budget.loanAccountLabel')}</label>
      <select class="form-input" id="lm-account">${opts}</select>
    </div>`;
}




function wireLoanDirectionField(panel) {
  const dirSel = panel.querySelector('#lm-direction');
  if (!dirSel) return;
  const label = panel.querySelector('#lm-borrower-label');
  const input = panel.querySelector('#lm-borrower');
  dirSel.addEventListener('change', () => {
    const borrowed = dirSel.value === 'borrowed';
    if (label) label.textContent = t(borrowed ? 'budget.loanLenderLabel' : 'budget.loanBorrowerLabel');
    if (input) input.placeholder = t(borrowed ? 'budget.loanLenderPlaceholder' : 'budget.loanBorrowerPlaceholder');
  });
}





function loanInterestFieldsHtml(loan) {
  const it = loan?.interest ?? null;
  const mode = it?.mode ?? 'none';


  const currency = loan?.currency || state.currency;
  const v = (x) => (x != null ? esc(String(x)) : '');
  const opt = (val, key) => `<option value="${val}" ${mode === val ? 'selected' : ''}>${t(key)}</option>`;
  return `
    <div class="form-group">
      <label class="form-label" for="lm-interest-mode">${t('budget.loanInterestModeLabel')}</label>
      <select class="form-input" id="lm-interest-mode">
        ${opt('none', 'budget.loanInterestNone')}
        ${opt('fixed', 'budget.loanInterestFixed')}
        ${opt('variable', 'budget.loanInterestVariable')}
        ${opt('fixed_then_variable', 'budget.loanInterestFixedThenVariable')}
      </select>
    </div>
    <div id="lm-interest-fields" ${mode === 'none' ? 'hidden' : ''}>
      <div class="form-group">
        <label class="form-label" for="lm-principal">${t('budget.loanPrincipalLabel')}</label>
        <input type="number" class="form-input" id="lm-principal"
               step="${amountStep(currency, it?.principal ?? '')}" min="${amountMin(currency, it?.principal ?? '')}"
               placeholder="${amountPlaceholder(currency)}" inputmode="decimal" value="${v(it?.principal)}">
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label" for="lm-fixed-rate" id="lm-fixed-rate-label">${
            t(mode === 'variable' ? 'budget.loanVariableRateLabel' : 'budget.loanFixedRateLabel')
          }</label>
          <input type="number" class="form-input" id="lm-fixed-rate" step="0.01" min="0" max="100"
                 inputmode="decimal" value="${v(it?.fixed_rate)}">
        </div>
        <div class="form-group">
          <label class="form-label" for="lm-initial-repayment">${t('budget.loanInitialRepaymentLabel')}</label>
          <input type="number" class="form-input" id="lm-initial-repayment" step="0.01" min="0.01" max="100"
                 inputmode="decimal" value="${v(it?.initial_repayment_rate)}">
        </div>
      </div>
      <div id="lm-variable-fields" class="form-grid-2" ${mode === 'fixed_then_variable' ? '' : 'hidden'}>
        <div class="form-group">
          <label class="form-label" for="lm-fixed-period">${t('budget.loanFixedPeriodLabel')}</label>
          <input type="number" class="form-input" id="lm-fixed-period" step="1" min="1" max="600"
                 inputmode="numeric" value="${v(it?.fixed_period_months)}">
        </div>
        <div class="form-group">
          <label class="form-label" for="lm-followup-rate">${t('budget.loanFollowupRateLabel')}</label>
          <input type="number" class="form-input" id="lm-followup-rate" step="0.01" min="0" max="100"
                 inputmode="decimal" value="${v(it?.followup_rate)}">
        </div>
      </div>
      <p class="form-hint budget-loan-hint" id="lm-variable-hint" ${mode === 'variable' ? '' : 'hidden'}>${
        t('budget.loanVariableHint')
      }</p>
      <p class="form-hint budget-loan-hint" id="lm-interest-preview" aria-live="polite"></p>
    </div>`;
}

// Verdrahtet den Zinsmodus-Umschalter: blendet Betrag/Ratenanzahl vs. Zinsfelder


function wireLoanInterestFields(panel) {
  const modeSel = panel.querySelector('#lm-interest-mode');
  if (!modeSel) return;
  const interestFields = panel.querySelector('#lm-interest-fields');
  const variableFields = panel.querySelector('#lm-variable-fields');
  const manualFields = panel.querySelector('#lm-manual-fields');
  const preview = panel.querySelector('#lm-interest-preview');
  const rateLabel = panel.querySelector('#lm-fixed-rate-label');
  const variableHint = panel.querySelector('#lm-variable-hint');
  let timer = null;

  const requestPreview = () => {
    const mode = modeSel.value;
    if (mode === 'none') { preview.textContent = ''; return; }
    const body = {
      interest_mode: mode,
      principal: parseFloat(panel.querySelector('#lm-principal').value),
      fixed_rate: parseFloat(panel.querySelector('#lm-fixed-rate').value),
      initial_repayment_rate: parseFloat(panel.querySelector('#lm-initial-repayment').value),
    };
    if (mode === 'fixed_then_variable') {
      body.fixed_period_months = parseInt(panel.querySelector('#lm-fixed-period').value, 10);
      body.followup_rate = parseFloat(panel.querySelector('#lm-followup-rate').value);
    }
    const incomplete = !(body.principal > 0) || !(body.fixed_rate >= 0) || !(body.initial_repayment_rate > 0)
      || (mode === 'fixed_then_variable' && !(body.fixed_period_months > 0 && body.followup_rate >= 0));
    if (incomplete) { preview.textContent = ''; return; }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const { data } = await api.post('/budget/loans/preview', body);
        if (!data?.ok) { preview.textContent = t('budget.loanPreviewInvalid'); return; }


        const currency = panel.querySelector('#lm-currency')?.value || state.currency;
        preview.textContent = t('budget.loanPreviewSummary', {
          rate: formatAmount(data.monthly_payment, currency),
          term: t('budget.loanTermYearsMonths', { years: Math.floor(data.total_months / 12), months: data.total_months % 12 }),
          interest: formatAmount(data.total_interest, currency),
        });
      } catch { preview.textContent = ''; }
    }, 300);
  };

  const update = () => {
    const interest = modeSel.value !== 'none';


    const isVariable = modeSel.value === 'variable';
    interestFields.hidden = !interest;
    variableFields.hidden = modeSel.value !== 'fixed_then_variable';
    if (rateLabel) {
      rateLabel.textContent = t(isVariable ? 'budget.loanVariableRateLabel' : 'budget.loanFixedRateLabel');
    }
    if (variableHint) variableHint.hidden = !isVariable;
    if (manualFields) manualFields.hidden = interest;
    requestPreview();
  };

  modeSel.addEventListener('change', update);
  ['lm-principal', 'lm-fixed-rate', 'lm-initial-repayment', 'lm-fixed-period', 'lm-followup-rate']
    .forEach((id) => panel.querySelector('#' + id)?.addEventListener('input', requestPreview));
  update();
}

function wireLoanPaidInstallmentsField(panel) {
  const paid = panel.querySelector('#lm-paid');
  if (!paid) return;
  const start = panel.querySelector('#lm-start');
  let touched = false;
  paid.addEventListener('input', () => { touched = true; });

  const suggest = () => {
    if (touched) return;
    const m = /^(\d{4})-(\d{2})$/.exec(start.value || '');
    if (!m) return;
    const now = todayMonth.split('-');
    const months = (Number(now[0]) - Number(m[1])) * 12 + (Number(now[1]) - Number(m[2]));
    paid.value = String(Math.max(0, months));
  };
  start.addEventListener('change', suggest);
  suggest();
}

async function saveLoanFromPanel(panel, saveBtn, { loan = null, closeAfterSave = false } = {}) {
  const isEdit = Boolean(loan);
  const borrower = panel.querySelector('#lm-borrower').value.trim();
  const title = panel.querySelector('#lm-title').value.trim() || borrower;
  const start_month = panel.querySelector('#lm-start').value;

  // behandelt beides als "nichts nachtragen".
  const paidField = panel.querySelector('#lm-paid');
  const paidInstallments = paidField && paidField.value.trim() !== ''
    ? parseInt(paidField.value, 10)
    : null;
  const notes = panel.querySelector('#lm-notes').value.trim();
  const mode = panel.querySelector('#lm-interest-mode')?.value ?? 'none';

  if (!borrower) {
    reportFieldError(panel.querySelector('#lm-borrower'), t('budget.loanBorrowerRequired'));
    return;
  }
  if (!/^\d{4}-\d{2}$/.test(start_month)) {
    reportFieldError(panel.querySelector('#lm-start'), t('budget.loanStartMonthRequired'));
    return;
  }



  const currency = panel.querySelector('#lm-currency')?.value || state.currency;
  let exchange_rate = 1;
  if (currency !== state.currency) {
    exchange_rate = parseFloat(panel.querySelector('#lm-exchange-rate').value);
    if (!Number.isFinite(exchange_rate) || exchange_rate <= 0) {
      reportFieldError(panel.querySelector('#lm-exchange-rate'), t('budget.loanExchangeRateRequired'));
      return;
    }
  }

  let body;
  if (mode === 'none') {
    const total_amount = parseFloat(panel.querySelector('#lm-amount').value);
    const installment_count = parseInt(panel.querySelector('#lm-installments').value, 10);
    if (isNaN(total_amount) || total_amount <= 0) {
      reportFieldError(panel.querySelector('#lm-amount'), t('budget.validAmountRequired'));
      return;
    }


    if (rejectOffGridAmount(panel.querySelector('#lm-amount'), total_amount, currency, {
      original: loan?.total_amount ?? null,
      originalCurrency: loan?.currency || (loan ? state.currency : null),
    })) return;
    if (!Number.isInteger(installment_count) || installment_count < 1) {
      reportFieldError(panel.querySelector('#lm-installments'), t('budget.loanInstallmentsRequired'));
      return;
    }
    body = { borrower, title, start_month, notes, interest_mode: 'none', total_amount, installment_count };
    if (paidInstallments !== null) body.paid_installments = paidInstallments;
  } else {
    const principal = parseFloat(panel.querySelector('#lm-principal').value);
    const fixed_rate = parseFloat(panel.querySelector('#lm-fixed-rate').value);
    const initial_repayment_rate = parseFloat(panel.querySelector('#lm-initial-repayment').value);
    if (isNaN(principal) || principal <= 0) {
      reportFieldError(panel.querySelector('#lm-principal'), t('budget.loanPrincipalRequired'));
      return;
    }
    if (rejectOffGridAmount(panel.querySelector('#lm-principal'), principal, currency, {
      original: loan?.interest?.principal ?? null,
      originalCurrency: loan?.currency || (loan ? state.currency : null),
    })) return;
    if (isNaN(fixed_rate) || fixed_rate < 0 || fixed_rate > 100) {
      reportFieldError(panel.querySelector('#lm-fixed-rate'), t('budget.loanRateRequired'));
      return;
    }
    if (isNaN(initial_repayment_rate) || initial_repayment_rate <= 0 || initial_repayment_rate > 100) {
      reportFieldError(panel.querySelector('#lm-initial-repayment'), t('budget.loanRepaymentRequired'));
      return;
    }
    body = { borrower, title, start_month, notes, interest_mode: mode, principal, fixed_rate, initial_repayment_rate };
    if (paidInstallments !== null) body.paid_installments = paidInstallments;
    if (mode === 'fixed_then_variable') {
      const fixed_period_months = parseInt(panel.querySelector('#lm-fixed-period').value, 10);
      const followup_rate = parseFloat(panel.querySelector('#lm-followup-rate').value);
      if (!Number.isInteger(fixed_period_months) || fixed_period_months < 1 || fixed_period_months > 600) {
        reportFieldError(panel.querySelector('#lm-fixed-period'), t('budget.loanFixedPeriodRequired'));
        return;
      }
      if (isNaN(followup_rate) || followup_rate < 0 || followup_rate > 100) {
        reportFieldError(panel.querySelector('#lm-followup-rate'), t('budget.loanRateRequired'));
        return;
      }
      body.fixed_period_months = fixed_period_months;
      body.followup_rate = followup_rate;
    }
  }
  body.currency = currency;
  body.exchange_rate = exchange_rate;



  body.direction = panel.querySelector('#lm-direction')?.value === 'borrowed' ? 'borrowed' : 'lent';
  const accountSel = panel.querySelector('#lm-account');
  if (accountSel) body.account_id = accountSel.value === '' ? null : parseInt(accountSel.value, 10);

  saveBtn.disabled = true;
  saveBtn.textContent = '…';
  try {
    if (isEdit) {
      await api.put(`/budget/loans/${loan.id}`, body);
    } else {
      await api.post('/budget/loans', body);
    }
    await loadMonth(state.month);
    if (closeAfterSave) closeModal({ force: true });
    renderBody();
    window.aashiyana?.showToast(isEdit ? t('budget.loanSavedToast') : t('budget.loanAddedToast'), 'success');
  } catch (err) {
    window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
    saveBtn.disabled = false;
    saveBtn.textContent = isEdit ? t('common.save') : t('budget.createLoan');
  }
}

function openLoanModal(loan = null) {
  const isEdit = Boolean(loan);
  const todayMonth = todayKey().slice(0, 7);
  const loanCurrency = loan?.currency || state.currency;


  const content = `
    ${loanIdentityFieldsHtml(loan)}
    ${loanCurrencyFieldsHtml(loan)}
    <div class="form-grid-2" id="lm-manual-fields">
      <div class="form-group">
        <label class="form-label" for="lm-amount">${t('budget.loanAmountLabel')}</label>
        <input type="number" class="form-input" id="lm-amount"
               step="${amountStep(loanCurrency, loan ? loan.total_amount : '')}"
               min="${amountMin(loanCurrency, loan ? loan.total_amount : '')}"
               placeholder="${amountPlaceholder(loanCurrency)}" inputmode="decimal"
               value="${loan ? String(loan.total_amount) : ''}">
      </div>
      <div class="form-group">
        <label class="form-label" for="lm-installments">${t('budget.loanInstallmentsLabel')}</label>
        <input type="number" class="form-input" id="lm-installments" step="1" min="1" max="360"
               inputmode="numeric" value="${loan?.installment_count ?? ''}">
      </div>
    </div>
    ${loanInterestFieldsHtml(loan)}
    <div class="form-group">
      <label class="form-label" for="lm-start">${t('budget.loanStartMonthLabel')}</label>
      <input type="month" class="form-input" id="lm-start" value="${esc(loan?.start_month ?? todayMonth)}">
    </div>
    ${isEdit ? '' : `
    <div class="form-group">
      <label class="form-label" for="lm-paid">${t('budget.loanPaidInstallmentsLabel')}</label>
      <input type="number" class="form-input" id="lm-paid" step="1" min="0"
             inputmode="numeric" value="0">
      <p class="budget-loan-hint">${t('budget.loanPaidInstallmentsHint')}</p>
    </div>`}
    <div class="form-group">
      <label class="form-label" for="lm-notes">${t('budget.loanNotesLabel')}</label>
      <textarea class="form-input" id="lm-notes" rows="3">${esc(loan?.notes ?? '')}</textarea>
    </div>
    <div class="modal-panel__footer modal-panel__footer--plain">
      <div></div>
      <div style="display:flex;gap:var(--space-3)">
        <button class="btn btn--secondary" id="lm-cancel">${t('common.cancel')}</button>
        <button class="btn btn--primary" id="lm-save">${isEdit ? t('common.save') : t('budget.createLoan')}</button>
      </div>
    </div>`;

  openSharedModal({
    title: isEdit ? t('budget.editLoan') : t('budget.newLoan'),
    content,
    size: 'sm',
    onSave(panel) {
      wireLoanDirectionField(panel);
      wireLoanCurrencyFields(panel);
      wireLoanInterestFields(panel);
      panel.querySelector('#lm-cancel').addEventListener('click', closeModal);
      panel.querySelector('#lm-save').addEventListener('click', async () => {
        const saveBtn = panel.querySelector('#lm-save');
        await saveLoanFromPanel(panel, saveBtn, { loan, closeAfterSave: true });
      });
    },
  });
}

async function markLoanPayment(id) {
  const loan = state.loans.loans.find((item) => item.id === id);
  if (!loan?.next_installment_number) return;
  const today = todayKey();
  try {
    const res = await api.post(`/budget/loans/${id}/payments`, {
      installment_number: loan.next_installment_number,
      amount: loan.next_installment_number === loan.installment_count
        ? loan.remaining_amount
        : Math.min(loan.installment_amount, loan.remaining_amount),
      paid_date: today,
    });
    const paymentId = res.data?.payment?.id;
    await loadMonth(state.month);
    renderBody();
    vibrate(30);



    if (paymentId) {
      window.aashiyana?.showToast(t('budget.loanPaymentAddedToast'), 'default', 5000, async () => {
        try {
          await api.delete(`/budget/loans/${id}/payments/${paymentId}`);
          await loadMonth(state.month);
          renderBody();
        } catch (err) {
          window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
        }
      });
    } else {
      window.aashiyana?.showToast(t('budget.loanPaymentAddedToast'), 'success');
    }
  } catch (err) {
    window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
  }
}

async function deleteLoan(id) {
  const loan = state.loans.loans.find((item) => item.id === id);
  if (!loan) return;

  state.loans.loans = state.loans.loans.filter((item) => item.id !== id);
  renderBody();

  scheduleUndoableDelete({
    message: t('budget.loanDeletedToast'),
    commit: async ({ keepalive }) => {
      await api.delete(`/budget/loans/${id}`, { keepalive });
      if (keepalive) return; // Seite verschwindet — kein UI-Refresh mehr
      await loadMonth(state.month);
      renderBody();
    },
    restore: (err) => {
      state.loans.loans = [...state.loans.loans, loan];
      renderBody();
      if (err) window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
    },
  });
}

async function deleteLoanPayment(loanId, paymentId) {
  const loan = state.loans.loans.find((item) => item.id === loanId);
  const payment = loan?.payments?.find((item) => item.id === paymentId);

  if (loan && payment) {
    loan.payments = loan.payments.filter((item) => item.id !== paymentId);
    renderBody();
  }

  scheduleUndoableDelete({
    message: t('budget.deletedToast'),
    commit: async ({ keepalive }) => {
      await api.delete(`/budget/loans/${loanId}/payments/${paymentId}`, { keepalive });
      if (keepalive) return; // Seite verschwindet — kein UI-Refresh mehr
      await loadMonth(state.month);
      renderBody();
    },
    restore: (err) => {
      if (loan && payment) {
        loan.payments = [...(loan.payments || []), payment];
        renderBody();
      }
      if (err) window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
    },
  });
}

// --------------------------------------------------------

// --------------------------------------------------------

async function openConfirmBookingModal(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;

  const absAmount = Math.abs(entry.amount);
  const content = `
    <div class="form-group">
      <p class="form-hint">${esc(t('budget.confirmHint'))}</p>
    </div>
    <div class="form-group">
      <label class="form-label" for="cb-amount">${t('budget.amountLabel')}</label>
      <input type="number" class="form-input" id="cb-amount" inputmode="decimal"
             step="${amountStep(state.currency, absAmount)}"
             min="${amountMin(state.currency)}" value="${absAmount}">
    </div>
    <div class="form-group">
      <label class="form-label" for="cb-date">${t('budget.dateLabel')}</label>
      <aashiyana-datepicker type="date" id="cb-date" value="${esc(entry.date)}"></aashiyana-datepicker>
    </div>
    <div class="modal-panel__footer modal-panel__footer--plain">
      <button class="btn btn--secondary" id="cb-cancel">${t('common.cancel')}</button>
      <button class="btn btn--primary" id="cb-save">${t('budget.confirmAction')}</button>
    </div>`;

  openSharedModal({
    title: t('budget.confirmTitle'),
    content,
    size: 'sm',
    onSave(panel) {
      panel.querySelector('#cb-cancel').addEventListener('click', closeModal);
      panel.querySelector('#cb-save').addEventListener('click', async () => {
        const amountEl = panel.querySelector('#cb-amount');
        const value = parseFloat(amountEl.value);
        if (!Number.isFinite(value) || value <= 0) {
          reportFieldError(amountEl, t('budget.validAmountRequired'));
          return;
        }
        if (rejectOffGridAmount(amountEl, value, state.currency, { original: absAmount })) return;
        const date = panel.querySelector('#cb-date').value;
        try {
          await api.patch(`/budget/${id}/confirm`, { amount: value, date: date || undefined });
          closeModal({ force: true });
          await loadMonth(state.month);
          renderBody();
          refocusAfterRender();
          window.aashiyana?.showToast(t('budget.confirmSaved'), 'success');
        } catch (err) {
          window.aashiyana?.showToast(err.message || t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

async function deleteEntry(id) {
  const entry = state.entries.find((e) => e.id === id);

  if (entry && (entry.is_recurring || entry.recurrence_parent_id)) {
    const scope = await recurringChoiceModal({
      title: t('budget.recurringSeriesScope'),
      thisLabel: t('budget.recurringThisOnly'),
      seriesLabel: t('budget.recurringEntireSeries'),
      seriesDanger: true,
    });
    if (scope === null) return;
    if (scope === 'series') { await deleteEntrySeries(id); return; }
  }

  state.entries = state.entries.filter((e) => e.id !== id);
  renderBody();
  vibrate([30, 50, 30]);

  scheduleUndoableDelete({
    message: t('budget.deletedToast'),
    commit: async ({ keepalive }) => {
      await api.delete(`/budget/${id}`, { keepalive });
      if (keepalive) return; // Seite verschwindet — kein UI-Refresh mehr
      await loadMonth(state.month);
      renderBody();
    },
    restore: (err) => {
      if (entry) {
        state.entries = [...state.entries, entry].sort((a, b) => new Date(b.date) - new Date(a.date));
        renderBody();
      }
      if (err) window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
    },
  });
}

// --------------------------------------------------------
// Hilfsfunktion
// --------------------------------------------------------

function recurringChoiceModal({ title, thisLabel, seriesLabel, seriesDanger = false, note = '' }) {
  return new Promise((resolve) => {
    let resolved = false;
    function finish(value) {
      if (resolved) return;
      resolved = true;
      closeModal({ force: true });
      resolve(value);
    }
    openSharedModal({
      title,
      size: 'sm',
      content: `
        ${note ? `<p class="form-hint">${esc(note)}</p>` : ''}
        <div class="modal-actions modal-actions--stack">
          <button type="button" class="btn btn--secondary" id="rcs-this">${thisLabel}</button>
          <button type="button" class="btn ${seriesDanger ? 'btn--danger' : 'btn--primary'}" id="rcs-series">${seriesLabel}</button>
          <button type="button" class="btn btn--ghost" id="rcs-cancel">${t('common.cancel')}</button>
        </div>`,
      onClose: () => finish(null),
      onSave(panel) {
        panel.querySelector('#rcs-this')?.addEventListener('click', () => finish('this'));
        panel.querySelector('#rcs-series')?.addEventListener('click', () => finish('series'));
        panel.querySelector('#rcs-cancel')?.addEventListener('click', () => finish(null));
      },
    });
  });
}

async function deleteEntrySeries(id) {
  const entry = state.entries.find((e) => e.id === id);
  const parentId = entry?.recurrence_parent_id ?? (entry?.is_recurring ? entry.id : id);
  state.entries = state.entries.filter((e) => e.id !== parentId && e.recurrence_parent_id !== parentId);
  renderBody();
  vibrate([30, 50, 30]);

  scheduleUndoableDelete({
    message: t('budget.recurringSeriesDeleted'),
    commit: async ({ keepalive }) => {
      await api.delete(`/budget/${id}/series`, { keepalive });
      if (keepalive) return; // Seite verschwindet — kein UI-Refresh mehr
      await loadMonth(state.month);
      renderBody();
    },



    restore: async (err) => {
      await loadMonth(state.month);
      renderBody();
      if (err) window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
    },
  });
}
