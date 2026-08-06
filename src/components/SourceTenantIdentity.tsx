import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import SyncIcon from '@mui/icons-material/Sync'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'
import { useAuth } from '../contexts/authContext.ts'
import type { Id } from '../types/entities.ts'
import { useTranslation } from 'react-i18next'
import { tenantAvatarUrl } from '../utils/tenantAvatarUrl.ts'

interface SourceTenantIdentityProps {
  tenantId?: Id
  tenantName?: string | null
  tenantAvatarPath?: string | null
  withName?: boolean
}

export default function SourceTenantIdentity({
  tenantId,
  tenantName,
  tenantAvatarPath,
  withName = false,
}: Readonly<SourceTenantIdentityProps>) {
  const src = tenantAvatarUrl(tenantId, tenantAvatarPath)
  if (!src) return <Typography variant="body2">{tenantName || '—'}</Typography>
  const avatar = <Avatar src={src} alt={tenantName ?? ''} sx={{ width: 28, height: 28 }} />
  return withName ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      {avatar}
      <Typography variant="body2" noWrap>{tenantName || '—'}</Typography>
    </Box>
  ) : <Tooltip title={tenantName ?? ''}>{avatar}</Tooltip>
}

export function SourceTenantSwitch({
  tenantId,
  tenantName,
  tenantAvatarPath,
  sx,
  size = 48,
}: Readonly<SourceTenantIdentityProps & { sx?: SxProps<Theme>; size?: number }>) {
  const { switchTenant } = useAuth()
  const { t } = useTranslation('common')
  const initial = tenantName?.trim().charAt(0).toUpperCase() || '?'
  return (
    <Box
      sx={[
        {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0.5,
          mb: 2,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      data-testid="source-tenant-switch"
    >
      <Box sx={{ position: 'relative', display: 'inline-flex' }}>
        <Avatar
          src={tenantAvatarUrl(tenantId, tenantAvatarPath)}
          alt={tenantName ?? ''}
          sx={{ width: size, height: size, fontSize: size / 2.5 }}
        >
          {initial}
        </Avatar>
        <Tooltip title={t($ => $.actions.switchToBand)}>
          <span style={{ position: 'absolute', right: -6, bottom: -6 }}>
            <IconButton
              size="small"
              aria-label={t($ => $.actions.switchToBand)}
              disabled={tenantId == null}
              onClick={() => { if (tenantId != null) void switchTenant(tenantId) }}
              sx={{
                p: 0.5,
                bgcolor: 'background.paper',
                border: 1,
                borderColor: 'divider',
                '&:hover': { bgcolor: 'background.paper' },
                '& .MuiSvgIcon-root': {
                  fontSize: 16,
                  transition: theme => theme.transitions.create('transform'),
                },
                '&:hover .MuiSvgIcon-root': { transform: 'rotate(30deg)' },
              }}
            >
              <SyncIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <Typography sx={{ fontWeight: 600, textAlign: 'center' }}>{tenantName || '—'}</Typography>
    </Box>
  )
}
