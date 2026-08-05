import { Navigate, Outlet } from 'react-router-dom'
import type { TenantCapability } from '../auth/tenantCapabilities.ts'
import { useTenantKind } from '../hooks/useTenantKind.ts'

interface RequireTenantCapabilityProps {
  capability: TenantCapability
}

// Presentation guard for deep links. The API's matching capability middleware
// remains the authoritative boundary.
export default function RequireTenantCapability({ capability }: Readonly<RequireTenantCapabilityProps>) {
  const { supports } = useTenantKind()
  if (!supports(capability)) return <Navigate to="/" replace />
  return <Outlet />
}
