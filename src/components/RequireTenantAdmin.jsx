import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/authContext.js'

export default function RequireTenantAdmin() {
  const { user } = useAuth()
  const isTenantAdmin =
    user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'
  if (!isTenantAdmin) return <Navigate to="/" replace />
  return <Outlet />
}
