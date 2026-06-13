import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/ledger.js', () => ({
  listLedger: vi.fn(),
  listLedgerPeriods: vi.fn(),
}))
vi.mock('../components/shared/periodPicker.jsx', () => ({
  default: ({ value, onChange }) => (
    <button onClick={() => onChange({ mode: 'month', year: 2026, month: 2 })}>
      {`FY ${value.year ?? ''}`}
    </button>
  ),
}))

import { listLedger, listLedgerPeriods } from '../api/ledger.js'
import LedgerEntriesPage from '../pages/LedgerEntriesPage.jsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.js'
import theme from '../theme.js'

const ROWS = [
  { id: 5, entry_date: '2026-06-12', type: 'Purchase', group: 'purchases', voided: false, receipt: 9, description: 'Bill from mi5 Studios: TEST', amount_cents: -2500, source_type: 'purchase', source_id: 9 },
  { id: 4, entry_date: '2026-06-10', type: 'Journal', group: 'journals', voided: false, receipt: 5, description: 'T', amount_cents: null, source_type: 'journal', source_id: 5 },
  { id: 3, entry_date: '2026-06-09', type: 'Ingoing payment', group: 'payments', voided: false, receipt: null, description: 'Paid by Texel Buitengewoon for invoice 1', amount_cents: 65400, source_type: 'invoice', source_id: 1 },
  { id: 2, entry_date: '2026-06-09', type: 'Invoice', group: 'invoices', voided: false, receipt: null, description: 'Invoice number 1 for Texel Buitengewoon', amount_cents: 65400, source_type: 'invoice', source_id: 1 },
  { id: 1, entry_date: '2026-06-08', type: 'Invoice (void)', group: 'invoices', voided: true, receipt: null, description: 'Invoice 2 voided', amount_cents: -10000, source_type: 'invoice', source_id: 2 },
]

function wrap(ui, { compact = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/ledger']}>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>
          <Routes>
            <Route path="/ledger" element={ui} />
            <Route path="/ledger/:id" element={<div>detail-route</div>} />
          </Routes>
        </CompactLayoutContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'))
  listLedger.mockResolvedValue(ROWS)
  listLedgerPeriods.mockResolvedValue(ROWS.map((r) => r.entry_date))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('LedgerEntriesPage', () => {
  it('renders the heading and the non-voided rows by default', async () => {
    wrap(<LedgerEntriesPage />)
    expect(screen.getByRole('heading', { name: /ledger entries/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())
    expect(listLedger).toHaveBeenCalledWith({ mode: 'fiscal_year', year: 2026 })

    expect(screen.getByText('Paid by Texel Buitengewoon for invoice 1')).toBeInTheDocument()
    expect(screen.getByText('Invoice number 1 for Texel Buitengewoon')).toBeInTheDocument()
    // Voided row is hidden until "Show voided" is checked.
    expect(screen.queryByText('Invoice 2 voided')).not.toBeInTheDocument()
  })

  it('"Show voided" reveals the void row', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())

    await user.click(screen.getByRole('checkbox', { name: /show voided/i }))

    expect(screen.getByText('Invoice 2 voided')).toBeInTheDocument()
  })

  it('the Types filter hides deselected groups', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /types/i }))
    await user.click(screen.getByRole('menuitem', { name: /purchases/i }))

    expect(screen.queryByText('Bill from mi5 Studios: TEST')).not.toBeInTheDocument()
    expect(screen.getByText('Invoice number 1 for Texel Buitengewoon')).toBeInTheDocument()
  })

  it('the "All" option toggles every group off', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /types/i }))
    await user.click(screen.getByRole('menuitem', { name: /^all$/i }))

    expect(screen.queryByText('Bill from mi5 Studios: TEST')).not.toBeInTheDocument()
    expect(screen.queryByText('Invoice number 1 for Texel Buitengewoon')).not.toBeInTheDocument()
  })

  it('search narrows the rows', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText(/search/i), 'mi5')

    expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument()
    expect(screen.queryByText('Invoice number 1 for Texel Buitengewoon')).not.toBeInTheDocument()
  })

  it('row click navigates to the detail route', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())

    await user.click(screen.getByText('Bill from mi5 Studios: TEST'))

    expect(screen.getByText('detail-route')).toBeInTheDocument()
  })

  it('formats amounts and dates; journal rows show no amount', async () => {
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())

    // The symbol and digits render in separate cells so the € lines up vertically.
    const purchaseRow = screen.getByText('Bill from mi5 Studios: TEST').closest('tr')
    expect(within(purchaseRow).getByText('€')).toBeInTheDocument()
    expect(within(purchaseRow).getByText('-25,00')).toBeInTheDocument()

    const journalRow = screen.getByText('T').closest('tr')
    expect(within(journalRow).queryByText(/€/)).not.toBeInTheDocument()
  })

  it('refetches when the period changes', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(listLedger).toHaveBeenCalledWith({ mode: 'fiscal_year', year: 2026 }))

    await user.click(screen.getByRole('button', { name: /FY 2026/ }))

    await waitFor(() => expect(listLedger).toHaveBeenCalledWith({ mode: 'month', year: 2026, month: 2 }))
  })

  it('sorts by the Date column when its header is clicked', async () => {
    const user = userEvent.setup()
    // Dates and ids run in opposite order so date-sorting is distinguishable.
    listLedger.mockResolvedValue([
      { id: 1, entry_date: '2026-06-20', type: 'Invoice', group: 'invoices', voided: false, receipt: null, description: 'Later date lower id', amount_cents: 1000, source_type: 'invoice', source_id: 1 },
      { id: 2, entry_date: '2026-06-01', type: 'Invoice', group: 'invoices', voided: false, receipt: null, description: 'Earlier date higher id', amount_cents: 2000, source_type: 'invoice', source_id: 2 },
    ])
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Later date lower id')).toBeInTheDocument())

    // Default sort is by # descending → highest id (id 2) first.
    let rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Earlier date higher id')).toBeInTheDocument()

    // Sorting by Date descending puts the newest date (id 1) first.
    await user.click(screen.getByRole('button', { name: /^date$/i }))
    rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Later date lower id')).toBeInTheDocument()

    // Clicking Date again flips to ascending → oldest date (id 2) first.
    await user.click(screen.getByRole('button', { name: /^date$/i }))
    rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Earlier date higher id')).toBeInTheDocument()
  })

  it('shows an empty state when there are no entries', async () => {
    listLedger.mockResolvedValue([])
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText(/no ledger entries/i)).toBeInTheDocument())
  })

  it('remembers filters across remount via sessionStorage', async () => {
    const user = userEvent.setup()
    const first = wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())

    await user.click(screen.getByRole('checkbox', { name: /show voided/i }))
    expect(screen.getByText('Invoice 2 voided')).toBeInTheDocument()

    first.unmount()

    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())
    // The "Show voided" filter is restored, so the voided row is visible again.
    expect(screen.getByText('Invoice 2 voided')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /show voided/i })).toBeChecked()
  })

  it('starts with defaults when nothing is persisted', async () => {
    wrap(<LedgerEntriesPage />)
    await waitFor(() => expect(screen.getByText('Bill from mi5 Studios: TEST')).toBeInTheDocument())
    expect(screen.queryByText('Invoice 2 voided')).not.toBeInTheDocument()
  })
})
