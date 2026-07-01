import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import CampaignIcon from '@mui/icons-material/Campaign'
import LiveHelpIcon from '@mui/icons-material/LiveHelp'
import type { SvgIconComponent } from '@mui/icons-material'
import { STATUS_COLORS, STATUS_LABELS } from '../utils/gigStatus.ts'

const STATUS_ICONS: Record<string, SvgIconComponent> = {
  option: LiveHelpIcon,
  confirmed: EventAvailableIcon,
  announced: CampaignIcon,
}

interface GigStatusIconProps {
  status?: string | null
  size?: number
}

// Renders the gig status as an icon on a circular background tinted with the
// status colour.
export default function GigStatusIcon({ status, size = 28 }: Readonly<GigStatusIconProps>) {
  const key = status ?? ''
  const Icon = STATUS_ICONS[key] ?? LiveHelpIcon
  const color = STATUS_COLORS[key] || 'default'
  return (
    <Tooltip title={STATUS_LABELS[key] || status || ''} arrow>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: (t) => (color === 'default' ? t.palette.grey[600] : t.palette[color].main),
          color: (t) => (color === 'default' ? t.palette.getContrastText(t.palette.grey[600]) : t.palette[color].contrastText),
        }}
      >
        <Icon sx={{ fontSize: size * 0.6 }} />
      </Box>
    </Tooltip>
  )
}
