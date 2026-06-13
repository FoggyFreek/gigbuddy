import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { alpha } from '@mui/material/styles'
import PropTypes from 'prop-types'
import NewPurchaseDialog from '../components/NewPurchaseDialog.jsx'
import PeriodPicker from '../components/shared/periodPicker.jsx'
import SplitView from '../components/SplitView.jsx'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import { listPurchasePeriods, listPurchases } from '../api/purchases.js'
import { formatEur } from '../utils/purchaseTotals.js'
import { formatShortDate } from '../utils/dateFormat.js'
import { purchaseStatusColor } from '../utils/purchaseStatus.js'
import { defaultPeriodForDates } from '../utils/invoicePeriod.js'
import { purchaseShape, idProp } from '../propTypes/shared.js'
import StatusDot from '../components/StatusDot.jsx'
import MoneyCells, { MoneyHeaderCells } from '../components/shared/MoneyCells.jsx'

const SUMMARY_CARDS = [
  { key: 'all', label: 'Purchases', chipColor: 'primary' },
  { key: 'draft', label: 'Draft', chipColor: 'secondary' },
  { key: 'overdue', label: 'Overdue', chipColor: 'error' },
  { key: 'unpaid', label: 'Unpaid', chipColor: 'warning' },
  { key: 'paid', label: 'Paid', chipColor: 'success' },
]

function getPurchaseState(p) {
  if (p.status === 'paid') return 'paid'
  if (p.status === 'draft') return 'draft'
  // approved: overdue once today passes the due date, otherwise unpaid.
  if (!p.due_date) return 'unpaid'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today > new Date(p.due_date) ? 'overdue' : 'unpaid'
}

export default function PurchasesPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newDialog, setNewDialog] = useState(false)
  const [summaryFilter, setSummaryFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [period, setPeriod] = useState(() => ({ mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)

  const refreshPeriods = useCallback(async ({ signalLoaded = false } = {}) => {
    try {
      const dates = await listPurchasePeriods()
      setAvailableDates(dates)
      setPeriod((prev) => {
        const fallback = defaultPeriodForDates(dates)
        const currentYear = new Date().getFullYear()
        if (prev.mode !== 'fiscal_year' || prev.year !== currentYear) return prev
        return fallback
      })
    } catch (e) {
      setError(e.message)
    } finally {
      if (signalLoaded) setPeriodsLoaded(true)
    }
  }, [])

  useEffect(() => {
    refreshPeriods({ signalLoaded: true })
  }, [refreshPeriods])

  const summaryStats = useMemo(() => {
    const stats = {
      all: { count: 0, total: 0 },
      draft: { count: 0, total: 0 },
      overdue: { count: 0, total: 0 },
      unpaid: { count: 0, total: 0 },
      paid: { count: 0, total: 0 },
    }
    for (const p of purchases) {
      const state = getPurchaseState(p)
      stats[state].count++
      stats[state].total += Number(p.total_cents) || 0
      stats.all.count++
      stats.all.total += Number(p.total_cents) || 0
    }
    return stats
  }, [purchases])

  const visiblePurchases = useMemo(() => {
    let list = purchases
    if (summaryFilter !== 'all') {
      list = list.filter((p) => getPurchaseState(p) === summaryFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (p) =>
          String(p.receipt_number).includes(q) ||
          (p.supplier_name && p.supplier_name.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q)),
      )
    }
    return list
  }, [purchases, summaryFilter, searchQuery])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listPurchases(period)
      setPurchases(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  // The dialog creates the draft on the server, then we open it in the split-view
  // detail editor and refresh the list so the new draft row appears.
  function handleCreated(id) {
    setNewDialog(false)
    refreshPeriods()
    load()
    navigate(`/purchases/${id}`)
  }

  const handlePurchaseUpdate = useCallback((id, patch) => {
    setPurchases((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  const activeSummaryLabel = SUMMARY_CARDS.find((c) => c.key === summaryFilter)?.label ?? 'Purchases'

  return (
    <SplitView basePath="/purchases" outletContext={{ onReload: load, onPurchaseUpdate: handlePurchaseUpdate }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          Purchases
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewDialog(true)}>
          Create purchase
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {!loading && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
            {SUMMARY_CARDS.map((card) => {
              const stats = summaryStats[card.key]
              const isActive = summaryFilter === card.key
              return (
                <Paper
                  key={card.key}
                  variant="outlined"
                  onClick={() => setSummaryFilter(card.key)}
                  sx={{
                    p: 1.5,
                    minWidth: 120,
                    flex: '1 1 120px',
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: isActive
                      ? 'primary.main'
                      : (t) => (t.palette.mode === 'dark' ? t.palette.grey[600] : t.palette.grey[300]),
                    borderRadius: 1,
                    transition: 'border-color 0.15s',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        bgcolor: (t) => alpha(t.palette[card.chipColor]?.main ?? t.palette.primary.main, 0.18),
                        color: `${card.chipColor}.main`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {stats.count}
                    </Box>
                    <Typography variant="body2" fontWeight={500} sx={{ color: `${card.chipColor}.main` }}>
                      {card.label}
                    </Typography>
                  </Box>
                  <Typography variant="h6" fontWeight={700}>{formatEur(stats.total)}</Typography>
                </Paper>
              )
            })}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" fontWeight={600}>{activeSummaryLabel}</Typography>
            <Chip size="small" label={visiblePurchases.length} />
            <TextField
              size="small"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
            <PeriodPicker availableDates={availableDates} value={period} onChange={setPeriod} />
          </Box>

          <PurchasesList
            purchases={visiblePurchases}
            selectedId={selectedId}
            onRowClick={(p) => navigate(`/purchases/${p.id}`)}
          />
        </>
      )}

      {newDialog && (
        <NewPurchaseDialog onClose={() => setNewDialog(false)} onCreated={handleCreated} />
      )}
    </SplitView>
  )
}

const PAGE_SIZE = 25

function PurchasesList({ purchases, selectedId, onRowClick }) {
  const isCompact = useCompactLayout()
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)

  // Filtering happens in the parent; clamp so a shrinking list can't strand
  // the user on an empty page.
  const pageCount = Math.max(0, Math.ceil(purchases.length / rowsPerPage) - 1)
  const safePage = Math.min(page, pageCount)
  const paged = purchases.slice(safePage * rowsPerPage, (safePage + 1) * rowsPerPage)

  const pagination = purchases.length > rowsPerPage && (
    <TablePagination
      component="div"
      count={purchases.length}
      page={safePage}
      rowsPerPage={rowsPerPage}
      rowsPerPageOptions={[25, 50, 100]}
      onPageChange={(_, p) => setPage(p)}
      onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
    />
  )

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {!purchases.length && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No purchases found</Typography>
        )}
        {paged.map((p) => (
          <Box
            key={p.id}
            onClick={() => onRowClick(p)}
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
              boxShadow: p.id === selectedId ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
            }}
          >
            <StatusDot color={purchaseStatusColor(p.status)} label={p.status} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
                <Typography variant="body2" fontWeight={600}>#{p.receipt_number}</Typography>
                <Typography variant="caption" color="text.secondary">{formatShortDate(p.receipt_date)}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.25 }}>
                {p.supplier_name || '-'}
              </Typography>
            </Box>
            <Typography variant="body1" fontWeight={500} sx={{ flexShrink: 0 }}>{formatEur(p.total_cents)}</Typography>
          </Box>
        ))}
        {pagination}
      </Paper>
    )
  }

  return (
    <Paper variant="outlined">
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '1%', whiteSpace: 'nowrap', px: 1.5 }} />
              <TableCell>Receipt #</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Due date</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Supplier</TableCell>
              <MoneyHeaderCells label="Excl. VAT" />
              <MoneyHeaderCells label="Incl. VAT" />
            </TableRow>
          </TableHead>
          <TableBody>
            {!purchases.length && (
              <TableRow>
                <TableCell colSpan={10}>
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No purchases found</Typography>
                </TableCell>
              </TableRow>
            )}
            {paged.map((p) => (
              <TableRow
                key={p.id}
                hover
                selected={p.id === selectedId}
                sx={{ cursor: 'pointer' }}
                onClick={() => onRowClick(p)}
              >
                <TableCell sx={{ width: '1%', whiteSpace: 'nowrap', px: 1.5 }}><StatusDot color={purchaseStatusColor(p.status)} label={p.status} /></TableCell>
                <TableCell>{p.receipt_number}</TableCell>
                <TableCell>{formatShortDate(p.receipt_date)}</TableCell>
                <TableCell>{p.due_date ? formatShortDate(p.due_date) : ''}</TableCell>
                <TableCell>{p.description || ''}</TableCell>
                <TableCell>{p.supplier_name}</TableCell>
                <MoneyCells cents={p.subtotal_cents} />
                <MoneyCells cents={p.total_cents} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {pagination}
    </Paper>
  )
}

PurchasesList.propTypes = {
  purchases: PropTypes.arrayOf(purchaseShape).isRequired,
  selectedId: idProp,
  onRowClick: PropTypes.func.isRequired,
}
