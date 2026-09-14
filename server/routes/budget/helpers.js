
import { readFileSync } from 'node:fs';
import path from 'path';
import * as db from '../../db.js';
import {
  budgetVisibilityWhere, budgetScopeWhere, budgetDetailsHiddenWhere, canEditEntry,
  resolveBudgetMode, maskBudgetEntry, BUDGET_MASKED_CATEGORY,
} from '../../services/budget-visibility.js';
import { computeLoanSchedule, remainingPrincipalFromPayments, remainingInstallmentsForBalance } from '../../services/loan-amortization.js';
import { todayKey } from '../../utils/timezone.js';

// --------------------------------------------------------



// --------------------------------------------------------

export function getBudgetMode() {
  return resolveBudgetMode(db.get());
}

/** Betrachtende User-ID (Session oder Token-Auth). requireAuth setzt authUserId immer. */
export function viewerId(req) {
  return req.authUserId || req.session.userId;
}

export function budgetFilter(req, alias, { scoped = true } = {}) {
  const mode = getBudgetMode();
  if (mode !== 'personal') return { clause: '', params: [] };
  const me = viewerId(req);
  let clause = ` AND ${budgetVisibilityWhere(alias, '?', { mode })}`;
  const params = [me];
  if (scoped) {
    const scope = req.query.scope === 'household' ? 'household' : 'mine';
    clause += ` AND ${budgetScopeWhere(scope, alias, '?')}`;
    if (scope === 'mine') params.push(me); // household-Fragment hat keinen Bind
  }
  return { clause, params };
}

export function budgetCategoryExpr(req, alias) {
  const mode = getBudgetMode();
  if (mode !== 'personal') return { expr: `${alias}.category`, params: [] };
  return {
    expr: `CASE WHEN ${budgetDetailsHiddenWhere(alias, '?', { mode })}`
        + ` THEN '${BUDGET_MASKED_CATEGORY}' ELSE ${alias}.category END`,
    params: [viewerId(req)],
  };
}

export function maskEntries(req, rows) {
  const mode = getBudgetMode();
  if (mode !== 'personal') return rows;
  const me = viewerId(req);
  return rows.map((row) => maskBudgetEntry(row, me, mode));
}

export function mayEdit(req, row) {
  if (getBudgetMode() !== 'personal') return true;
  return canEditEntry(row, { id: viewerId(req) });
}

const LOCALE_CACHE = new Map();
const SUPPORTED_LANGS = new Set([
  'ar', 'cs', 'de', 'el', 'en', 'es', 'fr', 'hi', 'it', 'ja',
  'nl', 'pl', 'pt', 'ru', 'sv', 'tr', 'uk', 'vi', 'zh',
]);
const CATEGORY_LABEL_KEYS = {
  housing: 'catHousing',
  food: 'catFood',
  transport: 'catTransport',
  personal_health: 'catPersonalHealth',
  leisure: 'catLeisure',
  shopping_clothing: 'catShoppingClothing',
  education: 'catEducation',
  financial_other: 'catFinancialOther',
  subscriptions: 'catSubscriptions',
  'Erwerbseinkommen': 'catEarnedIncome',
  'Kapitalerträge': 'catInvestmentIncome',
  'Geschenke & Transfers': 'catTransferGiftIncome',
  'Sozialleistungen': 'catGovernmentBenefits',
  'Sonstiges Einkommen': 'catOtherIncome',
};
const SUBCATEGORY_LABEL_KEYS = {
  rent_mortgage: 'subcatRentMortgage',
  condominium: 'subcatCondominium',
  utilities: 'subcatUtilities',
  internet_tv_phone: 'subcatInternetTvPhone',
  renovation_maintenance: 'subcatRenovationMaintenance',
  cleaning: 'subcatCleaning',
  groceries: 'subcatGroceries',
  restaurants_bars: 'subcatRestaurantsBars',
  snacks_fast_food: 'subcatSnacksFastFood',
  bakery: 'subcatBakery',
  fuel: 'subcatFuel',
  parking_tolls: 'subcatParkingTolls',
  public_transport: 'subcatPublicTransport',
  apps_taxi: 'subcatAppsTaxi',
  maintenance_insurance: 'subcatMaintenanceInsurance',
  pharmacy: 'subcatPharmacy',
  health_insurance: 'subcatHealthInsurance',
  gym_sports: 'subcatGymSports',
  beauty_cosmetics: 'subcatBeautyCosmetics',
  travel: 'subcatTravel',
  streaming: 'subcatStreaming',
  events: 'subcatEvents',
  hobbies: 'subcatHobbies',
  clothes_shoes: 'subcatClothesShoes',
  electronics: 'subcatElectronics',
  gifts: 'subcatGifts',
  courses_college: 'subcatCoursesCollege',
  school_supplies: 'subcatSchoolSupplies',
  languages: 'subcatLanguages',
  loans_interest: 'subcatLoansInterest',
  bank_fees: 'subcatBankFees',
  insurance_other: 'subcatInsuranceOther',
  investments: 'subcatInvestments',
  taxes: 'subcatTaxes',
  subscription_entertainment: 'subcatSubscriptionEntertainment',
  subscription_productivity: 'subcatSubscriptionProductivity',
  subscription_utilities: 'subcatSubscriptionUtilities',
  subscription_health: 'subcatSubscriptionHealth',
  subscription_education: 'subcatSubscriptionEducation',
  subscription_other: 'subcatSubscriptionOther',
};

export function normalizeLang(raw) {
  const lang = String(raw || 'en').trim().toLowerCase();
  const base = lang.split(/[-_]/)[0];
  return SUPPORTED_LANGS.has(base) ? base : 'en';
}

export function budgetMessages(lang) {
  const normalized = normalizeLang(lang);
  if (!LOCALE_CACHE.has(normalized)) {
    const localePath = path.join(import.meta.dirname, '..', '..', '..', 'public', 'locales', `${normalized}.json`);
    const parsed = JSON.parse(readFileSync(localePath, 'utf-8'));
    LOCALE_CACHE.set(normalized, parsed.budget || {});
  }
  return LOCALE_CACHE.get(normalized);
}

export function localizedCategory(category, lang) {
  const budget = budgetMessages(lang);
  const labelKey = CATEGORY_LABEL_KEYS[category.key];
  return {
    ...category,
    label: labelKey ? (budget[labelKey] || category.name) : category.name,
  };
}

export function localizedSubcategory(subcategory, lang) {
  const budget = budgetMessages(lang);
  const labelKey = SUBCATEGORY_LABEL_KEYS[subcategory.key];
  return {
    ...subcategory,
    label: labelKey ? (budget[labelKey] || subcategory.name) : subcategory.name,
  };
}

// --------------------------------------------------------

// --------------------------------------------------------

export const RECURRENCE_INTERVAL_KEYS = ['weekly', 'monthly', 'yearly'];



export const MAX_INTERVAL_COUNT = 99;

export function normalizeIntervalCount(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_INTERVAL_COUNT);
}

export function occurrencesPerYear(interval, count = 1) {
  const n = normalizeIntervalCount(count);
  if (interval === 'weekly') return 52 / n;
  if (interval === 'yearly') return 1 / n;
  return 12 / n;
}

export function effectiveMonthly(amount, interval, count = 1) {
  return cents(Number(amount || 0) * occurrencesPerYear(interval, count) / 12);
}

export function bookedOnly(alias = '') {
  return ` AND ${alias ? `${alias}.` : ''}is_pending = 0`;
}

const MS_PER_DAY = 86_400_000;

export function occurrenceDatesInMonth(startDate, interval, count, month) {
  const step = normalizeIntervalCount(count);
  const [y, m] = month.split('-').map(Number);
  const [sy, sm, sd] = startDate.split('-').map(Number);
  if (!y || !m || !sy) return [];

  if (interval === 'weekly') {
    const start      = Date.UTC(sy, sm - 1, sd);
    const monthStart = Date.UTC(y, m - 1, 1);
    const monthEnd   = Date.UTC(y, m, 0);
    const stepMs     = step * 7 * MS_PER_DAY;


    let i = Math.max(1, Math.ceil((monthStart - start) / stepMs));
    const dates = [];
    for (let at = start + i * stepMs; at <= monthEnd; at += stepMs) {
      if (at >= monthStart) dates.push(ymd(new Date(at)));
    }
    return dates;
  }

  const monthsPer = (interval === 'yearly' ? 12 : 1) * step;
  const monthsDiff = (y - sy) * 12 + (m - sm);
  if (monthsDiff < 1 || monthsDiff % monthsPer !== 0) return [];

  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-${String(Math.min(sd, lastDay)).padStart(2, '0')}`];
}

export function generateRecurringInstances(database, month) {
  const [y, m] = month.split('-').map(Number);


  const originals = database.prepare(`
    SELECT * FROM budget_entries
    WHERE is_recurring = 1 AND recurrence_parent_id IS NULL
      AND strftime('%Y-%m', date) < ?
  `).all(month);

  const skipStmt = database.prepare(
    'SELECT 1 FROM budget_recurrence_skipped WHERE parent_id = ? AND date = ?'
  );
  const existsStmt = database.prepare(
    'SELECT id FROM budget_entries WHERE recurrence_parent_id = ? AND date = ?'
  );
  const insertStmt = database.prepare(`
    INSERT INTO budget_entries
      (title, amount, category, subcategory, date, is_recurring, recurrence_parent_id,
       created_by, owner_id, visibility, is_pending, account_id)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `);

  const copyResponsiblesStmt = database.prepare(`
    INSERT OR IGNORE INTO budget_entry_responsibles (entry_id, user_id)
    SELECT ?, user_id FROM budget_entry_responsibles WHERE entry_id = ?
  `);

  for (const orig of originals) {
    const interval = orig.recurrence_interval || 'monthly';





    const dates = orig.recurrence_virtual
      ? [`${month}-${String(Math.min(
          parseInt(orig.date.split('-')[2], 10),
          new Date(Date.UTC(y, m, 0)).getUTCDate(),
        )).padStart(2, '0')}`]
      : occurrenceDatesInMonth(orig.date, interval, orig.recurrence_interval_count, month);

    for (const date of dates) {



      if (skipStmt.get(orig.id, date)) continue;
      if (existsStmt.get(orig.id, date)) continue;













      //






      // Gemessen: acht Monate einer virtuellen Jahresserie ergaben -800


      const inheritsAccount = orig.recurrence_virtual ? null : (orig.account_id ?? null);
      const created = insertStmt.run(
        orig.title, orig.amount, orig.category, orig.subcategory || '', date,
        orig.id, orig.created_by, orig.owner_id, orig.visibility || 'shared',
        orig.recurrence_confirm ? 1 : 0, inheritsAccount,
      );






      copyResponsiblesStmt.run(created.lastInsertRowid, orig.id);
    }
  }
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const STATS_RANGES = new Set(['week', 'month', 'year']);

export function ymd(d) { return d.toISOString().slice(0, 10); }        // YYYY-MM-DD (UTC)
export function ym(d)  { return d.toISOString().slice(0, 7);  }        // YYYY-MM   (UTC)

export function todayLocalDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function thisMonthLocalKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function computeStatsRange(range, anchor) {
  if (!STATS_RANGES.has(range)) throw new Error('invalid range');
  if (!DATE_RE.test(anchor)) throw new Error('invalid anchor');
  const a = new Date(`${anchor}T00:00:00Z`);
  if (Number.isNaN(a.getTime())) throw new Error('invalid anchor');

  if (range === 'week') {
    const dow = (a.getUTCDay() + 6) % 7; // Mo=0 .. So=6
    const start = new Date(a); start.setUTCDate(a.getUTCDate() - dow);
    const end   = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    const prevS = new Date(start); prevS.setUTCDate(start.getUTCDate() - 7);
    const prevE = new Date(start); prevE.setUTCDate(start.getUTCDate() - 1);
    const bucketKeys = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
      bucketKeys.push(ymd(d));
    }
    return { range, from: ymd(start), to: ymd(end), prevFrom: ymd(prevS), prevTo: ymd(prevE), granularity: 'day', bucketKeys };
  }

  if (range === 'month') {
    const y = a.getUTCFullYear(), m = a.getUTCMonth();
    const start = new Date(Date.UTC(y, m, 1));
    const end   = new Date(Date.UTC(y, m + 1, 0));
    const prevS = new Date(Date.UTC(y, m - 1, 1));
    const prevE = new Date(Date.UTC(y, m, 0));
    const bucketKeys = [];
    for (let d = 1; d <= end.getUTCDate(); d++) bucketKeys.push(ymd(new Date(Date.UTC(y, m, d))));
    return { range, from: ymd(start), to: ymd(end), prevFrom: ymd(prevS), prevTo: ymd(prevE), granularity: 'day', bucketKeys };
  }

  // year
  const y = a.getUTCFullYear();
  const bucketKeys = [];
  for (let mo = 0; mo < 12; mo++) bucketKeys.push(ym(new Date(Date.UTC(y, mo, 1))));
  return {
    range, from: `${y}-01-01`, to: `${y}-12-31`,
    prevFrom: `${y - 1}-01-01`, prevTo: `${y - 1}-12-31`,
    granularity: 'month', bucketKeys,
  };
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'category';
}

export function uniqueKey(table, base) {
  const normalized = slugify(base);
  let key = normalized;
  let i = 2;
  const exists = db.get().prepare(`SELECT 1 FROM ${table} WHERE key = ?`);
  while (exists.get(key)) {
    key = `${normalized}_${i}`;
    i += 1;
  }
  return key;
}

export function categoryInUseCount(database, key) {
  return database.prepare('SELECT COUNT(*) AS n FROM budget_entries WHERE category = ?').get(key).n;
}

export function subcategoryInUseCount(database, key) {
  return database.prepare('SELECT COUNT(*) AS n FROM budget_entries WHERE subcategory = ?').get(key).n;
}

export function categoryCountByType(database, type) {
  return database.prepare('SELECT COUNT(*) AS n FROM budget_categories WHERE type = ?').get(type).n;
}

export function subcategoryCountForCategory(database, categoryKey) {
  return database.prepare('SELECT COUNT(*) AS n FROM budget_subcategories WHERE category_key = ?').get(categoryKey).n;
}

export function loadBudgetMeta() {
  const categories = db.get().prepare(`
    SELECT key, name, type, sort_order
    FROM budget_categories
    ORDER BY type DESC, sort_order ASC, name COLLATE NOCASE ASC
  `).all();
  const subcategories = db.get().prepare(`
    SELECT key, category_key, name, sort_order
    FROM budget_subcategories
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `).all();

  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const incomeCategories = categories.filter((c) => c.type === 'income');



  const subcategoriesByCategory = {};
  for (const sub of subcategories) {
    if (!subcategoriesByCategory[sub.category_key]) subcategoriesByCategory[sub.category_key] = [];
    subcategoriesByCategory[sub.category_key].push(sub);
  }

  return { categories, expenseCategories, incomeCategories, subcategories: subcategoriesByCategory };
}

export function validCategoryKeys() {
  return db.get().prepare('SELECT key FROM budget_categories').all().map((c) => c.key);
}

export function validExpenseCategoryKeys() {
  return db.get().prepare("SELECT key FROM budget_categories WHERE type = 'expense'").all().map((c) => c.key);
}

export function defaultCategory(type) {
  const row = db.get().prepare(`
    SELECT key FROM budget_categories WHERE type = ? ORDER BY sort_order ASC, name COLLATE NOCASE ASC LIMIT 1
  `).get(type);
  return row?.key || (type === 'expense' ? 'financial_other' : 'Sonstiges Einkommen');
}

export function defaultSubcategory(category) {
  const row = db.get().prepare(`
    SELECT key FROM budget_subcategories WHERE category_key = ? ORDER BY sort_order ASC, name COLLATE NOCASE ASC LIMIT 1
  `).get(category);
  return row?.key || '';
}

export function validateSubcategory(category, subcategory) {
  if (!subcategory) return defaultSubcategory(category);
  const row = db.get().prepare(`
    SELECT 1 FROM budget_subcategories WHERE category_key = ? AND key = ?
  `).get(category, subcategory);
  return row ? subcategory : null;
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function cents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// --------------------------------------------------------

// --------------------------------------------------------

export const CURRENCY_RE = /^[A-Z]{3}$/;

export function budgetCurrency() {
  return db.get().prepare("SELECT value FROM sync_config WHERE key = 'currency'").get()?.value || 'EUR';
}

export function loanRate(loan) {
  const rate = Number(loan?.exchange_rate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function toBudgetAmount(amount, loan) {
  return cents(Number(amount || 0) * loanRate(loan));
}

export function fromBudgetAmount(amount, loan) {
  return cents(Number(amount || 0) / loanRate(loan));
}

// --------------------------------------------------------
// Richtung eines Darlehens (#638)
// --------------------------------------------------------




export const LOAN_DIRECTIONS = ['lent', 'borrowed'];




//





export const REPAYMENT_BOOKING = {
  lent: { sign: 1, category: 'Geschenke & Transfers', subcategory: '' },
  borrowed: { sign: -1, category: 'financial_other', subcategory: 'loans_interest' },
};

export function bookingFor(direction) {
  return REPAYMENT_BOOKING[direction] || REPAYMENT_BOOKING.lent;
}

export function loanSummaryRow(loan, baseCurrency = budgetCurrency()) {
  const payments = db.get().prepare(`
    SELECT p.*, u.display_name AS creator_name,
           b.title AS entry_title,
           b.category AS entry_category,
           b.subcategory AS entry_subcategory,
           b.is_recurring AS entry_is_recurring,
           b.recurrence_parent_id AS entry_recurrence_parent_id
    FROM budget_loan_payments p
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN budget_entries b ON b.id = p.budget_entry_id
    WHERE p.loan_id = ?
    ORDER BY p.installment_number ASC
  `).all(loan.id);
  const paidAmount = cents(payments.reduce((sum, p) => sum + Number(p.amount || 0), 0));
  const paidInstallments = payments.length;
  const remainingAmount = Math.max(0, cents(loan.total_amount - paidAmount));
  const remainingInstallments = Math.max(0, loan.installment_count - paidInstallments);




  const interest = loanInterestSummary(loan, payments);
  const installmentAmount = interest ? interest.monthly_payment : cents(loan.total_amount / loan.installment_count);





  // keinen Zinsanteil, dort sind beide identisch.
  const remainingPrincipal = interest ? interest.remaining_principal : remainingAmount;





  // Zaehlung, keine Schuld); zinsfreie Darlehen laufen ueber denselben Ausdruck,
  // weil remainingPrincipal dort remainingAmount IST.
  const settled = remainingInstallments <= 0 || remainingPrincipal <= 0.005;




  const currency = loan.currency || baseCurrency;
  const rate = currency === baseCurrency ? 1 : loanRate(loan);

  return {
    ...loan,
    currency,
    exchange_rate: rate,
    is_foreign_currency: currency !== baseCurrency,
    total_amount: cents(loan.total_amount),
    installment_amount: installmentAmount,
    paid_amount: paidAmount,
    paid_installments: paidInstallments,
    remaining_amount: remainingAmount,
    remaining_principal: remainingPrincipal,
    remaining_installments: remainingInstallments,
    // Dieselbe Zahl, aber am Kontostand statt am Vertrag gerechnet (#964).

    // Oberflaeche zeigt dann allein die Planzahl.
    remaining_installments_forecast: forecastRemainingInstallments(loan, interest, paidInstallments),
    is_settled: settled,
    next_installment_number: !settled ? paidInstallments + 1 : null,
    next_due_month: !settled ? addMonths(loan.start_month, paidInstallments) : null,
    interest,
    payments,
  };
}


// (exakte Monatsrate, Gesamtzins, Restschuld nach Zinsbindung). Zinsfreie




export function loanInterestSummary(loan, payments = []) {
  if (!loan.interest_mode || loan.interest_mode === 'none' || loan.principal == null) return null;
  const calc = computeLoanSchedule({
    principal: loan.principal,
    fixedRate: loan.fixed_rate,
    initialRepaymentRate: loan.initial_repayment_rate,
    interestMode: loan.interest_mode,
    fixedPeriodMonths: loan.fixed_period_months,
    followupRate: loan.followup_rate,
  });
  if (!calc.ok) return null;
  return {
    mode: loan.interest_mode,
    principal: cents(loan.principal),
    fixed_rate: loan.fixed_rate,
    initial_repayment_rate: loan.initial_repayment_rate,
    fixed_period_months: loan.fixed_period_months,
    followup_rate: loan.followup_rate,
    monthly_payment: calc.monthlyPayment,
    total_interest: calc.totalInterest,
    remaining_principal: remainingPrincipalFromPayments({
      principal: loan.principal,
      fixedRate: loan.fixed_rate,
      interestMode: loan.interest_mode,
      fixedPeriodMonths: loan.fixed_period_months,
      followupRate: loan.followup_rate,
    }, payments),
    remaining_after_binding: calc.remainingAfterBinding,
    binding_end_month: loan.fixed_period_months ? addMonths(loan.start_month, loan.fixed_period_months) : null,
  };
}

function forecastRemainingInstallments(loan, interest, paidInstallments) {
  if (!interest) return null;
  const zahl = remainingInstallmentsForBalance({
    balance: interest.remaining_principal,
    monthlyPayment: interest.monthly_payment,
    fixedRate: loan.fixed_rate,
    interestMode: loan.interest_mode,
    fixedPeriodMonths: loan.fixed_period_months,
    followupRate: loan.followup_rate,
    paidInstallments,
  });
  return zahl;
}

export function loadLoan(id, baseCurrency = budgetCurrency()) {
  const loan = db.get().prepare(`
    SELECT l.*, u.display_name AS creator_name
    FROM budget_loans l
    LEFT JOIN users u ON u.id = l.created_by
    WHERE l.id = ?
  `).get(id);
  return loan ? loanSummaryRow(loan, baseCurrency) : null;
}

export function refreshLoanStatus(loanId) {
  const loan = loadLoan(loanId);
  if (!loan) return null;


  // ungebucht bleiben (deren Zinsen schuldet niemand nach).
  const status = loan.is_settled ? 'paid' : 'active';
  if (status !== loan.status) {
    db.get().prepare('UPDATE budget_loans SET status = ? WHERE id = ?').run(status, loanId);
    return loadLoan(loanId);
  }
  return loan;
}

export const RESPONSIBLE_USERS_SQL = `(
  SELECT json_group_array(json_object(
    'id', ru.id, 'display_name', ru.display_name, 'color', ru.avatar_color
  ))
  FROM budget_entry_responsibles ber JOIN users ru ON ru.id = ber.user_id
  WHERE ber.entry_id = b.id
) AS responsible_users_json`;

export function replaceResponsibles(entryId, rawUserIds) {
  if (rawUserIds === undefined) return;
  const ids = Array.isArray(rawUserIds)
    ? [...new Set(rawUserIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  db.get().prepare('DELETE FROM budget_entry_responsibles WHERE entry_id = ?').run(entryId);
  if (!ids.length) return;


  const ins = db.get().prepare(`
    INSERT OR IGNORE INTO budget_entry_responsibles (entry_id, user_id)
    SELECT ?, id FROM users WHERE id = ?
  `);
  for (const id of ids) ins.run(entryId, id);
}

export function withResponsibles(row) {
  if (!row) return row;
  const { responsible_users_json, ...rest } = row;
  let parsed = [];
  try { parsed = responsible_users_json ? JSON.parse(responsible_users_json) : []; } catch { parsed = []; }
  return { ...rest, responsible_users: parsed };
}

export function entryWithLoanMeta(id) {
  return withResponsibles(db.get().prepare(`
    SELECT b.*, u.display_name AS creator_name,
           ${RESPONSIBLE_USERS_SQL},
           p.id AS loan_payment_id,
           p.loan_id AS loan_id,
           p.installment_number AS loan_installment_number,
           l.title AS loan_title,
           l.borrower AS loan_borrower
    FROM budget_entries b
    LEFT JOIN users u ON u.id = b.created_by
    LEFT JOIN budget_loan_payments p ON p.budget_entry_id = b.id
    LEFT JOIN budget_loans l ON l.id = p.loan_id
    WHERE b.id = ?
  `).get(id));
}

// --------------------------------------------------------
// Konten (#495): getrennte Konten mit Startsaldo + laufendem Saldo
// --------------------------------------------------------

export const ACCOUNT_TYPE_KEYS = ['checking', 'savings', 'cash', 'credit', 'investment', 'other'];

export function validateAccountRef(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { error: 'account_id muss eine gültige Konto-ID sein.' };
  const row = db.get().prepare('SELECT id FROM budget_accounts WHERE id = ?').get(id);
  if (!row) return { error: 'Konto nicht gefunden.' };
  return { value: id };
}

export function listAccounts(includeArchived = false, filter = { clause: '', params: [] }) {
  const today = todayKey(db.get());



  const f = filter && filter.clause ? filter : { clause: '', params: [] };
  const rows = db.get().prepare(`
    SELECT a.*,
           a.starting_balance + COALESCE((
             SELECT SUM(e.amount) FROM budget_entries e
             WHERE e.account_id = a.id AND e.date <= ?${f.clause}${bookedOnly('e')}
           ), 0) AS current_balance,
           a.starting_balance + COALESCE((
             SELECT SUM(e.amount) FROM budget_entries e
             WHERE e.account_id = a.id${f.clause}${bookedOnly('e')}
           ), 0) AS projected_balance,
           (SELECT COUNT(*) FROM budget_entries e WHERE e.account_id = a.id${f.clause}) AS entry_count
    FROM budget_accounts a
    WHERE ? = 1 OR a.archived = 0
    ORDER BY a.sort_order ASC, a.name COLLATE NOCASE ASC
  `).all(today, ...f.params, ...f.params, ...f.params, includeArchived ? 1 : 0);
  return rows.map((a) => {
    const currentBalance = cents(a.current_balance);



    const availableLimit = a.type === 'credit' && a.credit_limit != null
      ? Math.max(0, cents(a.credit_limit) - Math.max(0, -currentBalance))
      : null;
    return {
      ...a,
      starting_balance:  cents(a.starting_balance),
      current_balance:   currentBalance,
      projected_balance: cents(a.projected_balance),
      available_limit:   availableLimit,
    };
  });
}

export function nextAccountSortOrder() {
  const row = db.get().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM budget_accounts').get();
  return row.next;
}
