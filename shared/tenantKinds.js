// What a tenant represents. Mirrors the CHECK in migration 159_tenant_kind.sql.
export const TENANT_KINDS = Object.freeze(
  /** @type {const} */ (['band', 'personal']),
)

export const DEFAULT_TENANT_KIND = TENANT_KINDS[0]
