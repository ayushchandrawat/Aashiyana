// --------------------------------------------------------

//



//


// otpauth-URI zwar notieren, aber Google Authenticator ignoriert sie stillschweigend

// --------------------------------------------------------

import crypto from 'node:crypto';

export const TOTP_DIGITS  = 6;
export const TOTP_PERIOD  = 30;
export const TOTP_ALGO    = 'sha1';



export const TOTP_WINDOW  = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';


// zusammenfallen (0/O, 1/I/L, 5/S, 8/B). Wer abschreibt, soll wieder eintippen koennen.
const RECOVERY_ALPHABET = '23456789ACDEFGHJKMNPQRTUVWXYZ';
const RECOVERY_GROUP    = 5;
const RECOVERY_GROUPS   = 2;
export const RECOVERY_CODE_COUNT = 10;

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(key, counter, digits = TOTP_DIGITS) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac(TOTP_ALGO, key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
               | ((digest[offset + 1] & 0xff) << 16)
               | ((digest[offset + 2] & 0xff) << 8)
               | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function timeStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD);
}

export function generateCode(secret, nowMs = Date.now()) {
  return hotp(base32Decode(secret), timeStep(nowMs));
}

export function verifyCode(secret, token, { nowMs = Date.now(), window = TOTP_WINDOW, afterStep = null } = {}) {
  const clean = String(token || '').replace(/[\s-]/g, '');
  if (!/^\d+$/.test(clean) || clean.length !== TOTP_DIGITS) return { valid: false, step: null };

  let key;
  try {
    key = base32Decode(secret);
  } catch {
    return { valid: false, step: null };
  }
  if (key.length === 0) return { valid: false, step: null };

  const current = timeStep(nowMs);
  const expected = Buffer.from(clean, 'utf8');

  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    if (afterStep !== null && afterStep !== undefined && step <= afterStep) continue;
    const candidate = Buffer.from(hotp(key, step), 'utf8');
    // Gleiche Laenge per Konstruktion (beides `TOTP_DIGITS`), deshalb ist

    if (crypto.timingSafeEqual(candidate, expected)) return { valid: true, step };
  }
  return { valid: false, step: null };
}

export function otpauthUri({ secret, account, issuer = 'Aashiyana' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: TOTP_ALGO.toUpperCase(),
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const groups = [];
    for (let g = 0; g < RECOVERY_GROUPS; g += 1) {
      let group = '';


      while (group.length < RECOVERY_GROUP) {
        for (const byte of crypto.randomBytes(RECOVERY_GROUP)) {
          if (byte >= 256 - (256 % RECOVERY_ALPHABET.length)) continue;
          group += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
          if (group.length === RECOVERY_GROUP) break;
        }
      }
      groups.push(group);
    }
    codes.push(groups.join('-'));
  }
  return codes;
}

export function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code), 'utf8').digest('hex');
}
