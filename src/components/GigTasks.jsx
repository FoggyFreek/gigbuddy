import { useState } from 'react'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import { createTask, deleteTask, updateTask } from '../api/gigs.js'

function toDateInputValue(val) {
  if (!val) return ''
  return String(val).slice(0, 10)
}

export default function GigTasks({ gigId, initialTasks = [], members = [] }) {
  const [tasks, setTasks] = useState(initialTasks)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState('')
  const [dueFocused, setDueFocused] = useState(false)
  const [focusedDueTaskId, setFocusedDueTaskId] = useState(null)

  async function handleAdd() {
    if (!newTitle.trim()) return
    const task = await createTask(gigId, { title: newTitle.trim(), due_date: newDue || null })
    setTasks((prev) => [...prev, task])
    setNewTitle('')
    setNewDue('')
  }

  async function handleToggle(task) {
    const updated = await updateTask(gigId, task.id, { done: !task.done })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
  }

  async function handleDueChange(task, value) {
    const updated = await updateTask(gigId, task.id, { due_date: value || null })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
  }

  async function handleDelete(taskId) {
    await deleteTask(gigId, taskId)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  async function handleAssign(task, value) {
    const updated = await updateTask(gigId, task.id, { assigned_to: value || null })
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
  }

  return (
    <Box>
      {/* Add row */}
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
          slotProps={{ inputLabel: { shrink: dueFocused || !!newDue } }}
          label="Due"
          sx={{
            width: 160,
            '& input::-webkit-datetime-edit': {
              opacity: dueFocused || newDue ? 1 : 0,
            },
          }}
        />
        <IconButton onClick={handleAdd} color="primary" disabled={!newTitle.trim()}>
          <AddIcon />
        </IconButton>
      </Stack>

      {tasks.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No tasks yet.
        </Typography>
      )}

      {tasks.map((task) => (
        <Box
          key={task.id}
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
            checked={task.done}
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
              value={toDateInputValue(task.due_date)}
              onChange={(e) => handleDueChange(task, e.target.value)}
              onFocus={() => setFocusedDueTaskId(task.id)}
              onBlur={() => setFocusedDueTaskId(null)}
              slotProps={{ htmlInput: { 'aria-label': `Due date for ${task.title}` } }}
              sx={{
                flexShrink: 0,
                width: { xs: 140, sm: 150 },
                '& input::-webkit-datetime-edit': {
                  opacity: task.due_date || focusedDueTaskId === task.id ? 1 : 0,
                },
              }}
            />
            {members.length > 0 && (
              <Select
                size="small"
                value={task.assigned_to ?? ''}
                onChange={(e) => handleAssign(task, e.target.value)}
                displayEmpty
                inputProps={{ 'aria-label': `Assign ${task.title}` }}
                sx={{ flexShrink: 0, width: 150 }}
              >
                <MenuItem value=""><em>Unassigned</em></MenuItem>
                {members.map((m) => (
                  <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                ))}
              </Select>
            )}
          </Box>
          <IconButton
            size="small"
            onClick={() => handleDelete(task.id)}
            sx={{ flexShrink: 0, gridRow: '1 / 3', alignSelf: 'center' }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
    </Box>
  )
}
