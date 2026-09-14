import * as client from 'openid-client';

let _config = null;

export function isOidcEnabled() {
  return !!(
    process.env.OIDC_ISSUER &&
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET &&
    process.env.OIDC_REDIRECT_URI
  );
}

export function isOidcSignupAllowed() {
  return process.env.OIDC_ALLOW_SIGNUP !== 'false';
}

export const OIDC_PASSWORD_SENTINEL = '$oidc$';

export function isSsoOnlyAccount(passwordHash) {
  return passwordHash === OIDC_PASSWORD_SENTINEL;
}

export function isPasswordLoginEnabled({ hasLinkedSsoAccount = true } = {}) {
  if (process.env.AUTH_ALLOW_PASSWORD_LOGIN !== 'false') return true;

  if (!isOidcEnabled()) return true;

  // kommt. Eine frische Installation legt ihren ersten Administrator ueber






  return !hasLinkedSsoAccount;
}

export function passwordLoginWarning({ hasLinkedSsoAccount = true } = {}) {
  if (process.env.AUTH_ALLOW_PASSWORD_LOGIN !== 'false') return null;
  if (!isOidcEnabled()) {
    return 'AUTH_ALLOW_PASSWORD_LOGIN=false is ignored because OIDC is not fully configured '
      + '(OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI). '
      + 'Password login stays enabled - otherwise nobody could sign in.';
  }




  if (!hasLinkedSsoAccount) {
    return 'AUTH_ALLOW_PASSWORD_LOGIN=false has no effect yet because no account is linked to '
      + 'the OIDC provider. Password login stays enabled until somebody signs in through SSO '
      + 'at least once - otherwise nobody could sign in at all.';
  }
  return null;
}

export async function getConfig() {
  if (!isOidcEnabled()) return null;
  if (_config) return _config;



  _config = await client.discovery(
    new URL(process.env.OIDC_ISSUER),
    process.env.OIDC_CLIENT_ID,
    process.env.OIDC_CLIENT_SECRET,
    client.ClientSecretBasic(process.env.OIDC_CLIENT_SECRET),
  );

  return _config;
}

export function resetClient() {
  _config = null;
}
