import { type ReactNode, useState } from 'react'
import Box from '@mui/material/Box'

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
import type { BandEvent, Id } from '../types/entities.ts'

type BandEventWithTime = BandEvent & { start_time?: string; end_time?: string }

const COLUMN_COUNT = 5

function formatDate(val: string | undefined) {
  if (!val) return '—'
  return new Date(val + 'T00:00:00').toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateRange(start: string | undefined, end: string | undefined) {
  if (!start) return '—'
  const s = formatDate(start)
  if (!end || end === start) return s
  return `${s} – ${formatDate(end)}`
}

function formatTime(val: string | undefined) {
  if (!val) return '—'
  return String(val).slice(0, 5)
}

function formatTimeRange(start: string | undefined, end: string | undefined) {
  if (!start && !end) return '—'
  const s = formatTime(start)
  const e = formatTime(end)
  if (!end) return s
  if (!start) return e
  return `${s} – ${e}`
}

function pastEventDateValue(event: BandEventWithTime): string | undefined {
  return event.end_date || event.start_date
}

function pastEventDateTime(event: BandEventWithTime): number {
  const val = pastEventDateValue(event)
  if (!val) return 0
  return new Date(val + 'T00:00:00').getTime()
}

function comparePastEventDateDesc(a: BandEventWithTime, b: BandEventWithTime): number {
  return pastEventDateTime(b) - pastEventDateTime(a)
}

function isPastEvent(event: BandEventWithTime) {
  const val = pastEventDateValue(event)
  if (!val) return false
  const d = new Date(val + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

interface BandEventRowProps {
  event: BandEventWithTime
  active?: boolean
  onClick?: () => void
  onShare?: (event: BandEventWithTime) => void
}

interface PastHeaderProps {
  open?: boolean
  count?: number
  onToggle?: () => void
}

interface BandEventsTableProps {
  events: BandEventWithTime[]
  onRowClick?: (event: BandEventWithTime) => void
  onShare?: (event: BandEventWithTime) => void
  selectedId?: Id
}

function EventCard({ event, active, onClick, onShare }: BandEventRowProps) {
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2">
          {formatDateRange(event.start_date, event.end_date)}
        </Typography>
        {(event.start_time || event.end_time) && (
          <Typography variant="body2" color="text.secondary">
            ({formatTimeRange(event.start_time, event.end_time)})
          </Typography>
        )}
        <IconButton
          size="small"
          aria-label="share event"
          onClick={(e) => { e.stopPropagation(); onShare?.(event) }}
          sx={{ ml: 'auto', mt: -0.5 }}
        >
          <ShareIcon fontSize="small" />
        </IconButton>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
        {[event.title, event.location].filter(Boolean).join(' · ') || '—'}
      </Typography>
    </Box>
  )
}

function DesktopRow({ event, active, onClick, onShare }: BandEventRowProps) {
  return (
    <TableRow
      hover
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        boxShadow: active ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
        '& td': { py: 1.25 },
      }}
    >
      <TableCell>{formatDateRange(event.start_date, event.end_date)}</TableCell>
      <TableCell>{event.title}</TableCell>
      <TableCell>{formatTimeRange(event.start_time, event.end_time)}</TableCell>
      <TableCell>{event.location || '—'}</TableCell>
      <TableCell align="right" padding="none" sx={{ pr: 1 }}>
        <Tooltip title="Share via WhatsApp">
          <IconButton
            size="small"
            aria-label="share event"
            onClick={(e) => { e.stopPropagation(); onShare?.(event) }}
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
        <TableCell>Date</TableCell>
        <TableCell>Title</TableCell>
        <TableCell>Time</TableCell>
        <TableCell>Location</TableCell>
        <TableCell />
      </TableRow>
    </TableHead>
  )
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
        Past events ({count})
      </Typography>
    </Box>
  )
}

export default function BandEventsTable({ events, onRowClick, onShare, selectedId = undefined }: BandEventsTableProps) {
  const [pastOpen, setPastOpen] = useState(false)
  const isCompact = useCompactLayout()

  const upcoming = events.filter((e) => !isPastEvent(e))
  const past = events.filter((e) => isPastEvent(e)).sort(comparePastEventDateDesc)
  const emptyAll = events.length === 0

  if (isCompact) {
    let upcomingContent: ReactNode
    if (emptyAll) {
      upcomingContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          No events yet — add one to get started.
        </Box>
      )
    } else if (upcoming.length === 0) {
      upcomingContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          No upcoming events.
        </Box>
      )
    } else {
      upcomingContent = upcoming.map((e) => (
        <EventCard key={String(e.id)} event={e} active={e.id === selectedId} onClick={() => onRowClick?.(e)} onShare={onShare} />
      ))
    }

    return (
      <Stack spacing={1.5}>
        <Paper variant="outlined">
          {upcomingContent}
        </Paper>
        {past.length > 0 && (
          <Paper variant="outlined">
            <PastHeader open={pastOpen} count={past.length} onToggle={() => setPastOpen((v) => !v)} />
            <Collapse in={pastOpen} unmountOnExit>
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                {past.map((e) => (
                  <EventCard key={String(e.id)} event={e} active={e.id === selectedId} onClick={() => onRowClick?.(e)} onShare={onShare} />
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
              <DesktopRow key={String(e.id)} event={e} active={e.id === selectedId} onClick={() => onRowClick?.(e)} onShare={onShare} />
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
                    <DesktopRow key={String(e.id)} event={e} active={e.id === selectedId} onClick={() => onRowClick?.(e)} onShare={onShare} />
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
