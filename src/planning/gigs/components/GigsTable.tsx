import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
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
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'
import { venueHeadline, venueCity } from '../../../people/venues/venueDisplay.ts'
import MemberAvatarStack from '../../../components/MemberAvatarStack.tsx'
import GigStatusIcon from './GigStatusIcon.tsx'
import PlanningSourceIdentity from '../../shared/PlanningSourceIdentity.tsx'
import { ALL_STATUSES } from '../gigStatus.ts'
import type { Gig, Member, MemberAvailability, Id } from '../../../types/entities.ts'
import type { MaybeCrossTenant } from '../../../types/api.ts'

const BASE_COLUMN_COUNT = 7
// Search text is kept as component-local state so keystrokes never touch the
// parent page's state — the parent (and anything sibling to it, like an open
// split-view detail pane) would otherwise re-render on every keypress. Only
// the settled, debounced value is bubbled up via onSearchChange.
const SEARCH_DEBOUNCE_MS = 300

export type GigsTab = 'upcoming' | 'past'

type GigStatusKey = 'option' | 'confirmed' | 'announced'

// `showBand` rows come from the cross-tenant `/api/me` feeds, so the band label
// fields may be present.
type GigWithExtras = MaybeCrossTenant<Gig> & {
  members_availability?: MemberAvailability[]
  open_task_count?: number
}

interface GigCardProps {
  gig: GigWithExtras
  active?: boolean
  onClick?: () => void
  showBand?: boolean
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
  showBand?: boolean
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

function filterGigs(
  gigs: GigWithExtras[],
  selectedStatuses: ReadonlySet<string>,
  selectedTags: ReadonlySet<string>,
): GigWithExtras[] {
  let filtered = gigs
  if (selectedStatuses.size !== ALL_STATUSES.length) {
    filtered = filtered.filter((g) => selectedStatuses.has(g.status ?? ''))
  }
  if (selectedTags.size > 0) {
    filtered = filtered.filter((gig) =>
      (gig.tags ?? []).some((tag) => tag.name && selectedTags.has(tag.name)),
    )
  }
  return filtered
}

function GigCard({ gig, active, onClick, showBand = false }: Readonly<GigCardProps>) {
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
            {showBand && (
              <Box sx={{ mr: 1 }}>
                <PlanningSourceIdentity source={gig} withName />
              </Box>
            )}
            <MemberAvatarStack members={gig.members_availability} />
            {(gig.tags ?? []).some((tag) => tag.name) && (
              <Box
                data-testid={`gig-card-tags-${String(gig.id)}`}
                sx={{
                  display: 'flex',
                  flexDirection: 'row-reverse',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 0.5,
                  minWidth: 0,
                  ml: 'auto',
                  pl: 1,
                }}
              >
                {(gig.tags ?? []).filter((tag) => tag.name).map((tag) => (
                  <Chip
                    key={`${String(tag.id ?? 'tag')}-${tag.name}`}
                    label={tag.name}
                    size="small"
                    variant="filled"
                  />
                ))}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

function DesktopRow({ gig, active, onClick, showBand = false }: Readonly<GigCardProps>) {
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
      {showBand && (
        <TableCell>
          <PlanningSourceIdentity source={gig} />
        </TableCell>
      )}
      <TableCell>
        <MemberAvatarStack members={gig.members_availability} />
      </TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          {(gig.open_task_count ?? 0) > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: 'text.secondary' }}>
              <ChecklistIcon fontSize="small" />
              <Typography variant="caption">{gig.open_task_count}</Typography>
            </Box>
          )}
          {(gig.tags ?? []).filter((tag) => tag.name).map((tag) => (
            <Chip
              key={`${String(tag.id ?? 'tag')}-${tag.name}`}
              label={tag.name}
              size="small"
              variant="filled"
            />
          ))}
        </Box>
      </TableCell>
    </TableRow>
  )
}

function DesktopHead({ showBand = false }: Readonly<{ showBand?: boolean }>) {
  const { t } = useTranslation('gigs')
  return (
    <TableHead>
      <TableRow sx={{ '& th': { fontWeight: 600 } }}>
        <TableCell padding="none" sx={{ width: 40 }} />
        <TableCell>{t($ => $.table.colDate)}</TableCell>
        <TableCell>{t($ => $.table.colEvent)}</TableCell>
        <TableCell>{t($ => $.table.colVenueCity)}</TableCell>
        <TableCell>{t($ => $.table.colTime)}</TableCell>
        {showBand && <TableCell>{t($ => $.table.colBand)}</TableCell>}
        <TableCell>{t($ => $.table.colAvailability)}</TableCell>
        <TableCell />
      </TableRow>
    </TableHead>
  )
}

interface GigsSearchFieldProps {
  search: string
  onSearchChange: (value: string) => void
  isCompact: boolean
}

// Owns the search text and its debounce so keystrokes stay local (see the
// SEARCH_DEBOUNCE_MS comment above).
function GigsSearchField({ search, onSearchChange, isCompact }: Readonly<GigsSearchFieldProps>) {
  const { t } = useTranslation('gigs')
  const [inputValue, setInputValue] = useState(search)
  const [syncedSearch, setSyncedSearch] = useState(search)
  const [lastSent, setLastSent] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  return (
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
}

interface StatusFilterMenuProps {
  selectedStatuses: Set<string>
  setSelectedStatuses: Dispatch<SetStateAction<Set<string>>>
}

function StatusFilterMenu({ selectedStatuses, setSelectedStatuses }: Readonly<StatusFilterMenuProps>) {
  const { t } = useTranslation('gigs')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const allStatusesSelected = selectedStatuses.size === ALL_STATUSES.length
  const someStatusesSelected = selectedStatuses.size > 0 && !allStatusesSelected
  const statusFilterActive = !allStatusesSelected

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

  return (
    <>
      <Button
        size="small"
        variant={statusFilterActive ? 'contained' : 'outlined'}
        startIcon={<FilterListIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        {statusFilterActive
          ? t($ => $.table.typesWithCount, { count: selectedStatuses.size })
          : t($ => $.table.types)}
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
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
}

interface TagFilterMenuProps {
  availableTags: string[]
  selectedTags: Set<string>
  setSelectedTags: Dispatch<SetStateAction<Set<string>>>
}

function TagFilterMenu({ availableTags, selectedTags, setSelectedTags }: Readonly<TagFilterMenuProps>) {
  const { t } = useTranslation('gigs')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  return (
    <>
      <Button
        size="small"
        variant={selectedTags.size > 0 ? 'contained' : 'outlined'}
        startIcon={<LocalOfferOutlinedIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        disabled={availableTags.length === 0}
      >
        {selectedTags.size > 0
          ? t($ => $.table.tagsWithCount, { count: selectedTags.size })
          : t($ => $.table.tags)}
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
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
}

interface GigListBodyProps {
  loading: boolean
  gigs: GigWithExtras[]
  emptyMessage: string
  selectedId?: Id
  onRowClick?: (gig: GigWithExtras) => void
  showBand?: boolean
}

function CompactGigList({ loading, gigs, emptyMessage, selectedId, onRowClick, showBand }: Readonly<GigListBodyProps>) {
  let content: ReactNode
  if (loading) {
    content = (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    )
  } else if (gigs.length === 0) {
    content = (
      <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
        {emptyMessage}
      </Box>
    )
  } else {
    content = gigs.map((gig) => (
      <GigCard key={String(gig.id)} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick?.(gig)} showBand={showBand} />
    ))
  }

  return (
    <Paper variant="outlined">
      {content}
    </Paper>
  )
}

function DesktopGigTable({ loading, gigs, emptyMessage, selectedId, onRowClick, showBand }: Readonly<GigListBodyProps>) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <DesktopHead showBand={showBand} />
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={BASE_COLUMN_COUNT + (showBand ? 1 : 0)} align="center" sx={{ py: 4 }}>
                <CircularProgress size={24} />
              </TableCell>
            </TableRow>
          )}
          {!loading && gigs.length === 0 && (
            <TableRow>
              <TableCell colSpan={BASE_COLUMN_COUNT + (showBand ? 1 : 0)} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
          {!loading && gigs.map((gig) => (
            <DesktopRow key={String(gig.id)} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick?.(gig)} showBand={showBand} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
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
  showBand = false,
}: Readonly<GigsTableProps>) {
  const { t } = useTranslation('gigs')
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(ALL_STATUSES))
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

  const filtered = filterGigs(gigs, selectedStatuses, selectedTags)

  const emptyMessage = isSearching
    ? t($ => $.table.emptySearch)
    : t(activeTab === 'upcoming' ? ($ => $.table.emptyUpcoming) : ($ => $.table.emptyPast))

  const searchField = <GigsSearchField search={search} onSearchChange={onSearchChange} isCompact={isCompact} />
  const typeFilter = <StatusFilterMenu selectedStatuses={selectedStatuses} setSelectedStatuses={setSelectedStatuses} />
  const tagFilter = <TagFilterMenu availableTags={availableTags} selectedTags={selectedTags} setSelectedTags={setSelectedTags} />

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

  const list = isCompact
    ? <CompactGigList loading={loading} gigs={filtered} emptyMessage={emptyMessage} selectedId={selectedId} onRowClick={onRowClick} showBand={showBand} />
    : <DesktopGigTable loading={loading} gigs={filtered} emptyMessage={emptyMessage} selectedId={selectedId} onRowClick={onRowClick} showBand={showBand} />

  return (
    <Stack spacing={isCompact ? 1.5 : 2}>
      {!isSearching && tabs}
      {controls}
      {list}
      {!isSearching && loadMoreFooter}
    </Stack>
  )
}
