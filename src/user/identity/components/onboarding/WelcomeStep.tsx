import { Trans, useTranslation } from 'react-i18next'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import type { BillingInterval, SubscriptionPlan } from '../../../../commerce/billing/billing.ts'
import type { TenantKind } from '../../../../auth/tenantKinds.ts'
import OnboardingPlanCard from './OnboardingPlanCard.tsx'
import WorkspaceKindChoice from './WorkspaceKindChoice.tsx'

interface WelcomeStepProps {
  kind: TenantKind
  onKindChange: (kind: TenantKind) => void
  showKindChoice: boolean
  /** Already filtered to the ladder the chosen kind is billed on. */
  plans: SubscriptionPlan[]
  interval: BillingInterval
  onIntervalChange: (interval: BillingInterval) => void
  selectedPlanId: number | null
  onSelectPlan: (planId: number) => void
  termsAgreed: boolean
  onTermsAgreedChange: (agreed: boolean) => void
  onOpenTerms: () => void
}

// The workspace kind is chosen here rather than on the next step because it
// decides WHICH product the plans below belong to — band and artist are
// separate ladders, so the grid cannot be rendered before the kind is known.
export default function WelcomeStep({
  kind,
  onKindChange,
  showKindChoice,
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

      {showKindChoice && <WorkspaceKindChoice value={kind} onChange={onKindChange} />}

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
