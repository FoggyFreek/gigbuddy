# GigBuddy

Band management app for tracking gigs, rehearsals, tasks, and member availability.

## Features

**Gigs** — Create and manage live performances. Each gig stores venue, date, status, booking fee (in euros), and notes. Fields auto-save while editing. Attach a task checklist to any gig.

**Rehearsals** — Schedule rehearsal sessions with a date, time, and location. Band members can vote yes/no/maybe on proposed rehearsals.

**Availability** — Monthly calendar showing member availability slots alongside gigs and rehearsals. Click or shift-click to create date ranges. Each slot tracks a status (available/unavailable) and an optional reason.

**Tasks** — Standalone to-do list for band admin work, independent of gigs.

**Profile** — Band identity (name, bio), social handles (Instagram, Facebook, TikTok, YouTube, Spotify), and a free-form link list for press kits and other resources.

**Members** — Admin-only view. Approve or reject user sign-ups and link each user account to a band member profile.

## Authentication

Login is via Google OAuth. New accounts are held in a pending state until an admin approves them.

## Tech stack

- Frontend: React 19, MUI v9, Vite
- Backend: Express 5, PostgreSQL (via `pg`)
- Auth: OpenID Connect (Google), `express-session` with a Postgres session store

## Development

Copy `.env.example` to `.env` and fill in your PostgreSQL credentials.

Run both processes concurrently:

```
npm run server:dev
```

```
npm run dev
```

Apply pending database migrations:

```
npm run migrate
```

Run tests:

```
npm test
```
