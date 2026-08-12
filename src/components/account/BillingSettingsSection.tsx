import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import { useToast } from '../../contexts/toastContext.ts'
import { useAuth } from '../../contexts/authContext.ts'
import { ladderPlans } from '../../utils/planLadder.ts'
import { PLAN_AUDIENCES, isPlanAudience } from '../../auth/planAudiences.ts'
import type { PlanAudience } from '../../auth/planAudiences.ts'
import {
  getBillingState,
  subscribe as apiSubscribe,
  changePlan as apiChangePlan,
  downgrade as apiDowngrade,
  cancelSubscription as apiCancel,
  resumeSubscription as apiResume,
  syncSubscription as apiSync,
} from '../../api/billing.ts'
import type { BillingInterval, BillingState } from '../../api/billing.ts'
import { redirectToCheckout } from '../../utils/checkoutNavigation.ts'
import PlanLadderSection from './PlanLadderSection.tsx'
import type { LadderEmptyState } from './PlanLadderSection.tsx'

// API error codes with a user-facing translation under billing:errors. The
// values are the i18n leaf keys; `as const` keeps the selector index literal.
const BILLING_ERROR_KEYS = {
  plan_change_in_progress: 'plan_change_in_progress',
  complimentary_managed_by_admin: 'complimentary_managed_by_admin',
  plan_not_priced: 'plan_not_priced',
  already_subscribed: 'already_subscribed',
  use_downgrade_endpoint: 'use_downgrade_endpoint',
  not_implemented: 'not_implemented',
  no_mandate: 'no_mandate',
  billing_not_configured: 'billing_not_configured',
  over_target_limit: 'over_target_limit',
  confirmation_mismatch: 'confirmation_mismatch',
  not_a_downgrade: 'not_a_downgrade',
  cross_audience_change: 'cross_audience_change',
} as const

// Band and artist plans are separate products, so this page renders one
// self-contained section per ladder. Everything shared — loading, the busy
// flag, error mapping, the checkout return — lives here; everything
// ladder-specific (interval, downgrade dialog) lives in PlanLadderSection.
export default function BillingSettingsSection() {
  const { t } = useTranslation('billing')
  const showToast = useToast()
  const { refreshUser, user } = useAuth()
  const [busy, setBusy] = useState(false)

  const errorMessage = useCallback((err: unknown): string => {
    const e = (err ?? {}) as { code?: string; message?: string; body?: { code?: string } }
    const code = e.code ?? e.body?.code
    if (code && code in BILLING_ERROR_KEYS) {
      return t($ => $.errors[BILLING_ERROR_KEYS[code as keyof typeof BILLING_ERROR_KEYS]])
    }
    return e.message || t($ => $.errors.generic)
  }, [t])

  // The billing state is tagged with the reload it answered, so `loading` is
  // derived from whether the newest reload has landed.
  const [reloadNonce, setReloadNonce] = useState(0)
  const load = useCallback(() => setReloadNonce((n) => n + 1), [])
  const [billingState, setBillingState] = useState<{ key: number; state: BillingState | null } | null>(null)
  const state = billingState?.state ?? null
  const loading = billingState?.key !== reloadNonce

  useEffect(() => {
    let cancelled = false
    getBillingState()
      .then((next) => { if (!cancelled) setBillingState({ key: reloadNonce, state: next }) })
      .catch((err) => {
        if (cancelled) return
        showToast?.(errorMessage(err), 'error')
        // Keep whatever was on screen; only stop showing the spinner.
        setBillingState((prev) => ({ key: reloadNonce, state: prev?.state ?? null }))
      })
    return () => { cancelled = true }
  }, [reloadNonce, showToast, errorMessage])

  // Returning from the hosted checkout (?checkout=return&audience=…): re-ingest
  // the payment now — with webhooks disabled (local dev) nothing else flips the
  // subscription status — then refresh /auth/me and the billing view. The
  // audience names the product just bought, so a settled subscription on the
  // OTHER ladder is never mistaken for this one. Params are stripped so a
  // reload doesn't re-sync.
  const [searchParams, setSearchParams] = useSearchParams()
  const checkoutReturn = searchParams.get('checkout') === 'return'
  const returnAudienceParam = searchParams.get('audience')
  useEffect(() => {
    if (!checkoutReturn) return
    const audience = isPlanAudience(returnAudienceParam) ? returnAudienceParam : undefined
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('checkout')
      next.delete('audience')
      return next
    }, { replace: true })
    apiSync(audience)
      .catch(() => {}) // best-effort: the webhook/scheduler will catch up
      .then(() => refreshUser().catch(() => {}))
      .then(() => load())
  }, [checkoutReturn, returnAudienceParam, setSearchParams, refreshUser, load])

  const bandPlans = useMemo(() => ladderPlans(state?.plans ?? [], PLAN_AUDIENCES.BAND), [state])
  const artistPlans = useMemo(() => ladderPlans(state?.plans ?? [], PLAN_AUDIENCES.ARTIST), [state])

  // Run a billing mutation, refresh both the billing view and /auth/me (so
  // entitlements/nav update), and surface errors as a toast. Returns whether
  // the mutation succeeded, so callers (the downgrade dialog) can keep their
  // UI open on a server-side rejection.
  const run = useCallback(async (fn: () => Promise<unknown>, successMsg?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      if (successMsg) showToast?.(successMsg, 'success')
      await refreshUser().catch(() => {})
      load()
      return true
    } catch (err) {
      showToast?.(errorMessage(err), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }, [showToast, refreshUser, load, errorMessage])

  const onSubscribe = (planId: number, interval: BillingInterval) => run(async () => {
    const { checkoutUrl } = await apiSubscribe(planId, interval)
    redirectToCheckout(checkoutUrl)
  })

  const onUpgrade = (planId: number, interval: BillingInterval) => run(async () => {
    const res = await apiChangePlan(planId, interval)
    showToast?.(res.pending ? t($ => $.toasts.paymentStarted) : t($ => $.toasts.planUpdated), 'info')
  })

  const onDowngrade = (planId: number, interval: BillingInterval, confirmation: string) => run(
    async () => { await apiDowngrade(planId, interval, confirmation) },
    t($ => $.toasts.downgradeScheduled),
  )

  const onCancel = (audience: PlanAudience) => run(
    async () => { await apiCancel(audience) }, t($ => $.toasts.cancellationScheduled))
  const onResume = (audience: PlanAudience) => run(
    async () => { await apiResume(audience) }, t($ => $.toasts.resumed))
  const onSync = (audience: PlanAudience) => run(async () => {
    const { subscriptions } = await apiSync(audience)
    if (subscriptions[audience]) showToast?.(t($ => $.toasts.synced), 'success')
  })

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
  }

  const bandSub = state?.subscriptions?.band ?? null
  const artistSub = state?.subscriptions?.artist ?? null
  // No band subscription, owns no band, but participates in someone else's:
  // they owe nothing — access comes from the band owner's plan.
  const hasApprovedMembership = (user?.memberships ?? []).some((m) => m.status === 'approved')
  const bandEmptyState: LadderEmptyState =
    !bandSub && (state?.ownedBandCount ?? 0) === 0 && hasApprovedMembership ? 'participantOnly' : 'free'
  const artistEmptyState: LadderEmptyState =
    !artistSub && !state?.hasPersonalWorkspace ? 'noPersonalWorkspace' : 'free'

  return (
    <Stack spacing={5}>
      <PlanLadderSection
        audience={PLAN_AUDIENCES.BAND}
        title={t($ => $.plans.bandLadderTitle)}
        plans={bandPlans}
        sub={bandSub}
        emptyState={bandEmptyState}
        busy={busy}
        onSubscribe={onSubscribe}
        onUpgrade={onUpgrade}
        onDowngrade={onDowngrade}
        onCancel={() => onCancel(PLAN_AUDIENCES.BAND)}
        onResume={() => onResume(PLAN_AUDIENCES.BAND)}
        onSync={() => onSync(PLAN_AUDIENCES.BAND)}
      />
      <PlanLadderSection
        audience={PLAN_AUDIENCES.ARTIST}
        title={t($ => $.plans.artistLadderTitle)}
        plans={artistPlans}
        sub={artistSub}
        emptyState={artistEmptyState}
        busy={busy}
        onSubscribe={onSubscribe}
        onUpgrade={onUpgrade}
        onDowngrade={onDowngrade}
        onCancel={() => onCancel(PLAN_AUDIENCES.ARTIST)}
        onResume={() => onResume(PLAN_AUDIENCES.ARTIST)}
        onSync={() => onSync(PLAN_AUDIENCES.ARTIST)}
      />
    </Stack>
  )
}
