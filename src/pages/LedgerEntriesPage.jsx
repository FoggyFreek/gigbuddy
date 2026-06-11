import { useCallback, useEffect, useMemo, useState } from 'react'
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
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import PropTypes from 'prop-types'
import LedgerTypeFilter from '../components/ledger/LedgerTypeFilter.jsx'
import PeriodPicker from '../components/shared/periodPicker.jsx'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import { listLedger, listLedgerPeriods } from '../api/ledger.js'
import { formatEur } from '../utils/invoiceTotals.js'
import { formatShortDate } from '../utils/dateFormat.js'
import { defaultPeriodForDates } from '../utils/invoicePeriod.js'
import { ALL_LEDGER_GROUPS } from '../utils/ledgerEntryType.js'
import { ledgerEntryRowShape } from '../propTypes/shared.js'

export default function LedgerEntriesPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showVoided, setShowVoided] = useState(false)
  const [activeGroups, setActiveGroups] = useState(() => new Set(ALL_LEDGER_GROUPS))
  const [sortDesc, setSortDesc] = useState(true)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(50)
  const [period, setPeriod] = useState(() => ({ mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    listLedgerPeriods()
      .then((dates) => {
        if (cancelled) return
        setAvailableDates(dates)
        setPeriod((prev) => {
          const currentYear = new Date().getFullYear()
          if (prev.mode !== 'fiscal_year' || prev.year !== currentYear) return prev
          return defaultPeriodForDates(dates)
        })
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setPeriodsLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setEntries(await listLedger(period))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  const visibleEntries = useMemo(() => {
    let list = entries.filter((row) => activeGroups.has(row.group))
    if (!showVoided) list = list.filter((row) => !row.voided)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (row) =>
          (row.description && row.description.toLowerCase().includes(q)) ||
          (row.type && row.type.toLowerCase().includes(q)) ||
          (row.receipt != null && String(row.receipt).includes(q)) ||
          String(row.id).includes(q),
      )
    }
    return [...list].sort((a, b) => (sortDesc ? b.id - a.id : a.id - b.id))
  }, [entries, activeGroups, showVoided, searchQuery, sortDesc])

  // Clamp the page when filters shrink the list below the current page start.
  const pageCount = Math.max(0, Math.ceil(visibleEntries.length / rowsPerPage) - 1)
  const safePage = Math.min(page, pageCount)
  const pagedEntries = visibleEntries.slice(safePage * rowsPerPage, (safePage + 1) * rowsPerPage)

  function handleFilterChange(setter) {
    return (value) => {
      setter(value)
      setPage(0)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600}>
          Ledger entries
        </Typography>
        <Chip size="small" label={visibleEntries.length} />
        <TextField
          size="small"
          placeholder="Search..."
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
          label="Show voided"
        />
        <LedgerTypeFilter value={activeGroups} onChange={handleFilterChange(setActiveGroups)} />
        <PeriodPicker
          availableDates={availableDates}
          value={period}
          onChange={handleFilterChange(setPeriod)}
        />
      </Box>

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
            sortDesc={sortDesc}
            onToggleSort={() => setSortDesc((d) => !d)}
            onRowClick={(row) => navigate(`/ledger/${row.id}`)}
          />
          <TablePagination
            component="div"
            count={visibleEntries.length}
            page={safePage}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(Number(e.target.value))
              setPage(0)
            }}
            rowsPerPageOptions={[25, 50, 100]}
            labelRowsPerPage="per page"
          />
        </>
      )}
    </Box>
  )
}

function LedgerEntriesList({ entries, sortDesc, onToggleSort, onRowClick }) {
  const isCompact = useCompactLayout()

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {!entries.length && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No ledger entries found
          </Typography>
        )}
        {entries.map((row) => (
          <Box
            key={row.id}
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
                <Typography variant="body2" fontWeight={600}>
                  #{row.id}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatShortDate(row.entry_date)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.type}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.25 }}>
                {row.description || '-'}
              </Typography>
            </Box>
            {row.amount_cents !== null && (
              <Typography variant="body1" fontWeight={500} sx={{ flexShrink: 0 }}>
                {formatEur(row.amount_cents)}
              </Typography>
            )}
          </Box>
        ))}
      </Paper>
    )
  }

  return (
    <Paper variant="outlined">
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sortDirection={sortDesc ? 'desc' : 'asc'}>
                <TableSortLabel
                  active
                  direction={sortDesc ? 'desc' : 'asc'}
                  onClick={onToggleSort}
                >
                  #
                </TableSortLabel>
              </TableCell>
              <TableCell>File</TableCell>
              <TableCell>Receipt</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!entries.length && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No ledger entries found
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {entries.map((row) => (
              <TableRow
                key={row.id}
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
                <TableCell align="right">
                  {row.amount_cents !== null ? formatEur(row.amount_cents) : ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}

LedgerEntriesList.propTypes = {
  entries: PropTypes.arrayOf(ledgerEntryRowShape).isRequired,
  sortDesc: PropTypes.bool.isRequired,
  onToggleSort: PropTypes.func.isRequired,
  onRowClick: PropTypes.func.isRequired,
}
