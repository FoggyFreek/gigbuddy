import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { formatEur } from '../../invoices/invoiceTotals.ts'
import { planFeatureKey } from '../../../commerce/billing/planFeatureKey.ts'
import { planLogoSrc } from '../../../commerce/billing/planLogo.ts'
import { isCurrentPlan, planActionKind } from '../../../commerce/billing/planLadder.ts'
import type { PlanAction } from '../../../commerce/billing/planLadder.ts'
import type { PlanAudience } from '../../../auth/planAudiences.ts'
import { priceForInterval } from '../../../commerce/billing/billing.ts'
import type {
  BillingInterval, SubscriptionModule, SubscriptionPlan,
} from '../../../commerce/billing/billing.ts'
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'

// Why this ladder has no module, which decides the empty-state copy.
export type ModuleEmptyState = 'free' | 'participantOnly' | 'noPersonalWorkspace'

interface Props {
  audience: PlanAudience
  /** Already filtered to this audience and ranked by sort_order. */
  plans: SubscriptionPlan[]
  module: SubscriptionModule | null
  /** null while trialling — there is no cycle to price against yet. */
  interval: BillingInterval | null
  emptyState: ModuleEmptyState
  busy: boolean
  isTrial: boolean
  /** A Gold trial must retain at least one preferred module. */
  allowTrialRemoval: boolean
  onChoose: (plan: SubscriptionPlan, action: PlanAction) => void
}

const ACTION_KEYS = {
  add: 'add',
  upgrade: 'upgrade',
  downgrade: 'downgrade',
  remove: 'remove',
} as const

// One product of the subscription: which plan the module sits on, what the
// alternatives cost, and the single action each offers. Both modules share one
// billing interval, so the interval toggle lives on the parent — a subscription
// cannot be monthly on one module and yearly on the other.
export default function ModuleSection({
  audience, plans, module, interval, emptyState, busy, isTrial, allowTrialRemoval, onChoose,
}: Readonly<Props>) {
  const { t } = useTranslation('billing')
  const compact = useCompactLayout()

  const fallbackPlan = plans.find((p) => p.is_fallback) ?? null
  const currentPlan = module
    ? plans.find((p) => p.id === module.planId) ?? null
    : fallbackPlan
  const pricingInterval: BillingInterval = interval ?? 'month'

  const priceLabel = (plan: SubscriptionPlan) => {
    if (plan.is_fallback) return t($ => $.plans.free)
    const cents = priceForInterval(plan, pricingInterval)
    if (cents === null) return t($ => $.plans.notAvailable)
    return pricingInterval === 'year'
      ? t($ => $.plans.perYear, { price: formatEur(cents) })
      : t($ => $.plans.perMonth, { price: formatEur(cents) })
  }

  const logo = currentPlan ? planLogoSrc(currentPlan.slug) : null

  return (
    <Paper elevation={0} sx={{ p: 2 }}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 1 }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          {logo !== null && (
            <Box component="img" src={logo} alt="" sx={{ width: 32, height: 32 }} />
          )}
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t($ => $.modules[audience])}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {module
                ? currentPlan?.name ?? module.planSlug
                : t($ => $.modules.notIncluded)}
            </Typography>
          </Box>
        </Stack>

        <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }}>
          {module?.status === 'pending' && (
            <Chip size="small" color="warning" label={t($ => $.modules.pending)} />
          )}
          {module?.pendingChangeKind === 'remove' && (
            <Chip size="small" color="warning" label={t($ => $.modules.remove)} />
          )}
          {module?.pendingChangeKind === 'downgrade' && module.pendingPlanSlug !== null && (
            <Chip size="small" color="warning" label={module.pendingPlanSlug} />
          )}
          {module?.pendingChangeKind === 'trial_selection' && module.pendingPlanSlug !== null && (
            <Chip
              size="small"
              color="primary"
              label={t($ => $.modules.paidSelection, { plan: module.pendingPlanSlug })}
            />
          )}
        </Stack>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {audience === 'band'
          ? t($ => $.modules.bandDescription)
          : t($ => $.modules.artistDescription)}
      </Typography>

      {module === null && emptyState !== 'free' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {emptyState === 'participantOnly'
            ? t($ => $.current.participantOnly)
            : t($ => $.current.noPersonalWorkspace)}
        </Alert>
      )}

      <Stack
        direction={compact ? 'column' : 'row'}
        spacing={2}
        sx={{ alignItems: 'stretch' }}
        data-testid={`module-plans-${audience}`}
      >
        {plans.map((plan) => {
            const current = isTrial
              ? (module ? (module.pendingPlanId ?? module.planId) === plan.id : plan.is_fallback)
              : isCurrentPlan(module, plan)
            const action = isTrial
              ? (current ? null : (module
                ? (plan.is_fallback ? 'remove' : 'upgrade')
                : (plan.is_fallback ? null : 'add')))
              : planActionKind(plan, module, audience, currentPlan?.sort_order ?? 0)
            const unavailable = !plan.is_fallback
              && priceForInterval(plan, pricingInterval) === null
            const enabledFeatures = Object.entries(plan.entitlements.features)
              .filter(([, on]) => on)
              .map(([key]) => key)

            return (
              <Paper
                key={plan.id}
                variant="outlined"
                sx={{ p: 2, flex: 1, borderColor: current ? 'primary.main' : undefined }}
              >
                <Stack sx={{ height: '100%' }} spacing={1}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="subtitle2">{plan.name}</Typography>
                    {current && <Chip size="small" label={t($ => $.modules.current)} />}
                  </Stack>
                  <Typography variant="h6">{priceLabel(plan)}</Typography>

                  <Stack spacing={0.25} sx={{ flexGrow: 1 }}>
                    {enabledFeatures.map((feature) => {
                      const key = planFeatureKey(feature)
                      return (
                        <Typography key={feature} variant="caption" sx={{ color: 'text.secondary' }}>
                          {key ? t($ => $.features[key]) : feature.replace(/_/g, ' ')}
                        </Typography>
                      )
                    })}
                  </Stack>

                  {action !== null && (
                    <Button
                      size="small"
                      variant={action === 'add' || action === 'upgrade' ? 'contained' : 'text'}
                      color={action === 'remove' || action === 'downgrade' ? 'error' : 'primary'}
                      disabled={busy
                        || (unavailable && action !== 'remove')
                        || (isTrial && action === 'remove' && !allowTrialRemoval)}
                      onClick={() => onChoose(plan, action)}
                    >
                      {isTrial && action === 'upgrade'
                        ? t($ => $.modules.select)
                        : t($ => $.modules[ACTION_KEYS[action]])}
                    </Button>
                  )}
                </Stack>
              </Paper>
            )
          })}
      </Stack>

      {isTrial && module === null && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          {t($ => $.trial.addSecond)}
        </Typography>
      )}
    </Paper>
  )
}
