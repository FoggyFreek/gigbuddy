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

export default function TasksTable({ tasks, onRowClick, onToggleDone }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ '& th': { fontWeight: 600 } }}>
            <TableCell padding="checkbox">Done</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Due date</TableCell>
            <TableCell>Gig</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', py: 4 }}>
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
                <TableCell>
                  <Box>
                    <Typography variant="body2">{task.event_description}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(task.event_date)}
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
