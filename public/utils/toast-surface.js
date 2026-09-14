
export const TOAST_SURFACES = Object.freeze({
  polite: 'toast-container-polite',
  assertive: 'toast-container-assertive',
});

export function toastSurface(urgency = 'polite') {
  return document.getElementById(TOAST_SURFACES[urgency] ?? TOAST_SURFACES.polite);
}
