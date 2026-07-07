import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useToast } from '../../contexts/toastContext.ts'
import { useAuth } from '../../contexts/authContext.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { planFeatureKey } from '../../utils/planFeatureKey.ts'
import { planLogoSrc } from '../../utils/planLogo.ts'
import {
  getBillingState,
  subscribe as apiSubscribe,
  changePlan as apiChangePlan,
  downgrade as apiDowngrade,
  cancelSubscription as apiCancel,
  resumeSubscription as apiResume,
  syncSubscription as apiSync,
  priceForInterval,
} from '../../api/billing.ts'
import type { BillingInterval, BillingState, SubscriptionPlan, Subscription } from '../../api/billing.ts'
import DowngradeDialog from './DowngradeDialog.tsx'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'

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
} as const

// Subscription statuses with a label under billing:status. `Subscription.status`
// is a plain string on the payload, so unknown values fall back to the raw value.
const STATUS_KEYS = {
  pending_mandate: 'pending_mandate',
  pending_activation: 'pending_activation',
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
} as const

function LimitText({ label, value }: Readonly<{ label: string; value: number | null }>) {
  const { t } = useTranslation('billing')
  return (
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
      {label}: {value === null ? t($ => $.limits.unlimited) : value}
    </Typography>
  )
}

export default function BillingSettingsSection() {
  const { t } = useTranslation('billing')
  const showToast = useToast()
  const { refreshUser, user } = useAuth()
  const [state, setState] = useState<BillingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [interval, setInterval] = useState<BillingInterval>('month')
  const [busy, setBusy] = useState(false)
  const [downgradeTarget, setDowngradeTarget] = useState<SubscriptionPlan | null>(null)
  const compact = useCompactLayout()
  
  const errorMessage = useCallback((err: unknown): string => {
    const e = (err ?? {}) as { code?: string; message?: string; body?: { code?: string } }
    const code = e.code ?? e.body?.code
    if (code && code in BILLING_ERROR_KEYS) {
      return t($ => $.errors[BILLING_ERROR_KEYS[code as keyof typeof BILLING_ERROR_KEYS]])
    }
    return e.message || t($ => $.errors.generic)
  }, [t])

  const load = useCallback(() => {
    setLoading(true)
    getBillingState()
      .then((data) => {
        setState(data)
        if (data.subscription?.billingInterval) setInterval(data.subscription.billingInterval)
      })
      .catch((err) => showToast?.(errorMessage(err), 'error'))
      .finally(() => setLoading(false))
  }, [showToast, errorMessage])

  useEffect(load, [load])

  const sub = state?.subscription ?? null
  const plans = useMemo(
    () => (state?.plans ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
    [state],
  )
  const fallbackPlan = plans.find((p) => p.is_fallback) ?? null
  const currentPlan = sub ? plans.find((p) => p.id === sub.planId) ?? null : fallbackPlan
  // No subscription, owns no band, but participates in someone else's: they
  // owe nothing — access comes from the band owner's plan.
  const hasApprovedMembership = (user?.memberships ?? []).some((m) => m.status === 'approved')
  const participantOnly = !sub && (state?.ownedTenantCount ?? 0) === 0 && hasApprovedMembership

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

  const onSubscribe = (planId: number) => run(async () => {
    const { checkoutUrl } = await apiSubscribe(planId, interval)
    window.location.href = checkoutUrl // hand off to the hosted checkout
  })

  const onUpgrade = (planId: number) => run(async () => {
    const res = await apiChangePlan(planId, interval)
    showToast?.(res.pending ? t($ => $.toasts.paymentStarted) : t($ => $.toasts.planUpdated), 'info')
  })

  const onDowngradeConfirm = async (confirmation: string) => {
    if (!downgradeTarget) return
    // Close only on success: a server-side blocker or phrase mismatch keeps
    // the dialog open next to its error toast.
    const ok = await run(async () => {
      await apiDowngrade(downgradeTarget.id, interval, confirmation)
    }, t($ => $.toasts.downgradeScheduled))
    if (ok) setDowngradeTarget(null)
  }

  const onCancel = () => run(async () => { await apiCancel() }, t($ => $.toasts.cancellationScheduled))
  const onResume = () => run(async () => { await apiResume() }, t($ => $.toasts.resumed))
  const onSync = () => run(async () => { const { subscription } = await apiSync(); if (subscription) showToast?.(t($ => $.toasts.synced), 'success') })

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
  }

  return (
    <Stack spacing={2}>
      <CurrentSubscriptionCard sub={sub} currentPlan={currentPlan} participantOnly={participantOnly} onCancel={onCancel} onResume={onResume} onSync={onSync} busy={busy} />

      <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>{t($ => $.plans.title)}</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={interval}
            onChange={(_e, v) => { if (v) setInterval(v as BillingInterval) }}
          >
            <ToggleButton value="month">{t($ => $.plans.monthly)}</ToggleButton>
            <ToggleButton value="year">{t($ => $.plans.yearly)}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fit, minmax(220px, 1fr))' } }}>
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              interval={interval}
              sub={sub}
              currentPlanSortOrder={currentPlan?.sort_order ?? 0}
              busy={busy}
              onSubscribe={() => onSubscribe(plan.id)}
              onUpgrade={() => onUpgrade(plan.id)}
              onDowngrade={() => setDowngradeTarget(plan)}
            />
          ))}
        </Box>
      </Paper>

      <DowngradeDialog
        open={downgradeTarget !== null}
        plan={downgradeTarget}
        interval={interval}
        isFreeFallback={Boolean(downgradeTarget?.is_fallback)}
        onClose={() => setDowngradeTarget(null)}
        onConfirm={onDowngradeConfirm}
      />
    </Stack>
  )
}

interface CurrentCardProps {
  sub: Subscription | null
  currentPlan: SubscriptionPlan | null
  participantOnly: boolean
  onCancel: () => void
  onResume: () => void
  onSync: () => void
  busy: boolean
}

function CurrentSubscriptionCard({ sub, currentPlan, participantOnly, onCancel, onResume, onSync, busy }: Readonly<CurrentCardProps>) {
  const { t } = useTranslation('billing')
  const compact = useCompactLayout()
  const statusLabel = sub && sub.status in STATUS_KEYS
    ? t($ => $.status[STATUS_KEYS[sub.status as keyof typeof STATUS_KEYS]])
    : sub?.status

  const periodEndLine = sub?.currentPeriodEnd && (
    sub.cancelAtPeriodEnd
      ? t($ => $.current.accessEnds, { date: new Date(sub.currentPeriodEnd) })
      : t($ => $.current.renews, { date: new Date(sub.currentPeriodEnd) })
  )
  const priceSuffix = sub && !sub.isComplimentary
    ? ` · ${sub.billingInterval === 'year'
      ? t($ => $.plans.perYear, { price: formatEur(sub.priceCents) })
      : t($ => $.plans.perMonth, { price: formatEur(sub.priceCents) })}`
    : ''

  return (
     <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        {sub && planLogoSrc(currentPlan?.slug) && (
          <Box component="img" src={planLogoSrc(currentPlan?.slug) ?? undefined} alt="" sx={{ height: 28, width: 'auto' }} />
        )}
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {participantOnly ? t($ => $.current.noSubscription) : currentPlan?.name ?? t($ => $.current.freePlanName)}
        </Typography>
        {sub && <Chip size="small" label={statusLabel} />}
        {sub?.isComplimentary && <Chip size="small" color="secondary" label={t($ => $.current.complimentary)} />}
      </Box>

      {!sub && (participantOnly ? (
        <Alert severity="info">{t($ => $.current.participantOnly)}</Alert>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t($ => $.current.freePlan)}
        </Typography>
      ))}

      {sub && (
        <Stack spacing={1}>
          {sub.trialEndsAt && sub.status === 'trialing' && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t($ => $.current.trialEnds, { date: new Date(sub.trialEndsAt) })}
            </Typography>
          )}
          {sub.currentPeriodEnd && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {periodEndLine}{priceSuffix}
            </Typography>
          )}
          {sub.pendingChange && !sub.downgradeScheduled && (
            <Alert severity="info">{t($ => $.current.pendingChange)}</Alert>
          )}
          {sub.downgradeScheduled && (
            <Alert severity="info">{t($ => $.current.downgradePending)}</Alert>
          )}
          {sub.status === 'past_due' && (
            <Alert severity="warning">{t($ => $.current.pastDue)}</Alert>
          )}
          {sub.repairNeeded && (
            <Alert severity="warning">{t($ => $.current.repairNeeded)}</Alert>
          )}
        </Stack>
      )}

      {sub && !sub.isComplimentary && (
        <>
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {sub.cancelAtPeriodEnd ? (
              <Button size="small" variant="outlined" disabled={busy} onClick={onResume}>{t($ => $.current.resume)}</Button>
            ) : (
              <Button size="small" color="error" disabled={busy} onClick={onCancel}>{t($ => $.current.cancel)}</Button>
            )}
            <Button size="small" disabled={busy} onClick={onSync}>{t($ => $.current.sync)}</Button>
          </Box>
        </>
      )}
    </Paper>
  )
}

interface PlanCardProps {
  plan: SubscriptionPlan
  interval: BillingInterval
  sub: Subscription | null
  currentPlanSortOrder: number
  busy: boolean
  onSubscribe: () => void
  onUpgrade: () => void
  onDowngrade: () => void
}

function PlanCard({ plan, interval, sub, currentPlanSortOrder, busy, onSubscribe, onUpgrade, onDowngrade }: Readonly<PlanCardProps>) {
  const { t } = useTranslation('billing')
  const price = priceForInterval(plan, interval)
  const unavailable = price === null && !plan.is_fallback
  // Complimentary grants carry no billing interval, so match on plan id alone;
  // otherwise the active plan is the one matching both id and the chosen interval.
  const isCurrent = sub
    ? sub.planId === plan.id && (sub.isComplimentary || sub.billingInterval === interval)
    : plan.is_fallback
  const enabledFeatures = Object.entries(plan.entitlements.features).filter(([, on]) => on).map(([f]) => f)

  const featureLabel = (f: string) => {
    const key = planFeatureKey(f)
    return key ? t($ => $.features[key]) : f.replace(/_/g, ' ')
  }

  let action: { label: string; onClick: () => void; color?: 'error' } | null = null
  if (isCurrent) action = null
  else if (!sub) {
    action = plan.is_fallback ? null : { label: t($ => $.plans.subscribe), onClick: onSubscribe }
  } else if (plan.sort_order > currentPlanSortOrder) {
    action = { label: t($ => $.plans.upgrade), onClick: onUpgrade }
  } else if (plan.sort_order < currentPlanSortOrder) {
    action = { label: t($ => $.plans.downgrade), onClick: onDowngrade, color: 'error' }
  } else {
    // Same tier, different interval.
    action = {
      label: interval === 'year' ? t($ => $.plans.switchToYearly) : t($ => $.plans.switchToMonthly),
      onClick: onUpgrade,
    }
  }

  let priceLabel: string
  if (plan.is_fallback) priceLabel = t($ => $.plans.free)
  else if (unavailable || price === null) priceLabel = '—'
  else priceLabel = interval === 'year'
    ? t($ => $.plans.perYear, { price: formatEur(price) })
    : t($ => $.plans.perMonth, { price: formatEur(price) })

  const logo = planLogoSrc(plan.slug)

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        // Highlight the active plan with a ring in the tenant/band accent colour
        // (fed into the theme as primary.main by TenantThemeProvider).
        borderColor: isCurrent ? 'primary.main' : undefined,
        boxShadow: isCurrent ? (theme) => `0 0 0 2px ${theme.palette.primary.main}` : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {logo && <Box component="img" src={logo} alt="" sx={{ height: 24, width: 'auto' }} />}
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>{plan.name}</Typography>
        {isCurrent && <Chip size="small" color="primary" label={t($ => $.plans.current)} />}
      </Box>
      <Typography variant="h6">{priceLabel}</Typography>
      <Stack spacing={0.25}>
        <LimitText label={t($ => $.limits.storage_mb)} value={plan.entitlements.limits.storage_mb ?? null} />
        <LimitText label={t($ => $.limits.members)} value={plan.entitlements.limits.members ?? null} />
        <LimitText label={t($ => $.limits.bands)} value={plan.entitlements.limits.bands ?? null} />
      </Stack>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {enabledFeatures.map((f) => <Chip key={f} size="small" variant="outlined" label={featureLabel(f)} />)}
      </Box>
      <Box sx={{ flexGrow: 1 }} />
      {unavailable ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t($ => $.plans.notAvailable)}</Typography>
      ) : action ? (
        <Button size="small" variant="contained" color={action.color} disabled={busy} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </Paper>
  )
}
