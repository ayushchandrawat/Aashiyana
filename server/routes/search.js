
import express from 'express';
import * as db from '../db.js';
import { runSearch, emptySearchResults, SEARCH_MODULES } from '../services/search.js';
import { hiddenModulesFor } from '../permissions.js';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json(emptySearchResults());

    const userId = req.authUserId || req.session.userId;
    res.json(runSearch(db.get(), q, userId, {
      hiddenModules: hiddenModulesFor(req, SEARCH_MODULES),
    }));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
