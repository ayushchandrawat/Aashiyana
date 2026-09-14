import { categorizeIngredient } from './categorize.js';
import { safeRequest } from '../../utils/http.js';
import { createGuardedLookup } from '../../utils/ssrf.js';


import { isPrivateNetworkAllowed } from './private-network.js';

const REQUEST_TIMEOUT_MS = 8000;
const PAGE_SIZE = 50;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024;

function guardedRequestOptions(headers) {
  const opts = { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (!isPrivateNetworkAllowed()) opts.lookup = createGuardedLookup();
  return opts;
}

async function drainBody(res, maxBytes, tooLargeMessage) {
  const chunks = [];
  let total = 0;
  for await (const value of res.body) {
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > maxBytes) {
      res.body.destroy();
      throw new Error(tooLargeMessage);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function readJson(res) {
  const buffer = await drainBody(res, MAX_RESPONSE_BYTES, 'Mealie response exceeds the 10 MB limit.');
  return JSON.parse(buffer.toString('utf8'));
}

function formatQuantity(quantity, unit) {





  if (!quantity) return null;
  const amount = Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 100) / 100);
  if (!unit) return amount;
  const label = (unit.useAbbreviation && unit.abbreviation) || unit.name;
  return label ? `${amount} ${label}` : amount;
}

function flattenIngredient(ing) {
  const foodName = ing.food?.name?.trim();
  const name = foodName || (ing.display || ing.originalText || '').trim() || '?';
  const quantity = foodName ? formatQuantity(ing.quantity, ing.unit) : null;
  const category = categorizeIngredient({ labelName: ing.food?.label?.name, foodName });
  return { name, quantity, category };
}

export class MealieAdapter {
  constructor(account) {
    this.provider = 'mealie';
    this.base = String(account.base_url || '').replace(/\/+$/, '');
    this.token = account.api_token;





    this.linkBase = String(account.external_url || account.base_url || '').replace(/\/+$/, '');
  }

  headers(extra = {}) {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...extra };
  }

  async #request(path, opts = {}) {
    const reqOpts = { ...opts, ...guardedRequestOptions(this.headers(opts.headers)) };
    const res = await safeRequest(`${this.base}${path}`, reqOpts);
    if (!res.ok) {
      const err = new Error(`Mealie request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res;
  }



  async testConnection() {
    try {
      const res = await safeRequest(`${this.base}/api/users/self`, guardedRequestOptions(this.headers()));
      if (!res.ok) return { ok: false, status: res.status };
      const user = await readJson(res);
      return { ok: true, status: res.status, linkContext: { groupSlug: user.groupSlug || null } };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  }





  async listRecipeSummaries() {
    const summaries = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await this.#request(`/api/recipes?page=${page}&perPage=${PAGE_SIZE}`);
      const body = await readJson(res);
      for (const item of body.items || []) {
        summaries.push({ id: item.id, ref: item.slug, updatedAt: item.updatedAt });
      }
      totalPages = body.total_pages || 1;
      page += 1;
    } while (page <= totalPages);
    return summaries;
  }

  async getRecipe(ref) {
    const res = await this.#request(`/api/recipes/${encodeURIComponent(ref)}`);
    const detail = await readJson(res);
    return {
      id: detail.id,
      updatedAt: detail.updatedAt,
      slug: detail.slug,
      title: detail.name,
      notes: detail.description || null,
      hasImage: Boolean(detail.image),
      ingredients: (detail.recipeIngredient || []).map(flattenIngredient),
    };
  }

  recipeUrl(linkContext, { slug }) {
    if (!linkContext?.groupSlug) return null;
    return `${this.linkBase}/g/${encodeURIComponent(linkContext.groupSlug)}/r/${encodeURIComponent(slug)}`;
  }






  // Medien-Route dort verlangt denselben Bearer-Token wie jeder andere Endpunkt.
  async fetchThumbnail({ id }) {
    const url = `${this.base}/api/media/recipes/${encodeURIComponent(id)}/images/min-original.webp`;
    const res = await safeRequest(url, guardedRequestOptions(this.headers({ Accept: 'image/*' })));
    if (!res.ok) {
      const err = new Error(`Mealie thumbnail request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const buffer = await drainBody(res, MAX_THUMBNAIL_BYTES, 'Mealie thumbnail exceeds the 20 MB limit.');
    return { buffer, mime: res.headers.get('content-type') || 'image/webp' };
  }
}
