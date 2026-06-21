import type { Rehearsal, Participant, Id } from '../types/entities.ts'
import { type ReactNode, useState } from 'react'
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
import ShareIcon from '@mui/icons-material/Share'
import Tooltip from '@mui/material/Tooltip'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import VoteToggle from './VoteToggle.tsx'
import StatusDot from './StatusDot.tsx'

const STATUS_COLORS: Record<string, string> = {
  option: 'default',
  planned: 'primary',
}

const STATUS_LABELS: Record<string, string> = { option: 'Option', planned: 'Planned' }

const COLUMN_COUNT = 6

function formatDate(val: string | undefined | null) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(val: string | undefined | null) {
  if (!val) return '—'
  return val.slice(0, 5)
}

function isPastDate(val: string | undefined | null) {
  if (!val) return false
  const d = new Date(val)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function tallyCounts(participants: Participant[] | undefined) {
  const total = participants?.length ?? 0
  const yes = participants?.filter((p) => p.vote === 'yes').length ?? 0
  const no = participants?.filter((p) => p.vote === 'no').length ?? 0
  const pending = total - yes - no
  return { yes, no, pending, total }
}

function ParticipantProgress({ participants }: { participants?: Participant[] }) {
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
    <Box data-testid="participant-progress" sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: 'grey.300', flex: 1 }}>
      {yes > 0 && <Box sx={{ width: `${yesPct}%`, bgcolor: 'success.main' }} />}
      {no > 0 && <Box sx={{ width: `${noPct}%`, bgcolor: 'error.main' }} />}
      {pending > 0 && <Box sx={{ width: `${pendingPct}%`, bgcolor: 'grey.300' }} />}
    </Box>
  )
}

interface RehearsalCardProps {
  rehearsal: Rehearsal
  bandMemberId?: Id | null
  active?: boolean
  onClick?: () => void
  onShare?: (rehearsal: Rehearsal) => void
  onVote?: (rehearsalId: Id | undefined, memberId: Id | undefined, vote: string | null) => void
}

function RehearsalCard({ rehearsal, bandMemberId, active, onClick, onShare, onVote }: RehearsalCardProps) {
  const myParticipant = bandMemberId
    ? (rehearsal.participants ?? []).find((p) => p.band_member_id === bandMemberId)
    : null

  return (
    <Box
      onClick={onClick}
      sx={{
        p: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        boxShadow: active ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="body2">
          {formatDate(rehearsal.proposed_date)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          ({formatTime((rehearsal as Record<string, unknown>).start_time as string)} – {formatTime((rehearsal as Record<string, unknown>).end_time as string)})
        </Typography>
        <IconButton
          size="small"
          aria-label="share rehearsal"
          onClick={(e) => { e.stopPropagation(); onShare?.(rehearsal) }}
          sx={{ ml: 'auto', mt: -0.5 }}
        >
          <ShareIcon fontSize="small" />
        </IconButton>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
        {rehearsal.location || '—'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <ParticipantProgress participants={rehearsal.participants} />
        <Chip
          label={rehearsal.status}
          color={(STATUS_COLORS[rehearsal.status ?? ''] as 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning') || 'default'}
          size="small"
        />
      </Box>
      {myParticipant && rehearsal.status !== 'planned' && (
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Typography variant="caption" color="text.secondary">My vote:</Typography>
          <VoteToggle
            vote={myParticipant.vote}
            onChange={(v) => onVote?.(rehearsal.id, bandMemberId ?? undefined, v)}
          />
        </Box>
      )}
    </Box>
  )
}

interface DesktopRowProps {
  rehearsal: Rehearsal
  active?: boolean
  onClick?: () => void
  onShare?: (rehearsal: Rehearsal) => void
}

function DesktopRow({ rehearsal, active, onClick, onShare }: DesktopRowProps) {
  return (
    <TableRow
      hover
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        boxShadow: active ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
      }}
    >
      <TableCell padding="none" align="center" sx={{ pl: 1, width: 24 }}>
        <StatusDot color={STATUS_COLORS[rehearsal.status ?? ''] || 'default'} label={STATUS_LABELS[rehearsal.status ?? ''] || rehearsal.status}/>
      </TableCell>
      <TableCell>{formatDate(rehearsal.proposed_date)}</TableCell>
      <TableCell>{formatTime((rehearsal as Record<string, unknown>).start_time as string)} – {formatTime((rehearsal as Record<string, unknown>).end_time as string)}</TableCell>
      <TableCell>{rehearsal.location || '—'}</TableCell>
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
      </TableCell>
    </TableRow>
  )
}

function DesktopHead() {
  return (
    <TableHead>
      <TableRow sx={{ '& th': { fontWeight: 600 } }}>
        <TableCell padding="none" sx={{ width: 24 }} />
        <TableCell>Date</TableCell>
        <TableCell>Time</TableCell>
        <TableCell>Location</TableCell>
        <TableCell>Votes</TableCell>
        <TableCell />
      </TableRow>
    </TableHead>
  )
}

interface PastHeaderProps {
  open?: boolean
  count?: number
  onToggle?: () => void
}

function PastHeader({ open, count, onToggle }: PastHeaderProps) {
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
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Past rehearsals ({count})
      </Typography>
    </Box>
  )
}

interface RehearsalsTableProps {
  rehearsals?: Rehearsal[]
  bandMemberId?: Id | null
  onVote?: (rehearsalId: Id | undefined, memberId: Id | undefined, vote: string | null) => void
  onRowClick?: (rehearsal: Rehearsal) => void
  onShare?: (rehearsal: Rehearsal) => void
  selectedId?: Id | null
}

export default function RehearsalsTable({ rehearsals = [], bandMemberId, onVote, onRowClick, onShare, selectedId = null }: RehearsalsTableProps) {
  const [pastOpen, setPastOpen] = useState(false)
  const isCompact = useCompactLayout()

  const upcoming = rehearsals.filter((r) => !isPastDate(r.proposed_date))
  const past = rehearsals.filter((r) => isPastDate(r.proposed_date))
  const emptyAll = rehearsals.length === 0

  if (isCompact) {
    let upcomingContent: ReactNode
    if (emptyAll) {
      upcomingContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          No rehearsals yet — propose one to get started.
        </Box>
      )
    } else if (upcoming.length === 0) {
      upcomingContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          No upcoming rehearsals.
        </Box>
      )
    } else {
      upcomingContent = upcoming.map((r) => (
        <RehearsalCard key={String(r.id)} rehearsal={r} bandMemberId={bandMemberId} active={r.id === selectedId} onVote={onVote} onClick={() => onRowClick?.(r)} onShare={onShare} />
      ))
    }

    return (
      <Stack spacing={1.5}>
        <Paper variant="outlined">
          {upcomingContent}
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
                  <RehearsalCard key={String(r.id)} rehearsal={r} bandMemberId={bandMemberId} active={r.id === selectedId} onVote={onVote} onClick={() => onRowClick?.(r)} onShare={onShare} />
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
              <DesktopRow key={String(r.id)} rehearsal={r} active={r.id === selectedId} onClick={() => onRowClick?.(r)} onShare={onShare} />
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
                    <DesktopRow key={String(r.id)} rehearsal={r} active={r.id === selectedId} onClick={() => onRowClick?.(r)} onShare={onShare} />
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
