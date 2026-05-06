import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/authContext.js'

export default function RequireSuperAdmin() {
  const { user } = useAuth()
  if (!user?.isSuperAdmin) return <Navigate to="/" replace />
  return <Outlet />
}
