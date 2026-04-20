import { useState } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

const COLUMN_COUNT = 6

function formatDate(val) {
  if (!val) return '—'
  return new Date(val + 'T00:00:00').toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatTime(val) {
  if (!val) return '—'
  return String(val).slice(0, 5)
}

function isPastDate(val) {
  if (!val) return false
  const d = new Date(val + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function EventCard({ event, onClick, onDelete }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="body2" fontWeight={600}>
            {event.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDate(event.event_date)}
            {event.start_time ? ` · ${formatTime(event.start_time)}` : ''}
            {event.end_time ? ` – ${formatTime(event.end_time)}` : ''}
          </Typography>
          {event.location && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {event.location}
            </Typography>
          )}
        </Box>
        <IconButton
          size="small"
          aria-label="delete event"
          onClick={(e) => { e.stopPropagation(); onDelete?.(event) }}
          sx={{ mt: -0.5, mr: -0.5 }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}

function DesktopRow({ event, onClick, onDelete }) {
  return (
    <TableRow hover onClick={onClick} sx={{ cursor: 'pointer' }}>
      <TableCell>{formatDate(event.event_date)}</TableCell>
      <TableCell>
        <Chip label={event.title} size="small" color="warning" />
      </TableCell>
      <TableCell>{formatTime(event.start_time)}</TableCell>
      <TableCell>{formatTime(event.end_time)}</TableCell>
      <TableCell>{event.location || '—'}</TableCell>
      <TableCell align="right" padding="none" sx={{ pr: 1 }}>
        <IconButton
          size="small"
          aria-label="delete event"
          onClick={(e) => { e.stopPropagation(); onDelete?.(event) }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </TableCell>
    </TableRow>
  )
}

function DesktopHead() {
  return (
    <TableHead>
      <TableRow sx={{ '& th': { fontWeight: 600 } }}>
        <TableCell>Date</TableCell>
        <TableCell>Title</TableCell>
        <TableCell>Start</TableCell>
        <TableCell>End</TableCell>
        <TableCell>Location</TableCell>
        <TableCell />
      </TableRow>
    </TableHead>
  )
}

function PastHeader({ open, count, onToggle }) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1.25,
        cursor: 'pointer',
        userSelect: 'none',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <ExpandMoreIcon
        fontSize="small"
        sx={{
          transition: 'transform 150ms',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}
      />
      <Typography variant="body2" fontWeight={600}>
        Past events ({count})
      </Typography>
    </Box>
  )
}

export default function BandEventsTable({ events, onRowClick, onDelete }) {
  const [pastOpen, setPastOpen] = useState(false)
  const theme = useTheme()
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'))

  const upcoming = events.filter((e) => !isPastDate(e.event_date))
  const past = events.filter((e) => isPastDate(e.event_date))
  const emptyAll = events.length === 0

  if (isCompact) {
    return (
      <Stack spacing={1.5}>
        <Paper variant="outlined">
          {emptyAll ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No events yet — add one to get started.
            </Box>
          ) : upcoming.length === 0 ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No upcoming events.
            </Box>
          ) : (
            upcoming.map((e) => (
              <EventCard key={e.id} event={e} onClick={() => onRowClick(e)} onDelete={onDelete} />
            ))
          )}
        </Paper>
        {past.length > 0 && (
          <Paper variant="outlined">
            <PastHeader open={pastOpen} count={past.length} onToggle={() => setPastOpen((v) => !v)} />
            <Collapse in={pastOpen} unmountOnExit>
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                {past.map((e) => (
                  <EventCard key={e.id} event={e} onClick={() => onRowClick(e)} onDelete={onDelete} />
                ))}
              </Box>
            </Collapse>
          </Paper>
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <DesktopHead />
          <TableBody>
            {emptyAll && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  No events yet — add one to get started.
                </TableCell>
              </TableRow>
            )}
            {!emptyAll && upcoming.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  No upcoming events.
                </TableCell>
              </TableRow>
            )}
            {upcoming.map((e) => (
              <DesktopRow key={e.id} event={e} onClick={() => onRowClick(e)} onDelete={onDelete} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {past.length > 0 && (
        <Paper variant="outlined">
          <PastHeader open={pastOpen} count={past.length} onToggle={() => setPastOpen((v) => !v)} />
          <Collapse in={pastOpen} unmountOnExit>
            <TableContainer sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Table size="small">
                <DesktopHead />
                <TableBody>
                  {past.map((e) => (
                    <DesktopRow key={e.id} event={e} onClick={() => onRowClick(e)} onDelete={onDelete} />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Collapse>
        </Paper>
      )}
    </Stack>
  )
}
