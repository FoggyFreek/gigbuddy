// Membership rules both sides need: how a membership came to exist, whether a
// band can be found in the directory, and the cap on the requester's note.
// Authored as plain `.js` for the same reason as shared/permissions.js — the
// server runs ESM directly with no build step.
//
// The outstanding-request cap is deliberately NOT here: it is enforcement-only
// and lives in server/domain/membership.js.

// Mirrors the CHECK in migration 161_band_directory.sql. `legacy` is the
// backfill value for rows that predate the column.
export const MEMBERSHIP_SOURCES = Object.freeze({
  INVITE: 'invite',
  REQUEST: 'request',
  ADMIN: 'admin',
  OWNER: 'owner',
  LEGACY: 'legacy',
})

export const MEMBERSHIP_SOURCE_VALUES = Object.freeze(Object.values(MEMBERSHIP_SOURCES))

// Whether a band may be found in the directory and asked to join. Defaults to
// invite_only, so no existing band becomes findable without a deliberate act.
export const JOIN_POLICIES = Object.freeze(['invite_only', 'request'])

export function isKnownJoinPolicy(value) {
  return typeof value === 'string' && JOIN_POLICIES.includes(value)
}

// Ceiling on the artist's note to a band. Free text from a stranger the band
// has not accepted yet: plain text only, never rendered as HTML or markdown,
// never in a push payload, an email, or a log line.
export const MAX_REQUEST_MESSAGE_LENGTH = 500
