// Role → permission matrix for the frontend. The runtime values come from the
// single source of truth in `shared/permissions.js` (the server imports the same
// file via `server/auth/permissions.js`), so the two can never drift — a parity
// test in `src/tests/permissions.test.jsx` still guards it. This wrapper only
// adds the TypeScript types the frontend uses. The active tenant's permissions
// also arrive on the /auth/me payload (`user.permissions`); this matrix is the
// fallback and powers tenant-switch previews.
//
// `Object.freeze` in the shared file lets tsc infer the precise string-literal
// types below, so `Permission`/`Role` stay strict unions, not `string`.

export {
  ROLES,
  ASSIGNABLE_ROLES,
  ALL_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  hasPermission,
  permissionsForRole,
} from '../../shared/permissions.js'

import { PERMISSIONS as PERMISSIONS_VALUES, ROLES as ROLES_VALUES } from '../../shared/permissions.js'

export type Permission = (typeof PERMISSIONS_VALUES)[keyof typeof PERMISSIONS_VALUES]
export type Role = (typeof ROLES_VALUES)[keyof typeof ROLES_VALUES]
