import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/invoices.ts', () => ({
  listInvoices: vi.fn(),
  listInvoicePeriods: vi.fn(),
}))
// Avoid rendering the full split-view router shell; InvoicesPage still needs
// useNavigate / useParams so we keep MemoryRouter.
vi.mock('../components/SplitView.tsx', () => ({
  default: ({ children }) => <>{children}</>,
}))
vi.mock('../components/NewInvoiceDialog.tsx', () => ({
  default: ({ onClose }) => <button onClick={onClose}>close-new-dialog</button>,
}))
vi.mock('../components/shared/periodPicker.tsx', () => ({
  default: ({ value, onChange }) => (
    <button onClick={() => onChange({ mode: 'month', year: 2026, month: 2 })}>
      {`FY ${value.year ?? ''}`}
    </button>
  ),
}))

import { listInvoicePeriods, listInvoices } from '../api/invoices.ts'
import i18n from '../i18n/index.ts'
import InvoicesPage from '../pages/InvoicesPage.tsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'
import theme from '../theme.ts'

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

beforeEach(async () => {
  await i18n.changeLanguage('en')
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
    // "All invoices" appears twice: once in the card, once as the active-filter label.
    await waitFor(() => expect(screen.getAllByText('All invoices').length).toBeGreaterThanOrEqual(1))
    // "Unpaid" appears twice (summary card + active-filter label, since unpaid is the default).
    for (const label of ['Draft', 'Overdue', 'Unpaid', 'Paid']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1)
    }
  })

  it('defaults to the unpaid filter, showing unpaid + overdue but not draft or paid', async () => {
    wrap(<InvoicesPage />)
    // #2026-0003 is the not-yet-due sent invoice (unpaid); #2026-0002 is past-due (overdue).
    await waitFor(() => expect(screen.getByText('#2026-0003')).toBeInTheDocument())
    expect(screen.getByText('#2026-0002')).toBeInTheDocument()
    // Draft, paid and void are all excluded from the default unpaid view.
    expect(screen.queryByText('#2026-0001')).not.toBeInTheDocument()
    expect(screen.queryByText('#2026-0004')).not.toBeInTheDocument()
    expect(screen.queryByText('Void BV')).not.toBeInTheDocument()
  })

  it('summary counts: 4 non-void under "All", unpaid folds in overdue (2), 1 each draft/overdue/paid', async () => {
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getAllByText('All invoices').length).toBeGreaterThanOrEqual(1))

    // The summary card circles contain plain digit text nodes. The visible-count
    // chip also reads "2" (the default unpaid view shows overdue #0002 + unpaid #0003).
    const counts = screen.getAllByText(/^\d+$/).map((el) => el.textContent)
    expect(counts.filter((n) => n === '4')).toHaveLength(1) // "All invoices" circle
    expect(counts.filter((n) => n === '1')).toHaveLength(3) // draft / overdue / paid circles
    expect(counts.filter((n) => n === '2')).toHaveLength(2) // unpaid circle (unpaid+overdue) + visible-count chip
  })

  it('clicking the "Draft" card shows only draft invoices', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    // #2026-0001 (draft) is hidden under the default unpaid filter; wait for a visible row.
    await waitFor(() => expect(screen.getByText('#2026-0003')).toBeInTheDocument())

    await user.click(screen.getByText('Draft'))

    expect(screen.getByText('#2026-0001')).toBeInTheDocument()
    expect(screen.queryByText('#2026-0002')).not.toBeInTheDocument()
    expect(screen.queryByText('#2026-0003')).not.toBeInTheDocument()
    expect(screen.queryByText('#2026-0004')).not.toBeInTheDocument()
  })

  it('renders invoice state as dot-only in the table view', async () => {
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0003')).toBeInTheDocument())

    expect(screen.queryByText('Status')).not.toBeInTheDocument()
    expect(screen.queryByText('sent')).not.toBeInTheDocument()
    expect(screen.queryByText('void')).not.toBeInTheDocument()
  })

  it('renders invoice state as dot-only in the compact card view', async () => {
    wrap(<InvoicesPage />, { compact: true })
    await waitFor(() => expect(screen.getByText('#2026-0003')).toBeInTheDocument())

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

  it('the "Unpaid" card shows both not-yet-due and overdue sent invoices (overdue is a subset of unpaid)', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0003')).toBeInTheDocument())

    // "Unpaid" renders twice (card + active-filter label); the card is first in the DOM.
    await user.click(screen.getAllByText('Unpaid')[0])

    // Unpaid = everything not yet paid: the not-yet-due #0003 and the past-due #0002.
    expect(screen.getByText('#2026-0003')).toBeInTheDocument()
    expect(screen.getByText('#2026-0002')).toBeInTheDocument()
    // But never draft or paid.
    expect(screen.queryByText('#2026-0001')).not.toBeInTheDocument()
    expect(screen.queryByText('#2026-0004')).not.toBeInTheDocument()
  })

  it('void invoices appear in the "All" table view but are excluded from summary stat counts', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getAllByText('All invoices').length).toBeGreaterThanOrEqual(1))

    // Void invoice is hidden under the default unpaid filter; switch to "All" to see it.
    await user.click(screen.getByText('All invoices'))
    expect(screen.getByText('Void BV')).toBeInTheDocument()

    // But void invoices do not count in any summary bucket — clicking "Paid"
    // (or any state card) hides it, proving it never matches a named state.
    await user.click(screen.getByText('Paid'))
    expect(screen.queryByText('Void BV')).not.toBeInTheDocument()
  })

  it('search filters by invoice number', async () => {
    const user = userEvent.setup()
    wrap(<InvoicesPage />)
    // #2026-0002 (overdue) is visible under the default unpaid filter.
    await waitFor(() => expect(screen.getByText('#2026-0003')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('Search'), '0002')

    expect(screen.queryByText('#2026-0003')).not.toBeInTheDocument()
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
    // 'sent' + long-past due → overdue → visible under the default unpaid filter.
    listInvoices.mockResolvedValue([
      { id: 10, invoice_number: '2025-0001', status: 'sent', issue_date: '2025-06-01', payment_term_days: 14, customer_name: 'Old Client', total_cents: 50000 },
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

  it('paginates the table at 25 rows per page', async () => {
    const user = userEvent.setup()
    // 'sent' + far-future due → unpaid → visible under the default unpaid filter.
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      invoice_number: `2026-${String(100 + i)}`,
      status: 'sent',
      issue_date: '2026-06-08',
      payment_term_days: 99999,
      customer_name: `Client ${100 + i}`,
      total_cents: 1000,
    }))
    listInvoices.mockResolvedValue(many)
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-100')).toBeInTheDocument())

    // First page: rows 0–24 visible, row 25 not.
    expect(screen.getByText('#2026-124')).toBeInTheDocument()
    expect(screen.queryByText('#2026-125')).not.toBeInTheDocument()
    expect(screen.getByText('1–25 of 30')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next page/i }))

    expect(screen.getByText('#2026-125')).toBeInTheDocument()
    expect(screen.queryByText('#2026-100')).not.toBeInTheDocument()
  })

  it('hides pagination controls when invoices fit on one page', async () => {
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0003')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument()
  })

  it('resets to a valid page when a filter shrinks the list', async () => {
    const user = userEvent.setup()
    // One overdue invoice (#0100) plus 29 not-yet-due — all in the default unpaid view.
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      invoice_number: `2026-${String(100 + i)}`,
      status: 'sent',
      issue_date: i === 0 ? '2026-01-01' : '2026-06-08',
      payment_term_days: i === 0 ? 1 : 99999,
      customer_name: `Client ${100 + i}`,
      total_cents: 1000,
    }))
    listInvoices.mockResolvedValue(many)
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-100')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getByText('#2026-125')).toBeInTheDocument()

    // Only one overdue invoice → the previous page index is out of range.
    await user.click(screen.getByText('Overdue'))
    expect(screen.getByText('#2026-100')).toBeInTheDocument()
  })

  it('shows "No invoices found" when the active summary filter matches nothing', async () => {
    const user = userEvent.setup()
    // Only an unpaid (not-yet-due) invoice, visible by default; clicking "Draft" yields an empty list.
    listInvoices.mockResolvedValue([
      { id: 4, invoice_number: '2026-0004', status: 'sent', issue_date: '2026-06-08', payment_term_days: 99999, customer_name: 'Delta Inc', total_cents: 40000 },
    ])
    wrap(<InvoicesPage />)
    await waitFor(() => expect(screen.getByText('#2026-0004')).toBeInTheDocument())

    await user.click(screen.getByText('Draft'))

    expect(screen.getByText('No invoices found')).toBeInTheDocument()
  })

  it('renders the invoice list in Dutch', async () => {
    await i18n.changeLanguage('nl')
    wrap(<InvoicesPage />)

    expect(screen.getByRole('heading', { name: 'Facturen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Factuur aanmaken' })).toBeInTheDocument()
    expect((await screen.findAllByText('Alle facturen')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Achterstallig')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Zoeken')).toBeInTheDocument()
    expect(screen.getByText('Klant')).toBeInTheDocument()
  })
})
