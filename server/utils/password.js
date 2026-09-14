
import bcrypt from 'bcrypt';

export const BCRYPT_ROUNDS = 12;

/** Kanonische Form eines Passworts: NFC. */
export function normalizePassword(password) {
  return String(password ?? '').normalize('NFC');
}

export function hashPassword(password, rounds = BCRYPT_ROUNDS) {
  return bcrypt.hash(normalizePassword(password), rounds);
}

export async function verifyPassword(password, hash) {
  const raw = String(password ?? '');
  const nfc = raw.normalize('NFC');
  const candidates = [nfc];
  for (const variant of [raw, raw.normalize('NFD')]) {
    if (!candidates.includes(variant)) candidates.push(variant);
  }

  for (const candidate of candidates) {
    if (await bcrypt.compare(candidate, hash)) {
      return { valid: true, needsRehash: candidate !== nfc };
    }
  }
  return { valid: false, needsRehash: false };
}
