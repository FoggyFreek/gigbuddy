---
name: test-harness
description: Internals of the backend test harness — the per-worker template database, the _test database-name guard, the _envSetup/_app/_db helpers, and the worker/connection budget. Use when adding a file to src/tests/server/, when backend tests fail with database, migration, template or connection-limit errors, or after editing an already-applied migration in place.
user-invocable: false
---

# Backend test harness

Run commands and the test-driven workflow are in CLAUDE.md. This is what sits underneath
them, needed when the harness itself is in play.

```
infisical run --env=test -- npx vitest run --config vitest.server.config.js src/tests/server/<file>.test.js
```

**Always pass `--config vitest.server.config.js`** — it owns the parallel-database harness;
without it the run falls back to one shared database. `npm run test:server -- <file>` does
NOT narrow the run (the script already passes a path), it runs everything, and the full
suite takes ~8 minutes.

## Database safety

Backend tests run against a **real Postgres database whose name must end in `_test`**
(`infisical run --env=test` sets `PGDATABASE=gigbuddy_test`). The mutating `_db.js` helpers
verify `current_database()` against the expected `_test` name before migrating, truncating
or seeding — **never weaken that check**; it is the only thing standing between a stray
`--env=dev` and the development database.

## Fixtures

- `_envSetup.js` stays the **first import** in every backend test file.
- `_app.js` builds a real Express app with `x-test-user-id` / `x-test-tenant-id` standing in
  for OIDC, and CSRF short-circuited.
- `_db.js` exposes `runMigrations`, `truncateAll`, `seedTwoTenants`.
- Billing tests: `_fakeProvider.js` (injected via `setPaymentProviderForTests`) and
  subscription-row helpers in `_billing.js`.
- Test users get terms auto-accepted via a column DEFAULT in `_db.js` — clear both columns
  explicitly to exercise the stale-terms block.

## Parallelism

Workers clone a reusable schema-only **template database** (`_globalSetup.js`,
`_workerDatabase.js`); one database per **worker**, not per file, so files keep the
`truncateAll()` + `seedTwoTenants()` rhythm.

- **Editing an already-applied migration in place needs `GIGBUDDY_TEST_FRESH_TEMPLATE=1`** —
  otherwise the stale template is reused and the change appears to have no effect.
- `GIGBUDDY_TEST_MAX_WORKERS` (8) × `PG_POOL_MAX` (5) must stay under the server's
  `max_connections`. Connection-exhaustion failures are usually this budget, not a leak.

## What every backend change owes

An isolation test proving **tenant isolation holds** — a cross-tenant read/write must 404,
not leak. Tests group by domain (`ledger.test.js`, `billingLifecycle.test.js`, …); grep for
existing coverage before creating a new file.

SonarQube flags these tests for "no assertions" because it does not recognize supertest
`.expect(<status>)` or testing-library `waitFor` — mark those `falsepositive`.
