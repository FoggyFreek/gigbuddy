---
name: collection-scoping
description: Scoping contract for collection reads — bounded (`limit`), windowed (`from`/`to` date range), and cursor-paged ("load more") list endpoints, the `{ items, meta }` envelope, shared parsers, and SQL predicates. Use when adding or changing any endpoint that returns a list of resources, adding pagination or a "load more" button, or any frontend fetch of a collection (dashboard feeds, calendar month views, search).
user-invocable: false
---

# Collection scoping: bounded and windowed fetches

**The invariant**: new list endpoints are never unbounded by default. The server validates the requested scope, applies it, and echoes it back in `meta`. Client-supplied scope is a contract, not a suggestion — malformed scope is a 400, never silently clamped or ignored (exception: `parseSearchLimit`, which deliberately clamps for search-as-you-type).

There are **two orthogonal scoping axes**. Pick the one that matches the question the UI asks — never mix them on one endpoint:

| Axis | Question | Params | Used by |
|---|---|---|---|
| **Bounded** | "the first N by relevance" — completeness does not matter | `?limit=N` | dashboard feeds (`/upcoming`) |
| **Windowed** | "everything in this period" — completeness matters, dropping an item is a bug | `?from=YYYY-MM-DD&to=YYYY-MM-DD` | calendar month views (`/range`) |

A **deep bounded** feed ("load more") is the bounded axis plus a keyset cursor — see its own
section below. It is never offset pagination.

## Bounded feeds (`?limit=`)

Canonical example: the gigs `/upcoming` stack (`server/planning/gigs/gigs.js` → `gigService.listUpcomingGigs` → `gigRepository.listUpcomingGigs`).

- **Parser**: `parseListLimit` in `server/validators/common.js`. Strict — omitted → `DEFAULT_LIST_LIMIT` (10), malformed or > `MAX_LIST_LIMIT` (100) → `null`. Never re-implement limit parsing. **Gotcha**: the default ignores a caller-supplied `maxLimit`, so an omitted `?limit=` always yields 10 — an endpoint whose real cap is higher silently truncates unless the client sends a limit.
- **Service**: one-liner through `limitedCollection(query.limit, (limit) => …Rows(db, tenantId, limit))` from `server/platform/collections/limitedCollectionService.js`. It handles the 400 and builds the envelope.
- **SQL**: tenant-scoped, `LIMIT $n` bound as a parameter, future-only filters use `CURRENT_DATE`.

## Windowed reads (`?from=&to=`)

Canonical example: the gigs `/range` stack (same files as `/upcoming`; frontend `src/planning/gigs/gigs.ts` `listGigsInRange`).

- **Parser**: `parseDateRange` in `server/validators/common.js`. Both params required (an omitted bound would be an unbounded scan), strict `YYYY-MM-DD` real calendar dates, `from <= to`; anything else → `null` → 400.
- **Service**: one-liner through `windowedCollection(query, (range) => …Rows(db, tenantId, range.from, range.to))` from `server/platform/collections/limitedCollectionService.js`.
- **No `LIMIT`** on windowed queries — a month view that silently dropped rows would be wrong.
- The frontend computes month windows with the existing `monthBounds()` helper (availability utils); don't hand-roll month math.

## Deep bounded feeds ("load more") — keyset cursor, never offset

**Deep bounded feeds use a keyset cursor, never offset/page params.**

- **Parser**: `parseListCursor` (`server/validators/common.js`, alongside the shared
  `INVALID_CURSOR` / `INVALID_TODAY` messages), keyed on the same `(date, id)` tuple the
  repository's `ORDER BY … DESC, id DESC` tiebreaks on.
- **Service**: `limitedCollectionWithCursor` from
  `server/platform/collections/limitedCollectionService.js`.
- **Frontend types**: `LimitedCollectionWithCursorResponse<T>` / `ListCollectionCursor` in
  `src/types/api.ts`.
- Reference implementation: `GET /gigs/past`.

**A feed ordered by a `TIMESTAMPTZ` needs the twin** — `parseTimestampCursor` /
`limitedCollectionWithTimestampCursor`, one opaque `?cursor=` — because many rows share a
calendar day and a date cursor would skip or repeat them. Reference: the admin claim queue.

## Interval semantics — exactly two rules, never a third

- **Day-granularity API windows are inclusive**: `[from, to]`, "July 1st through July 31st". This matches availability and all `/range` endpoints.
- **Timestamp/finance ranges are half-open**: `[from, toExclusive)`, built by `server/utils/periodQuery.js`. Correct for timestamps (no `23:59:59` imprecision); leave finance as-is.

Do not switch an endpoint from one to the other, and do not invent a variant.

## SQL predicates (repository layer)

Mechanical rule by entity shape — always tenant-scoped, always `ORDER BY <date> ASC, id ASC` (the `id` tiebreak keeps ordering deterministic and makes a future cursor possible):

- **Point-in-time** (gigs `event_date`, rehearsals `proposed_date`): `date_col BETWEEN $from AND $to`
- **Interval** (band events `start_date`/`end_date`, availability slots): **overlap**, so multi-day items straddling the window boundary are included:
  `start_date <= $to AND COALESCE(end_date, start_date) >= $from`
  (drop the `COALESCE` when `end_date` is `NOT NULL`). Never use `BETWEEN` on an interval entity's start date — items that begin before the window but extend into it would vanish.

## Response envelope

Every scoped endpoint returns the same top-level shape — `items` plus a `meta` that echoes the scope the server actually applied:

- Bounded: `{ items, meta: { limit, returned } }`
- Windowed: `{ items, meta: { from, to, returned } }`
- Cursor-paged: bounded plus `meta.nextCursor` keyed on `(date, id)`

`limitedCollectionService.js` owns **every** envelope (`limitedCollection`,
`limitedCollectionWithTotal`, `limitedCollectionWithCursor`,
`limitedCollectionWithTimestampCursor`, `windowedCollection`): a service passes a fetcher
and enriches `result.items`, **never assembling `meta` by hand**.

Frontend types live in `src/types/api.ts` (`LimitedCollectionResponse<T>`, `WindowedCollectionResponse<T>`, `LimitedCollectionWithCursorResponse<T>`) — reuse, never redeclare. **Never add offset pagination.**

Bare-array list endpoints (`GET /gigs/` etc.) are legacy: don't add new ones, and when a consumer only needs a window or a bound, point it at a scoped endpoint instead of the full list.

## Route conventions

- Scoped reads are sibling routes: `/upcoming` (bounded), `/range` (windowed). Register them **before** `/:id` param routes.
- Route handlers stay thin per the **backend-layering** skill: pass `req.query` to the service, `sendError` on `result.error`, `res.json(result)` otherwise.

## Tests every new scoped endpoint needs

In `src/tests/server/` (see CLAUDE.md for how to run targeted backend tests):

1. Scope validation: malformed `limit` / `from`/`to` (non-ISO, `from > to`, missing bound) → 400; omitted `limit` → default.
2. Boundary semantics: an item exactly on `from` and one exactly on `to` are included; for interval entities, an item straddling `from` is included.
3. Envelope: `meta` echoes the applied scope and `returned === items.length`.
4. **Tenant isolation**: the other seeded tenant's rows never appear in the window/feed.
