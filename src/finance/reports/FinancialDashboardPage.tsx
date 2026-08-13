import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import DashboardCard from '../../app/dashboard/components/DashboardCard.tsx'
import MasonryLayout from '../../components/shared/MasonryLayout.tsx'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import AddOutlined from '@mui/icons-material/AddOutlined'
import { ChartsContainer } from '@mui/x-charts/ChartsContainer'
import { BarChart, BarPlot } from '@mui/x-charts/BarChart'
import { LineChart, LinePlot } from '@mui/x-charts/LineChart'
import { PieChart } from '@mui/x-charts/PieChart'
import { ChartsXAxis } from '@mui/x-charts/ChartsXAxis'
import { ChartsYAxis } from '@mui/x-charts/ChartsYAxis'
import { ChartsAxisHighlight } from '@mui/x-charts/ChartsAxisHighlight'
import { ChartsGrid } from '@mui/x-charts/ChartsGrid'
import ResultChartTooltip from './components/ResultChartTooltip.tsx'
import PeriodPicker from '../../components/shared/periodPicker.tsx'
import FinanceReadOnlyBanner from '../../components/FinanceReadOnlyBanner.tsx'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { getLedgerOverview, listLedgerPeriods } from '../ledger/ledger.ts'
import { formatEur } from '../invoices/invoiceTotals.ts'
import { defaultPeriodForDates } from '../invoices/invoicePeriod.ts'
import useFiscalYearStart from '../shared/useFiscalYearStart.ts'
import type { Period } from '../../types/entities.ts'

interface Totals {
  revenue_cents: number
  expense_cents: number
  result_cents: number
}

interface MonthData {
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
  net_cents: number
}

interface BankData {
  balance_cents: number
}

interface AnnualResult {
  year: number
  has_data: boolean
  result_cents: number
}

// One slice of the merch revenue split. `kind` is the discriminator: a named
// product, the fold-up of the remaining products, or revenue on a merch account
// that traces back to no product (Shopify shipping lines, manual journals).
interface MerchRevenueBucket {
  kind: 'product' | 'other' | 'unattributed'
  product_id: number | null
  name: string | null
  revenue_cents: number
}

interface MerchData {
  revenue_cents: number
  gross_profit_cents: number
  inventory_value_cents: number
  revenue_by_product?: MerchRevenueBucket[]
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
  const fiscalYearStart = useFiscalYearStart()
  const { t } = useTranslation('financialDashboard')
  const isCompact = useCompactLayout()
  const [period, setPeriod] = useState<Period>(() => defaultPeriodForDates([], fiscalYearStart))
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestKey = JSON.stringify(period)
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null)
  const loading = !periodsLoaded || loadedRequestKey !== requestKey
  const visibleError = !periodsLoaded || loadedRequestKey === requestKey ? error : null

  useEffect(() => {
    let cancelled = false
    listLedgerPeriods()
      .then((dates) => {
        if (cancelled) return
        const dateStrings = dates.filter(Boolean)
        setAvailableDates(dateStrings)
        setPeriod((prev) => {
          const currentYear = defaultPeriodForDates([], fiscalYearStart).year
          if (prev.mode !== 'fiscal_year' || prev.year !== currentYear) return prev
          return defaultPeriodForDates(dateStrings, fiscalYearStart)
        })
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setPeriodsLoaded(true) })
    return () => { cancelled = true }
  }, [fiscalYearStart])

  useEffect(() => {
    if (!periodsLoaded) return
    let cancelled = false
    getLedgerOverview(period)
      .then((overview) => {
        if (cancelled) return
        setData(overview as OverviewData)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => { if (!cancelled) setLoadedRequestKey(requestKey) })
    return () => { cancelled = true }
  }, [period, periodsLoaded, requestKey])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flex: 1 }}>
          {t($ => $.title)}
        </Typography>
        <PeriodPicker availableDates={availableDates} value={period} onChange={setPeriod} />
      </Box>

      <FinanceReadOnlyBanner />

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {visibleError && (
        <Typography color="error" sx={{ mb: 2 }}>{visibleError}</Typography>
      )}

      {!loading && !visibleError && data && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: isCompact ? 1.5 : 2 }}>
          {/* The result chart stays full-width above the masonry — it's a wide
              time-series that would be cramped inside a single column. */}
          <ResultChartCard currency={data.currency} months={data.months} totals={data.totals} />
          <MasonryLayout columnWidth={360} spacing={isCompact ? 1.5 : 2}>
            <OverviewCard totals={data.totals} bank={data.bank} />
            <ResultsTrendCard currency={data.currency} annualResults={data.annual_results} />
            <InvoicesCard invoices={data.invoices} />
            <VatCard vat={data.vat} />
            <UpcomingFeesCard fees={data.upcoming_fees} />
            {data.merch && <MerchCard merch={data.merch} />}
          </MasonryLayout>
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
    <Stack>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box component="span" sx={{ color, fontWeight: 600 }}>
        {formatEur(cents)}
      </Box>
    </Stack>
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
    >
      <Stack direction="row" sx={{ justifyContent:"space-around" }}>
        <HeadlineStat label={t($ => $.resultCard.revenue)} cents={totals.revenue_cents} color={theme.palette.success.main} />
        <HeadlineStat label={t($ => $.resultCard.expenses)} cents={-totals.expense_cents} color={theme.palette.error.main} />
        <HeadlineStat label={t($ => $.resultCard.result)} cents={totals.result_cents} color={theme.palette.success.main} />
      </Stack>
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

// One segment of a split bar. `detail` is the already-translated count phrase
// ("2 invoices", "1 gig") that the tooltip carries now that the per-status text
// lines are gone; the bar itself owns the money formatting.
interface SplitSegment {
  id: string
  label: string
  color: string
  cents: number
  detail: string
}

interface StackedSplitBarProps {
  stackId: string
  segments: SplitSegment[]
}

// Enough room for a 24px bar plus the 2px surface gap that separates segments.
const SPLIT_BAR_HEIGHT_PX = 28

// Rough advance width of one character at the bar label's size, plus the room
// the label needs to clear the segment edges. A label that doesn't fit its own
// segment is dropped rather than clipped or spilled over its neighbour — the
// amount is still one hover away in the tooltip.
const LABEL_CHAR_PX = 7.5
const LABEL_PADDING_PX = 12

// How a total divides, as one horizontal stacked bar. Segments arrive in a fixed
// slot order and are never re-sorted by size, so a status keeps its colour and
// its place however the amounts move. The colours are status colours, not a
// categorical palette — the chart legend names every one of them, so identity is
// never carried by hue alone.
function StackedSplitBar({ stackId, segments }: Readonly<StackedSplitBarProps>) {
  const theme = useTheme()
  return (
    /* Both axes are hidden: the figures are written on the segments themselves,
       so a scale would add nothing here. */
    <BarChart
      layout="horizontal"
      height={SPLIT_BAR_HEIGHT_PX}
      margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
      borderRadius={4}
      yAxis={[{ scaleType: 'band', data: [''], position: 'none', categoryGapRatio: 0.15 }]}
      xAxis={[{ position: 'none' }]}
      series={segments.map((segment) => ({
        id: segment.id,
        label: segment.label,
        data: [toEuros(segment.cents)],
        color: segment.color,
        stack: stackId,
        highlightScope: { fade: 'global', highlight: 'item' },
        valueFormatter: () => `${formatEur(segment.cents)} · ${segment.detail}`,
        barLabel: (_item, context) => {
          const label = formatEur(segment.cents)
          const fits = context.bar.width >= label.length * LABEL_CHAR_PX + LABEL_PADDING_PX
          return fits ? label : null
        },
      }))}
      slotProps={{
        // A 2px stroke in the surface colour straddles each segment edge, so
        // neighbours read as separate fills without relying on hue contrast.
        bar: { stroke: theme.palette.background.paper, strokeWidth: 2 },
        // The label sits on its own segment, so it takes that fill's contrast
        // colour rather than the page's ink.
        barLabel: (ownerState) => ({ fill: theme.palette.getContrastText(ownerState.color) }),
      }}
      sx={{ '& .MuiBarChart-label': { fontSize: '0.75rem', fontWeight: 600 } }}
    />
  )
}

interface InvoicesCardProps {
  invoices: InvoicesData
}

const INVOICE_SEGMENTS: { key: keyof InvoicesData; color: 'error' | 'warning' | 'info' }[] = [
  { key: 'overdue', color: 'error' },
  { key: 'unpaid', color: 'warning' },
  { key: 'draft', color: 'info' },
]

function InvoicesCard({ invoices }: Readonly<InvoicesCardProps>) {
  const { t } = useTranslation('financialDashboard')
  const theme = useTheme()
  const totalCents = INVOICE_SEGMENTS.reduce((sum, { key }) => sum + invoices[key].total_cents, 0)
  const segments = INVOICE_SEGMENTS.map(({ key, color }) => ({
    id: key,
    label: t($ => $.invoices[key]),
    color: theme.palette[color].main,
    cents: invoices[key].total_cents,
    detail: t($ => $.invoices.count, { count: invoices[key].count }),
  }))

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
      <Typography variant="caption" color="text.secondary">{t($ => $.invoices.openTotal)}</Typography>
      <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5 }}>{formatEur(totalCents)}</Typography>
      {totalCents <= 0
        ? <Typography variant="body2" color="text.secondary">{t($ => $.invoices.noOpen)}</Typography>
        : <StackedSplitBar stackId="open" segments={segments} />}
    </DashboardCard>
  )
}

// Categorical slots for the merch revenue split, assigned in fixed order and
// never cycled — the fold to "other" upstream keeps the slice count inside the
// palette. Both columns are validated against their own surface (adjacent-pair
// CVD and normal-vision separation), so dark is a selected set, not a flip.
const MERCH_SLICE_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
}

// Where the period's merch revenue came from. Slices arrive pre-sorted and
// pre-folded from the API; this only labels them and paints them in slot order.
interface MerchRevenuePieProps {
  buckets: MerchRevenueBucket[]
}

function MerchRevenuePie({ buckets }: Readonly<MerchRevenuePieProps>) {
  const { t } = useTranslation('financialDashboard')
  const theme = useTheme()
  const colors = MERCH_SLICE_COLORS[theme.palette.mode === 'dark' ? 'dark' : 'light']

  const labelFor = (bucket: MerchRevenueBucket) => {
    if (bucket.kind === 'other') return t($ => $.merch.otherProducts)
    if (bucket.kind === 'unattributed') return t($ => $.merch.unknownProduct)
    return bucket.name ?? t($ => $.merch.unknownProduct)
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary">{t($ => $.merch.salesByProduct)}</Typography>
      <PieChart
        height={180}
        series={[{
          data: buckets.map((bucket, index) => ({
            id: `${bucket.kind}-${bucket.product_id ?? index}`,
            value: bucket.revenue_cents,
            label: labelFor(bucket),
            color: colors[index % colors.length],
          })),
          // A donut with a 2px gap between arcs: the surface shows through, so
          // neighbouring slices stay separable without relying on hue alone.
          innerRadius: 34,
          paddingAngle: 2,
          cornerRadius: 4,
          highlightScope: { fade: 'global', highlight: 'item' },
          valueFormatter: (item) => formatEur(item.value),
        }]}
        slotProps={{ legend: { direction: 'vertical', sx: { gap: 0.5 } } }}
        sx={{ mt: 1 }}
      />
    </Box>
  )
}

// Merch gross-margin panel: the gross profit and margin on revenue/COGS within
// the selected period, plus the current stock value (a point-in-time asset
// balance, independent of the period).
interface MerchCardProps {
  merch: MerchData
}

function MerchCard({ merch }: Readonly<MerchCardProps>) {
  const { t } = useTranslation('financialDashboard')
  const marginPct = merch.revenue_cents > 0
    ? Math.round((merch.gross_profit_cents / merch.revenue_cents) * 100)
    : null
  const buckets = merch.revenue_by_product ?? []

  return (
    <DashboardCard
      title={t($ => $.merch.title)}
      action={(
        <Button component={RouterLink} to="/merch" size="small" variant="outlined">
          {t($ => $.merch.manage)}
        </Button>
      )}
    >
      {buckets.length > 0 && <MerchRevenuePie buckets={buckets} />}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography variant="caption" color="text.secondary">{t($ => $.merch.grossProfit)}</Typography>
          <Typography
            variant="h4"
            sx={{
              fontWeight: 600,
              my: 0.5,
              color: merch.gross_profit_cents < 0 ? 'error.main' : 'success.main',
            }}
          >
            {formatEur(merch.gross_profit_cents)}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography variant="caption" color="text.secondary">{t($ => $.merch.margin)}</Typography>
          <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5 }}>
            {marginPct === null ? t($ => $.merch.noMargin) : `${marginPct}%`}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography variant="caption" color="text.secondary">{t($ => $.merch.inventoryValue)}</Typography>
          <Typography variant="h4" sx={{ fontWeight: 600, my: 0.5 }}>
            {formatEur(merch.inventory_value_cents)}
          </Typography>
        </Box>
      </Box>
    </DashboardCard>
  )
}

// Upcoming gross band-fee pipeline: a headline total across all future gigs in
// the active statuses, split by status in the bar. Pinned to "today" (like
// VAT/bank), independent of the selected period.
interface UpcomingFeesCardProps {
  fees: UpcomingFeesData
}

// Slot order runs most to least certain, so the pipeline reads left to right.
const FEE_STATUS_META: { key: keyof UpcomingFeesData['by_status']; color: 'success' | 'info' | 'warning' }[] = [
  { key: 'confirmed', color: 'success' },
  { key: 'announced', color: 'info' },
  { key: 'option', color: 'warning' },
]

function UpcomingFeesCard({ fees }: Readonly<UpcomingFeesCardProps>) {
  const { t } = useTranslation('financialDashboard')
  const theme = useTheme()
  const segments = FEE_STATUS_META.map(({ key, color }) => ({
    id: key,
    label: t($ => $.upcomingFees[key]),
    color: theme.palette[color].main,
    cents: fees.by_status[key].total_cents,
    detail: t($ => $.upcomingFees.gigCount, { count: fees.by_status[key].count }),
  }))

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
      {fees.total_cents > 0 && (
        <Box sx={{ mt: 2 }}>
          <StackedSplitBar stackId="fees" segments={segments} />
        </Box>
      )}
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

  return (
    <DashboardCard
      title={t($ => $.vat.title)}
      action={(
        <Button component={RouterLink} to="/vat-returns" size="small" variant="outlined">
          {t($ => $.vat.settle)}
        </Button>
      )}
    >
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
    </DashboardCard>
  )
}
