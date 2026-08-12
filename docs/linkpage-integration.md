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

Editor handoffs are short-lived HMAC tokens with this payload:

```json
{"t":"handoff","slug":"new-band","slugRevision":4,"tenantId":123,"exp":0}
```

LinkBuddy owns compatibility for legacy handoffs without `slugRevision` and
must not allow an unversioned token to overwrite newer namespace state.
