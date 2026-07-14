import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import ListPagination from '../components/shared/ListPagination.tsx'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import SearchIcon from '@mui/icons-material/Search'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import LedgerTypeFilter from '../components/ledger/LedgerTypeFilter.tsx'
import BankStatementImportDialog from '../components/ledger/BankStatementImportDialog.tsx'
import { usePermissions } from '../hooks/usePermissions.ts'
import { PERMISSIONS } from '../auth/permissions.ts'
import PeriodPicker from '../components/shared/periodPicker.tsx'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { listLedger, listLedgerPeriods } from '../api/ledger.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import { defaultPeriodForDates } from '../utils/invoicePeriod.ts'
import { ALL_LEDGER_GROUPS } from '../utils/ledgerEntryType.ts'
import { loadLedgerFilters, saveLedgerFilters } from '../utils/ledgerFilterStorage.ts'
import MoneyCells, { MoneyHeaderCells } from '../components/shared/MoneyCells.tsx'
import type { LedgerEntryRow, Period } from '../types/entities.ts'

type SortField = 'id' | 'entry_date'

export default function LedgerEntriesPage() {
  const { t } = useTranslation('ledger')
  const navigate = useNavigate()
  const { can } = usePermissions()
  const canManageFinance = can(PERMISSIONS.FINANCE_MANAGE)
  const [importOpen, setImportOpen] = useState(false)
  // Restore the previous session's filters so navigating into an entry detail
  // and back keeps the user's view.
  const saved = loadLedgerFilters()
  const [entries, setEntries] = useState<LedgerEntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>(typeof saved?.searchQuery === 'string' ? saved.searchQuery : '')
  const [showVoided, setShowVoided] = useState<boolean>(typeof saved?.showVoided === 'boolean' ? saved.showVoided : false)
  const [activeGroups, setActiveGroups] = useState<Set<string>>(() => new Set(saved?.activeGroups ?? ALL_LEDGER_GROUPS))
  const [sortBy, setSortBy] = useState<SortField>(typeof saved?.sortBy === 'string' && (saved.sortBy === 'id' || saved.sortBy === 'entry_date') ? saved.sortBy : 'id')
  const [sortDesc, setSortDesc] = useState<boolean>(typeof saved?.sortDesc === 'boolean' ? saved.sortDesc : true)
  const [page, setPage] = useState<number>(typeof saved?.page === 'number' ? saved.page : 0)
  const [rowsPerPage, setRowsPerPage] = useState<number>(typeof saved?.rowsPerPage === 'number' ? saved.rowsPerPage : 50)
  const [period, setPeriod] = useState<Period>(() => (saved?.period && typeof saved.period === 'object' ? saved.period as Period : { mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)

  // Persist filters whenever they change (best-effort, session-scoped).
  useEffect(() => {
    saveLedgerFilters({ searchQuery, showVoided, activeGroups: [...activeGroups], sortBy, sortDesc, page, rowsPerPage, period })
  }, [searchQuery, showVoided, activeGroups, sortBy, sortDesc, page, rowsPerPage, period])

  useEffect(() => {
    let cancelled = false
    listLedgerPeriods()
      .then((dates) => {
        if (cancelled) return
        const dateStrings = dates.filter(Boolean)
        setAvailableDates(dateStrings)
        setPeriod((prev) => {
          const currentYear = new Date().getFullYear()
          if (prev.mode !== 'fiscal_year' || prev.year !== currentYear) return prev
          return defaultPeriodForDates(dateStrings)
        })
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setPeriodsLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setEntries(await listLedger(period))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  const visibleEntries = useMemo(() => {
    let list = entries.filter((row) => activeGroups.has(row.group ?? ''))
    if (!showVoided) list = list.filter((row) => !row.voided)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (row) =>
          row.description?.toLowerCase().includes(q) ||
          row.note?.toLowerCase().includes(q) ||
          row.type?.toLowerCase().includes(q) ||
          (row.receipt != null && String(row.receipt).includes(q)) ||
          String(row.id).includes(q),
      )
    }
    return [...list].sort((a, b) => {
      // Date sort falls back to id for stable ordering within the same day.
      let cmp = 0
      if (sortBy === 'entry_date') {
        if ((a.entry_date ?? '') < (b.entry_date ?? '')) cmp = -1
        else if ((a.entry_date ?? '') > (b.entry_date ?? '')) cmp = 1
      }
      if (cmp === 0) cmp = (Number(a.id) || 0) - (Number(b.id) || 0)
      return sortDesc ? -cmp : cmp
    })
  }, [entries, activeGroups, showVoided, searchQuery, sortBy, sortDesc])

  // Clamp the page when filters shrink the list below the current page start.
  const pageCount = Math.max(0, Math.ceil(visibleEntries.length / rowsPerPage) - 1)
  const safePage = Math.min(page, pageCount)
  const pagedEntries = visibleEntries.slice(safePage * rowsPerPage, (safePage + 1) * rowsPerPage)

  function handleFilterChange<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(0)
    }
  }

  // Clicking the active column flips direction; a new column starts descending.
  function handleSort(field: SortField) {
    if (field === sortBy) {
      setSortDesc((d) => !d)
    } else {
      setSortBy(field)
      setSortDesc(true)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t($ => $.title)}
        </Typography>
        <Chip size="small" label={visibleEntries.length} />
        <TextField
          size="small"
          placeholder={t($ => $.searchPlaceholder)}
          value={searchQuery}
          onChange={(e) => handleFilterChange(setSearchQuery)(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flex: '1 1 200px', minWidth: 160 }}
        />
        <FormControlLabel
          control={(
            <Checkbox
              size="small"
              checked={showVoided}
              onChange={(e) => handleFilterChange(setShowVoided)(e.target.checked)}
            />
          )}
          label={t($ => $.showVoided)}
        />
        <LedgerTypeFilter value={activeGroups} onChange={handleFilterChange(setActiveGroups)} />
        <PeriodPicker
          availableDates={availableDates}
          value={period}
          onChange={handleFilterChange(setPeriod)}
        />
        {canManageFinance && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadFileIcon />}
            onClick={() => setImportOpen(true)}
          >
            {t($ => $.bankImport.button)}
          </Button>
        )}
      </Box>

      {importOpen && (
        <BankStatementImportDialog
          onClose={(imported) => {
            setImportOpen(false)
            if (imported) load()
          }}
        />
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>
      )}

      {!loading && (
        <>
          <LedgerEntriesList
            entries={pagedEntries}
            sortBy={sortBy}
            sortDesc={sortDesc}
            onSort={handleSort}
            onRowClick={(row) => navigate(`/ledger/${row.id}`)}
          />
          <ListPagination
            count={visibleEntries.length}
            page={safePage}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(Number(e.target.value))
              setPage(0)
            }}
            rowsPerPageOptions={[25, 50, 100]}
            labelRowsPerPage={t($ => $.perPage)}
          />
        </>
      )}
    </Box>
  )
}

interface LedgerEntriesListProps {
  entries: LedgerEntryRow[]
  sortBy: SortField
  sortDesc: boolean
  onSort: (field: SortField) => void
  onRowClick: (row: LedgerEntryRow) => void
}

function LedgerEntriesList({ entries, sortBy, sortDesc, onSort, onRowClick }: Readonly<LedgerEntriesListProps>) {
  const { t } = useTranslation('ledger')
  const isCompact = useCompactLayout()

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {!entries.length && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            {t($ => $.emptyEntries)}
          </Typography>
        )}
        {entries.map((row) => (
          <Box
            key={String(row.id)}
            onClick={() => onRowClick(row)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1.5,
              cursor: 'pointer',
              borderBottom: '1px solid',
              borderColor: 'divider',
              '&:last-of-type': { borderBottom: 'none' },
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  #{row.id}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatShortDate(row.entry_date)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.type}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.description || '-'}
              </Typography>
            </Box>
            {row.amount_cents !== null && row.amount_cents !== undefined && (
              <Typography variant="body1" sx={{ fontWeight: 500, flexShrink: 0 }}>
                {formatEur(row.amount_cents)}
              </Typography>
            )}
          </Box>
        ))}
      </Paper>
    )
  }

  const sortDirectionFor = (col: SortField): 'asc' | 'desc' | undefined => {
    if (sortBy !== col) return undefined
    return sortDesc ? 'desc' : 'asc'
  }

  return (
    <Paper variant="outlined">
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sortDirection={sortDirectionFor('id')}>
                <TableSortLabel
                  active={sortBy === 'id'}
                  direction={sortBy === 'id' && sortDesc ? 'desc' : 'asc'}
                  onClick={() => onSort('id')}
                >
                  #
                </TableSortLabel>
              </TableCell>
              <TableCell>{t($ => $.columns.file)}</TableCell>
              <TableCell>{t($ => $.columns.receipt)}</TableCell>
              <TableCell sortDirection={sortDirectionFor('entry_date')}>
                <TableSortLabel
                  active={sortBy === 'entry_date'}
                  direction={sortBy === 'entry_date' && sortDesc ? 'desc' : 'asc'}
                  onClick={() => onSort('entry_date')}
                >
                  {t($ => $.columns.date)}
                </TableSortLabel>
              </TableCell>
              <TableCell>{t($ => $.columns.type)}</TableCell>
              <TableCell>{t($ => $.columns.description)}</TableCell>
              <MoneyHeaderCells label={t($ => $.columns.amount)} />
            </TableRow>
          </TableHead>
          <TableBody>
            {!entries.length && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    {t($ => $.emptyEntries)}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {entries.map((row) => (
              <TableRow
                key={String(row.id)}
                hover
                sx={{ cursor: 'pointer', opacity: row.voided ? 0.6 : 1 }}
                onClick={() => onRowClick(row)}
              >
                <TableCell>{row.id}</TableCell>
                <TableCell />
                <TableCell>{row.receipt ?? ''}</TableCell>
                <TableCell>{formatShortDate(row.entry_date)}</TableCell>
                <TableCell>{row.type}</TableCell>
                <TableCell>{row.description || '-'}</TableCell>
                {row.amount_cents == null
                  ? (
                    <>
                      <TableCell padding="none" />
                      <TableCell />
                    </>
                  )
                  : <MoneyCells cents={row.amount_cents} />}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}
