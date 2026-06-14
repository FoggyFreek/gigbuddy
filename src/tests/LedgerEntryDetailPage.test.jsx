import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/ledger.ts', () => ({
  getLedgerEntry: vi.fn(),
  voidLedgerEntry: vi.fn(),
  reverseLedgerEntry: vi.fn(),
}))
vi.mock('../api/journal.ts', () => ({
  createJournal: vi.fn(),
}))

import { getLedgerEntry, voidLedgerEntry, reverseLedgerEntry } from '../api/ledger.ts'
import { createJournal } from '../api/journal.ts'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'
import LedgerEntryDetailPage from '../pages/LedgerEntryDetailPage.tsx'
import theme from '../theme.ts'

const DETAIL = {
  id: 5,
  entry_date: '2026-06-12',
  type: 'Purchase',
  group: 'purchases',
  voided: false,
  voided_by_transaction_id: null,
  reversed_by_transaction_id: null,
  corrects_transaction_id: null,
  period_open: true,
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
            <Route path="/journal" element={<div>journal-route</div>} />
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

    // Signed "In EUR": debit positive, credit negative. "20,66" also appears in
    // the (symbol-split) Debit column, so allow more than one match; the signed
    // "-25,00" is unique to the In EUR column.
    expect(screen.getAllByText('20,66').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('-25,00')).toBeInTheDocument()

    // Totals row: debits and credits both €25,00. The symbol and digits render
    // in separate aligned cells, so assert on the digit part.
    expect(screen.getByText(/total eur/i)).toBeInTheDocument()
    expect(screen.getAllByText('25,00').length).toBeGreaterThanOrEqual(2)
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

  it('void action confirms, posts the void, and navigates to the reversing entry', async () => {
    voidLedgerEntry.mockResolvedValue({ id: 77 })
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /void/i })).toBeInTheDocument())

    screen.getByRole('button', { name: /^void$/i }).click()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText(/do you want to void this ledger entry/i)).toBeInTheDocument()
    expect(screen.getByText(/creates? a new ledger entry that cancels out this one/i)).toBeInTheDocument()

    screen.getByRole('button', { name: /void entry/i }).click()
    await waitFor(() => expect(voidLedgerEntry).toHaveBeenCalledWith(5))
    // Navigates to the new reversing entry's detail page.
    await waitFor(() => expect(getLedgerEntry).toHaveBeenCalledWith(77))
  })

  it('void confirmation can be cancelled without calling the API', async () => {
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /^void$/i })).toBeInTheDocument())
    screen.getByRole('button', { name: /^void$/i }).click()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    screen.getByRole('button', { name: /cancel/i }).click()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(voidLedgerEntry).not.toHaveBeenCalled()
  })

  it('hides the void button and shows a banner for an entry that has been voided', async () => {
    getLedgerEntry.mockResolvedValue({ ...DETAIL, voided: true, voided_by_transaction_id: 6 })
    wrap()
    await waitFor(() => expect(screen.getByText(/has been voided by another ledger entry/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^void$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^reverse$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view entry #6/i })).toHaveAttribute('href', '/ledger/6')
  })

  it('shows a reversed banner and no action button for an entry that has been reversed', async () => {
    getLedgerEntry.mockResolvedValue({ ...DETAIL, period_open: false, reversed_by_transaction_id: 8 })
    wrap()
    await waitFor(() => expect(screen.getByText(/has been reversed by another ledger entry/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^void$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^reverse$/i })).not.toBeInTheDocument()
  })

  it('offers Reverse (not Void) for an entry in a closed period and posts the reversal', async () => {
    reverseLedgerEntry.mockResolvedValue({ id: 90 })
    getLedgerEntry.mockResolvedValue({ ...DETAIL, period_open: false })
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /^reverse$/i })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^void$/i })).not.toBeInTheDocument()

    screen.getByRole('button', { name: /^reverse$/i }).click()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText(/closed booking period/i)).toBeInTheDocument()

    screen.getByRole('button', { name: /reverse entry/i }).click()
    await waitFor(() => expect(reverseLedgerEntry).toHaveBeenCalledWith(5))
    await waitFor(() => expect(getLedgerEntry).toHaveBeenCalledWith(90))
  })

  it('copy action creates a draft journal from the lines and navigates to the journal page', async () => {
    createJournal.mockResolvedValue({ id: 12 })
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument())

    screen.getByRole('button', { name: /copy/i }).click()
    await waitFor(() => expect(createJournal).toHaveBeenCalledTimes(1))
    const body = createJournal.mock.calls[0][0]
    expect(body.description).toBe(DETAIL.description)
    expect(body.lines).toEqual([
      { description: 'TEST', account_code: '421', vat_rate: 0, side: 'debit', amount_cents: 2066 },
      { description: 'TEST', account_code: '120501009', vat_rate: 0, side: 'debit', amount_cents: 434 },
      { description: null, account_code: '120301', vat_rate: 0, side: 'credit', amount_cents: 2500 },
    ])
    await waitFor(() => expect(screen.getByText('journal-route')).toBeInTheDocument())
  })

  it('back button navigates to the ledger list', async () => {
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument())
    screen.getByRole('button', { name: /back/i }).click()
    await waitFor(() => expect(screen.getByText('list-route')).toBeInTheDocument())
  })
})
