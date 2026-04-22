import { useEffect, useRef, useState } from 'react'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { getAvailabilityOn } from '../api/availability.js'

export default function GigAvailabilityPanel({ eventDate, onDataLoad }) {
  const [data, setData] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!eventDate) return

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      getAvailabilityOn(eventDate)
        .then((d) => { setData(d); onDataLoad?.(d) })
        .catch(() => { setData(null); onDataLoad?.(null) })
    }, 300)

    return () => clearTimeout(timerRef.current)
  }, [eventDate, onDataLoad])

  if (!eventDate || !data || !data.members?.length) return null

  const visible = data.members.filter((m) =>
    m.position === 'lead' || !m.position || m.status === 'available'
  )

  if (!visible.length) return null

  return (
    <Stack spacing={0.5}>
      {data.bandWide && (
        <Typography variant="caption" color="text.secondary">
          Band-wide: {data.bandWide.status}{data.bandWide.reason ? ` — ${data.bandWide.reason}` : ''}
        </Typography>
      )}
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', minWidth: 0 }}>
        {visible.map((m) => {
          if (m.status === 'available') {
            return (
              <Chip
                key={m.member_id}
                label={m.name}
                color="success"
                size="small"
                sx={{ maxWidth: '100%' }}
              />
            )
          }
          if (m.status === 'unavailable') {
            const label = m.reason ? `${m.name} — ${m.reason}` : m.name
            return (
              <Tooltip key={m.member_id} title={label}>
                <Chip
                  label={label}
                  color="error"
                  size="small"
                  sx={{ maxWidth: { xs: '100%', sm: 200 } }}
                />
              </Tooltip>
            )
          }
          return (
            <Chip
              key={m.member_id}
              label={m.name}
              variant="outlined"
              size="small"
              sx={{ maxWidth: '100%' }}
            />
          )
        })}
      </Stack>
    </Stack>
  )
}
