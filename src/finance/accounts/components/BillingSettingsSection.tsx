import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useToast } from '../../../contexts/toastContext.ts'
import { useAuth } from '../../../contexts/authContext.ts'
import { ladderPlans, moduleFor } from '../../../commerce/billing/planLadder.ts'
import type { PlanAction } from '../../../commerce/billing/planLadder.ts'
import { PLAN_AUDIENCES, PLAN_AUDIENCE_KEYS } from '../../../auth/planAudiences.ts'
import type { PlanAudience } from '../../../auth/planAudiences.ts'
import {
  getBillingState,
  startTrial as apiStartTrial,
  subscribe as apiSubscribe,
  checkout as apiCheckout,
  changeModule as apiChangeModule,
  downgrade as apiDowngrade,
  cancelSubscription as apiCancel,
  resumeSubscription as apiResume,
  syncSubscription as apiSync,
} from '../../../commerce/billing/billing.ts'
import type {
  BillingInterval, BillingState, SubscriptionPlan,
} from '../../../commerce/billing/billing.ts'
import { formatEur } from '../../invoices/invoiceTotals.ts'
import { redirectToCheckout } from '../../invoices/checkoutNavigation.ts'
import ModuleSection from './ModuleSection.tsx'
import type { ModuleEmptyState } from './ModuleSection.tsx'
import DowngradeDialog from './DowngradeDialog.tsx'
import CancelDialog from './CancelDialog.tsx'
import PriceBreakdown from './PriceBreakdown.tsx'
import { STATUS_KEYS } from './subscriptionStatusKeys.ts'

// Kept in step with server billingShared.REFUND_WINDOW_DAYS. Presentation only —
// the server is what actually refuses a cancellation outside the window.
const REFUND_WINDOW_DAYS = 5

// API error codes with a user-facing translation under billing:errors. The
// values are the i18n leaf keys; `as const` keeps the selector index literal.
const BILLING_ERROR_KEYS = {
  plan_change_in_progress: 'plan_change_in_progress',
  complimentary_managed_by_admin: 'complimentary_managed_by_admin',
  plan_not_priced: 'plan_not_priced',
  already_subscribed: 'already_subscribed',
  already_active: 'already_active',
  use_downgrade_endpoint: 'use_downgrade_endpoint',
  no_mandate: 'no_mandate',
  no_modules: 'no_modules',
  billing_not_configured: 'billing_not_configured',
  over_target_limit: 'over_target_limit',
  confirmation_mismatch: 'confirmation_mismatch',
  not_a_downgrade: 'not_a_downgrade',
  trial_used: 'trial_used',
  trial_tier_missing: 'trial_tier_missing',
  refund_window_closed: 'refund_window_closed',
  audience_mismatch: 'audience_mismatch',
  already_scheduled: 'already_scheduled',
} as const

interface DowngradeState {
  audience: PlanAudience
  /** null = remove the module altogether. */
  plan: SubscriptionPlan | null
}

// One subscription, made of modules, on one shared cycle. This owns everything
// shared — loading, the busy flag, error mapping, the interval, the checkout
// return — and delegates each product to a ModuleSection.
export default function BillingSettingsSection() {
  const { t } = useTranslation('billing')
  const showToast = useToast()
  const { refreshUser, user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [downgradeState, setDowngradeState] = useState<DowngradeState | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)

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

  // Returning from the hosted checkout (?checkout=return): re-ingest the payment
  // now — with webhooks disabled (local dev) nothing else flips the subscription
  // status — then refresh /auth/me and the billing view. There is only one
  // subscription now, so no audience qualifier is needed. Params are stripped so
  // a reload doesn't re-sync.
  const [searchParams, setSearchParams] = useSearchParams()
  const checkoutReturn = searchParams.get('checkout') === 'return'
  useEffect(() => {
    if (!checkoutReturn) return
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('checkout')
      return next
    }, { replace: true })
    apiSync()
      .catch(() => {}) // best-effort: the webhook/scheduler will catch up
      .then(() => refreshUser().catch(() => {}))
      .then(() => load())
  }, [checkoutReturn, setSearchParams, refreshUser, load])

  const sub = state?.subscription ?? null
  const isTrial = sub?.status === 'trialing'
  const plansByAudience = useMemo(() => {
    const forAudience = (audience: PlanAudience) => {
      return ladderPlans(state?.plans ?? [], audience)
    }
    return {
      band: forAudience(PLAN_AUDIENCES.BAND),
      artist: forAudience(PLAN_AUDIENCES.ARTIST),
    }
  }, [state])
  // A trial has no cycle yet, so the customer picks one at conversion. Both
  // modules always share it — one subscription, one cycle.
  const [checkoutInterval, setCheckoutInterval] = useState<BillingInterval>('month')
  const interval = sub?.billingInterval ?? null
  const checkoutQuote = state?.checkoutQuotes?.[checkoutInterval] ?? null

  // Run a billing mutation, refresh both the billing view and /auth/me (so
  // entitlements/nav update), and surface errors as a toast. Returns whether
  // the mutation succeeded, so callers (the dialogs) can keep their UI open on
  // a server-side rejection.
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

  const onStartTrial = (audience: PlanAudience) => run(
    async () => { await apiStartTrial(audience) }, t($ => $.trial.started))

  const onCheckout = () => run(async () => {
    const { checkoutUrl } = await apiCheckout(checkoutInterval)
    redirectToCheckout(checkoutUrl)
  })

  const onModuleAction = (audience: PlanAudience) => (plan: SubscriptionPlan, action: PlanAction) => {
    if (action === 'downgrade') { setDowngradeState({ audience, plan }); return }
    if (action === 'remove') { setDowngradeState({ audience, plan: null }); return }

    // A customer with no subscription at all and a spent trial goes straight to
    // checkout for the plan they picked.
    if (!sub) {
      void run(async () => {
        const { checkoutUrl } = await apiSubscribe(audience, plan.id, checkoutInterval)
        redirectToCheckout(checkoutUrl)
      })
      return
    }

    void run(async () => {
      const res = await apiChangeModule(audience, plan.id)
      if (res.pending) {
        showToast?.(t($ => $.toasts.prorated, {
          price: formatEur(res.amountCents ?? 0),
        }), 'info')
      } else {
        showToast?.(t($ => $.toasts.planUpdated), 'success')
      }
    })
  }

  const onDowngradeConfirm = async (confirmation: string) => {
    if (!downgradeState) return
    const ok = await run(async () => {
      await apiDowngrade(
        downgradeState.plan === null
          ? { audience: downgradeState.audience, remove: true }
          : { audience: downgradeState.audience, planId: downgradeState.plan.id },
        confirmation,
      )
    }, t($ => $.toasts.downgradeScheduled))
    if (ok) setDowngradeState(null)
  }

  const onCancelConfirm = (immediate: boolean) => {
    void run(async () => {
      const res = await apiCancel(immediate)
      if (res.refunded) {
        showToast?.(t($ => $.toasts.canceledRefunded, {
          price: formatEur(res.refundAmountCents ?? 0),
        }), 'success')
      } else {
        showToast?.(t($ => $.toasts.cancellationScheduled), 'success')
      }
    }).then((ok) => { if (ok) setCancelOpen(false) })
  }

  const onResume = () => run(async () => { await apiResume() }, t($ => $.toasts.resumed))
  const onSync = () => run(async () => {
    await apiSync()
    showToast?.(t($ => $.toasts.synced), 'success')
  })

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
  }

  const hasApprovedMembership = (user?.memberships ?? []).some((m) => m.status === 'approved')
  const emptyStateFor = (audience: PlanAudience): ModuleEmptyState => {
    if (moduleFor(sub, audience)) return 'free'
    if (audience === PLAN_AUDIENCES.ARTIST && !state?.hasPersonalWorkspace) return 'noPersonalWorkspace'
    if (audience === PLAN_AUDIENCES.BAND && (state?.ownedBandCount ?? 0) === 0 && hasApprovedMembership) {
      return 'participantOnly'
    }
    return 'free'
  }

  const statusKey = sub ? STATUS_KEYS[sub.status as keyof typeof STATUS_KEYS] : null

  return (
    <Stack spacing={3}>
      {/* No subscription at all: offer the trial, or a direct signup if spent. */}
      {!sub && (
        <Paper elevation={0} sx={{ p: 2 }}>
          <Typography variant="h6">
            {state?.trialAvailable
              ? t($ => $.trial.title, { count: state.trialDays })
              : t($ => $.current.noSubscription)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1, mb: 2 }}>
            {state?.trialAvailable ? t($ => $.trial.description) : t($ => $.trial.used)}
          </Typography>
          {state?.trialAvailable && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t($ => $.trial.chooseModule)}
              </Typography>
              <Stack direction="row" spacing={1}>
                {PLAN_AUDIENCE_KEYS.map((audience) => (
                  <Button
                    key={audience}
                    variant="contained"
                    disabled={busy}
                    onClick={() => { void onStartTrial(audience) }}
                  >
                    {t($ => $.modules[audience])}
                  </Button>
                ))}
              </Stack>
            </>
          )}
        </Paper>
      )}

      {sub && (
        <Paper elevation={0} sx={{ p: 2 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="h6">{t($ => $.breakdown.title)}</Typography>
              {statusKey && <Chip size="small" label={t($ => $.status[statusKey])} />}
              {sub.isComplimentary && <Chip size="small" label={t($ => $.current.complimentary)} />}
            </Stack>
            <Button size="small" onClick={() => { void onSync() }} disabled={busy}>
              {t($ => $.current.sync)}
            </Button>
          </Stack>

          {sub.status === 'past_due' && (
            <Alert severity="warning" sx={{ mb: 2 }}>{t($ => $.current.pastDue)}</Alert>
          )}
          {sub.repairNeeded && (
            <Alert severity="info" sx={{ mb: 2 }}>{t($ => $.current.repairNeeded)}</Alert>
          )}
          {sub.pendingTotalCents !== null && (
            <Alert severity="info" sx={{ mb: 2 }}>{t($ => $.current.pendingChange)}</Alert>
          )}
          {sub.modules.some((m) => m.pendingChangeKind === 'downgrade'
            || m.pendingChangeKind === 'remove') && (
            <Alert severity="warning" sx={{ mb: 2 }}>{t($ => $.current.downgradePending)}</Alert>
          )}

          {isTrial && sub.trialEndsAt !== null && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t($ => $.current.trialEnds, { date: new Date(sub.trialEndsAt) })}
            </Alert>
          )}
          {!isTrial && sub.currentPeriodEnd !== null && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {sub.cancelAtPeriodEnd
                ? t($ => $.current.accessEnds, { date: new Date(sub.currentPeriodEnd) })
                : t($ => $.current.renews, { date: new Date(sub.currentPeriodEnd) })}
            </Typography>
          )}

          <PriceBreakdown
            snapshot={sub.priceSnapshot}
            interval={interval}
            nextTotalCents={sub.nextTotalCents}
            nextRenewalAt={sub.currentPeriodEnd}
          />

          {/* Trial conversion: select a cycle, verify the mandate for one cent,
              then let the provider charge the quoted total at trial end. */}
          {isTrial && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t($ => $.checkout.title)}</Typography>
              {sub.paymentMethodReady && sub.subscriptionStartsAt ? (
                <Alert severity="success">
                  {t($ => $.checkout.scheduled, {
                    price: formatEur(sub.nextTotalCents ?? 0),
                    date: new Date(sub.subscriptionStartsAt),
                  })}
                </Alert>
              ) : sub.paymentVerificationPending ? (
                <Alert severity="info">{t($ => $.checkout.verificationPending)}</Alert>
              ) : (
                <Stack spacing={2}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t($ => $.trial.convertPrompt)}
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={checkoutInterval}
                    onChange={(_e, v: BillingInterval | null) => { if (v) setCheckoutInterval(v) }}
                  >
                    <ToggleButton value="month">{t($ => $.checkout.monthly)}</ToggleButton>
                    <ToggleButton value="year">{t($ => $.checkout.yearly)}</ToggleButton>
                  </ToggleButtonGroup>
                  <PriceBreakdown
                    snapshot={checkoutQuote}
                    interval={checkoutInterval}
                    nextRenewalAt={sub.trialEndsAt}
                  />
                  <Alert severity="info">
                    {t($ => $.checkout.verificationDisclosure, {
                      price: formatEur(checkoutQuote?.totalCents ?? 0),
                      date: sub.trialEndsAt ? new Date(sub.trialEndsAt) : new Date(),
                    })}
                  </Alert>
                  <Button variant="contained" disabled={busy || checkoutQuote === null} onClick={() => { void onCheckout() }}>
                    {t($ => $.checkout.verifyAndSchedule)}
                  </Button>
                </Stack>
              )}
            </>
          )}

          {!sub.isComplimentary && (
            <>
              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={1}>
                {sub.cancelAtPeriodEnd ? (
                  <Button size="small" disabled={busy} onClick={() => { void onResume() }}>
                    {t($ => $.current.resume)}
                  </Button>
                ) : (
                  <Button size="small" color="error" disabled={busy} onClick={() => setCancelOpen(true)}>
                    {t($ => $.current.cancel)}
                  </Button>
                )}
              </Stack>
            </>
          )}
        </Paper>
      )}

      {(!state?.trialAvailable || sub !== null) && PLAN_AUDIENCE_KEYS.map((audience) => (
        <ModuleSection
          key={audience}
          audience={audience}
          plans={plansByAudience[audience]}
          module={moduleFor(sub, audience)}
          interval={interval ?? checkoutInterval}
          emptyState={emptyStateFor(audience)}
          busy={busy}
          isTrial={isTrial}
          allowTrialRemoval={!isTrial || (sub?.modules.length ?? 0) > 1}
          onChoose={onModuleAction(audience)}
        />
      ))}

      {downgradeState && (
        <DowngradeDialog
          open
          audience={downgradeState.audience}
          plan={downgradeState.plan}
          isTrial={isTrial}
          onClose={() => setDowngradeState(null)}
          onConfirm={onDowngradeConfirm}
        />
      )}

      {sub && (
        <CancelDialog
          open={cancelOpen}
          subscription={sub}
          refundWindowDays={REFUND_WINDOW_DAYS}
          busy={busy}
          onClose={() => setCancelOpen(false)}
          onCancel={onCancelConfirm}
        />
      )}
    </Stack>
  )
}
