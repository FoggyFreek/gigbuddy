/**
 * Structured audit logger for security-sensitive operations.
 *
 * Writes a single JSON line to stdout on every call. Log aggregation systems
 * (ELK, Datadog, etc.) can parse these lines by the `action` field.
 *
 * Fields always present:
 *   ts        — ISO-8601 timestamp
 *   action    — dot-namespaced event name (e.g. "auth.login", "invite.redeem")
 *   userId    — session user id, or null for unauthenticated events
 *   tenantId  — active tenant id from req.tenantId, or null
 *   ip        — client IP (Express req.ip, respects trust proxy setting)
 *
 * Additional fields are merged from the `extra` argument and override the
 * defaults above, which is intentional — callers can supply a pre-captured
 * userId for events where the session has already been destroyed (logout).
 */
export function auditLog(req, action, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    action,
    userId: req?.session?.userId ?? null,
    tenantId: req?.tenantId ?? null,
    ip: req?.ip ?? null,
    ...extra,
  }))
}
