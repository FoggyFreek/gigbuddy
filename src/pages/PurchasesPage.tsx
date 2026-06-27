import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { alpha } from '@mui/material/styles'
import NewPurchaseDialog from '../components/NewPurchaseDialog.tsx'
import PeriodPicker from '../components/shared/periodPicker.tsx'
import PurchasesList from '../components/purchases/PurchasesList.tsx'
import SplitView from '../components/SplitView.tsx'
import { listPurchasePeriods, listPurchases } from '../api/purchases.ts'
import { formatEur } from '../utils/purchaseTotals.ts'
import { defaultPeriodForDates } from '../utils/invoicePeriod.ts'
import type { Purchase, Id, Period } from '../types/entities.ts'

const SUMMARY_CARDS = [
  { key: 'all', chipColor: 'primary' },
  { key: 'draft', chipColor: 'secondary' },
  { key: 'overdue', chipColor: 'error' },
  { key: 'unpaid', chipColor: 'warning' },
  { key: 'paid', chipColor: 'success' },
] as const

type SummaryKey = 'all' | 'draft' | 'overdue' | 'unpaid' | 'paid'

function getPurchaseState(p: Purchase): SummaryKey {
  if (p.status === 'paid') return 'paid'
  if (p.status === 'draft') return 'draft'
  // approved: overdue once today passes the due date, otherwise unpaid.
  if (!p.due_date) return 'unpaid'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today > new Date(p.due_date) ? 'overdue' : 'unpaid'
}

// "unpaid" is the everything-not-yet-paid bucket, so it also matches overdue
// purchases (overdue is the past-due subset of unpaid).
function matchesSummaryFilter(p: Purchase, filter: SummaryKey): boolean {
  if (filter === 'all') return true
  const state = getPurchaseState(p)
  if (filter === 'unpaid') return state === 'unpaid' || state === 'overdue'
  return state === filter
}

export default function PurchasesPage() {
  const { t } = useTranslation('purchases')
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [purchases, setPurchases] = useState<Purchase[]>([])
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
      const dates = await listPurchasePeriods()
      setAvailableDates(dates.filter(Boolean))
      setPeriod((prev) => {
        const fallback = defaultPeriodForDates(dates)
        const currentYear = new Date().getFullYear()
        if (prev.mode !== 'fiscal_year' || prev.year !== currentYear) return prev
        return fallback
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (signalLoaded) setPeriodsLoaded(true)
    }
  }, [])

  useEffect(() => {
    refreshPeriods({ signalLoaded: true })
  }, [refreshPeriods])

  const summaryStats = useMemo(() => {
    const stats: Record<SummaryKey, { count: number; total: number }> = {
      all: { count: 0, total: 0 },
      draft: { count: 0, total: 0 },
      overdue: { count: 0, total: 0 },
      unpaid: { count: 0, total: 0 },
      paid: { count: 0, total: 0 },
    }
    for (const p of purchases) {
      const amount = Number(p.total_cents) || 0
      const state = getPurchaseState(p)
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
  }, [purchases])

  const visiblePurchases = useMemo(() => {
    let list = purchases
    if (summaryFilter !== 'all') {
      list = list.filter((p) => matchesSummaryFilter(p, summaryFilter))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (p) =>
          String(p.receipt_number).includes(q) ||
          p.supplier_name?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q),
      )
    }
    return list
  }, [purchases, summaryFilter, searchQuery])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listPurchases(period)
      setPurchases(data as Purchase[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  // The dialog creates the draft on the server, then we open it in the split-view
  // detail editor and refresh the list so the new draft row appears.
  function handleCreated(id: Id) {
    setNewDialog(false)
    refreshPeriods()
    load()
    navigate(`/purchases/${id}`)
  }

  const handlePurchaseUpdate = useCallback((id: Id, patch: Partial<Purchase>) => {
    setPurchases((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  const activeSummaryLabel = summaryFilter === 'all' ? t($ => $.title) : t($ => $.summary[summaryFilter])

  return (
    <SplitView basePath="/purchases" outletContext={{ onReload: load, onPurchaseUpdate: handlePurchaseUpdate }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 600,  flexGrow: 1  }}>
          {t($ => $.title)}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewDialog(true)}>
          {t($ => $.createPurchase)}
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
              const stats = summaryStats[card.key as SummaryKey]
              const isActive = summaryFilter === card.key
              return (
                <Paper
                  key={card.key}
                  variant="outlined"
                  onClick={() => setSummaryFilter(card.key as SummaryKey)}
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
                        bgcolor: (t) => alpha((t.palette[card.chipColor as keyof typeof t.palette] as { main?: string })?.main ?? t.palette.primary.main, 0.18),
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
                      {card.key === 'all' ? t($ => $.title) : t($ => $.summary[card.key])}
                    </Typography>
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatEur(stats.total)}</Typography>
                </Paper>
              )
            })}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{activeSummaryLabel}</Typography>
            <Chip size="small" label={visiblePurchases.length} />
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
