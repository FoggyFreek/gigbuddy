import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableFooter from '@mui/material/TableFooter'
import TableHead from '@mui/material/TableHead'
import ListPagination from '../components/shared/ListPagination.tsx'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import LinkIcon from '@mui/icons-material/Link'
import AccountMultiSelectFilter from '../components/ledger/AccountMultiSelectFilter.tsx'
import PeriodPicker from '../components/shared/periodPicker.tsx'
import MoneyCells, { MoneyHeaderCells } from '../components/shared/MoneyCells.tsx'
import { listLedgerEntries, listLedgerPeriods } from '../api/ledger.ts'
import { listAccounts } from '../api/accounts.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import { defaultPeriodForDates } from '../utils/invoicePeriod.ts'
import { loadLedgerEntrySearchFilters, saveLedgerEntrySearchFilters } from '../utils/ledgerEntrySearchFilterStorage.ts'
import type { Account, LedgerEntryLineRow, Period } from '../types/entities.ts'

type SortField = 'id' | 'entry_date' | 'amount'
const SORT_FIELDS: ReadonlySet<SortField> = new Set(['id', 'entry_date', 'amount'])

// The single non-zero side of an entry, signed (debit positive, credit
// negative) — the amount-sort key.
const signedAmount = (row: LedgerEntryLineRow) => (row.debit_cents ?? 0) - (row.credit_cents ?? 0)

export default function LedgerEntrySearchPage() {
  const { t } = useTranslation('ledger')
  // Restore the previous session's filters so navigating away and back keeps
  // the user's account selection, period, search, sort and pagination.
  const saved = loadLedgerEntrySearchFilters()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(() => new Set(saved?.selectedCodes ?? []))
  const [entries, setEntries] = useState<LedgerEntryLineRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>(typeof saved?.searchQuery === 'string' ? saved.searchQuery : '')
  const [showVoided, setShowVoided] = useState<boolean>(typeof saved?.showVoided === 'boolean' ? saved.showVoided : false)
  const [sortBy, setSortBy] = useState<SortField>(SORT_FIELDS.has(saved?.sortBy as SortField) ? saved!.sortBy as SortField : 'entry_date')
  const [sortDesc, setSortDesc] = useState<boolean>(typeof saved?.sortDesc === 'boolean' ? saved.sortDesc : true)
  const [page, setPage] = useState<number>(typeof saved?.page === 'number' ? saved.page : 0)
  const [rowsPerPage, setRowsPerPage] = useState<number>(typeof saved?.rowsPerPage === 'number' ? saved.rowsPerPage : 50)
  const [period, setPeriod] = useState<Period>(() => (saved?.period && typeof saved.period === 'object' ? saved.period as Period : { mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)

  // Persist filters whenever they change (best-effort, session-scoped).
  useEffect(() => {
    saveLedgerEntrySearchFilters({ selectedCodes: [...selectedCodes], searchQuery, showVoided, sortBy, sortDesc, page, rowsPerPage, period })
  }, [selectedCodes, searchQuery, showVoided, sortBy, sortDesc, page, rowsPerPage, period])

  useEffect(() => {
    let cancelled = false
    listAccounts()
      .then((rows) => { if (!cancelled) setAccounts(rows) })
      .catch(() => { /* the filter just stays empty */ })
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

  // A stable, order-independent key for the selected codes, so the fetch effect
  // re-runs on a real selection change (not on every Set identity change).
  const codesKey = [...selectedCodes].sort().join(',')

  const load = useCallback(async () => {
    const codes = codesKey ? codesKey.split(',') : []
    if (!codes.length) return // nothing selected — the prompt renders; stale rows stay hidden
    try {
      setLoading(true)
      setError(null)
      setEntries(await listLedgerEntries(period, codes))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [period, codesKey])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  const visibleEntries = useMemo(() => {
    let list = entries
    if (!showVoided) list = list.filter((row) => !row.voided)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (row) =>
          row.memo?.toLowerCase().includes(q) ||
          row.description?.toLowerCase().includes(q) ||
          row.account_name?.toLowerCase().includes(q) ||
          row.account_code?.includes(q) ||
          row.type?.toLowerCase().includes(q) ||
          String(row.id).includes(q),
      )
    }
    return [...list].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'entry_date') {
        if ((a.entry_date ?? '') < (b.entry_date ?? '')) cmp = -1
        else if ((a.entry_date ?? '') > (b.entry_date ?? '')) cmp = 1
      } else if (sortBy === 'amount') {
        cmp = signedAmount(a) - signedAmount(b)
      }
      // Fall back to id for a stable order within ties.
      if (cmp === 0) cmp = (Number(a.id) || 0) - (Number(b.id) || 0)
      return sortDesc ? -cmp : cmp
    })
  }, [entries, showVoided, searchQuery, sortBy, sortDesc])

  const totals = useMemo(
    () => visibleEntries.reduce(
      (acc, row) => {
        acc.debit += row.debit_cents ?? 0
        acc.credit += row.credit_cents ?? 0
        return acc
      },
      { debit: 0, credit: 0 },
    ),
    [visibleEntries],
  )

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

  // Clearing the selection won't trigger a fetch, so drop stale rows here (an
  // event handler) rather than synchronously inside the fetch effect.
  function handleAccountsChange(next: Set<string>) {
    setSelectedCodes(next)
    setPage(0)
    if (!next.size) setEntries([])
  }

  function handleSort(field: SortField) {
    if (field === sortBy) {
      setSortDesc((d) => !d)
    } else {
      setSortBy(field)
      setSortDesc(true)
    }
  }

  const sortLabel = (field: SortField, children: React.ReactNode) => (
    <TableSortLabel
      active={sortBy === field}
      direction={sortBy === field && sortDesc ? 'desc' : 'asc'}
      onClick={() => handleSort(field)}
    >
      {children}
    </TableSortLabel>
  )

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t($ => $.search.title)}
        </Typography>
        <Chip size="small" label={visibleEntries.length} />
        <TextField
          size="small"
          placeholder={t($ => $.search.searchPlaceholder)}
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
        <AccountMultiSelectFilter
          accounts={accounts}
          value={selectedCodes}
          onChange={handleAccountsChange}
        />
        <PeriodPicker
          availableDates={availableDates}
          value={period}
          onChange={handleFilterChange(setPeriod)}
        />
      </Box>

      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {(() => {
        if (!selectedCodes.size) {
          return (
            <Paper variant="outlined">
              <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                {t($ => $.search.selectAccountsPrompt)}
              </Typography>
            </Paper>
          )
        }
        if (loading) {
          return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          )
        }
        return (
          <>
            <Paper variant="outlined">
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{sortLabel('id', '#')}</TableCell>
                      <TableCell>{sortLabel('entry_date', t($ => $.columns.date))}</TableCell>
                      <TableCell>{t($ => $.columns.account)}</TableCell>
                      <TableCell>{t($ => $.columns.type)}</TableCell>
                      <TableCell>{t($ => $.columns.memo)}</TableCell>
                      <MoneyHeaderCells label={sortLabel('amount', t($ => $.columns.debit))} />
                      <MoneyHeaderCells label={t($ => $.columns.credit)} />
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {!pagedEntries.length && (
                      <TableRow>
                        <TableCell colSpan={10}>
                          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                            {t($ => $.emptyEntries)}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {pagedEntries.map((row) => (
                      <TableRow key={String(row.id)} hover sx={{ opacity: row.voided ? 0.6 : 1 }}>
                        <TableCell>{row.id}</TableCell>
                        <TableCell>{formatShortDate(row.entry_date)}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {row.account_code} — {row.account_name}
                        </TableCell>
                        <TableCell>{row.type}</TableCell>
                        <TableCell>{row.memo || row.description || '-'}</TableCell>
                        {row.debit_cents ? <MoneyCells cents={row.debit_cents} /> : (<><TableCell padding="none" /><TableCell /></>)}
                        {row.credit_cents ? <MoneyCells cents={row.credit_cents} /> : (<><TableCell padding="none" /><TableCell /></>)}
                        <TableCell padding="checkbox" align="center">
                          <Tooltip title={t($ => $.search.openTransaction)}>
                            <IconButton
                              size="small"
                              component={RouterLink}
                              to={`/ledger/${row.transaction_id}`}
                              aria-label={t($ => $.search.openTransactionAria)}
                            >
                              <LinkIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {!!visibleEntries.length && (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={5} sx={{ fontWeight: 700, color: 'text.primary' }}>
                          {t($ => $.search.totals, { count: visibleEntries.length })}
                        </TableCell>
                        <MoneyCells cents={totals.debit} bold />
                        <MoneyCells cents={totals.credit} bold />
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </TableContainer>
            </Paper>
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
        )
      })()}
    </Box>
  )
}
