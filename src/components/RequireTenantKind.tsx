import { Navigate, Outlet } from 'react-router-dom'
import { useTenantKind } from '../hooks/useTenantKind.ts'
import type { TenantKind } from '../utils/businessRegistry.ts'

interface RequireTenantKindProps {
  kinds: readonly TenantKind[]
}

// Route guard: renders the nested routes only in a tenant of one of `kinds`,
// otherwise redirects home — a band roster has no meaning in a personal
// workspace, so a deep link lands somewhere that does. The API enforces the
// same gate (requireTenantKind); this is presentation.
export default function RequireTenantKind({ kinds }: Readonly<RequireTenantKindProps>) {
  const { allowsKind } = useTenantKind()
  if (!allowsKind(kinds)) return <Navigate to="/" replace />
  return <Outlet />
}
