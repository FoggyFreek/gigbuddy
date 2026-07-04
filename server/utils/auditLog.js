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
 * Additional fields come from the `extra` argument but are restricted to a
 * whitelist (SAFE_EXTRA_KEYS) so callers can't inject arbitrary, potentially
 * user-controlled data into structured logs. Whitelisted keys may override the
 * defaults above — that is intentional (e.g. logout supplies a pre-captured
 * `userId` after the session has been destroyed; the redeem flow supplies a
 * `tenantId` because there is no active tenant in the request context yet).
 */
const SAFE_EXTRA_KEYS = new Set([
  'userId',
  'email',
  'targetUserId',
  'targetEmail',
  'tenantId',
  'fromTenantId',
  'toTenantId',
  'inviteId',
  'membershipId',
  'role',
  'status',
  'reason',
  'expiresAt',
  'planId',
  'planSlug',
  'ownerUserId',
])

export function sanitizeAuditExtra(extra = {}) {
  return Object.fromEntries(
    Object.entries(extra).filter(([key]) => SAFE_EXTRA_KEYS.has(key)),
  )
}

export function auditLog(req, action, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    action,
    userId: req?.session?.userId ?? null,
    tenantId: req?.tenantId ?? null,
    ip: req?.ip ?? null,
    ...sanitizeAuditExtra(extra),
  }))
}
