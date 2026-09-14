
export function startLiveFeed({
  fetchVersions,
  onChange,
  signal = null,
  intervalMs = 10_000,
  isHidden = () => (typeof document !== 'undefined' ? document.hidden : false),
  setInterval: schedule = globalThis.setInterval,
  clearInterval: unschedule = globalThis.clearInterval,
}) {
  /** Zuletzt gesehene Laufnummer je Liste; null bis zur ersten Antwort. */
  let seen = null;
  let pending = [];
  let inFlight = null;
  let stopped = signal?.aborted ?? false;

  const apply = (rows) => {


    if (!Array.isArray(rows)) return;
    const fresh = new Map();
    for (const row of rows) {
      if (Number.isInteger(row?.list_id) && Number.isInteger(row?.version)) fresh.set(row.list_id, row.version);
    }
    if (!seen) {





      seen = new Map(fresh);
      const replay = pending;
      pending = [];
      for (const fn of replay) fn();
    }
    const moved = new Set();
    for (const [listId, version] of fresh) {
      const before = seen.get(listId);
      if (before === undefined) moved.add(listId);            // neue Liste
      else if (version > before) moved.add(listId);           // bewegt
      else if (version < before) fresh.set(listId, before);   // ueberholte Antwort: die Marke bleibt
    }
    for (const listId of seen.keys()) {
      if (!fresh.has(listId)) moved.add(listId);              // Liste weg
    }
    seen = fresh;
    for (const listId of moved) onChange(listId);
  };

  const poll = () => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(fetchVersions)
      .then((rows) => { if (!stopped) apply(rows); })
      .catch(() => { /* still: die naechste Abfrage versucht es wieder */ })
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  const acknowledge = (change) => {
    if (!change) return;
    const { list_id: listId, before, after } = change;
    if (!Number.isInteger(listId) || !Number.isInteger(after)) return;
    if (!seen) { pending.push(() => acknowledge(change)); return; }
    if (seen.get(listId) === before) seen.set(listId, after);
  };

  const hold = (listId, version) => {
    if (!Number.isInteger(listId) || !Number.isInteger(version)) return;
    if (!seen) { pending.push(() => hold(listId, version)); return; }
    seen.set(listId, version);
  };

  const timer = stopped ? null : schedule(() => { if (!isHidden()) poll(); }, intervalMs);
  const stop = () => {
    stopped = true;
    if (timer != null) unschedule(timer);
  };
  signal?.addEventListener('abort', stop, { once: true });

  return { poll, acknowledge, hold, stop };
}
