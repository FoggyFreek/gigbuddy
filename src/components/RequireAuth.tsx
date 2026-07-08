import { Navigate, Outlet, useLocation } from 'react-router-dom'
import CircularProgress from '@mui/material/CircularProgress'
import Box from '@mui/material/Box'
import { useAuth } from '../contexts/authContext.ts'

export default function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()

  if (user === undefined) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }
  // No redirect stashing here: AuthContext's 401 handler owns that (it knows
  // whether the user is logging out). Stashing in render would also fire on
  // the intermediate logout render (user already null, location not yet
  // /login), resurrecting the stash logout just cleared.
  if (user === null) {
    return <Navigate to="/login" replace />
  }
  if (user.status === 'rejected') return <Navigate to="/pending" replace />

  if (user.isSuperAdmin) return <Outlet />

  const memberships = user.memberships || []
  const hasApproved = memberships.some((m) => m.status === 'approved')
  if (hasApproved) return <Outlet />

  if (location.pathname === '/redeem-invite') return <Outlet />

  if (memberships.length === 0) {
    return <Navigate to="/redeem-invite" replace />
  }
  return <Navigate to="/pending" replace />
}
