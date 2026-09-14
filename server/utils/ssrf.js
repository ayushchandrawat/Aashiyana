
import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';

const BLOCKED_SUBNETS = [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['2001::', 32, 'ipv6'],
  ['2001:2::', 48, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
];

const BLOCKED_NETWORKS = new BlockList();
for (const [address, prefix, type] of BLOCKED_SUBNETS) {
  BLOCKED_NETWORKS.addSubnet(address, prefix, type);
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

export function normalizeHostname(hostname) {
  const value = String(hostname).toLowerCase();
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

export function isBlockedAddress(address) {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  if (!family) return true;
  return BLOCKED_NETWORKS.check(normalized, family === 6 ? 'ipv6' : 'ipv4');
}

export function isBlockedHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === 'localhost'
    || BLOCKED_HOST_SUFFIXES.some(
      (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix),
    )
  );
}

export function readPrivateNetworkOptIn(envName) {
  const raw = process.env[envName];
  return raw !== undefined && (raw.trim() === 'true' || raw.trim() === '1');
}

export function createGuardedLookup({ allowPrivate = false, lookup = dnsLookup } = {}) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const opts = typeof options === 'number' ? { family: options } : (options || {});
    lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!allowPrivate) {
        for (const entry of addresses) {
          if (isBlockedAddress(entry.address)) {
            return callback(new Error(`URL resolves to a private IP address: ${entry.address}`));
          }
        }
      }
      if (opts.all) return callback(null, addresses);
      const [first] = addresses;
      return callback(null, first.address, first.family);
    });
  };
}

export { BLOCKED_SUBNETS, BLOCKED_HOST_SUFFIXES };
