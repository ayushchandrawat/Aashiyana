
export function parsePermissionGroup(group) {
  const raw = String(group ?? '');
  const sep = raw.indexOf(':');
  if (sep < 0) return { type: raw, key: '' };
  return { type: raw.slice(0, sep), key: raw.slice(sep + 1) };
}
