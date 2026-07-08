import { Trans, useTranslation } from 'react-i18next'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import type { BillingInterval, SubscriptionPlan } from '../../api/billing.ts'
import OnboardingPlanCard from './OnboardingPlanCard.tsx'

interface WelcomeStepProps {
  plans: SubscriptionPlan[]
  interval: BillingInterval
  onIntervalChange: (interval: BillingInterval) => void
  selectedPlanId: number | null
  onSelectPlan: (planId: number) => void
  termsAgreed: boolean
  onTermsAgreedChange: (agreed: boolean) => void
  onOpenTerms: () => void
}

export default function WelcomeStep({
  plans,
  interval,
  onIntervalChange,
  selectedPlanId,
  onSelectPlan,
  termsAgreed,
  onTermsAgreedChange,
  onOpenTerms,
}: Readonly<WelcomeStepProps>) {
  const { t } = useTranslation(['onboarding', 'billing'])

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography variant="body1">{t($ => $.welcome.subtitle)}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t($ => $.welcome.trialPitch)}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Typography variant="h6">{t($ => $.welcome.choosePlan)}</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={interval}
          onChange={(_e, value: BillingInterval | null) => {
            if (value) onIntervalChange(value)
          }}
        >
          <ToggleButton value="month">{t($ => $.billing.plans.monthly)}</ToggleButton>
          <ToggleButton value="year">{t($ => $.billing.plans.yearly)}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'stretch' }}>
        {plans.map((plan) => (
          <OnboardingPlanCard
            key={plan.id}
            plan={plan}
            interval={interval}
            selected={plan.id === selectedPlanId}
            onSelect={onSelectPlan}
          />
        ))}
      </Stack>

      <FormControlLabel
        control={
          <Checkbox
            checked={termsAgreed}
            onChange={(e) => onTermsAgreedChange(e.target.checked)}
          />
        }
        label={
          <Trans
            t={t}
            i18nKey={($) => $.terms.agreeLabel}
            components={{
              termsLink: (
                <Link
                  component="button"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    onOpenTerms()
                  }}
                />
              ),
            }}
          />
        }
      />
    </Stack>
  )
}
