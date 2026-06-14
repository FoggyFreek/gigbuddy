import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import AddOutlined from '@mui/icons-material/AddOutlined'
import { ChartsContainer } from '@mui/x-charts/ChartsContainer'
import { BarPlot } from '@mui/x-charts/BarChart'
import { LinePlot } from '@mui/x-charts/LineChart'
import { ChartsXAxis } from '@mui/x-charts/ChartsXAxis'
import { ChartsYAxis } from '@mui/x-charts/ChartsYAxis'
import { ChartsAxisHighlight } from '@mui/x-charts/ChartsAxisHighlight'
import { ChartsGrid } from '@mui/x-charts/ChartsGrid'
import ResultChartTooltip from '../components/financial/ResultChartTooltip.tsx'
import PeriodPicker from '../components/shared/periodPicker.tsx'
import { getLedgerOverview, listLedgerPeriods } from '../api/ledger.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import { defaultPeriodForDates } from '../utils/invoicePeriod.ts'
import type { Period } from '../types/entities.ts'

interface Totals {
  revenue_cents: number
  expense_cents: number
  result_cents: number
}

interface MonthData {
  key: string
  year: number
  month: number
  revenue_cents: number
  expense_cents: number
  result_cents: number
}

interface Bucket {
  count: number
  total_cents: number
}

interface InvoicesData {
  overdue: Bucket
  unpaid: Bucket
  draft: Bucket
}

interface VatData {
  year: number
  quarter: number
  due_date: string
  output_cents: number
  input_cents: number
  net_cents: number
}

interface BankData {
  balance_cents: number
}

interface MerchData {
  revenue_cents: number
  cogs_cents: number
  gross_profit_cents: number
  inventory_value_cents: number
}

interface OverviewData {
  currency: string
  totals: Totals
  months: MonthData[]
  bank: BankData
  invoices: InvoicesData
  vat: VatData
  merch?: MerchData
  revenue_cents?: number
  expense_cents?: number
  net_cents?: number
}

const toEuros = (cents: number) => cents / 100
const formatChartValue = (value: number | null | undefined) =>
  formatEur(Math.round((value ?? 0) * 100))

export default function FinancialDashboardPage() {
  const [period, setPeriod] = useState<Period>(() => ({ mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      setData(await getLedgerOverview(period) as OverviewData)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flex: 1 }}>
          Financial
        </Typography>
        <PeriodPicker availableDates={availableDates} value={period} onChange={setPeriod} />
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>
      )}

      {!loading && !error && data && (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          }}
        >
          <Box sx={{ gridColumn: { xs: 'auto', md: '1 / -1' } }}>
            <ResultChartCard currency={data.currency} months={data.months} totals={data.totals} />
          </Box>
          <OverviewCard totals={data.totals} bank={data.bank} />
          <InvoicesCard invoices={data.invoices} />
          <VatCard vat={data.vat} />
          {data.merch && <MerchCard merch={data.merch} totals={data.totals} />}
        </Box>
      )}
    </Box>
  )
}

interface DashboardCardProps {
  title: ReactNode
  action?: ReactNode
  children?: ReactNode
}

function DashboardCard({ title, action, children }: DashboardCardProps) {
  return (
    <Paper variant="outlined" data-card sx={{ p: 2.5, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Paper>
  )
}

// Inline "Label: value" figure in the result card's top-right corner.
interface HeadlineStatProps {
  label: string
  cents: number
  color: string
}

function HeadlineStat({ label, cents, color }: HeadlineStatProps) {
  return (
    <Typography variant="body2" color="text.secondary">
      {label}:{' '}
      <Box component="span" sx={{ color, fontWeight: 600 }}>
        {formatEur(cents)}
      </Box>
    </Typography>
  )
}

// Short month names; the year is appended when the period spans years.
function monthLabels(months: MonthData[]) {
  const multiYear = new Set(months.map((m) => m.year)).size > 1
  return months.map((m) => {
    const name = new Date(Date.UTC(m.year, m.month - 1, 1))
      .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    return multiYear ? `${name} ${String(m.year).slice(2)}` : name
  })
}

// Approximate space the y-axis labels take from the responsive container.
const Y_AXIS_MARGIN_PX = 60
const BAR_WIDTH_PX = 30

interface ResultChartCardProps {
  currency: string
  months: MonthData[]
  totals: Totals
}

function ResultChartCard({ currency, months, totals }: ResultChartCardProps) {
  const theme = useTheme()
  // x-charts only sizes bars via the band's categoryGapRatio, so a fixed 30px
  // bar means measuring the rendered width and deriving the ratio from it.
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => setChartWidth(entries[0].contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const plotWidth = (chartWidth ?? 800) - Y_AXIS_MARGIN_PX
  const categoryGapRatio = Math.min(0.9, Math.max(0.1, 1 - (BAR_WIDTH_PX * months.length) / plotWidth))

  return (
    <DashboardCard
      title={(
        <>
          Result in {currency}{' '}
          <Typography component="span" variant="caption" color="text.secondary">
            Excl. VAT
          </Typography>
        </>
      )}
      action={(
        <Box sx={{ display: 'flex', gap: 2.5 }}>
          <HeadlineStat label="Revenue" cents={totals.revenue_cents} color={theme.palette.success.main} />
          <HeadlineStat label="Expenses" cents={-totals.expense_cents} color={theme.palette.error.main} />
          <HeadlineStat label="Result" cents={totals.result_cents} color={theme.palette.success.main} />
        </Box>
      )}
    >
      <Box ref={wrapperRef}>
      <ChartsContainer
        height={280}
        xAxis={[{ id: 'months', data: monthLabels(months), scaleType: 'band', categoryGapRatio }]}
        series={[
          {
            type: 'bar',
            label: 'Revenue',
            data: months.map((m) => toEuros(m.revenue_cents)),
            color: theme.palette.success.main,
            // Shared stack id: one column per month, revenue above the zero
            // line and (negative) expenses below it.
            stack: 'result',
            valueFormatter: formatChartValue,
          },
          {
            type: 'bar',
            label: 'Expenses',
            data: months.map((m) => toEuros(-m.expense_cents)),
            color: theme.palette.error.main,
            stack: 'result',
            valueFormatter: formatChartValue,
          },
          {
            type: 'line',
            label: 'Result',
            data: months.map((m) => toEuros(m.result_cents)),
            color: theme.palette.text.disabled,
            curve: 'monotoneX',
            valueFormatter: formatChartValue,
          },
        ]}
        sx={{
          '& .MuiLineElement-root': { strokeWidth: 1.5 },
          '& .MuiChartsAxisHighlight-root': {
            stroke: theme.palette.text.disabled,
            strokeWidth: 1,
            strokeDasharray: 'none',
          },
        }}
      >
        <ChartsGrid horizontal />
        <BarPlot borderRadius={4} />
        <LinePlot />
        <ChartsXAxis axisId="months" disableLine disableTicks />
        <ChartsYAxis disableLine disableTicks />
        <ChartsAxisHighlight x="line" />
        <ResultChartTooltip />
      </ChartsContainer>
      </Box>
    </DashboardCard>
  )
}

// One overview row: label above a rounded bar scaled against the period's
// largest figure, value to the right (mockup layout).
interface OverviewBarProps {
  label: string
  cents: number
  color: string
  maxCents: number
}

function OverviewBar({ label, cents, color, maxCents }: OverviewBarProps) {
  const pct = maxCents > 0 ? Math.min(100, (Math.abs(cents) / maxCents) * 100) : 0
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.5 }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, color }}>
          {formatEur(cents)}
        </Typography>
      </Box>
      <Box sx={{ height: 10, borderRadius: 5, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: 5, bgcolor: color }} />
      </Box>
    </Box>
  )
}

interface OverviewCardProps {
  totals: Totals
  bank: BankData
}

function OverviewCard({ totals, bank }: OverviewCardProps) {
  const theme = useTheme()
  const maxCents = Math.max(
    Math.abs(totals.revenue_cents),
    Math.abs(totals.expense_cents),
    Math.abs(totals.result_cents),
  )
  return (
    <DashboardCard title="Overview">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 0.5 }}>
        <OverviewBar label="Income" cents={totals.revenue_cents} color={theme.palette.success.main} maxCents={maxCents} />
        <OverviewBar label="Expenses" cents={totals.expense_cents} color={theme.palette.error.main} maxCents={maxCents} />
        <OverviewBar label="Profit" cents={totals.result_cents} color={theme.palette.success.main} maxCents={maxCents} />
      </Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          mt: 2.5,
          pt: 1.5,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="body2" color="text.secondary">Bank balance</Typography>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>{formatEur(bank.balance_cents)}</Typography>
      </Box>
    </DashboardCard>
  )
}

// One Overdue / Unpaid / Draft column in the invoices card.
interface InvoiceBucketProps {
  label: string
  bucket: Bucket
  dotColor: string
}

function InvoiceBucket({ label, bucket, dotColor }: InvoiceBucketProps) {
  return (
    <Box sx={{ flex: 1, minWidth: 110 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor }} />
        <Typography variant="body2" color="text.secondary">{label}</Typography>
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 600, mt: 0.5 }}>
        {formatEur(bucket.total_cents)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {bucket.count} {bucket.count === 1 ? 'invoice' : 'invoices'}
      </Typography>
    </Box>
  )
}

interface InvoicesCardProps {
  invoices: InvoicesData
}

function InvoicesCard({ invoices }: InvoicesCardProps) {
  return (
    <DashboardCard
      title="Invoices"
      action={(
        <Button
          component={RouterLink}
          to="/invoices"
          size="small"
          variant="outlined"
          startIcon={<AddOutlined />}
        >
          Create invoice
        </Button>
      )}
    >
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
        <InvoiceBucket label="Overdue" bucket={invoices.overdue} dotColor="error.main" />
        <InvoiceBucket label="Unpaid" bucket={invoices.unpaid} dotColor="warning.main" />
        <InvoiceBucket label="Draft" bucket={invoices.draft} dotColor="info.main" />
      </Box>
    </DashboardCard>
  )
}

// Merch gross-margin panel: revenue/COGS within the selected period, the
// resulting margin, merch's share of total revenue, and the current stock
// value (a point-in-time asset balance, independent of the period).
interface MerchCardProps {
  merch: MerchData
  totals: Totals
}

function MerchCard({ merch, totals }: MerchCardProps) {
  const marginPct = merch.revenue_cents > 0
    ? Math.round((merch.gross_profit_cents / merch.revenue_cents) * 100)
    : null
  const sharePct = totals.revenue_cents > 0
    ? Math.round((merch.revenue_cents / totals.revenue_cents) * 100)
    : null

  return (
    <DashboardCard
      title="Merchandise"
      action={(
        <Button component={RouterLink} to="/merch" size="small" variant="outlined">
          Manage merch
        </Button>
      )}
    >
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography variant="caption" color="text.secondary">Gross profit</Typography>
          <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5, color: 'success.main' }}>
            {formatEur(merch.gross_profit_cents)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {marginPct === null ? 'No merch sales in this period' : `${marginPct}% margin on sales`}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography variant="caption" color="text.secondary">Inventory value</Typography>
          <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5 }}>
            {formatEur(merch.inventory_value_cents)}
          </Typography>
          <Typography variant="body2" color="text.secondary">Stock on hand, at cost</Typography>
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>
        Sales {formatEur(merch.revenue_cents)} − cost of goods {formatEur(merch.cogs_cents)}
        {sharePct !== null && ` — ${sharePct}% of total revenue`}
      </Typography>
    </DashboardCard>
  )
}

interface VatCardProps {
  vat: VatData
}

function VatCard({ vat }: VatCardProps) {
  // Snapshot the clock once on mount so render stays idempotent.
  const [now] = useState(() => Date.now())
  const owes = vat.net_cents >= 0
  const due = new Date(`${vat.due_date}T00:00:00`)
  const daysUntilDue = Math.max(0, Math.ceil((due.getTime() - now) / 86400000))
  const dueLabel = due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <DashboardCard title="VAT">
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Typography variant="caption" color="text.secondary">
            Balance with the Tax Administration
          </Typography>
          <Typography
            variant="h4"
            sx={{ fontWeight: 600, my: 0.5, color: owes ? 'error.main' : 'success.main' }}
          >
            {formatEur(Math.abs(vat.net_cents))}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            For period: Q{vat.quarter} {vat.year}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Typography variant="caption" color="text.secondary">
            Due date
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5 }}>
            {daysUntilDue} days
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {dueLabel}
          </Typography>
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>
        {owes ? 'You owe tax' : 'You get money back'} — VAT on sales {formatEur(vat.output_cents)},
        on purchases {formatEur(vat.input_cents)}
      </Typography>
    </DashboardCard>
  )
}
