import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import DeleteIcon from '@mui/icons-material/Delete'
import { createTask, deleteTask, updateTask } from '../api/gigs.ts'
import type { Id, Member } from '../types/entities.ts'

interface LocalGigTask {
  id?: Id
  title?: string
  done?: boolean
  due_date?: string | null
  assigned_to?: Id | null
}

interface DueDateAdornmentProps {
  label: string
  onClick: () => void
}

interface GigTasksProps {
  gigId: Id
  initialTasks?: LocalGigTask[]
  members?: Member[]
  // Planning-write gates creating/deleting/editing tasks. Readers keep one
  // self-action: ticking *their own* assigned task done (task.complete.self on
  // the server), so the done checkbox stays live for tasks assigned to them.
  canWrite?: boolean
  currentBandMemberId?: Id | null
}

function toDateInputValue(val: string | null | undefined): string {
  if (!val) return ''
  return String(val).slice(0, 10)
}

// A component (not a render-time helper) so the ref-reading onClick is passed as
// an event-handler prop — react-hooks/refs forbids handing such functions to a
// plain function invoked during render.
function DueDateAdornment({ label, onClick }: DueDateAdornmentProps) {
  return (
    <InputAdornment position="end">
      <IconButton
        edge="end"
        size="small"
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
      >
        <CalendarMonthIcon fontSize="small" sx={{ color: 'action.active' }} />
      </IconButton>
    </InputAdornment>
  )
}

export default function GigTasks({ gigId, initialTasks = [], members = [], canWrite = true, currentBandMemberId = null }: GigTasksProps) {
  const [tasks, setTasks] = useState<LocalGigTask[]>(initialTasks)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState('')
  const [dueFocused, setDueFocused] = useState(false)
  const [focusedDueTaskId, setFocusedDueTaskId] = useState<Id | null>(null)
  const newDueInputRef = useRef<HTMLInputElement | null>(null)
  const dueInputRefs = useRef<Map<Id, HTMLInputElement>>(new Map())

  const openNewDuePicker = () => {
    newDueInputRef.current?.focus()
    ;(newDueInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null)?.showPicker?.()
  }

  const openTaskDuePicker = (taskId: Id) => (): void => {
    const input = dueInputRefs.current.get(taskId)
    input?.focus()
    ;(input as (HTMLInputElement & { showPicker?: () => void }) | undefined)?.showPicker?.()
  }

  const setTaskDueInputRef = (taskId: Id) => (input: HTMLInputElement | null): void => {
    if (input) {
      dueInputRefs.current.set(taskId, input)
    } else {
      dueInputRefs.current.delete(taskId)
    }
  }

  async function handleAdd() {
    if (!newTitle.trim()) return
    const task = await createTask(gigId, { title: newTitle.trim(), due_date: newDue || null })
    setTasks((prev) => [...prev, task as LocalGigTask])
    setNewTitle('')
    setNewDue('')
  }

  async function handleToggle(task: LocalGigTask) {
    const updated = await updateTask(gigId, task.id!, { done: !task.done })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated as LocalGigTask : t)))
  }

  async function handleDueChange(task: LocalGigTask, value: string) {
    const updated = await updateTask(gigId, task.id!, { due_date: value || null })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated as LocalGigTask : t)))
  }

  async function handleDelete(taskId: Id) {
    await deleteTask(gigId, taskId)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  async function handleAssign(task: LocalGigTask, value: string) {
    const updated = await updateTask(gigId, task.id!, { assigned_to: value || null })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated as LocalGigTask : t)))
  }

  return (
    <Box>
      {/* Add row — planning-write only */}
      {canWrite && (
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
          <TextField
            placeholder="New task…"
            size="small"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            type="date"
            size="small"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            onFocus={() => setDueFocused(true)}
            onBlur={() => setDueFocused(false)}
            slotProps={{
              htmlInput: { ref: newDueInputRef },
              input: {
                endAdornment: <DueDateAdornment label="open due date picker" onClick={openNewDuePicker} />,
              },
              inputLabel: { shrink: dueFocused || !!newDue },
            }}
            label="Due"
            sx={{
              width: 160,
              '& input::-webkit-datetime-edit': {
                opacity: dueFocused || newDue ? 1 : 0,
              },
              '& input::-webkit-calendar-picker-indicator': {
                display: 'none',
              },
            }}
          />
          <IconButton onClick={handleAdd} color="primary" disabled={!newTitle.trim()}>
            <AddIcon />
          </IconButton>
        </Stack>
      )}

      {tasks.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No tasks yet.
        </Typography>
      )}

      {tasks.map((task) => {
        // Readers may tick only their own assigned task done; everything else on
        // the row is planning-write.
        const canToggleDone = canWrite || (task.assigned_to != null && task.assigned_to === currentBandMemberId)
        return (
        <Box
          key={String(task.id)}
          sx={{
            display: { xs: 'grid', sm: 'flex' },
            gridTemplateColumns: 'auto 1fr auto',
            flexWrap: 'nowrap',
            alignItems: { xs: 'start', sm: 'center' },
            gap: 0.5,
            py: 0.5,
            textDecoration: task.done ? 'line-through' : 'none',
            color: task.done ? 'text.disabled' : 'text.primary',
          }}
        >
          <Checkbox
            size="small"
            checked={task.done ?? false}
            disabled={!canToggleDone}
            onChange={() => handleToggle(task)}
            sx={{ flexShrink: 0, gridRow: '1 / 3', alignSelf: 'center' }}
          />
          <Typography
            variant="body2"
            component="div"
            sx={{
              flex: '1 1 0',
              minWidth: 0,
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              lineHeight: 1.2,
            }}
          >
            {task.title}
          </Typography>
          {/* On mobile: row 2 of col 2. On desktop: display:contents lets children flow in the parent flex. */}
          <Box
            sx={{
              display: { xs: 'flex', sm: 'contents' },
              flexWrap: 'wrap',
              gap: 0.5,
              gridColumn: '2',
              gridRow: '2',
            }}
          >
            <TextField
              type="date"
              size="small"
              disabled={!canWrite}
              value={toDateInputValue(task.due_date)}
              onChange={(e) => handleDueChange(task, e.target.value)}
              onFocus={() => setFocusedDueTaskId(task.id ?? null)}
              onBlur={() => setFocusedDueTaskId(null)}
              slotProps={{
                htmlInput: {
                  ref: setTaskDueInputRef(task.id!),
                  'aria-label': `Due date for ${task.title}`,
                },
                input: {
                  endAdornment: (
                    <DueDateAdornment
                      label={`open due date picker for ${task.title}`}
                      onClick={openTaskDuePicker(task.id!)}
                    />
                  ),
                },
              }}
              sx={{
                flexShrink: 0,
                width: { xs: 140, sm: 150 },
                '& input::-webkit-datetime-edit': {
                  opacity: task.due_date || focusedDueTaskId === task.id ? 1 : 0,
                },
                '& input::-webkit-calendar-picker-indicator': {
                  display: 'none',
                },
              }}
            />
            {members.length > 0 && (
              <Select
                size="small"
                disabled={!canWrite}
                value={task.assigned_to ?? ''}
                onChange={(e) => handleAssign(task, e.target.value as string)}
                displayEmpty
                inputProps={{ 'aria-label': `Assign ${task.title}` }}
                sx={{ flexShrink: 0, width: 150 }}
              >
                <MenuItem value=""><em>Unassigned</em></MenuItem>
                {members.map((m) => (
                  <MenuItem key={String(m.id)} value={m.id}>{m.name}</MenuItem>
                ))}
              </Select>
            )}
          </Box>
          {canWrite && (
            <IconButton
              size="small"
              aria-label={`Delete task ${task.title}`}
              onClick={() => handleDelete(task.id!)}
              sx={{ flexShrink: 0, gridRow: '1 / 3', alignSelf: 'center' }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
        )
      })}
    </Box>
  )
}
