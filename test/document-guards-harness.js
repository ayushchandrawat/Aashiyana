
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3-multiple-ciphers';
import puppeteer from 'puppeteer';
import { SETTINGS_LEAVES } from '../public/settings/registry.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function dismissAllReminders(dbPath) {
  const db = new Database(dbPath);
  try {
    return db.prepare('UPDATE reminders SET dismissed = 1 WHERE dismissed = 0').run().changes;
  } finally {
    db.close();
  }
}

export const ROUTES = {
  dashboard: '/',
  tasks: '/tasks',
  calendar: '/calendar',
  shopping: '/shopping',
  meals: '/meals',
  recipes: '/recipes',
  pantry: '/pantry',
  notes: '/notes',
  contacts: '/contacts',
  birthdays: '/birthdays',
  budget: '/budget',
  documents: '/documents',
  health: '/health',
  rewards: '/rewards',
  housekeeping: '/housekeeping',
  settings: '/settings',
};

export const SETTINGS_ROUTES = Object.freeze(Object.fromEntries(
  SETTINGS_LEAVES.map((leaf) => [`settings/${leaf.id}`, leaf.path]),
));

export const ANON_ROUTES = {
  login: '/login',
  'forgot-password': '/forgot-password',
  'reset-password': '/reset-password?token=demo-token-for-audit',
  join: '/join?token=demo-token-for-audit',
  setup: '/setup',
  offline: '/offline.html',
};

export const DEVICES = {
  desktop: { width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  short: { width: 640, height: 400, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

function run(cmd, args, env) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd: REPO, env: { ...process.env, ...env }, stdio: 'ignore' });
    child.on('error', rej);
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${args[0]} exit ${code}`))));
  });
}

async function waitForHttp(baseUrl, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {
    }
    await wait(200);
  }
  throw new Error(`Server auf ${baseUrl} kam nicht hoch`);
}

function startServer(dbPath, port) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DB_PATH: dbPath,
      PORT: String(port),
      BASE_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'document-guards-secret-0123456789abcdef',



      RATE_LIMIT_MAX_ATTEMPTS: '1000',

      DISABLE_BACKUP_SCHEDULER: '1',
    },
    stdio: 'ignore',
  });
  return child;
}

async function stopServer(child) {


  if (!child || child.exitCode !== null || child.signalCode !== null) return;



  // den Port.
  const exited = new Promise((res) => child.once('exit', res));
  child.kill('SIGTERM');
  const hard = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(hard);
}

function copyDatabase(from, to) {
  for (const suffix of ['-wal', '-shm', '']) rmSync(`${to}${suffix}`, { force: true });
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${from}${suffix}`)) copyFileSync(`${from}${suffix}`, `${to}${suffix}`);
  }
}

async function loginCookies(baseUrl) {
  let res;



  // Preview-Server hilft nur kurz warten.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'linda', password: 'demo1234' }),
    });
    if (res.status !== 429) break;
    await wait(8000);
  }
  if (!res.ok) {
    throw new Error(
      `Login als linda/demo1234 fehlgeschlagen (${res.status}) - ` +
        `${res.status === 429 ? 'Login-Limiter, eine Minute warten' : 'Seed vorhanden?'}`,
    );
  }
  const { hostname } = new URL(baseUrl);
  return res.headers.getSetCookie().map((raw) => {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    return {
      name: pair.slice(0, idx).trim(),
      value: pair.slice(idx + 1).trim(),
      domain: hostname,
      path: '/',
    };
  });
}

export async function startHarness() {
  const external = process.env.DOCUMENT_GUARDS_BASE_URL;
  let server = null;
  let tmpDir = null;
  let dbPath = null;
  let port = null;
  let baseUrl = external;

  if (!external) {
    tmpDir = mkdtempSync(join(tmpdir(), 'aashiyana-document-guards-'));
    dbPath = join(tmpDir, 'guards.db');
    port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;




    const migrator = startServer(dbPath, port);
    await waitForHttp(baseUrl);
    await stopServer(migrator);

    await run(process.execPath, ['scripts/seed-demo.js', '--db', dbPath, '--locale', 'de']);

    server = startServer(dbPath, port);
    await waitForHttp(baseUrl);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // EINMAL anmelden, Cookie an alle Seiten weiterreichen.
  //




  const cookies = await loginCookies(baseUrl);





  let snapshotPath = null;
  if (!external) {

    // ihre Erinnerungen an; danach verwirft `dismissAllReminders` sie (#1160).
    const pending = await fetch(`${baseUrl}/api/v1/reminders/pending`, {
      headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
    });
    if (!pending.ok) throw new Error(`Abgleich der Erinnerungen fehlgeschlagen (${pending.status})`);
    await stopServer(server);
    dismissAllReminders(dbPath);
    mkdirSync(join(tmpDir, 'snapshot'));
    snapshotPath = join(tmpDir, 'snapshot', 'guards.db');
    copyDatabase(dbPath, snapshotPath);
    server = startServer(dbPath, port);
    await waitForHttp(baseUrl);
  }

  const harness = {
    baseUrl,
    browser,
    cookies,
    context: await browser.createBrowserContext(),



    touched: false,

    async reset() {
      await harness.context.close();
      harness.context = await browser.createBrowserContext();
      if (external || !harness.touched) return;
      await stopServer(server);
      copyDatabase(snapshotPath, dbPath);
      server = startServer(dbPath, port);
      await waitForHttp(baseUrl);
      harness.touched = false;
    },

    async close() {
      await browser.close();
      await stopServer(server);
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    },
  };
  return harness;
}

async function disableServiceWorker(page) {
  await page.evaluateOnNewDocument(() => {
    if (typeof ServiceWorkerContainer === 'undefined') return;
    const abgeschaltet = () => Promise.reject(new Error('document-guards: Service Worker abgeschaltet'));
    ServiceWorkerContainer.prototype.register = abgeschaltet;
    Object.defineProperty(ServiceWorkerContainer.prototype, 'ready', { configurable: true, get: abgeschaltet });
  });
}

export async function openPage(harness, { device = 'mobile', theme = 'light', locale = 'de' } = {}) {
  harness.touched = true;
  const page = await harness.context.newPage();
  await page.setViewport(DEVICES[device]);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await disableServiceWorker(page);



  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (page.__aashiyanaRequestInterceptor?.(req)) return;
    req.continue();
  });

  await page.setCookie(...harness.cookies);




  await page.goto(`${harness.baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ t, l }) => {
      localStorage.setItem('aashiyana-locale', l);
      localStorage.setItem('aashiyana-onboarded', '1');
      localStorage.setItem('aashiyana-install-dismissed', String(Date.now()));
      localStorage.setItem('aashiyana-theme', t);
    },
    { t: theme, l: locale },
  );

  page.__aashiyanaBase = harness.baseUrl;
  page.__aashiyanaTheme = theme;
  await gotoRoute(page, '/');
  return page;
}

export async function settle(page) {
  try {
    await page.waitForFunction(
      () => {
        const loading = document.getElementById('app-loading');
        const gone = !loading || loading.hidden || getComputedStyle(loading).display === 'none';
        const main = document.getElementById('main-content');
        return gone && main && main.children.length > 0;
      },
      { timeout: 15000 },
    );
  } catch {
  }










  // anderen ihre Liste.
  try {
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 2000 });
  } catch {
  }
  await wait(700);



  try {
    await page.evaluate(() => document.querySelector('aashiyana-install-prompt')?.remove());
  } catch {
    await wait(500);
  }
}

export async function gotoRoute(page, path) {
  await page.goto(`${page.__aashiyanaBase}${path}`, { waitUntil: 'domcontentloaded' });


  try {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), page.__aashiyanaTheme);
  } catch {
  }
  await settle(page);
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), page.__aashiyanaTheme);
}

export async function openAnonPage(harness, { device = 'mobile', theme = 'light', locale = 'de' } = {}) {
  harness.touched = true;
  const page = await harness.context.newPage();
  await page.setViewport(DEVICES[device]);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await disableServiceWorker(page);







  await page.evaluateOnNewDocument((l) => {
    try { localStorage.setItem('aashiyana-locale', l); } catch { /* undurchsichtiger Ursprung */ }
  }, locale);
  await page.setRequestInterception(true);
  page.on('request', (req) => req.continue());
  page.__aashiyanaBase = harness.baseUrl;
  page.__aashiyanaTheme = theme;
  return page;
}

export async function gotoAnonRoute(page, path) {
  await page.goto(`${page.__aashiyanaBase}${path}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      () => document.querySelector('h1, [role="heading"]') !== null,
      { timeout: 15000 },
    );
  } catch {
  }
  await wait(400);
}

export function parseColor(value) {
  if (!value) return [0, 0, 0, 0];
  const srgbMatch = value.match(/^color\(srgb\s+([^)]+)\)$/i);
  if (srgbMatch) {
    const parts = srgbMatch[1].split('/');
    const rgb = parts[0].trim().split(/\s+/).map(Number);
    const alpha = parts[1] === undefined ? 1 : parseFloat(parts[1]);
    return [rgb[0] * 255, rgb[1] * 255, rgb[2] * 255, Number.isFinite(alpha) ? alpha : 1];
  }
  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : parts[3]];
  }
  if (value === 'transparent') return [0, 0, 0, 0];
  return [0, 0, 0, 1];
}

const channel = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function composite([r, g, b, a], base) {
  if (a >= 1) return [r, g, b];
  return [
    r * a + base[0] * (1 - a),
    g * a + base[1] * (1 - a),
    b * a + base[2] * (1 - a),
  ];
}

export function toHex([r, g, b]) {
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
