
import crypto from 'node:crypto';

const TOKEN_LENGTH = 32; // Bytes → 64 Hex-Zeichen

/**
 * Generiert einen kryptographisch sicheren CSRF-Token.
 * @returns {string} 64-stelliger Hex-String
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

function csrfMiddleware(req, res, next) {
  if (req.authMethod === 'api_token') return next();


  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }


  res.cookie('csrf-token', req.session.csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.SESSION_SECURE === 'true',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 Tage (gleich wie Session)
  });



  res.setHeader('X-CSRF-Token', req.session.csrfToken);


  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }


  const headerToken   = req.headers['x-csrf-token'] ?? '';
  const sessionToken  = req.session.csrfToken;
  const expectedLen   = TOKEN_LENGTH * 2; // 64 Hex-Zeichen

  let tokenValid = false;
  try {
    tokenValid =
      headerToken.length === expectedLen &&
      sessionToken.length === expectedLen &&

      /^[0-9a-f]+$/i.test(headerToken) &&
      crypto.timingSafeEqual(
        Buffer.from(headerToken,  'hex'),
        Buffer.from(sessionToken, 'hex')
      );
  } catch {
    // Buffer-Fehler bei korruptem Token - tokenValid bleibt false
  }

  if (!tokenValid) {
    return res.status(403).json({ error: 'Invalid CSRF token.', code: 403 });
  }

  next();
}

export { csrfMiddleware, generateToken };
