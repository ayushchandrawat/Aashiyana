
import express from 'express';
import { createLogger } from '../../logger.js';
import * as db from '../../db.js';
import { str, oneOf, date as validateDate, num, rrule, collectErrors, MAX_TITLE, MONTH_RE } from '../../middleware/validate.js';
import { normalizeBudgetVisibility } from '../../services/budget-visibility.js';
import { todayKey } from '../../utils/timezone.js';
import { sendDocumentDeletionConflict } from '../../services/document-deletion-lock.js';
import { assertDocumentLinkTargetsAvailable } from '../../services/document-links.js';
import { attachmentsFor, replaceAttachments, withAttachments } from './attachments.js';
import {
  budgetFilter, budgetCategoryExpr, maskEntries, getBudgetMode, mayEdit, bookedOnly,
  DATE_RE, thisMonthLocalKey, cents,
  generateRecurringInstances, RECURRENCE_INTERVAL_KEYS, MAX_INTERVAL_COUNT,
  normalizeIntervalCount, effectiveMonthly,
  validCategoryKeys, defaultCategory, validateSubcategory, validateAccountRef,
  entryWithLoanMeta, refreshLoanStatus, fromBudgetAmount, bookingFor,
  RESPONSIBLE_USERS_SQL, replaceResponsibles, withResponsibles,
} from './helpers.js';

const log = createLogger('Budget');
const router = express.Router();

function intervalCountCheck(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_INTERVAL_COUNT) {
    return { value: null, error: `Intervall-Anzahl muss zwischen 1 und ${MAX_INTERVAL_COUNT} liegen.` };
  }
  return { value: n, error: null };
}

router.get('/summary', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 7); // YYYY-MM
    const month = req.query.month || today;

    if (!MONTH_RE.test(month))
      return res.status(400).json({ error: 'month muss YYYY-MM sein', code: 400 });

    const from = `${month}-01`;
    const to   = `${month}-31`;



    const filter = budgetFilter(req, 'budget_entries');

    const totals = db.get().prepare(`
      SELECT
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS expenses,
        SUM(amount) AS balance
      FROM budget_entries
      WHERE date BETWEEN ? AND ?${filter.clause}${bookedOnly()}
    `).get(from, to, ...filter.params);



    const catExpr = budgetCategoryExpr(req, 'budget_entries');
    const byCategory = db.get().prepare(`
      SELECT ${catExpr.expr} AS category,
             SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
             SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS expenses,
             SUM(amount) AS total
      FROM budget_entries
      WHERE date BETWEEN ? AND ?${filter.clause}${bookedOnly()}



      GROUP BY 1
      ORDER BY ABS(SUM(amount)) DESC
    `).all(...catExpr.params, from, to, ...filter.params);




    const pending = db.get().prepare(`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
             COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS expenses
      FROM budget_entries
      WHERE date BETWEEN ? AND ?${filter.clause} AND is_pending = 1
    `).get(from, to, ...filter.params);

    res.json({
      data: {
        month,
        income:     totals.income   || 0,
        expenses:   totals.expenses || 0,
        balance:    totals.balance  || 0,
        byCategory,
        pending: {
          count:    pending.count,
          income:   pending.income,
          expenses: pending.expenses,
        },
      },
    });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

export function resolveExportRange({ from, to, month }) {
  if (DATE_RE.test(from || '') && DATE_RE.test(to || '')) return { from, to };
  const m = MONTH_RE.test(month || '') ? month : thisMonthLocalKey();
  return { from: `${m}-01`, to: `${m}-31` };
}

router.get('/export', (req, res) => {
  try {
    const { from, to } = resolveExportRange(req.query);
    const filename = (DATE_RE.test(req.query.from || '') && DATE_RE.test(req.query.to || ''))
      ? `budget-${from}_${to}.csv`
      : `budget-${req.query.month || thisMonthLocalKey()}.csv`;
    const filter = budgetFilter(req, 'b');



    // auszulesen, was die Oberflaeche verbirgt.
    const entries = maskEntries(req, db.get().prepare(`
      SELECT b.*, u.display_name AS creator_name
      FROM budget_entries b
      LEFT JOIN users u ON u.id = b.created_by
      WHERE b.date BETWEEN ? AND ?${filter.clause}
      ORDER BY b.date ASC
    `).all(from, to, ...filter.params));

    const header = 'Date,Title,Amount,Category,Subcategory,Recurring,Status,Created by\n';
    const csvSafe = (val) => {
      let s = String(val || '').replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s}"`;
    };
    const rows   = entries.map((e) =>
      [
        e.date,
        csvSafe(e.details_hidden ? 'Private entry' : e.title),




        e.amount.toFixed(2),
        e.details_hidden ? 'Private' : e.category,
        e.subcategory || '',
        e.is_recurring ? 'Yes' : 'No',

        // eine erfolgte aussehen (#637). Sie bleibt drin, aber gekennzeichnet.
        e.is_pending ? 'Expected' : 'Booked',
        csvSafe(e.creator_name),
      ].join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + header + rows);
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.get('/', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 7);
    const month = req.query.month || today;
    const loanId = req.query.loan_id ? parseInt(req.query.loan_id, 10) : null;

    if (!loanId && !MONTH_RE.test(month))
      return res.status(400).json({ error: 'month muss YYYY-MM sein', code: 400 });

    if (!loanId) generateRecurringInstances(db.get(), month);

    const from   = `${month}-01`;
    const to     = `${month}-31`;
    let sql      = `
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
    `;
    const params = [];

    if (loanId) {
      sql += ' WHERE p.loan_id = ?';
      params.push(loanId);
    } else {
      sql += ' WHERE b.date BETWEEN ? AND ?';
      params.push(from, to);
    }

    if (req.query.category && validCategoryKeys().includes(req.query.category)) {
      sql += ' AND b.category = ?';
      params.push(req.query.category);
    }

    if (req.query.account_id) {
      const accountId = parseInt(req.query.account_id, 10);
      if (Number.isInteger(accountId) && accountId > 0) {
        sql += ' AND b.account_id = ?';
        params.push(accountId);
      }
    }


    // Mein/Haushalt-Scope, nur Sichtbarkeit.
    const filter = budgetFilter(req, 'b', { scoped: !loanId });
    sql += filter.clause;
    params.push(...filter.params);

    sql += ' ORDER BY b.date DESC, b.created_at DESC';

    const entries = db.get().prepare(sql).all(...params).map(withResponsibles);
    res.json({
      data: maskEntries(req, withAttachments(entries, req.authUserId || req.session.userId)),
    });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

/**
 * POST /api/v1/budget
 * Neuen Eintrag anlegen.
 * Body: { title, amount, category?, subcategory?, date, is_recurring?, recurrence_rule? }
 * Response: { data: Entry }
 */
router.post('/', (req, res) => {
  try {
    const vTitle  = str(req.body.title,    'Titel',  { max: MAX_TITLE });
    const vAmount = num(req.body.amount,  'Betrag', { required: true });
    const fallbackCategory = defaultCategory(Number(req.body.amount) < 0 ? 'expense' : 'income');
    const vCat    = oneOf(req.body.category || fallbackCategory, validCategoryKeys(), 'Kategorie');
    const vDate   = validateDate(req.body.date,   'Datum',  true);
    const vRrule  = rrule(req.body.recurrence_rule, 'Wiederholung');
    const vInterval = oneOf(req.body.recurrence_interval || 'monthly', RECURRENCE_INTERVAL_KEYS, 'Intervall');
    const vCount = req.body.recurrence_interval_count !== undefined
      ? intervalCountCheck(req.body.recurrence_interval_count)
      : { value: 1, error: null };
    const errors  = collectErrors([vTitle, vAmount, vCat, vDate, vRrule, vInterval, vCount]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });
    const subcategory = validateSubcategory(vCat.value, req.body.subcategory);
    if (subcategory === null) {
      return res.status(400).json({ error: 'Invalid subcategory.', code: 400 });
    }

    const accountRef = validateAccountRef(req.body.account_id);
    if (accountRef.error) return res.status(400).json({ error: accountRef.error, code: 400 });


    const isRecurring = req.body.is_recurring ? 1 : 0;
    const interval    = isRecurring ? vInterval.value : 'monthly';
    const intervalCount = isRecurring ? normalizeIntervalCount(vCount.value) : 1;
    // Bestaetigung je Serie (#637): nur sinnvoll, wo Instanzen entstehen.
    const confirmFirst = isRecurring && req.body.recurrence_confirm ? 1 : 0;
    const isVirtual   = isRecurring && req.body.recurrence_virtual ? 1 : 0;

    const storeAmount = isVirtual ? effectiveMonthly(vAmount.value, interval, intervalCount) : vAmount.value;
    const fullAmount  = isVirtual ? cents(vAmount.value) : null;



    const me = req.authUserId || req.session.userId;
    const visibility = normalizeBudgetVisibility(
      req.body.visibility,
      getBudgetMode() === 'personal' ? 'private' : 'shared'
    );
    assertDocumentLinkTargetsAvailable(db.get(), req.body.attachment_document_ids, me);

    const result = db.get().prepare(`
      INSERT INTO budget_entries
        (title, amount, category, subcategory, date, is_recurring, recurrence_rule,
         recurrence_interval, recurrence_interval_count, recurrence_virtual,
         recurrence_confirm, recurrence_full_amount, account_id, created_by, owner_id, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vTitle.value, storeAmount, vCat.value || fallbackCategory, subcategory, vDate.value,
      isRecurring, vRrule.value,
      interval, intervalCount, isVirtual, confirmFirst, fullAmount, accountRef.value,
      me, me, visibility
    );



    replaceAttachments(result.lastInsertRowid, req.body.attachment_document_ids, me);

    replaceResponsibles(result.lastInsertRowid, req.body.responsible_user_ids);

    const entry = entryWithLoanMeta(result.lastInsertRowid);

    res.status(201).json({ data: { ...entry, attachments: attachmentsFor(entry.id, me) } });
  } catch (err) {
    if (sendDocumentDeletionConflict(res, err)) return;
    log.error('', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.put('/:id/series', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const entry = db.get().prepare('SELECT * FROM budget_entries WHERE id = ?').get(id);
    if (!entry) return res.status(404).json({ error: 'Entry not found', code: 404 });
    if (!mayEdit(req, entry)) return res.status(403).json({ error: 'You cannot modify this entry.', code: 403 });

    const parentId = entry.recurrence_parent_id ?? (entry.is_recurring ? entry.id : null);
    if (!parentId) return res.status(400).json({ error: 'Not a recurring entry.', code: 400 });

    const parent = db.get().prepare('SELECT * FROM budget_entries WHERE id = ?').get(parentId);
    if (!parent) return res.status(404).json({ error: 'Series parent not found', code: 404 });

    const checks = [];
    if (req.body.title    !== undefined) checks.push(str(req.body.title,    'Titel',  { max: MAX_TITLE, required: false }));
    if (req.body.amount   !== undefined) checks.push(num(req.body.amount,   'Betrag'));
    if (req.body.category !== undefined) checks.push(oneOf(req.body.category, validCategoryKeys(), 'Kategorie'));
    if (req.body.recurrence_rule !== undefined) checks.push(rrule(req.body.recurrence_rule, 'Wiederholung'));
    if (req.body.recurrence_interval !== undefined) checks.push(oneOf(req.body.recurrence_interval, RECURRENCE_INTERVAL_KEYS, 'Intervall'));
    if (req.body.recurrence_interval_count !== undefined) checks.push(intervalCountCheck(req.body.recurrence_interval_count));
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const { title, amount, category, subcategory: requestedSubcategory, is_recurring, recurrence_rule } = req.body;
    const finalTitle    = title     !== undefined ? title.trim()                        : parent.title;
    const finalAmount   = amount    !== undefined ? Number(amount)                     : parent.amount;
    const finalCategory = category  !== undefined ? category                           : parent.category;
    const finalSubcat   = requestedSubcategory !== undefined
      ? (validateSubcategory(finalCategory, requestedSubcategory) ?? parent.subcategory)
      : parent.subcategory;
    const finalRecurring = is_recurring !== undefined ? (is_recurring ? 1 : 0) : parent.is_recurring;
    const finalInterval  = req.body.recurrence_interval !== undefined
      ? req.body.recurrence_interval
      : (parent.recurrence_interval || 'monthly');
    const finalCount     = normalizeIntervalCount(req.body.recurrence_interval_count !== undefined
      ? req.body.recurrence_interval_count
      : parent.recurrence_interval_count);
    const finalVirtual   = req.body.recurrence_virtual !== undefined
      ? (req.body.recurrence_virtual ? 1 : 0)
      : parent.recurrence_virtual;
    const finalConfirm   = req.body.recurrence_confirm !== undefined
      ? (req.body.recurrence_confirm ? 1 : 0)
      : parent.recurrence_confirm;
    const finalFull      = finalVirtual
      ? (amount !== undefined ? cents(finalAmount) : (parent.recurrence_full_amount ?? parent.amount))
      : null;
    const storeAmount    = finalVirtual ? effectiveMonthly(finalFull, finalInterval, finalCount) : finalAmount;
    const finalRrule     = recurrence_rule !== undefined ? (recurrence_rule || null) : parent.recurrence_rule;





    const nextVisibility = req.body.visibility !== undefined
      ? normalizeBudgetVisibility(req.body.visibility)
      : null;






    //




    // generateRecurringInstances neu erzeugt werden.
    const accountProvided = req.body.account_id !== undefined;
    let accountValue = null;
    if (accountProvided) {
      const accountRef = validateAccountRef(req.body.account_id);
      if (accountRef.error) return res.status(400).json({ error: accountRef.error, code: 400 });
      accountValue = accountRef.value;
    }


    //








    // CASCADE bisher mitnahm (siehe #583 weiter unten).
    //







    const cutoffDate = todayKey(db.get());

    db.get().transaction(() => {
      db.get().prepare(`
        UPDATE budget_entries SET
          title                  = ?,
          amount                 = ?,
          category               = ?,
          subcategory            = ?,
          is_recurring           = ?,
          recurrence_rule        = ?,
          recurrence_interval    = ?,
          recurrence_interval_count = ?,
          recurrence_virtual     = ?,
          recurrence_confirm     = ?,
          recurrence_full_amount = ?,
          visibility             = COALESCE(?, visibility),
          account_id             = CASE WHEN ? = 1 THEN ? ELSE account_id END
        WHERE id = ?
      `).run(finalTitle, storeAmount, finalCategory, finalSubcat,
             finalRecurring, finalRrule, finalInterval, finalCount, finalVirtual,
             finalConfirm, finalFull, nextVisibility,
             accountProvided ? 1 : 0, accountValue, parentId);


      //







      //



      const rhythmChanged = finalInterval !== parent.recurrence_interval
        || finalCount !== parent.recurrence_interval_count
        || finalVirtual !== parent.recurrence_virtual
        || finalRrule !== parent.recurrence_rule
        || finalRecurring !== parent.is_recurring;

      if (rhythmChanged) {
        db.get().prepare(`
          DELETE FROM budget_entries WHERE recurrence_parent_id = ? AND date >= ?
        `).run(parentId, cutoffDate);
      } else {




        db.get().prepare(`
          UPDATE budget_entries SET
            title       = ?,
            amount      = ?,
            category    = ?,
            subcategory = ?,
            is_pending  = ?,
            account_id  = CASE WHEN ? = 1 THEN ? ELSE account_id END
          WHERE recurrence_parent_id = ? AND date >= ?
        `).run(finalTitle, storeAmount, finalCategory, finalSubcat,
               finalConfirm ? 1 : 0,
               accountProvided ? 1 : 0, finalVirtual ? null : accountValue,
               parentId, cutoffDate);
      }

      if (nextVisibility) {
        db.get().prepare(`
          UPDATE budget_entries SET visibility = ? WHERE recurrence_parent_id = ?
        `).run(nextVisibility, parentId);
      }
    })();





    //





    // uebernimmt, uebernimmt sie nicht rueckwirkend. Gemessen: Juni-Instanz

    //





    // neuen Titel saehe.
    if (req.body.responsible_user_ids !== undefined) {
      db.get().transaction(() => {
        replaceResponsibles(parentId, req.body.responsible_user_ids);
        const future = db.get().prepare(
          'SELECT id FROM budget_entries WHERE recurrence_parent_id = ? AND date >= ?'
        ).all(parentId, cutoffDate);
        for (const row of future) replaceResponsibles(row.id, req.body.responsible_user_ids);
      })();
    }

    const me = req.authUserId || req.session.userId;
    const updated = entryWithLoanMeta(parentId);
    res.json({ data: { ...updated, attachments: attachmentsFor(parentId, me) } });
  } catch (err) {
    log.error('PUT /budget/:id/series error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.delete('/:id/series', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const entry = db.get().prepare('SELECT * FROM budget_entries WHERE id = ?').get(id);
    if (!entry) return res.status(404).json({ error: 'Entry not found', code: 404 });
    if (!mayEdit(req, entry)) return res.status(403).json({ error: 'You cannot modify this entry.', code: 403 });

    const parentId = entry.recurrence_parent_id ?? (entry.is_recurring ? entry.id : null);
    if (!parentId) return res.status(400).json({ error: 'Not a recurring entry.', code: 400 });

    db.get().transaction(() => {
      db.get().prepare('DELETE FROM budget_entries WHERE recurrence_parent_id = ?').run(parentId);
      db.get().prepare('DELETE FROM budget_entries WHERE id = ?').run(parentId);
    })();

    res.status(204).end();
  } catch (err) {
    log.error('DELETE /budget/:id/series error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

/**
 * PUT /api/v1/budget/:id
 * Eintrag bearbeiten.
 * Body: alle Felder optional
 * Response: { data: Entry }
 */
router.put('/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const entry = db.get().prepare('SELECT * FROM budget_entries WHERE id = ?').get(id);
    if (!entry) return res.status(404).json({ error: 'Entry not found', code: 404 });
    if (!mayEdit(req, entry)) return res.status(403).json({ error: 'You cannot modify this entry.', code: 403 });

    const checks = [];
    if (req.body.title    !== undefined) checks.push(str(req.body.title,    'Titel',  { max: MAX_TITLE, required: false }));
    if (req.body.amount   !== undefined) checks.push(num(req.body.amount,   'Betrag'));
    if (req.body.category !== undefined) checks.push(oneOf(req.body.category, validCategoryKeys(), 'Kategorie'));
    if (req.body.date     !== undefined) checks.push(validateDate(req.body.date,    'Datum'));
    if (req.body.recurrence_rule !== undefined) checks.push(rrule(req.body.recurrence_rule, 'Wiederholung'));
    if (req.body.recurrence_interval !== undefined) checks.push(oneOf(req.body.recurrence_interval, RECURRENCE_INTERVAL_KEYS, 'Intervall'));
    if (req.body.recurrence_interval_count !== undefined) checks.push(intervalCountCheck(req.body.recurrence_interval_count));
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });
    const { title, amount, category, subcategory: requestedSubcategory, date, is_recurring, recurrence_rule } = req.body;
    const linkedPayment = db.get().prepare(`
      SELECT * FROM budget_loan_payments WHERE budget_entry_id = ?
    `).get(id);




    const linkedLoan = linkedPayment
      ? db.get().prepare('SELECT total_amount, currency, exchange_rate, direction FROM budget_loans WHERE id = ?').get(linkedPayment.loan_id)
      : null;








    const linkedSign = linkedPayment ? bookingFor(linkedLoan?.direction).sign : 1;
    const linkedPaymentAmount = linkedPayment && amount !== undefined
      ? Math.abs(fromBudgetAmount(amount, linkedLoan))
      : null;
    if (linkedPayment && amount !== undefined) {
      if (!(linkedPaymentAmount > 0)) {
        return res.status(400).json({ error: 'Amount must be greater than zero.', code: 400 });
      }
      const otherPaid = db.get().prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM budget_loan_payments
        WHERE loan_id = ? AND id != ?
      `).get(linkedPayment.loan_id, linkedPayment.id).total;
      if (linkedPaymentAmount - (Number(linkedLoan?.total_amount || 0) - Number(otherPaid || 0)) > 0.005) {
        return res.status(400).json({ error: 'Amount cannot be greater than the remaining loan amount.', code: 400 });
      }
    }
    const nextCategory = category ?? entry.category;
    const subcategory = requestedSubcategory !== undefined || category !== undefined
      ? validateSubcategory(nextCategory, requestedSubcategory ?? entry.subcategory)
      : undefined;
    if (subcategory === null) {
      return res.status(400).json({ error: 'Invalid subcategory.', code: 400 });
    }


    const accountProvided = req.body.account_id !== undefined;
    let accountValue = null;
    if (accountProvided) {
      const accountRef = validateAccountRef(req.body.account_id);
      if (accountRef.error) return res.status(400).json({ error: accountRef.error, code: 400 });
      accountValue = accountRef.value;
    }


    const finalRecurring = is_recurring !== undefined ? (is_recurring ? 1 : 0) : entry.is_recurring;
    const finalInterval = req.body.recurrence_interval !== undefined
      ? req.body.recurrence_interval
      : (entry.recurrence_interval || 'monthly');
    const finalCount = normalizeIntervalCount(req.body.recurrence_interval_count !== undefined
      ? req.body.recurrence_interval_count
      : entry.recurrence_interval_count);
    let finalVirtual = req.body.recurrence_virtual !== undefined
      ? (req.body.recurrence_virtual ? 1 : 0)
      : entry.recurrence_virtual;
    if (!finalRecurring) finalVirtual = 0;
    let finalConfirm = req.body.recurrence_confirm !== undefined
      ? (req.body.recurrence_confirm ? 1 : 0)
      : entry.recurrence_confirm;
    if (!finalRecurring) finalConfirm = 0;
    // Konfigurierter Periodenbetrag (vorzeichenbehaftet): neue Eingabe, sonst bisheriger Vollbetrag.



    const configuredFull = amount !== undefined
      ? (linkedPayment ? linkedSign * Math.abs(Number(amount)) : Number(amount))
      : (entry.recurrence_full_amount != null ? entry.recurrence_full_amount : entry.amount);
    const nextAmount = finalVirtual ? effectiveMonthly(configuredFull, finalInterval, finalCount) : cents(configuredFull);
    const nextFull   = finalVirtual ? cents(configuredFull) : null;

    // Sichtbarkeit umschaltbar (privat/geteilt); owner_id bleibt fix (#476/#505).
    const nextVisibility = req.body.visibility !== undefined
      ? normalizeBudgetVisibility(req.body.visibility)
      : null;

    // Guard attachment targets before the main entry/loan transaction: a 409
    // must leave every requested field unchanged, not only the link table.
    const me = req.authUserId || req.session.userId;
    if (req.body.attachment_document_ids !== undefined) {
      assertDocumentLinkTargetsAvailable(db.get(), req.body.attachment_document_ids, me);
    }

    const tx = db.get().transaction(() => {
      db.get().prepare(`
        UPDATE budget_entries
        SET title                  = COALESCE(?, title),
            amount                 = ?,
            category               = COALESCE(?, category),
            subcategory            = COALESCE(?, subcategory),
            date                   = COALESCE(?, date),
            is_recurring           = ?,
            recurrence_rule        = ?,
            recurrence_interval    = ?,
            recurrence_interval_count = ?,
            recurrence_virtual     = ?,
            recurrence_confirm     = ?,
            recurrence_full_amount = ?,
            visibility             = COALESCE(?, visibility),
            account_id             = CASE WHEN ? = 1 THEN ? ELSE account_id END
        WHERE id = ?
      `).run(
        title?.trim() ?? null,
        nextAmount,
        category ?? null,
        subcategory !== undefined ? subcategory : null,
        date ?? null,
        finalRecurring,
        recurrence_rule !== undefined ? (recurrence_rule || null) : entry.recurrence_rule,
        finalInterval,
        finalCount,
        finalVirtual,
        finalConfirm,
        nextFull,
        nextVisibility,
        accountProvided ? 1 : 0,
        accountValue,
        id
      );

      if (linkedPayment) {
        db.get().prepare(`
          UPDATE budget_loan_payments
          SET amount = COALESCE(?, amount),
              paid_date = COALESCE(?, paid_date)
          WHERE id = ?
        `).run(
          linkedPaymentAmount,
          date ?? null,
          linkedPayment.id
        );
        refreshLoanStatus(linkedPayment.loan_id);
      }
    });
    tx();



    // abraeumen.
    if (req.body.attachment_document_ids !== undefined) {
      replaceAttachments(id, req.body.attachment_document_ids, me);
    }

    // mitkommt (#1057). replaceResponsibles() prueft das selbst.
    replaceResponsibles(id, req.body.responsible_user_ids);

    const updated = entryWithLoanMeta(id);

    res.json({ data: { ...updated, attachments: attachmentsFor(id, me) } });
  } catch (err) {
    if (sendDocumentDeletionConflict(res, err)) return;
    log.error('', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.patch('/:id/confirm', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const entry = db.get().prepare('SELECT * FROM budget_entries WHERE id = ?').get(id);
    if (!entry) return res.status(404).json({ error: 'Entry not found', code: 404 });
    if (!mayEdit(req, entry)) return res.status(403).json({ error: 'You cannot modify this entry.', code: 403 });
    if (!entry.is_pending) {
      return res.status(400).json({ error: 'Entry is already booked.', code: 400 });
    }

    const checks = [];
    if (req.body.amount !== undefined) checks.push(num(req.body.amount, 'Betrag'));
    if (req.body.date   !== undefined) checks.push(validateDate(req.body.date, 'Datum'));
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });



    const corrected = req.body.amount !== undefined ? Math.abs(Number(req.body.amount)) : null;
    const nextAmount = corrected === null
      ? entry.amount
      : cents(entry.amount < 0 ? -corrected : corrected);

    db.get().prepare(`
      UPDATE budget_entries
         SET is_pending = 0,
             amount     = ?,
             date       = COALESCE(?, date)
       WHERE id = ?
    `).run(nextAmount, req.body.date ?? null, id);

    const me = req.authUserId || req.session.userId;
    const updated = entryWithLoanMeta(id);
    res.json({ data: { ...updated, attachments: attachmentsFor(id, me) } });
  } catch (err) {
    log.error('PATCH /budget/:id/confirm error:', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const entry = db.get().prepare('SELECT * FROM budget_entries WHERE id = ?').get(id);
    if (!entry) return res.status(404).json({ error: 'Entry not found', code: 404 });
    if (!mayEdit(req, entry)) return res.status(403).json({ error: 'You cannot modify this entry.', code: 403 });

    const linkedPayment = db.get().prepare(`
      SELECT * FROM budget_loan_payments WHERE budget_entry_id = ?
    `).get(id);

    const tx = db.get().transaction(() => {
      if (linkedPayment) {
        db.get().prepare('DELETE FROM budget_loan_payments WHERE id = ?').run(linkedPayment.id);
      }
      db.get().prepare('DELETE FROM budget_entries WHERE id = ?').run(id);
      if (linkedPayment) refreshLoanStatus(linkedPayment.loan_id);
    });
    tx();




    if (entry.recurrence_parent_id) {
      db.get().prepare(
        'INSERT OR IGNORE INTO budget_recurrence_skipped (parent_id, date) VALUES (?, ?)'
      ).run(entry.recurrence_parent_id, entry.date);
    }

    res.status(204).end();
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Internal error', code: 500 });
  }
});

export default router;
