
import { safeRequest } from '../../utils/http.js';
import { createGuardedLookup, readPrivateNetworkOptIn } from '../../utils/ssrf.js';

export const ENV_ALLOW_PRIVATE_NETWORK = 'NOTIFICATION_ALLOW_PRIVATE_NETWORK';



// kein Benachrichtigungsdienst.
const MAX_RESPONSE_BYTES = 1024 * 1024;

export function isPrivateNetworkAllowed() {
  return readPrivateNetworkOptIn(ENV_ALLOW_PRIVATE_NETWORK);
}

async function drainBody(body) {
  const chunks = [];
  let total = 0;
  for await (const value of body) {
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      body.destroy();
      throw new Error('Notification target response exceeds the 1 MB limit.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function guardedFetch(url, { method = 'GET', headers = {}, body, signal, lookup } = {}) {
  const outHeaders = { ...headers };
  let outBody = body;
  if (body instanceof URLSearchParams) {
    outBody = body.toString();
    const hasType = Object.keys(outHeaders).some((h) => h.toLowerCase() === 'content-type');
    if (!hasType) outHeaders['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  }
  const opts = { method, headers: outHeaders, body: outBody, signal };
  if (lookup) opts.lookup = lookup;
  else if (!isPrivateNetworkAllowed()) opts.lookup = createGuardedLookup();

  const res = await safeRequest(url, opts);


  const buffer = await drainBody(res.body);
  const text = buffer.toString('utf8');
  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

export default guardedFetch;
