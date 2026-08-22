import type { Venue, VenueGroup, Id } from '../../../types/entities.ts'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import ListPagination from '../../../components/shared/ListPagination.tsx'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import FilterListIcon from '@mui/icons-material/FilterList'
import SearchIcon from '@mui/icons-material/Search'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'
import { usePermissions } from '../../../hooks/usePermissions.ts'
import { useDialog } from '../../../contexts/dialogContext.ts'
import { useToast } from '../../../contexts/toastContext.ts'
import AddToVenueGroupDialogContent from './AddToVenueGroupDialogContent.tsx'
import VenueGroupNameDialogContent from './VenueGroupNameDialogContent.tsx'
import {
  deleteVenueGroup,
  listVenueGroups,
  removeVenueGroupMembers,
  renameVenueGroup,
} from '../venueGroups.ts'

const PAGE_SIZE = 25
const COLUMN_COUNT = 6

const ALL_CATEGORIES = ['venue', 'festival'] as const

const COLUMNS = [
  { id: 'name',     labelKey: 'name' as const },
  { id: 'city',     labelKey: 'cityCountry' as const },
  { id: 'contact',  labelKey: 'contact' as const },
  { id: 'category', labelKey: 'category' as const },
  { id: 'years',    labelKey: 'performed' as const, sortable: false },
]

interface VenueRow extends Venue {
  phone?: string | null
}

function contactName(venue: VenueRow): string {
  return venue.primary_contact_name || ''
}

function displayName(venue: VenueRow): string {
  return venue.name || ''
}

interface CategoryChipProps { category?: string }
function CategoryChip({ category }: Readonly<CategoryChipProps>) {
  const { t } = useTranslation('venues')
  return (
    <Chip
      label={category === 'festival' ? t($ => $.category.festival) : t($ => $.category.venue)}
      size="small"
      color={category === 'festival' ? 'primary' : 'default'}
      variant={category === 'festival' ? 'filled' : 'outlined'}
    />
  )
}

function cityCountry(venue: VenueRow): string {
  return [venue.city, venue.country].filter(Boolean).join(', ') || '—'
}

function sortValue(venue: VenueRow, col: string): string {
  switch (col) {
    case 'category': return venue.category || ''
    case 'name':     return displayName(venue)
    case 'city':     return venue.city || ''
    case 'contact':  return venue.primary_contact_name || ''
    default:         return ''
  }
}

function applySort(list: VenueRow[], sortBy: string, sortDir: 'asc' | 'desc'): VenueRow[] {
  return [...list].sort((a, b) => {
    const cmp = sortValue(a, sortBy).localeCompare(sortValue(b, sortBy), undefined, { sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })
}

function applySearch(list: VenueRow[], q: string): VenueRow[] {
  if (!q) return list
  const lower = q.toLowerCase()
  return list.filter((v) =>
    [
      v.name, v.category, v.city, v.country, v.region,
      (v as Record<string, unknown>).street_and_number,
      (v as Record<string, unknown>).street_additional,
      v.postal_code,
      (v as Record<string, unknown>).website,
      v.primary_contact_name, v.phone, v.email,
    ].some((f) => f && String(f).toLowerCase().includes(lower))
  )
}

interface VenueCardProps {
  venue: VenueRow
  selected: boolean
  active: boolean
  onToggle: () => void
  onClick: () => void
}

function VenueCard({ venue, selected, active, onToggle, onClick }: Readonly<VenueCardProps>) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        borderBottom: '1px solid',
        borderColor: 'divider',
        boxShadow: active ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Checkbox
        size="small"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        sx={{ mt: 0.5, ml: 0.5 }}
      />
      <Box
        onClick={onClick}
        sx={{
          flex: 1,
          p: 1.25,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
          <Box>
            <Typography variant="body2">
              {displayName(venue)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {cityCountry(venue)}
            </Typography>
          </Box>
          <CategoryChip category={venue.category} />
        </Box>
        {((venue.years ?? []).length > 0) && (
          <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-end' }}>
              {(venue.years ?? []).map((yr) => (
                <Chip key={yr} label={yr} size="small" sx={{ bgcolor: 'secondary.main', color: 'secondary.contrastText' }} />
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}

interface VenuesTableProps {
  venues: VenueRow[]
  onRowClick: (venue: VenueRow) => void
  selectedId?: Id | null
  onEmailSelected?: (venues: VenueRow[]) => void
  onMembershipsChanged?: (groupId: Id, venueIds: Id[] | null, action: 'add' | 'remove' | 'delete') => void
}

export default function VenuesTable({
  venues,
  onRowClick,
  selectedId = null,
  onEmailSelected,
  onMembershipsChanged,
}: Readonly<VenuesTableProps>) {
  const { t } = useTranslation('venues')
  const { canWritePlanning } = usePermissions()
  const { closeDialog, confirm, confirmDelete, showDialog } = useDialog()
  const showToast = useToast()
  const categoryLabel = (category: string) =>
    category === 'festival' ? t($ => $.category.festivalPlural) : t($ => $.category.venuePlural)
  const [selectedCategories, setSelectedCategories] = useState(new Set<string>(ALL_CATEGORIES))
  const [filterMode, setFilterMode] = useState<'categories' | 'groups'>('categories')
  const [groupQuery, setGroupQuery] = useState('')
  const [groups, setGroups] = useState<VenueGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupsReload, setGroupsReload] = useState(0)
  const [activeGroup, setActiveGroup] = useState<VenueGroup | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState(new Set<Id>())
  const isCompact = useCompactLayout()

  useEffect(() => {
    if (!filterAnchor || filterMode !== 'groups') return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setGroupsLoading(true)
      listVenueGroups(groupQuery, 10, { signal: controller.signal })
        .then((result) => {
          setGroups(result.items)
          setGroupsLoading(false)
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return
          showToast?.(reason instanceof Error ? reason.message : String(reason))
          setGroupsLoading(false)
        })
    }, groupQuery ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [filterAnchor, filterMode, groupQuery, groupsReload, showToast])

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(0)
  }

  function handleSearch(val: string) {
    setSearch(val)
    setPage(0)
    setSelected(new Set())
  }

  function toggleCategory(category: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
    setPage(0)
    setSelected(new Set())
  }

  function toggleAllCategories() {
    setSelectedCategories(
      selectedCategories.size === ALL_CATEGORIES.length ? new Set() : new Set<string>(ALL_CATEGORIES)
    )
    setPage(0)
    setSelected(new Set())
  }

  function switchFilterMode(mode: 'categories' | 'groups') {
    if (mode === filterMode) return
    setFilterMode(mode)
    setSelected(new Set())
    setPage(0)
    if (mode === 'categories') {
      setActiveGroup(null)
      setGroupQuery('')
    } else {
      setSelectedCategories(new Set<string>(ALL_CATEGORIES))
    }
  }

  function selectGroup(group: VenueGroup) {
    setActiveGroup(group)
    setSelected(new Set())
    setPage(0)
  }

  function toggleRow(id: Id | undefined) {
    if (id === undefined) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function copyEmails() {
    const emails = sorted
      .filter((v) => v.id !== undefined && selected.has(v.id) && v.email)
      .map((v) => v.email as string)
    navigator.clipboard.writeText(emails.join(';'))
  }

  const groupFilterActive = filterMode === 'groups' && activeGroup !== null
  let structurallyFiltered = venues
  if (groupFilterActive) {
    structurallyFiltered = venues.filter((venue) =>
      (venue.group_ids ?? []).some((groupId) => String(groupId) === String(activeGroup.id)))
  } else if (filterMode === 'categories' && selectedCategories.size !== ALL_CATEGORIES.length) {
    structurallyFiltered = venues.filter((venue) =>
      venue.category && selectedCategories.has(venue.category))
  }
  const filtered = applySearch(structurallyFiltered, search)
  const sorted = applySort(filtered, sortBy, sortDir)
  const paged = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const isEmpty = venues.length === 0

  const allFilteredIds = sorted.map((v) => v.id).filter((id): id is Id => id !== undefined)
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id))
  const someSelected = !allSelected && allFilteredIds.some((id) => selected.has(id))
  const selectedVenues = sorted.filter((venue) => venue.id !== undefined && selected.has(venue.id))

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allFilteredIds))
    }
  }

  function refreshGroups() {
    setGroupsReload((value) => value + 1)
  }

  function openAddToGroup() {
    const venueIds = selectedVenues.flatMap((venue) => venue.id === undefined ? [] : [venue.id])
    void showDialog({
      id: 'venue-add-to-group',
      title: t($ => $.groups.addDialogTitle),
      body: (
        <AddToVenueGroupDialogContent
          venueIds={venueIds}
          onCancel={closeDialog}
          onComplete={(result) => {
            closeDialog()
            setSelected(new Set())
            onMembershipsChanged?.(result.group.id, venueIds, 'add')
            refreshGroups()
            const message = result.addedCount > 0
              ? t($ => $.groups.added, { count: result.addedCount, name: result.group.name })
              : t($ => $.groups.alreadyPresent, { name: result.group.name })
            showToast?.(message, 'success')
          }}
        />
      ),
      actions: [],
      maxWidth: 'sm',
    })
  }

  async function removeFromActiveGroup() {
    if (!activeGroup) return
    const approved = await confirm({
      title: t($ => $.groups.removeTitle),
      body: t($ => $.groups.removeBody, { count: selectedVenues.length, name: activeGroup.name }),
      confirmLabel: t($ => $.groups.removeSelected),
    })
    if (!approved) return
    try {
      const venueIds = selectedVenues.flatMap((venue) => venue.id === undefined ? [] : [venue.id])
      const result = await removeVenueGroupMembers(activeGroup.id, venueIds)
      setSelected(new Set())
      onMembershipsChanged?.(activeGroup.id, venueIds, 'remove')
      refreshGroups()
      showToast?.(t($ => $.groups.removed, { count: result.removed_count, name: activeGroup.name }), 'success')
    } catch (reason) {
      showToast?.(reason instanceof Error ? reason.message : String(reason))
    }
  }

  function openRenameGroup(group: VenueGroup) {
    setFilterAnchor(null)
    void showDialog({
      id: `venue-group-rename:${group.id}`,
      title: t($ => $.groups.renameTitle),
      body: (
        <VenueGroupNameDialogContent
          initialName={group.name}
          onCancel={closeDialog}
          onSave={async (name) => {
            const updated = await renameVenueGroup(group.id, name)
            setGroups((current) => current.map((item) =>
              String(item.id) === String(updated.id) ? updated : item))
            setActiveGroup((current) =>
              current && String(current.id) === String(updated.id) ? updated : current)
            closeDialog()
            showToast?.(t($ => $.groups.renamed), 'success')
          }}
        />
      ),
      actions: [],
      maxWidth: 'xs',
    })
  }

  async function removeGroup(group: VenueGroup) {
    setFilterAnchor(null)
    const approved = await confirmDelete({
      title: t($ => $.groups.deleteTitle, { name: group.name }),
      body: t($ => $.groups.deleteBody),
    })
    if (!approved) return
    try {
      await deleteVenueGroup(group.id)
      setGroups((current) => current.filter((item) => String(item.id) !== String(group.id)))
      if (activeGroup && String(activeGroup.id) === String(group.id)) {
        setActiveGroup(null)
        setSelected(new Set())
        setPage(0)
      }
      onMembershipsChanged?.(group.id, null, 'delete')
      refreshGroups()
      showToast?.(t($ => $.groups.deleted), 'success')
    } catch (reason) {
      showToast?.(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const selectedCount = selected.size

  const selectionBar = selectedCount > 0 && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
      <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 600 }}>
        {t($ => $.table.selected, { count: selectedCount })}
      </Typography>
      <Tooltip title={t($ => $.table.copyEmails)}>
        <IconButton size="small" color="primary" onClick={copyEmails}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {onEmailSelected && <Button size="small" variant="contained" onClick={() => onEmailSelected(selectedVenues)}>
        {t($ => $.table.emailSelected)}
      </Button>}
      {canWritePlanning && (
        <Button size="small" variant="outlined" onClick={openAddToGroup}>
          {t($ => $.groups.addSelected)}
        </Button>
      )}
      {canWritePlanning && groupFilterActive && (
        <Button size="small" variant="outlined" onClick={() => { void removeFromActiveGroup() }}>
          {t($ => $.groups.removeSelected)}
        </Button>
      )}
    </Box>
  )

  const allCategoriesSelected = selectedCategories.size === ALL_CATEGORIES.length
  const someCategoriesSelected = selectedCategories.size > 0 && !allCategoriesSelected
  const activeFilterCount = groupFilterActive ? 1 : (someCategoriesSelected ? selectedCategories.size : 0)

  const groupSelectionRow = groupFilterActive && activeGroup && (
    <Paper variant="outlined">
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5 }}>
        <Checkbox
          size="small"
          checked={allSelected}
          indeterminate={someSelected}
          onChange={toggleAll}
          slotProps={{ input: { 'aria-label': t($ => $.groups.selectVisible, { name: activeGroup.name }) } }}
        />
        <Typography variant="body2">
          {t($ => $.groups.selectVisible, { name: activeGroup.name })}
        </Typography>
      </Box>
    </Paper>
  )

  const controls = (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small"
        placeholder={t($ => $.table.searchPlaceholder)}
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        sx={{ flex: '1 1 200px', minWidth: 160 }}
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
      <Button
        size="small"
        variant={activeFilterCount > 0 ? 'contained' : 'outlined'}
        startIcon={<FilterListIcon />}
        onClick={(e) => setFilterAnchor(e.currentTarget)}
      >
        {activeFilterCount > 0
          ? t($ => $.table.filterCount, { count: activeFilterCount })
          : t($ => $.table.filter)}
      </Button>
      <Menu
        anchorEl={filterAnchor}
        open={Boolean(filterAnchor)}
        onClose={() => setFilterAnchor(null)}
        slotProps={{ paper: { sx: { width: 320, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Box sx={{ px: 1.5, py: 1 }}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={filterMode}
            onChange={(_, value: 'categories' | 'groups' | null) => {
              if (value) switchFilterMode(value)
            }}
          >
            <ToggleButton value="categories">{t($ => $.groups.categoriesToggle)}</ToggleButton>
            <ToggleButton value="groups">{t($ => $.groups.groupsToggle)}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Divider />
        {filterMode === 'categories' ? (
          <>
            <MenuItem dense onClick={toggleAllCategories}>
              <Checkbox
                size="small"
                checked={allCategoriesSelected}
                indeterminate={someCategoriesSelected}
              />
              <ListItemText primary={t($ => $.table.allCategories)} />
            </MenuItem>
            <Divider />
            {ALL_CATEGORIES.map((category) => (
              <MenuItem key={category} dense onClick={() => toggleCategory(category)}>
                <Checkbox size="small" checked={selectedCategories.has(category)} />
                <ListItemText primary={categoryLabel(category)} />
              </MenuItem>
            ))}
          </>
        ) : (
          <>
            <Box sx={{ p: 1.5 }}>
              <TextField
                fullWidth
                size="small"
                value={groupQuery}
                onChange={(event) => setGroupQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder={t($ => $.groups.searchPlaceholder)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                    ),
                  },
                }}
              />
            </Box>
            {groupsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={22} />
              </Box>
            ) : groups.length ? groups.map((group) => (
              <MenuItem key={String(group.id)} dense onClick={() => selectGroup(group)}>
                <Checkbox
                  size="small"
                  checked={activeGroup !== null && String(activeGroup.id) === String(group.id)}
                />
                <ListItemText primary={group.name} />
                {canWritePlanning && (
                  <Box sx={{ display: 'flex' }}>
                    <Tooltip title={t($ => $.groups.rename)}>
                      <IconButton
                        size="small"
                        aria-label={t($ => $.groups.rename)}
                        onClick={(event) => {
                          event.stopPropagation()
                          openRenameGroup(group)
                        }}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t($ => $.groups.delete)}>
                      <IconButton
                        size="small"
                        aria-label={t($ => $.groups.delete)}
                        onClick={(event) => {
                          event.stopPropagation()
                          void removeGroup(group)
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
              </MenuItem>
            )) : (
              <Typography variant="body2" sx={{ color: 'text.secondary', px: 2, py: 1.5 }}>
                {t($ => $.groups.noGroups)}
              </Typography>
            )}
          </>
        )}
      </Menu>
    </Box>
  )

  if (isCompact) {
    let compactContent: ReactNode
    if (isEmpty) {
      compactContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {t($ => $.empty)}
        </Box>
      )
    } else if (sorted.length === 0) {
      compactContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {t($ => $.table.noResults)}
        </Box>
      )
    } else {
      compactContent = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((v) => (
        <VenueCard
          key={String(v.id)}
          venue={v}
          selected={v.id !== undefined && selected.has(v.id)}
          active={v.id === selectedId}
          onToggle={() => toggleRow(v.id)}
          onClick={() => onRowClick(v)}
        />
      ))
    }

    return (
      <Stack spacing={1.5}>
        {controls}
        {selectionBar}
        {groupSelectionRow}
        <Paper variant="outlined">
          {compactContent}
        </Paper>
        {sorted.length > rowsPerPage && (
          <ListPagination
            count={sorted.length}
            page={page}
            rowsPerPage={rowsPerPage}
            rowsPerPageOptions={[25, 50, 100]}
            onPageChange={(_, p) => setPage(p)}
            onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
          />
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={1.5}>
      {controls}
      {selectionBar}
      {groupSelectionRow}
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                <TableCell padding="checkbox">
                  {!groupFilterActive && (
                    <Checkbox
                      size="small"
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={toggleAll}
                    />
                  )}
                </TableCell>
                {COLUMNS.map((col) =>
                  col.sortable === false ? (
                    <TableCell key={col.id}>{t($ => $.table.columns[col.labelKey])}</TableCell>
                  ) : (
                    <TableCell key={col.id}>
                      <TableSortLabel
                        active={sortBy === col.id}
                        direction={sortBy === col.id ? sortDir : 'asc'}
                        onClick={() => handleSort(col.id)}
                      >
                        {t($ => $.table.columns[col.labelKey])}
                      </TableSortLabel>
                    </TableCell>
                  )
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {isEmpty && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    {t($ => $.empty)}
                  </TableCell>
                </TableRow>
              )}
              {!isEmpty && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    {t($ => $.table.noResults)}
                  </TableCell>
                </TableRow>
              )}
              {paged.map((v) => (
                <TableRow
                  key={String(v.id)}
                  hover
                  selected={v.id !== undefined && selected.has(v.id)}
                  onClick={() => onRowClick(v)}
                  sx={{
                    cursor: 'pointer',
                    boxShadow: v.id === selectedId ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
                  }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={v.id !== undefined && selected.has(v.id)}
                      onChange={() => toggleRow(v.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell>{displayName(v)}</TableCell>
                  <TableCell>{cityCountry(v)}</TableCell>
                  <TableCell>{contactName(v)}</TableCell>
                  <TableCell><CategoryChip category={v.category} /></TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {(v.years ?? []).map((yr) => (
                        <Chip key={yr} label={yr} size="small" variant="outlined" />
                      ))}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <ListPagination
          count={sorted.length}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
        />
      </Paper>
    </Stack>
  )
}
