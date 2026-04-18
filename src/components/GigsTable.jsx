import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
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

export default function GigsTable({ gigs, onRowClick }) {
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
