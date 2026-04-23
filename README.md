# GigBuddy

Band management app for tracking gigs, rehearsals, band events, tasks, and member availability.

## Features

**Gigs** — Create and manage live performances. Each gig stores venue, date, status (option / confirmed / announced), booking fee (in euros), contact details, equipment notes, and a free-form notes field. Fields auto-save while editing. Attach a task checklist to any gig. Mark gigs as optional and collect yes/no availability votes from band members.

**Rehearsals** — Schedule rehearsal sessions with a date, time, and location. Band members can vote yes/no/maybe on proposed rehearsals.

**Band Events** — Anything that isn't a gig or a rehearsal: interviews, photo shoots, studio sessions, festival visits. Supports single-day and multi-day (date-range) events.

**Calendar** — Monthly view that overlays gigs, rehearsals, band events, and member availability. Click or shift-click to create date ranges. Each availability slot tracks a status (available/unavailable) and an optional reason. Members can be marked unavailable individually or as a whole band.

**Tasks** — Standalone to-do list for band admin work, independent of gigs.

**Email Templates** — Reusable HTML email templates (name + subject + rich-text body) authored with a TipTap rich-text editor. Useful for booking enquiries and press outreach.

**Push Notifications** — Opt-in Web Push (VAPID) via a service worker. Band members get notified when new gigs or rehearsals are scheduled. Toggle from the bell icon in the header.

**Profile** — Band identity (name, bio), social handles (Instagram, Facebook, TikTok, YouTube, Spotify), and a free-form link list for press kits and other resources.

**Members** — Admin-only view. Approve or reject user sign-ups and link each user account to a band member profile.

**Mobile-friendly** — Responsive layout with a collapsible drawer; installable as a PWA.

## Authentication

Login is via Google OAuth (OpenID Connect). New accounts are held in a pending state until an admin approves them. The first user whose email matches the `ADMIN_EMAIL` env var is auto-approved as admin on initial login.

## Tech stack

- Frontend: React 19, MUI v9, Vite, react-router v7, TipTap (rich text), dayjs
- Backend: Express 5, PostgreSQL (via `pg`), `web-push`
- Auth: OpenID Connect (Google), `express-session` with a Postgres session store (`connect-pg-simple`)
- PWA: service worker with Web Push + notification click-through

## Development

Copy `.env.example` to `.env` and fill in your PostgreSQL credentials, Google OAuth client, and (optionally) VAPID keys for push notifications.

Run both processes concurrently (each in its own terminal):

```
npm run server:dev
```

```
npm run dev
```

Or run both in one terminal:

```
npm run dev:all
```

Apply pending database migrations:

```
npm run migrate
```

Run tests:

```
npm test
```