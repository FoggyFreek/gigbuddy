import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
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
}: Readonly<SourceTenantIdentityProps>) {
  const { switchTenant } = useAuth()
  const { t } = useTranslation('common')
  const initial = tenantName?.trim().charAt(0).toUpperCase() || '?'
  return (
    <Paper
      variant="outlined"
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, mb: 2 }}
      data-testid="source-tenant-switch"
    >
      <Avatar
        src={tenantAvatarUrl(tenantId, tenantAvatarPath)}
        alt={tenantName ?? ''}
        sx={{ width: 36, height: 36 }}
      >
        {initial}
      </Avatar>
      <Typography sx={{ flex: 1, fontWeight: 600 }}>{tenantName || '—'}</Typography>
      <Button
        variant="outlined"
        size="small"
        disabled={tenantId == null}
        onClick={() => { if (tenantId != null) void switchTenant(tenantId) }}
      >
        {t($ => $.actions.switchToBand)}
      </Button>
    </Paper>
  )
}
