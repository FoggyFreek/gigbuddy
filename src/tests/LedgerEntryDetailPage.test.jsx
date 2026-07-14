import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/ledger.ts', () => ({
  getLedgerEntry: vi.fn(),
  voidLedgerEntry: vi.fn(),
  reverseLedgerEntry: vi.fn(),
  updateLedgerNote: vi.fn(),
  reclassifyLedgerEntry: vi.fn(),
}))
vi.mock('../api/journal.ts', () => ({
  createJournal: vi.fn(),
}))
vi.mock('../api/accounts.ts', () => ({
  listAccounts: vi.fn(async () => [
    { id: 1, code: '421', name: 'Administrative expenses', type: 'expense', is_active: true },
    { id: 2, code: '64200', name: 'Hired Musicians & Contractors', type: 'expense', is_active: true },
    { id: 3, code: '65000', name: 'Old account', type: 'expense', is_active: false },
  ]),
}))
vi.mock('../hooks/usePermissions.ts', () => ({
  usePermissions: vi.fn(() => ({ canManageFinance: true })),
}))

import { getLedgerEntry, voidLedgerEntry, reverseLedgerEntry, updateLedgerNote, reclassifyLedgerEntry } from '../api/ledger.ts'
import { listAccounts } from '../api/accounts.ts'
import { createJournal } from '../api/journal.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
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
  usePermissions.mockReturnValue({ canManageFinance: true })
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

describe('LedgerEntryDetailPage — note', () => {
  it('shows the note with the latest editor and edit time', async () => {
    getLedgerEntry.mockResolvedValue({
      ...DETAIL,
      note: 'Checked with accountant',
      note_updated_at: '2026-07-01T10:00:00.000Z',
      note_updated_by_name: 'Joris Bos',
    })
    wrap()
    await waitFor(() => expect(screen.getByText('Checked with accountant')).toBeInTheDocument())
    expect(screen.getByText(/last edited by joris bos/i)).toBeInTheDocument()
  })

  it('shows a placeholder when there is no note', async () => {
    wrap()
    await waitFor(() => expect(screen.getByText(/no note/i)).toBeInTheDocument())
  })

  it('a finance manager edits and saves the note', async () => {
    const user = userEvent.setup()
    getLedgerEntry.mockResolvedValue({ ...DETAIL, note: 'Old note' })
    updateLedgerNote.mockResolvedValue({
      note: 'New note',
      note_updated_at: '2026-07-02T09:00:00.000Z',
      note_updated_by_user_id: 1,
      note_updated_by_name: 'Alpha User',
    })
    wrap()
    await waitFor(() => expect(screen.getByText('Old note')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const input = screen.getByPlaceholderText(/add a note/i)
    expect(input).toHaveValue('Old note')
    await user.clear(input)
    await user.type(input, 'New note')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(updateLedgerNote).toHaveBeenCalledWith(5, 'New note'))
    expect(await screen.findByText('New note')).toBeInTheDocument()
    expect(screen.getByText(/last edited by alpha user/i)).toBeInTheDocument()
  })

  it('cancelling the note edit calls no API and keeps the old note', async () => {
    const user = userEvent.setup()
    getLedgerEntry.mockResolvedValue({ ...DETAIL, note: 'Old note' })
    wrap()
    await waitFor(() => expect(screen.getByText('Old note')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.type(screen.getByPlaceholderText(/add a note/i), ' changed')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(updateLedgerNote).not.toHaveBeenCalled()
    expect(screen.getByText('Old note')).toBeInTheDocument()
  })

  it('a finance viewer sees the note read-only (no Edit button)', async () => {
    usePermissions.mockReturnValue({ canManageFinance: false })
    getLedgerEntry.mockResolvedValue({ ...DETAIL, note: 'Read me' })
    wrap()
    await waitFor(() => expect(screen.getByText('Read me')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })
})

describe('LedgerEntryDetailPage — reclassify', () => {
  it('posts the reclassification immediately and navigates to the posted transaction', async () => {
    const user = userEvent.setup()
    reclassifyLedgerEntry.mockResolvedValue({ id: 12, status: 'approved', posted_transaction_id: 77 })
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /reclassify account/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /reclassify account/i }))
    const dialog = await screen.findByRole('dialog')

    // Pick the expense line…
    await user.click(within(dialog).getByLabelText(/ledger line/i))
    await user.click(await screen.findByRole('option', { name: /421 · Administrative expenses/i }))
    // …and a destination account.
    await user.click(within(dialog).getByLabelText(/destination account/i))
    await user.click(await screen.findByRole('option', { name: /64200/i }))

    // The note is generated from the selection but stays editable.
    const note = within(dialog).getByLabelText(/^note$/i)
    expect(note).toHaveValue('Reclassified 421 to 64200 from ledger entry #5')
    await user.type(note, ' (rebooked)')

    await user.click(within(dialog).getByRole('button', { name: /^reclassify$/i }))
    await waitFor(() => expect(reclassifyLedgerEntry).toHaveBeenCalledWith(5, {
      source_line_id: 1,
      destination_account_code: '64200',
      note: 'Reclassified 421 to 64200 from ledger entry #5 (rebooked)',
    }))
    // Navigates to the newly posted correcting transaction's detail page.
    await waitFor(() => expect(getLedgerEntry).toHaveBeenCalledWith(77))
    // The destination route reuses this same component instance, so the dialog
    // must be explicitly closed — otherwise it pops up again on the new entry.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('excludes lines that already have a reclassification from the picker', async () => {
    const user = userEvent.setup()
    getLedgerEntry.mockResolvedValue({
      ...DETAIL,
      lines: [
        { ...DETAIL.lines[0], reclassification: { journal_id: 12, status: 'approved', posted_transaction_id: 76 } },
        DETAIL.lines[1],
        DETAIL.lines[2],
      ],
    })
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /reclassify account/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /reclassify account/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText(/ledger line/i))

    const options = await screen.findAllByRole('option')
    const labels = options.map((o) => o.textContent)
    expect(labels.some((l) => l.includes('120501009'))).toBe(true)
    expect(labels.some((l) => l.includes('421 ·'))).toBe(false)
  })

  it('shows the API error inside the dialog', async () => {
    const user = userEvent.setup()
    reclassifyLedgerEntry.mockRejectedValue(new Error('This ledger line has already been reclassified'))
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /reclassify account/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /reclassify account/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText(/ledger line/i))
    await user.click(await screen.findByRole('option', { name: /421 · Administrative expenses/i }))
    await user.click(within(dialog).getByLabelText(/destination account/i))
    await user.click(await screen.findByRole('option', { name: /64200/i }))
    await user.click(within(dialog).getByRole('button', { name: /^reclassify$/i }))

    expect(await within(dialog).findByText(/already been reclassified/i)).toBeInTheDocument()
  })

  it('hides the reclassify button for voided entries, corrections, and non-managers', async () => {
    getLedgerEntry.mockResolvedValue({ ...DETAIL, voided: true, voided_by_transaction_id: 6 })
    const { unmount } = wrap()
    await waitFor(() => expect(screen.getByText(/has been voided/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /reclassify account/i })).not.toBeInTheDocument()
    unmount()

    usePermissions.mockReturnValue({ canManageFinance: false })
    getLedgerEntry.mockResolvedValue(DETAIL)
    wrap()
    await waitFor(() => expect(screen.getByText('Administrative expenses')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /reclassify account/i })).not.toBeInTheDocument()
  })

  it('shows an error with a retry when the accounts fail to load', async () => {
    const user = userEvent.setup()
    listAccounts.mockRejectedValueOnce(new Error('network down'))
    wrap()
    await waitFor(() => expect(screen.getByRole('button', { name: /reclassify account/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /reclassify account/i }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/accounts could not be loaded/i)).toBeInTheDocument()

    // Retry hits the API again (default mock resolves) and clears the error,
    // making the destination picker usable.
    await user.click(within(dialog).getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(within(dialog).queryByText(/accounts could not be loaded/i)).not.toBeInTheDocument())

    await user.click(within(dialog).getByLabelText(/ledger line/i))
    await user.click(await screen.findByRole('option', { name: /421 · Administrative expenses/i }))
    await user.click(within(dialog).getByLabelText(/destination account/i))
    expect(await screen.findByRole('option', { name: /64200/i })).toBeInTheDocument()
  })

  it('links a reclassified line to its posted correcting transaction', async () => {
    getLedgerEntry.mockResolvedValue({
      ...DETAIL,
      lines: [
        { ...DETAIL.lines[0], reclassification: { journal_id: 13, status: 'approved', posted_transaction_id: 77 } },
        DETAIL.lines[1],
        DETAIL.lines[2],
      ],
    })
    wrap()
    await waitFor(() => expect(screen.getByText('Administrative expenses')).toBeInTheDocument())

    expect(screen.getByRole('link', { name: /reclassified — view entry #77/i }))
      .toHaveAttribute('href', '/ledger/77')
  })
})
