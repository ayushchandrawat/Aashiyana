
export const ALLOWED_QUICK_LINK_PROTOCOLS = ['http:', 'https:'];

export const MAX_QUICK_LINK_URL_LENGTH = 2000;



const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function normalizeQuickLinkUrl(raw) {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) return { ok: false, reason: 'empty' };
  if (input.length > MAX_QUICK_LINK_URL_LENGTH) return { ok: false, reason: 'too-long' };

  const candidate = SCHEME_RE.test(input) ? input : `https://${input}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!ALLOWED_QUICK_LINK_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, reason: 'protocol' };
  }

  if (!parsed.host) return { ok: false, reason: 'malformed' };




  const normalized = parsed.href;
  if (normalized.length > MAX_QUICK_LINK_URL_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, url: normalized };
}

export function quickLinkHost(url) {
  try {
    return new URL(String(url)).host;
  } catch {
    return '';
  }
}
