import { isIP } from 'node:net';
import {
  isBlockedAddress, isBlockedHostname, normalizeHostname, readPrivateNetworkOptIn,
} from '../../utils/ssrf.js';

export const ENV_ALLOW_PRIVATE_NETWORK = 'RECIPE_PROVIDER_ALLOW_PRIVATE_NETWORK';

export function isPrivateNetworkAllowed() {
  return readPrivateNetworkOptIn(ENV_ALLOW_PRIVATE_NETWORK);
}

export const PRIVATE_NETWORK_MESSAGE =
  `Recipe provider URL must not point to a private or local network address (set ${ENV_ALLOW_PRIVATE_NETWORK}=true to allow it).`;

export function isBlockedBaseUrl(baseUrl) {
  if (isPrivateNetworkAllowed()) return false;
  let url;
  try { url = new URL(baseUrl); } catch { return false; }
  const host = normalizeHostname(url.hostname);
  return isBlockedHostname(host) || (isIP(host) !== 0 && isBlockedAddress(host));
}

export function isPrivateNetworkRefusal(message) {
  return /private IP address/i.test(String(message ?? ''));
}

export function withPrivateNetworkHint(message) {
  if (!isPrivateNetworkRefusal(message)) return message;
  return `${message} - ${PRIVATE_NETWORK_MESSAGE}`;
}
