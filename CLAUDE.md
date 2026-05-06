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
npm test             # Vitest frontend tests (server tests excluded)
npm test -- --run --reporter=verbose  # Single run with test names
npm test -- --run src/tests/GigsTable.test.jsx  # Run one test file
npm run test:server  # Backend isolation tests against a real PG (requires PGDATABASE_TEST DB)
```

## Environment

Copy `.env.example` to `.env` and fill in PostgreSQL credentials. The database must exist before running migrations. `pg` reads `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT` from the environment automatically.

Additional env vars:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OIDC_REDIRECT_URI` — Google OAuth (OpenID Connect)
- `SESSION_SECRET` — `express-session` signing secret
- `APP_URL` / `CLIENT_ORIGIN` — frontend URL, used for CORS and OIDC post-login redirect, and for invite URL generation
- `ADMIN_EMAIL` — first user with this email is bootstrapped as super admin (and `tenant_admin` of the seed tenant) on initial login
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — Web Push credentials. If unset, push notifications are silently disabled (server logs a warning at boot)
- `PGDATABASE_TEST` — optional override for the backend test DB. Defaults to `${PGDATABASE}_test`; the harness refuses any DB name not ending in `_test`

## Multi-tenant model

GigBuddy hosts multiple bands (tenants) on one instance with strict isolation.

- **Tenants** live in the `tenants` table (`id`, `slug`, `band_name`, social handles, `logo_path`, `archived_at`). Tenant id `1` is the seed tenant migrated from the legacy single-band install.
- **Memberships** (`memberships` table) are the join between users and tenants. A user can belong to many tenants. Each membership has a `role` (`tenant_admin` | `member`) and a `status` (`pending` | `approved` | `rejected`).
- **Super admins** (`users.is_super_admin = TRUE`) can manage all tenants and all users globally. They do not automatically belong to every tenant — a super admin who wants to *use* a tenant's data must have an approved membership in it. The `ADMIN_EMAIL` user is bootstrapped as both `is_super_admin` and `tenant_admin` of the seed tenant on first login.
- **Active tenant** lives in `req.session.activeTenantId`. URLs stay flat (`/gigs`, `/rehearsals`, …) — there is no `/t/<slug>/...` prefix. The OIDC callback sets `activeTenantId` to the user's first approved membership; `POST /api/auth/active-tenant` switches it. The SPA refetches `/auth/me` after a switch.
- **Every tenant-owned table** has a `tenant_id` column. Parent tables carry a `UNIQUE(id, tenant_id)` constraint so child FKs can enforce same-tenant integrity via composite FKs (e.g. `gig_participants(gig_id, tenant_id) → gigs(id, tenant_id)`). DB rejects cross-tenant child references even if a route forgot a `WHERE tenant_id`.
- **Cold sign-in is invite-only.** A new Google sign-in creates the `users` row with `status='approved'` and zero memberships, then routes to `/redeem-invite`. Tenant access is granted only via an invite redemption + tenant-admin approval. Global `users.status='pending'` is no longer produced; `'rejected'` is still meaningful as a global block.
- **File storage**: new uploads use `tenants/<tenant_id>/<category>/<uuid>` keys. Legacy keys (`logo/`, `gig-banners/`, `share/`) from the single-band era are still read but no new ones are written. Access is gated by ownership lookup in the active tenant before streaming.

## Architecture

**Monorepo layout**: frontend (React/Vite) and backend (Express) share one `package.json`. No separate workspaces — all `npm` commands run from the root.

**Backend** (`server/`):
- `server/index.js` — Express entry point, CORS, JSON body parser, `trust proxy`, session store (PG-backed via `connect-pg-simple`), OIDC init, mounts `/api` router, SPA fallback in production (serves `dist/`)
- `server/routes/index.js` — mounts sub-routers in this order: health → CSRF → `/auth` (public) → `/invites/redeem` (auth-only, no tenant required) → super-admin routers (`/admin/tenants`, `/admin/users`) → tenant-admin routers (`/invites`, `/users`) → tenant-member data routers (`/gigs`, `/tasks`, `/profile`, `/band-members`, `/availability`, `/rehearsals`, `/band-events`, `/email-templates`, `/venues`, `/contacts`, `/push`, `/share/photos`, `/files`). Add new resource routers here.
- `server/routes/auth.js` — OIDC login/callback/logout, `GET /me` (returns the multi-tenant payload, see below), `POST /active-tenant` to switch tenants. Bootstraps the `ADMIN_EMAIL` user as super admin + seed tenant admin on first login.
- `server/routes/invites.js` — exports `adminRouter` (`GET/POST /` and `DELETE /:id` for tenant_admin issuing/listing/revoking invites) and `redeemRouter` (`POST /` to redeem a code; auth-only, no tenant required). Codes are 32-char `randomBytes(24).toString('base64url')`. Issuing a `tenant_admin` invite requires super admin. Redeem runs in a transaction with `UPDATE … RETURNING` so an invite is atomically claimed (race-safe).
- `server/routes/tenants.js` — super-admin tenant CRUD: list/get/create/update, assign/demote tenant_admin, archive/unarchive (soft delete via `archived_at`).
- `server/routes/adminUsers.js` — super-admin global user list + hard delete (preserves `ADMIN_EMAIL` and self-delete guards).
- `server/routes/users.js` — tenant-scoped membership operations: list memberships in active tenant, update status/role, link/unlink a band_member, remove the membership. Granting `tenant_admin` requires super admin; demoting a tenant_admin or modifying a super_admin's membership requires super admin.
- `server/routes/gigs.js` — REST handlers for gigs, gig tasks, and per-member gig votes (`/api/gigs/:id/votes/:bandMemberId`). Every read/write/join is scoped by `req.tenantId`. Creating/confirming a gig calls `sendPushToTenant(req.tenantId, payload)`.
- `server/routes/rehearsals.js` — rehearsals + per-member yes/no/maybe votes; emits `sendPushToTenant` on create.
- `server/routes/bandEvents.js` — band events (interviews, photo shoots, studio time). Date ranges via `start_date`/`end_date`.
- `server/routes/availability.js` — per-member unavailability slots (date range + reason); calendar joins these with gigs/rehearsals/band events.
- `server/routes/profile.js` — reads from / writes to `tenants` (the seed `profile` table is gone; tenant id is the band identity). Sub-routes for `profile_links` and tenant-admin-only `POST /logo`.
- `server/routes/bandMembers.js`, `server/routes/tasks.js`, `server/routes/emailTemplates.js`, `server/routes/venues.js`, `server/routes/contacts.js`, `server/routes/sharePhotos.js` — tenant-scoped CRUD.
- `server/routes/files.js` — serves storage objects after verifying the key belongs to a record in the active tenant (via union lookup across `tenants.logo_path`, `gigs.banner_path`, `share_photos.object_key`). Anything outside the active tenant 404s before streaming.
- `server/routes/push.js` — VAPID public key endpoint, `POST /subscribe`, `DELETE /unsubscribe`, `POST /resubscribe` (service-worker `pushsubscriptionchange` handler, CSRF-exempt — see below).
- `server/utils/sendPush.js` — `sendPushToTenant(tenantId, payload)` and `sendPushToMember(bandMemberId, tenantId, payload)`. Fans out via `web-push`, filters subscriptions by approved memberships in the event's tenant, injects `tenantId`/`tenantSlug` into the payload, and auto-deletes subscriptions returning 404/410.
- `server/middleware/auth.js` — `requireAuth` (session has userId), `loadUser` (populates `req.user`), `requireApproved` (403 unless `users.status === 'approved'`).
- `server/middleware/tenant.js` — `resolveTenantId` (reads `req.session.activeTenantId`, fetches the matching membership; 403 if missing or not approved), `requireTenantMember`, `requireTenantAdmin` (tenant_admin OR super_admin), `requireSuperAdmin`. `resolveTenantId` is strict: it does NOT silently fall back to "first approved membership". Real users are unaffected because the OIDC callback and `/auth/me` both keep `activeTenantId` in sync.
- `server/middleware/csrf.js` — synchronizer-token CSRF middleware mounted on `/api` before any router. Stores token in session, echoes it on the `X-CSRF-Token` response header, requires the same value in the request header for POST/PUT/PATCH/DELETE on authenticated sessions. **`/push/resubscribe` is exempt** because service workers can't access the in-memory CSRF token; `sameSite:lax` session cookies + the `(oldEndpoint, user_id)` match are the integrity gate there.
- `server/db/index.js` — exports a single shared `pg.Pool`; reads connection from env.
- `server/db/migrate.js` — sequential SQL file runner; tracks applied files in a `migrations` table. New migrations go in `server/db/migrations/` as `NNN_name.sql` and run automatically on next `npm run migrate`. Numeric prefixes must remain monotonic (the runner sorts alphabetically).

**`/auth/me` payload**:
```js
{
  id, email, name, status, pictureUrl,
  isSuperAdmin,
  activeTenantId,
  activeTenantRole,       // 'tenant_admin' | 'member' | null
  bandMemberId,           // for active tenant; null if unlinked
  memberships: [          // approved + pending; rejected hidden
    { tenantId, tenantName, tenantSlug, role, status }
  ],
}
```

**Frontend** (`src/`):
- `src/main.jsx` — wraps `<App>` in `ThemeContextProvider` + `CssBaseline` + `LocalizationProvider` (dayjs adapter) + `BrowserRouter` + `AuthProvider` + `ProfileProvider`. Also registers the service worker at `/sw.js`. `ProfileProvider` must remain inside `AuthProvider` because it consumes `useAuth()`.
- `src/theme.js` — MUI v9 theme (Material 3 color roles, Roboto, `borderRadius: 12`).
- `src/App.jsx` — defines all routes. Public: `/login`, `/pending`. Authenticated (wrapped in `<RequireAuth>`): `/redeem-invite`. Inside `<AppShell>`: Profile at `/`, Gigs, Rehearsals, Band Events, Tasks, Calendar, Email Templates, Venues, Contacts. Tenant-admin-only (`<RequireTenantAdmin>`): `/members`. Super-admin-only (`<RequireSuperAdmin>`): `/admin/tenants`, `/admin/users`.
- `src/contexts/AuthContext.jsx` — loads `getCurrentUser()` on mount; `user` is `undefined` (loading) / `null` (unauthenticated) / object (authenticated). Exposes `logout()`, `switchTenant(tenantId)` (calls `POST /auth/active-tenant`), and `refreshUser()` (re-fetches `/auth/me`, used by the redeem flow). Listens for the `auth:unauthorized` window event (dispatched by `_client.js` on 401) and redirects to `/login`.
- `src/contexts/ProfileContext.jsx` — re-fetches the band profile whenever `user.activeTenantId` changes; exposes `bandName` to the AppBar.
- `src/api/_client.js` — shared `request(url, options)` helper used by every `src/api/*.js` file. Handles `Content-Type`, throws on non-2xx, dispatches `auth:unauthorized` on 401, and manages the CSRF token (captures it from the `X-CSRF-Token` response header, attaches it on POST/PUT/PATCH/DELETE).
- `src/api/*.js` — one file per resource: `auth`, `gigs`, `rehearsals`, `bandEvents`, `availability`, `bandMembers`, `profile`, `tasks`, `emailTemplates`, `venues`, `contacts`, `sharePhotos`, `push`, `users` (tenant-scoped membership ops), `tenants` (super-admin tenant CRUD), `adminUsers` (global user ops), `invites` (list/create/revoke/redeem). Each is a thin wrapper around `_client.request`; the only place that knows its `/api/*` path.
- `src/hooks/useDebouncedSave.js` — returns `{ schedule, flush, status }`; `schedule(patch)` debounces 600 ms then calls the provided `saveFn`; `flush()` fires immediately (used on modal close).
- `src/hooks/usePushNotifications.js` — exposes `{ status, subscribe, unsubscribe }` where `status` is one of `'unsupported' | 'loading' | 'unsubscribed' | 'subscribed' | 'denied'`.
- `src/hooks/useTenantQuerySync.js` — invoked by `AppShell`. Reads `?tenant=N` from the URL (set by the service worker for push deep links), calls `switchTenant(N)` if mismatched and the user is an approved member of that tenant, then strips the param. Tolerates legacy payloads (no `tenant`) and stale tenants the user no longer belongs to.
- `src/components/AppShell.jsx` — responsive shell: permanent MUI Drawer (220 px) on desktop, temporary drawer with hamburger on mobile (`md` breakpoint). Drawer nav splits into Base / "Tenant admin" (Members) / "Super admin" (Tenants, All Users) sections by role. The avatar opens a Menu with the tenant switcher (shown only when ≥2 approved memberships), super-admin "Manage tenants" link, and Logout. The `<main>` is keyed on `activeTenantId` so list pages remount on tenant switch.
- `src/components/RequireAuth.jsx` — `null` → /login, `status === 'rejected'` → /pending, `isSuperAdmin` → app, any approved membership → app, on `/redeem-invite` always render, empty memberships → /redeem-invite, only-pending memberships → /pending.
- `src/components/RequireTenantAdmin.jsx`, `src/components/RequireSuperAdmin.jsx` — route guards.
- `src/components/InvitesSection.jsx` — list/create/revoke/copy-URL UI used by the Invites tab on the Members page. The `tenant_admin` option in the create dialog is disabled unless the caller is a super admin.
- `src/components/Gig*`, `src/components/Rehearsal*`, `src/components/BandEvent*`, `src/components/Availability*`, `src/components/EmailTemplate*`, `src/components/BandMembersSection.jsx`, `src/components/MemberAvatarStack.jsx`, `src/components/TasksTable.jsx`, `src/components/GigTasks.jsx`, `src/components/GigAvailabilityPanel.jsx` — feature UI.
- `src/pages/*.jsx` — one page per route. `MembersPage` has Tabs (Members | Invites). Admin pages live under `src/pages/admin/`. `RedeemInvitePage` reads `?code=` from the URL, auto-redeems on mount if present, otherwise shows a manual entry form.
- `public/sw.js` — service worker. `push` shows a notification with `data: { url, tenantId, tenantSlug }`. `notificationclick` appends `?tenant=N` to the navigation URL (when present) so the SPA's `useTenantQuerySync` can switch tenants before deep-linking. `pushsubscriptionchange` re-subscribes and POSTs to `/api/push/resubscribe`.
- `public/manifest.json`, `public/icons/` — PWA manifest and notification icons.

**Data flow for auto-save**: any field change in `GigFormModal` (edit mode) calls `handleChange` → `useDebouncedSave.schedule(patch)` → after 600 ms inactivity, `PATCH /api/gigs/:id`. Closing the modal calls `flush()` to drain any pending save before `onClose` fires. Same pattern in `RehearsalFormModal`, `BandEventFormModal`, `EmailTemplateFormModal`.

**Vite proxy**: `/api` requests from the dev server are proxied to `http://localhost:3002`, so no CORS headers are needed during development.

## Authorization model

GigBuddy uses an **intra-tenant shared trust model**: any approved member of tenant T can read and write any of tenant T's resources. Gigs, rehearsals, band events, availability (including marking other members or the whole band unavailable), votes (including on behalf of other members), profile, profile links, band members, tasks, email templates, venues, contacts, share photos — all editable by any approved member of the tenant. Do not add per-user ownership checks inside a tenant unless explicitly asked.

Privileged actions:
- **Tenant admin** (`memberships.role = 'tenant_admin'` OR `users.is_super_admin = TRUE`): manage memberships in the active tenant (`/api/users`), issue/revoke invites (`/api/invites`), upload tenant logo (`POST /api/profile/logo`).
- **Super admin** (`users.is_super_admin = TRUE`): manage all tenants (`/api/admin/tenants`), all users globally (`/api/admin/users`), and grant `tenant_admin` (only super admins can promote a member to tenant_admin or invite at the `tenant_admin` role).

Authentication gates: `requireApproved` 403s users whose `users.status !== 'approved'`. `resolveTenantId` 403s users whose active tenant isn't an approved membership. Cross-tenant reads and updates return 404 (not 403) so we don't leak existence. The DB-level composite FKs (`(child_id, tenant_id) → parent(id, tenant_id)`) backstop any route that forgets a `WHERE tenant_id`.

CSRF: cookie-based sessions are protected by a synchronizer token (`server/middleware/csrf.js`). The SPA picks up the token from the `X-CSRF-Token` response header on its `/api/auth/me` bootstrap call and `_client.js` attaches it to every unsafe request. The OIDC redirect endpoints (`/api/auth/login`, `/api/auth/callback`) are GETs and bypass the check; `/api/auth/logout` is a POST and requires the token. `/api/push/resubscribe` is explicitly CSRF-exempt because it's called from the service worker, which has no access to the in-memory token — `sameSite:lax` cookies plus the `(oldEndpoint, user_id)` match are the integrity gate there.

## Push notifications

Web Push end-to-end:
1. The AppBar notifications icon calls `usePushNotifications.subscribe()` → `Notification.requestPermission()` → `pushManager.subscribe(...)` with the server's VAPID public key → `POST /api/push/subscribe` persists the subscription (`user_id`, `endpoint`, `p256dh`, `auth`).
2. Server mutations that should notify the band call `sendPushToTenant(req.tenantId, payload)` (currently: gig create/confirm, rehearsal create). `web-push` fans out to subscriptions whose owners have an *approved* membership in that tenant; 404/410 responses cause the subscription to be deleted. The payload includes `tenantId` and `tenantSlug`.
3. The service worker's `notificationclick` handler appends `?tenant=N` to the target URL. When the SPA renders, `useTenantQuerySync` (inside `AppShell`) calls `switchTenant(N)` if the active tenant differs and the user is an approved member, then strips the param.
4. When the browser rotates a subscription, `pushsubscriptionchange` POSTs to `/api/push/resubscribe` (CSRF-exempt, see above).
5. If `VAPID_*` env vars are absent, `sendPushToTenant` becomes a no-op and `/vapid-public-key` returns 500 — the frontend handles this gracefully by hiding the push toggle.

## Invites & enrollment

1. A tenant admin (or super admin) creates an invite via `POST /api/invites` with `{ role, expiresInDays? }`. The response includes a 32-char `code` and a ready-to-share `url = ${APP_URL}/redeem-invite?code=...`. Granting `tenant_admin` is gated to super admins.
2. The invitee opens the URL. `RedeemInvitePage` auto-redeems on mount: `POST /api/invites/redeem` with `{ code }` creates a `pending` membership in the invite's tenant. The endpoint runs in a transaction with `UPDATE tenant_invites … RETURNING` so an invite is atomically claimed (race-safe). It rejects already-used / expired / unknown codes, archived tenants, globally rejected users, and users who already have a membership in the tenant.
3. The tenant admin approves the new membership from the Members tab (`PATCH /api/users/:userId/membership`). The user is now a tenant member.

## Testing

Frontend tests live in `src/tests/`. All API calls are mocked with `vi.mock('../api/<resource>.js', ...)`. Components are wrapped in MUI `ThemeProvider` (and sometimes `LocalizationProvider` / `MemoryRouter`) in a local `wrap()` helper in each test file. Timer-dependent tests (`useDebouncedSave`) use `vi.useFakeTimers()` + `vi.runAllTimersAsync()`. The push-notifications hook test stubs `navigator.serviceWorker`, `window.PushManager`, and `Notification` on the jsdom global. Tests that need to mock `navigator.clipboard` use `vi.spyOn(navigator, 'clipboard', 'get')` (Object.defineProperty doesn't survive jsdom's read-only getter) and `fireEvent.click` (userEvent v14's setup may not propagate through MUI Tooltip-wrapped IconButtons reliably).

Backend isolation tests live in `src/tests/server/`:
- `_envSetup.js` rewrites `PGDATABASE` to `${PGDATABASE}_test` (or `PGDATABASE_TEST`) before any pool import; refuses any DB whose name doesn't end in `_test`.
- `_app.js` is a test express factory: real routes/CSRF, but `x-test-user-id`/`x-test-tenant-id` headers stand in for OIDC and CSRF is short-circuited.
- `_db.js` exposes `runMigrations`, `truncateAll`, `seedTwoTenants`.
- `isolation.test.js`, `admin.test.js`, `invites.test.js`, `push.test.js` use the harness above.

Run as `npm run test:server` (sequential, `--no-file-parallelism`). The default `npm test` excludes `src/tests/server/`. The test database (e.g. `gigbuddy_mt_test`) must be created manually before the first run.

## Migrations

Numeric prefixes must remain monotonic; the runner sorts alphabetically. The current high-water mark is `034_drop_legacy.sql`, which dropped `users.is_admin`, `profile_links.profile_id`, and the legacy single-band `profile` table.
