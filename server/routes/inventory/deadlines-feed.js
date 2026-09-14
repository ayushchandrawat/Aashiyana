
import express from 'express';
import * as db from '../../db.js';
import { createLogger } from '../../logger.js';
import * as deadlinesIcs from '../../services/inventory-deadlines-ics.js';

const log = createLogger('Inventory');
const router = express.Router();




function getUserId(req) {
  const candidates = [req.authUserId, req.user?.id, req.session?.userId];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function feedUrl(req, token) {
  const base = process.env.BASE_URL?.replace(/\/+$/, '')
    || `${req.protocol}://${req.get('host')}`;
  return `${base}/feed/inventory-deadlines/${token}.ics`;
}

// GET /api/v1/inventory/deadlines-feed → eigener Feed-Status
router.get('/', (req, res) => {
  try {
    const token = deadlinesIcs.getFeedToken(db.get(), getUserId(req));
    if (!token) return res.json({ data: null });
    res.json({ data: { token, url: feedUrl(req, token) } });
  } catch (err) {
    log.error('GET /deadlines-feed error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// POST /api/v1/inventory/deadlines-feed/regenerate → eigenen Token neu erzeugen
router.post('/regenerate', (req, res) => {
  try {
    const token = deadlinesIcs.regenerateFeedToken(db.get(), getUserId(req));
    res.json({ data: { token, url: feedUrl(req, token) } });
  } catch (err) {
    log.error('POST /deadlines-feed/regenerate error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// DELETE /api/v1/inventory/deadlines-feed → eigenen Feed deaktivieren
router.delete('/', (req, res) => {
  try {
    deadlinesIcs.clearFeedToken(db.get(), getUserId(req));
    res.json({ data: { token: null } });
  } catch (err) {
    log.error('DELETE /deadlines-feed error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
