
/** MIME ohne Parameter, klein: `text/plain; charset=utf-8` -> `text/plain`. */
function baseMime(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

export const SHAREABLE_MIME = Object.freeze([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
]);

export function isShareableMime(mime) {
  return SHAREABLE_MIME.includes(baseMime(mime));
}

export function fileShareSupport(doc, env = {}) {
  if (!isShareableMime(doc?.mime_type)) return 'type';
  const nav = env.navigator ?? globalThis.navigator;
  const secure = env.secure ?? globalThis.isSecureContext === true;
  const FileCtor = env.FileCtor ?? globalThis.File;
  if (!secure || !nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || typeof FileCtor !== 'function') {
    return 'unavailable';
  }
  try {
    const probe = new FileCtor([], doc?.name || 'document', { type: baseMime(doc?.mime_type) });
    return nav.canShare({ files: [probe] }) ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
