import type { Rehearsal, Participant, Id } from '../types/entities.ts'
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
import VoteToggle from './VoteToggle.tsx'
import RehearsalStatusIcon from './RehearsalStatusIcon.tsx'

const COLUMN_COUNT = 6

function formatDate(val: string | undefined | null) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(val: string | undefined | null) {
  if (!val) return '—'
  return val.slice(0, 5)
}

export type RehearsalsTab = 'upcoming' | 'past'

function tallyCounts(participants: Participant[] | undefined) {
  const total = participants?.length ?? 0
  const yes = participants?.filter((p) => p.vote === 'yes').length ?? 0
  const no = participants?.filter((p) => p.vote === 'no').length ?? 0
  const pending = total - yes - no
  return { yes, no, pending, total }
}

function ParticipantProgress({ participants }: Readonly<{ participants?: Participant[] }>) {
  const { t } = useTranslation('rehearsals')
  const { yes, no, pending, total } = tallyCounts(participants)
  if (!total) {
    return (
      <Typography variant="caption" color="text.secondary">
        {t($ => $.table.noRequiredParticipants)}
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

function RehearsalCard({ rehearsal, bandMemberId, active, onClick, onShare, onVote }: Readonly<RehearsalCardProps>) {
  const { t } = useTranslation('rehearsals')
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <RehearsalStatusIcon status={rehearsal.status} />
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2">
              {formatDate(rehearsal.proposed_date)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              ({formatTime((rehearsal as Record<string, unknown>).start_time as string)} – {formatTime((rehearsal as Record<string, unknown>).end_time as string)})
            </Typography>
            <IconButton
              size="small"
              aria-label={t($ => $.table.shareRehearsal)}
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
          </Box>
          {myParticipant && rehearsal.status !== 'planned' && (
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}
              onClick={(e) => e.stopPropagation()}
            >
              <Typography variant="caption" color="text.secondary">{t($ => $.table.myVote)}</Typography>
              <VoteToggle
                vote={myParticipant.vote}
                onChange={(v) => onVote?.(rehearsal.id, bandMemberId ?? undefined, v)}
              />
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

interface DesktopRowProps {
  rehearsal: Rehearsal
  active?: boolean
  onClick?: () => void
  onShare?: (rehearsal: Rehearsal) => void
}

function DesktopRow({ rehearsal, active, onClick, onShare }: Readonly<DesktopRowProps>) {
  const { t } = useTranslation('rehearsals')
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
      <TableCell padding="none" align="center" sx={{ pl: 1, width: 40 }}>
        <RehearsalStatusIcon status={rehearsal.status} />
      </TableCell>
      <TableCell>{formatDate(rehearsal.proposed_date)}</TableCell>
      <TableCell>{formatTime((rehearsal as Record<string, unknown>).start_time as string)} – {formatTime((rehearsal as Record<string, unknown>).end_time as string)}</TableCell>
      <TableCell>{rehearsal.location || '—'}</TableCell>
      <TableCell sx={{ minWidth: 180 }}>
        <ParticipantProgress participants={rehearsal.participants} />
      </TableCell>
      <TableCell align="right" padding="none" sx={{ pr: 1 }}>
        <Tooltip title={t($ => $.table.shareWhatsApp)}>
          <IconButton
            size="small"
            aria-label={t($ => $.table.shareRehearsal)}
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
  const { t } = useTranslation('rehearsals')
  return (
    <TableHead>
      <TableRow sx={{ '& th': { fontWeight: 600 } }}>
        <TableCell padding="none" sx={{ width: 40 }} />
        <TableCell>{t($ => $.table.colDate)}</TableCell>
        <TableCell>{t($ => $.table.colTime)}</TableCell>
        <TableCell>{t($ => $.table.colLocation)}</TableCell>
        <TableCell>{t($ => $.table.colVotes)}</TableCell>
        <TableCell />
      </TableRow>
    </TableHead>
  )
}

interface RehearsalsTableProps {
  rehearsals?: Rehearsal[]
  loading?: boolean
  activeTab?: RehearsalsTab
  onTabChange?: (tab: RehearsalsTab) => void
  selectedStatuses?: ReadonlySet<string>
  bandMemberId?: Id | null
  onVote?: (rehearsalId: Id | undefined, memberId: Id | undefined, vote: string | null) => void
  onRowClick?: (rehearsal: Rehearsal) => void
  onShare?: (rehearsal: Rehearsal) => void
  selectedId?: Id | null
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

export default function RehearsalsTable({
  rehearsals = [],
  loading = false,
  activeTab = 'upcoming',
  onTabChange = () => {},
  selectedStatuses,
  bandMemberId,
  onVote,
  onRowClick,
  onShare,
  selectedId = null,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: Readonly<RehearsalsTableProps>) {
  const { t } = useTranslation('rehearsals')
  const isCompact = useCompactLayout()

  const filtered = selectedStatuses
    ? rehearsals.filter((rehearsal) => selectedStatuses.has(rehearsal.status ?? ''))
    : rehearsals

  const tabs = (
    <Tabs
      value={activeTab}
      onChange={(_event, value) => onTabChange(value as RehearsalsTab)}
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
    } else if (filtered.length === 0) {
      content = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {emptyMessage}
        </Box>
      )
    } else {
      content = filtered.map((r) => (
        <RehearsalCard key={String(r.id)} rehearsal={r} bandMemberId={bandMemberId} active={r.id === selectedId} onVote={onVote} onClick={() => onRowClick?.(r)} onShare={onShare} />
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
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.map((r) => (
              <DesktopRow key={String(r.id)} rehearsal={r} active={r.id === selectedId} onClick={() => onRowClick?.(r)} onShare={onShare} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {loadMoreFooter}
    </Stack>
  )
}
