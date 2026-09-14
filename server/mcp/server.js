import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';
import { handleMcpRequest, PARSE_ERROR } from './protocol.js';

const log = createLogger('MCP');
const router = express.Router();

function isSplitGuest(userId) {
  if (userId == null) return true;
  try {
    return Boolean(db.get().prepare('SELECT 1 FROM split_expense_guest_users WHERE user_id = ?').get(userId));
  } catch (err) {
    log.error('Split-guest lookup failed:', err.message);
    return true;
  }
}

router.post('/', async (req, res) => {
  try {
    if (req.body === undefined || req.body === null || typeof req.body !== 'object') {
      return res.status(400).json({
        jsonrpc: '2.0', id: null,
        error: { code: PARSE_ERROR, message: 'Parse error: expected a JSON-RPC 2.0 body.' },
      });
    }
    const actor = {
      id: req.authUserId,
      role: req.authRole,
      scopes: req.authScopes ?? null,
      moduleAccess: req.sessionModuleAccess ?? null,
      splitGuest: isSplitGuest(req.authUserId),
    };
    const response = await handleMcpRequest(
      db.get(),
      actor,
      req.body,
      (err) => {
        log.error('MCP tool error:', err);
      },
      { requestHeaders: req.headers },
    );
    if (response === null) return res.status(202).end();
    return res.json(response);
  } catch (err) {
    log.error('MCP request error:', err);
    return res.status(500).json({
      jsonrpc: '2.0', id: null,
      error: { code: -32603, message: 'Internal error.' },
    });
  }
});

router.get('/', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0', id: null,
    error: { code: -32000, message: 'Method Not Allowed: use POST for MCP requests.' },
  });
});

export default router;
