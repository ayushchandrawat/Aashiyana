
import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';
import { deniedModules } from '../permissions.js';
import { todayKey } from '../utils/timezone.js';

const log = createLogger('Kitchen');
const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;


const EMPTY_PANTRY = Object.freeze({ attention: 0, expired: 0, low: 0, out: 0 });

router.get('/summary', (req, res) => {
  try {
    const today = DATE_RE.test(req.query.today ?? '')
      ? req.query.today
      : todayKey(db.get());

    const denied = deniedModules(req.sessionModuleAccess);

    const open = denied.has('shopping') ? 0 : db.get().prepare(
      'SELECT COUNT(*) AS c FROM shopping_items WHERE is_checked = 0'
    ).get().c;





    const pantry = denied.has('pantry') ? null : db.get().prepare(`
      SELECT
        SUM(CASE WHEN expires_on IS NOT NULL AND expires_on < ? THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END) AS out_of_stock,
        SUM(CASE WHEN quantity > 0 AND min_quantity IS NOT NULL AND quantity <= min_quantity THEN 1 ELSE 0 END) AS low,
        SUM(CASE WHEN (expires_on IS NOT NULL AND expires_on < ?)
                   OR quantity <= 0
                   OR (min_quantity IS NOT NULL AND quantity <= min_quantity)
                 THEN 1 ELSE 0 END) AS attention
      FROM pantry_items
    `).get(today, today);

    res.json({
      data: {
        shopping: { open },
        pantry: pantry ? {
          attention: pantry.attention ?? 0,
          expired: pantry.expired ?? 0,
          low: pantry.low ?? 0,
          out: pantry.out_of_stock ?? 0,
        } : { ...EMPTY_PANTRY },
      },
    });
  } catch (err) {
    log.error('GET /summary error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
