import type { AvailabilityStatus, Rehearsal, Member, Id, Participant } from '../../../types/entities.ts'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import BandParticipantsSection from '../../../components/BandParticipantsSection.tsx'
import useEventAvailability from '../../shared/useEventAvailability.ts'

interface RehearsalParticipantsSectionProps {
  rehearsal: Rehearsal
  members?: Member[]
  onVote?: (memberId: Id | undefined, vote: string | null) => void
  onRemoveParticipant?: (memberId: Id | undefined) => void
  onAddParticipant?: (memberId: Id) => void
  onPromote?: () => void
  onDemote?: () => void
  // Presentation gating for readers: when false, only the current member's own
  // vote control is shown; all add/remove/promote/demote controls are hidden.
  canWrite?: boolean
  currentMemberId?: Id | null
  showAvailability?: boolean
}

export default function RehearsalParticipantsSection({
  rehearsal,
  members = [],
  onVote,
  onRemoveParticipant,
  onAddParticipant,
  onPromote,
  onDemote,
  canWrite = true,
  currentMemberId = null,
  showAvailability = false,
}: Readonly<RehearsalParticipantsSectionProps>) {
  const { t } = useTranslation(['rehearsals', 'common'])
  const { t: tAvailability } = useTranslation('availability')
  const participantIds = useMemo(
    () => new Set((rehearsal.participants ?? []).map((p) => p.band_member_id)),
    [rehearsal],
  )
  const candidateMembers = members.filter((m) => !participantIds.has(m.id))
  const allYes =
    (rehearsal.participants?.length ?? 0) > 0 &&
    rehearsal.participants?.every((p) => p.vote === 'yes')
  const isPlanned = rehearsal.status === 'planned'
  const statusKey = isPlanned ? 'planned' : 'option'
  const availability = useEventAvailability({
    eventDate: showAvailability ? rehearsal.proposed_date : undefined,
    eventType: 'rehearsal',
    eventId: rehearsal.id,
    startTime: rehearsal.start_time,
    endTime: rehearsal.end_time,
    participantIds: [...participantIds].flatMap((id) => id === undefined ? [] : [id]),
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
    <>
      <Grid size={12}>
        <Divider sx={{ my: 1 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{t($ => $.participants.status)}</Typography>
          <Chip
            label={t($ => $.status[statusKey])}
            color={isPlanned ? 'primary' : 'default'}
            size="small"
          />
          <Box sx={{ flexGrow: 1 }} />
          {canWrite && (
            rehearsal.status === 'option' ? (
              <Button variant="contained" disabled={!allYes} onClick={onPromote}>
                {t($ => $.participants.planThisRehearsal)}
              </Button>
            ) : (
              <Button variant="outlined" onClick={onDemote}>{t($ => $.participants.revertToOption)}</Button>
            )
          )}
        </Box>
        {rehearsal.status === 'option' && !allYes && (
          <Typography variant="caption" color="text.secondary">
            {t($ => $.participants.planHint)}
          </Typography>
        )}
      </Grid>

      <Grid size={12}>
        <Divider sx={{ my: 1 }} />
        {!isPlanned && (
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.participants.requiredParticipants)}
          </Typography>
        )}
        <BandParticipantsSection
          participants={rehearsal.participants ?? []}
          eventDate={rehearsal.proposed_date}
          eventStatus={rehearsal.status}
          candidateMembers={isPlanned ? [] : candidateMembers}
          emptyText={t($ => $.participants.noParticipants)}
          addParticipantLabel={t($ => $.participants.addParticipant)}
          getRemoveParticipantLabel={(participant) => t($ => $.participants.removeParticipant, { name: participant.name })}
          onAddParticipant={onAddParticipant}
          onRemoveParticipant={onRemoveParticipant
            ? (memberId) => onRemoveParticipant(memberId)
            : undefined}
          onVote={onVote ? (memberId, vote) => onVote(memberId, vote) : undefined}
          canWrite={canWrite && !isPlanned}
          shouldShowVote={(participant) => canWrite || participant.band_member_id === currentMemberId}
          canVote={(participant) => canWrite || participant.band_member_id === currentMemberId}
          headerContent={showAvailability && availability?.bandWide && bandWideLabel ? (
            <Typography variant="caption" color="text.secondary">
              {tAvailability($ => $.events.bandWide)}: {bandWideLabel}
              {availability.bandWide.reason ? ` — ${availability.bandWide.reason}` : ''}
            </Typography>
          ) : null}
          renderParticipantEnd={showAvailability ? renderAvailability : undefined}
        />
      </Grid>
    </>
  )
}
