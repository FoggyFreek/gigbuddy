import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PersonIcon from '@mui/icons-material/Person'
import { createTask, deleteTask, updateTask } from '../api/gigs.ts'
import type { Id, Member, Task } from '../types/entities.ts'

interface DueDateAdornmentProps {
  label: string
  onClick: () => void
}

interface GigTasksProps {
  gigId: Id
  initialTasks?: Task[]
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

function formatDueDate(val: string | null | undefined, locale: string): string | undefined {
  if (!val) return undefined
  const parts = val.split('-')
  if (parts.length < 3) return undefined
  const year = Number.parseInt(parts[0], 10)
  const monthIdx = Number.parseInt(parts[1], 10) - 1
  const day = Number.parseInt(parts[2], 10)
  if (monthIdx < 0 || monthIdx > 11) return undefined
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(year, monthIdx, day),
  )
}

function isDueOverdue(due_date: string | null | undefined): boolean {
  if (!due_date) return false
  const parts = due_date.split('-').map(Number)
  if (parts.length < 3) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(parts[0], parts[1] - 1, parts[2]) < today
}

function DueDateAdornment({ label, onClick }: Readonly<DueDateAdornmentProps>) {
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

export default function GigTasks({
  gigId,
  initialTasks = [],
  members = [],
  canWrite = true,
  currentBandMemberId = null,
}: Readonly<GigTasksProps>) {
  const { t, i18n } = useTranslation(['gigs', 'common'])
  const [tasks, setTasks] = useState<Task[]>(initialTasks)

  // add-task form
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState('')
  const [newAssignTo, setNewAssignTo] = useState('')
  const [newDueFocused, setNewDueFocused] = useState(false)
  const newDueInputRef = useRef<HTMLInputElement | null>(null)
  const newTitleInputRef = useRef<HTMLInputElement | null>(null)

  // per-task edit expansion
  const [expandedId, setExpandedId] = useState<Id | null>(null)
  const [focusedDueTaskId, setFocusedDueTaskId] = useState<Id | null>(null)
  const dueInputRefs = useRef<Map<Id, HTMLInputElement>>(new Map())

  // completed section
  const [showCompleted, setShowCompleted] = useState(false)

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

  function cancelAdd() {
    setShowAddForm(false)
    setNewTitle('')
    setNewDue('')
    setNewAssignTo('')
  }

  async function handleAdd() {
    if (!newTitle.trim()) return
    const task = await createTask(gigId, {
      title: newTitle.trim(),
      due_date: newDue || null,
      assigned_to: newAssignTo || null,
    })
    setTasks((prev) => [...prev, task as Task])
    setNewTitle('')
    setNewDue('')
    setNewAssignTo('')
    setTimeout(() => newTitleInputRef.current?.focus(), 0)
  }

  async function handleToggle(task: Task) {
    const updated = await updateTask(gigId, task.id!, { done: !task.done })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? (updated as Task) : t)))
  }

  async function handleDueChange(task: Task, value: string) {
    const updated = await updateTask(gigId, task.id!, { due_date: value || null })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? (updated as Task) : t)))
  }

  async function handleDelete(taskId: Id) {
    await deleteTask(gigId, taskId)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    if (expandedId === taskId) setExpandedId(null)
  }

  async function handleAssign(task: Task, value: string) {
    const updated = await updateTask(gigId, task.id!, { assigned_to: value || null })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? (updated as Task) : t)))
  }

  function getMemberName(id: Id | null | undefined): string | undefined {
    if (!id) return undefined
    return members.find((m) => m.id === id)?.name
  }

  // Render helper — not a component, does not use hooks
  function renderTaskRow(task: Task) {
    const canToggleDone =
      canWrite || (task.assigned_to != null && task.assigned_to === currentBandMemberId)
    const isExpanded = expandedId === task.id
    const dueLabel = formatDueDate(task.due_date, i18n.language)
    const assigneeName = getMemberName(task.assigned_to)
    const overdue = isDueOverdue(task.due_date) && !task.done

    return (
      <Box key={String(task.id)}>
        {/* Main row */}
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            alignItems: 'flex-start',
            py: 0.75,
            px: 0.5,
            borderRadius: 1,
            '&:hover': canWrite ? { bgcolor: 'action.hover' } : undefined,
          }}
        >
          <Checkbox
            size="small"
            checked={task.done ?? false}
            disabled={!canToggleDone}
            onChange={() => handleToggle(task)}
            sx={{ flexShrink: 0, p: 0.25, mt: 0.1 }}
          />
          {/* Title + meta chips — click area to expand edit controls */}
          <Box
            sx={{ flex: 1, minWidth: 0, cursor: canWrite ? 'pointer' : 'default' }}
            onClick={() => {
              if (canWrite) setExpandedId(isExpanded ? null : (task.id ?? null))
            }}
          >
            <Typography
              variant="body2"
              sx={{
                wordBreak: 'break-word',
                textDecoration: task.done ? 'line-through' : 'none',
                color: task.done ? 'text.disabled' : 'text.primary',
                lineHeight: 1.4,
              }}
            >
              {task.title}
            </Typography>
            {/* Metadata chips — hidden while expanded */}
            {!isExpanded && (dueLabel || assigneeName) && (
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                {dueLabel && (
                  <Chip
                    icon={<CalendarMonthIcon />}
                    label={dueLabel}
                    size="small"
                    color={overdue ? 'error' : 'default'}
                    variant="outlined"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      '& .MuiChip-icon': { fontSize: '0.8rem', ml: 0.5 },
                      '& .MuiChip-label': { px: 0.75 },
                    }}
                  />
                )}
                {assigneeName && (
                  <Chip
                    icon={<PersonIcon />}
                    label={assigneeName}
                    size="small"
                    variant="outlined"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      '& .MuiChip-icon': { fontSize: '0.8rem', ml: 0.5 },
                      '& .MuiChip-label': { px: 0.75 },
                    }}
                  />
                )}
              </Stack>
            )}
          </Box>
          {canWrite && (
            <IconButton
              size="small"
              aria-label={t($ => $.tasks.deleteTask, { title: task.title })}
              onClick={(e) => {
                e.stopPropagation()
                handleDelete(task.id!)
              }}
              sx={{ flexShrink: 0, opacity: 0.3, '&:hover': { opacity: 1 }, mt: 0.1 }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>

        {/* Inline edit controls — date and assignee */}
        {canWrite && (
          <Collapse in={isExpanded}>
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ pl: 5, pb: 1, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <TextField
                type="date"
                size="small"
                value={toDateInputValue(task.due_date)}
                onChange={(e) => handleDueChange(task, e.target.value)}
                onFocus={() => setFocusedDueTaskId(task.id ?? null)}
                onBlur={() => setFocusedDueTaskId(null)}
                slotProps={{
                  htmlInput: {
                    ref: setTaskDueInputRef(task.id!),
                    'aria-label': t($ => $.tasks.dueDateFor, { title: task.title }),
                  },
                  input: {
                    endAdornment: (
                      <DueDateAdornment
                        label={t($ => $.tasks.openDuePickerFor, { title: task.title })}
                        onClick={openTaskDuePicker(task.id!)}
                      />
                    ),
                  },
                }}
                sx={{
                  width: 150,
                  '& input::-webkit-datetime-edit': {
                    opacity: task.due_date || focusedDueTaskId === task.id ? 1 : 0,
                  },
                  '& input::-webkit-calendar-picker-indicator': { display: 'none' },
                }}
              />
              {members.length > 0 && (
                <Select
                  size="small"
                  value={task.assigned_to ?? ''}
                  onChange={(e) => handleAssign(task, e.target.value as string)}
                  displayEmpty
                  inputProps={{ 'aria-label': t($ => $.tasks.assignTask, { title: task.title }) }}
                  sx={{ width: 150 }}
                >
                  <MenuItem value="">
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {t($ => $.tasks.unassigned)}
                    </Box>
                  </MenuItem>
                  {members.map((m) => (
                    <MenuItem key={String(m.id)} value={m.id}>
                      {m.name}
                    </MenuItem>
                  ))}
                </Select>
              )}
              <IconButton size="small" onClick={() => setExpandedId(null)} aria-label={t($ => $.tasks.doneEditing)}>
                <CheckIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Collapse>
        )}
      </Box>
    )
  }

  const openTasks = tasks.filter((t) => !t.done)
  const doneTasks = tasks.filter((t) => t.done)

  return (
    <Box>
      {/* Open tasks */}
      {openTasks.length === 0 && doneTasks.length === 0 && !canWrite && (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
          {t($ => $.tasks.empty)}
        </Typography>
      )}
      {openTasks.map((task) => renderTaskRow(task))}

      {/* Add task */}
      {canWrite && (
        <Box sx={{ mt: openTasks.length > 0 ? 0.5 : 0 }}>
          {showAddForm ? (
            <Box>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', px: 0.5 }}>
                {/* Align with task checkboxes */}
                <Box sx={{ width: 30, flexShrink: 0 }} />
                <TextField
                  label={t($ => $.tasks.taskLabel)}
                  placeholder={t($ => $.tasks.taskPlaceholder)}
                  size="small"
                  autoFocus
                  value={newTitle}
                  slotProps={{ htmlInput: { ref: newTitleInputRef } }}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd()
                    if (e.key === 'Escape') cancelAdd()
                  }}
                  sx={{ flex: 1 }}
                />
                <IconButton
                  size="small"
                  color="primary"
                  onClick={handleAdd}
                  disabled={!newTitle.trim()}
                  aria-label={t($ => $.tasks.addTask)}
                >
                  <CheckIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={cancelAdd} aria-label={t($ => $.actions.cancel, { ns: 'common' })}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
              {/* Optional due date + assignee for new task */}
              <Stack direction="row" spacing={0.5} sx={{ pl: 4.75, mt: 0.75, flexWrap: 'wrap' }}>
                <TextField
                  type="date"
                  size="small"
                  value={newDue}
                  onChange={(e) => setNewDue(e.target.value)}
                  onFocus={() => setNewDueFocused(true)}
                  onBlur={() => setNewDueFocused(false)}
                  slotProps={{
                    htmlInput: { ref: newDueInputRef },
                    input: {
                      endAdornment: (
                        <DueDateAdornment label={t($ => $.tasks.openDuePicker)} onClick={openNewDuePicker} />
                      ),
                    },
                    inputLabel: { shrink: newDueFocused || !!newDue },
                  }}
                  label={t($ => $.tasks.due)}
                  sx={{
                    width: 150,
                    '& input::-webkit-datetime-edit': {
                      opacity: newDueFocused || newDue ? 1 : 0,
                    },
                    '& input::-webkit-calendar-picker-indicator': { display: 'none' },
                  }}
                />
                {members.length > 0 && (
                  <Select
                    size="small"
                    value={newAssignTo}
                    onChange={(e) => setNewAssignTo(e.target.value as string)}
                    displayEmpty
                    sx={{ width: 150 }}
                  >
                    <MenuItem value="">
                      <em>{t($ => $.tasks.unassigned)}</em>
                    </MenuItem>
                    {members.map((m) => (
                      <MenuItem key={String(m.id)} value={m.id}>
                        {m.name}
                      </MenuItem>
                    ))}
                  </Select>
                )}
              </Stack>
            </Box>
          ) : (
            <Box
              role="button"
              tabIndex={0}
              onClick={() => setShowAddForm(true)}
              onKeyDown={(e) => e.key === 'Enter' && setShowAddForm(true)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                py: 0.5,
                px: 0.5,
                borderRadius: 1,
                cursor: 'pointer',
                color: 'text.disabled',
                transition: 'color 0.15s, background-color 0.15s',
                '&:hover': { color: 'primary.main', bgcolor: 'action.hover' },
              }}
            >
              <AddIcon fontSize="small" />
              <Typography variant="body2" sx={{ color: 'inherit' }}>
                {t($ => $.tasks.addTask)}
              </Typography>
            </Box>
          )}
        </Box>
      )}

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
            {doneTasks.map((task) => renderTaskRow(task))}
          </Collapse>
        </Box>
      )}
    </Box>
  )
}
