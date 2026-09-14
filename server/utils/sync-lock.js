// --------------------------------------------------------
// Ein Durchgang je Provider, nie zwei gleichzeitig (#593).
//






//






//



//





//




// --------------------------------------------------------





//            drei wollen dasselbe - einmal nacharbeiten, was danach aussteht.
const locks = new Map();

function lockFor(key) {
  let lock = locks.get(key);
  if (!lock) {
    lock = { key, busy: false, queue: [], pending: new Map() };
    locks.set(key, lock);
  }
  return lock;
}

function entryPromise(entry) {
  return new Promise((resolve, reject) => entry.waiters.push({ resolve, reject }));
}

async function drain(lock) {
  lock.busy = true;
  while (lock.queue.length) {
    const entry = lock.queue.shift();



    if (lock.pending.get(entry.kind) === entry) lock.pending.delete(entry.kind);
    try {
      const value = await entry.run();
      for (const w of entry.waiters) w.resolve(value);
    } catch (err) {
      for (const w of entry.waiters) w.reject(err);
    }
  }
  lock.busy = false;
  if (!lock.queue.length && lock.pending.size === 0) locks.delete(lock.key);
}

export function runSerialized(key, kind, run) {
  const lock = lockFor(key);

  if (!lock.busy && lock.queue.length === 0) {
    const entry = { kind, run, waiters: [] };
    const promise = entryPromise(entry);
    lock.queue.push(entry);
    drain(lock);
    return promise;
  }

  const waiting = lock.pending.get(kind);
  if (waiting) return entryPromise(waiting);

  const entry = { kind, run, waiters: [] };
  lock.pending.set(kind, entry);
  lock.queue.push(entry);
  return entryPromise(entry);
}


export const __test = {
  reset: () => locks.clear(),
  size: () => locks.size,
};
