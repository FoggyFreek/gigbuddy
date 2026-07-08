import { Navigate, Outlet } from 'react-router-dom'
import { useEntitlements } from '../hooks/useEntitlements.ts'
import type { Feature } from '../auth/entitlements.ts'

interface RequireEntitlementProps {
  feature: Feature
}

// Route guard: renders nested routes only when the active tenant's plan grants
// `feature`, otherwise redirects home. Ownerless tenants pass (enforcement is
// skipped). The API enforces the same gate — this is presentation.
export default function RequireEntitlement({ feature }: Readonly<RequireEntitlementProps>) {
  const { has } = useEntitlements()
  if (!has(feature)) return <Navigate to="/" replace />
  return <Outlet />
}
