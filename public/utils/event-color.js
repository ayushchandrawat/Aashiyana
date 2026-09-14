
export const EVENT_FALLBACK_COLOR = '#8E8E93';

export function resolveEventColor(ev) {
  return resolveEventColorOrNull(ev) ?? EVENT_FALLBACK_COLOR;
}

export function resolveEventColorOrNull(ev) {
  if (!ev) return null;
  if (ev.color) return ev.color;
  const assignees = ev.assigned_users ?? [];
  if (assignees.length > 0) {
    const primary = assignees.find((u) => u.id === ev.assigned_to) ?? assignees[0];
    if (primary.color) return primary.color;


    // nicht zugewiesener.
    return null;
  }
  return ev.cal_color || null;
}
