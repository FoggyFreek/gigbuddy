# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Two processes must run concurrently during development:

```bash
npm run server:dev   # Express API on :3002 (nodemon, auto-restarts)
npm run dev          # Vite dev server on :5173 (proxies /api → :3002)
npm run dev:all      # Both of the above in one terminal (concurrently)
```

```bash
npm run migrate      # Apply pending SQL migrations to PostgreSQL
npm run build        # Production Vite build
npm run lint         # ESLint (JS + JSX)
npm test             # Vitest (all tests, single run)
npm test -- --run --reporter=verbose  # Single run with test names
npm test -- --run src/tests/GigsTable.test.jsx  # Run one test file
```

## Environment

Copy `.env.example` to `.env` and fill in PostgreSQL credentials. The database must exist before running migrations. `pg` reads `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT` from the environment automatically.

Additional env vars:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OIDC_REDIRECT_URI` — Google OAuth (OpenID Connect)
- `SESSION_SECRET` — `express-session` signing secret
- `APP_URL` / `CLIENT_ORIGIN` — frontend URL, used for CORS and OIDC post-login redirect
- `ADMIN_EMAIL` — first user with this email is auto-approved as admin on initial login
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — Web Push credentials. If unset, push notifications are silently disabled (server logs a warning at boot)

## Architecture

**Monorepo layout**: frontend (React/Vite) and backend (Express) share one `package.json`. No separate workspaces — all `npm` commands run from the root.

**Backend** (`server/`):
- `server/index.js` — Express entry point, CORS, JSON body parser, `trust proxy`, session store (PG-backed via `connect-pg-simple`), OIDC init, mounts `/api` router, SPA fallback in production (serves `dist/`)
- `server/routes/index.js` — mounts sub-routers in this order: health → CSRF → `/auth` (public) → admin routers (`/users`) → approved-only routers (everything else). Add new resource routers here
- `server/routes/gigs.js` — REST handlers for gigs, gig tasks, and per-member gig votes (`/api/gigs/:id/votes/:bandMemberId`); uses parameterised `pool.query` directly (no ORM). Creating/confirming a gig triggers a `sendPushToAll` notification
- `server/routes/rehearsals.js` — rehearsals + per-member yes/no/maybe votes; also emits push notifications on create
- `server/routes/bandEvents.js` — generic band events (anything that isn't a gig or rehearsal: interviews, photo shoots, studio time). Date ranges via `start_date`/`end_date`
- `server/routes/availability.js` — per-member unavailability slots (date range + reason); the calendar view joins these with gigs, rehearsals, and band events
- `server/routes/bandMembers.js`, `server/routes/profile.js`, `server/routes/tasks.js` — standard CRUD
- `server/routes/emailTemplates.js` — reusable HTML email templates (name + subject + `body_html`); authored via a TipTap rich-text editor on the frontend
- `server/routes/push.js` — VAPID public key endpoint, `POST /subscribe`, `DELETE /unsubscribe`, `POST /resubscribe` (service-worker `pushsubscriptionchange` handler, CSRF-exempt — see below)
- `server/routes/auth.js` — OIDC login/callback/logout; bootstraps admin user on first login whose email matches `ADMIN_EMAIL`
- `server/routes/users.js` — admin-only: approve/reject pending users, link user accounts to `band_members` rows, delete users
- `server/utils/sendPush.js` — `sendPushToAll(payload)`; fans out via `web-push` and auto-deletes subscriptions returning 404/410 (gone)
- `server/middleware/auth.js` — `requireApproved` (403 for pending/rejected users), `requireAdmin`
- `server/middleware/csrf.js` — synchronizer-token CSRF middleware; mounted on `/api` before any router. Stores token in session, echoes it on the `X-CSRF-Token` response header, and requires the same value in the request header for POST/PUT/PATCH/DELETE on authenticated sessions. **`/push/resubscribe` is exempt** because service workers can't access the in-memory CSRF token; `sameSite:lax` session cookies + the `(oldEndpoint, user_id)` match are the integrity gate there
- `server/db/index.js` — exports a single shared `pg.Pool`; reads connection from env
- `server/db/migrate.js` — sequential SQL file runner; tracks applied files in a `migrations` table; new migrations go in `server/db/migrations/` as `NNN_name.sql` and run automatically on next `npm run migrate`

**Frontend** (`src/`):
- `src/main.jsx` — wraps `<App>` in `ThemeProvider` + `CssBaseline` + `LocalizationProvider` (dayjs adapter) + `BrowserRouter` + `AuthProvider` + `ProfileProvider`. Also registers the service worker at `/sw.js`
- `src/theme.js` — MUI v9 theme (Material 3 color roles, Roboto, `borderRadius: 12`)
- `src/App.jsx` — defines all routes. Public: `/login`, `/pending`. Authenticated: wrapped in `<RequireAuth>` + `<AppShell>` (Profile at `/`, Gigs, Rehearsals, Band Events, Tasks, Calendar, Email Templates). Admin-only (`<RequireAdmin>`): `/members`
- `src/contexts/AuthContext.jsx` — loads `getCurrentUser()` on mount; `user` is `undefined` (loading) / `null` (unauthenticated) / object (authenticated). Listens for the `auth:unauthorized` window event (dispatched by `_client.js` on 401) and redirects to `/login`
- `src/contexts/ProfileContext.jsx` — loads the band profile once; exposes `bandName` to the AppBar
- `src/api/_client.js` — shared `request(url, options)` helper used by every `src/api/*.js` file. Handles `Content-Type`, throws on non-2xx, dispatches `auth:unauthorized` on 401, and manages the CSRF token (captures it from the `X-CSRF-Token` response header, attaches it on POST/PUT/PATCH/DELETE)
- `src/api/gigs.js`, `src/api/rehearsals.js`, `src/api/bandEvents.js`, `src/api/availability.js`, `src/api/bandMembers.js`, `src/api/profile.js`, `src/api/tasks.js`, `src/api/emailTemplates.js`, `src/api/push.js`, `src/api/auth.js`, `src/api/users.js` — each is a thin wrapper around `_client.request`; the only place that knows its `/api/*` path
- `src/hooks/useDebouncedSave.js` — returns `{ schedule, flush, status }`; `schedule(patch)` debounces 600 ms then calls the provided `saveFn`; `flush()` fires immediately (used on modal close)
- `src/hooks/usePushNotifications.js` — exposes `{ status, subscribe, unsubscribe }` where `status` is one of `'unsupported' | 'loading' | 'unsubscribed' | 'subscribed' | 'denied'`. Used by the AppBar notification toggle
- `src/components/AppShell.jsx` — responsive shell: permanent MUI Drawer (220 px) on desktop, temporary drawer with hamburger on mobile (`md` breakpoint). AppBar shows band logo, band name from `ProfileContext`, user avatar, notifications toggle, and logout
- `src/components/RequireAuth.jsx`, `src/components/RequireAdmin.jsx` — route guards (redirect to `/login`, `/pending`, or 404 based on user state)
- `src/components/Gig*`, `src/components/Rehearsal*`, `src/components/BandEvent*`, `src/components/Availability*`, `src/components/EmailTemplate*`, `src/components/BandMembersSection.jsx`, `src/components/MemberAvatarStack.jsx`, `src/components/TasksTable.jsx`, `src/components/GigTasks.jsx`, `src/components/GigAvailabilityPanel.jsx` — feature UI
- `src/pages/*.jsx` — one page per route; each owns its list state and refetches after modal close
- `public/sw.js` — service worker. Handles `push` (shows notification with icon/badge, `tag` for dedup, `url` data for click-through), `notificationclick` (focuses or opens the target URL), and `pushsubscriptionchange` (re-subscribes and POSTs the new endpoint to `/api/push/resubscribe`)
- `public/manifest.json`, `public/icons/` — PWA manifest and notification icons (`icon-192.png`, `badge-72.png`, etc.)

**Data flow for auto-save**: any field change in `GigFormModal` (edit mode) calls `handleChange` → `useDebouncedSave.schedule(patch)` → after 600 ms inactivity, `PATCH /api/gigs/:id`. Closing the modal calls `flush()` to drain any pending save before `onClose` fires. The same pattern applies to other edit-mode modals (`RehearsalFormModal`, `BandEventFormModal`, `EmailTemplateFormModal`).

**Vite proxy**: `/api` requests from the dev server are proxied to `http://localhost:3002`, so no CORS headers are needed during development.

## Authorization model

The app uses a **shared-band trust model**: any approved user can read and write any band resource. This is intentional — gigs, rehearsals, band events, availability (including marking other members or the whole band unavailable), votes (including on behalf of other members), profile, profile links, band members, tasks, and email templates are all editable by any approved user. Do not add per-user ownership checks to these resources unless explicitly asked.

The only exception is admin-only operations, gated by `requireAdmin` in `server/middleware/auth.js`:
- `POST/PATCH/DELETE /api/users/*` — approving/rejecting pending users, linking users to band members, deleting users

Authentication gates: unapproved/pending users get 403 from any non-`/auth` endpoint via `requireApproved`. The first user whose email matches `ADMIN_EMAIL` is auto-approved as admin on initial login (bootstrap).

CSRF: cookie-based sessions are protected by a synchronizer token (`server/middleware/csrf.js`). The SPA picks up the token from the `X-CSRF-Token` response header on its `/api/auth/me` bootstrap call and `_client.js` attaches it to every unsafe request. The OIDC redirect endpoints (`/api/auth/login`, `/api/auth/callback`) are GETs and bypass the check; `/api/auth/logout` is a POST and requires the token like any other mutation. `/api/push/resubscribe` is explicitly CSRF-exempt because it's called from the service worker, which has no access to the in-memory token — `sameSite:lax` cookies plus the `(oldEndpoint, user_id)` match are the integrity gate there.

## Push notifications

Web Push end-to-end:
1. The AppBar notifications icon calls `usePushNotifications.subscribe()` → `Notification.requestPermission()` → `pushManager.subscribe(...)` with the server's VAPID public key → `POST /api/push/subscribe` persists the subscription (user_id, endpoint, p256dh, auth).
2. Server mutations that should notify the band call `sendPushToAll(payload)` (currently: gig create/confirm, rehearsal create). `web-push` fans out to all stored subscriptions; 404/410 responses cause the subscription to be deleted.
3. When the browser rotates a subscription, the service worker's `pushsubscriptionchange` handler POSTs the new endpoint to `/api/push/resubscribe` (CSRF-exempt, see above).
4. If `VAPID_*` env vars are absent, `sendPushToAll` becomes a no-op and the `/vapid-public-key` endpoint returns 500 — the frontend handles this gracefully by showing the push toggle as unavailable.

## Testing

Tests live in `src/tests/`. All API calls are mocked with `vi.mock('../api/<resource>.js', ...)`. Components are wrapped in MUI `ThemeProvider` (and sometimes `LocalizationProvider` / `MemoryRouter`) in a local `wrap()` helper in each test file. Timer-dependent tests (`useDebouncedSave`) use `vi.useFakeTimers()` + `vi.runAllTimersAsync()`. The push-notifications hook test (`usePushNotifications.test.js`) stubs `navigator.serviceWorker`, `window.PushManager`, and `Notification` on the jsdom global.

## Deployment

See `INSTALL_LOG.md` for deviations and fixes encountered when deploying to the production VPS (`gigbuddy.jorisbos.nl`). Key points for future changes:
- Node runs behind an nginx reverse proxy terminating TLS. `app.set('trust proxy', 1)` is required **before** any middleware that reads `req.secure` / `req.protocol` (session cookies with `secure: true` and OIDC callback URL reconstruction both depend on this).
- Deploys happen via GitHub Actions on push to `main`: SSH to VPS → `git pull` → `docker compose up -d --build` → `docker compose run --rm migrate`.
