import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/ledger.ts', () => ({
  getLedgerOverview: vi.fn(),
  listLedgerPeriods: vi.fn(),
}))
vi.mock('../components/shared/periodPicker.tsx', () => ({
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
vi.mock('@mui/x-charts/BarChart', () => ({ BarPlot: () => null }))
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
vi.mock('@mui/x-charts/ChartsXAxis', () => ({ ChartsXAxis: () => null }))
vi.mock('@mui/x-charts/ChartsYAxis', () => ({ ChartsYAxis: () => null }))
vi.mock('@mui/x-charts/ChartsAxisHighlight', () => ({ ChartsAxisHighlight: () => null }))
vi.mock('@mui/x-charts/ChartsGrid', () => ({ ChartsGrid: () => null }))
vi.mock('../components/financial/ResultChartTooltip.tsx', () => ({ default: () => null }))

import { getLedgerOverview, listLedgerPeriods } from '../api/ledger.ts'
import FinancialDashboardPage from '../pages/FinancialDashboardPage.tsx'
import theme from '../theme.ts'

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

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
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

  it('shows the open invoice buckets and links to invoices', async () => {
    const user = userEvent.setup()
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^invoices$/i).closest('[data-card]')
    expect(within(card).getByText(/overdue/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?121,00/)).toBeInTheDocument()
    expect(within(card).getByText(/unpaid/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?2\.420,00/)).toBeInTheDocument()
    expect(within(card).getByText(/draft/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?500,00/)).toBeInTheDocument()

    await user.click(within(card).getByRole('link', { name: /create invoice/i }))
    expect(screen.getByText('invoices-route')).toBeInTheDocument()
  })

  it('shows the current-quarter VAT position with due-date countdown', async () => {
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^vat$/i).closest('[data-card]')
    expect(within(card).getByText(/€\s?205,66/)).toBeInTheDocument()
    expect(within(card).getByText(/Q2 2026/)).toBeInTheDocument()
    expect(within(card).getByText(/you owe tax/i)).toBeInTheDocument()
    expect(within(card).getByText(/50 days/i)).toBeInTheDocument()
    expect(within(card).getByText(/July 31, 2026/)).toBeInTheDocument()
  })

  it('shows a "get money back" hint when net VAT is negative', async () => {
    getLedgerOverview.mockResolvedValue({
      ...OVERVIEW,
      vat: { ...OVERVIEW.vat, output_cents: 0, input_cents: 434, net_cents: -434 },
    })
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^vat$/i).closest('[data-card]')
    expect(within(card).getByText(/you get money back/i)).toBeInTheDocument()
  })

  it('shows the merch gross profit, margin, revenue share and inventory value', async () => {
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^merchandise$/i).closest('[data-card]')
    expect(within(card).getByText(/€\s?36,00/)).toBeInTheDocument()
    expect(within(card).getByText(/60% margin on sales/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?96,00/)).toBeInTheDocument()
    // €60 of €1.000 total revenue → 6%.
    expect(within(card).getByText(/6% of total revenue/)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /manage merch/i })).toBeInTheDocument()
  })

  it('shows a no-sales hint when there is no merch revenue in the period', async () => {
    getLedgerOverview.mockResolvedValue({
      ...OVERVIEW,
      merch: { revenue_cents: 0, cogs_cents: 0, gross_profit_cents: 0, inventory_value_cents: 9600 },
    })
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^merchandise$/i).closest('[data-card]')
    expect(within(card).getByText(/no merch sales in this period/i)).toBeInTheDocument()
  })

  it('shows the upcoming gross band fees with a per-status breakdown', async () => {
    wrap(<FinancialDashboardPage />)
    await screen.findByText(/result in eur/i)

    const card = screen.getByText(/^upcoming fees$/i).closest('[data-card]')
    expect(within(card).getByText(/gross band fees/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?4\.500,00/)).toBeInTheDocument()
    expect(within(card).getByText(/across 3 upcoming gigs/i)).toBeInTheDocument()
    expect(within(card).getByText(/confirmed \(1\)/i)).toBeInTheDocument()
    expect(within(card).getByText(/€\s?2\.500,00/)).toBeInTheDocument()
    expect(within(card).getByText(/announced \(1\)/i)).toBeInTheDocument()
    expect(within(card).getByText(/option \(1\)/i)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /view gigs/i })).toBeInTheDocument()
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
})
