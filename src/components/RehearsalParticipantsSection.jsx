import { useMemo } from 'react'
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
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import VoteToggle from './VoteToggle.jsx'

export default function RehearsalParticipantsSection({
  rehearsal,
  members,
  addMemberId,
  onAddMemberIdChange,
  notes,
  onNotesChange,
  onVote,
  onRemoveParticipant,
  onAddParticipant,
  onPromote,
  onDemote,
}) {
  const participantIds = useMemo(
    () => new Set((rehearsal.participants ?? []).map((p) => p.band_member_id)),
    [rehearsal]
  )
  const candidateMembers = members.filter((m) => !participantIds.has(m.id))
  const allYes =
    rehearsal.participants?.length > 0 &&
    rehearsal.participants.every((p) => p.vote === 'yes')

  return (
    <>
      <Grid size={12}>
        <Divider sx={{ my: 1 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={600}>Status</Typography>
          <Chip
            label={rehearsal.status}
            color={rehearsal.status === 'planned' ? 'primary' : 'default'}
            size="small"
          />
          <Box sx={{ flexGrow: 1 }} />
          {rehearsal.status === 'option' ? (
            <Button variant="contained" disabled={!allYes} onClick={onPromote}>
              Plan this rehearsal
            </Button>
          ) : (
            <Button variant="outlined" onClick={onDemote}>Revert to option</Button>
          )}
        </Box>
        {rehearsal.status === 'option' && !allYes && (
          <Typography variant="caption" color="text.secondary">
            Every required participant must vote yes before this can be planned.
          </Typography>
        )}
      </Grid>

      <Grid size={12}>
        <Divider sx={{ my: 1 }} />
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          Required participants
        </Typography>
        <Stack spacing={1}>
          {rehearsal.participants.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No participants yet — add at least one below.
            </Typography>
          )}
          {rehearsal.participants.map((p) => (
            <Box
              key={p.band_member_id}
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
              {rehearsal.status !== 'planned' && (
                <VoteToggle
                  vote={p.vote}
                  onChange={(v) => onVote(p.band_member_id, v)}
                />
              )}
              <IconButton
                size="small"
                aria-label={`remove ${p.name}`}
                onClick={() => onRemoveParticipant(p.band_member_id)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Stack>

        {candidateMembers.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="add-participant-label">Add participant</InputLabel>
              <Select
                labelId="add-participant-label"
                label="Add participant"
                value={addMemberId}
                onChange={(e) => onAddMemberIdChange(e.target.value)}
              >
                {candidateMembers.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.name} ({m.position})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" disabled={!addMemberId} onClick={onAddParticipant}>
              Add
            </Button>
          </Box>
        )}
      </Grid>

      <Grid size={12}>
        <Divider sx={{ my: 1 }} />
        <TextField
          label="Notes"
          fullWidth
          multiline
          minRows={3}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />
      </Grid>
    </>
  )
}
