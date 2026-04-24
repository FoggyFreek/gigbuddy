import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

function formatDate(val) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function isOverdue(task) {
  if (task.done || !task.due_date) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(task.due_date) < today
}

function MobileTaskCard({ task, onRowClick, onToggleDone }) {
  const overdue = isOverdue(task)
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 2fr 1fr', gap: 1, alignItems: 'start' }}>
        {/* Checkbox spanning 2 rows */}
        <Box sx={{ gridRow: '1 / 3', alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Checkbox
            size="small"
            checked={task.done}
            onClick={(e) => {
              e.stopPropagation()
              onToggleDone(task)
            }}
          />
        </Box>

        {/* Row 1 Left: Title */}
        <Box
          onClick={() => onRowClick(task)}
          sx={{
            cursor: 'pointer',
            gridColumn: '2 / 3',
            textDecoration: task.done ? 'line-through' : 'none',
            color: task.done ? 'text.disabled' : 'text.primary',
            wordBreak: 'break-word',
          }}
        >
          <Typography variant="body2" fontWeight={500}>
            {task.title}
          </Typography>
        </Box>

        {/* Row 1 Right: Assigned to */}
        <Box
          onClick={() => onRowClick(task)}
          sx={{
            cursor: 'pointer',
            gridColumn: '3 / 4',
            textAlign: 'right',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Assigned to
          </Typography>
          <Typography variant="body2">
            {task.assigned_to_name ?? '—'}
          </Typography>
        </Box>

        {/* Row 2 Left: Gig */}
        <Box
          onClick={() => onRowClick(task)}
          sx={{
            cursor: 'pointer',
            gridColumn: '2 / 3',
            pt: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="body2">{task.event_description}</Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDate(task.event_date)}
          </Typography>
        </Box>

        {/* Row 2 Right: Due date */}
        <Box
          onClick={() => onRowClick(task)}
          sx={{
            cursor: 'pointer',
            gridColumn: '3 / 4',
            textAlign: 'right',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Due date
          </Typography>
          <Box>
            {task.due_date ? (
              overdue ? (
                <Chip label={formatDate(task.due_date)} color="error" size="small" />
              ) : (
                <Typography variant="body2">
                  {formatDate(task.due_date)}
                </Typography>
              )
            ) : (
              <Typography variant="body2">—</Typography>
            )}
          </Box>
        </Box>
      </Box>
    </Paper>
  )
}

export default function TasksTable({ tasks, onRowClick, onToggleDone }) {
  const theme = useTheme()
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'))

  if (isCompact) {
    return (
      <Box>
        {tasks.length === 0 && (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 4 }}>
            <Typography>No tasks yet.</Typography>
          </Box>
        )}
        {tasks.map((task) => (
          <MobileTaskCard
            key={task.id}
            task={task}
            onRowClick={onRowClick}
            onToggleDone={onToggleDone}
          />
        ))}
      </Box>
    )
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ '& th': { fontWeight: 600 } }}>
            <TableCell padding="checkbox">Done</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Gig</TableCell>
            <TableCell>Assigned to</TableCell>
            <TableCell>Due date</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                No tasks yet.
              </TableCell>
            </TableRow>
          )}
          {tasks.map((task) => {
            const overdue = isOverdue(task)
            return (
              <TableRow
                key={task.id}
                hover
                onClick={() => onRowClick(task)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={task.done}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleDone(task)
                    }}
                  />
                </TableCell>
                <TableCell
                  sx={{
                    textDecoration: task.done ? 'line-through' : 'none',
                    color: task.done ? 'text.disabled' : 'text.primary',
                  }}
                >
                  {task.title}
                </TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2">{task.event_description}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(task.event_date)}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>{task.assigned_to_name ?? '—'}</TableCell>
                <TableCell>
                  {task.due_date ? (
                    overdue ? (
                      <Chip label={formatDate(task.due_date)} color="error" size="small" />
                    ) : (
                      formatDate(task.due_date)
                    )
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
