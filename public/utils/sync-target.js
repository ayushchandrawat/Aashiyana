
export const SYNC_TARGET_LOCAL = '';

/** @returns {string} Kennung eines Google-Kalenders. */
export function googleTargetValue(calendarId) {
  return `google:${calendarId}`;
}

/** @returns {string} Kennung eines CalDAV-Kalenders. */
export function caldavTargetValue(accountId, calendarUrl) {
  return `caldav:${accountId}|${calendarUrl}`;
}

/** @returns {string} Kennung eines Outlook-Kalenders. */
export function outlookTargetValue(accountId, calendarId) {
  return `outlook:${accountId}|${calendarId}`;
}

export function parseSyncTargetValue(value) {
  const raw = (value ?? '').trim();
  if (!raw) return { kind: 'local' };

  if (raw.startsWith('google:')) {
    const calendarId = raw.slice('google:'.length);
    return calendarId ? { kind: 'google', calendarId } : null;
  }

  if (raw.startsWith('caldav:')) {
    const rest = raw.slice('caldav:'.length);
    const separator = rest.indexOf('|');
    if (separator < 1) return null;
    const accountId = Number(rest.slice(0, separator));
    const calendarUrl = rest.slice(separator + 1);
    if (!Number.isInteger(accountId) || accountId < 1 || !calendarUrl) return null;
    return { kind: 'caldav', accountId, calendarUrl };
  }

  if (raw.startsWith('outlook:')) {
    const rest = raw.slice('outlook:'.length);
    const separator = rest.indexOf('|');
    if (separator < 1) return null;
    const accountId = Number(rest.slice(0, separator));
    const calendarId = rest.slice(separator + 1);
    if (!Number.isInteger(accountId) || accountId < 1 || !calendarId) return null;
    return { kind: 'outlook', accountId, calendarId };
  }

  return null;
}

export function buildSyncTargetOptions(targets, labels, current = '') {
  const options = [{ value: SYNC_TARGET_LOCAL, label: labels.local, group: null }];

  for (const cal of targets?.google || []) {
    options.push({
      value: googleTargetValue(cal.id),
      label: cal.summary || cal.id,
      group: labels.google,
    });
  }

  for (const cal of targets?.caldav || []) {
    options.push({
      value: caldavTargetValue(cal.accountId, cal.calendarUrl),
      label: cal.calendarName || cal.calendarUrl,
      group: `${labels.caldav} · ${cal.accountName}`,
    });
  }

  for (const cal of targets?.outlook || []) {
    options.push({
      value: outlookTargetValue(cal.accountId, cal.calendarId),
      label: cal.calendarName || cal.calendarId,
      group: `${labels.outlook ?? 'Outlook'} · ${cal.accountName}`,
    });
  }

  if (current && !options.some((option) => option.value === current)) {
    options.push({ value: current, label: labels.unavailable, group: null });
  }

  return options;
}

export function assigneeSyncTarget(targets, assigneeIds) {
  const ids = [...new Set((assigneeIds ?? []).map(Number))];
  if (ids.length !== 1 || !Number.isInteger(ids[0]) || ids[0] < 1) return { value: null, ambiguous: false };
  const [id] = ids;
  const treffer = [
    ...(targets?.google ?? [])
      .filter((cal) => Number(cal.defaultAssigneeUserId) === id)
      .map((cal) => googleTargetValue(cal.id)),
    ...(targets?.caldav ?? [])
      .filter((cal) => Number(cal.defaultAssigneeUserId) === id)
      .map((cal) => caldavTargetValue(cal.accountId, cal.calendarUrl)),
  ];
  if (treffer.length === 1) return { value: treffer[0], ambiguous: false };
  return { value: null, ambiguous: treffer.length > 1 };
}
