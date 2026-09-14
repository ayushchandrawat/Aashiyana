const DEFAULT_BYTES = 5 * 1024 * 1024;

let maxBytes = DEFAULT_BYTES;

export function setMaxUploadBytes(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) maxBytes = n;
}

export function maxUploadBytes() {
  return maxBytes;
}

export function maxUploadMb() {
  return Math.round(maxBytes / (1024 * 1024));
}

export const __test = { DEFAULT_BYTES };
