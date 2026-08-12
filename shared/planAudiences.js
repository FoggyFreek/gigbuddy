// Subscription plans are two independent PRODUCTS, not one ladder. A
// subscription is bound to its audience for life — there is no cross-audience
// upgrade or downgrade in either direction, and a user may hold one live
// subscription per audience at the same time.
//
// Tenant kind selects which audience governs a tenant's entitlements: a band
// resolves through its owner's band subscription, a personal workspace through
// their artist subscription.

export const PLAN_AUDIENCES = Object.freeze({ BAND: 'band', ARTIST: 'artist' })

export const PLAN_AUDIENCE_KEYS = Object.freeze(Object.values(PLAN_AUDIENCES))

const AUDIENCE_BY_TENANT_KIND = Object.freeze({
  band: PLAN_AUDIENCES.BAND,
  personal: PLAN_AUDIENCES.ARTIST,
})

const TENANT_KINDS_BY_AUDIENCE = Object.freeze({
  [PLAN_AUDIENCES.BAND]: Object.freeze(['band']),
  [PLAN_AUDIENCES.ARTIST]: Object.freeze(['personal']),
})

export function isPlanAudience(value) {
  return PLAN_AUDIENCE_KEYS.includes(value)
}

// Throws rather than defaulting: a caller that failed to load the tenant's kind
// would otherwise be handed band entitlements for a personal workspace, which
// is exactly the leak the audience split exists to prevent. A missing kind is a
// bug at the call site, not a case to absorb here.
export function audienceForTenantKind(kind) {
  const audience = AUDIENCE_BY_TENANT_KIND[kind]
  if (audience === undefined) {
    throw new Error(`Unknown tenant kind for plan audience: ${String(kind)}`)
  }
  return audience
}

// Which tenant kinds an audience's subscription governs — the scope of its
// downgrade blockers and of its purge.
export function tenantKindsForAudience(audience) {
  return TENANT_KINDS_BY_AUDIENCE[audience] ?? []
}
