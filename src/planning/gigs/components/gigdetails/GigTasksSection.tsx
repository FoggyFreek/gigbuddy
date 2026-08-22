import { memo } from 'react'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import GigAttachments from './GigAttachments.tsx'
import GigInfoBlocks from './GigInfoBlocks.tsx'
import GigTasks from './GigTasks.tsx'
import GigTimetable from './GigTimetable.tsx'
import type {
  GigInfoBlock, GigTimetableEntry, Id, Member, PurchaseAttachment, Task,
} from '../../../../types/entities.ts'

interface Props {
  editable: boolean
  gigId: Id
  initialTasks: Task[]
  initialAttachments: PurchaseAttachment[]
  members: Member[]
  initialInfoBlocks: GigInfoBlock[]
  initialTimetable: GigTimetableEntry[]
  currentBandMemberId: Id | null
  plainTextAttachments: boolean
  onToggleTask?: (task: Task, done: boolean) => Promise<Task>
  onTaskUpsert?: (task: Task) => void
  onTaskDelete?: (taskId: Id) => void
}

// Four editable lists, none of them fed by the gig form: memoized so a
// keystroke elsewhere on the page doesn't walk them.
const GigTasksSection = memo(function GigTasksSection({
  editable,
  gigId,
  initialTasks,
  initialAttachments,
  members,
  initialInfoBlocks,
  initialTimetable,
  currentBandMemberId,
  plainTextAttachments,
  onToggleTask,
  onTaskUpsert,
  onTaskDelete,
}: Readonly<Props>) {
  const { t } = useTranslation('gigs')

  return (
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
          onTaskUpsert={onTaskUpsert}
          onTaskDelete={onTaskDelete}
        />
      </Grid>
      <Grid size={12}>
        <Divider sx={{ my: 1 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {t($ => $.detail.timetable.title)}
        </Typography>
        <GigTimetable
          key={String(gigId)}
          gigId={gigId}
          editable={editable}
          initialEntries={initialTimetable}
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
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {t($ => $.detail.infoBlocks.title)}
        </Typography>
        <GigInfoBlocks
          key={String(gigId)}
          gigId={gigId}
          editable={editable}
          initialBlocks={initialInfoBlocks}
        />
      </Grid>
    </Grid>
  )
})

export default GigTasksSection
