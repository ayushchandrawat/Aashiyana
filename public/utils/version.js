
function parseVersion(value) {
  const raw = String(value ?? '').trim().replace(/^v/i, '');
  if (!raw) return null;
  const [core, ...rest] = raw.split('-');
  const parts = core.split('.').map((segment) => Number(segment));
  if (!parts.length || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return { parts, prerelease: rest.join('-') };
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;

  const length = Math.max(left.parts.length, right.parts.length);
  for (let i = 0; i < length; i += 1) {

    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

export function displayVersion(value) {
  return String(value ?? '').trim().replace(/^v/i, '');
}

export function isNewerVersion(candidate, current) {
  const result = compareVersions(candidate, current);
  return result !== null && result > 0;
}

export function releasesNewForMe(releases, currentVersion, seenInstalled) {
  if (!seenInstalled || !currentVersion) return [];
  return (Array.isArray(releases) ? releases : []).filter((r) => {
    const v = r?.version;
    if (!v) return false;
    return isNewerVersion(v, seenInstalled) && !isNewerVersion(v, currentVersion);
  });
}
