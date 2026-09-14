/**
 * Modul: Budget-Tracker – Kredite/Darlehen
 * Zweck: Loans CRUD, Raten-Zahlungen (mit gekoppeltem Budget-Eintrag), Status.
 */

import express from 'express';
import { createLogger } from '../../logger.js';
import * as db from '../../db.js';
import { str, num, date as validateDate, month as validateMonth, collectErrors, MAX_TITLE, MAX_SHORT } from '../../middleware/validate.js';
import { normalizeObjectVisibility } from '../../services/budget-visibility.js';
import { computeLoanSchedule, MAX_LOAN_MONTHS } from '../../services/loan-amortization.js';
import { translate, resolveHouseholdLocale } from '../../utils/i18n.js';
import {
  budgetFilter, mayEdit, getBudgetMode, loanSummaryRow, loadLoan, refreshLoanStatus, cents,
  budgetCurrency, toBudgetAmount, CURRENCY_RE, validateAccountRef, addMonths,
  LOAN_DIRECTIONS, bookingFor,
} from './helpers.js';

const log = createLogger('Budget');
const router = express.Router();

// 'variable' = Darlehen ganz ohne Zinsbindung (#569-Nachtrag): rechnet einphasig

const INTEREST_MODES = ['none', 'fixed', 'variable', 'fixed_then_variable'];

function validateDirection(body, loan = null) {
  if (body.direction === undefined) return { value: loan?.direction || 'lent' };
  const raw = String(body.direction || '').trim();
  if (!LOAN_DIRECTIONS.includes(raw)) return { error: 'Direction must be either lent or borrowed.' };
  return { value: raw };
}

function rebookPayments(loanId, direction) {
  const rule = bookingFor(direction);
  db.get().prepare(`
    UPDATE budget_entries
    SET amount = ? * ABS(amount), category = ?, subcategory = ?
    WHERE id IN (SELECT budget_entry_id FROM budget_loan_payments
                 WHERE loan_id = ? AND budget_entry_id IS NOT NULL)
  `).run(rule.sign, rule.category, rule.subcategory, loanId);
}




const MAX_EXCHANGE_RATE = 1e6;

function validateCurrencyFields(body, loan = null) {
  const base = budgetCurrency();
  const raw = body.currency === undefined
    ? (loan ? loan.currency : null)
    : String(body.currency || '').trim().toUpperCase();
  const currency = !raw || raw === base ? null : raw;
  if (currency !== null && !CURRENCY_RE.test(currency)) {
    return { error: 'Currency must be a three-letter ISO code.' };
  }


  if (currency === null) return { currency: null, exchange_rate: 1 };

  const rawRate = body.exchange_rate === undefined
    ? (loan ? loan.exchange_rate : 1)
    : body.exchange_rate;
  const rate = Number(rawRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_EXCHANGE_RATE) {
    return { error: 'Exchange rate must be greater than zero.' };
  }
  return { currency, exchange_rate: rate };
}


// bestehenden Raten-/Status-System erwarteten Felder (total_amount = Gesamtaufwand,

function deriveInterestTerms(body, mode) {
  const principal = Number(body.principal);
  const fixedRate = Number(body.fixed_rate);
  const initialRepaymentRate = Number(body.initial_repayment_rate);

  // 'fixed' speichern beide Felder als NULL.
  const variable = mode === 'fixed_then_variable';
  const fixedPeriodMonths = variable ? parseInt(body.fixed_period_months, 10) : null;
  const followupRate = variable ? Number(body.followup_rate) : null;

  if (!Number.isFinite(principal) || principal <= 0) return { error: 'Principal must be greater than zero.' };
  if (!Number.isFinite(fixedRate) || fixedRate < 0 || fixedRate > 100) return { error: 'Fixed rate must be between 0 and 100.' };
  if (!Number.isFinite(initialRepaymentRate) || initialRepaymentRate <= 0 || initialRepaymentRate > 100) {
    return { error: 'Initial repayment rate must be greater than 0 and at most 100.' };
  }
  if (variable) {
    if (!Number.isInteger(fixedPeriodMonths) || fixedPeriodMonths < 1 || fixedPeriodMonths > MAX_LOAN_MONTHS) {
      return { error: 'Fixed-rate period is invalid.' };
    }
    if (!Number.isFinite(followupRate) || followupRate < 0 || followupRate > 100) {
      return { error: 'Follow-up rate must be between 0 and 100.' };
    }
  }

  const result = computeLoanSchedule({ principal, fixedRate, initialRepaymentRate, interestMode: mode, fixedPeriodMonths, followupRate });
  if (!result.ok) {
    return { error: result.reason === 'not_amortizing'
      ? 'The monthly rate does not cover the interest; the loan never amortizes.'
      : 'The resulting term exceeds the supported maximum.' };
  }
  return {
    calc: result,
    fields: {
      interest_mode: mode,
      principal: cents(principal),
      fixed_rate: fixedRate,
      initial_repayment_rate: initialRepaymentRate,
      fixed_period_months: fixedPeriodMonths,
      followup_rate: followupRate,
      total_amount: result.totalRepayment,
      installment_count: result.totalMonths,
    },
  };
}



// Zins-Mathematik (keine Formel-Dopplung im Client).
router.post('/loans/preview', (req, res) => {
  try {
    const mode = req.body.interest_mode;
    if (!INTEREST_MODES.includes(mode) || mode === 'none') {
      return res.json({ data: { ok: false } });
    }
    const derived = deriveInterestTerms(req.body, mode);
    if (derived.error) return res.json({ data: { ok: false } });
    const c = derived.calc;
    const bindingEnd = mode === 'fixed_then_variable' && req.body.fixed_period_months
      ? c.remainingAfterBinding
      : null;
    res.json({
      data: {
        ok: true,
        monthly_payment: c.monthlyPayment,
        total_months: c.totalMonths,
        total_interest: c.totalInterest,
        total_repayment: c.totalRepayment,
        remaining_after_binding: bindingEnd,
      },
    });
  } catch (err) {
    log.error('POST /loans/preview error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.get('/loans', (req, res) => {
  try {

    const filter = budgetFilter(req, 'l', { scoped: false });
    const base = budgetCurrency();
    const loans = db.get().prepare(`
      SELECT l.*, u.display_name AS creator_name
      FROM budget_loans l
      LEFT JOIN users u ON u.id = l.created_by
      WHERE 1=1${filter.clause}
      ORDER BY CASE l.status WHEN 'active' THEN 0 ELSE 1 END,
               l.start_month ASC,
               l.created_at DESC
    `).all(...filter.params).map((loan) => loanSummaryRow(loan, base));
    const active = loans.filter((loan) => loan.status === 'active');





    const totals = loans.reduce((acc, loan) => {
      acc.total_amount += toBudgetAmount(loan.total_amount, loan);
      acc.paid_amount += toBudgetAmount(loan.paid_amount, loan);
      acc.remaining_amount += toBudgetAmount(loan.remaining_amount, loan);
      acc.remaining_principal += toBudgetAmount(loan.remaining_principal, loan);
      acc.remaining_installments += loan.remaining_installments;
      return acc;
    }, { total_amount: 0, paid_amount: 0, remaining_amount: 0, remaining_principal: 0, remaining_installments: 0 });

    res.json({
      data: {
        loans,
        summary: {
          active_count: active.length,
          total_count: loans.length,
          currency: base,
          has_foreign_currency: loans.some((loan) => loan.is_foreign_currency),


          has_interest: loans.some((loan) => Boolean(loan.interest)),
          total_amount: cents(totals.total_amount),
          paid_amount: cents(totals.paid_amount),
          remaining_amount: cents(totals.remaining_amount),
          remaining_principal: cents(totals.remaining_principal),
          remaining_installments: totals.remaining_installments,
        },
      },
    });
  } catch (err) {
    log.error('GET /loans error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

function seedPaidInstallments(loanId, count, userId) {
  const loan = loadLoan(loanId);
  const perInstallment = loan.installment_amount;
  db.get().transaction(() => {
    let booked = 0;
    for (let n = 1; n <= count; n++) {
      const remaining = cents(loan.total_amount - booked);
      if (remaining <= 0) break;
      const amount = Math.min(perInstallment, remaining);
      if (amount <= 0) break;
      db.get().prepare(`
        INSERT INTO budget_loan_payments
          (loan_id, installment_number, amount, paid_date, budget_entry_id, created_by)
        VALUES (?, ?, ?, ?, NULL, ?)
      `).run(loanId, n, amount, `${addMonths(loan.start_month, n - 1)}-01`, userId);
      booked = cents(booked + amount);
    }
  })();
  refreshLoanStatus(loanId);
}

router.post('/loans', (req, res) => {
  try {
    const vTitle = str(req.body.title || req.body.borrower, 'Title', { max: MAX_TITLE });
    const vBorrower = str(req.body.borrower, 'Borrower', { max: MAX_SHORT });
    const vStartMonth = validateMonth(req.body.start_month, 'Start month');
    const vNotes = str(req.body.notes, 'Notes', { max: 1000, required: false });
    const errors = collectErrors([vTitle, vBorrower, vStartMonth, vNotes]);
    if (!vStartMonth.value) errors.push('Start month is required.');

    const mode = INTEREST_MODES.includes(req.body.interest_mode) ? req.body.interest_mode : 'none';
    let terms = null;
    if (mode === 'none') {

      const vAmount = num(req.body.total_amount, 'Amount', { required: true });
      const installmentCount = parseInt(req.body.installment_count, 10);
      errors.push(...collectErrors([vAmount]));
      if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 360) {
        errors.push('Installment count must be between 1 and 360.');
      }
      if (vAmount.value !== null && vAmount.value <= 0) errors.push('Amount must be greater than zero.');
      terms = {
        interest_mode: 'none', principal: null, fixed_rate: null, initial_repayment_rate: null,
        fixed_period_months: null, followup_rate: null,
        total_amount: vAmount.value !== null ? cents(vAmount.value) : null, installment_count: installmentCount,
      };
    } else {
      const derived = deriveInterestTerms(req.body, mode);
      if (derived.error) errors.push(derived.error);
      else terms = derived.fields;
    }
    const money = validateCurrencyFields(req.body);
    if (money.error) errors.push(money.error);
    const dir = validateDirection(req.body);
    if (dir.error) errors.push(dir.error);
    const account = validateAccountRef(req.body.account_id);
    if (account.error) errors.push(account.error);








    // beim Nutzer.
    let paidInstallments = 0;
    if (req.body.paid_installments !== undefined && req.body.paid_installments !== null
        && req.body.paid_installments !== '') {
      paidInstallments = parseInt(req.body.paid_installments, 10);
      if (!Number.isInteger(paidInstallments) || paidInstallments < 0) {
        errors.push('Paid installments must be zero or a positive number.');
      } else if (terms && paidInstallments > terms.installment_count) {
        errors.push('Paid installments cannot exceed the installment count.');
      }
    }
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const me = req.authUserId || req.session.userId;
    const visibility = normalizeObjectVisibility(
      req.body.visibility,
      getBudgetMode() === 'personal' ? 'private' : 'shared'
    );
    const result = db.get().prepare(`
      INSERT INTO budget_loans
        (title, borrower, total_amount, installment_count, start_month, notes, created_by, owner_id, visibility,
         interest_mode, principal, fixed_rate, initial_repayment_rate, fixed_period_months, followup_rate,
         currency, exchange_rate, direction, account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vTitle.value,
      vBorrower.value,
      terms.total_amount,
      terms.installment_count,
      vStartMonth.value,
      vNotes.value,
      me, me, visibility,
      terms.interest_mode, terms.principal, terms.fixed_rate, terms.initial_repayment_rate,
      terms.fixed_period_months, terms.followup_rate,
      money.currency, money.exchange_rate,
      dir.value, account.value
    );

    const loanId = result.lastInsertRowid;
    if (paidInstallments > 0) seedPaidInstallments(loanId, paidInstallments, me);

    res.status(201).json({ data: loadLoan(loanId) });
  } catch (err) {
    log.error('POST /loans error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.put('/loans/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const loan = db.get().prepare('SELECT * FROM budget_loans WHERE id = ?').get(id);
    if (!loan) return res.status(404).json({ error: 'Loan not found.', code: 404 });
    if (!mayEdit(req, loan)) return res.status(403).json({ error: 'You cannot modify this loan.', code: 403 });




    if (req.body.interest_mode !== undefined) {
      const mode = INTEREST_MODES.includes(req.body.interest_mode) ? req.body.interest_mode : null;
      const iChecks = [];
      if (req.body.title !== undefined) iChecks.push(str(req.body.title, 'Title', { max: MAX_TITLE }));
      if (req.body.borrower !== undefined) iChecks.push(str(req.body.borrower, 'Borrower', { max: MAX_SHORT }));
      if (req.body.start_month !== undefined) iChecks.push(validateMonth(req.body.start_month, 'Start month'));
      if (req.body.notes !== undefined) iChecks.push(str(req.body.notes, 'Notes', { max: 1000, required: false }));
      const iErrors = collectErrors(iChecks);
      const paidCount = db.get().prepare('SELECT COUNT(*) AS c FROM budget_loan_payments WHERE loan_id = ?').get(id).c;

      let terms = null;
      if (!mode) {
        iErrors.push('Interest mode is invalid.');
      } else if (mode === 'none') {
        const vAmount = num(req.body.total_amount, 'Amount', { required: true });
        const installmentCount = parseInt(req.body.installment_count, 10);
        iErrors.push(...collectErrors([vAmount]));
        if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 360) {
          iErrors.push('Installment count must be between 1 and 360.');
        }
        if (vAmount.value !== null && vAmount.value <= 0) iErrors.push('Amount must be greater than zero.');
        terms = {
          interest_mode: 'none', principal: null, fixed_rate: null, initial_repayment_rate: null,
          fixed_period_months: null, followup_rate: null,
          total_amount: vAmount.value !== null ? cents(vAmount.value) : null, installment_count: installmentCount,
        };
      } else {
        const derived = deriveInterestTerms(req.body, mode);
        if (derived.error) iErrors.push(derived.error);
        else terms = derived.fields;
      }
      if (terms && terms.installment_count !== null && terms.installment_count < paidCount) {
        iErrors.push('The resulting term is shorter than the already paid installments.');
      }
      const iMoney = validateCurrencyFields(req.body, loan);
      if (iMoney.error) iErrors.push(iMoney.error);
      const iDir = validateDirection(req.body, loan);
      if (iDir.error) iErrors.push(iDir.error);
      const iAccount = req.body.account_id === undefined
        ? { value: loan.account_id }
        : validateAccountRef(req.body.account_id);
      if (iAccount.error) iErrors.push(iAccount.error);
      if (iErrors.length) return res.status(400).json({ error: iErrors.join(' '), code: 400 });

      db.get().prepare(`
        UPDATE budget_loans SET
          title = COALESCE(?, title),
          borrower = COALESCE(?, borrower),
          start_month = COALESCE(?, start_month),
          notes = ?,
          total_amount = ?, installment_count = ?, interest_mode = ?, principal = ?,
          fixed_rate = ?, initial_repayment_rate = ?, fixed_period_months = ?, followup_rate = ?,
          currency = ?, exchange_rate = ?, direction = ?, account_id = ?
        WHERE id = ?
      `).run(
        req.body.title?.trim() ?? null,
        req.body.borrower?.trim() ?? null,
        req.body.start_month ?? null,
        req.body.notes !== undefined ? (req.body.notes?.trim() || null) : loan.notes,
        terms.total_amount, terms.installment_count, terms.interest_mode, terms.principal,
        terms.fixed_rate, terms.initial_repayment_rate, terms.fixed_period_months, terms.followup_rate,
        iMoney.currency, iMoney.exchange_rate, iDir.value, iAccount.value,
        id
      );
      if (iDir.value !== loan.direction) rebookPayments(id, iDir.value);
      return res.json({ data: refreshLoanStatus(id) });
    }




    // Neutrale Partial-Updates (Titel, Notes, Startmonat) bleiben erlaubt.
    if (loan.interest_mode && loan.interest_mode !== 'none'
        && (req.body.total_amount !== undefined || req.body.installment_count !== undefined)) {
      return res.status(400).json({ error: 'Interest loans must be edited via the interest fields.', code: 400 });
    }

    const checks = [];
    if (req.body.title !== undefined) checks.push(str(req.body.title, 'Title', { max: MAX_TITLE }));
    if (req.body.borrower !== undefined) checks.push(str(req.body.borrower, 'Borrower', { max: MAX_SHORT }));
    if (req.body.total_amount !== undefined) checks.push(num(req.body.total_amount, 'Amount'));
    if (req.body.start_month !== undefined) checks.push(validateMonth(req.body.start_month, 'Start month'));
    if (req.body.notes !== undefined) checks.push(str(req.body.notes, 'Notes', { max: 1000, required: false }));
    const errors = collectErrors(checks);
    const installmentCount = req.body.installment_count === undefined ? null : parseInt(req.body.installment_count, 10);
    if (req.body.installment_count !== undefined && (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 360)) {
      errors.push('Installment count must be between 1 and 360.');
    }
    const paidCount = db.get().prepare('SELECT COUNT(*) AS c FROM budget_loan_payments WHERE loan_id = ?').get(id).c;
    if (installmentCount !== null && installmentCount < paidCount) {
      errors.push('Installment count cannot be lower than paid installments.');
    }
    if (req.body.total_amount !== undefined && Number(req.body.total_amount) <= 0) errors.push('Amount must be greater than zero.');
    const money = validateCurrencyFields(req.body, loan);
    if (money.error) errors.push(money.error);
    const dir = validateDirection(req.body, loan);
    if (dir.error) errors.push(dir.error);
    const account = req.body.account_id === undefined
      ? { value: loan.account_id }
      : validateAccountRef(req.body.account_id);
    if (account.error) errors.push(account.error);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    db.get().prepare(`
      UPDATE budget_loans
      SET title = COALESCE(?, title),
          borrower = COALESCE(?, borrower),
          total_amount = COALESCE(?, total_amount),
          installment_count = COALESCE(?, installment_count),
          start_month = COALESCE(?, start_month),
          notes = ?,
          currency = ?,
          exchange_rate = ?,
          direction = ?,
          account_id = ?
      WHERE id = ?
    `).run(
      req.body.title?.trim() ?? null,
      req.body.borrower?.trim() ?? null,
      req.body.total_amount !== undefined ? cents(req.body.total_amount) : null,
      installmentCount,
      req.body.start_month ?? null,
      req.body.notes !== undefined ? (req.body.notes?.trim() || null) : loan.notes,
      money.currency, money.exchange_rate,
      dir.value, account.value,
      id
    );
    if (dir.value !== loan.direction) rebookPayments(id, dir.value);

    res.json({ data: refreshLoanStatus(id) });
  } catch (err) {
    log.error('PUT /loans/:id error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.post('/loans/:id/payments', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const loan = loadLoan(id);
    if (!loan) return res.status(404).json({ error: 'Loan not found.', code: 404 });
    const loanRow = db.get().prepare('SELECT owner_id, visibility, created_by, direction, account_id FROM budget_loans WHERE id = ?').get(id);
    if (!mayEdit(req, loanRow)) return res.status(403).json({ error: 'You cannot modify this loan.', code: 403 });
    // is_settled statt remaining_installments: ein frueh volltilgtes Zins-Darlehen

    if (loan.is_settled) return res.status(409).json({ error: 'Loan is already paid.', code: 409 });

    const installmentNumber = req.body.installment_number === undefined
      ? loan.next_installment_number
      : parseInt(req.body.installment_number, 10);
    const defaultAmount = installmentNumber === loan.installment_count
      ? loan.remaining_amount
      : Math.min(loan.installment_amount, loan.remaining_amount);
    const vAmount = num(req.body.amount ?? defaultAmount, 'Amount', { required: true });
    const vDate = validateDate(req.body.paid_date, 'Paid date', true);
    const errors = collectErrors([vAmount, vDate]);
    if (!Number.isInteger(installmentNumber) || installmentNumber < 1 || installmentNumber > loan.installment_count) {
      errors.push('Installment number is invalid.');
    }
    if (vAmount.value !== null && vAmount.value <= 0) errors.push('Amount must be greater than zero.');
    if (vAmount.value !== null && vAmount.value - loan.remaining_amount > 0.005) {
      errors.push('Amount cannot be greater than the remaining loan amount.');
    }
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const existing = db.get().prepare(`
      SELECT 1 FROM budget_loan_payments WHERE loan_id = ? AND installment_number = ?
    `).get(id, installmentNumber);
    if (existing) return res.status(409).json({ error: 'Installment already paid.', code: 409 });

    const paymentAmount = cents(vAmount.value);

    // (budget_loan_payments.amount, gegen total_amount/Restschuld gerechnet), das



    const budgetAmount = toBudgetAmount(paymentAmount, loan);
    const foreign = loan.is_foreign_currency ? ` (${loan.currency})` : '';






    // Er bleibt trotzdem, denn nachgetragene Raten (#813) haben gar keinen

    const title = translate(resolveHouseholdLocale(db.get()), 'budget.loanPaymentTitle', { borrower: loan.borrower }) + foreign;



    const booking = bookingFor(loanRow.direction);
    const tx = db.get().transaction(() => {

      // damit er im Budget derselben Person/desselben Topfs erscheint.

      const budgetResult = db.get().prepare(`
        INSERT INTO budget_entries (title, amount, category, subcategory, date, is_recurring, created_by, owner_id, visibility, account_id)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(
        title,
        booking.sign * budgetAmount,
        booking.category,
        booking.subcategory,
        vDate.value,
        req.authUserId || req.session.userId,
        loanRow.owner_id,
        loanRow.visibility || 'shared',
        loanRow.account_id ?? null
      );
      const paymentResult = db.get().prepare(`
        INSERT INTO budget_loan_payments
          (loan_id, installment_number, amount, paid_date, budget_entry_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, installmentNumber, paymentAmount, vDate.value, budgetResult.lastInsertRowid, req.authUserId || req.session.userId);
      return paymentResult.lastInsertRowid;
    });

    const paymentId = tx();
    res.status(201).json({
      data: {
        payment: db.get().prepare('SELECT * FROM budget_loan_payments WHERE id = ?').get(paymentId),
        loan: refreshLoanStatus(id),
      },
    });
  } catch (err) {
    log.error('POST /loans/:id/payments error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.delete('/loans/:id/payments/:paymentId', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const paymentId = parseInt(req.params.paymentId, 10);
    const payment = db.get().prepare(`
      SELECT * FROM budget_loan_payments WHERE id = ? AND loan_id = ?
    `).get(paymentId, id);
    if (!payment) return res.status(404).json({ error: 'Payment not found.', code: 404 });
    const loanRow = db.get().prepare('SELECT owner_id, visibility, created_by FROM budget_loans WHERE id = ?').get(id);
    if (!mayEdit(req, loanRow)) return res.status(403).json({ error: 'You cannot modify this loan.', code: 403 });

    const tx = db.get().transaction(() => {
      db.get().prepare('DELETE FROM budget_loan_payments WHERE id = ?').run(paymentId);
      if (payment.budget_entry_id) {
        db.get().prepare('DELETE FROM budget_entries WHERE id = ?').run(payment.budget_entry_id);
      }
    });
    tx();
    refreshLoanStatus(id);
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /loans/:id/payments/:paymentId error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.delete('/loans/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const loan = db.get().prepare('SELECT * FROM budget_loans WHERE id = ?').get(id);
    if (!loan) return res.status(404).json({ error: 'Loan not found.', code: 404 });
    if (!mayEdit(req, loan)) return res.status(403).json({ error: 'You cannot modify this loan.', code: 403 });

    const payments = db.get().prepare('SELECT budget_entry_id FROM budget_loan_payments WHERE loan_id = ?').all(id);
    const tx = db.get().transaction(() => {
      db.get().prepare('DELETE FROM budget_loans WHERE id = ?').run(id);
      for (const payment of payments) {
        if (payment.budget_entry_id) {
          db.get().prepare('DELETE FROM budget_entries WHERE id = ?').run(payment.budget_entry_id);
        }
      }
    });
    tx();
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /loans/:id error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

export default router;
