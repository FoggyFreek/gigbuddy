import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { getBillingState } from '../../api/billing.ts'
import type { BillingState } from '../../api/billing.ts'
import { planLogoSrc } from '../../utils/planLogo.ts'

// Subscription statuses with a label under billing:status. Unknown values fall
// back to the raw status string.
const STATUS_KEYS = {
  pending_mandate: 'pending_mandate',
  pending_activation: 'pending_activation',
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
} as const

// Compact current-subscription banner shown atop the settings page. Reads the
// billing state and links through to the full billing section.
export default function SubscriptionSummaryCard() {
  const { t } = useTranslation(['settings', 'billing'])
  const navigate = useNavigate()
  const [state, setState] = useState<BillingState | null>(null)

  useEffect(() => {
    getBillingState().then(setState).catch(() => {})
  }, [])

  if (!state) return null

  const sub = state.subscription ?? null
  const plans = (state.plans ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)
  const fallbackPlan = plans.find((p) => p.is_fallback) ?? null
  const currentPlan = sub ? plans.find((p) => p.id === sub.planId) ?? null : fallbackPlan
  const planName = currentPlan?.name ?? t($ => $.current.freePlanName, { ns: 'billing' })
  const statusLabel = sub && sub.status in STATUS_KEYS
    ? t($ => $.status[STATUS_KEYS[sub.status as keyof typeof STATUS_KEYS]], { ns: 'billing' })
    : sub?.status
  const logo = planLogoSrc(currentPlan?.slug)

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      {logo && <Box component="img" src={logo} alt="" sx={{ height: 28, width: 'auto' }} />}
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          {t($ => $.subscription.current)}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{planName}</Typography>
          {sub && <Chip size="small" label={statusLabel} />}
          {sub?.isComplimentary && (
            <Chip size="small" color="secondary" label={t($ => $.current.complimentary, { ns: 'billing' })} />
          )}
        </Box>
      </Box>
      <Button size="small" variant="outlined" onClick={() => navigate('/settings/billing')}>
        {t($ => $.subscription.manage)}
      </Button>
    </Paper>
  )
}
