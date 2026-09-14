
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((err) => {
        console.warn('[SW] Registrierung fehlgeschlagen:', err);
      });
  });




  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;



    setTimeout(() => window.location.reload(), 200);
  });

  const refreshSw = () => {
    navigator.serviceWorker.getRegistration()
      .then((registration) => registration?.update())
      .catch(() => {});
  };

  window.addEventListener('focus', refreshSw);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshSw();
  });
}

export function clearApiCache() {
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
    }
  } catch (err) {
    console.warn('[SW] clearApiCache fehlgeschlagen:', err);
  }
}
