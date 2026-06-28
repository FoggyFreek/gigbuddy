import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n/index.ts'

vi.mock('../api/ledger.ts', () => ({
  listLedgerPeriods: vi.fn(),
  getFinancialReport: vi.fn(),
  exportFinancialReport: vi.fn(),
}))

import { listLedgerPeriods, getFinancialReport, exportFinancialReport } from '../api/ledger.ts'
import ReportsPage from '../pages/ReportsPage.tsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'

const theme = createTheme()

function wrap(ui, { compact = false } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <CompactLayoutContext.Provider value={compact}>{ui}</CompactLayoutContext.Provider>
    </ThemeProvider>,
  )
}

function reportFixture() {
  return {
    currency: 'EUR',
    period: { from: '2026-01-01', to: '2026-12-31' },
    profit_loss: {
      revenue: [{ code: '41000', name: 'Gig fees', amount_cents: 100000 }],
      cost_of_goods_sold: [],
      expenses: [{ code: '62100', name: 'Instruments & Equipment', amount_cents: 2066 }],
      totals: {
        revenue_cents: 100000,
        cogs_cents: 0,
        gross_profit_cents: 100000,
        expense_cents: 2066,
        result_cents: 97934,
      },
    },
    balance_sheet: {
      as_of: '2026-12-31',
      assets: [{ code: '11200', name: 'Accounts Receivable', amount_cents: 121000 }],
      liabilities: [{ code: '24000', name: 'Sales Tax / VAT Payable', amount_cents: 21000 }],
      equity: [],
      unallocated_result_cents: 97934,
      totals: {
        assets_cents: 121434,
        liabilities_cents: 23500,
        equity_cents: 97934,
        liabilities_and_equity_cents: 121434,
      },
    },
    vat: { output_cents: 21000, input_cents: 434, net_cents: 20566 },
    trial_balance: {
      rows: [
        { code: '11200', name: 'Accounts Receivable', type: 'asset', debit_cents: 121000, credit_cents: 0 },
        { code: '41000', name: 'Gig fees', type: 'revenue', debit_cents: 0, credit_cents: 100000 },
      ],
      totals: { debit_cents: 121000, credit_cents: 121000 },
    },
  }
}

function mockHappyPath() {
  listLedgerPeriods.mockResolvedValue(['2026-02-10'])
  getFinancialReport.mockResolvedValue(reportFixture())
}

afterEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

describe('ReportsPage', () => {
  it('loads and renders the report sections for the period', async () => {
    mockHappyPath()
    wrap(<ReportsPage />)

    await waitFor(() => expect(getFinancialReport).toHaveBeenCalledWith({ mode: 'fiscal_year', year: 2026 }))
    expect(screen.getAllByRole('table')).toHaveLength(4)

    // Account rows appear in both the P&L/balance sheet and the trial balance;
    // the code renders as a separate monospace tag before the name.
    expect(screen.getAllByText('41000')).toHaveLength(2)
    expect(screen.getAllByText('Gig fees')).toHaveLength(2)
    expect(screen.getByText('62100')).toBeInTheDocument()
    expect(screen.getByText('Instruments & Equipment')).toBeInTheDocument()
    expect(screen.getAllByText('11200')).toHaveLength(2)
  })

  it('exports the report as xlsx and pdf via download', async () => {
    mockHappyPath()
    exportFinancialReport.mockResolvedValue(new Blob(['x']))
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const user = userEvent.setup()
    wrap(<ReportsPage />)
    await waitFor(() => expect(getFinancialReport).toHaveBeenCalledTimes(1))

    await user.click(screen.getByTestId('GridOnOutlinedIcon').closest('button'))
    await waitFor(() => expect(exportFinancialReport).toHaveBeenCalledWith(
      { mode: 'fiscal_year', year: 2026 }, 'xlsx',
    ))

    await user.click(screen.getByTestId('PictureAsPdfOutlinedIcon').closest('button'))
    await waitFor(() => expect(exportFinancialReport).toHaveBeenCalledWith(
      { mode: 'fiscal_year', year: 2026 }, 'pdf',
    ))

    expect(clickSpy).toHaveBeenCalledTimes(2)
    clickSpy.mockRestore()
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

  it('stacks the trial balance account above its amounts in compact layout', async () => {
    mockHappyPath()
    wrap(<ReportsPage />, { compact: true })
    await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(4))

    // The compact trial balance drops the Account column header; the account
    // cell spans both amount columns on its own row.
    expect(screen.getAllByRole('table')[3].querySelectorAll('thead th')).toHaveLength(2)
    const accountCell = screen.getAllByText('Gig fees')
      .map((el) => el.closest('td'))
      .find((td) => td?.getAttribute('colspan') === '2')
    expect(accountCell).toBeTruthy()
  })

  it('shows an error when the report fails to load', async () => {
    listLedgerPeriods.mockResolvedValue([])
    getFinancialReport.mockRejectedValue(new Error('report exploded'))
    wrap(<ReportsPage />)

    await waitFor(() => expect(screen.getByText('report exploded')).toBeInTheDocument())
  })

  it('updates visible report copy without reloading data when the language changes', async () => {
    mockHappyPath()
    wrap(<ReportsPage />)

    await waitFor(() => expect(getFinancialReport).toHaveBeenCalledTimes(1))
    const heading = screen.getByRole('heading', { level: 5 })
    const initialTitle = heading.textContent

    await act(async () => {
      await i18n.changeLanguage('nl')
    })

    await waitFor(() => expect(heading).not.toHaveTextContent(initialTitle))
    expect(getFinancialReport).toHaveBeenCalledTimes(1)
  })
})
