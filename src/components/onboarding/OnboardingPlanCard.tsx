import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { BillingInterval, SubscriptionPlan } from '../../api/billing.ts'
import { priceForInterval } from '../../api/billing.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { planFeatureKey } from '../../utils/planFeatureKey.ts'
import { planLogoSrc } from '../../utils/planLogo.ts'

interface OnboardingPlanCardProps {
  plan: SubscriptionPlan
  interval: BillingInterval
  selected: boolean
  onSelect: (planId: number) => void
}

// Lean plan tile for the onboarding welcome step: pick one, no
// subscribe/upgrade/downgrade state like BillingSettingsSection's PlanCard.
export default function OnboardingPlanCard({
  plan,
  interval,
  selected,
  onSelect,
}: Readonly<OnboardingPlanCardProps>) {
  const { t } = useTranslation(['billing', 'onboarding'])
  const price = priceForInterval(plan, interval)
  const logo = planLogoSrc(plan.slug)
  const features = Object.entries(plan.entitlements.features)
    .filter(([, enabled]) => enabled)
    .map(([feature]) => planFeatureKey(feature))
    .filter((key) => key !== null)
  const limits = plan.entitlements.limits

  let priceLabel: string
  if (plan.is_fallback) {
    priceLabel = t($ => $.onboarding.welcome.free)
  } else if (price === null) {
    priceLabel = t($ => $.plans.notAvailable)
  } else if (interval === 'year') {
    priceLabel = t($ => $.plans.perYear, { price: formatEur(price) })
  } else {
    priceLabel = t($ => $.plans.perMonth, { price: formatEur(price) })
  }

  const limitText = (label: string, value: number | null) =>
    `${label}: ${value === null ? t($ => $.limits.unlimited) : value}`

  return (
    <Card
      variant="outlined"
      sx={{
        flex: 1,
        minWidth: 200,
        borderColor: selected ? 'primary.main' : 'divider',
        borderWidth: selected ? 2 : 1,
      }}
    >
      <CardActionArea
        onClick={() => onSelect(plan.id)}
        aria-pressed={selected}
        sx={{ p: 2, height: '100%', alignItems: 'stretch' }}
      >
        <Stack spacing={1} sx={{ height: '100%' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {logo && (
              <Box component="img" src={logo} alt="" sx={{ width: 28, height: 28 }} />
            )}
            <Typography variant="h6">{plan.name}</Typography>
          </Stack>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {priceLabel}
          </Typography>
          <Stack spacing={0.25}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {limitText(t($ => $.limits.storage_mb), limits.storage_mb ?? null)}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {limitText(t($ => $.limits.members), limits.members ?? null)}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {limitText(t($ => $.limits.bands), limits.bands ?? null)}
            </Typography>
          </Stack>
          {features.length > 0 && (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {features.map((key) => (
                <Chip key={key} size="small" label={t($ => $.features[key])} />
              ))}
            </Stack>
          )}
          {selected && (
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>
              {t($ => $.onboarding.welcome.selected)}
            </Typography>
          )}
        </Stack>
      </CardActionArea>
    </Card>
  )
}
