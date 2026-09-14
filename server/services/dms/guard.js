
import { lookup as dnsLookup } from 'node:dns/promises';
import { isBlockedAddress, isBlockedHostname, normalizeHostname } from '../../utils/ssrf.js';

const ENV_ALLOW_PRIVATE_NETWORK = 'DMS_ALLOW_PRIVATE_NETWORK';


// services/document-storage.js, damit kein Test echtes DNS braucht.
let hostnameLookup = dnsLookup;
export function _setHostnameLookup(fn) { hostnameLookup = fn || dnsLookup; }

export function isPrivateNetworkAllowed() {
  const raw = process.env[ENV_ALLOW_PRIVATE_NETWORK];
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !(normalized === 'false' || normalized === '0');
}

export class DmsTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DmsTargetError';
    this.status = 400;
  }
}

export async function assertDmsTargetAllowed(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl || ''));
  } catch {
    throw new DmsTargetError('The DMS base URL is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DmsTargetError('The DMS base URL must use http or https.');
  }

  if (isPrivateNetworkAllowed()) return;

  const hostname = normalizeHostname(url.hostname);
  if (isBlockedHostname(hostname)) {
    throw new DmsTargetError(
      `The DMS base URL points at a local host: ${hostname}. `
      + `Set ${ENV_ALLOW_PRIVATE_NETWORK}=true if that is intended.`,
    );
  }

  let addresses;
  try {
    addresses = await hostnameLookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new DmsTargetError(`The DMS hostname could not be resolved: ${hostname}`, { cause: error });
  }
  const results = Array.isArray(addresses) ? addresses : [addresses];
  if (results.length === 0) {
    throw new DmsTargetError(`The DMS hostname did not resolve to an address: ${hostname}`);
  }
  for (const entry of results) {
    if (isBlockedAddress(entry.address)) {
      throw new DmsTargetError(
        `The DMS base URL resolves to a private address: ${entry.address}. `
        + `Set ${ENV_ALLOW_PRIVATE_NETWORK}=true if that is intended.`,
      );
    }
  }
}

export { ENV_ALLOW_PRIVATE_NETWORK };
