import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, MAX_TITLE, MAX_URL } from '../middleware/validate.js';
import { getAdapter, SUPPORTED_PROVIDERS } from '../services/recipe-providers/index.js';
import {
  isBlockedBaseUrl, isPrivateNetworkRefusal, withPrivateNetworkHint, PRIVATE_NETWORK_MESSAGE,
} from '../services/recipe-providers/private-network.js';
import { sync, syncOne, getStatus } from '../services/recipe-provider-sync.js';

const log = createLogger('RecipeProviders');
const router = express.Router();

function isAdmin(req) { return req.authRole === 'admin' || req.session?.role === 'admin'; }
function userId(req) { return req.authUserId || req.session?.userId; }

function publicAccount(row) {
  if (!row) return null;
  const { api_token, ...rest } = row;
  return { ...rest, has_token: Boolean(api_token) };
}

function getAccount(id) {
  return db.get().prepare('SELECT * FROM recipe_provider_accounts WHERE id = ?').get(id);
}

router.get('/accounts', (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const rows = db.get().prepare('SELECT * FROM recipe_provider_accounts ORDER BY name COLLATE NOCASE').all();
    res.json({ data: rows.map(publicAccount) });
  } catch (err) {
    log.error('GET /accounts error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/accounts', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const provider = SUPPORTED_PROVIDERS.includes(req.body.provider) ? req.body.provider : 'mealie';
    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    const vUrl = str(req.body.base_url, 'Base URL', { max: MAX_URL });
    const vToken = str(req.body.api_token, 'API token', { max: 500 });
    for (const v of [vName, vUrl, vToken]) if (v.error) return res.status(400).json({ error: v.error, code: 400 });
    if (!/^https?:\/\//i.test(vUrl.value)) return res.status(400).json({ error: 'Base URL must start with http(s)://', code: 400 });




    let externalUrl = null;
    if (req.body.external_url) {
      const vExternal = str(req.body.external_url, 'External URL', { max: MAX_URL });
      if (vExternal.error) return res.status(400).json({ error: vExternal.error, code: 400 });
      if (!/^https?:\/\//i.test(vExternal.value)) {
        return res.status(400).json({ error: 'External URL must start with http(s)://', code: 400 });
      }
      externalUrl = vExternal.value.replace(/\/+$/, '');
    }

    const baseUrl = vUrl.value.replace(/\/+$/, '');




    // Lookup-Hook im Adapter, je Verbindung.
    if (isBlockedBaseUrl(baseUrl)) return res.status(400).json({ error: PRIVATE_NETWORK_MESSAGE, code: 400 });
    const test = await getAdapter({ provider, base_url: baseUrl, api_token: vToken.value }).testConnection();
    if (!test.ok) {

      // Credential-Frage - bis #1053 hiess die Antwort trotzdem so.
      if (isPrivateNetworkRefusal(test.error)) {
        return res.status(400).json({ error: withPrivateNetworkHint(test.error), code: 400 });
      }
      return res.status(502).json({ error: 'Could not connect to the recipe provider with these credentials.', code: 502 });
    }

    if (!process.env.DB_ENCRYPTION_KEY) {
      log.warn('WARNING: DB_ENCRYPTION_KEY is not set - the recipe provider API token will be stored unencrypted.');
    }

    const result = db.get().prepare(`
      INSERT INTO recipe_provider_accounts (provider, name, base_url, external_url, api_token, created_by) VALUES (?, ?, ?, ?, ?, ?)
    `).run(provider, vName.value, baseUrl, externalUrl, vToken.value, userId(req));
    res.status(201).json({ data: publicAccount(getAccount(result.lastInsertRowid)) });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A recipe provider account with this URL already exists.', code: 409 });
    }
    log.error('POST /accounts error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.patch('/accounts/:id', (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const account = getAccount(Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'Recipe provider account not found.', code: 404 });

    const enabled = req.body.enabled === undefined ? account.enabled : (req.body.enabled ? 1 : 0);
    let name = account.name;
    if (req.body.name !== undefined) {
      const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
      if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });
      name = vName.value;
    }

    let externalUrl = account.external_url;
    if (req.body.external_url !== undefined) {
      if (!req.body.external_url) {
        externalUrl = null;
      } else {
        const vExternal = str(req.body.external_url, 'External URL', { max: MAX_URL });
        if (vExternal.error) return res.status(400).json({ error: vExternal.error, code: 400 });
        if (!/^https?:\/\//i.test(vExternal.value)) {
          return res.status(400).json({ error: 'External URL must start with http(s)://', code: 400 });
        }
        externalUrl = vExternal.value.replace(/\/+$/, '');
      }
    }

    db.get().prepare('UPDATE recipe_provider_accounts SET name = ?, enabled = ?, external_url = ? WHERE id = ?')
      .run(name, enabled, externalUrl, account.id);
    res.json({ data: publicAccount(getAccount(account.id)) });
  } catch (err) {
    log.error('PATCH /accounts/:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.delete('/accounts/:id', (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const id = Number(req.params.id);
    const existing = getAccount(id);
    if (!existing) return res.status(404).json({ error: 'Recipe provider account not found.', code: 404 });



    db.get().prepare('DELETE FROM recipe_provider_accounts WHERE id = ?').run(id);
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /accounts/:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/accounts/:id/test', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const account = getAccount(Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'Recipe provider account not found.', code: 404 });
    const probe = await getAdapter(account).testConnection();


    const result = probe.ok ? probe : { ...probe, error: withPrivateNetworkHint(probe.error) };
    if (!result.ok) db.get().prepare('UPDATE recipe_provider_accounts SET last_error = ? WHERE id = ?').run(result.error || `HTTP ${result.status}`, account.id);
    res.json({ data: result });
  } catch (err) {
    log.error('POST /accounts/:id/test error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/accounts/:id/sync', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const account = getAccount(Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'Recipe provider account not found.', code: 404 });
    const result = await syncOne(account.id);
    res.json({ data: result });
  } catch (err) {
    log.error('POST /accounts/:id/sync error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/sync', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const result = await sync();
    res.json({ data: result });
  } catch (err) {
    log.error('POST /sync error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});




router.get('/status', (_req, res) => {
  try {
    res.json({ data: getStatus() });
  } catch (err) {
    log.error('GET /status error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
