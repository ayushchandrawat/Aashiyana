

const stack = [];

let seq = 0;


let markerActive = false;



let pendingSelfPops = 0;

let syncScheduled = false;

let closing = false;

function historyState() {
  return typeof history === 'undefined' ? null : history.state;
}

function syncMarker() {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => {
    syncScheduled = false;
    const wanted = stack.length > 0;
    if (wanted === markerActive) return;

    if (wanted) {
      markerActive = true;
      history.pushState({ ...(historyState() ?? {}), overlay: true }, '', location.href);
    } else {
      markerActive = false;
      pendingSelfPops += 1;
      history.back();
    }
  });
}

export function pushOverlay(close) {
  const token = ++seq;
  stack.push({ token, close });
  syncMarker();
  return token;
}

export function attachOverlay(el, close) {
  const token = pushOverlay(close);
  const entry = stack[stack.length - 1];
  const observer = new MutationObserver(() => {
    if (el.isConnected) return;
    dropOverlay(token);
  });
  observer.observe(document, { childList: true, subtree: true });
  entry.detach = () => observer.disconnect();
  return token;
}

export function dropOverlay(token) {
  const index = stack.findIndex((entry) => entry.token === token);
  if (index === -1) return;
  stack.splice(index, 1)[0].detach?.();
  syncMarker();
}

export async function handleBackNavigation() {
  if (pendingSelfPops > 0) {
    pendingSelfPops -= 1;
    return true;
  }
  if (closing) {
    pendingSelfPops += 1;
    history.forward();
    return true;
  }
  if (!markerActive) return false;



  markerActive = false;

  const entry = stack.pop();
  if (!entry) return false;

  closing = true;
  try {
    const result = await entry.close({ force: false });
    if (result === false) stack.push(entry);
    else entry.detach?.();
  } finally {
    closing = false;
  }



  syncMarker();
  return true;
}

export function consumeOverlayMarker() {
  const open = stack.splice(0);
  for (const entry of open.reverse()) {
    entry.detach?.();

    try { entry.close({ force: true }); } catch { /* siehe oben */ }
  }
  const had = markerActive;
  markerActive = false;
  return had;
}

export function closeAllOverlays() {
  const open = stack.splice(0);
  for (const entry of open.reverse()) {
    entry.detach?.();
    try { entry.close({ force: true }); } catch { /* darf das Abmelden nicht aufhalten */ }
  }
}

export function isOverlayOpen(token) {
  return stack.some((entry) => entry.token === token);
}

/** Steht gerade irgendein Overlay im Register? */
export function hasOpenOverlay() {
  return stack.length > 0;
}
