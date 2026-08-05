// Tenant-kind applicability is defined here once and consumed by both the
// backend (authoritative gates) and frontend (visibility/wording). Shared
// domains are absent from this registry: planning, contacts, profile, storage
// and finance work for every tenant kind by default.

export const TENANT_CAPABILITIES = Object.freeze({
  BAND_ROSTER: 'band_roster',
  BAND_MEMBERSHIP_ADMIN: 'band_membership_admin',
  BAND_AVAILABILITY: 'band_availability',
  SETLISTS: 'setlists',
  MERCH: 'merch',
  BAND_DISCOVERY: 'band_discovery',
  BAND_PROMOTION_INTEGRATIONS: 'band_promotion_integrations',
  EXTERNAL_ENSEMBLES: 'external_ensembles',
  ARTIST_CALENDAR: 'artist_calendar',
})

export const TENANT_CAPABILITY_KEYS = Object.freeze(Object.values(TENANT_CAPABILITIES))

const CAPABILITIES_BY_KIND = Object.freeze({
  band: new Set([
    TENANT_CAPABILITIES.BAND_ROSTER,
    TENANT_CAPABILITIES.BAND_MEMBERSHIP_ADMIN,
    TENANT_CAPABILITIES.BAND_AVAILABILITY,
    TENANT_CAPABILITIES.SETLISTS,
    TENANT_CAPABILITIES.MERCH,
    TENANT_CAPABILITIES.BAND_DISCOVERY,
    TENANT_CAPABILITIES.BAND_PROMOTION_INTEGRATIONS,
  ]),
  personal: new Set([
    TENANT_CAPABILITIES.EXTERNAL_ENSEMBLES,
    TENANT_CAPABILITIES.ARTIST_CALENDAR,
  ]),
})

export function tenantKindSupports(kind, capability) {
  return TENANT_CAPABILITY_KEYS.includes(capability)
    && CAPABILITIES_BY_KIND[kind]?.has(capability) === true
}
