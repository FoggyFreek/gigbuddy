import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import ChecklistIcon from '@mui/icons-material/Checklist'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import MemberAvatarStack from './MemberAvatarStack.jsx'

const STATUS_COLORS = {
  option: 'default',
  confirmed: 'primary',
  announced: 'success',
}

function formatDate(val) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(val) {
  if (!val) return '—'
  return val.slice(0, 5)
}

function GigCard({ gig, onClick }) {
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

export default function GigsTable({ gigs, onRowClick }) {
  const theme = useTheme()
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'))

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {gigs.length === 0 ? (
          <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
            No gigs yet — add one to get started.
          </Box>
        ) : (
          gigs.map((gig) => (
            <GigCard key={gig.id} gig={gig} onClick={() => onRowClick(gig)} />
          ))
        )}
      </Paper>
    )
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ '& th': { fontWeight: 600 } }}>
            <TableCell>Date</TableCell>
            <TableCell>Event</TableCell>
            <TableCell>Venue</TableCell>
            <TableCell>City</TableCell>
            <TableCell>Start</TableCell>
            <TableCell>End</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Band</TableCell>
            <TableCell align="center">Open tasks</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {gigs.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                No gigs yet — add one to get started.
              </TableCell>
            </TableRow>
          )}
          {gigs.map((gig) => (
            <TableRow
              key={gig.id}
              hover
              onClick={() => onRowClick(gig)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell>{formatDate(gig.event_date)}</TableCell>
              <TableCell>{gig.event_description}</TableCell>
              <TableCell>{gig.venue || '—'}</TableCell>
              <TableCell>{gig.city || '—'}</TableCell>
              <TableCell>{formatTime(gig.start_time)}</TableCell>
              <TableCell>{formatTime(gig.end_time)}</TableCell>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
