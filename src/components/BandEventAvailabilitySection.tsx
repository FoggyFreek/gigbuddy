import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import { useState } from 'react'
import { AVAILABILITY_STATUS_COLORS } from '../utils/availabilityUtils.ts'
import type { AvailabilityDay, AvailabilityStatus, Id, Member, MemberAvailability } from '../types/entities.ts'

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
  return AVAILABILITY_STATUS_COLORS[status ?? 'default'] ?? AVAILABILITY_STATUS_COLORS.default
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
  const [addMemberId, setAddMemberId] = useState<Id | ''>('')

  const statusLabel = (status: AvailabilityStatus | undefined) => {
    if (status === 'available') return t($ => $.availability.available)
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

  return (
    <Stack spacing={1}>
      {members.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t($ => $.availability.noMembers)}
        </Typography>
      )}
      {bandWideDays.map((day) => (
        <Typography key={day.date} variant="caption" sx={{ color: 'text.secondary' }}>
          {t($ => $.availability.bandWide, {
            date: dayLabel(day.date),
            status: statusLabel(day.bandWide?.status),
          })}
          {day.bandWide?.reason ? ` — ${day.bandWide.reason}` : ''}
        </Typography>
      ))}

      {members.map((member) => (
        <Box
          key={String(member.member_id)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            p: 1,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: member.color || 'grey.400' }} />
          <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>
            {member.name}
          </Typography>
          <Chip
            size="small"
            variant={member.status === 'default' ? 'outlined' : 'filled'}
            color={CHIP_COLOR[member.status ?? ''] ?? 'default'}
            label={member.reason
              ? `${statusLabel(member.status)} — ${member.reason}`
              : statusLabel(member.status)}
            sx={{ maxWidth: '100%' }}
          />
          {showPerDay && (
            <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
              {days.map((day) => {
                const entry = day.members.find((m) => m.member_id === member.member_id)
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
          {canWrite && member.member_id !== undefined && (
            <IconButton
              size="small"
              aria-label={t($ => $.availability.removeMember, { name: member.name })}
              onClick={() => onRemoveMember?.(member.member_id!)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      ))}
      {canWrite && candidateMembers.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 0.5 }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="add-band-event-member-label">{t($ => $.availability.addMember)}</InputLabel>
            <Select
              labelId="add-band-event-member-label"
              label={t($ => $.availability.addMember)}
              value={addMemberId}
              onChange={(event) => setAddMemberId(event.target.value as Id | '')}
            >
              {candidateMembers.map((member) => (
                <MenuItem key={String(member.id)} value={member.id}>
                  {member.name} ({member.position})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            disabled={!addMemberId}
            onClick={() => {
              if (!addMemberId) return
              void onAddMember?.(addMemberId)
              setAddMemberId('')
            }}
          >
            {t($ => $.availability.addAction)}
          </Button>
        </Box>
      )}
    </Stack>
  )
}
