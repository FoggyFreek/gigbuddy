// Constants for the global band-profile domain.
//
// These caps are enforcement-only and deliberately not plan-derived: no
// subscription lifts them, so they sit outside the `*_limit_reached` error
// family (the same reasoning as MAX_OPEN_JOIN_REQUESTS in ./membership.js).
// They exist to bound abuse of a globally visible table, not to sell anything.

// A profile is a shared record of one real band, held by the handful of
// musicians who play in it. Five is generous for that and small enough that the
// claim-approval notification fan-out needs no batching at all.
export const MAX_HOLDERS_PER_PROFILE = 5

// How many profiles one user may author. Bounds drive-by spam without getting
// in the way of a working musician.
export const MAX_BAND_PROFILES_PER_USER = 20

// How many bands one personal workspace may track.
export const MAX_MY_BANDS_PER_TENANT = 50

export const MAX_CLAIM_MESSAGE_LENGTH = 500
export const MAX_DECISION_REASON_LENGTH = 500

export const MAX_BAND_PROFILE_NAME_LENGTH = 200
export const MAX_BAND_PROFILE_URL_LENGTH = 500

// Removing a band from My Bands leaves its events behind by default. Deleting
// them is destructive and always an explicit choice.
export const MY_BAND_REMOVAL_MODES = Object.freeze({ KEEP: 'keep', DELETE: 'delete' })
export const DEFAULT_REMOVAL_MODE = MY_BAND_REMOVAL_MODES.KEEP

export const CLAIM_STATUSES = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
})

// Derived, never stored — see migration 168.
export const BAND_PROFILE_STATUSES = Object.freeze({
  CLAIMABLE: 'claimable',
  PENDING_CLAIM: 'pending_claim',
  CLAIMED: 'claimed',
})
