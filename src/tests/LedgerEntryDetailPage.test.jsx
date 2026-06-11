import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/ledger.js', () => ({
  getLedgerEntry: vi.fn(),
}))

import { getLedgerEntry } from '../api/ledger.js'
import { CompactLayoutContext } from '../hooks/useCompactLayout.js'
import LedgerEntryDetailPage from '../pages/LedgerEntryDetailPage.jsx'
import theme from '../theme.js'

const DETAIL = {
  id: 5,
  entry_date: '2026-06-12',
  type: 'Purchase',
  group: 'purchases',
  voided: false,
  receipt: 9,
  description: 'Bill from mi5 Studios: TEST',
  source_type: 'purchase',
  source_id: 9,
  created_at: '2026-06-10T21:02:00.000Z',
  created_by_name: 'Joris Bos',
  origin: { label: 'Bill from mi5 Studios: TEST', path: '/purchases/9' },
  lines: [
    { id: 1, account_code: '421', account_name: 'Administrative expenses', memo: 'TEST', debit_cents: 2066, credit_cents: 0 },
    { id: 2, account_code: '120501009', account_name: '5b. Input tax', memo: 'TEST', debit_cents: 434, credit_cents: 0 },
    { id: 3, account_code: '120301', account_name: 'Trade creditors, nominal', memo: null, debit_cents: 0, credit_cents: 2500 },
  ],
}

function wrap({ compact = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/ledger/5']}>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>
          <Routes>
            <Route path="/ledger" element={<div>list-route</div>} />
            <Route path="/ledger/:id" element={<LedgerEntryDetailPage />} />
          </Routes>
        </CompactLayoutContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  getLedgerEntry.mockResolvedValue(DETAIL)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('LedgerEntryDetailPage', () => {
  it('renders the heading with the description and fetches by route id', async () => {
    wrap()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /ledger entry: bill from mi5 studios: test/i })).toBeInTheDocument(),
    )
    expect(getLedgerEntry).toHaveBeenCalledWith(5)
  })

  it('renders the journal lines with account names and balanced totals', async () => {
    wrap()
    await waitFor(() => expect(screen.getByText('Administrative expenses')).toBeInTheDocument())

    expect(screen.getByText('421')).toBeInTheDocument()
    expect(screen.getByText('5b. Input tax')).toBeInTheDocument()
    expect(screen.getByText('Trade creditors, nominal')).toBeInTheDocument()

    // Signed "In EUR": debit positive, credit negative.
    expect(screen.getByText('20,66')).toBeInTheDocument()
    expect(screen.getByText('-25,00')).toBeInTheDocument()

    // Totals row: debits and credits both €25,00.
    expect(screen.getByText(/total eur/i)).toBeInTheDocument()
    expect(screen.getAllByText(/€\s?25,00/).length).toBeGreaterThanOrEqual(2)
  })

  it('renders the metadata card with origin link', async () => {
    wrap()
    await waitFor(() => expect(screen.getByText(/ledger entry number/i)).toBeInTheDocument())

    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText(/joris bos/i)).toBeInTheDocument()

    const origin = screen.getByRole('link', { name: /bill from mi5 studios: test/i })
    expect(origin).toHaveAttribute('href', '/purchases/9')
  })

  it('compact layout renders line cards instead of a table', async () => {
    wrap({ compact: true })
    await waitFor(() => expect(screen.getByText('Administrative expenses')).toBeInTheDocument())

    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    // Account codes, names, and memos still shown per line.
    expect(screen.getByText('421')).toBeInTheDocument()
    expect(screen.getByText('Trade creditors, nominal')).toBeInTheDocument()

    // Signed amounts: debit positive, credit negative.
    expect(screen.getByText('20,66')).toBeInTheDocument()
    expect(screen.getByText('-25,00')).toBeInTheDocument()

    // Balanced totals row.
    expect(screen.getByText(/total/i)).toBeInTheDocument()
    expect(screen.getAllByText(/€\s?25,00/).length).toBeGreaterThanOrEqual(2)

    // Metadata still present.
    expect(screen.getByText(/ledger entry number/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /bill from mi5 studios: test/i })).toBeInTheDocument()
  })

  it('back button navigates to the ledger list', async () => {
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument())
    screen.getByRole('button', { name: /back/i }).click()
    await waitFor(() => expect(screen.getByText('list-route')).toBeInTheDocument())
  })
})
