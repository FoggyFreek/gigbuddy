import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import ListPagination from '../components/shared/ListPagination.tsx'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { alpha } from '@mui/material/styles'
import NewInvoiceDialog from '../components/NewInvoiceDialog.tsx'
import PeriodPicker from '../components/shared/periodPicker.tsx'
import SplitView from '../components/SplitView.tsx'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { listInvoicePeriods, listInvoices } from '../api/invoices.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import { invoiceStatusColor } from '../utils/invoiceStatus.ts'
import { defaultPeriodForDates } from '../utils/invoicePeriod.ts'
import StatusDot from '../components/StatusDot.tsx'
import MoneyCells, { MoneyHeaderCells } from '../components/shared/MoneyCells.tsx'
import type { Invoice, InvoiceStatus, Id, Period } from '../types/entities.ts'

const SUMMARY_CARDS = [
  { key: 'all', chipColor: 'primary' },
  { key: 'draft', chipColor: 'secondary' },
  { key: 'overdue', chipColor: 'error' },
  { key: 'unpaid', chipColor: 'warning' },
  { key: 'paid', chipColor: 'success' },
] as const

type SummaryKey = 'all' | 'draft' | 'overdue' | 'unpaid' | 'paid'

function getInvoiceState(inv: Invoice): SummaryKey | 'void' {
  if (inv.status === 'paid') return 'paid'
  if (inv.status === 'draft') return 'draft'
  if (inv.status === 'void') return 'void'
  // sent: overdue when today has passed the due date
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(inv.issue_date ?? '')
  dueDate.setDate(dueDate.getDate() + (Number(inv.payment_term_days) || 14))
  return today > dueDate ? 'overdue' : 'unpaid'
}

// "unpaid" is the everything-not-yet-paid bucket, so it also matches overdue
// invoices (overdue is the past-due subset of unpaid).
function matchesSummaryFilter(inv: Invoice, filter: SummaryKey): boolean {
  if (filter === 'all') return true
  const state = getInvoiceState(inv)
  if (filter === 'unpaid') return state === 'unpaid' || state === 'overdue'
  return state === filter
}

export default function InvoicesPage() {
  const { t } = useTranslation('invoices')
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newDialog, setNewDialog] = useState(false)
  const [summaryFilter, setSummaryFilter] = useState<SummaryKey>('unpaid')
  const [searchQuery, setSearchQuery] = useState('')
  const [period, setPeriod] = useState<Period>(() => ({ mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)

  const refreshPeriods = useCallback(async ({ signalLoaded = false } = {}) => {
    try {
      const dates = await listInvoicePeriods()
      setAvailableDates(dates as string[])
      setPeriod((prev) => {
        const fallback = defaultPeriodForDates(dates as string[])
        const currentYear = new Date().getFullYear()
        if (prev.mode !== 'fiscal_year' || prev.year !== currentYear) return prev
        return fallback
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (signalLoaded) setPeriodsLoaded(true)
    }
  }, [])

  useEffect(() => {
    refreshPeriods({ signalLoaded: true })
  }, [refreshPeriods])

  const summaryStats = useMemo(() => {
    const stats: Record<string, { count: number; total: number }> = {
      all: { count: 0, total: 0 },
      draft: { count: 0, total: 0 },
      overdue: { count: 0, total: 0 },
      unpaid: { count: 0, total: 0 },
      paid: { count: 0, total: 0 },
    }
    for (const inv of invoices) {
      const state = getInvoiceState(inv)
      if (state === 'void') continue
      const amount = Number(inv.total_cents) || 0
      stats[state].count++
      stats[state].total += amount
      // overdue is a subset of unpaid — also fold it into the unpaid totals.
      if (state === 'overdue') {
        stats.unpaid.count++
        stats.unpaid.total += amount
      }
      stats.all.count++
      stats.all.total += amount
    }
    return stats
  }, [invoices])

  const visibleInvoices = useMemo(() => {
    let list = invoices
    if (summaryFilter !== 'all') {
      list = list.filter((inv) => matchesSummaryFilter(inv, summaryFilter))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (inv) =>
          inv.invoice_number?.toLowerCase().includes(q) ||
          inv.customer_name?.toLowerCase().includes(q),
      )
    }
    return list
  }, [invoices, summaryFilter, searchQuery])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listInvoices(period)
      setInvoices(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  function handleCreated(id: Id) {
    setNewDialog(false)
    refreshPeriods()
    load()
    navigate(`/invoices/${id}`)
  }

  const handleInvoiceUpdate = useCallback((id: Id, patch: Partial<Invoice>) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === id ? { ...inv, ...patch } : inv)))
  }, [])

  const activeSummaryLabel = t($ => $.state[summaryFilter])

  return (
    <SplitView basePath="/invoices" outletContext={{ onReload: load, onInvoiceUpdate: handleInvoiceUpdate }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {t($ => $.title)}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setNewDialog(true)}
        >
          {t($ => $.createInvoice)}
        </Button>
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
                      : (t) => t.palette.mode === 'dark' ? t.palette.grey[600] : t.palette.grey[300],
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
                    <Typography variant="body2" sx={{ fontWeight: 500, color: `${card.chipColor}.main` }}>
                      {t($ => $.state[card.key])}
                    </Typography>
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {formatEur(stats.total)}
                  </Typography>
                </Paper>
              )
            })}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {activeSummaryLabel}
            </Typography>
            <Chip size="small" label={visibleInvoices.length} />
            <TextField
              size="small"
              placeholder={t($ => $.searchPlaceholder)}
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
            <PeriodPicker
              availableDates={availableDates}
              value={period}
              onChange={setPeriod}
            />
          </Box>

          <InvoicesList
            invoices={visibleInvoices}
            selectedId={selectedId}
            onRowClick={(inv) => navigate(`/invoices/${inv.id}`)}
          />
        </>
      )}

      {newDialog && (
        <NewInvoiceDialog
          onClose={() => setNewDialog(false)}
          onCreated={handleCreated}
        />
      )}
    </SplitView>
  )
}

const PAGE_SIZE = 25

interface InvoicesListProps {
  invoices: Invoice[]
  selectedId: Id | null
  onRowClick: (inv: Invoice) => void
}

function InvoicesList({ invoices, selectedId, onRowClick }: InvoicesListProps) {
  const { t, i18n } = useTranslation('invoices')
  const isCompact = useCompactLayout()
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)

  // Filtering happens in the parent; clamp so a shrinking list can't strand
  // the user on an empty page.
  const pageCount = Math.max(0, Math.ceil(invoices.length / rowsPerPage) - 1)
  const safePage = Math.min(page, pageCount)
  const paged = invoices.slice(safePage * rowsPerPage, (safePage + 1) * rowsPerPage)

  const pagination = invoices.length > rowsPerPage && (
    <ListPagination
      count={invoices.length}
      page={safePage}
      rowsPerPage={rowsPerPage}
      rowsPerPageOptions={[25, 50, 100]}
      labelRowsPerPage={t($ => $.pagination.rowsPerPage)}
      labelDisplayedRows={({ from, to, count }) => t($ => $.pagination.displayedRows, { from, to, count })}
      getItemAriaLabel={(type) => t($ => $.pagination[type])}
      onPageChange={(_, p) => setPage(p)}
      onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
    />
  )

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {!invoices.length && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            {t($ => $.empty)}
          </Typography>
        )}
        {paged.map((inv) => (
          <Box
            key={String(inv.id)}
            onClick={() => onRowClick(inv)}
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
              boxShadow: inv.id === selectedId
                ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}`
                : 'none',
            }}
          >
            <StatusDot color={invoiceStatusColor(inv.status)} label={inv.status ? t($ => $.rawStatus[inv.status as InvoiceStatus]) : undefined} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  #{inv.invoice_number}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatShortDate(inv.issue_date, i18n.resolvedLanguage)}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {inv.customer_name || '-'}
              </Typography>
            </Box>
            <Typography variant="body1" sx={{ fontWeight: 500, flexShrink: 0 }}>
              {formatEur(inv.total_cents)}
            </Typography>
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
              <TableCell>{t($ => $.table.invoiceNumber)}</TableCell>
              <TableCell>{t($ => $.table.date)}</TableCell>
              <TableCell>{t($ => $.labels.customer)}</TableCell>
              <MoneyHeaderCells label={t($ => $.labels.total)} />
            </TableRow>
          </TableHead>
          <TableBody>
            {!invoices.length && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    {t($ => $.empty)}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {paged.map((inv) => (
              <TableRow
                key={String(inv.id)}
                hover
                selected={inv.id === selectedId}
                sx={{ cursor: 'pointer' }}
                onClick={() => onRowClick(inv)}
              >
                <TableCell sx={{ width: '1%', whiteSpace: 'nowrap', px: 1.5 }}>
                  <StatusDot color={invoiceStatusColor(inv.status)} label={inv.status ? t($ => $.rawStatus[inv.status as InvoiceStatus]) : undefined} />
                </TableCell>
                <TableCell>#{inv.invoice_number}</TableCell>
                <TableCell>{formatShortDate(inv.issue_date, i18n.resolvedLanguage)}</TableCell>
                <TableCell>{inv.customer_name}</TableCell>
                <MoneyCells cents={inv.total_cents} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {pagination}
    </Paper>
  )
}
