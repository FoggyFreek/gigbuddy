import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
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
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import FilterListIcon from '@mui/icons-material/FilterList'
import SearchIcon from '@mui/icons-material/Search'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

const PAGE_SIZE = 50
const COLUMN_COUNT = 7

const ALL_CATEGORIES = ['venue', 'festival']
const CATEGORY_LABELS = { venue: 'Venues', festival: 'Festivals' }

const COLUMNS = [
  { id: 'category',       label: 'Category' },
  { id: 'name',           label: 'Name' },
  { id: 'city',           label: 'City / Country' },
  { id: 'contact_person', label: 'Contact Person' },
  { id: 'phone',          label: 'Phone' },
  { id: 'email',          label: 'Email' },
]

function CategoryChip({ category }) {
  return (
    <Chip
      label={category === 'festival' ? 'Festival' : 'Venue'}
      size="small"
      color={category === 'festival' ? 'primary' : 'default'}
      variant={category === 'festival' ? 'filled' : 'outlined'}
    />
  )
}

function cityCountry(venue) {
  return [venue.city, venue.country].filter(Boolean).join(', ') || '—'
}

function sortValue(venue, col) {
  switch (col) {
    case 'category':       return venue.category || ''
    case 'name':           return venue.name || ''
    case 'city':           return venue.city || ''
    case 'contact_person': return venue.contact_person || ''
    case 'phone':          return venue.phone || ''
    case 'email':          return venue.email || ''
    default:               return ''
  }
}

function applySort(list, sortBy, sortDir) {
  return [...list].sort((a, b) => {
    const cmp = sortValue(a, sortBy).localeCompare(sortValue(b, sortBy), undefined, { sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })
}

function applySearch(list, q) {
  if (!q) return list
  const lower = q.toLowerCase()
  return list.filter((v) =>
    [v.name, v.category, v.city, v.country, v.province, v.address, v.website, v.contact_person, v.phone, v.email]
      .some((f) => f && String(f).toLowerCase().includes(lower))
  )
}

function VenueCard({ venue, selected, onToggle, onClick }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        borderBottom: '1px solid',
        borderColor: 'divider',
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
            <Typography variant="body2" fontWeight={600}>
              {venue.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {cityCountry(venue)}
            </Typography>
          </Box>
          <CategoryChip category={venue.category} />
        </Box>
        {(venue.contact_person || venue.email) && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {[venue.contact_person, venue.email].filter(Boolean).join(' · ')}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

export default function VenuesTable({ venues, onRowClick }) {
  const [selectedCategories, setSelectedCategories] = useState(new Set(ALL_CATEGORIES))
  const [filterAnchor, setFilterAnchor] = useState(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState(new Set())
  const theme = useTheme()
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'))

  function handleSort(col) {
    if (sortBy === col) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(0)
  }

  function handleSearch(val) {
    setSearch(val)
    setPage(0)
    setSelected(new Set())
  }

  function toggleCategory(category) {
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
      selectedCategories.size === ALL_CATEGORIES.length ? new Set() : new Set(ALL_CATEGORIES)
    )
    setPage(0)
    setSelected(new Set())
  }

  function toggleRow(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function copyEmails() {
    const emails = sorted
      .filter((v) => selected.has(v.id) && v.email)
      .map((v) => v.email)
    navigator.clipboard.writeText(emails.join(';'))
  }

  const filtered = applySearch(
    selectedCategories.size === ALL_CATEGORIES.length
      ? venues
      : venues.filter((v) => selectedCategories.has(v.category)),
    search
  )
  const sorted = applySort(filtered, sortBy, sortDir)
  const paged = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const isEmpty = venues.length === 0

  const allFilteredIds = sorted.map((v) => v.id)
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id))
  const someSelected = !allSelected && allFilteredIds.some((id) => selected.has(id))

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allFilteredIds))
    }
  }

  const selectedCount = selected.size

  const selectionBar = selectedCount > 0 && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
      <Typography variant="body2" color="primary" fontWeight={600}>
        {selectedCount} venue{selectedCount !== 1 ? 's' : ''} selected
      </Typography>
      <Tooltip title="Copy email addresses (semicolon-separated)">
        <IconButton size="small" color="primary" onClick={copyEmails}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )

  const allCategoriesSelected = selectedCategories.size === ALL_CATEGORIES.length
  const someCategoriesSelected = selectedCategories.size > 0 && !allCategoriesSelected

  const controls = (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small"
        placeholder="Search venues…"
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
        variant={someCategoriesSelected ? 'contained' : 'outlined'}
        startIcon={<FilterListIcon />}
        onClick={(e) => setFilterAnchor(e.currentTarget)}
      >
        {someCategoriesSelected ? `Filter (${selectedCategories.size})` : 'Filter'}
      </Button>
      <Menu
        anchorEl={filterAnchor}
        open={Boolean(filterAnchor)}
        onClose={() => setFilterAnchor(null)}
      >
        <MenuItem dense onClick={toggleAllCategories}>
          <Checkbox
            size="small"
            checked={allCategoriesSelected}
            indeterminate={someCategoriesSelected}
          />
          <ListItemText primary="All categories" />
        </MenuItem>
        <Divider />
        {ALL_CATEGORIES.map((category) => (
          <MenuItem key={category} dense onClick={() => toggleCategory(category)}>
            <Checkbox size="small" checked={selectedCategories.has(category)} />
            <ListItemText primary={CATEGORY_LABELS[category]} />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )

  if (isCompact) {
    return (
      <Stack spacing={1.5}>
        {controls}
        {selectionBar}
        <Paper variant="outlined">
          {isEmpty ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No venues yet — add one or import from CSV.
            </Box>
          ) : sorted.length === 0 ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No results.
            </Box>
          ) : (
            sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((v) => (
              <VenueCard
                key={v.id}
                venue={v}
                selected={selected.has(v.id)}
                onToggle={() => toggleRow(v.id)}
                onClick={() => onRowClick(v)}
              />
            ))
          )}
        </Paper>
        {sorted.length > rowsPerPage && (
          <TablePagination
            component="div"
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
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                  />
                </TableCell>
                {COLUMNS.map((col) => (
                  <TableCell key={col.id}>
                    <TableSortLabel
                      active={sortBy === col.id}
                      direction={sortBy === col.id ? sortDir : 'asc'}
                      onClick={() => handleSort(col.id)}
                    >
                      {col.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isEmpty && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No venues yet — add one or import from CSV.
                  </TableCell>
                </TableRow>
              )}
              {!isEmpty && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No results.
                  </TableCell>
                </TableRow>
              )}
              {paged.map((v) => (
                <TableRow
                  key={v.id}
                  hover
                  selected={selected.has(v.id)}
                  onClick={() => onRowClick(v)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected.has(v.id)}
                      onChange={() => toggleRow(v.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell><CategoryChip category={v.category} /></TableCell>
                  <TableCell>{v.name}</TableCell>
                  <TableCell>{cityCountry(v)}</TableCell>
                  <TableCell>{v.contact_person || '—'}</TableCell>
                  <TableCell>{v.phone || '—'}</TableCell>
                  <TableCell>{v.email || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
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
