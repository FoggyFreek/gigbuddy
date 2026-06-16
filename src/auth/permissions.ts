// Frontend mirror of server/auth/permissions.js. Keep the two in lockstep — a
// unit test asserts parity (src/tests/permissions.test.jsx). The active tenant's
// permissions also arrive on the /auth/me payload (user.permissions); this matrix
// is used as the fallback and for tenant-switch previews.

export const ROLES = {
  READER: 'reader',
  CONTRIBUTOR: 'contributor',
  FINANCIAL_ADMIN: 'financial_admin',
  TENANT_ADMIN: 'tenant_admin',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

// Roles a tenant admin (or super admin) may assign via the members UI.
export const ASSIGNABLE_ROLES: readonly string[] = [
  ROLES.READER,
  ROLES.CONTRIBUTOR,
  ROLES.FINANCIAL_ADMIN,
]

export const PERMISSIONS = {
  APP_VIEW: 'app.view',
  TASK_COMPLETE_SELF: 'task.complete.self',
  REHEARSAL_RESPOND_SELF: 'rehearsal.respond.self',
  PLANNING_WRITE: 'planning.write',
  PURCHASE_CREATE: 'purchase.create',
  FINANCE_VIEW: 'finance.view',
  FINANCE_MANAGE: 'finance.manage',
  MEMBERS_MANAGE: 'members.manage',
  TENANT_MANAGE: 'tenant.manage',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

const READER: Permission[] = [
  PERMISSIONS.APP_VIEW,
  PERMISSIONS.TASK_COMPLETE_SELF,
  PERMISSIONS.REHEARSAL_RESPOND_SELF,
]

const CONTRIBUTOR: Permission[] = [
  ...READER,
  PERMISSIONS.PLANNING_WRITE,
  PERMISSIONS.PURCHASE_CREATE,
]

const FINANCIAL_ADMIN: Permission[] = [
  ...CONTRIBUTOR,
  PERMISSIONS.FINANCE_VIEW,
  PERMISSIONS.FINANCE_MANAGE,
]

const TENANT_ADMIN: Permission[] = [
  ...FINANCIAL_ADMIN,
  PERMISSIONS.MEMBERS_MANAGE,
  PERMISSIONS.TENANT_MANAGE,
]

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS)

export const ROLE_PERMISSIONS: Record<string, Set<Permission>> = {
  [ROLES.READER]: new Set(READER),
  [ROLES.CONTRIBUTOR]: new Set(CONTRIBUTOR),
  member: new Set(CONTRIBUTOR), // legacy alias → contributor
  [ROLES.FINANCIAL_ADMIN]: new Set(FINANCIAL_ADMIN),
  [ROLES.TENANT_ADMIN]: new Set(TENANT_ADMIN),
}

interface RoleContext {
  isSuperAdmin?: boolean
}

export function hasPermission(
  role: string | null | undefined,
  key: Permission,
  { isSuperAdmin = false }: RoleContext = {},
): boolean {
  if (isSuperAdmin) return true
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.has(key) ?? false
}

export function permissionsForRole(
  role: string | null | undefined,
  { isSuperAdmin = false }: RoleContext = {},
): Permission[] {
  if (isSuperAdmin) return [...ALL_PERMISSIONS]
  if (!role) return []
  return [...(ROLE_PERMISSIONS[role] ?? [])]
}
