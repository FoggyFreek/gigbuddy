import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import SourceTenantIdentity from '../../components/SourceTenantIdentity.tsx'
import { identityInitials } from '../../utils/identityInitials.ts'
import type { Id, MyBandRef } from '../../types/entities.ts'

interface PlanningSource {
  my_band?: MyBandRef | null
  tenantId?: Id
  tenantName?: string | null
  tenantAvatarPath?: string | null
}

interface Props {
  source: PlanningSource
  withName?: boolean
}

function TextAvatarIdentity({ name, withName }: Readonly<{
  name: string | null | undefined
  withName: boolean
}>) {
  const label = name?.trim() || '—'
  const avatar = (
    <Avatar aria-label={name ?? ''} sx={{ width: 28, height: 28, fontSize: 12 }}>
      {identityInitials(label)}
    </Avatar>
  )

  return withName ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      {avatar}
      <Typography variant="body2" noWrap>{label}</Typography>
    </Box>
  ) : <Tooltip title={label}>{avatar}</Tooltip>
}

export default function PlanningSourceIdentity({ source, withName = false }: Readonly<Props>) {
  if (source.my_band) return <TextAvatarIdentity name={source.my_band.name} withName={withName} />
  if (!source.tenantAvatarPath) return <TextAvatarIdentity name={source.tenantName} withName={withName} />

  return (
    <SourceTenantIdentity
      tenantId={source.tenantId}
      tenantName={source.tenantName}
      tenantAvatarPath={source.tenantAvatarPath}
      withName={withName}
    />
  )
}
