import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/authContext.js'

// When a push-notification deep link lands on the SPA with `?tenant=N`, this
// hook switches the active tenant (if needed) and strips the param. Tolerates
// stale tenants the user no longer belongs to by leaving the param in place
// for visibility but doing nothing.
export function useTenantQuerySync() {
  const [params, setParams] = useSearchParams()
  const { user, switchTenant } = useAuth()
  const inFlight = useRef(null)

  useEffect(() => {
    const raw = params.get('tenant')
    if (!raw) return
    const desired = Number(raw)
    if (!Number.isInteger(desired) || desired <= 0) return
    if (!user || user.activeTenantId === desired) {
      const next = new URLSearchParams(params)
      next.delete('tenant')
      setParams(next, { replace: true })
      return
    }
    const isApprovedMember = (user.memberships || []).some(
      (m) => m.tenantId === desired && m.status === 'approved',
    )
    if (!isApprovedMember) return

    if (inFlight.current === desired) return
    inFlight.current = desired
    switchTenant(desired)
      .catch(() => {})
      .finally(() => {
        inFlight.current = null
        const next = new URLSearchParams(params)
        next.delete('tenant')
        setParams(next, { replace: true })
      })
  }, [params, user, switchTenant, setParams])
}
