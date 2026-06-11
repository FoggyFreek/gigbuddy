import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/invoices.js', () => ({
  listInvoices: vi.fn(),
  listInvoicePeriods: vi.fn(),
}))
// Avoid rendering the full split-view router shell; InvoicesPage still needs
// useNavigate / useParams so we keep MemoryRouter.
vi.mock('../components/SplitView.jsx', () => ({
  default: ({ children }) => <>{children}</>,
}))
vi.mock('../components/NewInvoiceDialog.jsx', () => ({
  default: ({ onClose }) => <button onClick={onClose}>close-new-dialog</button>,
}))
vi.mock('../components/shared/periodPicker.jsx', () => ({
  default: ({ value, onChange }) => (
    <button onClick={() => onChange({ mode: 'month', year: 2026, month: 2 })}>
      {`FY ${value.year ?? ''}`}
    </button>
  ),
}))

import { listInvoicePeriods, listInvoices } from '../api/invoices.js'
import InvoicesPage from '../pages/InvoicesPage.jsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.js'
import theme from '../theme.js'

// Fix "today" to 2026-06-08 noon UTC so date comparisons are deterministic.
// We fake only Date (not setTimeout/setInterval) so waitFor still works.
const FIXED_NOW = new Date('2026-06-08T12:00:00.000Z')

// All invoice dates are mid-year (not Jan 1) to avoid UTC-midnight timezone
// rollover flipping the local year.
// Invoice 2 (overdue): issue_date 2026-01-15, payment_term_days 1 → due 2026-01-16
//   → today (Jun 8) > Jan 16 → overdue.
// Invoice 3 (unpaid): issue_date 2026-06-08, payment_term_days 99999
//   → due far in the future → unpaid.
// Note: payment_term_days=0 would default to 14 via `0 || 14`, so we use 1 for overdue.
const INVOICES = [
  { id: 1, invoice_number: '2026-0001', status: 'draft', issue_date: '2026-03-01', payment_term_days: 14,    customer_name: 'Alpha BV',  total_cents: 10000 },
  { id: 2, invoice_number: '2026-0002', status: 'sent',  issue_date: '2026-01-15', payment_term_days: 1,     customer_name: 'Beta Corp', total_cents: 20000 },
  { id: 3, invoice_number: '2026-0003', status: 'sent',  issue_date: '2026-06-08', payment_term_days: 99999, customer_name: 'Gamma Ltd', total_cents: 30000 },
  { id: 4, invoice_number: '2026-0004', status: 'paid',  issue_date: '2026-03-01', payment_term_days: 14,    customer_name: 'Delta Inc', total_cents: 40000 },
  { id: 5, invoice_number: '2026-0005', status: 'void',  issue_date: '2026-03-01', payment_term_days: 14,    customer_name: 'Void BV',   total_cents: 5000  },
]

function wrap(ui, { compact = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/invoices']}>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>
          {ui}
        </CompactLayoutContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // Fake only the Date constructor; setTimeout/setInterval stay real so waitFor works.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
  listInvoices.mockResolvedValue(INVOICES)
  listInvoicePeriods.mockResolvedValue(INVOICES.map((inv) => inv.issue_date))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('InvoicesPage', () => {
  it('renders the Invoices heading and Create Invoice button', async () => {
    wrap(<InvoicesPage />)
    expect(screen.getByRole('heading', { name: /^invoices$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^create invoice$/i })).toBeInTheDocument()
    await waitFor(() => expect(listInvoices).toHaveBeenCalledTimes(1))
    expect(listInvoices).toHaveBeenCalledWith({ mode: 'fiscal_year', year: 2026 })
  })

  it('shows all five summary cards after load', async () => {
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('Summary')).toBeInTheDocument())
    // "All invoices" appears twice: once in the card, once as the active-filter label.
    expect(screen.getAllByText('All invoices').length).toBeGreaterThanOrEqual(1)
    for (const label of ['Draft', 'Overdue', 'Unpaid', 'Paid']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('summary counts: 4 non-void invoices under "All", 1 each in draft/overdue/unpaid/paid', async () => {
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('Summary')).toBeInTheDocument())

    // The summary card circles contain plain digit text nodes.
    const counts = screen.getAllByText(/^\d+$/).map((el) => el.textContent)
    expect(counts.filter((n) => n === '4')).toHaveLength(1) // "All invoices" circle
    expect(counts.filter((n) => n === '1')).toHaveLength(4) // draft / overdue / unpaid / paid
  })

  it('clicking the "Draft" card shows only draft invoices', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0001')).toBeInTheDocument())

    await user.click(screen.getByText('Draft'))

    expect(screen.getByText('#2026-0001')).toBeInTheDocument()
    expect(screen.queryByText('#2026-0002')).not.toBeInTheDocument()
    expect(screen.queryByText('#2026-0003')).not.toBeInTheDocument()
    expect(screen.queryByText('#2026-0004')).not.toBeInTheDocument()
  })

  it('renders invoice state as dot-only in the table view', async () => {
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0001')).toBeInTheDocument())

    expect(screen.queryByText('Status')).not.toBeInTheDocument()
    expect(screen.queryByText('sent')).not.toBeInTheDocument()
    expect(screen.queryByText('void')).not.toBeInTheDocument()
  })

  it('renders invoice state as dot-only in the compact card view', async () => {
    wrap(<InvoicesPage />, { compact: true })
    await waitFor(() => expect(screen.getByText('#2026-0001')).toBeInTheDocument())

    expect(screen.getByText('Beta Corp')).toBeInTheDocument()
    expect(screen.queryByText('sent')).not.toBeInTheDocument()
    expect(screen.queryByText('void')).not.toBeInTheDocument()
  })

  it('clicking the "Overdue" card shows only the past-due sent invoice', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0002')).toBeInTheDocument())

    await user.click(screen.getByText('Overdue'))

    expect(screen.getByText('#2026-0002')).toBeInTheDocument()
    expect(screen.queryByText('#2026-0001')).not.toBeInTheDocument()
    expect(screen.queryByText('#2026-0003')).not.toBeInTheDocument()
  })

  it('clicking the "Unpaid" card shows only the not-yet-due sent invoice', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0003')).toBeInTheDocument())

    await user.click(screen.getByText('Unpaid'))

    expect(screen.getByText('#2026-0003')).toBeInTheDocument()
    expect(screen.queryByText('#2026-0002')).not.toBeInTheDocument()
  })

  it('void invoices appear in the "All" table view but are excluded from summary stat counts', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('Summary')).toBeInTheDocument())

    // Void invoice is visible under the default "All" filter.
    expect(screen.getByText('Void BV')).toBeInTheDocument()

    // But void invoices do not count in any summary bucket — clicking "Paid"
    // (or any state card) hides it, proving it never matches a named state.
    await user.click(screen.getByText('Paid'))
    expect(screen.queryByText('Void BV')).not.toBeInTheDocument()
  })

  it('search filters by invoice number', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0001')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('Search'), '0002')

    expect(screen.queryByText('#2026-0001')).not.toBeInTheDocument()
    expect(screen.getByText('#2026-0002')).toBeInTheDocument()
  })

  it('search filters by customer name (case-insensitive)', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('Gamma Ltd')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('Search'), 'gamma')

    expect(screen.getByText('#2026-0003')).toBeInTheDocument()
    expect(screen.queryByText('#2026-0001')).not.toBeInTheDocument()
  })

  it('period picker button shows the current fiscal year', async () => {
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /FY 2026/ })).toBeInTheDocument())
  })

  it('loads invoices again when the period changes', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    await waitFor(() => expect(listInvoices).toHaveBeenCalledWith({ mode: 'fiscal_year', year: 2026 }))

    await user.click(screen.getByRole('button', { name: /FY 2026/ }))

    await waitFor(() => expect(listInvoices).toHaveBeenCalledWith({ mode: 'month', year: 2026, month: 2 }))
  })

  it('fiscal year auto-switches to the most recent past year when no invoices exist for the current year', async () => {
    listInvoicePeriods.mockResolvedValue(['2025-06-01'])
    listInvoices.mockResolvedValue([
      { id: 10, invoice_number: '2025-0001', status: 'paid', issue_date: '2025-06-01', payment_term_days: 14, customer_name: 'Old Client', total_cents: 50000 },
    ])
    wrap(<InvoicesPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /FY 2025/ })).toBeInTheDocument())
    expect(screen.getByText('#2025-0001')).toBeInTheDocument()
  })

  it('shows "No invoices found" when no invoices exist at all', async () => {
    listInvoices.mockResolvedValue([])
    wrap(<InvoicesPage />)

    await waitFor(() => expect(screen.getByText('No invoices found')).toBeInTheDocument())
  })

  it('shows "No invoices found" when the active summary filter matches nothing', async () => {
    const user = userEvent.setup()
    // Only paid invoices; clicking "Draft" yields an empty list.
    listInvoices.mockResolvedValue([
      { id: 4, invoice_number: '2026-0004', status: 'paid', issue_date: '2026-03-01', payment_term_days: 14, customer_name: 'Delta Inc', total_cents: 40000 },
    ])
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0004')).toBeInTheDocument())

    await user.click(screen.getByText('Draft'))

    expect(screen.getByText('No invoices found')).toBeInTheDocument()
  })
})
