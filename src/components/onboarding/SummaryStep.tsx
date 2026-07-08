import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { BillingInterval, SubscriptionPlan } from '../../api/billing.ts'
import { priceForInterval } from '../../api/billing.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { slugFromBandName } from '../../utils/slugify.ts'

interface SummaryStepProps {
  plan: SubscriptionPlan
  interval: BillingInterval
  bandName: string
  /** Slug of the already-created band when resuming, else null (preview). */
  resumedSlug: string | null
  resumedBandName: string | null
  logoFileName: string | null
}

export default function SummaryStep({
  plan,
  interval,
  bandName,
  resumedSlug,
  resumedBandName,
  logoFileName,
}: Readonly<SummaryStepProps>) {
  const { t } = useTranslation(['onboarding', 'billing'])
  const price = priceForInterval(plan, interval)
  const slug = resumedSlug ?? slugFromBandName(bandName)

  let priceLabel: string
  if (plan.is_fallback) {
    priceLabel = t($ => $.welcome.free)
  } else if (price === null) {
    priceLabel = t($ => $.billing.plans.notAvailable)
  } else if (interval === 'year') {
    priceLabel = t($ => $.billing.plans.perYear, { price: formatEur(price) })
  } else {
    priceLabel = t($ => $.billing.plans.perMonth, { price: formatEur(price) })
  }

  const row = (label: string, value: string) => (
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>
        {value}
      </Typography>
    </Stack>
  )

  return (
    <Stack spacing={3}>
      <Typography variant="h6">{t($ => $.summary.title)}</Typography>

      {resumedBandName !== null && (
        <Alert severity="info">{t($ => $.summary.resumeNote, { name: resumedBandName })}</Alert>
      )}

      <Stack spacing={1}>
        {row(t($ => $.summary.plan), `${plan.name} — ${priceLabel}`)}
        {row(
          t($ => $.summary.interval),
          interval === 'year' ? t($ => $.summary.yearly) : t($ => $.summary.monthly),
        )}
        {row(t($ => $.summary.band), bandName)}
        {row(t($ => $.summary.slug), slug)}
        {row(t($ => $.summary.logo), logoFileName ?? t($ => $.summary.noLogo))}
      </Stack>

      {resumedSlug === null && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t($ => $.band.slugCaveat, { slug })}
        </Typography>
      )}

      <Alert severity="info">
        {plan.is_fallback ? t($ => $.summary.freeNote) : t($ => $.summary.paymentNote)}
      </Alert>
    </Stack>
  )
}
