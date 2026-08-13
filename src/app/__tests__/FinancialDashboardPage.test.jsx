import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../finance/ledger/ledger.ts', () => ({
  getLedgerOverview: vi.fn(),
  listLedgerPeriods: vi.fn(),
}))
vi.mock('../../components/shared/periodPicker.tsx', () => ({
  default: ({ value, onChange }) => (
    <button onClick={() => onChange({ mode: 'quarter', year: 2026, quarter: 2 })}>
      {`FY ${value.year ?? ''}`}
    </button>
  ),
}))
// jsdom can't size SVG charts; the container stub exposes the series so we
// assert the data wiring. The plot/axis children render via chart context the
// stub doesn't provide, so they are stubbed out too.
vi.mock('@mui/x-charts/ChartsContainer', () => ({
  ChartsContainer: ({ series, xAxis, children }) => (
    <div
      data-testid="result-chart"
      data-series={JSON.stringify(series.map((s) => ({ type: s.type, label: s.label, data: s.data })))}
      data-xaxis={JSON.stringify(xAxis?.[0]?.data ?? null)}
    >
      {children}
    </div>
  ),
}))
// Resolves a series' on-bar label as the chart would, for a segment of the
// given pixel width. Hoisted so the mock factory below can reach it.
const { barLabelOf } = vi.hoisted(() => ({
  barLabelOf: (series, barWidth) => series.barLabel(
    { seriesId: series.id, dataIndex: 0, value: series.data[0] },
    { bar: { width: barWidth, height: 24 } },
  ) ?? null,
}))

vi.mock('@mui/x-charts/BarChart', () => ({
  BarPlot: () => null,
  // The split bars (open invoices, upcoming fees): expose each segment's
  // identity, value, colour and stack, plus the formatted tooltip, so the wiring
  // is assertable without a layout (jsdom gives the chart no size). The stack id
  // names the bar, since a card renders at most one.
  BarChart: ({ series, layout }) => (
    <div
      data-testid={`split-bar-${series[0].stack}`}
      data-layout={layout}
      data-series={JSON.stringify(
        series.map((s) => ({ id: s.id, label: s.label, value: s.data[0], color: s.color, stack: s.stack })),
      )}
      data-tooltips={JSON.stringify(series.map((s) => s.valueFormatter(s.data[0], { dataIndex: 0 })))}
      // The on-bar labels, resolved against a segment wide enough to hold them
      // and against one that is not — the fit rule is the interesting part.
      data-labels-wide={JSON.stringify(series.map((s) => barLabelOf(s, 400)))}
      data-labels-narrow={JSON.stringify(series.map((s) => barLabelOf(s, 12)))}
    />
  ),
}))
vi.mock('@mui/x-charts/LineChart', () => ({
  LinePlot: () => null,
  // High-level chart used by the result-trend card; expose its series, x-axis
  // and the y-axis min/max (the zero-anchored bounds).
  LineChart: ({ series, xAxis, yAxis }) => (
    <div
      data-testid="result-trend-chart"
      data-series={JSON.stringify(series.map((s) => s.data))}
      data-xaxis={JSON.stringify(xAxis?.[0]?.data ?? null)}
      data-ymin={JSON.stringify(yAxis?.[0]?.min ?? null)}
      data-ymax={JSON.stringify(yAxis?.[0]?.max ?? null)}
    />
  ),
}))
// The merch revenue pie: expose each slice's label, value and assigned colour so
// the legend wiring and the slot-order palette are assertable without a layout.
vi.mock('@mui/x-charts/PieChart', () => ({
  PieChart: ({ series }) => (
    <div
      data-testid="merch-pie"
      data-slices={JSON.stringify(series[0].data.map((d) => ({ label: d.label, value: d.value, color: d.color })))}
    />
  ),
}))
vi.mock('@mui/x-charts/ChartsXAxis', () => ({ ChartsXAxis: () => null }))
vi.mock('@mui/x-charts/ChartsYAxis', () => ({ ChartsYAxis: () => null }))
vi.mock('@mui/x-charts/ChartsAxisHighlight', () => ({ ChartsAxisHighlight: () => null }))
vi.mock('@mui/x-charts/ChartsGrid', () => ({ ChartsGrid: () => null }))
vi.mock('../../finance/reports/components/ResultChartTooltip.tsx', () => ({ default: () => null }))

import { getLedgerOverview, listLedgerPeriods } from '../../finance/ledger/ledger.ts'
import FinancialDashboardPage from '../../finance/reports/FinancialDashboardPage.tsx'
import i18n from '../../i18n/index.ts'
import theme from '../../theme.ts'

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  key: `2026-${String(i + 1).padStart(2, '0')}`,
  year: 2026,
  month: i + 1,
  revenue_cents: 0,
  expense_cents: 0,
  result_cents: 0,
}))
MONTHS[5] = { key: '2026-06', year: 2026, month: 6, revenue_cents: 100000, expense_cents: 2066, result_cents: 97934 }

const OVERVIEW = {
  currency: 'EUR',
  months: MONTHS,
  totals: { revenue_cents: 100000, expense_cents: 2066, result_cents: 97934 },
  annual_results: [
    { year: 2024, has_data: true, revenue_cents: 50000, expense_cents: 10000, result_cents: 40000 },
    { year: 2025, has_data: true, revenue_cents: 80000, expense_cents: 20000, result_cents: 60000 },
    { year: 2026, has_data: true, revenue_cents: 100000, expense_cents: 2066, result_cents: 97934 },
  ],
  bank: { balance_cents: 118500 },
  vat: { year: 2026, quarter: 2, due_date: '2026-07-31', output_cents: 21000, input_cents: 434, net_cents: 20566 },
  invoices: {
    overdue: { count: 1, total_cents: 12100 },
    unpaid: { count: 2, total_cents: 242000 },
    draft: { count: 1, total_cents: 50000 },
  },
  merch: {
    revenue_cents: 6000,
    cogs_cents: 2400,
    gross_profit_cents: 3600,
    inventory_value_cents: 9600,
    revenue_by_product: [
      { kind: 'product', product_id: 1, name: 'Tour shirt', revenue_cents: 4000 },
      { kind: 'product', product_id: 2, name: 'Vinyl', revenue_cents: 1500 },
      { kind: 'unattributed', product_id: null, name: null, revenue_cents: 500 },
    ],
  },
  upcoming_fees: {
    total_cents: 450000,
    gig_count: 3,
    by_status: {
      option: { count: 1, total_cents: 100000 },
      confirmed: { count: 1, total_cents: 250000 },
      announced: { count: 1, total_cents: 100000 },
    },
  },
}

function wrap(ui) {
  return render(
    <MemoryRouter initialEntries={['/financial']}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/financial" element={ui} />
          <Route path="/invoices" element={<div>invoices-route</div>} />
          <Route path="/vat-returns" element={<div>vat-returns-route</div>} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'))
  getLedgerOverview.mockResolvedValue(OVERVIEW)
  listLedgerPeriods.mockResolvedValue(['2026-06-09', '2025-03-01'])
})

afterEach(async () => {
  vi.useRealTimers()
  vi.clearAllMocks()
  // Restore the suite-wide English pin (setup.js) after any per-test switch.
  await i18n.changeLanguage('en')
})

describe('FinancialDashboardPage', () => {
  it('renders the heading and fetches the default fiscal-year period', async () => {
    wrap(<FinancialDashboardPage />)
    expect(screen.getByRole('heading', { name: /financial/i })).toBeInTheDocument()
    await waitFor(() => expect(getLedgerOverview).toHaveBeenCalledWith({ mode: 'fiscal_year', year: 2026 }))
    expect(await screen.findByText(/result in eur/i)).toBeInTheDocument()
  })

  it('shows the period totals for revenue, expenses and result', async () => {
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const resultCard = screen.getByText(/result in eur/i).closest('[data-card]')
    expect(within(resultCard).getByText(/€\s?1\.000,00/)).toBeInTheDocument()
    expect(within(resultCard).getByText(/€\s?-20,66|-\s?€\s?20,66/)).toBeInTheDocument()
    expect(within(resultCard).getByText(/€\s?979,34/)).toBeInTheDocument()
  })

  it('feeds revenue/expense bars and a result line (in euros) to the chart', async () => {
    wrap(<FinancialDashboardPage />)
    const chart = await screen.findByTestId('result-chart')

    const series = JSON.parse(chart.dataset.series)
    expect(series.map((s) => [s.type, s.label])).toEqual([
      ['bar', 'Revenue'],
      ['bar', 'Expenses'],
      ['line', 'Result'],
    ])
    for (const s of series) expect(s.data).toHaveLength(12)
    expect(series[0].data[5]).toBe(1000)
    expect(series[1].data[5]).toBe(-20.66)
    expect(series[2].data[5]).toBe(979.34)

    const labels = JSON.parse(chart.dataset.xaxis)
    expect(labels).toHaveLength(12)
    expect(labels[5]).toBe('Jun')
  })

  it('renders the overview rows with labels above proportional bars', async () => {
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^overview$/i).closest('[data-card]')
    expect(within(card).getByText('Income')).toBeInTheDocument()
    expect(within(card).getByText(/€\s?1\.000,00/)).toBeInTheDocument()
    expect(within(card).getByText('Expenses')).toBeInTheDocument()
    expect(within(card).getByText(/€\s?20,66/)).toBeInTheDocument()
    expect(within(card).getByText('Profit')).toBeInTheDocument()
    expect(within(card).getByText(/€\s?979,34/)).toBeInTheDocument()
  })

  it('feeds the yearly result (in euros) and years to the result-trend chart', async () => {
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/result trend/i).closest('[data-card]')
    const chart = within(card).getByTestId('result-trend-chart')
    expect(JSON.parse(chart.dataset.series)).toEqual([[400, 600, 979.34]])
    expect(JSON.parse(chart.dataset.xaxis)).toEqual(['2024', '2025', '2026'])
  })

  it('renders a gap (null) for a year with no ledger activity', async () => {
    getLedgerOverview.mockResolvedValue({
      ...OVERVIEW,
      annual_results: [
        { year: 2024, has_data: false, revenue_cents: 0, expense_cents: 0, result_cents: 0 },
        { year: 2025, has_data: true, revenue_cents: 80000, expense_cents: 20000, result_cents: 60000 },
        { year: 2026, has_data: true, revenue_cents: 100000, expense_cents: 2066, result_cents: 97934 },
      ],
    })
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/result trend/i).closest('[data-card]')
    const chart = within(card).getByTestId('result-trend-chart')
    // The empty year is null (skipped point / broken line); 0 stays out of the data.
    expect(JSON.parse(chart.dataset.series)).toEqual([[null, 600, 979.34]])
    // The y-axis ignores the empty year when anchoring to 0.
    expect(JSON.parse(chart.dataset.ymin)).toBe(0)
    expect(JSON.parse(chart.dataset.ymax)).toBe(979.34)
  })

  it('anchors the trend y-axis to 0 (above the line for an all-profit series)', async () => {
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/result trend/i).closest('[data-card]')
    const chart = within(card).getByTestId('result-trend-chart')
    expect(JSON.parse(chart.dataset.ymin)).toBe(0)
    expect(JSON.parse(chart.dataset.ymax)).toBe(979.34)
  })

  it('extends the trend y-axis below 0 for a loss year', async () => {
    getLedgerOverview.mockResolvedValue({
      ...OVERVIEW,
      annual_results: [
        { year: 2024, has_data: true, revenue_cents: 10000, expense_cents: 50000, result_cents: -40000 },
        { year: 2025, has_data: true, revenue_cents: 80000, expense_cents: 20000, result_cents: 60000 },
        { year: 2026, has_data: true, revenue_cents: 100000, expense_cents: 2066, result_cents: 97934 },
      ],
    })
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/result trend/i).closest('[data-card]')
    const chart = within(card).getByTestId('result-trend-chart')
    expect(JSON.parse(chart.dataset.ymin)).toBe(-400)
    expect(JSON.parse(chart.dataset.ymax)).toBe(979.34)
  })

  it('shows the bank balance derived from the ledger', async () => {
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^overview$/i).closest('[data-card]')
    expect(within(card).getByText(/bank balance/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?1\.185,00/)).toBeInTheDocument()
  })

  it('headlines the open total and links to invoices', async () => {
    const user = userEvent.setup()
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^invoices$/i).closest('[data-card]')
    // 121,00 + 2.420,00 + 500,00 open across the three buckets.
    expect(within(card).getByText(/^open amount$/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?3\.041,00/)).toBeInTheDocument()

    await user.click(within(card).getByRole('link', { name: /create invoice/i }))
    expect(screen.getByText('invoices-route')).toBeInTheDocument()
  })

  it('divides the open total over one horizontal stacked bar', async () => {
    wrap(<FinancialDashboardPage />)
    const bar = await screen.findByTestId('split-bar-open')

    expect(bar.dataset.layout).toBe('horizontal')
    // Fixed slot order, one shared stack, values in euros, status colours. The
    // labels name each segment for the chart legend.
    expect(JSON.parse(bar.dataset.series)).toEqual([
      { id: 'overdue', label: 'Overdue', value: 121, color: theme.palette.error.main, stack: 'open' },
      { id: 'unpaid', label: 'Unpaid', value: 2420, color: theme.palette.warning.main, stack: 'open' },
      { id: 'draft', label: 'Draft', value: 500, color: theme.palette.info.main, stack: 'open' },
    ])
  })

  it('writes each amount on its own segment, and drops labels that would not fit', async () => {
    wrap(<FinancialDashboardPage />)
    const bar = await screen.findByTestId('split-bar-open')

    const wide = JSON.parse(bar.dataset.labelsWide)
    expect(wide[0]).toMatch(/€\s?121,00/)
    expect(wide[1]).toMatch(/€\s?2\.420,00/)
    expect(wide[2]).toMatch(/€\s?500,00/)
    // A 12px segment can't hold its amount, so it carries no label at all.
    expect(JSON.parse(bar.dataset.labelsNarrow)).toEqual([null, null, null])
  })

  it('carries the amount and invoice count into each segment tooltip', async () => {
    wrap(<FinancialDashboardPage />)
    const bar = await screen.findByTestId('split-bar-open')

    const tooltips = JSON.parse(bar.dataset.tooltips)
    expect(tooltips[0]).toMatch(/€\s?121,00\s·\s1 invoice$/)
    expect(tooltips[1]).toMatch(/€\s?2\.420,00\s·\s2 invoices$/)
    expect(tooltips[2]).toMatch(/€\s?500,00\s·\s1 invoice$/)
  })

  it('replaces the split bar with an empty state when nothing is open', async () => {
    getLedgerOverview.mockResolvedValue({
      ...OVERVIEW,
      invoices: {
        overdue: { count: 0, total_cents: 0 },
        unpaid: { count: 0, total_cents: 0 },
        draft: { count: 0, total_cents: 0 },
      },
    })
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^invoices$/i).closest('[data-card]')
    expect(within(card).getByText(/no open invoices/i)).toBeInTheDocument()
    expect(screen.queryByTestId('split-bar-open')).not.toBeInTheDocument()
  })

  it('shows the current-quarter VAT position and links to VAT returns', async () => {
    const user = userEvent.setup()
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^vat$/i).closest('[data-card]')
    // A positive net is money owed — the balance is painted red.
    expect(within(card).getByText(/€\s?205,66/)).toHaveStyle({ color: theme.palette.error.main })
    expect(within(card).getByText(/Q2 2026/)).toBeInTheDocument()
    expect(within(card).getByText(/50 days/i)).toBeInTheDocument()
    expect(within(card).getByText(/July 31, 2026/)).toBeInTheDocument()

    await user.click(within(card).getByRole('link', { name: /settle vat/i }))
    expect(screen.getByText('vat-returns-route')).toBeInTheDocument()
  })

  it('shows a receivable net VAT as a green absolute amount', async () => {
    getLedgerOverview.mockResolvedValue({
      ...OVERVIEW,
      vat: { ...OVERVIEW.vat, output_cents: 0, input_cents: 434, net_cents: -434 },
    })
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    // Money back: the sign lives in the colour, not in the figure.
    const card = screen.getByText(/^vat$/i).closest('[data-card]')
    expect(within(card).getByText(/€\s?4,34/)).toHaveStyle({ color: theme.palette.success.main })
  })

  it('uses the Dutch VAT settlement label', async () => {
    await i18n.changeLanguage('nl')
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/resultaat in eur/i)

    const card = screen.getByText(/^btw$/i).closest('[data-card]')
    expect(within(card).getByRole('link', { name: 'Btw afrekenen' })).toBeInTheDocument()
  })

  // The merch card is three labelled tiles: gross profit, margin, inventory
  // value. Renders the merch card for a given period slice and returns it.
  async function renderMerchCard(merch) {
    getLedgerOverview.mockResolvedValue({ ...OVERVIEW, merch })
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)
    return screen.getByText(/^merchandise$/i).closest('[data-card]')
  }

  it('shows the merch gross profit, margin and inventory value as separate tiles', async () => {
    const card = await renderMerchCard(OVERVIEW.merch)

    expect(within(card).getByText(/^gross profit$/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?36,00/)).toBeInTheDocument()
    // €60 revenue − €24 cost of goods → €36 profit, 60% margin.
    expect(within(card).getByText(/^margin$/i)).toBeInTheDocument()
    expect(within(card).getByText('60%')).toBeInTheDocument()
    expect(within(card).getByText(/^inventory value$/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?96,00/)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /manage merch/i })).toBeInTheDocument()
  })

  it('shows a negative gross profit and margin when merch sold at a loss', async () => {
    const card = await renderMerchCard({
      ...OVERVIEW.merch,
      cogs_cents: 9000,
      gross_profit_cents: -3000,
    })

    expect(within(card).getByText(/€\s?-30,00/)).toBeInTheDocument()
    expect(within(card).getByText('-50%')).toBeInTheDocument()
    // Inventory is a point-in-time asset balance — unaffected by the loss.
    expect(within(card).getByText(/€\s?96,00/)).toBeInTheDocument()
  })

  it('paints a losing gross profit red', async () => {
    const card = await renderMerchCard({ ...OVERVIEW.merch, gross_profit_cents: -3000 })
    expect(within(card).getByText(/€\s?-30,00/)).toHaveStyle({ color: theme.palette.error.main })
  })

  it('paints a positive gross profit green', async () => {
    const card = await renderMerchCard(OVERVIEW.merch)
    expect(within(card).getByText(/€\s?36,00/)).toHaveStyle({ color: theme.palette.success.main })
  })

  it.each([
    { label: 'thin margin', revenue_cents: 10000, gross_profit_cents: 500, expected: '5%' },
    { label: 'break-even', revenue_cents: 10000, gross_profit_cents: 0, expected: '0%' },
    { label: 'high margin', revenue_cents: 10000, gross_profit_cents: 8500, expected: '85%' },
    { label: 'full margin, no cost of goods', revenue_cents: 10000, gross_profit_cents: 10000, expected: '100%' },
    // 1111 / 3333 = 33.33…% → rounded to whole percent.
    { label: 'rounded', revenue_cents: 3333, gross_profit_cents: 1111, expected: '33%' },
  ])('shows a $label as $expected', async ({ revenue_cents, gross_profit_cents, expected }) => {
    const card = await renderMerchCard({
      revenue_cents,
      cogs_cents: revenue_cents - gross_profit_cents,
      gross_profit_cents,
      inventory_value_cents: 9600,
    })

    expect(within(card).getByText(expected)).toBeInTheDocument()
  })

  it('shows no margin when there was no merch revenue in the period', async () => {
    const card = await renderMerchCard({
      revenue_cents: 0,
      cogs_cents: 0,
      gross_profit_cents: 0,
      inventory_value_cents: 9600,
      revenue_by_product: [],
    })

    expect(within(card).getByText('N/A')).toBeInTheDocument()
    expect(within(card).queryByText('0%')).not.toBeInTheDocument()
    expect(within(card).getByText(/€\s?96,00/)).toBeInTheDocument()
  })

  it('charts where the merch revenue came from, per product', async () => {
    const card = await renderMerchCard(OVERVIEW.merch)

    expect(within(card).getByText(/sales by product/i)).toBeInTheDocument()
    const slices = JSON.parse(within(card).getByTestId('merch-pie').dataset.slices)
    expect(slices.map((s) => [s.label, s.value])).toEqual([
      ['Tour shirt', 4000],
      ['Vinyl', 1500],
      ['Unknown', 500],
    ])
  })

  it('paints the slices in fixed palette order, never cycling within a chart', async () => {
    const card = await renderMerchCard(OVERVIEW.merch)

    const slices = JSON.parse(within(card).getByTestId('merch-pie').dataset.slices)
    expect(slices.map((s) => s.color)).toEqual(['#2a78d6', '#eb6834', '#1baf7a'])
    expect(new Set(slices.map((s) => s.color)).size).toBe(slices.length)
  })

  it('labels the sales that trace back to no product as unknown', async () => {
    const card = await renderMerchCard({
      ...OVERVIEW.merch,
      revenue_by_product: [
        { kind: 'unattributed', product_id: null, name: null, revenue_cents: 6000 },
      ],
    })

    const slices = JSON.parse(within(card).getByTestId('merch-pie').dataset.slices)
    expect(slices).toEqual([expect.objectContaining({ label: 'Unknown', value: 6000 })])
  })

  it('labels the folded-up remainder as other, after the named products', async () => {
    const card = await renderMerchCard({
      ...OVERVIEW.merch,
      revenue_by_product: [
        { kind: 'product', product_id: 1, name: 'Tour shirt', revenue_cents: 4000 },
        { kind: 'other', product_id: null, name: null, revenue_cents: 1500 },
        { kind: 'unattributed', product_id: null, name: null, revenue_cents: 500 },
      ],
    })

    const slices = JSON.parse(within(card).getByTestId('merch-pie').dataset.slices)
    expect(slices.map((s) => s.label)).toEqual(['Tour shirt', 'Other', 'Unknown'])
  })

  it('uses the Dutch label for unattributed merch sales', async () => {
    await i18n.changeLanguage('nl')
    getLedgerOverview.mockResolvedValue(OVERVIEW)
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/resultaat in eur/i)

    const card = screen.getByText(/^merchandise$/i).closest('[data-card]')
    const slices = JSON.parse(within(card).getByTestId('merch-pie').dataset.slices)
    expect(slices.map((s) => s.label)).toEqual(['Tour shirt', 'Vinyl', 'Onbekend'])
  })

  it('omits the chart entirely when the period has no merch revenue to split', async () => {
    const card = await renderMerchCard({
      revenue_cents: 0,
      cogs_cents: 0,
      gross_profit_cents: 0,
      inventory_value_cents: 9600,
      revenue_by_product: [],
    })

    expect(within(card).queryByTestId('merch-pie')).not.toBeInTheDocument()
    expect(within(card).queryByText(/sales by product/i)).not.toBeInTheDocument()
  })

  it('shows the upcoming gross band fees with a per-status breakdown', async () => {
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^upcoming fees$/i).closest('[data-card]')
    expect(within(card).getByText(/gross band fees/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?4\.500,00/)).toBeInTheDocument()
    expect(within(card).getByText(/across 3 upcoming gigs/i)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /view gigs/i })).toBeInTheDocument()
  })

  it('divides the fee pipeline over one horizontal stacked bar', async () => {
    wrap(<FinancialDashboardPage />)
    const bar = await screen.findByTestId('split-bar-fees')

    expect(bar.dataset.layout).toBe('horizontal')
    // Most to least certain, one shared stack, values in euros.
    expect(JSON.parse(bar.dataset.series)).toEqual([
      { id: 'confirmed', label: 'Confirmed', value: 2500, color: theme.palette.success.main, stack: 'fees' },
      { id: 'announced', label: 'Announced', value: 1000, color: theme.palette.info.main, stack: 'fees' },
      { id: 'option', label: 'Option', value: 1000, color: theme.palette.warning.main, stack: 'fees' },
    ])
    expect(JSON.parse(bar.dataset.tooltips)[0]).toMatch(/€\s?2\.500,00\s·\s1 gig$/)
    expect(JSON.parse(bar.dataset.labelsWide)[0]).toMatch(/€\s?2\.500,00/)
  })

  it('shows a no-gigs hint when there are no upcoming fees', async () => {
    getLedgerOverview.mockResolvedValue({
      ...OVERVIEW,
      upcoming_fees: {
        total_cents: 0,
        gig_count: 0,
        by_status: {
          option: { count: 0, total_cents: 0 },
          confirmed: { count: 0, total_cents: 0 },
          announced: { count: 0, total_cents: 0 },
        },
      },
    })
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^upcoming fees$/i).closest('[data-card]')
    expect(within(card).getByText(/no upcoming gigs with a fee/i)).toBeInTheDocument()
    expect(screen.queryByTestId('split-bar-fees')).not.toBeInTheDocument()
  })

  it('refetches when another period is picked', async () => {
    const user = userEvent.setup()
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    await user.click(screen.getByRole('button', { name: /FY 2026/ }))

    await waitFor(() => expect(getLedgerOverview).toHaveBeenCalledWith({ mode: 'quarter', year: 2026, quarter: 2 }))
  })

  it('shows an error message when loading fails', async () => {
    getLedgerOverview.mockRejectedValue(new Error('boom'))
    wrap(<FinancialDashboardPage />)
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
  })

  it('renders the Dutch translations when the language is nl', async () => {
    await i18n.changeLanguage('nl')
    wrap(<FinancialDashboardPage />)

    expect(screen.getByRole('heading', { name: /financieel/i })).toBeInTheDocument()
    expect(await screen.findByText(/resultaat in eur/i)).toBeInTheDocument()
    expect(screen.getByText(/^overzicht$/i)).toBeInTheDocument()
    expect(screen.getByText(/banksaldo/i)).toBeInTheDocument()
    expect(screen.getByText(/^facturen$/i)).toBeInTheDocument()
    // Plural picked from count (3 → _other).
    expect(screen.getByText(/verdeeld over 3 aankomende optredens/i)).toBeInTheDocument()
    expect(screen.getByText(/saldo bij de belastingdienst/i)).toBeInTheDocument()
  })
})
