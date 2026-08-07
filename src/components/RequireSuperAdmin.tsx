import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../contexts/authContext.ts'

export default function RequireSuperAdmin() {
  const { user } = useAuth()
  if (!user?.isSuperAdmin) return <Navigate to="/" replace />
  return <Outlet />
}
