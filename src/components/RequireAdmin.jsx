import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/authContext.js'

export default function RequireAdmin() {
  const { user } = useAuth()

  if (!user?.isAdmin) return <Navigate to="/" replace />
  return <Outlet />
}
