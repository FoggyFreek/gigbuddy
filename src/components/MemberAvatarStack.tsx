import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import { darken, lighten } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

const STATUS_SX: Record<string, object> = {
  available: { bgcolor: 'success.dark' },
  unavailable: { bgcolor: 'error.dark', opacity: 0.6 },
}

interface AvatarMember {
  member_id?: number | string
  name?: string
  status?: string
  position?: string
  reason?: string
  color?: string
}

interface MemberAvatarStackProps {
  members?: AvatarMember[]
}

export default function MemberAvatarStack({ members }: Readonly<MemberAvatarStackProps>) {
  if (!members?.length) return null

  const visible = members.filter(
    (m) => m.position === 'lead' || !m.position || m.status === 'available',
  )

  if (!visible.length) return null

  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      {visible.map((m, i) => (
        <Tooltip
          key={m.member_id}
          title={m.status === 'unavailable' && m.reason ? `${m.name} — ${m.reason}` : m.name}
        >
          <Avatar
            sx={{
              width: 26,
              height: 26,
              fontSize: '0.6rem',
              fontWeight: 700,
              ml: i === 0 ? 0 : '-6px',
              border: '2px solid',
              borderColor: 'background.paper',
              zIndex: visible.length - i,
              bgcolor: (t: Theme) =>
                t.palette.mode === 'light'
                  ? darken(t.palette.background.paper, 0.14)
                  : lighten(t.palette.background.paper, 0.18),
              ...STATUS_SX[m.status ?? ''],
            }}
          >
            {getInitials(m.name ?? '')}
          </Avatar>
        </Tooltip>
      ))}
    </Box>
  )
}
