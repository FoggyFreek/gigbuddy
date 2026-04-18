# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Two processes must run concurrently during development:

```bash
npm run server:dev   # Express API on :3002 (nodemon, auto-restarts)
npm run dev          # Vite dev server on :5173 (proxies /api → :3002)
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

## Architecture

**Monorepo layout**: frontend (React/Vite) and backend (Express) share one `package.json`. No separate workspaces — all `npm` commands run from the root.

**Backend** (`server/`):
- `server/index.js` — Express entry point, CORS, JSON body parser, mounts `/api` router
- `server/routes/index.js` — mounts sub-routers; add new resource routers here
- `server/routes/gigs.js` — REST handlers for gigs and their tasks; uses parameterised `pool.query` directly (no ORM)
- `server/db/index.js` — exports a single shared `pg.Pool`; reads connection from env
- `server/db/migrate.js` — sequential SQL file runner; tracks applied files in a `migrations` table; new migrations go in `server/db/migrations/` as `NNN_name.sql` and run automatically on next `npm run migrate`

**Frontend** (`src/`):
- `src/main.jsx` — wraps `<App>` in MUI `ThemeProvider` + `CssBaseline`
- `src/theme.js` — MUI v7 theme (Material 3 color roles, Roboto, `borderRadius: 12`)
- `src/App.jsx` — composes `<AppShell>` with `<GigsPage>` as its child
- `src/api/gigs.js` — thin `fetch` wrapper; all API calls go through here; throws on non-2xx; the only place that knows the `/api/gigs` path
- `src/hooks/useDebouncedSave.js` — returns `{ schedule, flush, status }`; `schedule(patch)` debounces 600 ms then calls the provided `saveFn`; `flush()` fires immediately (used on modal close)
- `src/components/AppShell.jsx` — permanent MUI Drawer (220 px) + AppBar; placeholder Settings and Logout icon buttons
- `src/components/GigsPage.jsx` — owns list state and modal open/close; refetches list after any modal close
- `src/components/GigsTable.jsx` — renders gig rows; status shown as a coloured `Chip`; row click bubbles up via `onRowClick`
- `src/components/GigFormModal.jsx` — single modal component for both create (`mode="create"`) and edit (`mode="edit"`); edit mode auto-saves field changes via `useDebouncedSave` and flushes on close; booking fee stored in cents server-side, displayed as decimal euros
- `src/components/GigTasks.jsx` — self-contained task list within the edit modal; fetches tasks via `getGig`, mutates via `createTask`/`updateTask`/`deleteTask`

**Data flow for auto-save**: any field change in `GigFormModal` (edit mode) calls `handleChange` → `useDebouncedSave.schedule(patch)` → after 600 ms inactivity, `PATCH /api/gigs/:id`. Closing the modal calls `flush()` to drain any pending save before `onClose` fires.

**Vite proxy**: `/api` requests from the dev server are proxied to `http://localhost:3002`, so no CORS headers are needed during development.

## Testing

Tests live in `src/tests/`. All API calls are mocked with `vi.mock('../api/gigs.js', ...)`. Components are wrapped in MUI `ThemeProvider` in a local `wrap()` helper in each test file. Timer-dependent tests (`useDebouncedSave`) use `vi.useFakeTimers()` + `vi.runAllTimersAsync()`.
