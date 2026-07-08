import { Navigate, Outlet, useLocation } from 'react-router-dom'
import CircularProgress from '@mui/material/CircularProgress'
import Box from '@mui/material/Box'
import { useAuth } from '../contexts/authContext.ts'
import { TERMS_VERSION } from '../../shared/termsVersion.js'
import { TERMS_EXEMPT_PATHS } from '../constants/termsExemptPaths.ts'

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
  // Super admins are deliberately exempt so terms publication cannot lock
  // the application's recovery administrators out.
  if (user.isSuperAdmin) return <Outlet />

  // Terms gate: any approved member must be on the CURRENT terms version — this
  // is what re-prompts everyone after a TERMS_VERSION bump, and closes the
  // gap where invite-approved users never accepted terms at all. The exempt
  // paths above are where acceptance actually happens, so they pass through.
  const needsTerms = (user.termsVersion ?? null) !== TERMS_VERSION
  const termsBlocked = needsTerms && !TERMS_EXEMPT_PATHS.has(location.pathname)
  const termsRedirect = <Navigate to="/accept-terms" replace state={{ from: location }} />

  const memberships = user.memberships || []
  const hasApproved = memberships.some((m) => m.status === 'approved')
  if (hasApproved) return termsBlocked ? termsRedirect : <Outlet />

  if (location.pathname === '/redeem-invite') return <Outlet />

  // /onboarding is for users who have no band yet (approved members reach it
  // via the hasApproved pass-through above, for the checkout return). A
  // pending-only user is mid-approval — onboarding must not bypass that.
  if (memberships.length === 0) {
    if (location.pathname === '/onboarding') return <Outlet />
    return <Navigate to="/onboarding" replace />
  }
  return <Navigate to="/pending" replace />
}
