import { useState } from 'react'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Collapse from '@mui/material/Collapse'
import ChecklistIcon from '@mui/icons-material/Checklist'
import DeleteIcon from '@mui/icons-material/Delete'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import MemberAvatarStack from './MemberAvatarStack.jsx'

const STATUS_COLORS = {
  option: 'default',
  confirmed: 'primary',
  announced: 'success',
}

const COLUMN_COUNT = 8

function formatDate(val) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(val) {
  if (!val) return '—'
  return val.slice(0, 5)
}

function isPastDate(val) {
  if (!val) return false
  const d = new Date(val)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function GigCard({ gig, onClick, onDelete }) {
  const taskCount = gig.open_task_count ?? 0
  const metaParts = [gig.event_description, gig.venue, gig.city].filter(Boolean)
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {formatDate(gig.event_date)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          ({formatTime(gig.start_time)} – {formatTime(gig.end_time)})
        </Typography>
        {taskCount > 0 && (
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.25, color: 'text.secondary' }}>
            <ChecklistIcon fontSize="small" />
            <Typography variant="caption">{taskCount}</Typography>
          </Box>
        )}
        <IconButton
          size="small"
          aria-label="delete gig"
          onClick={(e) => { e.stopPropagation(); onDelete?.(gig) }}
          sx={{ ml: taskCount > 0 ? 0.5 : 'auto', mt: -0.5, mr: -0.5 }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
        {metaParts.length ? metaParts.join(' · ') : '—'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <MemberAvatarStack members={gig.members_availability} />
        <Chip
          label={gig.status}
          color={STATUS_COLORS[gig.status] || 'default'}
          size="small"
          sx={{ ml: 'auto' }}
        />
      </Box>
    </Box>
  )
}

function DesktopRow({ gig, onClick, onDelete }) {
  return (
    <TableRow hover onClick={onClick} sx={{ cursor: 'pointer' }}>
      <TableCell>{formatDate(gig.event_date)}</TableCell>
      <TableCell>{gig.event_description}</TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <span>{gig.venue || ' '}</span>
          <Typography variant="caption" color="text.secondary">{gig.city || ' '}</Typography>
        </Box>
      </TableCell>
      <TableCell>{formatTime(gig.start_time)}–{formatTime(gig.end_time)}</TableCell>
      <TableCell>
        <Chip
          label={gig.status}
          color={STATUS_COLORS[gig.status] || 'default'}
          size="small"
        />
      </TableCell>
      <TableCell>
        <MemberAvatarStack members={gig.members_availability} />
      </TableCell>
      <TableCell align="center">{gig.open_task_count ?? 0}</TableCell>
      <TableCell align="right" padding="none" sx={{ pr: 1 }}>
        <IconButton
          size="small"
          aria-label="delete gig"
          onClick={(e) => { e.stopPropagation(); onDelete?.(gig) }}
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
        <TableCell>Event</TableCell>
        <TableCell>Venue / City</TableCell>
        <TableCell>Duration</TableCell>
        <TableCell>Status</TableCell>
        <TableCell>Band</TableCell>
        <TableCell align="center">Open tasks</TableCell>
        <TableCell />
      </TableRow>
    </TableHead>
  )
}

function PastGigsHeader({ open, count, onToggle }) {
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
        Past gigs ({count})
      </Typography>
    </Box>
  )
}

export default function GigsTable({ gigs, onRowClick, onDelete }) {
  const [pastOpen, setPastOpen] = useState(false)
  const theme = useTheme()
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'))

  const upcoming = gigs.filter((g) => !isPastDate(g.event_date))
  const past = gigs.filter((g) => isPastDate(g.event_date))

  const emptyAll = gigs.length === 0

  if (isCompact) {
    return (
      <Stack spacing={1.5}>
        <Paper variant="outlined">
          {emptyAll ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No gigs yet — add one to get started.
            </Box>
          ) : upcoming.length === 0 ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No upcoming gigs.
            </Box>
          ) : (
            upcoming.map((gig) => (
              <GigCard key={gig.id} gig={gig} onClick={() => onRowClick(gig)} onDelete={onDelete} />
            ))
          )}
        </Paper>
        {past.length > 0 && (
          <Paper variant="outlined">
            <PastGigsHeader
              open={pastOpen}
              count={past.length}
              onToggle={() => setPastOpen((v) => !v)}
            />
            <Collapse in={pastOpen} unmountOnExit>
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                {past.map((gig) => (
                  <GigCard key={gig.id} gig={gig} onClick={() => onRowClick(gig)} onDelete={onDelete} />
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
                  No gigs yet — add one to get started.
                </TableCell>
              </TableRow>
            )}
            {!emptyAll && upcoming.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  No upcoming gigs.
                </TableCell>
              </TableRow>
            )}
            {upcoming.map((gig) => (
              <DesktopRow key={gig.id} gig={gig} onClick={() => onRowClick(gig)} onDelete={onDelete} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {past.length > 0 && (
        <Paper variant="outlined">
          <PastGigsHeader
            open={pastOpen}
            count={past.length}
            onToggle={() => setPastOpen((v) => !v)}
          />
          <Collapse in={pastOpen} unmountOnExit>
            <TableContainer sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Table size="small">
                <DesktopHead />
                <TableBody>
                  {past.map((gig) => (
                    <DesktopRow key={gig.id} gig={gig} onClick={() => onRowClick(gig)} onDelete={onDelete} />
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
