
/** Leerer/whitespace-only Wert → null, sonst getrimmter String. */
function clean(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

export function normalizeNameParts(parts = {}) {
  return {
    firstName:  clean(parts.firstName),
    lastName:   clean(parts.lastName),
    middleName: clean(parts.middleName),
    namePrefix: clean(parts.namePrefix),
    nameSuffix: clean(parts.nameSuffix),
  };
}

export function composeDisplayName(parts = {}) {
  const n = normalizeNameParts(parts);
  const joined = [n.firstName, n.middleName, n.lastName].filter(Boolean).join(' ');
  return joined || null;
}

export function splitDisplayName(name) {
  const value = clean(name);
  if (!value) return { firstName: null, lastName: null };

  const parts = value.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

export function contactSortKey(contact = {}) {
  return clean(contact.last_name) || clean(contact.name) || '';
}
