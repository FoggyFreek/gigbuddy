// The role → permission matrix is defined once in `shared/permissions.js` and
// imported by both the server and the frontend (`src/auth/permissions.ts`), so
// the two can never drift. This file is a stable import path for server code
// (`server/...` imports `../auth/permissions.js`); it only re-exports the shared
// source of truth.
export {
  ROLES,
  ASSIGNABLE_ROLES,
  WRITE_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  hasPermission,
  permissionsForRole,
} from '../../shared/permissions.js'
