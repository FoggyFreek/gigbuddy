import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import DiamondOutlined from '@mui/icons-material/DiamondOutlined'
import { useEntitlements } from '../hooks/useEntitlements.ts'
import type { Feature } from '../auth/entitlements.ts'

// Diamond marker for a plan-gated section: rendered next to the section header
// when the current plan lacks the feature, linking to its upsell page (same
// convention as the diamond-locked nav items). Renders nothing when entitled.
export default function PremiumDiamond({ feature }: Readonly<{ feature: Feature }>) {
  const { t } = useTranslation('common')
  const { has } = useEntitlements()
  if (has(feature)) return null
  return (
    <Tooltip title={t($ => $.premium.tooltip)}>
      <IconButton
        component={RouterLink}
        to={`/upgrade/${feature}`}
        size="small"
        aria-label={t($ => $.premium.tooltip)}
      >
        <DiamondOutlined fontSize="small" color="secondary" />
      </IconButton>
    </Tooltip>
  )
}
