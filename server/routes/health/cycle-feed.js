
import express from 'express';
import * as db from '../../db.js';
import { viewerId, log } from './helpers.js';
import * as cycleIcs from '../../services/cycle-ics.js';

const router = express.Router();

function feedUrl(req, token) {
  const base = process.env.BASE_URL?.replace(/\/+$/, '')
    || `${req.protocol}://${req.get('host')}`;
  return `${base}/feed/cycle/${token}.ics`;
}

// GET /api/v1/health/cycle/feed → eigener Feed-Status
router.get('/cycle/feed', (req, res) => {
  try {
    const token = cycleIcs.getFeedToken(db.get(), viewerId(req));
    if (!token) return res.json({ data: null });
    res.json({ data: { token, url: feedUrl(req, token) } });
  } catch (err) {
    log.error('GET /cycle/feed error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// POST /api/v1/health/cycle/feed/regenerate → eigenen Token neu erzeugen
router.post('/cycle/feed/regenerate', (req, res) => {
  try {
    const token = cycleIcs.regenerateFeedToken(db.get(), viewerId(req));
    res.json({ data: { token, url: feedUrl(req, token) } });
  } catch (err) {
    log.error('POST /cycle/feed/regenerate error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// DELETE /api/v1/health/cycle/feed → eigenen Feed deaktivieren
router.delete('/cycle/feed', (req, res) => {
  try {
    cycleIcs.clearFeedToken(db.get(), viewerId(req));
    res.json({ data: { token: null } });
  } catch (err) {
    log.error('DELETE /cycle/feed error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
