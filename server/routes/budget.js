
import express from 'express';

import entriesRouter from './budget/entries.js';
import categoriesRouter from './budget/categories.js';
import loansRouter from './budget/loans.js';
import accountsRouter from './budget/accounts.js';
import plansRouter from './budget/plans.js';
import statsRouter from './budget/stats.js';

const router = express.Router();





router.use(categoriesRouter);
router.use(loansRouter);
router.use(accountsRouter);
router.use(plansRouter);
router.use(statsRouter);
router.use(entriesRouter);

export default router;


export {
  computeStatsRange,
  generateRecurringInstances, occurrencesPerYear, occurrenceDatesInMonth, effectiveMonthly,
  RECURRENCE_INTERVAL_KEYS, MAX_INTERVAL_COUNT, normalizeIntervalCount,
  categoryInUseCount, subcategoryInUseCount, categoryCountByType, subcategoryCountForCategory,
} from './budget/helpers.js';
export { resolveExportRange } from './budget/entries.js';
export { BUDGET_SAVINGS_KEY, computePlanProgress } from './budget/plans.js';
export { computeStats, statsHandler } from './budget/stats.js';
