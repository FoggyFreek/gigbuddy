// Server-side membership rules. The values the frontend also needs (provenance,
// join policies, the note cap) live in shared/membership.js and are re-exported
// here so server code has one import path — same pattern as
// server/auth/entitlements.js over shared/entitlements.js.
export {
  MEMBERSHIP_SOURCES,
  MEMBERSHIP_SOURCE_VALUES,
  JOIN_POLICIES,
  isKnownJoinPolicy,
  MAX_REQUEST_MESSAGE_LENGTH,
} from '../../shared/membership.js'

// How many bands an artist may have outstanding join requests with at once.
//
// This cap is NOT plan-derived, unlike the caps in limitService. It must never
// read entitlements and must never be presented as something an upgrade lifts —
// it exists so a declined-or-ignored request can't be sprayed across the
// directory. Its error code deliberately sits outside the `*_limit_reached`
// family the billing UI reacts to. Enforcement-only, so it stays off `shared/`.
export const MAX_OPEN_JOIN_REQUESTS = 3
