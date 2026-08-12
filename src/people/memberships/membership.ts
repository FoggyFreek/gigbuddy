// Typed frontend accessor over shared/membership.js, so the request-note cap
// and the provenance values can't drift between the two sides.
import {
  MEMBERSHIP_SOURCES as MEMBERSHIP_SOURCES_JS,
  MAX_REQUEST_MESSAGE_LENGTH as MAX_REQUEST_MESSAGE_LENGTH_JS,
} from '../../../shared/membership.js'

/** How a membership came to exist. `legacy` predates the column. */
export type MembershipSource = 'invite' | 'request' | 'admin' | 'owner' | 'legacy'

/** Whether a band can be found in the directory and asked to join. */
export type JoinPolicy = 'invite_only' | 'request'

export const MEMBERSHIP_SOURCES = MEMBERSHIP_SOURCES_JS as Record<string, MembershipSource>
export const MAX_REQUEST_MESSAGE_LENGTH = MAX_REQUEST_MESSAGE_LENGTH_JS as number
