import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import InputAdornment from '@mui/material/InputAdornment'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ChecklistIcon from '@mui/icons-material/Checklist'
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
// Search text is kept as component-local state so keystrokes never touch the
// parent page's state — the parent (and anything sibling to it, like an open
// split-view detail pane) would otherwise re-render on every keypress. Only
// the settled, debounced value is bubbled up via onSearchChange.
const SEARCH_DEBOUNCE_MS = 300

export type GigsTab = 'upcoming' | 'past'

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
  loading?: boolean
  activeTab?: GigsTab
  onTabChange?: (tab: GigsTab) => void
  onRowClick?: (gig: GigWithExtras) => void
  selectedId?: Id
  onFilterSelectionChange?: (selection: GigsFilterSelection) => void
  search?: string
  onSearchChange?: (value: string) => void
  isSearching?: boolean
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
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

export default function GigsTable({
  gigs,
  loading = false,
  activeTab = 'upcoming',
  onTabChange = () => {},
  onRowClick,
  selectedId = undefined,
  onFilterSelectionChange,
  search = '',
  onSearchChange = () => {},
  isSearching = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: Readonly<GigsTableProps>) {
  const { t } = useTranslation('gigs')
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(ALL_STATUSES))
  const [typeAnchor, setTypeAnchor] = useState<HTMLElement | null>(null)
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null)
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [inputValue, setInputValue] = useState(search)
  const [syncedSearch, setSyncedSearch] = useState(search)
  const [lastSent, setLastSent] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isCompact = useCompactLayout()

  // Adjust local input state when `search` changes externally (e.g. the
  // parent clearing it) — per React's "adjusting state on a prop change"
  // pattern, done during render rather than in an effect. Our own debounced
  // pushes already match `lastSent`, so this never fires as an echo of the
  // user's own typing.
  if (search !== syncedSearch) {
    setSyncedSearch(search)
    if (search !== lastSent) {
      setInputValue(search)
    }
  }

  useEffect(() => {
    onFilterSelectionChange?.({ selectedStatuses, selectedTags })
  }, [onFilterSelectionChange, selectedStatuses, selectedTags])

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  function handleSearchInput(value: string) {
    setInputValue(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLastSent(value)
      onSearchChange(value)
    }, SEARCH_DEBOUNCE_MS)
  }

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

  let filtered = gigs
  if (!allStatusesSelected) filtered = filtered.filter((g) => selectedStatuses.has(g.status ?? ''))
  if (selectedTags.size > 0) {
    filtered = filtered.filter((gig) =>
      (gig.tags ?? []).some((tag) => tag.name && selectedTags.has(tag.name)),
    )
  }

  const emptyMessage = isSearching
    ? t($ => $.table.emptySearch)
    : t(activeTab === 'upcoming' ? ($ => $.table.emptyUpcoming) : ($ => $.table.emptyPast))

  const searchField = (
    <TextField
      size="small"
      placeholder={t($ => $.table.searchPlaceholder)}
      value={inputValue}
      onChange={(e) => handleSearchInput(e.target.value)}
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

  const tabs = (
    <Tabs
      value={activeTab}
      onChange={(_e, v) => onTabChange(v as GigsTab)}
      variant={isCompact ? "fullWidth": "standard"}
      textColor="primary"
      indicatorColor="primary"
      centered
    >
      <Tab value="upcoming" label={t($ => $.table.tabUpcoming)} />
      <Tab value="past" label={t($ => $.table.tabPast)} />
    </Tabs>
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

  const loadMoreFooter = hasMore && (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
      <Button size="small" onClick={onLoadMore} disabled={loadingMore} startIcon={loadingMore ? <CircularProgress size={14} /> : undefined}>
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
      content = filtered.map((gig) => (
        <GigCard key={String(gig.id)} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick?.(gig)} />
      ))
    }

    return (
      <Stack spacing={1.5}>
        {!isSearching && tabs}
        {controls}
        <Paper variant="outlined">
          {content}
        </Paper>
        {!isSearching && loadMoreFooter}
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      {!isSearching && tabs}
      {controls}
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
            {!loading && filtered.map((gig) => (
              <DesktopRow key={String(gig.id)} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick?.(gig)} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!isSearching && loadMoreFooter}
    </Stack>
  )
}
