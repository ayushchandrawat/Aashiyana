import { createLogger } from '../logger.js';

const log = createLogger('Upload');

const DEFAULT_MB = 5;
const MIN_MB     = 1;
const MAX_MB = 100;

function readLimitMb() {
  const raw = (process.env.MAX_UPLOAD_MB || '').trim();
  if (!raw) return DEFAULT_MB;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    log.warn(`MAX_UPLOAD_MB is "${raw}", which is not a positive number - falling back to ${DEFAULT_MB} MB.`);
    return DEFAULT_MB;
  }
  const clamped = Math.min(Math.max(Math.floor(value), MIN_MB), MAX_MB);
  if (clamped !== Math.floor(value)) {
    log.warn(`MAX_UPLOAD_MB is ${value}, outside the supported range ${MIN_MB}-${MAX_MB} - using ${clamped} MB.`);
  }
  return clamped;
}

export const MAX_UPLOAD_MB    = readLimitMb();
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const BODY_LIMIT = `${Math.ceil(MAX_UPLOAD_MB * 1.4)}mb`;

export const __test = { readLimitMb, DEFAULT_MB, MIN_MB, MAX_MB };
