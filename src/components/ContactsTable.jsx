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
import { useCompactLayout } from '../hooks/useCompactLayout.js'

const PAGE_SIZE = 50
const COLUMN_COUNT = 5

const COLUMNS = [
  { id: 'category', label: 'Category' },
  { id: 'name',     label: 'Name' },
  { id: 'email',    label: 'Email' },
  { id: 'phone',    label: 'Phone' },
]

const CATEGORY_LABELS = {
  'press':      'Press',
  'radio & tv': 'Radio & TV',
  'booker':     'Booker',
  'promotion':  'Promotion',
  'network':    'Network',
}

const CATEGORY_COLORS = {
  'press':      'default',
  'radio & tv': 'primary',
  'booker':     'secondary',
  'promotion':  'warning',
  'network':    'success',
}

const ALL_CATEGORIES = ['press', 'radio & tv', 'booker', 'promotion', 'network']

function CategoryChip({ category }) {
  return (
    <Chip
      label={CATEGORY_LABELS[category] ?? category}
      size="small"
      color={CATEGORY_COLORS[category] ?? 'default'}
    />
  )
}

function sortValue(contact, col) {
  switch (col) {
    case 'category': return contact.category || ''
    case 'name':     return contact.name || ''
    case 'email':    return contact.email || ''
    case 'phone':    return contact.phone || ''
    default:         return ''
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
  return list.filter((c) =>
    [c.name, c.email, c.phone, c.category]
      .some((f) => f && String(f).toLowerCase().includes(lower))
  )
}

function ContactCard({ contact, selected, active, onToggle, onClick }) {
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
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
          <Typography variant="body2" fontWeight={600}>
            {contact.name}
          </Typography>
          <CategoryChip category={contact.category} />
        </Box>
        {(contact.email || contact.phone) && (
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {contact.email && (
              <Typography variant="caption" color="text.secondary">
                {contact.email}
              </Typography>
            )}
            {contact.phone && (
              <Typography variant="caption" color="text.secondary">
                {contact.phone}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default function ContactsTable({ contacts, onRowClick, selectedId = null }) {
  const [selectedCategories, setSelectedCategories] = useState(new Set(ALL_CATEGORIES))
  const [filterAnchor, setFilterAnchor] = useState(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('category')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState(new Set())
  const isCompact = useCompactLayout()

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

  function toggleCategory(cat) {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
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
      .filter((c) => selected.has(c.id) && c.email)
      .map((c) => c.email)
    navigator.clipboard.writeText(emails.join(';'))
  }

  const filtered = applySearch(
    selectedCategories.size === ALL_CATEGORIES.length
      ? contacts
      : contacts.filter((c) => selectedCategories.has(c.category)),
    search
  )
  const sorted = applySort(filtered, sortBy, sortDir)
  const paged = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const isEmpty = contacts.length === 0

  const allFilteredIds = sorted.map((c) => c.id)
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
        {selectedCount} contact{selectedCount !== 1 ? 's' : ''} selected
      </Typography>
      <Tooltip title="Copy email addresses (semicolon-separated)">
        <IconButton size="small" color="primary" onClick={copyEmails}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )

  const allCatsSelected = selectedCategories.size === ALL_CATEGORIES.length
  const someCatsSelected = selectedCategories.size > 0 && !allCatsSelected

  const controls = (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small"
        placeholder="Search contacts…"
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
        variant={someCatsSelected ? 'contained' : 'outlined'}
        startIcon={<FilterListIcon />}
        onClick={(e) => setFilterAnchor(e.currentTarget)}
      >
        {someCatsSelected ? `Filter (${selectedCategories.size})` : 'Filter'}
      </Button>
      <Menu
        anchorEl={filterAnchor}
        open={Boolean(filterAnchor)}
        onClose={() => setFilterAnchor(null)}
      >
        <MenuItem dense onClick={toggleAllCategories}>
          <Checkbox
            size="small"
            checked={allCatsSelected}
            indeterminate={someCatsSelected}
          />
          <ListItemText primary="All categories" />
        </MenuItem>
        <Divider />
        {ALL_CATEGORIES.map((cat) => (
          <MenuItem key={cat} dense onClick={() => toggleCategory(cat)}>
            <Checkbox size="small" checked={selectedCategories.has(cat)} />
            <ListItemText primary={CATEGORY_LABELS[cat]} />
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
              No contacts yet — add one or import from CSV.
            </Box>
          ) : sorted.length === 0 ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No results.
            </Box>
          ) : (
            sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((c) => (
              <ContactCard
                key={c.id}
                contact={c}
                selected={selected.has(c.id)}
                active={c.id === selectedId}
                onToggle={() => toggleRow(c.id)}
                onClick={() => onRowClick(c)}
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
                    No contacts yet — add one or import from CSV.
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
              {paged.map((c) => (
                <TableRow
                  key={c.id}
                  hover
                  selected={selected.has(c.id)}
                  onClick={() => onRowClick(c)}
                  sx={{
                    cursor: 'pointer',
                    boxShadow: c.id === selectedId ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
                  }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected.has(c.id)}
                      onChange={() => toggleRow(c.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell><CategoryChip category={c.category} /></TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.email || '—'}</TableCell>
                  <TableCell>{c.phone || '—'}</TableCell>
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
