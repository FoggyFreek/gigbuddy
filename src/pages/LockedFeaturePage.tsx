import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import DiamondOutlined from '@mui/icons-material/DiamondOutlined'
import { planFeatureKey } from '../utils/planFeatureKey.ts'

// Upsell landing for a tier-locked feature. Reached from a diamond nav item.
// Placeholder for now — the intent is to show feature screenshots here so users
// can see what a higher plan unlocks. Always routes users toward /settings/billing.
export default function LockedFeaturePage() {
  const { t, i18n } = useTranslation('billing')
  const { feature } = useParams()
  const navigate = useNavigate()
  const featureKey = feature ? planFeatureKey(feature) : null
  const label = featureKey ? t($ => $.features[featureKey]) : t($ => $.locked.fallbackFeature)

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: { xs: 4, md: 8 } }}>
      <Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, maxWidth: 560, textAlign: 'center' }}>
        <DiamondOutlined color="secondary" sx={{ fontSize: 48, mb: 2 }} />
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
          {t($ => $.locked.title, { feature: label })}
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mb: 3 }}>
          {t($ => $.locked.description, { feature: label.toLocaleLowerCase(i18n.resolvedLanguage) })}
        </Typography>
        <Button variant="contained" onClick={() => navigate('/settings/billing')}>
          {t($ => $.locked.viewPlans)}
        </Button>
      </Paper>
    </Box>
  )
}
