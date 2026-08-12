import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PersonIcon from '@mui/icons-material/Person'
import MasonryLayout from './shared/MasonryLayout.tsx'
import { tenantAvatarUrl } from '../utils/tenantAvatarUrl.ts'
import Avatar from '@mui/material/Avatar'
import { formatDueDate } from '../utils/dateFormat.ts'
import type { Id, Task } from '../types/entities.ts'
import type { MaybeCrossTenant } from '../types/api.ts'

// The table is fed by both the tenant-scoped `/tasks` feed and the cross-tenant
// `/api/me/tasks` one; only the latter's rows carry a band label.
type TaskItem = MaybeCrossTenant<Task>

const CHIP_SX = {
  height: 20,
  fontSize: '0.7rem',
  '& .MuiChip-icon': { fontSize: '0.8rem', ml: 0.5 },
  '& .MuiChip-label': { px: 0.75 },
} as const

function formatDate(val: string | Date | null | undefined): string {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function isOverdue(task: Task): boolean {
  if (task.done || !task.due_date) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(task.due_date) < today
}

interface TaskRowProps {
  task: TaskItem
  onToggleDone: (task: TaskItem) => void
  canToggleDone: (task: TaskItem) => boolean
  onEditTask?: (task: TaskItem) => void
  onOpenTask?: (task: TaskItem) => void
  canEditTask?: (task: TaskItem) => boolean
}

function TaskRow({ task, onToggleDone, canToggleDone, onEditTask, onOpenTask, canEditTask }: Readonly<TaskRowProps>) {
  const { i18n } = useTranslation('tasks')
  const overdue = isOverdue(task)
  const dueLabel = task.due_date
    ? formatDueDate(task.due_date, i18n.resolvedLanguage ?? 'en')
    : null
  const editable = !!onEditTask && !task.done && (canEditTask?.(task) ?? true)
  const openable = !editable && !!onOpenTask

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: 1.5 }}>
      <Checkbox
        size="small"
        checked={task.done ?? false}
        disabled={task.done || !canToggleDone(task)}
        onClick={(e) => {
          e.stopPropagation()
          onToggleDone(task)
        }}
        sx={{ flexShrink: 0, p: 0.25, mt: 0 }}
      />
      <Box
        onClick={() => { if (editable) onEditTask?.(task); else if (openable) onOpenTask?.(task) }}
        sx={{ flex: 1, minWidth: 0, cursor: editable || openable ? 'pointer' : 'default' }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: 'normal',
            wordBreak: 'break-word',
            textDecoration: task.done ? 'line-through' : 'none',
            color: task.done ? 'text.disabled' : 'text.primary',
          }}
        >
          {task.title}
        </Typography>
        {(dueLabel || task.assigned_to_name) && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
            {dueLabel && (
              <Chip
                icon={<CalendarMonthIcon />}
                label={dueLabel}
                size="small"
                color={overdue ? 'error' : 'default'}
                variant="outlined"
                sx={CHIP_SX}
              />
            )}
            {task.assigned_to_name && (
              <Chip
                icon={<PersonIcon />}
                label={task.assigned_to_name}
                size="small"
                variant="outlined"
                sx={CHIP_SX}
              />
            )}
          </Stack>
        )}
      </Box>
    </Box>
  )
}

const CARD_SX = { boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)' } as const

type StandaloneTaskCardProps = TaskRowProps

function StandaloneTaskCard(props: Readonly<StandaloneTaskCardProps>) {
  const { task } = props
  return (
    <Card variant="outlined" data-card sx={CARD_SX}>
      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
        {task.tenantId != null && (
          <Box sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover' }}>
            <Avatar
              src={tenantAvatarUrl(task.tenantId, task.tenantAvatarPath)}
              alt={task.tenantName ?? ''}
              sx={{ width: 26, height: 26, fontSize: 13 }}
            >
              {task.tenantName?.trim().charAt(0).toUpperCase() || '?'}
            </Avatar>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{task.tenantName || '—'}</Typography>
          </Box>
        )}
        <TaskRow {...props} />
      </CardContent>
    </Card>
  )
}

interface GigTaskCardProps {
  gigId: Id
  tasks: TaskItem[]
  onToggleDone: (task: TaskItem) => void
  canToggleDone: (task: TaskItem) => boolean
  onOpenGig: (gigId: Id) => void
  onOpenGigTask?: (gigId: Id, task: TaskItem) => void
  onEditTask?: (task: TaskItem) => void
  canEditTask?: (task: TaskItem) => boolean
}

function GigTaskCard({ gigId, tasks, onToggleDone, canToggleDone, onOpenGig, onOpenGigTask, onEditTask, canEditTask }: Readonly<GigTaskCardProps>) {
  const { t } = useTranslation('tasks')
  const gig = tasks[0]

  return (
    <Card variant="outlined" data-card sx={CARD_SX}>
      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
        {gig.tenantId != null && (
          <Box sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover' }}>
            <Avatar
              src={tenantAvatarUrl(gig.tenantId, gig.tenantAvatarPath)}
              alt={gig.tenantName ?? ''}
              sx={{ width: 26, height: 26, fontSize: 13 }}
            >
              {gig.tenantName?.trim().charAt(0).toUpperCase() || '?'}
            </Avatar>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{gig.tenantName || '—'}</Typography>
          </Box>
        )}
        <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {gig.event_description}
            </Typography>
            {gig.event_date && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {formatDate(gig.event_date)}
              </Typography>
            )}
          </Box>
          <Tooltip title={t($ => $.openGig)}>
            <IconButton
              size="small"
              aria-label={t($ => $.openGig)}
              onClick={() => onOpenGigTask ? onOpenGigTask(gigId, gig) : onOpenGig(gigId)}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />
        <Stack divider={<Divider flexItem />}>
          {tasks.map((task) => (
            <TaskRow
              key={String(task.id)}
              task={task}
              onToggleDone={onToggleDone}
              canToggleDone={canToggleDone}
              onEditTask={onEditTask}
              canEditTask={canEditTask}
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}

type TaskCardGroup =
  | { kind: 'gig'; gigId: Id; tasks: TaskItem[] }
  | { kind: 'standalone'; task: TaskItem }

function compareTasksByDueDate(a: Task, b: Task): number {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
  if (a.due_date) return -1
  if (b.due_date) return 1
  return 0
}

function groupTasks(tasks: TaskItem[]): TaskCardGroup[] {
  const groups: TaskCardGroup[] = []
  const gigGroups = new Map<string, Extract<TaskCardGroup, { kind: 'gig' }>>()

  tasks.forEach((task) => {
    if (task.gig_id == null) {
      groups.push({ kind: 'standalone', task })
      return
    }

    const key = `${String(task.tenantId ?? 'active')}:${String(task.gig_id)}`
    const existing = gigGroups.get(key)
    if (existing) {
      existing.tasks.push(task)
      return
    }

    const group: Extract<TaskCardGroup, { kind: 'gig' }> = {
      kind: 'gig',
      gigId: task.gig_id,
      tasks: [task],
    }
    gigGroups.set(key, group)
    groups.push(group)
  })

  gigGroups.forEach((group) => group.tasks.sort(compareTasksByDueDate))
  return groups
}

interface TasksTableProps {
  tasks: TaskItem[]
  onToggleDone: (task: TaskItem) => void
  canToggleDone: (task: TaskItem) => boolean
  onOpenGig: (gigId: Id) => void
  onOpenGigTask?: (gigId: Id, task: TaskItem) => void
  onEditTask?: (task: TaskItem) => void
  onOpenTask?: (task: TaskItem) => void
  canEditTask?: (task: TaskItem) => boolean
}

export default function TasksTable({ tasks, onToggleDone, canToggleDone, onOpenGig, onOpenGigTask, onEditTask, onOpenTask, canEditTask }: Readonly<TasksTableProps>) {
  const { t } = useTranslation('tasks')

  if (tasks.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
        <Typography>{t($ => $.empty)}</Typography>
      </Box>
    )
  }

  const groups = groupTasks(tasks)

  return (
    <MasonryLayout columnWidth={280} spacing={1.5}>
      {groups.map((group, index) => group.kind === 'gig' ? (
        <GigTaskCard
          key={`gig-${String(group.gigId)}`}
          gigId={group.gigId}
          tasks={group.tasks}
          onToggleDone={onToggleDone}
          canToggleDone={canToggleDone}
          onOpenGig={onOpenGig}
          onOpenGigTask={onOpenGigTask}
          onEditTask={onEditTask}
          canEditTask={canEditTask}
        />
      ) : (
        <StandaloneTaskCard
          key={`task-${String(group.task.id ?? index)}`}
          task={group.task}
          onToggleDone={onToggleDone}
          canToggleDone={canToggleDone}
          onEditTask={onEditTask}
          onOpenTask={onOpenTask}
          canEditTask={canEditTask}
        />
      ))}
    </MasonryLayout>
  )
}
