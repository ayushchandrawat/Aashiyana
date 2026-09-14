
/** MIME ohne Parameter, klein: `text/plain; charset=utf-8` -> `text/plain`. */
function baseMime(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}


const PREVIEW_KINDS = Object.freeze({
  pdf:   Object.freeze(['application/pdf']),
  image: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
  text:  Object.freeze(['text/plain', 'text/csv']),
});

export function previewKind(mime) {
  const m = baseMime(mime);
  for (const [kind, types] of Object.entries(PREVIEW_KINDS)) {
    if (types.includes(m)) return kind;
  }
  return null;
}

export function isPreviewable(mime) {
  return previewKind(mime) !== null;
}
