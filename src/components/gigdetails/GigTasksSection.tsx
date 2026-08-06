import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import GigAttachments from './GigAttachments.tsx'
import GigTasks from './GigTasks.tsx'
import type { Id, Member, PurchaseAttachment, Task } from '../../types/entities.ts'

interface Props {
  active: boolean
  editable: boolean
  gigId: Id
  initialTasks: Task[]
  initialAttachments: PurchaseAttachment[]
  members: Member[]
  notes: string
  currentBandMemberId: Id | null
  plainTextAttachments: boolean
  onChangeNotes: (notes: string) => void
  onToggleTask?: (task: Task, done: boolean) => Promise<Task>
}

export default function GigTasksSection({
  active,
  editable,
  gigId,
  initialTasks,
  initialAttachments,
  members,
  notes,
  currentBandMemberId,
  plainTextAttachments,
  onChangeNotes,
  onToggleTask,
}: Readonly<Props>) {
  const { t } = useTranslation('gigs')

  return (
    <Box sx={{ display: active ? 'block' : 'none' }}>
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.detail.tasks)}
          </Typography>
          <GigTasks
            key={String(gigId)}
            gigId={gigId}
            initialTasks={initialTasks}
            members={members}
            canWrite={editable}
            currentBandMemberId={currentBandMemberId}
            onToggleTask={onToggleTask}
          />
        </Grid>
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.detail.attachments)}
          </Typography>
          <GigAttachments
            key={String(gigId)}
            gigId={gigId}
            initialAttachments={initialAttachments}
            canWrite={editable}
            plainText={plainTextAttachments}
          />
        </Grid>
        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          <TextField
            label={t($ => $.detail.notes)}
            fullWidth
            multiline
            minRows={3}
            value={notes}
            onChange={(event) => onChangeNotes(event.target.value)}
            sx={{ my: 2 }}
            slotProps={{ htmlInput: { readOnly: !editable } }}
          />
        </Grid>
      </Grid>
    </Box>
  )
}
