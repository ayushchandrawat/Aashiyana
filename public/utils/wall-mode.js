
import { nowFields } from './timezone.js';

const WALL_KEY = 'aashiyana-wall-mode';
const THEME_KEY = 'aashiyana-theme';

export const WALL_NIGHT_FROM = 22;
export const WALL_NIGHT_TO = 6;

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
  } catch {

  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Siehe safeGet.
  }
}

export function isWallModeEnabled() {
  return safeGet(WALL_KEY) === '1';
}

export function setWallModeEnabled(enabled) {
  if (enabled) safeSet(WALL_KEY, '1');
  else safeRemove(WALL_KEY);
}

export function isWallRoute(path) {
  return path === '/';
}

export function isWallNight(now = new Date()) {


  // Nachtmodus (#829 Teil 3).
  const hour = nowFields(now).hour;
  return hour >= WALL_NIGHT_FROM || hour < WALL_NIGHT_TO;
}

export function isWallActive() {
  return document.documentElement.hasAttribute('data-wall-mode');
}

function restoreUserTheme() {
  const stored = safeGet(THEME_KEY);
  if (stored === 'dark' || stored === 'light') {
    document.documentElement.setAttribute('data-theme', stored);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export function syncWallMode(path = location.pathname) {
  const root = document.documentElement;
  const active = isWallModeEnabled() && isWallRoute(path);
  const night = active && isWallNight();
  const wasNight = root.hasAttribute('data-wall-night');

  root.toggleAttribute('data-wall-mode', active);
  root.toggleAttribute('data-wall-night', night);

  if (night && !wasNight) {

    // gewaehlt hat.
    root.setAttribute('data-theme', 'dark');
  } else if (!night && wasNight) {
    restoreUserTheme();
  }




  if (night !== wasNight) window.aashiyana?.restoreThemeColor?.();

  return active;
}

export function exitWallMode() {
  setWallModeEnabled(false);
  syncWallMode(location.pathname);
}

export function enterWallMode() {
  setWallModeEnabled(true);
  syncWallMode(location.pathname);
}
