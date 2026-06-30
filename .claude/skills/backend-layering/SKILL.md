---
name: backend-layering
description: Route/service/repository layering rules for this Express backend. Use when adding or refactoring any server route, service, repository, or validator — covers layer responsibilities, error contract, transactions, tenant scoping, and the canonical rehearsals example.
user-invocable: false
---

# Backend layering: route → service → repository

Every backend resource is split into four files. The **canonical example** to copy is the rehearsals stack:

- `server/routes/rehearsals.js` — thin HTTP layer
- `server/services/rehearsalService.js` — domain logic
- `server/repositories/rehearsalRepository.js` — SQL
- `server/validators/rehearsalValidators.js` — pure input parsing

Read those files before writing or refactoring backend code; match their style exactly.

## Layer responsibilities

### Route (`server/routes/<resource>.js`)
- Parses and validates URL/body ids (`parseId` from the resource's validators; a local `requireParam(req, res, name)` helper that 400s and returns null).
- Calls **one** service function per handler, passing `pool` (or letting the service own the transaction) plus `req.tenantId` / `req.user.id` and the raw body.
- Translates results: `if (result.error) return sendError(res, result.error)` then `res.json(...)` / `res.status(201).json(...)` / `res.status(204).end()`.
- Fires notification helpers exported by the service *after* responding (e.g. `notifyRehearsalCreated`).
- **Never** contains SQL, business rules, or `try/catch` for DB error codes.
- Register new routers in `server/routes/index.js`.

### Service (`server/services/<resource>Service.js`)
- All domain logic: validation beyond id parsing, state-transition rules, transactions, idempotency, mapping DB errors (`err.code === '23505'` → 409), composing response payloads (e.g. attaching participants).
- **Error contract**: expected failures return `{ error: { status, body } }` (define a shared `NOT_FOUND` const); success returns a named payload like `{ rehearsal }` or `{}` for deletes. Throw only on unexpected errors — the global handler turns those into 500s.
- Owns transactions: `pool.connect()` / `BEGIN` / `COMMIT` / `ROLLBACK` / `release()` lives here, passing the `client` to repository functions.
- Push notifications: export `notifyXxx(tenantId, entity)` functions that fire-and-forget (`.catch((err) => logger.error('push.send_to_tenant_failed', { err, tenantId }))` — see `server/utils/logger.js`, CLAUDE.md "Logging"); the route decides when to call them so they happen after the HTTP response.

### Repository (`server/repositories/<resource>Repository.js`)
- SQL **only** — no business decisions, no HTTP statuses, no notifications.
- Every function takes an `executor` (pool or transaction client) as the **first argument** so callers control transactions.
- Every query is scoped by `tenant_id` — this is the multi-tenant invariant; cross-tenant access must surface as "not found" (return null/false), never leak existence.
- Return plain values: a row or null, an array, a boolean for delete/exists, a Map for batched child loads (`loadParticipants(executor, ids, tenantId)` pattern).
- Dynamic PATCH updates: accept prebuilt `fields`/`values` fragments, append `updated_at = NOW()` and the WHERE bindings (see `updateRehearsalFields`).

### Validators (`server/validators/<resource>Validators.js`)
- Pure functions, no DB: `parseId`, allowed-value `Set`s (`VALID_STATUSES`), normalizers, and `buildXxxUpdateFields(body)` that turns an allowed-field whitelist into `{ fields, values }` SET fragments.

## Refactoring an existing fat route

1. Existing server tests are the regression suite — find them first (`grep -ril <resource> src/tests/server`); this is a behavior-preserving refactor, don't change responses, statuses, or error strings.
2. Extract in order: validators → repository (mechanical query moves) → service (handler bodies minus HTTP) → rewrite route thin.
3. Preserve exact error messages and status codes, including 404-not-403 for cross-tenant.
4. Run lint plus only the affected server test files (never the full ~8 min suite).

## New behavior

When adding backend behavior (not just refactoring), also add an isolation test in `src/tests/server/` proving cross-tenant reads/writes 404 — see CLAUDE.md "Multi-tenant isolation".
