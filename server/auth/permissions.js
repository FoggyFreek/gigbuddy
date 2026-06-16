// Static role → permission matrix. This is the single source of truth for what
// each tenant role may do. The frontend mirrors it in `src/auth/permissions.ts`
// (a parity test keeps them in sync). Tenant isolation is enforced separately
// (every query is tenant-scoped); permissions decide *capability* within a tenant.
//
// Roles live on `memberships.role`. `member` is a legacy alias that behaves
// exactly like `contributor` (locked product decision — members lose finance
// access, no data backfill needed). Super admins bypass every check.

export const ROLES = Object.freeze({
  READER: 'reader',
  CONTRIBUTOR: 'contributor',
  FINANCIAL_ADMIN: 'financial_admin',
  TENANT_ADMIN: 'tenant_admin',
})

// Roles a tenant admin (or super admin) may assign. Promotion to `tenant_admin`
// stays super-admin-only and is enforced in the membership/invite services.
export const ASSIGNABLE_ROLES = new Set([
  ROLES.READER,
  ROLES.CONTRIBUTOR,
  ROLES.FINANCIAL_ADMIN,
])

// Every role accepted on a membership/invite (incl. the legacy `member` alias).
export const ALL_ROLES = new Set([
  ROLES.READER,
  ROLES.CONTRIBUTOR,
  'member',
  ROLES.FINANCIAL_ADMIN,
  ROLES.TENANT_ADMIN,
])

export const PERMISSIONS = Object.freeze({
  APP_VIEW: 'app.view', // view all non-finance resources
  TASK_COMPLETE_SELF: 'task.complete.self', // mark own assigned task done
  REHEARSAL_RESPOND_SELF: 'rehearsal.respond.self', // vote on own participation
  PLANNING_WRITE: 'planning.write', // create/edit any planning resource
  PURCHASE_CREATE: 'purchase.create', // create purchases + view own purchases
  FINANCE_VIEW: 'finance.view', // read finance (invoices, ledger, reports, …)
  FINANCE_MANAGE: 'finance.manage', // mutate finance
  MEMBERS_MANAGE: 'members.manage', // memberships, roles, invites
  TENANT_MANAGE: 'tenant.manage', // tenant-level settings reserved to admins
})

const READER = new Set([
  PERMISSIONS.APP_VIEW,
  PERMISSIONS.TASK_COMPLETE_SELF,
  PERMISSIONS.REHEARSAL_RESPOND_SELF,
])

const CONTRIBUTOR = new Set([
  ...READER,
  PERMISSIONS.PLANNING_WRITE,
  PERMISSIONS.PURCHASE_CREATE,
])

const FINANCIAL_ADMIN = new Set([
  ...CONTRIBUTOR,
  PERMISSIONS.FINANCE_VIEW,
  PERMISSIONS.FINANCE_MANAGE,
])

const TENANT_ADMIN = new Set([
  ...FINANCIAL_ADMIN,
  PERMISSIONS.MEMBERS_MANAGE,
  PERMISSIONS.TENANT_MANAGE,
])

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.READER]: READER,
  [ROLES.CONTRIBUTOR]: CONTRIBUTOR,
  member: CONTRIBUTOR, // legacy alias → contributor
  [ROLES.FINANCIAL_ADMIN]: FINANCIAL_ADMIN,
  [ROLES.TENANT_ADMIN]: TENANT_ADMIN,
})

export const ALL_PERMISSIONS = Object.values(PERMISSIONS)

// The one authorization predicate. Super admins are allowed everything.
export function hasPermission(role, key, { isSuperAdmin = false } = {}) {
  if (isSuperAdmin) return true
  return ROLE_PERMISSIONS[role]?.has(key) ?? false
}

// The flat list of permission keys for a role — sent to the client on /auth/me
// so the frontend doesn't have to re-derive the active tenant's capabilities.
export function permissionsForRole(role, { isSuperAdmin = false } = {}) {
  if (isSuperAdmin) return [...ALL_PERMISSIONS]
  return [...(ROLE_PERMISSIONS[role] ?? [])]
}
