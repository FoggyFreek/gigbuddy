// The caller's approved tenants, prepared once per request by
// resolveMemberTenantIds and handed down to the cross-tenant reads. Building
// the index in the middleware keeps the services from rebuilding it per call —
// and keeps `ids` the only tenant set they can reach, so nothing downstream can
// widen the scope.

// What every cross-tenant row carries so the UI can say which band it belongs
// to and link into that tenant. An id outside the scope blanks rather than
// throws: it can only arrive from a bug, and a half-rendered agenda beats a
// 500 — but it must never invent a name.
function tenantRef(byId, tenantId) {
  const tenant = byId.get(tenantId)
  return {
    tenantId,
    tenantName: tenant?.displayName ?? null,
    tenantAvatarPath: tenant?.avatarPath ?? null,
    kind: tenant?.kind ?? null,
  }
}

export function memberTenantScope(tenants) {
  const byId = new Map(tenants.map((t) => [t.tenantId, t]))
  const ref = (tenantId) => tenantRef(byId, tenantId)

  return {
    ids: tenants.map((t) => t.tenantId),
    byId,
    ref,
    // Labels a row with the band it came from. The name comes from the
    // membership rows, so no query joins `tenants` just to render one.
    label: (row) => ({ ...row, ...ref(row.tenant_id) }),
  }
}
