import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import GigContactsSection from './GigContactsSection.tsx'
import BandParticipantsSection from '../BandParticipantsSection.tsx'
import useEventAvailability from '../../hooks/useEventAvailability.ts'
import type { AvailabilityStatus, AvailabilitySummary, Id, Member, Participant } from '../../types/entities.ts'

interface Props {
  active: boolean
  editable: boolean
  gigId: Id
  showAvailability: boolean
  eventDate: string
  eventStatus?: string | null
  startTime?: string | null
  endTime?: string | null
  participants: Participant[]
  candidateMembers: Member[]
  addMemberId: Id | ''
  venueId?: Id
  festivalId?: Id
  flush: () => Promise<void>
  onAddMemberChange: (memberId: Id | '') => void
  onAddParticipant: () => void
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
  eventStatus,
  startTime,
  endTime,
  participants,
  candidateMembers,
  addMemberId,
  venueId,
  festivalId,
  flush,
  onAddMemberChange,
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
    <Box sx={{ display: active ? 'block' : 'none' }}>
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.detail.participants)}
          </Typography>
          <BandParticipantsSection
            participants={participants}
            eventDate={eventDate}
            eventStatus={eventStatus}
            candidateMembers={candidateMembers}
            addMemberId={addMemberId}
            emptyText={t($ => $.participants.noParticipants)}
            addParticipantLabel={t($ => $.participants.addParticipant)}
            getRemoveParticipantLabel={(participant) => t($ => $.participants.removeParticipant, { name: participant.name })}
            onAddMemberChange={onAddMemberChange}
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
        </Grid>
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
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
        </Grid>
      </Grid>
    </Box>
  )
}
