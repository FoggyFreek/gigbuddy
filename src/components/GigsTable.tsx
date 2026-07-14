import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Collapse from '@mui/material/Collapse'
import Divider from '@mui/material/Divider'
import InputAdornment from '@mui/material/InputAdornment'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ChecklistIcon from '@mui/icons-material/Checklist'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FilterListIcon from '@mui/icons-material/FilterList'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import SearchIcon from '@mui/icons-material/Search'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { venueHeadline, venueCity } from '../utils/venueDisplay.ts'
import MemberAvatarStack from './MemberAvatarStack.tsx'
import GigStatusIcon from './GigStatusIcon.tsx'
import { ALL_STATUSES } from '../utils/gigStatus.ts'
import type { Gig, Member, Id } from '../types/entities.ts'

const COLUMN_COUNT = 7

type GigStatusKey = 'option' | 'confirmed' | 'announced'

type GigWithExtras = Gig & {
  members_availability?: Member[]
  open_task_count?: number
}

interface GigCardProps {
  gig: GigWithExtras
  active?: boolean
  onClick?: () => void
}

interface GigsTableProps {
  gigs: GigWithExtras[]
  onRowClick?: (gig: GigWithExtras) => void
  selectedId?: Id
  onFilterSelectionChange?: (selection: GigsFilterSelection) => void
}

export interface GigsFilterSelection {
  selectedStatuses: ReadonlySet<string>
  selectedTags: ReadonlySet<string>
}

function formatDate(val: string | Date | undefined): string {
  if (!val) return '—'
  return new Date(val as string).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(val: string | null | undefined): string {
  if (!val) return '—'
  return val.slice(0, 5)
}

function isPastDate(val: string | Date | undefined): boolean {
  if (!val) return false
  const d = new Date(val as string)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function eventDateTime(val: string | Date | undefined): number {
  if (!val) return 0
  return new Date(val as string).getTime()
}

function compareEventDateDesc(a: GigWithExtras, b: GigWithExtras): number {
  return eventDateTime(b.event_date) - eventDateTime(a.event_date)
}

function applySearch(list: GigWithExtras[], q: string): GigWithExtras[] {
  if (!q) return list
  const lower = q.toLowerCase()
  return list.filter((g) =>
    [
      g.event_description,
      g.venue?.name, g.venue?.city, g.venue?.country,
      g.festival?.name, g.festival?.city, g.festival?.country,
      ...(g.tags ?? []).map((tag) => tag.name),
    ].some((f) => f && String(f).toLowerCase().includes(lower))
  )
}

function GigCard({ gig, active, onClick }: Readonly<GigCardProps>) {
  const taskCount = gig.open_task_count ?? 0
  const displayVenue = gig.venue ?? gig.festival
  const eventText = [gig.event_description, venueHeadline(displayVenue), venueCity(displayVenue)].filter(Boolean)
  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: 1.25,
        pl: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        boxShadow: active ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <GigStatusIcon status={gig.status} />
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body1">
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
          <Typography variant="body2" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {eventText.length ? eventText.join(' · ') : '—'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
            <MemberAvatarStack members={gig.members_availability} />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

function DesktopRow({ gig, active, onClick }: Readonly<GigCardProps>) {
  return (
    <TableRow
      hover
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        boxShadow: active ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
      }}
    >
      <TableCell padding="none" align="center" sx={{ pl: 1, width: 40 }}>
        <GigStatusIcon status={gig.status} />
      </TableCell>
      <TableCell>{formatDate(gig.event_date)}</TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {gig.banner_path && (
            <Box
              component="img"
              src={`/api/files/${gig.banner_path}`}
              alt=""
              sx={{ height: 28, width: 28, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
            />
          )}
          {gig.event_description}
        </Box>
      </TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <span>{venueHeadline(gig.venue ?? gig.festival) || ' '}</span>
          <Typography variant="caption" color="text.secondary">{venueCity(gig.venue ?? gig.festival) || ' '}</Typography>
        </Box>
      </TableCell>
      <TableCell>{formatTime(gig.start_time)}–{formatTime(gig.end_time)}</TableCell>
      <TableCell>
        <MemberAvatarStack members={gig.members_availability} />
      </TableCell>
      <TableCell align="center">
        {(gig.open_task_count ?? 0) > 0 && (
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: 'action.hover',
            }}
          >
            {gig.open_task_count}
          </Box>
        )}
      </TableCell>
    </TableRow>
  )
}

function DesktopHead() {
  const { t } = useTranslation('gigs')
  return (
    <TableHead>
      <TableRow sx={{ '& th': { fontWeight: 600 } }}>
        <TableCell padding="none" sx={{ width: 40 }} />
        <TableCell>{t($ => $.table.colDate)}</TableCell>
        <TableCell>{t($ => $.table.colEvent)}</TableCell>
        <TableCell>{t($ => $.table.colVenueCity)}</TableCell>
        <TableCell>{t($ => $.table.colTime)}</TableCell>
        <TableCell>{t($ => $.table.colBand)}</TableCell>
        <TableCell align="center">{t($ => $.table.colOpenTasks)}</TableCell>
      </TableRow>
    </TableHead>
  )
}

interface PastGigsHeaderProps {
  open: boolean
  count: number
  onToggle: () => void
}

function PastGigsHeader({ open, count, onToggle }: Readonly<PastGigsHeaderProps>) {
  const { t } = useTranslation('gigs')
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
        {t($ => $.table.pastGigs, { count })}
      </Typography>
    </Box>
  )
}

export default function GigsTable({ gigs, onRowClick, selectedId = undefined, onFilterSelectionChange }: Readonly<GigsTableProps>) {
  const { t } = useTranslation('gigs')
  const [pastOpen, setPastOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(ALL_STATUSES))
  const [typeAnchor, setTypeAnchor] = useState<HTMLElement | null>(null)
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null)
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const isCompact = useCompactLayout()

  useEffect(() => {
    onFilterSelectionChange?.({ selectedStatuses, selectedTags })
  }, [onFilterSelectionChange, selectedStatuses, selectedTags])

  const availableTags = [...new Map(
    gigs.flatMap((gig) => gig.tags ?? [])
      .filter((tag) => tag.name)
      .map((tag) => [tag.name!.toLowerCase(), tag.name!] as const),
  ).values()].sort((a, b) => a.localeCompare(b))

  function toggleStatus(s: string) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function toggleAllStatuses() {
    setSelectedStatuses((prev) =>
      prev.size === ALL_STATUSES.length ? new Set() : new Set(ALL_STATUSES)
    )
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const allStatusesSelected = selectedStatuses.size === ALL_STATUSES.length
  const someStatusesSelected = selectedStatuses.size > 0 && !allStatusesSelected
  const statusFilterActive = !allStatusesSelected

  let filtered = applySearch(gigs, search)
  if (!allStatusesSelected) filtered = filtered.filter((g) => selectedStatuses.has(g.status ?? ''))
  if (selectedTags.size > 0) {
    filtered = filtered.filter((gig) =>
      (gig.tags ?? []).some((tag) => tag.name && selectedTags.has(tag.name)),
    )
  }

  const upcoming = filtered.filter((g) => !isPastDate(g.event_date))
  const past = filtered.filter((g) => isPastDate(g.event_date)).sort(compareEventDateDesc)
  const emptyAll = gigs.length === 0

  const searchField = (
    <TextField
      size="small"
      placeholder={t($ => $.table.searchPlaceholder)}
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      sx={isCompact ? { width: '100%' } : { flex: '1 1 200px', minWidth: 160 }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        },
      }}
    />
  )

  const typeFilter = (
    <>
      <Button
        size="small"
        variant={statusFilterActive ? 'contained' : 'outlined'}
        startIcon={<FilterListIcon />}
        onClick={(e) => setTypeAnchor(e.currentTarget)}
      >
        {statusFilterActive
          ? t($ => $.table.typesWithCount, { count: selectedStatuses.size })
          : t($ => $.table.types)}
      </Button>
      <Menu
        anchorEl={typeAnchor}
        open={Boolean(typeAnchor)}
        onClose={() => setTypeAnchor(null)}
      >
        <MenuItem dense onClick={toggleAllStatuses}>
          <Checkbox
            size="small"
            checked={allStatusesSelected}
            indeterminate={someStatusesSelected}
          />
          <ListItemText primary={t($ => $.table.allStatuses)} />
        </MenuItem>
        <Divider />
        {ALL_STATUSES.map((s) => (
          <MenuItem key={s} dense onClick={() => toggleStatus(s)}>
            <Checkbox size="small" checked={selectedStatuses.has(s)} />
            <ListItemText primary={t($ => $.status[s as GigStatusKey])} />
          </MenuItem>
        ))}
      </Menu>
    </>
  )

  const tagFilter = (
    <>
      <Button
        size="small"
        variant={selectedTags.size > 0 ? 'contained' : 'outlined'}
        startIcon={<LocalOfferOutlinedIcon />}
        onClick={(e) => setTagAnchor(e.currentTarget)}
        disabled={availableTags.length === 0}
      >
        {selectedTags.size > 0
          ? t($ => $.table.tagsWithCount, { count: selectedTags.size })
          : t($ => $.table.tags)}
      </Button>
      <Menu
        anchorEl={tagAnchor}
        open={Boolean(tagAnchor)}
        onClose={() => setTagAnchor(null)}
      >
        <MenuItem dense onClick={() => setSelectedTags(new Set())}>
          <Checkbox size="small" checked={selectedTags.size === 0} />
          <ListItemText primary={t($ => $.table.allTags)} />
        </MenuItem>
        <Divider />
        {availableTags.map((tag) => (
          <MenuItem key={tag} dense onClick={() => toggleTag(tag)}>
            <Checkbox size="small" checked={selectedTags.has(tag)} />
            <ListItemText primary={tag} />
          </MenuItem>
        ))}
      </Menu>
    </>
  )

  const controls = isCompact ? (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {typeFilter}
        {tagFilter}
      </Box>
      {searchField}
    </Stack>
  ) : (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      {searchField}
      {typeFilter}
      {tagFilter}
    </Box>
  )

  if (isCompact) {
    let upcomingContent: ReactNode
    if (emptyAll) {
      upcomingContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {t($ => $.table.emptyAll)}
        </Box>
      )
    } else if (upcoming.length === 0) {
      upcomingContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {t($ => $.table.emptyUpcoming)}
        </Box>
      )
    } else {
      upcomingContent = upcoming.map((gig) => (
        <GigCard key={String(gig.id)} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick?.(gig)} />
      ))
    }

    return (
      <Stack spacing={1.5}>
        {controls}
        <Paper variant="outlined">
          {upcomingContent}
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
                  <GigCard key={String(gig.id)} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick?.(gig)} />
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
      {controls}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <DesktopHead />
          <TableBody>
            {emptyAll && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  {t($ => $.table.emptyAll)}
                </TableCell>
              </TableRow>
            )}
            {!emptyAll && upcoming.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  {t($ => $.table.emptyUpcoming)}
                </TableCell>
              </TableRow>
            )}
            {upcoming.map((gig) => (
              <DesktopRow key={String(gig.id)} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick?.(gig)} />
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
                    <DesktopRow key={String(gig.id)} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick?.(gig)} />
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
