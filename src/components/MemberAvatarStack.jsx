import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'

function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const STATUS_SX = {
  available: { bgcolor: 'success.dark' },
  unavailable: { bgcolor: 'error.dark', opacity: 0.6 },
}

export default function MemberAvatarStack({ members }) {
  if (!members?.length) return null

  const visible = members.filter(
    m => m.position === 'lead' || !m.position || m.status === 'available'
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
              bgcolor: 'grey.400',
              ...STATUS_SX[m.status],
            }}
          >
            {getInitials(m.name)}
          </Avatar>
        </Tooltip>
      ))}
    </Box>
  )
}
