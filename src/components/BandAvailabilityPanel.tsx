import { useEffect, useRef, useState } from 'react'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { getAvailabilityOn, getAvailabilitySpan } from '../api/availability.ts'
import type { AvailabilitySummary } from '../types/entities.ts'

export type AvailabilityData = AvailabilitySummary

interface BandAvailabilityPanelProps {
  eventDate?: string
  /** Present for a multi-day span (e.g. a band event); omitted or equal to eventDate for a single day. */
  endDate?: string
  onDataLoad?: (data: AvailabilityData | null) => void
}

export default function BandAvailabilityPanel({ eventDate, endDate, onDataLoad }: Readonly<BandAvailabilityPanelProps>) {
  const [data, setData] = useState<AvailabilityData | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!eventDate) return

    clearTimeout(timerRef.current ?? undefined)
    timerRef.current = setTimeout(() => {
      if (endDate && endDate < eventDate) {
        setData(null)
        onDataLoad?.(null)
        return
      }
      const request = endDate && endDate !== eventDate
        ? getAvailabilitySpan(eventDate, endDate)
        : getAvailabilityOn(eventDate)
      request
        .then((data) => { setData(data); onDataLoad?.(data) })
        .catch(() => { setData(null); onDataLoad?.(null) })
    }, 300)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [eventDate, endDate, onDataLoad])

  if (!eventDate || !data?.members?.length) return null

  const visible = data.members.filter((m) => m.position === 'lead')

  if (!visible.length) return null

  return (
    <Stack spacing={0.5}>
      {data.bandWide && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Band-wide: {data.bandWide.status}{data.bandWide.reason ? ` — ${data.bandWide.reason}` : ''}
        </Typography>
      )}
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', minWidth: 0 }}>
        {visible.map((m) => {
          if (m.status === 'available') {
            return (
              <Chip
                key={String(m.member_id)}
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
              <Tooltip key={String(m.member_id)} title={label}>
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
              key={String(m.member_id)}
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
