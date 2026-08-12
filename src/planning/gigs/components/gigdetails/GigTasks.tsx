import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Checkbox from '@mui/material/Checkbox'
import Collapse from '@mui/material/Collapse'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DeleteIcon from '@mui/icons-material/Delete'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import TaskComposer, { type TaskDraft } from './TaskComposer.tsx'
import { TaskAssigneeControl, TaskDueControl } from './TaskMetaControls.tsx'
import { createTask, deleteTask, updateTask } from '../../gigs.ts'
import { isPastDate } from '../../../../utils/dateFormat.ts'
import type { Id, Member, Task } from '../../../../types/entities.ts'

interface GigTasksProps {
  gigId: Id
  initialTasks?: Task[]
  members?: Member[]
  // Planning-write gates creating/deleting/editing tasks. Readers keep one
  // self-action: ticking *their own* assigned task done (task.complete.self on
  // the server), so the done checkbox stays live for tasks assigned to them.
  canWrite?: boolean
  currentBandMemberId?: Id | null
  onToggleTask?: (task: Task, done: boolean) => Promise<Task>
  onTaskUpsert?: (task: Task) => void
  onTaskDelete?: (taskId: Id) => void
}

export default function GigTasks({
  gigId,
  initialTasks = [],
  members = [],
  canWrite = true,
  currentBandMemberId = null,
  onToggleTask,
  onTaskUpsert,
  onTaskDelete,
}: Readonly<GigTasksProps>) {
  const { t } = useTranslation('gigs')
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [showCompleted, setShowCompleted] = useState(false)

  function applyUpdate(updated: Task) {
    setTasks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    onTaskUpsert?.(updated)
  }

  async function handleAdd(draft: TaskDraft) {
    const task = (await createTask(gigId, draft)) as Task
    setTasks((prev) => [...prev, task])
    onTaskUpsert?.(task)
  }

  async function handleToggle(task: Task) {
    const updated = onToggleTask
      ? await onToggleTask(task, !task.done)
      : ((await updateTask(gigId, task.id!, { done: !task.done })) as Task)
    applyUpdate(updated)
  }

  async function handleDueChange(task: Task, value: string | null) {
    applyUpdate((await updateTask(gigId, task.id!, { due_date: value })) as Task)
  }

  async function handleAssign(task: Task, value: Id | null) {
    applyUpdate((await updateTask(gigId, task.id!, { assigned_to: value })) as Task)
  }

  async function handleDelete(taskId: Id) {
    await deleteTask(gigId, taskId)
    setTasks((prev) => prev.filter((task) => task.id !== taskId))
    onTaskDelete?.(taskId)
  }

  // Render helper — not a component, does not use hooks
  function renderTaskCard(task: Task) {
    const canToggleDone =
      canWrite || (task.assigned_to != null && task.assigned_to === currentBandMemberId)
    // A reader only gets the second row when it carries something to read.
    const hasMeta = Boolean(task.due_date) || (task.assigned_to != null && members.length > 0)
    const showMetaRow = canWrite || hasMeta

    return (
      <Card key={String(task.id)} variant="outlined" sx={{ mb: 0.75 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, pl: 1, pr: 1.5, py: 0.5 }}>
          <Checkbox
            size="small"
            icon={<RadioButtonUncheckedIcon fontSize="small" />}
            checkedIcon={<CheckCircleIcon fontSize="small" />}
            checked={task.done ?? false}
            disabled={!canToggleDone}
            onChange={() => handleToggle(task)}
            slotProps={{ input: { 'aria-label': task.title } }}
            sx={{ flexShrink: 0, p: 0.75 }}
          />
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              minWidth: 0,
              wordBreak: 'break-word',
              textDecoration: task.done ? 'line-through' : 'none',
              color: task.done ? 'text.disabled' : 'text.primary',
            }}
          >
            {task.title}
          </Typography>
        </Stack>
        {showMetaRow && (
          <>
            <Divider />
            <Stack direction="row" sx={{ alignItems: 'center', gap: 0.25, px: 1, py: 0.5 }}>
              <TaskDueControl
                value={task.due_date ?? null}
                label={t($ => $.tasks.dueDateFor, { title: task.title })}
                overdue={isPastDate(task.due_date) && !task.done}
                readOnly={!canWrite}
                onChange={(value) => handleDueChange(task, value)}
              />
              <TaskAssigneeControl
                value={task.assigned_to ?? null}
                members={members}
                label={t($ => $.tasks.assignTask, { title: task.title })}
                readOnly={!canWrite}
                onChange={(value) => handleAssign(task, value)}
              />
              <Box sx={{ flex: 1 }} />
              {canWrite && (
                <IconButton
                  size="small"
                  aria-label={t($ => $.tasks.deleteTask, { title: task.title })}
                  onClick={() => handleDelete(task.id!)}
                  sx={{ flexShrink: 0, opacity: 0.4, '&:hover': { opacity: 1 } }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          </>
        )}
      </Card>
    )
  }

  const openTasks = tasks.filter((task) => !task.done)
  const doneTasks = tasks.filter((task) => task.done)

  return (
    <Box>
      {openTasks.length === 0 && doneTasks.length === 0 && !canWrite && (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
          {t($ => $.tasks.empty)}
        </Typography>
      )}
      {canWrite && (
        <Box sx={{ mb: 1.5 }}>
          <TaskComposer members={members} onAdd={handleAdd} />
        </Box>
      )}
      {openTasks.map((task) => renderTaskCard(task))}

      {/* Completed tasks — collapsed by default */}
      {doneTasks.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Box
            role="button"
            tabIndex={0}
            onClick={() => setShowCompleted((prev) => !prev)}
            onKeyDown={(e) => e.key === 'Enter' && setShowCompleted((prev) => !prev)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.25,
              cursor: 'pointer',
              color: 'text.secondary',
              py: 0.25,
              '&:hover': { color: 'text.primary' },
            }}
          >
            <ExpandMoreIcon
              fontSize="small"
              sx={{
                transform: showCompleted ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.2s',
                fontSize: '1rem',
              }}
            />
            <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 500 }}>
              {t($ => $.tasks.completed, { count: doneTasks.length })}
            </Typography>
          </Box>
          <Collapse in={showCompleted}>
            <Box sx={{ pt: 0.75 }}>{doneTasks.map((task) => renderTaskCard(task))}</Box>
          </Collapse>
        </Box>
      )}
    </Box>
  )
}
