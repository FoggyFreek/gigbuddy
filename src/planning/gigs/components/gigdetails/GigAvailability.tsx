import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import GigContactsSection from './GigContactsSection.tsx'
import BandParticipantsSection from '../../../../components/BandParticipantsSection.tsx'
import useEventAvailability from '../../../shared/useEventAvailability.ts'
import type { AvailabilityStatus, AvailabilitySummary, Id, Member, Participant } from '../../../../types/entities.ts'

// Split into columns on the container's own width, not the viewport's: this tab
// also renders inside the SplitView detail pane, which is narrower than the page.
const TWO_COLUMN_MIN_WIDTH = 760

interface Props {
  active: boolean
  editable: boolean
  gigId: Id
  showAvailability: boolean
  eventDate: string
  endDate?: string | null
  eventStatus?: string | null
  startTime?: string | null
  endTime?: string | null
  participants: Participant[]
  candidateMembers: Member[]
  venueId?: Id
  festivalId?: Id
  flush: () => Promise<void>
  onAddParticipant: (memberId: Id) => void
  onRemoveParticipant: (memberId: Id) => void
  onVote: (memberId: Id, vote: string | null) => void
  onAvailabilityChange?: (availability: AvailabilitySummary | null) => void
}

export default function GigAvailability({
  active,
  editable,
  gigId,
  showAvailability,
  eventDate,
  endDate,
  eventStatus,
  startTime,
  endTime,
  participants,
  candidateMembers,
  venueId,
  festivalId,
  flush,
  onAddParticipant,
  onRemoveParticipant,
  onVote,
  onAvailabilityChange,
}: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const { t: tAvailability } = useTranslation('availability')
  const participantIds = participants.flatMap((participant) =>
    participant.band_member_id === undefined ? [] : [participant.band_member_id])
  const availability = useEventAvailability({
    eventDate: showAvailability ? eventDate : undefined,
    endDate: endDate ?? undefined,
    eventType: 'gig',
    eventId: gigId,
    startTime,
    endTime,
    participantIds,
    onDataLoad: onAvailabilityChange,
  })

  function availabilityLabel(status: AvailabilityStatus | undefined) {
    if (status === 'available') return tAvailability($ => $.status.available)
    if (status === 'travel_margin') return tAvailability($ => $.status.travel_margin)
    if (status === 'unavailable') return tAvailability($ => $.status.unavailable)
    return null
  }

  function renderAvailability(participant: Participant) {
    const member = availability?.members.find(
      (candidate) => candidate.member_id === participant.band_member_id,
    )
    const label = availabilityLabel(member?.status)
    if (!member || !label) return null

    const chip = (
      <Chip
        size="small"
        label={label}
        color={member.status === 'available'
          ? 'success'
          : member.status === 'unavailable'
            ? 'error'
            : 'warning'}
      />
    )

    return member.reason ? (
      <Tooltip title={`${participant.name} — ${member.reason}`}>{chip}</Tooltip>
    ) : chip
  }

  const bandWideLabel = availabilityLabel(availability?.bandWide?.status)

  return (
    <Box sx={{ display: active ? 'block' : 'none', containerType: 'inline-size' }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 2,
          '& > *': { flex: '1 1 100%', minWidth: 0 },
          [`@container (min-width: ${TWO_COLUMN_MIN_WIDTH}px)`]: {
            '& > *': { flex: '1 1 0' },
          },
        }}
      >
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.detail.participants)}
          </Typography>
          <BandParticipantsSection
            participants={participants}
            eventDate={eventDate}
            eventStatus={eventStatus}
            candidateMembers={candidateMembers}
            emptyText={t($ => $.participants.noParticipants)}
            addParticipantLabel={t($ => $.participants.addParticipant)}
            getRemoveParticipantLabel={(participant) => t($ => $.participants.removeParticipant, { name: participant.name })}
            onAddParticipant={onAddParticipant}
            onRemoveParticipant={onRemoveParticipant}
            onVote={onVote}
            canWrite={editable}
            headerContent={showAvailability && availability?.bandWide && bandWideLabel ? (
              <Typography variant="caption" color="text.secondary">
                {tAvailability($ => $.events.bandWide)}: {bandWideLabel}
                {availability.bandWide.reason ? ` — ${availability.bandWide.reason}` : ''}
              </Typography>
            ) : null}
            renderParticipantEnd={showAvailability ? renderAvailability : undefined}
          />
        </Box>
        <Box>
          <Divider
            sx={{
              my: 1,
              [`@container (min-width: ${TWO_COLUMN_MIN_WIDTH}px)`]: { display: 'none' },
            }}
          />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.detail.contacts)}
          </Typography>
          <GigContactsSection
            gigId={gigId}
            venueId={venueId}
            festivalId={festivalId}
            flush={flush}
            canWrite={editable}
          />
        </Box>
      </Box>
    </Box>
  )
}
