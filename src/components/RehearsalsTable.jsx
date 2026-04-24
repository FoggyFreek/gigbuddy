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
import ShareIcon from '@mui/icons-material/Share'
import Tooltip from '@mui/material/Tooltip'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

const STATUS_COLORS = {
  option: 'default',
  planned: 'primary',
}

const COLUMN_COUNT = 6

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

function tallyCounts(participants) {
  const total = participants?.length ?? 0
  const yes = participants?.filter((p) => p.vote === 'yes').length ?? 0
  const no = participants?.filter((p) => p.vote === 'no').length ?? 0
  const pending = total - yes - no
  return { yes, no, pending, total }
}

function ParticipantProgress({ participants }) {
  const { yes, no, pending, total } = tallyCounts(participants)
  if (!total) {
    return (
      <Typography variant="caption" color="text.secondary">
        no required participants
      </Typography>
    )
  }
  const yesPct = (yes / total) * 100
  const noPct = (no / total) * 100
  const pendingPct = (pending / total) * 100
  return (
    <Box data-testid="participant-progress" sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: 'grey.300' }}>
      {yes > 0 && <Box sx={{ width: `${yesPct}%`, bgcolor: 'success.main' }} />}
      {no > 0 && <Box sx={{ width: `${noPct}%`, bgcolor: 'error.main' }} />}
      {pending > 0 && <Box sx={{ width: `${pendingPct}%`, bgcolor: 'grey.300' }} />}
    </Box>
  )
}

function RehearsalCard({ rehearsal, onClick, onDelete, onShare }) {
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
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {formatDate(rehearsal.proposed_date)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          ({formatTime(rehearsal.start_time)} – {formatTime(rehearsal.end_time)})
        </Typography>
        <IconButton
          size="small"
          aria-label="share rehearsal"
          onClick={(e) => { e.stopPropagation(); onShare?.(rehearsal) }}
          sx={{ ml: 'auto', mt: -0.5 }}
        >
          <ShareIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="delete rehearsal"
          onClick={(e) => { e.stopPropagation(); onDelete?.(rehearsal) }}
          sx={{ mt: -0.5, mr: -0.5 }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
        {rehearsal.location || '—'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <ParticipantProgress participants={rehearsal.participants} />
        <Chip
          label={rehearsal.status}
          color={STATUS_COLORS[rehearsal.status] || 'default'}
          size="small"
          sx={{ ml: 'auto' }}
        />
      </Box>
    </Box>
  )
}

function DesktopRow({ rehearsal, onClick, onDelete, onShare }) {
  return (
    <TableRow hover onClick={onClick} sx={{ cursor: 'pointer' }}>
      <TableCell>{formatDate(rehearsal.proposed_date)}</TableCell>
      <TableCell>{formatTime(rehearsal.start_time)} – {formatTime(rehearsal.end_time)}</TableCell>
      <TableCell>{rehearsal.location || '—'}</TableCell>
      <TableCell>
        <Chip
          label={rehearsal.status}
          color={STATUS_COLORS[rehearsal.status] || 'default'}
          size="small"
        />
      </TableCell>
      <TableCell sx={{ minWidth: 180 }}>
        <ParticipantProgress participants={rehearsal.participants} />
      </TableCell>
      <TableCell align="right" padding="none" sx={{ pr: 1 }}>
        <Tooltip title="Share via WhatsApp">
          <IconButton
            size="small"
            aria-label="share rehearsal"
            onClick={(e) => { e.stopPropagation(); onShare?.(rehearsal) }}
          >
            <ShareIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton
          size="small"
          aria-label="delete rehearsal"
          onClick={(e) => { e.stopPropagation(); onDelete?.(rehearsal) }}
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
        <TableCell>Time</TableCell>
        <TableCell>Location</TableCell>
        <TableCell>Status</TableCell>
        <TableCell>Votes</TableCell>
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
        Past rehearsals ({count})
      </Typography>
    </Box>
  )
}

export default function RehearsalsTable({ rehearsals, onRowClick, onDelete, onShare }) {
  const [pastOpen, setPastOpen] = useState(false)
  const theme = useTheme()
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'))

  const upcoming = rehearsals.filter((r) => !isPastDate(r.proposed_date))
  const past = rehearsals.filter((r) => isPastDate(r.proposed_date))
  const emptyAll = rehearsals.length === 0

  if (isCompact) {
    return (
      <Stack spacing={1.5}>
        <Paper variant="outlined">
          {emptyAll ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No rehearsals yet — propose one to get started.
            </Box>
          ) : upcoming.length === 0 ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No upcoming rehearsals.
            </Box>
          ) : (
            upcoming.map((r) => (
              <RehearsalCard key={r.id} rehearsal={r} onClick={() => onRowClick(r)} onDelete={onDelete} onShare={onShare} />
            ))
          )}
        </Paper>
        {past.length > 0 && (
          <Paper variant="outlined">
            <PastHeader
              open={pastOpen}
              count={past.length}
              onToggle={() => setPastOpen((v) => !v)}
            />
            <Collapse in={pastOpen} unmountOnExit>
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                {past.map((r) => (
                  <RehearsalCard key={r.id} rehearsal={r} onClick={() => onRowClick(r)} onDelete={onDelete} onShare={onShare} />
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
                  No rehearsals yet — propose one to get started.
                </TableCell>
              </TableRow>
            )}
            {!emptyAll && upcoming.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  No upcoming rehearsals.
                </TableCell>
              </TableRow>
            )}
            {upcoming.map((r) => (
              <DesktopRow key={r.id} rehearsal={r} onClick={() => onRowClick(r)} onDelete={onDelete} onShare={onShare} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {past.length > 0 && (
        <Paper variant="outlined">
          <PastHeader
            open={pastOpen}
            count={past.length}
            onToggle={() => setPastOpen((v) => !v)}
          />
          <Collapse in={pastOpen} unmountOnExit>
            <TableContainer sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Table size="small">
                <DesktopHead />
                <TableBody>
                  {past.map((r) => (
                    <DesktopRow key={r.id} rehearsal={r} onClick={() => onRowClick(r)} onDelete={onDelete} onShare={onShare} />
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
