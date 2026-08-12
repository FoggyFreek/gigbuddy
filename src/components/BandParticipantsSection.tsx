import { useState, type ReactNode } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import VoteToggle from './VoteToggle.tsx'
import type { Participant, Member, Id } from '../types/entities.ts'
import { isPastDate } from '../utils/dateFormat.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'

interface Props {
  participants: Participant[]
  eventDate?: string | Date | null
  eventStatus?: string | null
  candidateMembers?: Member[]
  emptyText: ReactNode
  addParticipantLabel: string
  getRemoveParticipantLabel: (participant: Participant) => string
  onAddParticipant?: (memberId: Id) => void
  onRemoveParticipant?: (memberId: Id) => void
  onVote?: (memberId: Id, vote: string | null) => void
  canWrite?: boolean
  shouldShowVote?: (participant: Participant) => boolean
  canVote?: (participant: Participant) => boolean
  renderParticipantEnd?: (participant: Participant) => ReactNode
  headerContent?: ReactNode
}

export default function BandParticipantsSection({
  participants,
  eventDate,
  eventStatus,
  candidateMembers = [],
  emptyText,
  addParticipantLabel,
  getRemoveParticipantLabel,
  onAddParticipant,
  onRemoveParticipant,
  onVote,
  canWrite = true,
  shouldShowVote = () => onVote !== undefined,
  canVote = () => canWrite,
  renderParticipantEnd,
  headerContent,
}: Readonly<Props>) {
  const [addInput, setAddInput] = useState('')
  const isCompact = useCompactLayout()
  const showVotes = !isPastDate(eventDate) && (eventStatus === undefined || eventStatus === 'option')

  function handleVote(participant: Participant, next: string | null) {
    if (participant.band_member_id === undefined || next === null) return
    onVote?.(participant.band_member_id, next)
  }

  return (
    <Stack spacing={1}>
      {headerContent}
      {participants.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      )}
      {participants.map((participant) => {
        const participantKey = String(participant.band_member_id)
        const voteVisible = showVotes && onVote && shouldShowVote(participant)
        const removeVisible = canWrite && participant.band_member_id !== undefined && onRemoveParticipant

        if (isCompact) {
          return (
            <Box
              key={participantKey}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gridTemplateRows: 'auto auto',
                columnGap: 1,
                rowGap: 0.75,
                p: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <Box
                data-testid={`band-participant-identity-${participantKey}`}
                sx={{ gridColumn: 1, gridRow: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}
              >
                <Box
                  sx={{
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    borderRadius: '50%',
                    bgcolor: participant.color || 'grey.400',
                  }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }}>
                  {participant.name}
                </Typography>
              </Box>
              <Box
                data-testid={`band-participant-details-${participantKey}`}
                sx={{
                  gridColumn: 1,
                  gridRow: 2,
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 0.75,
                  minWidth: 0,
                }}
              >
                {participant.position && <Chip size="small" label={participant.position} variant="outlined" />}
                {renderParticipantEnd?.(participant)}
              </Box>
              {(voteVisible || removeVisible) && (
                <Box
                  data-testid={`band-participant-actions-${participantKey}`}
                  sx={{
                    gridColumn: 2,
                    gridRow: '1 / span 2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    alignSelf: 'center',
                    justifySelf: 'end',
                    gap: 0.5,
                  }}
                >
                  {voteVisible && (
                    <VoteToggle
                      vote={participant.vote}
                      disabled={!canVote(participant)}
                      onChange={(next) => handleVote(participant, next)}
                    />
                  )}
                  {removeVisible && (
                    <IconButton
                      size="small"
                      aria-label={getRemoveParticipantLabel(participant)}
                      onClick={() => onRemoveParticipant(participant.band_member_id!)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              )}
            </Box>
          )
        }

        return (
          <Box
            key={participantKey}
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
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                bgcolor: participant.color || 'grey.400',
              }}
            />
            <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>
              {participant.name}
            </Typography>
            {participant.position && <Chip size="small" label={participant.position} variant="outlined" />}
            <Box sx={{ flexGrow: 1 }} />
            {renderParticipantEnd?.(participant)}
            {voteVisible && (
              <VoteToggle
                vote={participant.vote}
                disabled={!canVote(participant)}
                onChange={(next) => handleVote(participant, next)}
              />
            )}
            {removeVisible && (
              <IconButton
                size="small"
                aria-label={getRemoveParticipantLabel(participant)}
                onClick={() => onRemoveParticipant(participant.band_member_id!)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        )
      })}
      {canWrite && candidateMembers.length > 0 && onAddParticipant && (
        <Box sx={{ mt: 1 }}>
          <Autocomplete
            value={null}
            options={candidateMembers}
            inputValue={addInput}
            onInputChange={(_event, value, reason) => setAddInput(reason === 'reset' ? '' : value)}
            onChange={(_event, picked) => {
              if (picked?.id == null) return
              setAddInput('')
              onAddParticipant(picked.id)
            }}
            blurOnSelect
            getOptionLabel={(member) => member.name ?? ''}
            isOptionEqualToValue={(a, b) => a.id != null && a.id === b.id}
            renderOption={(props, member) => (
              <li {...props} key={String(member.id)}>
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="body2">{member.name}</Typography>
                  {member.position && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{member.position}</Typography>
                  )}
                </Box>
              </li>
            )}
            renderInput={(params) => <TextField {...params} label={addParticipantLabel} />}
          />
        </Box>
      )}
    </Stack>
  )
}
