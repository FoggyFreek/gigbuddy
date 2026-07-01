import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import DashboardCard from '../components/dashboard/DashboardCard.tsx'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import AddOutlined from '@mui/icons-material/AddOutlined'
import { ChartsContainer } from '@mui/x-charts/ChartsContainer'
import { BarPlot } from '@mui/x-charts/BarChart'
import { LineChart, LinePlot } from '@mui/x-charts/LineChart'
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

interface AnnualResult {
  year: number
  has_data: boolean
  revenue_cents: number
  expense_cents: number
  result_cents: number
}

interface MerchData {
  revenue_cents: number
  cogs_cents: number
  gross_profit_cents: number
  inventory_value_cents: number
}

interface FeeStatusBucket {
  count: number
  total_cents: number
}

interface UpcomingFeesData {
  total_cents: number
  gig_count: number
  by_status: {
    option: FeeStatusBucket
    confirmed: FeeStatusBucket
    announced: FeeStatusBucket
  }
}

interface OverviewData {
  currency: string
  totals: Totals
  months: MonthData[]
  annual_results: AnnualResult[]
  bank: BankData
  invoices: InvoicesData
  vat: VatData
  merch?: MerchData
  upcoming_fees: UpcomingFeesData
  revenue_cents?: number
  expense_cents?: number
  net_cents?: number
}

const toEuros = (cents: number) => cents / 100
const formatChartValue = (value: number | null | undefined) =>
  formatEur(Math.round((value ?? 0) * 100))

// Compact euro for axis ticks (e.g. "€15K") — the full amount stays in the
// hover overlay via the series valueFormatter.
const compactEur = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1,
})
const formatCompactChartValue = (value: number | null | undefined) => compactEur.format(value ?? 0)

export default function FinancialDashboardPage() {
  const { t } = useTranslation('financialDashboard')
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
          {t($ => $.title)}
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
          <Box
            sx={{
              gridColumn: { xs: 'auto', md: '1 / -1' },
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              alignItems: 'stretch',
            }}
          >
            <OverviewCard totals={data.totals} bank={data.bank} />
            <ResultsTrendCard currency={data.currency} annualResults={data.annual_results} />
            <InvoicesCard invoices={data.invoices} />
          </Box>
          <Box
            sx={{
              gridColumn: { xs: 'auto', md: '1 / -1' },
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              alignItems: 'stretch',
            }}
          >
            <VatCard vat={data.vat} />
            <UpcomingFeesCard fees={data.upcoming_fees} />
            {data.merch && <MerchCard merch={data.merch} totals={data.totals} />}
          </Box>
        </Box>
      )}
    </Box>
  )
}


// Inline "Label: value" figure in the result card's top-right corner.
interface HeadlineStatProps {
  label: string
  cents: number
  color: string
}

function HeadlineStat({ label, cents, color }: Readonly<HeadlineStatProps>) {
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
function monthLabels(months: MonthData[], lng: string) {
  const multiYear = new Set(months.map((m) => m.year)).size > 1
  return months.map((m) => {
    const name = new Date(Date.UTC(m.year, m.month - 1, 1))
      .toLocaleDateString(lng, { month: 'short', timeZone: 'UTC' })
    return multiYear ? `${name} ${String(m.year).slice(2)}` : name
  })
}

// Approximate space the y-axis labels take from the responsive container.
const Y_AXIS_MARGIN_PX = 60
const BAR_WIDTH_PX = 30

// SVG gradient ids for the result bars (one per sign so each bar fades from
// transparent at the zero line to its solid colour at the far end — upward for
// revenue, downward for expenses — letting the card background show through).
const REVENUE_BAR_GRADIENT = 'fd-result-revenue-bar'
const EXPENSE_BAR_GRADIENT = 'fd-result-expense-bar'

interface ResultChartCardProps {
  currency: string
  months: MonthData[]
  totals: Totals
}

function ResultChartCard({ currency, months, totals }: Readonly<ResultChartCardProps>) {
  const { t, i18n } = useTranslation('financialDashboard')
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
          {t($ => $.resultCard.title, { currency })}{' '}
          <Typography component="span" variant="caption" color="text.secondary">
            {t($ => $.resultCard.exclVat)}
          </Typography>
        </>
      )}
      action={(
        <Box sx={{ display: 'flex', gap: 2.5 }}>
          <HeadlineStat label={t($ => $.resultCard.revenue)} cents={totals.revenue_cents} color={theme.palette.success.main} />
          <HeadlineStat label={t($ => $.resultCard.expenses)} cents={-totals.expense_cents} color={theme.palette.error.main} />
          <HeadlineStat label={t($ => $.resultCard.result)} cents={totals.result_cents} color={theme.palette.success.main} />
        </Box>
      )}
    >
      <Box ref={wrapperRef}>
      <ChartsContainer
        height={280}
        xAxis={[{ id: 'months', data: monthLabels(months, i18n.language), scaleType: 'band', categoryGapRatio }]}
        series={[
          {
            type: 'bar',
            id: 'revenue',
            label: t($ => $.resultCard.revenue),
            data: months.map((m) => toEuros(m.revenue_cents)),
            color: theme.palette.success.main,
            // Shared stack id: one column per month, revenue above the zero
            // line and (negative) expenses below it.
            stack: 'result',
            valueFormatter: formatChartValue,
          },
          {
            type: 'bar',
            id: 'expenses',
            label: t($ => $.resultCard.expenses),
            data: months.map((m) => toEuros(-m.expense_cents)),
            color: theme.palette.error.main,
            stack: 'result',
            valueFormatter: formatChartValue,
          },
          {
            type: 'line',
            label: t($ => $.resultCard.result),
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
        <defs>
          {/* Revenue bars sit above the zero line: 80% transparent at the
              bottom (the line), reaching solid green 60% of the way up and
              staying solid to the top. */}
          <linearGradient id={REVENUE_BAR_GRADIENT} x1="0" y1="0" x2="0" y2="1">
            <stop offset="40%" stopColor={theme.palette.success.main} />
            <stop offset="100%" stopColor={theme.palette.success.main} stopOpacity={0.4} />
          </linearGradient>
          {/* Expense bars hang below the line: 80% transparent at the top (the
              line), reaching solid red 60% of the way down and staying solid to
              the bottom. */}
          <linearGradient id={EXPENSE_BAR_GRADIENT} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.palette.error.main} stopOpacity={0.4} />
            <stop offset="60%" stopColor={theme.palette.error.main} />
          </linearGradient>
        </defs>
        <ChartsGrid horizontal />
        <BarPlot
          borderRadius={4}
          slotProps={{
            bar: (ownerState) => ({
              fill: `url(#${ownerState.seriesId === 'expenses' ? EXPENSE_BAR_GRADIENT : REVENUE_BAR_GRADIENT})`,
            }),
          }}
        />
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

function OverviewBar({ label, cents, color, maxCents }: Readonly<OverviewBarProps>) {
  const pct = maxCents > 0 ? Math.min(100, (Math.abs(cents) / maxCents) * 100) : 0
  // Same treatment as the result chart, laid out horizontally: 80% transparent
  // at the line (left edge), reaching the solid colour 60% across and holding.
  const fill = `linear-gradient(to right, color-mix(in srgb, ${color} 20%, transparent) 0%, ${color} 60%)`
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.5 }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, color }}>
          {formatEur(cents)}
        </Typography>
      </Box>
      <Box sx={{ height: 10, borderRadius: 5, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: 5, background: fill }} />
      </Box>
    </Box>
  )
}

interface OverviewCardProps {
  totals: Totals
  bank: BankData
}

function OverviewCard({ totals, bank }: Readonly<OverviewCardProps>) {
  const { t } = useTranslation('financialDashboard')
  const theme = useTheme()
  const maxCents = Math.max(
    Math.abs(totals.revenue_cents),
    Math.abs(totals.expense_cents),
    Math.abs(totals.result_cents),
  )
  return (
    <DashboardCard title={t($ => $.overview.title)}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 0.5 }}>
        <OverviewBar label={t($ => $.overview.income)} cents={totals.revenue_cents} color={theme.palette.success.main} maxCents={maxCents} />
        <OverviewBar label={t($ => $.overview.expenses)} cents={totals.expense_cents} color={theme.palette.error.main} maxCents={maxCents} />
        <OverviewBar label={t($ => $.overview.profit)} cents={totals.result_cents} color={theme.palette.success.main} maxCents={maxCents} />
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
        <Typography variant="body2" color="text.secondary">{t($ => $.overview.bankBalance)}</Typography>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>{formatEur(bank.balance_cents)}</Typography>
      </Box>
    </DashboardCard>
  )
}

// Compact line chart of the yearly result over the trailing calendar years,
// sized at half the Overview card's width and seated beside it.
interface ResultsTrendCardProps {
  currency: string
  annualResults: AnnualResult[]
}

function ResultsTrendCard({ currency, annualResults }: Readonly<ResultsTrendCardProps>) {
  const { t } = useTranslation('financialDashboard')
  const theme = useTheme()
  const latestResult = annualResults[annualResults.length - 1]?.result_cents ?? 0
  const lineColor = latestResult >= 0 ? theme.palette.success.main : theme.palette.error.main

  // Years without ledger activity render as gaps (null) — no marker, and the
  // line breaks rather than connecting through a fabricated zero.
  const seriesData = annualResults.map((r) => (r.has_data ? toEuros(r.result_cents) : null))

  // Anchor the y-axis to 0 so the zero line is always in view — the line sits
  // above it for a profit, below it for a loss. (A degenerate all-zero/empty
  // series leaves the bounds unset so x-charts picks a sensible range.)
  const values = annualResults.filter((r) => r.has_data).map((r) => toEuros(r.result_cents))
  const yMin = Math.min(0, ...values)
  const yMax = Math.max(0, ...values)
  const yBounds = yMin === yMax ? {} : { min: yMin, max: yMax }

  return (
    <DashboardCard
      title={(
        <>
          {t($ => $.resultTrend.title)}{' '}
          <Typography component="span" variant="caption" color="text.secondary">
            {t($ => $.resultTrend.subtitle, { count: annualResults.length, currency })}
          </Typography>
        </>
      )}
    >
      <LineChart
        height={196}
        margin={{ left: 4, right: 24, top: 8, bottom: 14 }}
        xAxis={[{ data: annualResults.map((r) => String(r.year)), scaleType: 'point', disableLine: true, disableTicks: true }]}
        yAxis={[{ width: Y_AXIS_MARGIN_PX, disableLine: true, disableTicks: true, valueFormatter: formatCompactChartValue, ...yBounds }]}
        series={[{
          data: seriesData,
          color: lineColor,
          curve: 'linear',
          showMark: true,
          connectNulls: false,
          valueFormatter: formatChartValue,
        }]}
        grid={{ horizontal: true }}
        sx={{
          '& .MuiLineElement-root': { strokeWidth: 1.5 },
          // Ticks are hidden, so nudge the year labels clear of the plot bottom.
          '& .MuiChartsAxis-bottom .MuiChartsAxis-tickLabel': { transform: 'translateY(8px)' },
        }}
      />
    </DashboardCard>
  )
}

// One Overdue / Unpaid / Draft column in the invoices card.
interface InvoiceBucketProps {
  label: string
  bucket: Bucket
  dotColor: string
}

function InvoiceBucket({ label, bucket, dotColor }: Readonly<InvoiceBucketProps>) {
  const { t } = useTranslation('financialDashboard')
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
        {t($ => $.invoices.count, { count: bucket.count })}
      </Typography>
    </Box>
  )
}

interface InvoicesCardProps {
  invoices: InvoicesData
}

function InvoicesCard({ invoices }: Readonly<InvoicesCardProps>) {
  const { t } = useTranslation('financialDashboard')
  return (
    <DashboardCard
      title={t($ => $.invoices.title)}
      action={(
        <Button
          component={RouterLink}
          to="/invoices"
          size="small"
          variant="outlined"
          startIcon={<AddOutlined />}
        >
          {t($ => $.invoices.create)}
        </Button>
      )}
    >
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
        <InvoiceBucket label={t($ => $.invoices.overdue)} bucket={invoices.overdue} dotColor="error.main" />
        <InvoiceBucket label={t($ => $.invoices.unpaid)} bucket={invoices.unpaid} dotColor="warning.main" />
        <InvoiceBucket label={t($ => $.invoices.draft)} bucket={invoices.draft} dotColor="info.main" />
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

function MerchCard({ merch, totals }: Readonly<MerchCardProps>) {
  const { t } = useTranslation('financialDashboard')
  const marginPct = merch.revenue_cents > 0
    ? Math.round((merch.gross_profit_cents / merch.revenue_cents) * 100)
    : null
  const sharePct = totals.revenue_cents > 0
    ? Math.round((merch.revenue_cents / totals.revenue_cents) * 100)
    : null

  return (
    <DashboardCard
      title={t($ => $.merch.title)}
      action={(
        <Button component={RouterLink} to="/merch" size="small" variant="outlined">
          {t($ => $.merch.manage)}
        </Button>
      )}
    >
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography variant="caption" color="text.secondary">{t($ => $.merch.grossProfit)}</Typography>
          <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5, color: 'success.main' }}>
            {formatEur(merch.gross_profit_cents)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {marginPct === null ? t($ => $.merch.noSales) : t($ => $.merch.margin, { pct: marginPct })}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography variant="caption" color="text.secondary">{t($ => $.merch.inventoryValue)}</Typography>
          <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5 }}>
            {formatEur(merch.inventory_value_cents)}
          </Typography>
          <Typography variant="body2" color="text.secondary">{t($ => $.merch.stockOnHand)}</Typography>
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>
        {sharePct === null
          ? t($ => $.merch.breakdown, {
              sales: formatEur(merch.revenue_cents),
              cogs: formatEur(merch.cogs_cents),
            })
          : t($ => $.merch.breakdownWithShare, {
              sales: formatEur(merch.revenue_cents),
              cogs: formatEur(merch.cogs_cents),
              pct: sharePct,
            })}
      </Typography>
    </DashboardCard>
  )
}

// Upcoming gross band-fee pipeline: a headline total across all future gigs in
// the active statuses, with a per-status breakdown of count and fees. Pinned to
// "today" (like VAT/bank), independent of the selected period.
interface UpcomingFeesCardProps {
  fees: UpcomingFeesData
}

const FEE_STATUS_META: { key: keyof UpcomingFeesData['by_status']; dotColor: string }[] = [
  { key: 'confirmed', dotColor: 'success.main' },
  { key: 'announced', dotColor: 'info.main' },
  { key: 'option', dotColor: 'warning.main' },
]

function UpcomingFeesCard({ fees }: Readonly<UpcomingFeesCardProps>) {
  const { t } = useTranslation('financialDashboard')
  return (
    <DashboardCard
      title={t($ => $.upcomingFees.title)}
      action={(
        <Button component={RouterLink} to="/gigs" size="small" variant="outlined">
          {t($ => $.upcomingFees.viewGigs)}
        </Button>
      )}
    >
      <Box>
        <Typography variant="caption" color="text.secondary">{t($ => $.upcomingFees.grossBandFees)}</Typography>
        <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5, color: 'success.main' }}>
          {formatEur(fees.total_cents)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {fees.gig_count === 0
            ? t($ => $.upcomingFees.noGigs)
            : t($ => $.upcomingFees.across, { count: fees.gig_count })}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 2 }}>
        {FEE_STATUS_META.map(({ key, dotColor }) => (
          <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor }} />
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {t($ => $.upcomingFees[key])} ({fees.by_status[key].count})
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {formatEur(fees.by_status[key].total_cents)}
            </Typography>
          </Box>
        ))}
      </Box>
    </DashboardCard>
  )
}

interface VatCardProps {
  vat: VatData
}

function VatCard({ vat }: Readonly<VatCardProps>) {
  const { t, i18n } = useTranslation('financialDashboard')
  // Snapshot the clock once on mount so render stays idempotent.
  const [now] = useState(() => Date.now())
  const owes = vat.net_cents >= 0
  const due = new Date(`${vat.due_date}T00:00:00`)
  const daysUntilDue = Math.max(0, Math.ceil((due.getTime() - now) / 86400000))
  const dueLabel = due.toLocaleDateString(i18n.language, { month: 'long', day: 'numeric', year: 'numeric' })
  const breakdownValues = { output: formatEur(vat.output_cents), input: formatEur(vat.input_cents) }

  return (
    <DashboardCard title={t($ => $.vat.title)}>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Typography variant="caption" color="text.secondary">
            {t($ => $.vat.balanceWithTax)}
          </Typography>
          <Typography
            variant="h4"
            sx={{ fontWeight: 600, my: 0.5, color: owes ? 'error.main' : 'success.main' }}
          >
            {formatEur(Math.abs(vat.net_cents))}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t($ => $.vat.forPeriod, { quarter: vat.quarter, year: vat.year })}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Typography variant="caption" color="text.secondary">
            {t($ => $.vat.dueDate)}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5 }}>
            {t($ => $.vat.days, { count: daysUntilDue })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {dueLabel}
          </Typography>
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>
        {owes
          ? t($ => $.vat.oweBreakdown, breakdownValues)
          : t($ => $.vat.getBackBreakdown, breakdownValues)}
      </Typography>
    </DashboardCard>
  )
}
