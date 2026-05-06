# GigBuddy

Multi-tenant band management app for tracking gigs, rehearsals, band events, tasks, member availability, and more. Multiple bands can share one instance with full data isolation.

## Features

**Gigs** — Create and manage live performances. Stores venue, date, status (option / confirmed / announced), booking fee, contact details, equipment notes, and a banner image for share cards. Attach a task checklist to any gig. Collect yes/no availability votes from band members.

**Rehearsals** — Schedule sessions with date, time, and location. Members vote yes/no/maybe.

**Band Events** — Interviews, photo shoots, studio sessions, festival visits. Supports single-day and multi-day events.

**Calendar** — Monthly view overlaying gigs, rehearsals, band events, and member unavailability. Click or shift-click to mark date ranges. Availability slots carry an optional reason and can apply to a single member or the whole band.

**Tasks** — Standalone to-do list for band admin work, independent of gigs.

**Email Templates** — Reusable HTML email templates (name, subject, rich-text body) via TipTap. Useful for booking enquiries and press outreach.

**Gig Share Cards** — Generate shareable social-media cards for a gig. Two layouts (Vintage and Minimal). Cards can include a gig banner image, band logo, and custom photos.

**Push Notifications** — Opt-in Web Push (VAPID) via service worker. Members get notified when gigs or rehearsals are scheduled. Toggle from the bell icon in the header.

**Venues & Contacts** — Reusable address book of venues and booking contacts.

**Profile** — Band identity (name, bio), social handles (Instagram, Facebook, TikTok, YouTube, Spotify), logo upload, and a free-form link list for press kits and other resources.

**Members** — Tenant-admin view: approve/reject membership requests, link user accounts to band member profiles, issue and revoke invite links.

**Mobile-friendly** — Responsive layout with a collapsible drawer; installable as a PWA.

## Multi-tenant model

GigBuddy hosts multiple bands on one instance with strict data isolation:

- Each band is a **tenant** with its own slug, band name, social handles, and logo.
- **Memberships** join users to tenants with a role (`tenant_admin` | `member`) and status (`pending` | `approved`).
- Sign-in is **invite-only** — a tenant admin shares an invite link; new users land in `pending` until the admin approves them.
- Every data table carries a `tenant_id` column with composite foreign keys enforced at the database level, so cross-tenant reads are impossible even if a route forgets a `WHERE` clause.
- The active tenant lives in the session. Users with memberships in multiple bands can switch via the avatar menu.
- **Super admins** can manage all tenants and users globally.

## Authentication

Login is via Google OAuth (OpenID Connect). The first user whose email matches `ADMIN_EMAIL` is bootstrapped as super admin and tenant admin of the seed tenant on first login. All other accounts require an invite to join a tenant.

## Tech stack

| Layer | Libraries |
|---|---|
| Frontend | React 19, MUI v9, Vite, react-router v7, TipTap, dayjs |
| Backend | Express 5, PostgreSQL (`pg`), `web-push` |
| Auth | OpenID Connect (Google), `express-session`, `connect-pg-simple` |
| Storage | MinIO-compatible object store (RustFS) for logos, banners, share photos |
| PWA | Service worker, Web Push (VAPID), installable manifest |

## Development

Copy `.env.example` to `.env` and fill in PostgreSQL credentials, Google OAuth client, and (optionally) VAPID keys for push notifications.

Run both processes in separate terminals:

```
npm run server:dev   # Express API on :3002
npm run dev          # Vite dev server on :5173
```

Or both at once:

```
npm run dev:all
```

Apply pending database migrations:

```
npm run migrate
```

Run frontend tests:

```
npm test
```

Run backend isolation tests (requires a `*_test` database):

```
npm run test:server
```

Lint:

```
npm run lint
```

## Environment variables

| Variable | Purpose |
|---|---|
| `PGHOST` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` / `PGPORT` | PostgreSQL connection |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OIDC_REDIRECT_URI` | Google OAuth |
| `SESSION_SECRET` | express-session signing key |
| `APP_URL` / `CLIENT_ORIGIN` | Frontend URL (CORS, OIDC redirect, invite URLs) |
| `ADMIN_EMAIL` | Email of the first super admin |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push (optional; disables push if unset) |
| `PGDATABASE_TEST` | Test database override (defaults to `${PGDATABASE}_test`) |
