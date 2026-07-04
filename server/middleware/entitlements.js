// Entitlement gates. Mount after the `requireApproved` → `resolveTenantId`
// chain so `req.tenantId` (and `req.tenantOwnerUserId`) are populated.
//
// A tenant without an owner resolves to null entitlements and passes every
// gate — enforcement is fully skipped for legacy tenants until ownership is
// assigned. Denials return 403 { code: 'entitlement_required', feature } so
// the frontend can show an upgrade prompt instead of a generic error.
import pool from '../db/index.js'
import { resolveTenantEntitlements } from '../services/entitlementService.js'

// Resolves (and memoizes per request) the active tenant's entitlements.
export function loadEntitlements(req) {
  if (req._entitlementsPromise === undefined) {
    req._entitlementsPromise = resolveTenantEntitlements(pool, req.tenantId, {
      ownerUserId: req.tenantOwnerUserId ?? null,
    })
  }
  return req._entitlementsPromise
}

// Inline predicate for handlers that gate a single field or branch (same
// semantics as the middleware): true when the feature is available or the
// tenant is ownerless.
export async function hasEntitledFeature(req, feature) {
  const resolved = await loadEntitlements(req)
  return resolved === null || resolved.entitlements.features[feature] === true
}

function deny(res, feature) {
  res.status(403).json({
    error: 'This feature is not included in the current subscription plan',
    code: 'entitlement_required',
    feature,
  })
}

export function requireEntitlement(feature) {
  return async (req, res, next) => {
    try {
      if (await hasEntitledFeature(req, feature)) return next()
      deny(res, feature)
    } catch (err) {
      next(err)
    }
  }
}

// Reads survive, writes are blocked — the finance read-only mode. GET/HEAD/
// OPTIONS pass through; every other method requires the feature.
export function requireEntitlementForWrites(feature) {
  return async (req, res, next) => {
    try {
      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
      if (await hasEntitledFeature(req, feature)) return next()
      deny(res, feature)
    } catch (err) {
      next(err)
    }
  }
}
