import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import { useTranslation } from 'react-i18next'
import VoteToggle from './VoteToggle.tsx'
import type { Participant, Member, Id } from '../types/entities.ts'

interface GigParticipantsSectionProps {
  participants: Participant[]
  candidateMembers: Member[]
  addMemberId: Id | ''
  onAddMemberChange: (value: Id | '') => void
  onAddParticipant: () => void
  onRemoveParticipant: (memberId: Id) => void
  onVote: (memberId: Id, vote: string | null) => void
  // Voting on a gig participant is planning.write (unlike rehearsals); readers
  // see the roster read-only with no add/remove/vote affordances.
  canWrite?: boolean
}

export default function GigParticipantsSection({
  participants,
  candidateMembers,
  addMemberId,
  onAddMemberChange,
  onAddParticipant,
  onRemoveParticipant,
  onVote,
  canWrite = true,
}: GigParticipantsSectionProps) {
  const { t } = useTranslation(['gigs', 'common'])
  return (
    <Stack spacing={1}>
      {participants.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t($ => $.participants.noParticipants)}
        </Typography>
      )}
      {participants.map((p) => (
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
          <VoteToggle
            vote={p.vote}
            disabled={!canWrite}
            onChange={(v: string | null) => onVote(p.band_member_id!, v)}
          />
          {canWrite && (
            <IconButton
              size="small"
              aria-label={t($ => $.participants.removeParticipant, { name: p.name })}
              onClick={() => onRemoveParticipant(p.band_member_id!)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      ))}
      {canWrite && candidateMembers.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="add-gig-participant-label">{t($ => $.participants.addParticipant)}</InputLabel>
            <Select
              labelId="add-gig-participant-label"
              label={t($ => $.participants.addParticipant)}
              value={addMemberId}
              onChange={(e) => onAddMemberChange(e.target.value as Id | '')}
            >
              {candidateMembers.map((m) => (
                <MenuItem key={String(m.id)} value={m.id}>
                  {m.name} ({m.position})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            disabled={!addMemberId}
            onClick={onAddParticipant}
          >
            {t($ => $.actions.add, { ns: 'common' })}
          </Button>
        </Box>
      )}
    </Stack>
  )
}
