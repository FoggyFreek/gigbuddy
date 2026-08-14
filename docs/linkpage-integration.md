# LinkBuddy integration contract

GigBuddy is authoritative for tenant identity and the current band slug.
`tenants.id` is the stable cross-service identity; slugs are mutable routing
data. A slug change commits locally with a monotonically increasing
`slug_revision` and a durable outbox row before GigBuddy contacts LinkBuddy.

GigBuddy delivers the oldest unresolved revision for a tenant to:

```http
PUT /api/integrations/gigbuddy/tenants/:tenantId/slug
Authorization: Bearer <LINKPAGE_SECRET>
Content-Type: application/json

{"oldSlug":"old-band","newSlug":"new-band","revision":4}
```

GigBuddy uses the public `LINKPAGE_URL` origin for this server-to-server call.
Successful machine codes are `applied`,
`already_applied`, `no_pages`, and `stale_ignored`. Conflicts
(`slug_conflict`, `revision_gap`), transport errors, malformed responses, and
server errors remain pending and retry with capped exponential backoff.

## Statistics read

The same shared secret authenticates two reads that back GigBuddy's dashboard
tile. First the tenant's pages, so the tile can offer a picker when a band has
more than one:

```http
GET /api/integrations/gigbuddy/tenants/:tenantId/pages
Authorization: Bearer <LINKPAGE_SECRET>

{"pages":[{"id":8,"slug":"the-band","pageType":"main","release":null,"publishedAt":"2026-07-01T10:00:00.000Z"},
          {"id":9,"slug":"the-band/single","pageType":"release","release":{"songId":3,"title":"New Single"},"publishedAt":null}]}
```

Then the statistics for one of them — the main page unless `pageId` names
another:

```http
GET /api/integrations/gigbuddy/tenants/:tenantId/stats?days=7&pageId=9
Authorization: Bearer <LINKPAGE_SECRET>
```

`pageId` is looked up **scoped to the tenant**, so a page belonging to another
tenant is a 404 `page_not_found`, indistinguishable from one that does not
exist. LinkBuddy clamps `days` into `[1, the page's plan window]` and answers
200 with either `{"hasPage": false}` (the tenant has no link page yet — not an
error) or:

```json
{"hasPage":true,"pageId":8,"slug":"the-band","days":7,"retentionDays":30,"enabled":true,
 "totalViews":200,"uniqueVisits":120,"totalClicks":50,"clickThroughRate":25,
 "byDay":[{"day":"2026-08-01","views":12,"clicks":{"platform":3,"shop":1}}]}
```

`byDay` carries only days with activity, and `clicks` is keyed by *click kind*
— the part of a stored click target before the colon (`platform`, `song`,
`link`, `embed`, `share`, `social`, `shop`, `other`). Kinds are machine keys:
GigBuddy owns their display labels and colours, so neither side has to
translate for the other. The response is deliberately summary-only — the
per-device / per-country / per-source breakdowns never leave LinkBuddy.

GigBuddy re-validates the whole payload before use and degrades to a 502
"statistics unavailable" rather than rendering anything it can't verify.

The two reads share a rate-limit bucket of their own, separate from the slug
sync's, so a busy hour of dashboard views can never exhaust the budget the
outbox depends on to converge.

### Isolation contract

The shared secret authenticates *GigBuddy*, not a band. **The `:tenantId` path
segment is therefore the entire isolation boundary**, and both sides own one
half of keeping it sound:

- **GigBuddy** puts `req.tenantId` — the session's active tenant, backed by an
  approved membership — on the wire, and nothing else. No query parameter,
  header or body field can name a different tenant.
- **LinkBuddy** scopes every page lookup by `gigbuddy_tenant_id`, so a
  `pageId` is never an authorization token: one belonging to another tenant
  resolves to nothing and 404s.

Both halves are covered by regression tests that fail if either is dropped:
`test/integrationTenantIsolation.test.js` in LinkBuddy, and the
"linkpage statistics tenant isolation" suite in `src/tests/server/linkpage.test.js`
in GigBuddy.

Editor handoffs are short-lived HMAC tokens with this payload:

```json
{"t":"handoff","slug":"new-band","slugRevision":4,"tenantId":123,"exp":0}
```

LinkBuddy owns compatibility for legacy handoffs without `slugRevision` and
must not allow an unversioned token to overwrite newer namespace state.
