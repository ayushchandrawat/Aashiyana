import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Encode, base32Decode, hotp, generateCode, verifyCode, generateSecret,
  otpauthUri, generateRecoveryCodes, normalizeRecoveryCode, hashRecoveryCode,
  timeStep, TOTP_PERIOD, RECOVERY_CODE_COUNT,
} from '../server/utils/totp.js';


const RFC4226_KEY = Buffer.from('12345678901234567890', 'utf8');
const RFC4226_CODES = [
  '755224', '287082', '359152', '969429', '338314',
  '254676', '287922', '162583', '399871', '520489',
];

test('HOTP trifft alle Vektoren aus RFC 4226', () => {
  RFC4226_CODES.forEach((expected, counter) => {
    assert.equal(hotp(RFC4226_KEY, counter), expected, `Zaehler ${counter}`);
  });
});

test('TOTP trifft die SHA-1-Vektoren aus RFC 6238', () => {
  const secret = base32Encode(RFC4226_KEY);


  const vectors = [
    [59,          '94287082'],
    [1111111109,  '07081804'],
    [1111111111,  '14050471'],
    [1234567890,  '89005924'],
    [2000000000,  '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [seconds, eightDigits] of vectors) {
    const expected = eightDigits.slice(-6);
    assert.equal(generateCode(secret, seconds * 1000), expected, `t=${seconds}`);
  }
});

test('Base32 laeuft hin und zurueck, auch mit Padding und klein geschrieben', () => {
  for (const sample of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', '12345678901234567890']) {
    const encoded = base32Encode(Buffer.from(sample, 'utf8'));
    assert.equal(base32Decode(encoded).toString('utf8'), sample, sample);
    assert.equal(base32Decode(`${encoded}======`).toString('utf8'), sample, 'Padding');
    assert.equal(base32Decode(encoded.toLowerCase()).toString('utf8'), sample, 'klein');
  }
  assert.throws(() => base32Decode('!!!'), /Invalid base32/);
});

test('generateSecret liefert 160 Bit, verschieden je Aufruf', () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.equal(a.length, 32);            // 20 Byte -> 32 Base32-Zeichen
  assert.equal(base32Decode(a).length, 20);
  assert.notEqual(a, b);
});

test('das Zeitfenster reicht genau einen Schritt in jede Richtung', () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const step = TOTP_PERIOD * 1000;

  assert.equal(verifyCode(secret, generateCode(secret, now), { nowMs: now }).valid, true, 'jetzt');
  assert.equal(verifyCode(secret, generateCode(secret, now - step), { nowMs: now }).valid, true, 'ein Schritt zurueck');
  assert.equal(verifyCode(secret, generateCode(secret, now + step), { nowMs: now }).valid, true, 'ein Schritt vor');
  assert.equal(verifyCode(secret, generateCode(secret, now - 2 * step), { nowMs: now }).valid, false, 'zwei zurueck');
  assert.equal(verifyCode(secret, generateCode(secret, now + 2 * step), { nowMs: now }).valid, false, 'zwei vor');
});

test('ein eingeloester Schritt wird kein zweites Mal angenommen', () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const code = generateCode(secret, now);

  const first = verifyCode(secret, code, { nowMs: now });
  assert.equal(first.valid, true);
  assert.equal(first.step, timeStep(now));


  assert.equal(verifyCode(secret, code, { nowMs: now, afterStep: first.step }).valid, false);


  const later = now + TOTP_PERIOD * 1000;
  assert.equal(verifyCode(secret, generateCode(secret, later), { nowMs: later, afterStep: first.step }).valid, true);
});

test('unbrauchbare Eingaben werden abgelehnt, ohne zu werfen', () => {
  const secret = generateSecret();
  for (const bad of [undefined, null, '', '12345', '1234567', 'abcdef', '12 34 56', {}, []]) {
    assert.equal(verifyCode(secret, bad).valid, false, JSON.stringify(bad));
  }

  // Authenticator-Apps zeigen '123 456'.
  const now = 1_700_000_000_000;
  const code = generateCode(secret, now);
  assert.equal(verifyCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now }).valid, true);


  assert.equal(verifyCode('nicht base32 !!!', code).valid, false);
  assert.equal(verifyCode('', code).valid, false);
});

test('die otpauth-URI traegt Aussteller, Konto und die Parameter', () => {
  const uri = otpauthUri({ secret: 'ABCDEFGH', account: 'anna müller' });
  assert.match(uri, /^otpauth:\/\/totp\/Aashiyana:/);
  const url = new URL(uri);
  assert.equal(url.searchParams.get('secret'), 'ABCDEFGH');
  assert.equal(url.searchParams.get('issuer'), 'Aashiyana');
  assert.equal(url.searchParams.get('algorithm'), 'SHA1');
  assert.equal(url.searchParams.get('digits'), '6');
  assert.equal(url.searchParams.get('period'), '30');

  assert.ok(!uri.includes('anna müller'));
  assert.ok(decodeURIComponent(uri).includes('anna müller'));
});

test('Wiederherstellungscodes: Form, Alphabet, Eindeutigkeit', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length, 'keine Dublette');
  for (const code of codes) {
    assert.match(code, /^[2-9A-Z]{5}-[2-9A-Z]{5}$/, code);

    assert.ok(!/[01ILOSB]/.test(code), `verwechselbares Zeichen in ${code}`);
  }
});

test('die Normalisierung ueberlebt die Schreibweise des Nutzers', () => {
  const [code] = generateRecoveryCodes(1);
  const hash = hashRecoveryCode(code);
  for (const typed of [code, code.toLowerCase(), code.replace('-', ''), ` ${code} `, code.replace('-', ' ')]) {
    assert.equal(hashRecoveryCode(typed), hash, typed);
  }
  assert.equal(normalizeRecoveryCode(code).length, 10);

  const [other] = generateRecoveryCodes(1);
  assert.notEqual(hashRecoveryCode(other), hash);
});
