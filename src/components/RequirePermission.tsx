import { Navigate, Outlet } from 'react-router-dom'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Permission } from '../auth/permissions.ts'

interface RequirePermissionProps {
  permission: Permission
}

// Route guard: renders the nested routes only when the active tenant role grants
// `permission`, otherwise redirects home. The API enforces the same gate — this
// is presentation. Use as <Route element={<RequirePermission permission="finance.view" />}>.
export default function RequirePermission({ permission }: RequirePermissionProps) {
  const { can } = usePermissions()
  if (!can(permission)) return <Navigate to="/" replace />
  return <Outlet />
}
