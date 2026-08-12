import {
  BAND_MEMBER_ROLES as ROLE_VALUES,
  BAND_MEMBER_ROLE_OPTIONS as ROLE_OPTIONS,
} from '../../../shared/bandMemberRoles.js'

export { BAND_MEMBER_ROLES } from '../../../shared/bandMemberRoles.js'

export type BandMemberRole = (typeof ROLE_VALUES)[keyof typeof ROLE_VALUES]

export const BAND_MEMBER_ROLE_OPTIONS = ROLE_OPTIONS as readonly BandMemberRole[]
