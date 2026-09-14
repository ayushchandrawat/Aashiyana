# Test-Suiten

```bash
npm test             # Alle Suiten (Node >=22)
npm run test:db
npm run test:rename-migration   # Oikos→Aashiyana Identifier-Migration: seamless rename invariants
npm run test:schema-reconcile
npm run test:db-encryption
npm run test:db-newer-schema
npm run test:session-secret-guard
npm run test:upload-limit
npm run test:db-isolation
npm run test:migrations-append-only
npm run test:allow-scripts-pins
npm run test:suite-chain
npm run test:suite-exit-code
npm run test:browser-loader-stubs
npm run test:tasks
npm run test:recurrence   
npm run test:tasks-recurrence
npm run test:tasks-routes
npm run test:task-default-points
npm run test:task-groups
npm run test:task-filters
npm run test:task-lock
npm run test:schema-mirror
npm run test:task-scope
npm run test:task-categories    
npm run test:visibility         
npm run test:sync-default-assignee  
npm run test:rewards
npm run test:rewards-routes
npm run test:reward-icon-null-migration
npm run test:health-overview
npm run test:health-vitals
npm run test:health-meds
npm run test:health-labs        # Gesundheit: Laborwerte-Tab
npm run test:health-activity
npm run test:health-visibility-defaults
npm run test:health-cycle       # Gesundheit: Zyklus-Tab (#450)
npm run test:cycle-reminders
npm run test:cycle-symptoms-migration
npm run test:cycle-ics
npm run test:health-export
npm run test:health-api
npm run test:health-nav         # Gesundheit: Tab-Navigation
npm run test:health-structure   # Gesundheit: Routen-Split-Guard (47-Routen-Tabelle + Cluster-Disjunktheit)
npm run test:medication-scheduler   # Medikations-Erinnerungs-Scheduler
npm run test:shopping
npm run test:server-digits
npm run test:shopping-ux
npm run test:shopping-routes

npm run test:shopping-send
npm run test:shopping-versions
npm run test:module-gate-path-case
npm run test:live-feed
npm run test:shopping-order-migration
npm run test:meals
npm run test:meals-routes
npm run test:recipes-routes
npm run test:pantry-routes
npm run test:pantry-ownership-migration
npm run test:pantry-expiry-reminders
npm run test:pantry-reminders-migration
npm run test:module-registry-parity
npm run test:pantry-status
npm run test:pantry-ux
npm run test:inventory-locations-routes
npm run test:inventory-categories-routes
npm run test:inventory-items-routes
npm run test:inventory-item-documents
npm run test:inventory-item-entries
npm run test:inventory-deadlines-dates
npm run test:reminders-entity-type-migration
npm run test:inventory-item-reminders
npm run test:inventory-deadlines-feed
npm run test:inventory-warranty-status
npm run test:inventory-category-labels
npm run test:tracked-dates-migration
npm run test:item-dates-validation
npm run test:inventory-photo-migration   # Inventory photo migration (v141): photo_data-Spalte nullable, Bestandszeilen ohne Foto bleiben NULL
npm run test:inventory-default-off-migration
npm run test:schedule-default-off-migration
npm run test:split-folder-rename-migration
npm run test:inventory-tracked-dates
npm run test:birthdays-routes
npm run test:birthday-import    # Geburtstags-Import aus Kontakten (#518): Migration v90 (contact_id + Unique-Index), Kandidaten/Import-Service (idempotent), Routen GET /import/candidates + POST /import
npm run test:birthday-localization
npm run test:calendar
npm run test:schedule
npm run test:schedule-extras
npm run test:schedule-feed
npm run test:schedule-reminders
npm run test:schedule-custom-fields
npm run test:ncb            # notes, contacts, budget
npm run test:notes-routes
npm run test:contact-categories
npm run test:notes-reader
npm run test:notes-checklist
npm run test:tasks-checklist
npm run test:markdown-toolbar
npm run test:budget-recurrence
npm run test:budget-stats   # statistics tab: computeStatsRange, computeStats, GET /budget/stats, range CSV export
npm run test:subscriptions  # Budget subscription tracker: CRUD, renewals, currencies, SSRF-protected logo lookup
npm run test:subscription-meta-labels
npm run test:budget-structure
npm run test:budget-accounts
npm run test:money-utils
npm run test:budget-ui
npm run test:budget-plans
npm run test:budget-visibility
npm run test:budget-routes-scope
npm run test:budget-loans-routes
npm run test:budget-loans-amortization
npm run test:budget-shared-amount-migration
npm run test:budget-loans-migration
npm run test:budget-interval-migration
npm run test:budget-account-inherit-migration
npm run test:budget-entries-routes
npm run test:split-expenses-attachments
npm run test:budget-attachments
npm run test:calendar-routes
npm run test:calendar-inherited-color
npm run test:calendar-structure
npm run test:calendar-timezone-window
npm run test:household-timezone
npm run test:display-timezone
npm run test:calendar-mirrored-cleanup
npm run test:sync-lock
npm run test:sync-outcome
npm run test:calendar-exceptions
npm run test:calendar-defaults
npm run test:preferences-calendar-target
npm run test:sync-target
npm run test:recurring-scope
npm run test:rrule-ui
npm run test:family-routes      # Family-Route GET /members: Worker-Ausschluss, NOCASE-Sortierung, LEFT JOIN contacts/birthdays
npm run test:modules        # Third-Party-Modul-Registry: Manifest-Validierung, Path-Traversal-Schutz, error-Fallback, admin-Filter, enable-Toggle, Asset-MIME
npm run test:sendfile-dotpath
npm run test:modules        # Third-Party-Modul-Registry: Manifest-Validierung, Path-Traversal-Schutz, error-Fallback, admin-Filter, enable-Toggle, Asset-MIME; dazu capabilities v2 (Widget-/Permissions-/API-Deklarationen, fehlende Entry-Dateien, optionsSchema-Grenzen)
npm run test:extension-permissions
npm run test:extension-widgets
npm run test:extension-i18n
npm run test:budget-categories-routes   # Budget-Kategorien-Routen: CRUD Kategorien/Subkategorien, 409-Dubletten (NOCASE), in-use/letzte-Sperren, reorder, lokalisierte Leseliste
npm run test:reminders
npm run test:multi-reminders   # multiple reminders per calendar event: GET /reminders/all, PUT /reminders replace-set (#436)
npm run test:reminders-routes
npm run test:event-reminder-fanout
npm run test:reminder-offset   # reminder remind_at offset calculation
npm run test:push           # Web Push: VAPID resolution, subscribe/unsubscribe routes, delivery, scheduler
npm run test:fetch-retry
npm run test:email          # SMTP-Service: config/env resolution, masking, sendMail/sendTest, admin routes
npm run test:password-reset # Reset tokens: create/verify/consume/cleanup + forgot/reset-password routes
npm run test:admin-password-reset # PATCH /auth/users/:id password field: admin sets existing member's password (#372)
npm run test:password-normalization # Passwort-Unicode: NFC-Hashing, Login mit NFD-Eingabe (Firefox/macOS), stille Migration alter NFD-Hashes, /me/password (#608)
npm run test:invites
npm run test:notifications

npm run test:notification-channel-form
npm run test:mcp
npm run test:mcp-router-permissions
npm run test:token-scopes   # API-/MCP-Token-Scopes: scopes.js-Modell + Enforcement (tools/list-Filter, tools/call-Deny)
npm run test:api-token-subject
npm run test:auth-router-token-scope
npm run test:permissions
npm run test:permissions-routes   # Rechte-Routen: requireAdmin-Gate (kein Privilege-Escalation), Payload-Validierung, sparse-Persistenz/Round-Trip, Admin-Ziel-Sonderregel
npm run test:schedule-preferences-gate
npm run test:dashboard
npm run test:dashboard-permissions
npm run test:screensaver
npm run test:ics-parser
npm run test:ics-sub
npm run test:ics-export
npm run test:ics-import     # einmaliger ICS-/Feed-Import als bearbeitbare lokale Termine (#437)
npm run test:modal-utils
npm run test:tablist
npm run test:popover-menu
npm run test:detail-view
npm run test:overlay-history
npm run test:nav-badges
npm run test:category-manager
npm run test:sortable-reorder
npm run test:wall-timer
npm run test:datepicker
npm run test:ux-utils
npm run test:page-lifecycle
npm run test:skeleton-utils
npm run test:date-utils
npm run test:time-input     # flexible Zeiteingabe: 0930/09.30/9h30 → HH:MM parsing (#442)
npm run test:html-entities
npm run test:help
npm run test:changelog
npm run test:changelog-seen
npm run test:i18n
npm run test:i18n-plural
npm run test:i18n-translated
npm run test:lang-init
npm run test:sw-api-cache   # Service Worker: Read-only-Offline-API-Cache (Whitelist, Fallback, CLEAR_API_CACHE, activate-Cleanup)
npm run test:sw-precache
npm run test:pwa-manifest
npm run test:api
npm run test:openapi-structure   # OpenAPI-Modul-Split: jede paths/<modul>.js importiert+gespreadet, keine Pfad-Kollision
npm run test:openapi-coverage
npm run test:multi-assignment
npm run test:kitchen-tabs
npm run test:kitchen-permissions
npm run test:caldav
npm run test:caldav-recurrence
npm run test:caldav-reminders   # VTODO-Inbound: Feld-Abbildung, Prune-Leerguard (#508), DUE als Wanduhrzeit statt UTC (#617; TZ=Europe/Berlin fixiert), RELATED-TO-Hierarchie inkl. Reihenfolge/Enkel/Zyklus (#671)
npm run test:caldav-todo-outbound
npm run test:caldav-object-urls
npm run test:caldav-event-target
npm run test:outlook-calendar
npm run test:outlook-event-target
npm run test:google-multi   # multiple Google calendars + per-event sync target
npm run test:google-outbound
npm run test:calendar-outbound-migration
npm run test:caldav-outbound
npm run test:outbound-dtstart
npm run test:google-calendar
npm run test:google-sync-token-reset
npm run test:housekeeping
npm run test:housekeeping-routes
npm run test:waste-domain   # Waste collection (#1063), pure domain layer: the recurrence adapter onto recurrence.js (weekly multi-weekday, monthly fixed-day, last-day-of-month, monthly ordinal-weekday added in Phase 9 - "2nd Monday"/"last Friday", including interval>1 and a move/skip override applying exactly like any other origin, leap/short months), bounded 731-day range resolution, provenance-preserving coalescing (a move never erases another origin's same-day occurrence), and next-per-type. Every date is ground-truthed against a live recurrence.js run, not hand-computed
npm run test:waste-migrations   # Waste collection, migration + store: fresh and upgrade schema for the four manual-domain tables, every CHECK/FK/UNIQUE constraint, cascade (schedule deletion takes only its own overrides), and archive/delete-refusal semantics (a type with schedules or pickups refuses DELETE with a typed conflict, archiving still works)
npm run test:waste-routes   # Waste collection, HTTP routes: CRUD for types/schedules/overrides/pickups, validation and typed-error status mapping (400/404/409), the 731-day range ceiling on /occurrences, and an end-to-end round-trip through /occurrences and /occurrences/next. Also covers Phase 10: the ICS feed's token lifecycle (regenerate rotates, delete revokes, type-selection validation/404-before-enabled) and buildWasteFeed's UID/all-day VEVENT output and type filtering, plus the mapping-profile export/preview/commit round-trip (unchanged/applicable/unmatched_pattern/unmatched_type resolution and the stale-digest 409). Module/permission/token-scope gating, CSRF, and idempotency are applied once centrally at the /api/v1 mount point and are covered by the generic suites for those concerns, not repeated per module
npm run test:waste-ui       # Waste collection, page-logic layer: the deep-link contract (?type=<id>&date=<YYYY-MM-DD>), the schedule-origin lookup behind move/skip/restore, recurrence summary text, provenance badges, the ICS import wizard's pure helpers (default label decision, unresolved-blocking-diagnostic check, mapping-decision builder, source health badge), and the ordinal-anchor pre-fill (nearestOrdinalAnchorDateKey: nearest nth/last-weekday occurrence at or after today, asserted west and east of UTC so a timezone can never shift the anchor a day). Full modal open/save/dirty-close flows are covered by manual browser testing, since modal.js's dirty-close machinery is generic, shared, and already covered by its own tests
npm run test:waste-import   # Waste collection, ICS import (#1063 Phase 3), pure layer: two anonymized provider fixture families (CATEGORIES+UID vs SUMMARY-only+no-UID), fallback identity stability across re-parses, duplicate-instance collapsing, STATUS:CANCELLED exclusion, RDATE and unbounded-recurrence blocking diagnostics, timezone-note labeling (all-day/TZID/UTC/floating), the household-zone day decision itself (a TZID event just after local midnight - Berlin 00:00 is 22:00Z the day before - keeps ITS local date_key under a non-UTC household timezone, counter-proved by forcing timeZone to UTC inside buildImportPreview), label normalization/suggestion/remembered-mapping prefill, and the measured event/byte/instance caps (reject with an honest diagnostic, never truncate)
npm run test:waste-dashboard   # Waste collection, Dashboard widget (#1063 Phase 4): module/dispatch/refresh-carry-over wiring (mirrors the Schedule widget's own guard), the opt-in default-hidden/1x2 registration, one row per active type with date-first sorting (not the API's own type-order default), the row cap and honest "+N more" overflow, the single global-next emphasis, moved/coalesced flags, the stable ?type=&date= deep link, the "source needs refresh" warning (a source-scoped fetch alongside /occurrences/next, per invariant #6), and the distinct empty/fetch-error states
npm run test:waste-calendar   # Waste collection, Calendar projection (#1063 Phase 5): the device-local layer switch (availableLayers/LAYER_STATE/reset, mirrors the Schedule overlay's own wiring) and wasteEnabled() gating on module-disabled AND moduleAccess!=='none' (stricter than scheduleEnabled()'s disabled-only check), wasteOccurrencesOnDay()'s person-filter independence (#1054 pattern - a pickup belongs to no one member), loadWasteRange()'s own error state independent of loadRange()'s (a Waste fetch failure never blanks ordinary Calendar content), and every real view caller (month/week/day/agenda) rendering the type icon+name chip and routing a click/Enter straight to /waste's deep link, never the ordinary event editor. Also covers Phase 10's per-type visibility nested under the one Waste layer: wasteTypeOptions() deriving distinct types from the loaded occurrences themselves, passesWasteTypeFilter()'s empty-set-means-all convention, wasteOccurrencesOnDay() applying it on top of the layer/day filters, restoreWasteTypeFilter()'s malformed-JSON fallback, and buildLayerRowsHtml() rendering the nested sub-list only while the Waste layer itself is on
npm run test:waste-url-source   # Waste collection, automatic ICS URL sources (#1063 Phase 7): validateSourceUrl/validateRefreshIntervalMinutes bounds, buildAutoMappingDecisions (only a REMEMBERED type/ignore decision - never a bare suggestion - auto-commits, and an unresolved blocking diagnostic always blocks it), backoffMinutes' exponential-capped growth, checkSSRF/fetchIcsText real HTTP round-trips (200/304 conditional GET, non-2xx, oversized streaming response) against a local server, and refreshUrlSource's four outcomes end to end (unchanged/error/needs_mapping/committed) including that a needs_mapping source is excluded from listDueUrlSources until a reviewed commit clears it
npm run test:waste-reminders   # Waste collection, per-user pickup reminders (#1063 Phase 8): pickupReminderAt's DST-aware delivery-time computation (a genuine Europe/Berlin transition, not just UTC) and offset_days date-shifting; syncWasteRemindersForUser's anchor+reminder create/idempotent-no-op/cleanup lifecycle (a moved schedule occurrence, a disabled setting, an archived type, a coalesced schedule+one-off occurrence collapsing into exactly one reminder - never two), per-user isolation (two users' settings for the same type never cross-affect each other's reminders), module-disabled and per-user permission-denial drop, and syncAllWasteReminders picking up a user who only has leftover anchors from a since-disabled setting
npm run test:housekeeping-editvisit
npm run test:housekeeping-ui
npm run test:documents          # Dokument-Preview: CSP-Header je MIME-Typ
npm run test:documents-ux
npm run test:folder-upload
npm run test:document-storage   # Dokument-Storage-Migration und Invarianten
npm run test:google-drive-storage
npm run test:document-folders
npm run test:document-folder-keys
npm run test:document-folder-delete
npm run test:folder-tree
npm run test:task-documents
npm run test:mentions
npm run test:task-tags
npm run test:countdown
npm run test:quick-links
npm run test:image-picker
npm run test:task-completions
npm run test:dms-adapter        # DMS-Adapter: Paperless-ngx
npm run test:dms-routes         # DMS-Routen: account management, search, link, push
npm run test:dms-papra-adapter  # DMS-Adapter: Papra
npm run test:dms-guard
npm run test:recipe-provider-adapter   # Recipe-Provider-Adapter: Mealie (#530): Bearer-Auth, Paginierung, Zutaten-Flattening (quantity 0 = Mealies "keine Menge"), Deep-Link aus external_url, Thumbnail-Abruf
npm run test:recipe-provider-tandoor-adapter
npm run test:recipe-provider-sync
npm run test:recipe-provider-routes
npm run test:recipe-provider-migration
npm run test:weather
npm run test:preferences-routes
npm run test:preferences-hidden-modules
npm run test:preferences-countdown-grace
npm run test:preferences-schedule-templates
npm run test:preferences-dashboard
npm run test:preferences-budget-mode
npm run test:preferences-weather   # weather config fields in preferences API
npm run test:preferences-navigation   # preferences side-navigation language refresh
npm run test:preferences-weekstart   # household week-start preference (#484/#465): GET default, PUT monday/sunday/saturday, invalid rejected
npm run test:holidays
npm run test:carddav
npm run test:carddav-addressbook-toggle   # Adressbuch-Umschaltung (#534): Frontend↔Router-Vertrag (PUT /addressbooks/:id), Feldnamen, 400/404
npm run test:carddav-account-lifecycle    # CardDAV-Konto: Bearbeiten (PUT, Passwort-Beibehaltung, 409/404), Sammelschalter, sichtbare Sync-Fehler (Migration 92/93)
npm run test:family-contacts
npm run test:contacts-routes
npm run test:vcard-parser      # vCard-Parser (public/utils/vcard.js): Multi-Card-Split, Feldextraktion, BDAY→birthday-Normalisierung
npm run test:contact-names
npm run test:phone
npm run test:backup-scheduler
npm run test:backup-webdav
npm run test:backup-routes  # Backup-/Restore-Routen: requireAdmin-Gate, /status, /trigger, /database, /restore (400/413/Roundtrip), WebDAV-Konfig + Loopback-Stub
npm run test:split-expenses
npm run test:split-expenses-routes
npm run test:split-guest-migration
npm run test:search
npm run test:calendar-search   # calendar toolbar search (#471): FTS event search endpoint, location index, recurring next-instance, keyboard
npm run test:search-diacritics
npm run test:search-index-duplicates
npm run test:search-permissions
npm run test:mobile-scroll-layout
npm run test:frontend-audit
npm run test:frontend-audit


npm run test:lucide-icons
npm run test:module-icon-size
npm run test:layer-boundary
npm run test:typography
npm run test:settings-copy
npm run test:settings-admin-gate
npm run test:settings-navigation
npm run test:settings-cron-label
npm run test:region-presets
npm run test:docker-publish
npm run test:claude-review-workflow
npm run test:review-proof
npm run test:workflow-pins
npm run test:workflow-timeouts
npm run test:auth-userid
npm run test:setup
npm run test:onboarding-version
npm run test:oidc
npm run test:sso-only
npm run test:totp
npm run test:qrcode
npm run test:two-factor
npm run test:idempotency
npm run test:ssrf            # zentraler SSRF-Schutz (server/utils/ssrf.js): kanonische Klassifikationslogik
npm run test:http
npm run test:file-signature
npm run test:router-guest-guard   # Regression Split-Guest-Redirect-Schleife (#480)
npm run test:installer-schema
npm run test:installer-env-write
npm run test:installer-static
npm run test:installer-i18n
npm run test:installer-cli-i18n
npm run test:installer-prereq
npm run test:docs-landing
npm run test:readme-consistency
npm run test:installer-a11y






```

## Focused linked occurrence suite

Run `npm run test:calendar-occurrence-overrides`
for migration 194, original-slot identity, inheritance and owner resolution,
atomic edit/delete/split operations, bounded exact-count orphan handling,
visibility-equivalent mutation rights, provider outbound exclusion, nested
savepoint fallback, projection caching, cross-reader degradation contracts, and
the body-free projection list staying a complete mirror of `calendar_events`
(#1155: a new column fails the suite until it is listed or excluded by name). The suite sets a fresh temporary
`DB_PATH` before importing the route serializer, whose dependency graph
initializes `server/db.js`, and removes that database and its SQLite sidecars at
process exit. Its dedicated script runs directly in the root `npm test`
chain and CI, alongside `test:calendar`; no recursive suite-chain exception is needed.
The suite-chain guard matches suite names at word boundaries rather than prefixes;
`test:search` is explicitly chained, not inferred from `test:search-diacritics`.
Calendar route and recurring-scope suites cover local outbound legacy scopes;
dashboard and MCP suites cover limit-aware future expansion without a two-year
cutoff. Calendar search covers JSON-escaped field names and malformed metadata.
The browser document guards exercise save-confirmation preservation of the same
editor, while the ICS suite checks actual EXDATE output across both midnight offsets.

## Dokument-Guards (eigene Kette, von Hand vor dem Release)

```bash
npm run test:document-guards
```

Diese Suite ist die einzige, die **nicht** in der `npm test`-Kette hängt, und das ist Absicht: sie startet einen Serverprozess und einen Browser (Puppeteer, bereits devDependency), während die übrige Infrastruktur netzfrei und serverlos gegen In-Memory-SQLite läuft. `test:suite-chain` kennt die Zweiteilung als **Regel** und nicht als Namensausnahme - eine Suite, deren Datei den Browsertreiber importiert, gehört in diese Kette; jede andere in `npm test`. Wer eine zweite Browser-Suite anlegt, hängt sie an `test:document-guards` an, sonst schlägt der Registry-Guard fehl.

**Und sie läuft nicht in CI - das ist entschieden, nicht vergessen.** `.github/workflows/ci.yml` fährt `npm test` und sonst nichts; kein Workflow ruft `test:document-guards`. Die Kette braucht einen Browser und liegt bei **rund 80 Minuten** (gemessen am 2.9.2026: 82 Minuten solo, 15:11-16:33; die frühere Angabe von 55 Minuten ist überholt und war der Stand vor dem Ausbau auf die Settings-Blätter und die Sonden 19/20), und dieser Preis pro Push steht in keinem Verhältnis zu ihrem Ertrag: sie misst das gerenderte Dokument, und das ändert sich in Schüben (Redesign, Modulumbau), nicht mit jedem Commit. Sie ist deshalb ein **Handlauf vor dem Release** - wer ein Release fährt, das die Oberflächen-Spur der Kadenz berührt (`public/pages|styles|utils|components|settings`, siehe CONTRIBUTING.md, Abschnitt *Release cadence*), fährt sie einmal vollständig und liest ihren Exit-Code aus einer Datei, nicht aus einer Pipe (`npm run test:document-guards > /tmp/dg.log 2>&1; echo $?` - ein `| tail` liefert den Status von `tail`). Wer das ändern will, ändert es an beiden Stellen: hier und in `.github/workflows/ci.yml`. **Und die Präfix-Liste ist eine Heuristik, keine Grenze.** Was die Sonden sehen, bestimmt nicht nur das Stylesheet: `scripts/seed-demo.js` und die Serverantworten bestimmen mit, wie voll die Testinstanz ist, und eine vollere Instanz macht die Filter im Kopf breiter. Seit

**Wozu eine vierte Ebene.** Drei Befundklassen des Architektur-Audits vom 2026-08-07 sind im Stylesheet unsichtbar und im Dokument offensichtlich: ein Kontrastverstoß, der erst durch die Komposition zweier Regeln entsteht (1.13:1, seit Runde 1 live, während beide Token-Paare für sich AA hielten); ein Kopf-Überlauf von 79px, den `overflow-x: hidden` verdeckte; Zielgrößen, die keine Textsuche misst. Alle drei fand ein Reviewer - das ist keine wiederholbare Absicherung.

**Die 23 Settings-Blätter.** Bis 2026-08-08 fuhren alle elf Sonden 16 Modulrouten und die Settings-Übersicht. Dahinter liegen 23 Blätter mit eigener Route (`/settings/personal/account` bis `/settings/admin/system`) - Rechtevergabe, Familienverwaltung, API-Token, Backup-Wiederherstellung, jedes Sync-Konto -, und keines davon hatte je eine Sonde gesehen. Sie kommen jetzt aus `SETTINGS_LEAVES`, also aus derselben Quelle, aus der `router.js:84` die Routen baut; eine Handliste wäre beim nächsten IA-Umbau still veraltet, und zwar in die falsche Richtung (ein neu dazugekommenes Blatt fiele lautlos aus jeder Messung).

**Zehn Sonden fahren sie, sieben nicht, und eine fährt gar keinen Sweep - und die Auslassung ist eine Aussage über die Regel.** Sie steht für jede der sieben in `LEAVES_SKIPPED`, mit Begründung; eine Sonde, die `sweep()` umgeht und `ROUTE_NAMES` direkt nimmt, lässt die Blätter **stillschweigend** aus, und genau das ist der Unterschied. Sonde 1, 8 und 15 messen eine `.page-toolbar` bzw. ihre Bauhöhe; ein Blatt trägt keine, sein Kopf ist `.settings-leaf-header` (den Dokument-Überlauf der Blätter misst Sonde 10). Sonde 5 und 6 suchen `.swipe-row` und `.metric-grid`, die in `public/settings/**` nicht vorkommen - sie würden 23 Zustände laden und nichts messen. Sonde 12 misst Glas, und das sitzt in der Shell, die auf jeder Route dieselbe ist. Sonde 17 ist der Sonderfall: sie prüft einen Handler, der in `router.js` genau **einmal** an `window` hängt und auf jeder Route derselbe Code ist - ein Sweep würde sechzehnmal dasselbe messen, deshalb steht sie auch nicht in `LEAVES_SKIPPED`. Sonde 13 braucht einen FAB, und die Einstellungen haben gar keinen. Die Voreinstellung ist **„ja"**: eine neu gebaute Sonde sieht die Blätter automatisch, das Vergessen fällt auf die Seite der Vollständigkeit. Auf einem Blatt wird **nicht** durch die Sichten geklickt: zwei der drei Umschaltergruppen in den Einstellungen schreiben eine Einstellung (Thema, Wochenstart) statt eine Sicht zu wechseln, und die Signatur unterscheidet sie nicht - dieselbe Grenze, die `visitViews` für das `<select>` schon zieht.

Der Ausbau hat sofort drei Befunde geliefert, die kein Guard je sehen konnte: der aktive Domänenkopf der Settings-Navigation (4,05:1 dark, auf **allen 23** Blättern), `.settings-module-origin` (4,23:1, roher Akzent auf einer 12%-Tönung statt Ink-Mix) und das Warnbanner der Dokumentablage (4,42:1 light). Alle drei sind behoben, und die Antworten fielen unterschiedlich aus: zwei nehmen den Ink-Mix, der Domänenkopf **nicht** - er steht auf einer neutralen Fläche, und die Ink-Mix-Konvention gilt ausdrücklich für akzent-getönten Grund. Dort war der Defekt die Token-Zusage selbst („~5:1 auf

**Sonden:**

| Sonde | Was sie misst | Umfang |
|---|---|---|
| 1 - Kopf-Überlauf | kein Nachfahre einer `.page-toolbar` ragt über die Viewport-Kante; Nachfahren in einem scrollenden oder clippenden Container sind ausgenommen, denn genau so schreibt die Shell-Regel die Tab-Leiste vor | 16 Routen × 375px × `de`/`uk`/`vi` |
| 2 - komponierter Kontrast | jeder sichtbare Text hält WCAG AA auf seinem **komponierten** Untergrund: die Vorfahren-Kette wird bis zur ersten deckenden Fläche zusammengerechnet, Alpha, `color-mix` und die Farbstops von Verläufen inklusive (bei einem Verlauf zählt der ungünstigste Stop) | 16 Routen + 23 Blätter × light/dark × desktop/mobile |
| 3 - Buttonform | jeder `button` / `a.btn` / `[role="button"]` trägt die Kapsel (Radius ≥ halbe Höhe) oder ist formlos; wer eine eigene Form hat, steht in `SHAPE_EXEMPT` **mit seiner Kategorie** | 16 Routen + 23 Blätter × 1280px |
| 4 - Zielgrößen | ein **freistehendes** Ziel hält die volle Zielgröße in mindestens einer Achse, ein **eingeengtes** (ein Ziel, das eine Klasse mit ihm teilt, steht < 16px entfernt) erfüllt allein WCAG 2.5.8; gemessen wird die **Trefferfläche**, an jeder Scrollposition. Seit 2026-08-10 dazu die Träger-Klausel: **wer die Spacing-Ausnahme nimmt, muss sie brauchen** - ein freistehendes Ziel unter 24px, dessen Träger ihm den Raum ließe, ist kurz aus Versehen und nicht aus Platznot (Inline-Ziele sind ausgenommen, WCAG 2.5.8 nimmt sie selbst aus). Ob ein Bauteil in Reihen gebaut wird, schlüsselt seither die **Basisklasse** statt der vollen Klassenliste: ein `--high`-Modifier ist kein eigenes Bauteil | 16 Routen + 23 Blätter × mobil (48px) und desktop (40px) |
| 5 - Wischsemantik | sie **fährt die Geste** und liest, welches Reveal-Panel aufgeht: eine Liste mit Wischzeilen antwortet überhaupt, und die Rolle liegt an ihrer Kante (`--delete` nie am Zeilenanfang, `--done` nie am Ende). Der Finger geht vor dem Loslassen unter die Schwelle zurück, damit die Sonde nichts abhakt und nichts löscht | 16 Routen **und jede Sicht dahinter** × mobil × `de`/`ar` |
| 6 - Kennzahlreihen | die Kacheln einer Reihe sind gleich hoch **und ihre Zahlen stehen auf einer Linie**, auch wenn die Reihe umbricht. Eine Reihe ist seit 2026-08-10 ein Elternknoten mit mehr als einer `.metric-card`, nicht ein Träger namens `.metric-grid` - die Aktivitätskacheln der Gesundheit liegen in `health-activity__summary` und waren dem Namens-Guard unsichtbar | 16 Routen **und jede Sicht dahinter** × mobil/desktop |
| 7 - Kartenspalte | keine Folge gleichartiger Karten, die ihre Trennung dem `gap` ihres Trägers überlässt - die zweite Bauart von „eine Karte pro Zeile", die im Stylesheet unsichtbar ist. Gemeldet wird nur, was in **beiden** Größenklassen ein vertikaler Stapel ist: mobil bricht jedes Raster auf eine Spalte um | 16 Routen + 23 Blätter **und jede Sicht dahinter** × desktop **und** mobil |
| 8 - Andocken des Kopfes | die Trennlinie erscheint beim Andocken - und ein Kopf mit Lead-Zone **dockt beim Scrollen auch an**. Dazu die Gegenrichtung: ohne Lead-Zone steht die Linie durchgehend, und eine Lead-Zone auf einem **einzeiligen** Kopf ist keine, sondern verbirgt die Linie dauerhaft. Die Zeiligkeit misst die Sonde selbst über die Überlappung der vertikalen Intervalle, statt die Rechnung der Shell nachzusprechen | 16 Routen × mobil |
| 9 - Compositor-Ebenen | kein `will-change`, das eine Ebene erzwingt, kommt im **Ruhezustand** mit derselben Klassensignatur zweimal vor. Nicht „wie viele sind zu viele", sondern „wächst die Zahl mit dem Inhalt": ein einmaliges Chrome-Element (Sidebar-Pille, Tab-Indikator, Backdrop-Blob) darf sein Versprechen halten, eine Zeile nicht - dieselbe Signatur zweimal heißt, sie kommt auch 200-mal | 16 Routen + 23 Blätter × mobil |
| 10 - Dokumentstruktur | die A11y-Grundlage als Guard: genau ein `h1` und ein `main`, `lang`, beschreibender Dokumenttitel, Namen an allen Zielen, Labels an allen Feldern, keine doppelten IDs, kein Überschriftensprung, **kein ARIA-Verweis ins Leere**, kein horizontaler Überlauf. Zielgrößen nur vor der Anmeldung - dahinter gehören sie Sonde 4 | 6 anonyme Seiten **und** 16 Routen + 23 Blätter × mobil/desktop |
| 11 - Tastaturzugang | kein Element nimmt einen Klick an, ohne dass die Tastatur ankommt: gefragt wird die **Listener-Registry der Engine** (`DOMDebugger.getEventListeners` über CDP), nicht das Stylesheet. Ein Container mit click-Listener und einem echten Bedienelement darin ist Event-Delegation und geht durch; gemeldet wird der Container **ohne** inneres Ziel (WCAG 2.1.1, Level A) | 16 Routen + 23 Blätter × desktop |
| 12 - Glas-Familie | Glas sitzt auf Chrome, nie im Seiteninhalt: kein `backdrop-filter` innerhalb von `#main-content`. Dazu die Gegenrichtung im selben Baumdurchlauf - unter `prefers-reduced-transparency` und `prefers-contrast: more` kippt jede Fläche, deren Grund aus einem `--glass-bg-*`-Token kommt, auf einen opaken `--color-surface`-Wert | 16 Routen × mobil/desktop × 2 Medienzustände |
| 13 - Formulare hinter dem FAB | jedes Modal, das der FAB öffnet, hält die Feld- und Zielgrundlage der Seiten: Label an jedem Eingabefeld (WCAG 3.3.2, Level A), kein ARIA-Verweis ins Leere, keine Zielgröße unter dem Minimum. Dokumentstruktur prüft sie **nicht** - ein Modal liegt im Dokument, das seine `h1` schon hat | 16 Routen × mobil/desktop, ≥18 geöffnete und ≥16 unterscheidbare Dialoge |
| 14 - Icon-Kontrast | jedes sichtbare Icon hält 3:1 (WCAG 1.4.11) auf seinem **komponierten** Untergrund - dieselbe Mechanik wie Sonde 2, plus zwei Ebenen, die es dort nicht braucht: Pseudoelemente als Träger und die überlappende **Geschwister**-Fläche. Deaktiviertes ist ausgenommen, Dekoratives nur außerhalb eines Bedienelements | 16 Routen + 23 Blätter × light/dark × mobil/desktop |
| 15 - Chrome-Regel | in der **kompakten Höhenklasse** trägt der Modulkopf höchstens eine Bedienzeile: gezählt werden Zeilen als disjunkte vertikale Intervalle seiner Kinder, nicht nach Oberkante (mittig ausgerichtete Flex-Items beginnen bis zu 15px auseinander), dazu die Bauhöhe als gröbere zweite Zusicherung. Die Gerätewelt `short` ist 640x400 - ein 1280x800-Laptop bei 200 % Browserzoom, also WCAG 1.4.4 | 16 Routen × 640x400 |
| 16 - Dauerlast im Leerlauf | kein Element mit endlos laufender Animation trägt gleichzeitig einen `filter`. Ein Filter wird für seinen Inhalt gerastert; bewegt sich dieser Inhalt, fällt die Rasterung in **jedem Frame** an, solange die Seite offen ist. Gemessener Anlass (#716): `.lg-blob` trug `blur(90px)` neben `animation ... infinite` über vier Flächen von 30-46vw - im Leerlauf 60 → 20 fps und ein Style-Recalc je Frame, ein Melder sah 100 % GPU. Warum nicht im Stylesheet: Filter und Animation können in zwei getrennten Regeln stehen, und welche Werte am Ende auf **einem** Kasten liegen, weiß nur das gerenderte Dokument - ein Scanner über Regeltexte hätte die Fassung von #443 für repariert erklärt, deren Kommentar zwei Jahre lang genau das behauptete, was die Messung nicht hergab | 16 Routen + 23 Blätter × desktop |
| 17 - Zustellnotiz des ResizeObservers | „ResizeObserver loop completed with undelivered notifications" ist **kein Fehler**, sondern die spezifikationsgemäße Meldung, dass eine weitere Observer-Runde einen Frame später zugestellt wird - der globale `error`-Handler behandelte sie wie einen Anwendungsfehler und zeigte dafür beim App-Start einen roten Toast. Die Sonde **löst beide Ereignisse selbst aus** statt zu warten, und prüft die **Gegenrichtung** mit: ein echter Fehler muss weiterhin toasten, mit **und ohne** `error`-Objekt (sonst rutscht ein `if (!e.error) return` als catch-all durch und macht Fehler aus fremdem Ursprung unsichtbar) | 1 Route × desktop |
| 18 - FAB am Scroll-Ende | am **Scroll-Ende** liegt nichts Bedienbares unter dem freischwebenden FAB, und der Scrollport reicht trotzdem bis an die Fensterkante. Die Reserve des Knopfes ist seit 2026-08-12 ein **Nachlauf** (`padding-block-end`) statt einer Marge, die den Scrollport um 96px verkürzte - das schnitt das Dashboard-Raster mitten in den Karten ab. Damit wechselt die Invariante von „nie verdeckt" auf **„nie unerreichbar"**: mitten im Scrollen darf Inhalt unter dem Knopf durchlaufen, weil er sich wegschieben lässt und ein Fehlgriff auf „Anlegen" landet statt auf „Löschen". Sonde 4 kann das nicht sehen - ein Ziel mit verdecktem Zentrum überspringt sie ausdrücklich. Gegen den Anlassfall rot geprüft (ohne Reserve: `contact-more-menu__trigger` 64 %, `row-action--danger` 45 %), und sie hatte selbst zwei blinde Fassungen: der Scroller wird an seinem **Overflow** gesucht statt an seinem Namen, und was der Scrollport **wegschneidet**, zählt nicht mit (`getBoundingClientRect` meldet die Layout-Position, nicht die Sichtbarkeit) | 16 Routen + 23 Blätter × mobil/desktop |

**Sonde 16 hat eine Reichweiten-Schwelle ohne Marge, und die ist unter Last nicht messbar (gemessen 2026-08-17, offen).** Sie verlangt `seen >= 4 * sweep().length`, also vier Backdrop-Blobs auf jeder der 45 Routen. Genau so viele liefert die App auch: eine Zählung je Route und je Klasse (`div.lg-blob` 180, dazu eine animierte Wetterglyphe auf dem Dashboard, Summe 181) zeigt den Backdrop auf **jeder** Route vollständig. Die Marge ist damit **eins**, und die Schwelle ist faktisch eine Gleichheitsprüfung: sie hält nur, wenn im Messmoment jede einzelne der 180 Instanzen als `running` erwischt wird. Im vollen Lauf (18 Sonden, ~65 Minuten, Browser unter Last) wurden 169 gezählt und die Sonde fiel; allein gefahren zählt dieselbe Fassung 181 und ist grün - dreimal reproduziert, auf dem Release-Commit von v2.21.0 **und** auf dem Vorgängerstand v2.20.0.

Zwei Dinge stehen damit fest und ein drittes nicht. Fest: die **Regel** der Sonde hält (die Offender-Liste war auch im roten Lauf leer, es gibt kein Element mit Bewegung und Filter), und der Backdrop ist vollständig - es fehlt nichts, was fehlen dürfte. Nicht fest: **warum** der lange Lauf elf Instanzen verliert. Der Verdacht ist der Messzeitpunkt (`settle()` gegen eine Seite, die unter Last später fertig ist), belegt ist er nicht. **Der Fix gehört an die Messung oder an die Begründung der Schwelle, nicht an die Zahl.** Eine Schwelle, die man senkt, weil sie rot ist, sichert nichts mehr zu - das ist dieselbe Bewegung, die dieses Dokument an vier anderen Stellen als Fehler beschreibt. Wer es angeht: erst die elf verlorenen Instanzen einer Route zuordnen (das Messgerät dafür ist eine Kopie der Sonde, die je Route zählt statt zu summieren), dann entscheiden.

**Sonde 12 hat keine Ausnahme mehr - und das ist der interessantere Teil.** Sie hatte eine: `public/pages/dashboard.js` baute seinen Speed-Dial als eigenen `.fab-container` statt als `.page-fab`, `adoptPageFab()` (`public/router.js`) sucht aber genau die, um den FAB in die Shell-Layer `#fab-layer` zu ziehen. Die Härtung aus #634 (v1.86.1, "FAB raus aus dem Scrollport") griff auf der Startseite deshalb nicht, und mit dem FAB blieb sein Glas im Seiteninhalt stehen. `.fab-action__label` und `.fab-action__btn` waren damit kein verirrtes Glas, sondern **Chrome am falschen Ort** - deshalb fand sie die Glas-ist-Chrome-Regel und nicht die FAB-Regel. Die vier Treffer standen einzeln in `GLASS_IN_MAIN_EXEMPT`, mit einem Verfallsdatum an **zwei** Enden: am Anlass wie am Verstoß.

Beide Enden sind eingelöst. Der Dial ist eine `.page-fab-group` mit einer `.page-fab` darin, `adoptPageFab()` zieht die **ganze Gruppe** um (Knopf, Aktionsliste, Backdrop - ein halber Umzug wäre schlimmer als keiner, weil er nach Erledigung aussieht), sein Glas sitzt in der Shell, und `GLASS_IN_MAIN_EXEMPT` ist ersatzlos entfallen: die Liste existiert nicht mehr, statt leer weiterzuleben. Was bleibt, ist die Lehre, und sie steht am Kopf von Sonde 12 in `test-document-guards.js`: eine Ausnahme braucht ein Verfallsdatum an beiden Enden, sonst überlebt sie ihren Grund.

**Wie die Ausnahmelisten dieser Suite auf Veraltung geprüft werden.** `SHAPE_EXEMPT` (Sonde 3) und `TARGET_EXEMPT` (Sonde 4) fragten bis 2026-08-09 `allCss.includes('.' + cls)` über zusammengehängtes, kommentarbehaftetes CSS - die Schwester-Falle des Regelscanners: eine Klasse, die nur noch in einem Kommentar lebt, behielt ihre Ausnahme, und `.item-check` wurde von `.item-checkbox` miterfüllt. Beide lesen jetzt über `eachRule()` und vergleichen **ganze Klassen-Token aus Selektoren**. Die zwei Prüfungen sind dabei zu einer geworden: `TARGET_EXEMPT` ist seit Phase 3c leer, eine eigene Assertion darüber konnte nicht rot werden und zählte trotzdem als Zusicherung. Der gemeinsame Test trägt einen Reichweiten-Nachweis (≥ 500 gelesene Klassennamen), sonst meldete ein defekter Scanner jede Ausnahme als veraltet.

**Bekannte Grenze von Sonde 2, gemessen statt vermutet:** sie liest den BAUM. Eine Fläche, die unter dem Text liegt, ohne ihn zu enthalten - die absolut positionierte Pille der Tab-Bar gleitet als Geschwister des aktiven Eintrags -, fällt heraus. Am gerenderten Pixel nachgeprüft: die Sonde meldet dort 4.20:1, das Bild zeigt 3.41:1. Sie findet den Fall also, urteilt aber zu milde. Ein Versuch über `elementsFromPoint` machte es schlechter (die Pille trägt `pointer-events: none` und fällt aus dem Stapel, dafür verschwand der Befund ganz); der ehrliche nächste Schritt ist der gerenderte Pixel, nicht der Elementstapel.

**Die 3.41:1 sind kein offener Verstoß** - das war die Lesart, die diese Notiz nahelegte, und sie stimmt nicht. Gemessen wird dort ein **Icon**, und für grafische Objekte gilt 3:1 (WCAG 1.4.11), nicht 4.5:1. Der Wert erfüllt die Schwelle mit 0.41 Reserve; das Label daneben liegt bei 6.17:1, das Sidebar-Label bei 5.43:1, das Icon im hellen Theme bei 4.86:1 (Audit 2026-08-08, P2-4). Was bleibt, ist die Sonde: sie beurteilt die Stelle weiterhin zu milde und damit **heute zufällig** auf der richtigen Seite der Schwelle - ein Token-Wechsel rutschte unbemerkt darunter, und 0.41 ist wenig Reserve. Der Pixelweg (`.impeccable/redesign-tools/pixel-contrast.mjs`) ist die Ergänzung für genau diese Bauform: eine Fläche unter dem Text, die ihn nicht enthält.

**Warum Sonde 5 die Geste wirklich fährt.** Sie ist die einzige Sonde, die etwas TUT statt zu messen, und der Grund steht in ihrem eigenen Befund: die Einkaufsliste verdrahtete ihre Wischgesten nur im Nachlade-Pfad (`updateItemsList`), also erst, wenn die Liste ein zweites Mal gebaut wurde. Beim ersten Öffnen der Seite antwortete keine Zeile - im Quelltext stand alles richtig da, und keine der drei statischen Ebenen kann das sehen. Der Fehler stand seit Einführung der Geste im März 2026 im Code. Die zweite Hälfte der Wischsemantik-Regel prüft dagegen Ebene 3 (`Eine Wischgeste, die löscht, hat einen Rückgängig-Weg`): sie folgt von jeder Richtung mit `--delete` der Kante zur aufgerufenen Funktion und verlangt dort `scheduleUndoableDelete`. Zwei Ebenen für eine Regel, jede prüft, was auf ihr prüfbar **ist**.

**Warum Sonde 5 in `ar` läuft.** Die Kante eines Reveal-Panels ist logisch (`inset-inline-start/-end`), die Fingerbewegung dahin ist in RTL die andere. Eine Sonde, die nur LTR misst, bemerkt eine gebrochene Spiegelung nie - und bis Runde 6 trugen die logischen Namen physische Eigenschaften, `.swipe-reveal--leading { left: 0 }`.

**Warum die Sonden hinter die Leisten klicken.** Eine Route ist nicht dasselbe wie eine Sicht. Von den sieben Kennzahlreihen der App liegt genau eine auf einer eigenen Route, die Abo-Wischliste auf gar keiner, und die Listenansicht der Dokumente ebenso wenig - Standard ist dort das Raster. Eine Sonde, die nur `ROUTES` abfährt, wird grün und hat die Hälfte der App nie gesehen.

Die Sonden 5, 6 und 7 nehmen deshalb denselben Helfer, `visitViews`. Er leitet die Sichten **aus dem Markup** ab statt aus einer Liste: `role="tab"` in einer Tablist und Gruppen von `aria-pressed`-Knöpfen unter einem Träger. Damit erreicht er alle vier Bauarten, die es heute gibt - Budget-Untertabs, Health-Routen, Housekeeping-Tabs und den Raster/Listen-Umschalter der Dokumente -, ohne dass eine davon namentlich genannt wäre. Gemessen sind es 92 Zustände je Gerät statt 16.

Zwei Grenzen hat er bewusst. Ein `<select>` fasst er **nicht** an: das ist ein Eingabefeld, und eine Sonde, die eines umstellt, schreibt in den Seed - dieselbe Grenze, die Sonde 5 für die Wischgeste zieht. Und er stellt jede Gruppe **zurück**, bevor er weitergeht: `localStorage` hängt am Origin, nicht an der Page, und die Dokumente merken sich ihre Ansicht. Ohne das Zurückstellen fände die nächste Sonde eine Seite vor, die so niemand öffnet.

Der Preis ist Laufzeit - rund vier Minuten für Sonde 7 -, und er ist bewusst gezahlt.

**Warum Sonde 9 die Signatur zählt statt eine Obergrenze zu setzen.** `will-change: transform` stand als Dauerregel auf `.swipe-row .shopping-item` und `.swipe-row .task-card`: im Demo-Seed trugen es 26 Einkaufszeilen und 11 Aufgabenkarten gleichzeitig, im Ruhezustand, jede mit eigener Compositor-Ebene samt Speicher - 54 Ebenen und ~15,2 MB auf `/tasks` (Audit 2026-08-08, P2-1). Ein Stylesheet-Scanner kann das nicht sehen: `.lg-blob--1` und `.task-card` tragen dieselbe Deklaration, und dem Selektor sieht man nicht an, ob das Element einmal oder pro Zeile existiert. Die Schwelle ist deshalb kein Zahlenwert, sondern die **Wiederholung**. Ebene 3 prüft die andere Hälfte (`die Wischgeste setzt und löst das Compositor-Versprechen selbst`): dass die Zusage an `.swipe-row--armed` hängt, bei `touchstart` gesetzt wird und einen Notausgang für `touchcancel` und den reduced-motion-Fall hat.

**Warum Sonde 10 zwei Welten fährt.** Zwei Lücken auf einmal. Erstens: `ROUTES` sind angemeldete Zustände, und `openPage` reicht dafür ein Sitzungs-Cookie durch - alle vier Guard-Ebenen und alle übrigen Sonden messen deshalb ausschließlich die App **hinter** dem Login. Anmelden, Passwort vergessen, Passwort zurücksetzen, Einladung annehmen, Ersteinrichtung und die Offline-Hülle hatten nie eine Sonde gesehen, obwohl dort der Erstkontakt und der Weg jedes neuen Familienmitglieds liegt (Audit 2026-08-08, P2-5). `ANON_ROUTES` steht im Harness neben `ROUTES`, `openAnonPage` lässt Cookie und `settle()` weg: das eine würde von genau diesen Seiten wegleiten, das andere wartet auf ein `#main-content`, das `offline.html` nicht hat.

Zweitens - und das ist der teurere Teil: für die angemeldete App war diese Grundlage zwar **gemessen**, aber nie **abgesichert**. Der Audit führte sie unter „Was trägt" (0 namenlose Ziele, 0 Label-Lücken, 0 doppelte IDs, 0 Überschriftensprünge), und ein Positivbefund ohne Guard ist eine Momentaufnahme. Der Beleg kam sofort: die Nachmessung fand einen **47. toten ARIA-Verweis**, den der Audit selbst übersehen hatte - `#cal-search` verwies per `aria-controls` auf eine Suchleiste, die erst beim Öffnen entsteht. Derselbe Fehlertyp wie P1-1, nur in der eingeklappten Variante, und dieselbe Antwort: **ohne aufgelöstes Ziel bleibt das Attribut weg**, gesetzt wird es dort, wo das Ziel entsteht.

**Sie wartet auf die Ruhe, nicht nur auf den Aufbau.** `settle()` gibt frei, sobald `#main-content` Kinder hat - der Router blendet jede Seite aber mit einer 200ms-Slide-Animation ein, und währenddessen steht der Seiteninhalt auf `opacity: 0`. Genau dort hat die Sonde einmal gemessen und `desktop/notes: 0 h1` gemeldet, obwohl der Titel im synchronen Markup steht. `settleAnimations()` wartet deshalb auf `getAnimations()` - **nur auf die endlichen**: die Backdrop-Blobs laufen mit `26s infinite alternate` und werden nie fertig, ein naives `Promise.all(...finished)` hinge bis zum Suite-Timeout. Ein Guard, der von einer Animation abhängt, meldet Zufall statt Regel.

Die Zielgrößen prüft sie **nur vor der Anmeldung**. Dahinter gehören sie Sonde 4, und die misst die Trefferfläche an jeder Scrollposition und unterscheidet freistehende von eingeengten Zielen; eine zweite, gröbere Messung daneben würde genau die Fehltreffer melden, die Sonde 4 gelernt hat zu vermeiden (ein 34x34-Knopf, der per `::before` auf 44px ausdehnt). Vor der Anmeldung hat Sonde 4 keine Reichweite - dort ist die grobe Messung besser als keine.

**Warum Sonde 8 den Helfer NICHT nimmt.** Sie prüft den Modulkopf, und davon hat jedes Modul genau einen: er überlebt jeden Sichtwechsel. Die Reichweite der 16 Routen ist hier also keine Bequemlichkeit, sondern eine Aussage über die Regel - und sie hält die Sonde bei rund einer Minute statt bei zwanzig. Sie fährt aus demselben Grund nur **mobil**: die kollabierende Leiste ist eine Regel der kompakten Größenklasse, ab 1024px steht jeder Kopf einzeilig und trägt seine Linie durchgehend.

**Was Sonde 8 gefunden hat, lag drei Runden lang da.** Drei Köpfe (Gesundheit, Belohnungen, Haushaltshilfe) dockten mobil **nie** an und trugen damit in keinem Zustand eine Kante; der Rezepte-Kopf ebenso, aus einem zweiten Grund. Der Fehler stand in keinem Stylesheet und in keinem Modulcode: der beobachtete Zeuge der ersten Kopfzeile ist ein Kind des **klebenden** Kopfes und wandert nur so weit, wie das negative `top` ihn hochzieht - bei einem zweizeiligen Kopf ist das exakt die Unterkante der ersten Zeile, sie **berührt** die Port-Kante also, statt sie zu überschreiten, und `threshold: 0` heißt „mehr als null Fläche". Ob eine Kante berührt oder überschritten wird, weiß erst das Dokument. Deshalb misst die Sonde auch die Zeiligkeit **selbst**, über die Überlappung der vertikalen Intervalle, statt `--page-toolbar-lead` zu glauben: eine Sonde, die die Rechnung der Shell nachspricht, prüft nichts.

**Ein Finger, der unter der Falz aufsetzt, misst nichts.** `page.touchscreen` arbeitet in Viewport-Koordinaten. Auf den Hauptrouten steht die erste Wischzeile weit oben, im Abo-Tab liegt sie hinter Kennzahlen und Auswertung - bei 375px auf y=1157. Sonde 5 meldete die frisch verdrahtete Abo-Liste prompt als „nicht verdrahtet", und der Befund sah aus wie ein echter. Sie holt die Zeile jetzt per `scrollIntoView` ins Bild, wartet und misst das Rechteck **danach**: der kollabierende Kopf verschiebt beim Scrollen alles unter sich. Es ist derselbe Fehlertyp wie bei Sonde 4 vor dem Durchscrollen - **eine Sonde misst nur, wo sie hinsieht**, und das ist jedes Mal eine Eigenschaft der Sonde, nicht der Regel.

**Warum Sonde 11 die Engine fragt und nicht das Stylesheet.** Der Cursor sagt es nicht: `cursor: pointer` vererbt, also sieht jedes Kind einer klickbaren Karte klickbar aus. Der Klassenname sagt es auch nicht - `.birthdays-toolbar__import` ist ein Knopf und heißt nach seiner Funktion. Was bleibt, ist die Listener-Registry, und die kennt nur der laufende Browser. Puppeteer bringt den CDP-Zugang mit, es kommt kein Fremdcode dazu.

Der Anlass ist derselbe wie bei Sonde 10: ein **Positivbefund ohne Guard**. Der Implementierungs-Audit vom 2026-08-08 führte unter „Was trägt" *Tastaturbedienung: 0 Befunde - alle 29 Elemente mit click-Listener ohne eigenen Tastaturzugang sind Container mit Event-Delegation über echte Buttons.* Gemessen, gestimmt, nie abgesichert. Genau diese Bauform hat bei Sonde 10 sofort einen 47. toten ARIA-Verweis geliefert, den der Audit selbst übersehen hatte.

**Was sie durchlässt, ist die Regel, nicht ihre Lücke.** Ein Container mit click-Listener und einem echten Bedienelement darin ist Event-Delegation - das Muster, mit dem diese App ihre Listen verdrahtet, und die Tastatur erreicht das Ziel über den Knopf. Gegengeprüft in beide Richtungen: ein klickbares `<div>` ohne inneres Ziel macht sie rot, dasselbe `<div>` mit einem Button darin bleibt grün. Sie fährt nur `#main-content` (die Shell ist auf jeder Route dieselbe, ein Befund dort käme neununddreißigmal) und nimmt `visitViews` **nicht** - aus demselben Grund wie Sonde 8: die Verdrahtung einer Liste hängt an ihrem Modul, nicht an der Sicht.

**Warum Sonde 12 das Token fragt und nicht den Blur.** Die Fallback-Regel sagt wörtlich, `prefers-reduced-transparency` kippe „alle Glas-Tokens auf `--color-surface`-Werte" - sie spricht also über Flächen, die ihren **Grund** von dort beziehen, nicht über alles, was einen Blur trägt. Die erste Fassung fragte nach `backdrop-filter` und meldete elf FABs, die unter beiden Zuständen bei alpha 0,78 bleiben. Das ist kein Verstoß, sondern ihre Bauart: ein `.page-fab` trägt seine Modulfarbe zu 78 % und keinen Glasgrund, sein `backdrop-filter` ist ein Specular und kein Lesegrund. Der Medienzustand kommt über CDP (`Emulation.setEmulatedMedia`) und nicht über `page.emulateMediaFeatures` - dessen Allowlist kennt `prefers-reduced-transparency` nicht und antwortet mit `Unsupported media feature`. Dass der Zustand wirklich anliegt, prüft die Sonde mit `matchMedia`, statt es anzunehmen.

**Eine Rot-Probe, die nicht rot wird, ist selbst ein Befund.** Die Glas-ist-Chrome-Hälfte von Sonde 12 blieb bei einem eingebauten Verstoß grün, und die Ursache war keine Lücke in der Sonde: `.app-content *` räumt `backdrop-filter` mit `!important` ab - gebaut gegen den Blank-Screen-Bug (#166), nicht für die Glas-Regel. Im Dokument **kann** dort kein Glas stehen, die Sonde war an dieser Stelle tautologisch. Erst ein `!important` im Verstoß machte sie rot. Der Guard bleibt trotzdem: er sichert die Regel für den Tag ab, an dem jemand die `#166`-Zeile anfasst - aber er ist als das dokumentiert, was er ist.

**Der Reichweiten-Nachweis zählt, was gemessen wurde - nicht, was da war.** Alle 14 Sonden tragen ihn heute, und drei zählten bis 2026-08-09 die falsche Größe. **Sonde 2** hatte als einzige gar keinen: der Block kannte nur `findings` und `unpainted`, und lieferte `collectTextSamples()` auf jeder Route `[]` (umbenanntes `#main-content`, `settle()`-Regress, abgelaufene Sitzung), waren alle vier Theme/Device-Tests grün - ausgerechnet bei der Sonde, die die ganze Guard-Ebene rechtfertigt. **Sonde 4** zählte `querySelectorAll(...).length`, also rohe DOM-Knoten in den Tausenden, während `measureTargets()` pro Element bei `if (!mine(cx, cy)) return;` aussteigt: brach `elementFromPoint`, hielt `seen >= 200` mühelos. **Sonde 11** zählte besuchte Routen, während die Findings aus dem CDP-Pfad kommen: degradierte der, lief dessen Schleife nie und `assert.equal(seen, routes.length)` hielt trotzdem. Die Regel dahinter, abgeschaut bei Sonde 14: **der Zähler muss an derselben Stelle hochgehen, an der auch ein Finding entstehen könnte.** Die Schwellen sind gemessen und nicht geraten (Sonde 2: 1775 mobil / 3060 desktop; Sonde 4: 1837 / 3543; Sonde 11: 790 Elemente mit click-Listener) und liegen bei rund einem Drittel davon - eng genug, um einen Ausfall zu fangen, weit genug, um nicht am Seed zu hängen.

**Warum Sonde 13 die Reichweite belegt, statt sie zu zählen.** Hinter dem FAB liegen 20 unterscheidbare Dialoge mit 2 bis 12 Feldern, und keiner hatte je eine Sonde gesehen - dieselbe Klasse Lücke wie die 23 Settings-Blätter, nur eine Ebene tiefer, und der Ort, an dem jede neue Funktion ihr Feld einbaut. Eine Sonde, die 22-mal denselben Dialog öffnet, wäre grün und hätte nichts gemessen; deshalb prüft sie, dass die geöffneten Modals sich **unterscheiden** (≥16 Signaturen aus Titel, Feld- und Knopfzahl). Vier Module haben keinen FAB, der ein Modal öffnet, und Einstellungen gar keinen - sie stehen im Übersprungsbeleg, statt stillschweigend mitgezählt zu werden.

**Die zwei Filter sind bei Sonde 13 der Unterschied zwischen einem Befund und 32 Fehltreffern.** Die erste Fassung meldete 32 Felder ohne Label, und keines war eines: der Datepicker hält ein `input[type=date]` mit `tabindex="-1" aria-hidden="true"` vor, das nur den nativen Picker öffnet, und der Foto-Upload ist ein `.sr-only`-Feld hinter einem Knopf mit `aria-label`. Beide sind für die Zugänglichkeitsschicht unsichtbar. Sonde 10 filtert genau diese zwei seit jeher - die Filter sind also keine Nachsicht, sondern dieselbe Grenze, zweimal gezogen. Dazu die Sonde-4-Lehre aus Session 22: **das Label ist das Ziel**, nicht die Checkbox darin; ohne diese Beziehung meldet die Sonde die vier 20x20-Haken im Rezept-Modal, die in einem zeilenbreiten `label.form-check` sitzen.

**Was Sonde 14 wirklich absichert, ist ein Satz, der zwölf Sessions ohne Guard stand.** In `tokens.css` steht seit Runde 1: *„NUR für Text. Icons tragen weiter den vollen Akzent — dort gilt 3:1."* Geprüft hat ihn nichts, und der Grund ist die eigentliche Lehre: **er fiel auf jeder Ebene aus einem anderen guten Grund heraus.** Der Farbpaar-Guard sucht Regeln, die Farbe *und* Untergrund setzen - `.btn` setzte gar keine `color` und bildete kein Paar. Der Tönungs-Guard prüft Prozentwerte, keine Kontraste. Sonde 2 misst Textknoten, und ein Icon-Button hat keinen. Die Farbpaar-Ebene überspringt `color-mix`-Untergründe ausdrücklich, und das zu Recht - eine Tönung hat keinen Untergrund ohne die Fläche darunter; das sind 152 Regeln. Jede Ebene sah für sich vollständig aus, und keine hat gelogen.

Der erste Lauf lieferte zwei Ursachen für 39 × 2 × 2 Zustände. Erstens: `reset.css` gab `a` und `input, textarea, select` ein `color: inherit` und `button` als einzigem der vier nicht - ein Button nahm damit die UA-Farbe `buttontext`, also Schwarz in **beiden** Themes. Im Light fiel das nie auf, im Dark stand ein schwarzes Chevron auf `#0A0A0C`: **1,06:1**. Sichtbar nur an Knöpfen ohne Variantenklasse, denn `--primary`, `--secondary` und `--ghost` setzen alle eine Farbe. Zweitens: vier Icon-Knöpfe der Küche und der Einkaufsliste trugen `--color-text-disabled`, obwohl jeder von ihnen klickbar war - der Wert hält auf keiner Fläche der App 3:1 (1,36 bis 2,17), und das ist Absicht, weil WCAG Deaktiviertes ausnimmt. Für „zurückgenommen, aber bedienbar" ist `--color-text-tertiary` da (4,86 bis 6,90). Dieselbe Unterscheidung stand für den Placeholder-Führungstext schon im Token-Kommentar; sie war nur nie auf Icons ausgedehnt.

**Ein Pseudoelement ist in dieser App regelmäßig der Träger.** Ohne diese Ebene meldete Sonde 14 zwölfmal `.item-check--checked` als „weißes Häkchen auf weiß" (1,00:1). Der gefüllte Kasten liegt im `::before`, das Element selbst hat `background: none` - eine Sonde, die nur echte Elemente kettet, rechnet dort einen Verstoß, den es nicht gibt. Es ist dieselbe Falle wie bei Sonde 4, wo `.weather-widget__refresh` seine Trefferfläche per `::before` dehnt. Genommen wird nur, was das Icon wirklich unterlegt (Breite und Höhe ≥ Icon); ein Pseudoelement daneben - Badge, Punkt, Specular - ist kein Untergrund. Die **Geschwister**-Fläche kommt aus demselben Grund dazu und **nur hier**: über alle Texte gemessen ist diese Signatur unbrauchbar (221 Fundstellen, meist Glas über scrollendem Inhalt ohne festen Untergrund), über Icons ist sie eng genug, um die gleitende Tab-Bar-Pille zu treffen und nicht eine Liste unter einem FAB.

**Warum Sonde 3 neben einem statischen Guard steht, statt ihn zu ersetzen.** Die Buttonform-Regel gilt für „jedes Element, das eine Aktion auslöst und eine eigene Fläche oder Kante trägt". Im Stylesheet steht weder Tag noch Rolle; was dort scharf ist, ist die Form eines umgrenzten Ziels - gleiche Breite und Höhe. Diesen Ausschnitt prüft `ein quadratischer Icon-Knopf ist ein Kreis` (Ebene 3, `test:frontend-audit`), den Rest prüft Sonde 3, wo Tag, Rolle und Nachbarschaft bekannt sind. Zwei Ebenen für eine Regel, jede prüft, was auf ihr prüfbar **ist**. Beide führen ihre Ausnahmen als Kategorien und beide prüfen zusätzlich, dass jeder Ausnahme-Eintrag noch existiert - eine Ausnahme für etwas Verschwundenes ist eine Allowlist, die niemand mehr liest.

**Grenzen von Sonde 4, gemessen statt vermutet.** Sie misst die Trefferfläche über `elementFromPoint` und kennt damit nur den Viewport - deshalb scrollt sie jede Route in Schritten von 70 % der Sichthöhe durch (maximal sechs, mit 250ms Ruhe für den kollabierenden Kopf). Ohne das Scrollen blieb sie **grün, obwohl `.ydp__trigger` auf 40x40 zurückgedreht war**: der Knopf liegt auf `/health` unter der Falz. Die Box ist dabei die Untergrenze und das Tasten zählt nur, was sie erweitert (`max(Box, getastet)`) - an der unteren Viewport-Kante und an der Clip-Kante eines `overflow: hidden`-Moduls liefert `elementFromPoint` sonst den Shell-Container, und vier Ziele sahen aus, als wären sie zu einem Drittel verdeckt. Der WCAG-Zweig der Sonde ist mit dem heutigen Layout **nicht auslösbar** (jedes dichte Bauteil ist in einer Richtung breit genug); gegengeprüft wurde er mit zwei injizierten 18x18-Zielen auf 14px Zentrumsabstand.

**Fallen, teuer bezahlt:**

- **Das Repo-Regelmuster `(?:^|[}])\s*([^{}]*)\{([^}]*)\}` sah nur jede ZWEITE Regel.** Es konsumiert das schließende `}` der Vorgängerregel, danach findet die nächste kein Trennzeichen mehr. Ein Formscan über alle Stylesheets findet mit dem reparierten Muster 82 statt 45 Regeln. Der statische Buttonform-Guard war damit grün, während die Regel im Dokument für 41 Knöpfe nicht galt. Der Scanner steht seit Runde 6 Phase 3 als `eachRule()` an genau einer Stelle in `test-frontend-audit.js`; wer CSS parst, nimmt ihn und schreibt kein eigenes Muster. Seit Phase 3b läuft er über die Klammern statt über ein Regex und liefert zu jeder Regel die Kette der At-Präambeln (`at`) - ohne die kann ein Guard „im selben Media-Block" nicht prüfen, und eine responsive Zusage ist genau das.
- `color-mix()` rendert als `color(srgb …)`, nicht als `rgba()`. Ein Parser, der nur eine Notation kennt, meldet Fehltreffer - im ersten Auditlauf zwei falsche AA-Befunde. Der Parser im Harness liest beide.
- Der Service Worker wird abgeschaltet, indem `register()` vor jedem Skript der Seite ablehnt (`disableServiceWorker()` im Harness). `navigator.serviceWorker` wegzudefinieren lässt die App beim Aufbau abstürzen, und die Sonden messen dann ein leeres Dokument statt eines Moduls. **Bis
- Angemeldet wird **einmal** pro Lauf, das Cookie geht an alle Seiten. Der Login-Limiter lässt fünf Versuche pro Minute zu; eine Suite, die pro Sprache neu anmeldet, fällt beim zweiten Lauf hinein - und der 429 sieht aus wie ein fehlender Seed. Die Sitzung liegt in der Datenbank (Tabelle `sessions`) und damit im Snapshot unten, das Cookie übersteht also jedes Zurücksetzen.
- **Jede Sonde beginnt auf demselben Stand (#1104).** Die Sonden teilen einen Server, und bis dahin trug jede drei Dinge an die nächste weiter: das API-Limit (300 Anfragen pro Minute je IP, und jede Sonde ist 127.0.0.1), liegengebliebene Daten und über einen 429 auf `/auth/me` eine Seite, die auf `/login` steht. In #1044 war derselbe Probe-Code auf demselben Rechner in derselben Laufart einmal grün und einmal rot. Seitdem ruft ein `beforeEach` `harness.reset()` auf: ein frischer Browser-Kontext (Cookies, localStorage und Cache gehen mit) und, sobald die vorige Sonde den Server über eine Seite erreicht hat, ein Neustart auf dem Snapshot nach Seed und Anmeldung - gemessen unter einer Sekunde. Gegenprobe: eine Sonde, die das Limit verbraucht, eine Notiz liegen lässt und vor dem Aufräumen wirft, macht ohne Reset die Folgesonde rot (`/auth/me` antwortet 429); mit Reset bleibt die Folgesonde grün, ohne Restnotiz. Zwei Folgen: ein gezielter Lauf (`--test-name-pattern`) misst dieselben Vorbedingungen wie der volle, und eine Sonde, die eine vollere Instanz braucht, bekommt sie über den Seed, nicht über ihre Vorgänger. `stopServer()` kehrt dafür erst nach dem echten Prozessende zurück, auch nach SIGKILL - ein noch sterbender Server hielte sonst den Port oder schriebe in die Kopie.

**Entwicklung:** `DOCUMENT_GUARDS_BASE_URL=http://localhost:PORT npm run test:document-guards` misst gegen einen bereits laufenden Server und spart Migration und Seed. Dort gibt es nichts neu zu starten: `reset()` erneuert nur den Browser-Kontext, Limit und Daten laufen von Sonde zu Sonde weiter, und ein solcher Lauf taugt deshalb nicht als Beleg. Ohne die Variable legt der Harness eine temporäre SQLite-Datei an, migriert sie, seedet sie über `scripts/seed-demo.js` und räumt am Ende auf. Vor dem Snapshot gleicht er einmal als die angemeldete Person ab (`GET /reminders/pending` legt die Geburtstagstermine und ihre Erinnerungen an) und verwirft danach jede Erinnerung (`dismissAllReminders`,
