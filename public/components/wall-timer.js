
import { t } from '../i18n.js';

const TIMER_KEY = 'aashiyana-wall-timer';

export const WALL_TIMER_PRESETS = [3, 5, 10, 15, 30];

const RUNNING_ATTR = 'data-wall-timer';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {

    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* siehe safeGet */ }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch { /* siehe safeGet */ }
}

export function readWallTimer(now = Date.now()) {
  const raw = safeGet(TIMER_KEY);
  const endsAt = raw === null ? NaN : Number(raw);


  if (!Number.isFinite(endsAt)) return { state: 'idle', remainingMs: 0 };
  const remainingMs = endsAt - now;
  if (remainingMs > 0) return { state: 'running', remainingMs };
  return { state: 'done', remainingMs: 0 };
}

/** Startet einen Timer ueber `minutes` Minuten. */
export function startWallTimer(minutes, now = Date.now()) {
  safeSet(TIMER_KEY, String(now + minutes * 60_000));
}

/** Beendet ihn - abgebrochen wie quittiert gehen denselben Weg. */
export function clearWallTimer() {
  safeRemove(TIMER_KEY);
}

export function formatWallTimer(remainingMs) {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function renderWallTimer({ state, remainingMs } = readWallTimer()) {
  if (state === 'idle') {



    const buttons = WALL_TIMER_PRESETS.map((minutes) => `
        <button type="button" class="wall__timer-preset" data-wall-timer-start="${minutes}">
          ${t('dashboard.wallTimerMinutes', { count: minutes })}
        </button>`).join('');
    return {
      display: '',
      controls: `
      <div class="wall__timer-presets" role="group" aria-label="${t('dashboard.wallTimerLabel')}">
        ${buttons}
      </div>`,
    };
  }

  const done = state === 'done';
  return {
    display: `
      <div class="wall__timer" data-state="${done ? 'done' : 'running'}" role="status">
        <span class="wall__timer-value">${done ? t('dashboard.wallTimerDone') : formatWallTimer(remainingMs)}</span>
      </div>`,
    controls: `
      <button type="button" class="wall__foot-btn" id="wall-timer-stop"
              aria-label="${t(done ? 'dashboard.wallTimerAcknowledge' : 'dashboard.wallTimerCancel')}">
        <i data-lucide="${done ? 'check' : 'x'}" aria-hidden="true"></i>
        <span class="wall__foot-btn-label" aria-hidden="true">${t(done ? 'dashboard.wallTimerAcknowledge' : 'dashboard.wallTimerCancel')}</span>
      </button>`,
  };
}

function chime(ctx) {
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;

      const at = now + i * 0.45;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.25, at + 0.02);
      gain.gain.linearRampToValueAtTime(0, at + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.35);
    }
  } catch { /* Kein Ton ist besser als ein Fehler auf der Wand. */ }
}

let audioCtx = null;

let tick = null;

function stopTick() {
  clearInterval(tick);
  tick = null;
}

function makeAudioContext() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    ctx.resume?.();
    return ctx;
  } catch {
    return null;
  }
}

export function wireWallTimer(wall, rerender, signal) {


  stopTick();
  if (!wall) return;

  const setRunningAttr = (running) => {
    document.documentElement.toggleAttribute(RUNNING_ATTR, running);
  };

  wall.querySelectorAll('[data-wall-timer-start]').forEach((btn) => {
    btn.addEventListener('click', () => {


      audioCtx = audioCtx ?? makeAudioContext();
      startWallTimer(Number(btn.dataset.wallTimerStart));
      setRunningAttr(true);
      rerender();
    }, { signal });
  });

  wall.querySelector('#wall-timer-stop')?.addEventListener('click', () => {
    clearWallTimer();
    setRunningAttr(false);
    rerender();
  }, { signal });

  const value = wall.querySelector('.wall__timer-value');
  const running = wall.querySelector('.wall__timer[data-state="running"]');
  setRunningAttr(!!running);
  if (!running || !value) return;




  tick = setInterval(() => {
    const next = readWallTimer();
    if (next.state === 'running') {
      value.textContent = formatWallTimer(next.remainingMs);
      return;
    }
    stopTick();
    setRunningAttr(false);
    chime(audioCtx);
    rerender();
  }, 1000);




  // Screensaver auf JEDER Seite unterdrueckt.
  signal.addEventListener('abort', () => {
    stopTick();
    setRunningAttr(false);
  });
}
