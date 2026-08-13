import { useTranslation } from 'react-i18next'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useEventAvailability from '../../shared/useEventAvailability.ts'
import type { AvailabilitySummary, Id } from '../../../types/entities.ts'

export type AvailabilityData = AvailabilitySummary

interface BandAvailabilityPanelProps {
  eventDate?: string
  /** Present for a multi-day span (e.g. a band event); omitted or equal to eventDate for a single day. */
  endDate?: string
  eventType?: 'gig' | 'rehearsal' | 'band_event'
  eventId?: Id
  startTime?: string | null
  endTime?: string | null
  participantIds?: Id[]
  onDataLoad?: (data: AvailabilityData | null) => void
}

export default function BandAvailabilityPanel({
  eventDate,
  endDate,
  eventType = 'band_event',
  eventId,
  startTime,
  endTime,
  participantIds,
  onDataLoad,
}: Readonly<BandAvailabilityPanelProps>) {
  const { t } = useTranslation('availability')
  const data = useEventAvailability({
    eventDate,
    endDate,
    eventType,
    eventId,
    startTime,
    endTime,
    participantIds,
    onDataLoad,
  })

  // The whole panel is a function of the date, so say so rather than leaving a
  // blank gap under the heading while the form is still empty.
  if (!eventDate) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t($ => $.events.awaitingDate)}
      </Typography>
    )
  }

  if (!data?.members?.length) return null

  const visible = participantIds === undefined && eventId === undefined
    ? data.members.filter((member) => member.position === 'lead')
    : data.members

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
            const tooltip = m.reason ? `${m.name} — ${m.reason}` : m.name
            return (
              <Tooltip key={String(m.member_id)} title={tooltip}>
                <Chip
                  label={m.name}
                  color="error"
                  size="small"
                  sx={{ maxWidth: { xs: '100%', sm: 200 } }}
                />
              </Tooltip>
            )
          }
          if (m.status === 'travel_margin') {
            const tooltip = m.reason ? `${m.name} — ${m.reason}` : m.name
            return (
              <Tooltip key={String(m.member_id)} title={tooltip}>
                <Chip label={m.name} color="warning" size="small" sx={{ maxWidth: { xs: '100%', sm: 200 } }} />
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
