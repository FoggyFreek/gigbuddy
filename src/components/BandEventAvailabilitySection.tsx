import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { AVAILABILITY_STATUS_COLORS } from '../utils/availabilityUtils.ts'
import type { AvailabilityDay, AvailabilityStatus, Id, Member, MemberAvailability, Participant } from '../types/entities.ts'
import BandParticipantsSection from './BandParticipantsSection.tsx'

interface BandEventAvailabilitySectionProps {
  members?: MemberAvailability[]
  days?: AvailabilityDay[]
  candidateMembers?: Member[]
  canWrite?: boolean
  onAddMember?: (memberId: Id) => void | Promise<void>
  onRemoveMember?: (memberId: Id) => void | Promise<void>
}

const CHIP_COLOR: Record<string, 'success' | 'error' | 'default'> = {
  available: 'success',
  unavailable: 'error',
}

function statusColor(status: AvailabilityStatus | undefined) {
  return AVAILABILITY_STATUS_COLORS[status ?? 'available'] ?? AVAILABILITY_STATUS_COLORS.available
}

// Derived from the availability calendar, so this section is read-only: a
// member changes their answer on /availability, not here. Over a multi-day
// event the summary is the worst day, with the span broken out beside it.
export default function BandEventAvailabilitySection({
  members = [],
  days = [],
  candidateMembers = [],
  canWrite = false,
  onAddMember,
  onRemoveMember,
}: Readonly<BandEventAvailabilitySectionProps>) {
  const { t, i18n } = useTranslation('bandEvents')

  const statusLabel = (status: AvailabilityStatus | undefined) => {
    if (status === 'available') return t($ => $.availability.available)
    if (status === 'travel_margin') return t($ => $.availability.travelMargin)
    if (status === 'unavailable') return t($ => $.availability.unavailable)
    return t($ => $.availability.unknown)
  }

  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(i18n.resolvedLanguage ?? 'en', {
      day: 'numeric',
      month: 'short',
    })

  const bandWideDays = days.filter((d) => d.bandWide)
  const showPerDay = days.length > 1

  function renderAvailability(participant: Participant) {
    const member = members.find((candidate) => candidate.member_id === participant.band_member_id)
    if (!member) return null
    const chip = (
      <Chip
        size="small"
        variant="filled"
        color={CHIP_COLOR[member.status ?? ''] ?? 'default'}
        label={statusLabel(member.status)}
        sx={{ maxWidth: '100%' }}
      />
    )

    return (
      <>
        {!showPerDay && (member.reason ? (
          <Tooltip title={`${member.name} — ${member.reason}`}>{chip}</Tooltip>
        ) : chip)}
        {showPerDay && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {days.map((day) => {
              const entry = day.members.find((candidate) => candidate.member_id === member.member_id)
              const label = [
                dayLabel(day.date),
                statusLabel(entry?.status),
                entry?.reason,
              ].filter(Boolean).join(' — ')
              return (
                <Tooltip key={day.date} title={label}>
                  <Box
                    aria-label={label}
                    sx={{
                      width: 14,
                      height: 14,
                      borderRadius: 0.5,
                      bgcolor: statusColor(entry?.status),
                    }}
                  />
                </Tooltip>
              )
            })}
          </Box>
        )}
      </>
    )
  }

  return (
    <Stack spacing={1}>
      {bandWideDays.map((day) => (
        <Typography key={day.date} variant="caption" sx={{ color: 'text.secondary' }}>
          {t($ => $.availability.bandWide, {
            date: dayLabel(day.date),
            status: statusLabel(day.bandWide?.status),
          })}
          {day.bandWide?.reason ? ` — ${day.bandWide.reason}` : ''}
        </Typography>
      ))}
      <BandParticipantsSection
        participants={members.map((member) => ({
          band_member_id: member.member_id,
          name: member.name,
          color: member.color ?? undefined,
          position: member.position,
        }))}
        candidateMembers={candidateMembers}
        emptyText={t($ => $.availability.noMembers)}
        addParticipantLabel={t($ => $.availability.addMember)}
        getRemoveParticipantLabel={(participant) => t($ => $.availability.removeMember, { name: participant.name })}
        onAddParticipant={(memberId) => { void onAddMember?.(memberId) }}
        onRemoveParticipant={(memberId) => { void onRemoveMember?.(memberId) }}
        canWrite={canWrite}
        renderParticipantEnd={renderAvailability}
      />
    </Stack>
  )
}
