
export function createPageController(routeSignal = null) {
  const controller = new AbortController();
  if (!routeSignal) return controller;
  if (routeSignal.aborted) {
    controller.abort();
    return controller;
  }
  routeSignal.addEventListener('abort', () => controller.abort(), {
    once: true,
    signal: controller.signal,
  });
  return controller;
}
