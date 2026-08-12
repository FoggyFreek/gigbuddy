import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { formatEur } from '../../invoices/invoiceTotals.ts'
import { planFeatureKey } from '../../../commerce/billing/planFeatureKey.ts'
import { planLogoSrc } from '../../../commerce/billing/planLogo.ts'
import { isCurrentPlan, planActionKind } from '../../../commerce/billing/planLadder.ts'
import type { PlanAction } from '../../../commerce/billing/planLadder.ts'
import { PLAN_AUDIENCES } from '../../../auth/planAudiences.ts'
import type { PlanAudience } from '../../../auth/planAudiences.ts'
import { priceForInterval } from '../../../commerce/billing/billing.ts'
import type { BillingInterval, SubscriptionPlan, Subscription } from '../../../commerce/billing/billing.ts'
import DowngradeDialog from './DowngradeDialog.tsx'
import { STATUS_KEYS } from './subscriptionStatusKeys.ts'
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'

// Why this ladder has no subscription, which decides the empty-state copy.
export type LadderEmptyState = 'free' | 'participantOnly' | 'noPersonalWorkspace'

interface PlanLadderSectionProps {
  audience: PlanAudience
  title: string
  /** Already filtered to this audience and ranked by sort_order. */
  plans: SubscriptionPlan[]
  sub: Subscription | null
  emptyState: LadderEmptyState
  busy: boolean
  onSubscribe: (planId: number, interval: BillingInterval) => void
  onUpgrade: (planId: number, interval: BillingInterval) => void
  onDowngrade: (planId: number, interval: BillingInterval, confirmation: string) => Promise<boolean>
  onCancel: () => void
  onResume: () => void
  onSync: () => void
}

// One product's subscription and plan grid. The two ladders are independent
// purchases, so each owns its own billing interval and its own downgrade
// dialog — a user may legitimately be on monthly band and yearly artist.
export default function PlanLadderSection({
  audience, title, plans, sub, emptyState, busy,
  onSubscribe, onUpgrade, onDowngrade, onCancel, onResume, onSync,
}: Readonly<PlanLadderSectionProps>) {
  const { t } = useTranslation('billing')
  const compact = useCompactLayout()
  const [interval, setInterval] = useState<BillingInterval>(sub?.billingInterval ?? 'month')
  const [downgradeTarget, setDowngradeTarget] = useState<SubscriptionPlan | null>(null)

  const fallbackPlan = plans.find((p) => p.is_fallback) ?? null
  const currentPlan = sub ? plans.find((p) => p.id === sub.planId) ?? null : fallbackPlan

  const onDowngradeConfirm = async (confirmation: string) => {
    if (!downgradeTarget) return
    // Close only on success: a server-side blocker or phrase mismatch keeps the
    // dialog open next to its error toast.
    const ok = await onDowngrade(downgradeTarget.id, interval, confirmation)
    if (ok) setDowngradeTarget(null)
  }

  return (
    <Stack spacing={2} data-testid={`plan-ladder-${audience}`}>
      <Typography variant="h6">{title}</Typography>

      <CurrentSubscriptionCard
        sub={sub}
        currentPlan={currentPlan}
        emptyState={emptyState}
        onCancel={onCancel}
        onResume={onResume}
        onSync={onSync}
        busy={busy}
      />

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
              audience={audience}
              interval={interval}
              sub={sub}
              currentPlanSortOrder={currentPlan?.sort_order ?? 0}
              busy={busy}
              onSubscribe={() => onSubscribe(plan.id, interval)}
              onUpgrade={() => onUpgrade(plan.id, interval)}
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

function LimitText({ label, value }: Readonly<{ label: string; value: number | null }>) {
  const { t } = useTranslation('billing')
  return (
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
      {label}: {value === null ? t($ => $.limits.unlimited) : value}
    </Typography>
  )
}

interface CurrentCardProps {
  sub: Subscription | null
  currentPlan: SubscriptionPlan | null
  emptyState: LadderEmptyState
  onCancel: () => void
  onResume: () => void
  onSync: () => void
  busy: boolean
}

// Period/trial lines and status alerts for an existing subscription.
function SubscriptionDetails({ sub }: Readonly<{ sub: Subscription }>) {
  const { t } = useTranslation('billing')
  const periodEndLine = sub.cancelAtPeriodEnd
    ? t($ => $.current.accessEnds, { date: new Date(sub.currentPeriodEnd ?? 0) })
    : t($ => $.current.renews, { date: new Date(sub.currentPeriodEnd ?? 0) })
  const priceSuffix = sub.isComplimentary
    ? ''
    : ` · ${sub.billingInterval === 'year'
      ? t($ => $.plans.perYear, { price: formatEur(sub.priceCents) })
      : t($ => $.plans.perMonth, { price: formatEur(sub.priceCents) })}`

  return (
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
  )
}

function LadderEmptyMessage({ emptyState }: Readonly<{ emptyState: LadderEmptyState }>) {
  const { t } = useTranslation('billing')
  if (emptyState === 'participantOnly') {
    return <Alert severity="info">{t($ => $.current.participantOnly)}</Alert>
  }
  if (emptyState === 'noPersonalWorkspace') {
    return <Alert severity="info">{t($ => $.current.noPersonalWorkspace)}</Alert>
  }
  return (
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      {t($ => $.current.freePlan)}
    </Typography>
  )
}

function CurrentSubscriptionCard({ sub, currentPlan, emptyState, onCancel, onResume, onSync, busy }: Readonly<CurrentCardProps>) {
  const { t } = useTranslation('billing')
  const compact = useCompactLayout()
  const statusLabel = sub && sub.status in STATUS_KEYS
    ? t($ => $.status[STATUS_KEYS[sub.status as keyof typeof STATUS_KEYS]])
    : sub?.status
  const headline = emptyState === 'participantOnly' && !sub
    ? t($ => $.current.noSubscription)
    : currentPlan?.name ?? t($ => $.current.freePlanName)

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        {sub && planLogoSrc(currentPlan?.slug) && (
          <Box component="img" src={planLogoSrc(currentPlan?.slug) ?? undefined} alt="" sx={{ height: 28, width: 'auto' }} />
        )}
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>{headline}</Typography>
        {sub && <Chip size="small" label={statusLabel} />}
        {sub?.isComplimentary && <Chip size="small" color="secondary" label={t($ => $.current.complimentary)} />}
      </Box>

      {!sub && <LadderEmptyMessage emptyState={emptyState} />}

      {sub && <SubscriptionDetails sub={sub} />}

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
  audience: PlanAudience
  interval: BillingInterval
  sub: Subscription | null
  currentPlanSortOrder: number
  busy: boolean
  onSubscribe: () => void
  onUpgrade: () => void
  onDowngrade: () => void
}

interface PlanCardAction {
  label: string
  onClick: () => void
  color?: 'error'
}

function PlanCardFooter({ unavailable, action, busy }: Readonly<{ unavailable: boolean; action: PlanCardAction | null; busy: boolean }>) {
  const { t } = useTranslation('billing')
  if (unavailable) {
    return <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t($ => $.plans.notAvailable)}</Typography>
  }
  if (!action) return null
  return (
    <Button size="small" variant="contained" color={action.color} disabled={busy} onClick={action.onClick}>
      {action.label}
    </Button>
  )
}

function PlanCard({ plan, audience, interval, sub, currentPlanSortOrder, busy, onSubscribe, onUpgrade, onDowngrade }: Readonly<PlanCardProps>) {
  const { t } = useTranslation('billing')
  const price = priceForInterval(plan, interval)
  const unavailable = price === null && !plan.is_fallback
  const isCurrent = isCurrentPlan(sub, plan, interval)
  const enabledFeatures = Object.entries(plan.entitlements.features).filter(([, on]) => on).map(([f]) => f)

  const featureLabel = (f: string) => {
    const key = planFeatureKey(f)
    return key ? t($ => $.features[key]) : f.replace(/_/g, ' ')
  }

  const actionByKind: Record<PlanAction, PlanCardAction> = {
    subscribe: { label: t($ => $.plans.subscribe), onClick: onSubscribe },
    upgrade: { label: t($ => $.plans.upgrade), onClick: onUpgrade },
    downgrade: { label: t($ => $.plans.downgrade), onClick: onDowngrade, color: 'error' },
    switch: {
      label: interval === 'year' ? t($ => $.plans.switchToYearly) : t($ => $.plans.switchToMonthly),
      onClick: onUpgrade,
    },
  }
  const kind = planActionKind(plan, sub, isCurrent, currentPlanSortOrder)
  const action = kind ? actionByKind[kind] : null

  let priceLabel: string
  if (plan.is_fallback) priceLabel = t($ => $.plans.free)
  else if (price === null) priceLabel = '—'
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
        {/* The artist ladder owns no bands; showing "Bands: 0" there reads as a
            defect rather than a limit. */}
        {audience === PLAN_AUDIENCES.BAND && (
          <LimitText label={t($ => $.limits.bands)} value={plan.entitlements.limits.bands ?? null} />
        )}
      </Stack>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {enabledFeatures.map((f) => <Chip key={f} size="small" variant="outlined" label={featureLabel(f)} />)}
      </Box>
      <Box sx={{ flexGrow: 1 }} />
      <PlanCardFooter unavailable={unavailable} action={action} busy={busy} />
    </Paper>
  )
}
