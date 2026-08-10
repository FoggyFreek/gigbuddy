import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import GigContactsSection from './GigContactsSection.tsx'
import GigParticipantsSection from './GigParticipantsSection.tsx'
import type { Id, Member, Participant } from '../../types/entities.ts'

interface Props {
  active: boolean
  editable: boolean
  gigId: Id
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
}

export default function GigAvailability({
  active,
  editable,
  gigId,
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
}: Readonly<Props>) {
  const { t } = useTranslation('gigs')

  return (
    <Box sx={{ display: active ? 'block' : 'none' }}>
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.detail.participants)}
          </Typography>
          <GigParticipantsSection
            participants={participants}
            candidateMembers={candidateMembers}
            addMemberId={addMemberId}
            onAddMemberChange={onAddMemberChange}
            onAddParticipant={onAddParticipant}
            onRemoveParticipant={onRemoveParticipant}
            onVote={onVote}
            canWrite={editable}
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
