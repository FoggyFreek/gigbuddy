import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'

import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import ShareIcon from '@mui/icons-material/Share'
import Tooltip from '@mui/material/Tooltip'
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

export type BandEventsTab = 'upcoming' | 'past'

interface BandEventRowProps {
  event: BandEventWithTime
  active?: boolean
  onClick?: () => void
  onShare?: (event: BandEventWithTime) => void
}

interface BandEventsTableProps {
  events: BandEventWithTime[]
  loading?: boolean
  activeTab?: BandEventsTab
  onTabChange?: (tab: BandEventsTab) => void
  onRowClick?: (event: BandEventWithTime) => void
  onShare?: (event: BandEventWithTime) => void
  selectedId?: Id
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

function EventCard({ event, active, onClick, onShare }: Readonly<BandEventRowProps>) {
  const { t } = useTranslation('bandEvents')
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
          aria-label={t($ => $.table.shareEvent)}
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

function DesktopRow({ event, active, onClick, onShare }: Readonly<BandEventRowProps>) {
  const { t } = useTranslation('bandEvents')
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
        <Tooltip title={t($ => $.table.shareWhatsApp)}>
          <IconButton
            size="small"
            aria-label={t($ => $.table.shareEvent)}
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
  const { t } = useTranslation('bandEvents')
  return (
    <TableHead>
      <TableRow sx={{ '& th': { fontWeight: 600 } }}>
        <TableCell>{t($ => $.table.colDate)}</TableCell>
        <TableCell>{t($ => $.table.colTitle)}</TableCell>
        <TableCell>{t($ => $.table.colTime)}</TableCell>
        <TableCell>{t($ => $.table.colLocation)}</TableCell>
        <TableCell />
      </TableRow>
    </TableHead>
  )
}

export default function BandEventsTable({
  events,
  loading = false,
  activeTab = 'upcoming',
  onTabChange = () => {},
  onRowClick,
  onShare,
  selectedId = undefined,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: Readonly<BandEventsTableProps>) {
  const { t } = useTranslation('bandEvents')
  const isCompact = useCompactLayout()

  const tabs = (
    <Tabs
      value={activeTab}
      onChange={(_event, value) => onTabChange(value as BandEventsTab)}
      variant={isCompact ? 'fullWidth' : 'standard'}
      textColor="primary"
      indicatorColor="primary"
      centered
    >
      <Tab value="upcoming" label={t($ => $.table.tabUpcoming)} />
      <Tab value="past" label={t($ => $.table.tabPast)} />
    </Tabs>
  )

  const emptyMessage = activeTab === 'upcoming'
    ? t($ => $.table.emptyUpcoming)
    : t($ => $.table.emptyPast)

  const loadMoreFooter = hasMore && (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
      <Button
        size="small"
        onClick={onLoadMore}
        disabled={loadingMore}
        startIcon={loadingMore ? <CircularProgress size={14} /> : undefined}
      >
        {t($ => $.table.loadMore)}
      </Button>
    </Box>
  )

  if (isCompact) {
    let content: ReactNode
    if (loading) {
      content = (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      )
    } else if (events.length === 0) {
      content = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {emptyMessage}
        </Box>
      )
    } else {
      content = events.map((e) => (
        <EventCard key={String(e.id)} event={e} active={e.id === selectedId} onClick={() => onRowClick?.(e)} onShare={onShare} />
      ))
    }

    return (
      <Stack spacing={1.5}>
        {tabs}
        <Paper variant="outlined">
          {content}
        </Paper>
        {loadMoreFooter}
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      {tabs}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <DesktopHead />
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            )}
            {!loading && events.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {!loading && events.map((e) => (
              <DesktopRow key={String(e.id)} event={e} active={e.id === selectedId} onClick={() => onRowClick?.(e)} onShare={onShare} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {loadMoreFooter}
    </Stack>
  )
}
