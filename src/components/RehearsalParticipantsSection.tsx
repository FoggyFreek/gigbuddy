import type { Rehearsal, Member, Id } from '../types/entities.ts'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import VoteToggle from './VoteToggle.tsx'

interface RehearsalParticipantsSectionProps {
  rehearsal: Rehearsal
  members?: Member[]
  addMemberId?: Id | ''
  onAddMemberIdChange?: (id: Id | '') => void
  onVote?: (memberId: Id | undefined, vote: string | null) => void
  onRemoveParticipant?: (memberId: Id | undefined) => void
  onAddParticipant?: () => void
  onPromote?: () => void
  onDemote?: () => void
  // Presentation gating for readers: when false, only the current member's own
  // vote control is shown; all add/remove/promote/demote controls are hidden.
  canWrite?: boolean
  currentMemberId?: Id | null
}

export default function RehearsalParticipantsSection({
  rehearsal,
  members = [],
  addMemberId,
  onAddMemberIdChange,
  onVote,
  onRemoveParticipant,
  onAddParticipant,
  onPromote,
  onDemote,
  canWrite = true,
  currentMemberId = null,
}: RehearsalParticipantsSectionProps) {
  const { t } = useTranslation('rehearsals')
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

      {isPlanned ? (
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {rehearsal.participants?.map((p) => (
              <Chip key={String(p.band_member_id)} size="small" label={p.name} />
            ))}
          </Stack>
        </Grid>
      ) : (
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.participants.requiredParticipants)}
          </Typography>
          <Stack spacing={1}>
            {(rehearsal.participants?.length ?? 0) === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t($ => $.participants.noParticipants)}
              </Typography>
            )}
            {rehearsal.participants?.map((p) => (
              <Box
                key={String(p.band_member_id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              >
                <Box
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    bgcolor: p.color || 'grey.400',
                  }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>
                  {p.name}
                </Typography>
                <Chip size="small" label={p.position} variant="outlined" />
                <Box sx={{ flexGrow: 1 }} />
                {(canWrite || p.band_member_id === currentMemberId) && (
                  <VoteToggle
                    vote={p.vote}
                    onChange={(v) => onVote?.(p.band_member_id, v)}
                  />
                )}
                {canWrite && (
                  <IconButton
                    size="small"
                    aria-label={t($ => $.participants.removeParticipant, { name: p.name })}
                    onClick={() => onRemoveParticipant?.(p.band_member_id)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            ))}
          </Stack>

          {canWrite && candidateMembers.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="add-participant-label">{t($ => $.participants.addParticipant)}</InputLabel>
                <Select
                  labelId="add-participant-label"
                  label={t($ => $.participants.addParticipant)}
                  value={addMemberId ?? ''}
                  onChange={(e) => onAddMemberIdChange?.(e.target.value as Id | '')}
                >
                  {candidateMembers.map((m) => (
                    <MenuItem key={String(m.id)} value={m.id}>
                      {m.name} ({m.position})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="outlined" disabled={!addMemberId} onClick={onAddParticipant}>
                {t($ => $.participants.add)}
              </Button>
            </Box>
          )}
        </Grid>
      )}
    </>
  )
}
