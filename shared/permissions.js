// Single source of truth for the role → permission matrix, shared by the server
// (`server/auth/permissions.js` re-exports this) and the frontend
// (`src/auth/permissions.ts` re-exports this and layers the TS types on top).
// Authored as plain `.js` because the server runs ESM directly with no build
// step — same pattern as `shared/purchaseTotals.js`. `Object.freeze` on the
// literal objects lets the frontend's `tsc` (allowJs) infer the precise
// `Permission`/`Role` string-literal unions from this file.
//
// Tenant isolation is enforced separately (every query is tenant-scoped);
// permissions decide *capability* within a tenant.
//
// Roles live on `memberships.role`. Super admins bypass every check.

export const ROLES = Object.freeze({
  READER: 'reader',
  CONTRIBUTOR: 'contributor',
  FINANCIAL_ADMIN: 'financial_admin',
  TENANT_ADMIN: 'tenant_admin',
})

// Roles a tenant admin (or super admin) may assign. Promotion to `tenant_admin`
// stays super-admin-only and is enforced in the membership/invite services.
export const ASSIGNABLE_ROLES = Object.freeze([
  ROLES.READER,
  ROLES.CONTRIBUTOR,
  ROLES.FINANCIAL_ADMIN,
])

// Every canonical role accepted on a membership/invite.
export const WRITE_ROLES = Object.freeze(Object.values(ROLES))

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
