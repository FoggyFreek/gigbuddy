import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import ListPagination from './shared/ListPagination.tsx'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import FilterListIcon from '@mui/icons-material/FilterList'
import SearchIcon from '@mui/icons-material/Search'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { CONTACT_CATEGORIES, contactCategoryColor, useContactCategoryLabel } from '../utils/contactCategories.ts'
import type { Contact, Id } from '../types/entities.ts'

const PAGE_SIZE = 25
const COLUMN_COUNT = 5

const COLUMN_IDS = ['category', 'name', 'email', 'phone'] as const
type ColumnId = typeof COLUMN_IDS[number]

interface CategoryChipProps {
  category?: string
}

function CategoryChip({ category }: CategoryChipProps) {
  const categoryLabel = useContactCategoryLabel()
  return (
    <Chip
      label={categoryLabel(category)}
      size="small"
      color={contactCategoryColor(category)}
    />
  )
}

interface ContactCardProps {
  contact: Contact
  selected: boolean
  active: boolean
  onToggle: () => void
  onClick: () => void
}

function sortValue(contact: Contact, col: string): string {
  switch (col) {
    case 'category': return contact.category || ''
    case 'name':     return contact.name || ''
    case 'email':    return contact.email || ''
    case 'phone':    return contact.phone || ''
    default:         return ''
  }
}

function applySort(list: Contact[], sortBy: string, sortDir: 'asc' | 'desc'): Contact[] {
  return [...list].sort((a, b) => {
    const cmp = sortValue(a, sortBy).localeCompare(sortValue(b, sortBy), undefined, { sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })
}

function applySearch(list: Contact[], q: string): Contact[] {
  if (!q) return list
  const lower = q.toLowerCase()
  return list.filter((c) =>
    [c.name, c.email, c.phone, c.category]
      .some((f) => f && String(f).toLowerCase().includes(lower))
  )
}

function ContactCard({ contact, selected, active, onToggle, onClick }: ContactCardProps) {
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
          <Typography variant="body2">
            {contact.name}
          </Typography>
          <CategoryChip category={contact.category} />
        </Box>
      </Box>
    </Box>
  )
}

interface ContactsTableProps {
  contacts: Contact[]
  onRowClick: (contact: Contact) => void
  selectedId?: number
  categories?: string[]
  emptyMessage?: string
}

export default function ContactsTable({
  contacts,
  onRowClick,
  selectedId = undefined,
  categories = CONTACT_CATEGORIES,
  emptyMessage,
}: ContactsTableProps) {
  const { t } = useTranslation('contacts')
  const categoryLabel = useContactCategoryLabel()
  const resolvedEmptyMessage = emptyMessage ?? t($ => $.empty)
  const categoryKey = categories.join('|')
  const selectableCategories = useMemo(() => categoryKey.split('|').filter(Boolean), [categoryKey])
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set(selectableCategories))
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<Set<Id>>(new Set())
  const isCompact = useCompactLayout()

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

  function toggleCategory(cat: string) {
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
      selectedCategories.size === selectableCategories.length ? new Set() : new Set(selectableCategories)
    )
    setPage(0)
    setSelected(new Set())
  }

  function toggleRow(id: Id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function copyEmails() {
    const emails = sorted
      .filter((c) => c.id != null && selected.has(c.id) && c.email)
      .map((c) => c.email)
    navigator.clipboard.writeText(emails.join(';'))
  }

  const filtered = applySearch(
    selectedCategories.size === selectableCategories.length
      ? contacts
      : contacts.filter((c) => selectedCategories.has(c.category ?? '')),
    search
  )
  const sorted = applySort(filtered, sortBy, sortDir)
  const paged = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const isEmpty = contacts.length === 0

  const allFilteredIds = sorted.map((c) => c.id).filter((id): id is Id => id != null)
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
      <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
        {t($ => $.table.selected, { count: selectedCount })}
      </Typography>
      <Tooltip title={t($ => $.table.copyEmails)}>
        <IconButton size="small" color="primary" onClick={copyEmails}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )

  const showCategoryFilter = selectableCategories.length > 1
  const allCatsSelected = selectedCategories.size === selectableCategories.length
  const someCatsSelected = selectedCategories.size > 0 && !allCatsSelected

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
      {showCategoryFilter && (
        <>
          <Button
            size="small"
            variant={someCatsSelected ? 'contained' : 'outlined'}
            startIcon={<FilterListIcon />}
            onClick={(e) => setFilterAnchor(e.currentTarget)}
          >
            {someCatsSelected ? t($ => $.table.filterCount, { count: selectedCategories.size }) : t($ => $.table.filter)}
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
              <ListItemText primary={t($ => $.table.allCategories)} />
            </MenuItem>
            <Divider />
            {selectableCategories.map((cat) => (
              <MenuItem key={cat} dense onClick={() => toggleCategory(cat)}>
                <Checkbox size="small" checked={selectedCategories.has(cat)} />
                <ListItemText primary={categoryLabel(cat)} />
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Box>
  )

  if (isCompact) {
    let compactContent: ReactNode
    if (isEmpty) {
      compactContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {resolvedEmptyMessage}
        </Box>
      )
    } else if (sorted.length === 0) {
      compactContent = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {t($ => $.table.noResults)}
        </Box>
      )
    } else {
      compactContent = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((c) => (
        <ContactCard
          key={String(c.id)}
          contact={c}
          selected={c.id != null && selected.has(c.id)}
          active={c.id === selectedId}
          onToggle={() => c.id != null && toggleRow(c.id)}
          onClick={() => onRowClick(c)}
        />
      ))
    }

    return (
      <Stack spacing={1.5}>
        {controls}
        {selectionBar}
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
                {COLUMN_IDS.map((col) => (
                  <TableCell key={col}>
                    <TableSortLabel
                      active={sortBy === col}
                      direction={sortBy === col ? sortDir : 'asc'}
                      onClick={() => handleSort(col)}
                    >
                      {t($ => $.fields[col])}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isEmpty && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    {resolvedEmptyMessage}
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
              {paged.map((c) => (
                <TableRow
                  key={String(c.id)}
                  hover
                  selected={c.id != null && selected.has(c.id)}
                  onClick={() => onRowClick(c)}
                  sx={{
                    cursor: 'pointer',
                    boxShadow: c.id === selectedId ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
                  }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={c.id != null && selected.has(c.id)}
                      onChange={() => c.id != null && toggleRow(c.id)}
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
