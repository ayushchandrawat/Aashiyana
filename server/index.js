
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { readFileSync } from 'node:fs';
import { createLogger } from './logger.js';
import * as db from './db.js';
import { router as authRouter, sessionMiddleware, requireAuth, requireAdmin, isPasswordLoginEnabled } from './auth.js';
import { csrfMiddleware } from './middleware/csrf.js';
import idempotencyMiddleware from './middleware/idempotency.js';
import { buildOpenApiSpec } from './openapi.js';
import * as googleCalendar from './services/google-calendar.js';
import * as appleCalendar from './services/apple-calendar.js';
import * as icsSubscription from './services/ics-subscription.js';
import * as icsExport from './services/ics-export.js';
import * as inventoryDeadlinesIcs from './services/inventory-deadlines-ics.js';
import * as cycleIcs from './services/cycle-ics.js';
import * as scheduleIcs from './services/schedule-ics.js';
import * as wasteIcs from './services/waste-ics.js';
import * as caldavReminders from './services/caldav-reminders-sync.js';
import * as caldavSync from './services/caldav-sync.js';
import * as outlookCalendar from './services/outlook-calendar.js';
import * as carddavSync from './services/cardav-sync.js';
import * as holidays from './services/holidays.js';
import { startScheduler as startBackupScheduler } from './services/backup-scheduler.js';
import { startScheduler as startSplitExpenseScheduler } from './services/split-expenses-scheduler.js';
import { startScheduler as startPushScheduler } from './services/push-scheduler.js';
import { startScheduler as startMedicationScheduler } from './services/medication-scheduler.js';
import { startScheduler as startRecipeProviderScheduler } from './services/recipe-provider-sync.js';
import { startWasteSourceScheduler } from './services/waste-source-scheduler.js';
import { emailService } from './services/email.js';
import { passwordLoginWarning, OIDC_PASSWORD_SENTINEL } from './services/oidc.js';
import dashboardRouter from './routes/dashboard.js';
import tasksRouter from './routes/tasks.js';
import shoppingRouter from './routes/shopping.js';
import mealsRouter from './routes/meals.js';
import recipesRouter from './routes/recipes.js';
import pantryRouter from './routes/pantry.js';
import inventoryRouter from './routes/inventory/index.js';
import kitchenRouter from './routes/kitchen.js';
import calendarRouter from './routes/calendar.js';
import notesRouter from './routes/notes.js';
import quickLinksRouter from './routes/quick-links.js';
import contactsRouter from './routes/contacts.js';
import cardavRouter from './routes/cardav.js';
import birthdaysRouter from './routes/birthdays.js';
import budgetRouter from './routes/budget.js';
import subscriptionsRouter from './routes/subscriptions.js';
import documentsRouter from './routes/documents.js';
import googleDriveStorageRouter from './routes/document-storage-google-drive.js';
import { checkLocalStorageMount } from './services/document-storage.js';
import dmsRouter from './routes/dms.js';
import recipeProvidersRouter from './routes/recipe-providers.js';
import splitExpensesRouter from './routes/split-expenses.js';
import weatherRouter from './routes/weather.js';
import preferencesRouter from './routes/preferences.js';
import screensaverRouter from './routes/screensaver.js';
import remindersRouter from './routes/reminders.js';
import searchRouter from './routes/search.js';
import familyRouter from './routes/family.js';
import backupRouter from './routes/backup.js';
import housekeepingRouter from './routes/housekeeping.js';
import wasteRouter from './routes/waste/index.js';
import modulesRouter from './routes/modules.js';
import { listModules } from './services/modules.js';
import pushRouter from './routes/push.js';
import emailRouter from './routes/email.js';
import notificationsRouter from './routes/notifications.js';
import healthRouter from './routes/health.js';
import rewardsRouter from './routes/rewards.js';
import permissionsRouter from './routes/permissions.js';
import changelogRouter from './routes/changelog.js';
import mcpRouter from './mcp/server.js';
import scheduleRouter from './routes/schedule.js';
import scheduleFeedRouter from './routes/schedule-feed.js';
import schedulePreferencesRouter from './routes/schedule-preferences.js';
import scheduleExtrasRouter from './routes/schedule-extras.js';
import { moduleForPath, requiredAccess, sessionModuleAccessRequirement, tokenAllows } from './scopes.js';
import { moduleAccessVerdict, MODULE_ACCESS_DENIED, MODULE_ACCESS_READ_ONLY } from './permissions.js';
import { BODY_LIMIT, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from './utils/upload-limit.js';
import { createServiceWorkerResponseLoader } from './utils/service-worker.js';

const log     = createLogger('Server');
const logSync = createLogger('Sync');
const logAashiyana = createLogger('Aashiyana');

const { version: APP_VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
);
const SERVICE_WORKER_PATH = new URL('../public/sw.js', import.meta.url);
const SERVICE_WORKER_OPTIONS = {
  appVersion: APP_VERSION,
  buildRevision: process.env.APP_BUILD_REVISION,
};
const getServiceWorkerResponse = createServiceWorkerResponseLoader(
  SERVICE_WORKER_PATH,
  SERVICE_WORKER_OPTIONS,
);



getServiceWorkerResponse();
const DEFAULT_APP_NAME = 'Aashiyana';

const app  = express();
const PORT = process.env.PORT || 3000;

// --------------------------------------------------------
// Security-Middleware
// --------------------------------------------------------
const isSecure = process.env.SESSION_SECURE === 'true';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'"],

      upgradeInsecureRequests: isSecure ? [] : null,
    },
  },

  hsts: isSecure ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
}));

// Trust Proxy: Default 1 = trust one proxy hop (correct for Caddy/nginx/Traefik in Docker).
// Env vars are always strings, so numeric values like "1" must be parsed as integers —
// Express treats a numeric hop count differently from an IP/subnet string.
// TRUST_PROXY=1            → trust 1 hop (default; reads X-Forwarded-For correctly)
// TRUST_PROXY=172.16.0.0/12 → trust only requests from that subnet
// TRUST_PROXY=loopback     → trust loopback only (direct, no proxy)
const _rawTrustProxy = process.env.TRUST_PROXY;
const _trustProxy = _rawTrustProxy === undefined
  ? 1
  : /^\d+$/.test(_rawTrustProxy) ? parseInt(_rawTrustProxy, 10) : _rawTrustProxy;
app.set('trust proxy', _trustProxy);

// --------------------------------------------------------
// Kompression (gzip/deflate)
// --------------------------------------------------------
app.use(compression());

// --------------------------------------------------------
// Request-Parsing
// --------------------------------------------------------
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));


app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body.', code: 400 });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `Request body too large (max. ${MAX_UPLOAD_MB} MB per file).`, code: 413 });
  }
  next(err);
});

// --------------------------------------------------------
// Sessions
// --------------------------------------------------------
app.use(sessionMiddleware);

// --------------------------------------------------------

// --------------------------------------------------------
app.use('/api/', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// --------------------------------------------------------
// Globaler API-Rate-Limiter (Schritt 29)




// --------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 60_000,         // 1 Minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.', code: 429 },
  skip: (req) => req.path === '/health', // Health-Check ausgenommen
});

if (process.env.NODE_ENV === 'production' && process.env.ENABLE_API_DOCS !== 'true') {
  app.get(['/docs', '/docs/'], (_req, res) => {
    res.status(404).json({ error: 'Not found.', code: 404 });
  });
} else {
  app.get(['/docs', '/docs/'], apiLimiter, requireAuth, requireAdmin, (_req, res) => {
    res.type('text/plain').send('OpenAPI JSON is available to admins at /api/v1/openapi.json');
  });
}

// --------------------------------------------------------
// Statische Dateien (Frontend) - differenzierte Caching-Strategie
//
// HTML + JS + CSS: no-cache (Browser revalidiert via ETag/304, kein stale Content


// manifest.json: no-cache (PWA-Updates sollen sofort greifen).

// --------------------------------------------------------
app.get('/sw.js', (_req, res) => {
  const response = getServiceWorkerResponse();
  res.type(response.contentType);
  res.setHeader('Cache-Control', response.cacheControl);
  res.setHeader('CDN-Cache-Control', response.cdnCacheControl);
  res.setHeader('Cloudflare-CDN-Cache-Control', response.cloudflareCdnCacheControl);
  res.send(response.body);
});

app.use(express.static(path.join(import.meta.dirname, '..', 'public'), {
  etag: true,
  lastModified: true,



  redirect: false,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const isPwaIcon = /\/icons\/(icon-|apple-touch-icon|favicon)/.test(filePath);
    if (isPwaIcon) {

      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (['.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp', '.woff2', '.woff'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 Tage
    } else {
      // HTML, JS, CSS, JSON und manifest immer revalidieren.
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }

    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }


    if (ext === '.mjs') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    }
  },
}));


app.use('/api/', apiLimiter);

// --------------------------------------------------------
// API-Routen
// --------------------------------------------------------
app.use('/api/v1/auth', authRouter);

function buildVersionPayload(includeVersion = false) {
  let appName = DEFAULT_APP_NAME;
  let setupRequired = false;
  try {
    const row = db.get().prepare('SELECT value FROM sync_config WHERE key = ?').get('app_name');
    if (row?.value) appName = row.value;
  } catch {
    // fall back to default
  }
  try {
    const { count } = db.get().prepare('SELECT COUNT(*) AS count FROM users').get();
    setupRequired = count === 0;
  } catch {
    // Fail-safe: bei DB-Fehler kein Setup erzwingen
    setupRequired = false;
  }
  // Password reset can only deliver when SMTP is configured AND an explicit
  // BASE_URL origin is set (the request Host is deliberately not trusted, to
  // prevent reset poisoning). Expose the capability so the login page can gate
  // the "forgot password" affordance instead of offering a dead end.



  let passwordResetEnabled = false;
  try {




    const hasResettable = !!db.get()
      .prepare('SELECT 1 FROM users WHERE password_hash != ? LIMIT 1').get(OIDC_PASSWORD_SENTINEL);
    passwordResetEnabled = isPasswordLoginEnabled()
      && hasResettable
      && emailService.isConfigured()
      && Boolean(String(process.env.BASE_URL || '').trim());
  } catch {
    passwordResetEnabled = false;
  }
  return {
    ...(includeVersion ? { version: APP_VERSION } : {}),
    app_name: appName,
    setup_required: setupRequired,
    password_reset_enabled: passwordResetEnabled,



    ...(includeVersion ? { max_upload_bytes: MAX_UPLOAD_BYTES } : {}),
  };
}

// Public bootstrap metadata for login/setup. The exact app version is returned only
// when a valid session or API token is present.
app.get('/api/v1/version', (req, res) => {
  const hasAuthCredential = Boolean(
    req.session?.userId
      || req.headers.authorization
      || req.headers['x-api-key']
  );
  if (!hasAuthCredential) {
    return res.json(buildVersionPayload(false));
  }
  return requireAuth(req, res, () => res.json(buildVersionPayload(true)));
});

app.get('/manifest.webmanifest', apiLimiter, (req, res) => {
  let appName = DEFAULT_APP_NAME;
  try {
    const row = db.get().prepare('SELECT value FROM sync_config WHERE key = ?').get('app_name');
    if (row?.value) appName = row.value;
  } catch {
    // fall back to default
  }

  res.type('application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.json({
    name: `${appName} Familienplaner`,
    short_name: appName,
    description: 'Selbstgehosteter Familienplaner',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],


    // schmalen Hochkant-Streifen, obwohl das Layout bis 1024px+ reicht (#890).





    // (#F5F3ED = --neutral-100, warmes Papier).
    theme_color: '#F5F3ED',
    background_color: '#F5F3ED',
    lang: 'de-DE',
    categories: ['productivity', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [],
  });
});

function sendOpenApi(req, res) {
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', 'attachment; filename="openapi.json"');
  }
  res.json(buildOpenApiSpec(req, APP_VERSION));
}

app.get('/api/v1/openapi.json', requireAuth, requireAdmin, sendOpenApi);

app.get('/openapi.json', apiLimiter, requireAuth, requireAdmin, sendOpenApi);

// --------------------------------------------------------


// --------------------------------------------------------
const feedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/feed/calendar/:token.ics', feedLimiter, (req, res) => {
  try {
    const userId = icsExport.findUserIdByFeedToken(db.get(), req.params.token);
    if (!userId) return res.status(404).type('text/plain').send('Not found');
    const ics = icsExport.buildFeed(db.get(), userId);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', 'inline; filename="aashiyana.ics"');
    res.type('text/calendar; charset=utf-8').send(ics);
  } catch (err) {
    log.error('', err);
    res.status(500).type('text/plain').send('Internal error');
  }
});


// Haushaltskalender-Feed oben, siehe server/services/inventory-deadlines-ics.js.
app.get('/feed/inventory-deadlines/:token.ics', feedLimiter, (req, res) => {
  try {



    const userId = inventoryDeadlinesIcs.findUserIdByFeedToken(db.get(), req.params.token);
    if (!userId) return res.status(404).type('text/plain').send('Not found');
    const ics = inventoryDeadlinesIcs.buildInventoryDeadlinesFeed(db.get());
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', 'inline; filename="aashiyana-inventory-deadlines.ics"');
    res.type('text/calendar; charset=utf-8').send(ics);
  } catch (err) {
    log.error('', err);
    res.status(500).type('text/plain').send('Internal error');
  }
});




//
// BEWUSST UNGEGATET GEGEN DEN ZYKLUS-TAB/HEALTH-MODUL: server/services/








app.get('/feed/cycle/:token.ics', feedLimiter, (req, res) => {
  try {
    const userId = cycleIcs.findUserIdByFeedToken(db.get(), req.params.token);
    if (!userId) return res.status(404).type('text/plain').send('Not found');
    const ics = cycleIcs.buildCycleFeed(db.get(), userId);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', 'inline; filename="aashiyana-cycle.ics"');
    res.type('text/calendar; charset=utf-8').send(ics);
  } catch (err) {
    log.error('', err);
    res.status(500).type('text/plain').send('Internal error');
  }
});




// server/services/schedule-ics.js.
app.get('/feed/schedule/:token.ics', feedLimiter, (req, res) => {
  try {
    const userId = scheduleIcs.findUserIdByFeedToken(db.get(), req.params.token);
    if (!userId) return res.status(404).type('text/plain').send('Not found');
    const ics = scheduleIcs.buildScheduleFeed(db.get(), userId);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', 'inline; filename="aashiyana-schedule.ics"');
    res.type('text/calendar; charset=utf-8').send(ics);
  } catch (err) {
    log.error('', err);
    res.status(500).type('text/plain').send('Internal error');
  }
});





app.get('/feed/waste/:token.ics', feedLimiter, (req, res) => {
  try {
    const userId = wasteIcs.findUserIdByFeedToken(db.get(), req.params.token);
    if (!userId) return res.status(404).type('text/plain').send('Not found');
    const ics = wasteIcs.buildWasteFeed(db.get(), userId);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', 'inline; filename="aashiyana-waste.ics"');
    res.type('text/calendar; charset=utf-8').send(ics);
  } catch (err) {
    log.error('', err);
    res.status(500).type('text/plain').send('Internal error');
  }
});



app.use('/mcp', apiLimiter, requireAuth, mcpRouter);

// Alle weiteren API-Routen erfordern Authentifizierung + CSRF-Schutz
app.use('/api/v1', requireAuth);
// System-Metadaten: authentifiziert, aber bewusst vor Guest-/Token-Scope-Gates

app.use('/api/v1/changelog', changelogRouter);
app.use('/api/v1', (req, res, next) => {
  try {
    const guest = db.get().prepare('SELECT 1 FROM split_expense_guest_users WHERE user_id = ?').get(req.authUserId);
    if (!guest) return next();
    const allowed = req.path.startsWith('/split-expenses')
      || req.path === '/auth/me'
      || req.path === '/auth/logout'
      || req.path === '/version';
    if (allowed) return next();
    return res.status(403).json({ error: 'This account can only access Shared expenses.', code: 403 });
  } catch {
    return res.status(403).json({ error: 'This account can only access Shared expenses.', code: 403 });
  }
});





app.use('/api/v1', (req, res, next) => {
  if (req.authMethod !== 'api_token' || req.authScopes == null) return next();
  const moduleKey = moduleForPath(req.path);
  const access = requiredAccess(req.method);
  if (tokenAllows(req.authScopes, moduleKey, access)) return next();
  return res.status(403).json({ error: 'Token scope does not permit this operation.', code: 403 });
});


// gesperrt, jeder unbekannte Pfad (/auth, /preferences, /settings-Daten …) bleibt


app.use('/api/v1', (req, res, next) => {


  //


  // routes/schedule-preferences.js' eigener Kommentar, "keine Admin-Gate") -

  // schreiben, seine eigene Erinnerungsvorlaufzeit ist keine davon.




  // gebunden.
  const { moduleKey: scopedModuleKey, access: scopedAccess } =
    sessionModuleAccessRequirement(req.path, req.method);
  const verdict = moduleAccessVerdict(
    req.sessionModuleAccess,
    scopedModuleKey,
    scopedAccess,
  );
  if (verdict === MODULE_ACCESS_DENIED) {
    return res.status(403).json({ error: 'You do not have access to this module.', code: 403 });
  }
  if (verdict === MODULE_ACCESS_READ_ONLY) {
    return res.status(403).json({ error: 'You have read-only access to this module.', code: 403 });
  }
  return next();
});
app.use('/api/v1', csrfMiddleware);



app.use('/api/v1', idempotencyMiddleware);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/shopping', shoppingRouter);
app.use('/api/v1/meals', mealsRouter);
app.use('/api/v1/recipes', recipesRouter);
app.use('/api/v1/recipe-providers', recipeProvidersRouter);
app.use('/api/v1/pantry', pantryRouter);
app.use('/api/v1/inventory', inventoryRouter);

app.use('/api/v1/kitchen', kitchenRouter);
app.use('/api/v1/calendar', calendarRouter);
app.use('/api/v1/notes', notesRouter);
app.use('/api/v1/quick-links', quickLinksRouter);
app.use('/api/v1/contacts/cardav', cardavRouter);
app.use('/api/v1/contacts', contactsRouter);
app.use('/api/v1/birthdays', birthdaysRouter);
app.use('/api/v1/budget/subscriptions', subscriptionsRouter);
app.use('/api/v1/budget', budgetRouter);
app.use('/api/v1/documents/storage/google-drive', googleDriveStorageRouter);
app.use('/api/v1/documents/dms', dmsRouter);
app.use('/api/v1/documents', documentsRouter);
app.use('/api/v1/split-expenses', splitExpensesRouter);
app.use('/api/v1/weather', weatherRouter);
app.use('/api/v1/preferences', preferencesRouter);
app.use('/api/v1/screensaver', screensaverRouter);
app.use('/api/v1/reminders', remindersRouter);
app.use('/api/v1/search', searchRouter);
app.use('/api/v1/family', familyRouter);
app.use('/api/v1/backup', backupRouter);
app.use('/api/v1/housekeeping', housekeepingRouter);
app.use('/api/v1/waste', wasteRouter);
app.use('/api/v1/modules', modulesRouter);
app.use('/api/v1/push', pushRouter);
app.use('/api/v1/email', emailRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/health', healthRouter);
app.use('/api/v1/rewards', rewardsRouter);
// The specific /schedule/* prefixes must mount before the general /schedule
// router: schedule.js has no first-segment param route today, so a request
// like /schedule/feed still falls through to the right router either way -
// but that only holds by accident, and breaks silently (no error, just a 404)
// the day someone adds a router.get('/:id') to schedule.js.
app.use('/api/v1/schedule/feed', scheduleFeedRouter);
app.use('/api/v1/schedule/preferences', schedulePreferencesRouter);
app.use('/api/v1/schedule/extras', scheduleExtrasRouter);
app.use('/api/v1/schedule', scheduleRouter);
app.use('/api/v1/permissions', permissionsRouter);

// --------------------------------------------------------

// --------------------------------------------------------
app.get('/health', (req, res, next) => {




  if (req.headers.accept && req.headers.accept.includes('text/html')) return next();
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --------------------------------------------------------

// --------------------------------------------------------
const spaLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.', code: 429 },
});

// --------------------------------------------------------

// --------------------------------------------------------
app.get('/{*path}', spaLimiter, (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found.', code: 404 });
  }
  // root-Option statt absolutem Pfad: sendFile ohne root laesst `send` JEDES

  // einem Dot-Verzeichnis (z. B. ~/.claude/...), liefert jede Deep-URL 500.

  res.sendFile('index.html', { root: path.join(import.meta.dirname, '..', 'public') });
});

// --------------------------------------------------------
// Globaler Error-Handler
// --------------------------------------------------------
app.use((err, req, res, _next) => {
  log.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.', code: 500 });
});

// --------------------------------------------------------
// Auto-Sync Scheduler (Google + Apple Calendar)
// --------------------------------------------------------

const SYNC_INTERVAL_MS = (parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 15) * 60_000;

async function runSync() {
  const { connected: googleConnected } = googleCalendar.getStatus();
  if (googleConnected) {
    googleCalendar.sync().catch((e) => logSync.error('Google error:', e.message));
  }

  const { configured: appleConfigured } = appleCalendar.getStatus();
  if (appleConfigured) {
    appleCalendar.sync().catch((e) => logSync.error('Apple error:', e.message));
  }


  icsSubscription.sync().catch((e) => logSync.error('ICS error:', e.message));


  // keine Accounts konfiguriert sind.
  caldavSync.sync().catch((e) => logSync.error('CalDAV error:', e.message));



  caldavReminders.sync().catch((e) => logSync.error('CalDAV reminders error:', e.message));



  outlookCalendar.sync().catch((e) => logSync.error('Outlook error:', e.message));


  // Accounts konfiguriert sind.
  carddavSync.sync().catch((e) => logSync.error('CardDAV error:', e.message));


  holidays.sync().catch((e) => logSync.error('Holidays error:', e.message));
}

// --------------------------------------------------------
// Server starten
// --------------------------------------------------------
// Scan the extension catalog before the socket accepts requests. resolvePermissions
// drops unknown ext:* rows, and moduleAccessVerdict is a deny-list — a missing
// key means allow. Starting the scan inside the listen callback left that window
// open until the first GET /api/v1/modules (or /permissions/catalog).
try {
  await listModules({ admin: true });
} catch (err) {
  log.warn('Initial module registry scan failed:', err.message);
}

const server = app.listen(PORT, () => {


  // (PORT=3000) steht dort weiterhin wortgleich dieselbe Zeile.
  logAashiyana.info(`Server running on port ${server.address()?.port ?? PORT} | Version ${APP_VERSION}`);
  logAashiyana.info(`Environment: ${process.env.NODE_ENV || 'development'}`);




  let linkedSso = true;
  try {
    linkedSso = !!db.get()
      .prepare("SELECT 1 FROM users WHERE oidc_sub IS NOT NULL AND role = 'admin' LIMIT 1").get();
  } catch { /* ohne Antwort lieber keine falsche Entwarnung */ }
  const loginWarning = passwordLoginWarning({ hasLinkedSsoAccount: linkedSso });
  if (loginWarning) logAashiyana.warn(loginWarning);


  //






  setTimeout(() => {
    runSync();
    setInterval(runSync, SYNC_INTERVAL_MS).unref();
    logSync.info(`Auto-sync active every ${SYNC_INTERVAL_MS / 60_000} minutes.`);
  }, 10_000).unref();



  checkLocalStorageMount(createLogger('DocumentStorage'))
    .catch((err) => log.error('Document storage check failed:', err.message));

  // Backup-Scheduler starten
  startBackupScheduler();
  startSplitExpenseScheduler();
  startPushScheduler();
  startMedicationScheduler();
  startRecipeProviderScheduler();
  startWasteSourceScheduler();
});

export default app;




export { server };
