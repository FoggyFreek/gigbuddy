import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/journal.js', () => ({
  listJournals: vi.fn(),
  getJournal: vi.fn(),
  createJournal: vi.fn(),
  updateJournal: vi.fn(),
  deleteJournal: vi.fn(),
  approveJournal: vi.fn(),
  approveJournals: vi.fn(),
}))

vi.mock('../api/accounts.js', () => ({
  listAccounts: vi.fn(async () => [
    { id: 1, code: '62100', name: 'Instruments & Equipment', type: 'expense', is_active: true },
    { id: 2, code: '11000', name: 'Primary Bank Account', type: 'asset', is_active: true },
  ]),
}))

import * as journalApi from '../api/journal.js'
import JournalPage from '../pages/JournalPage.jsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.js'
import theme from '../theme.js'

function wrap(ui, { compact = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/journal']}>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>{ui}</CompactLayoutContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const draft = (over = {}) => ({
  id: 1, entry_number: 5, entry_date: '2026-06-09', description: 'Test', status: 'draft',
  posted_transaction_id: null,
  lines: [{ id: 1, description: 'Gear', account_code: '62100', vat_rate: 21, side: 'debit', amount_cents: 12100, balancing_account_code: '11000', position: 0 }],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  journalApi.listJournals.mockResolvedValue([draft()])
  journalApi.createJournal.mockResolvedValue(draft({ id: 2, entry_number: 6, lines: [] }))
  journalApi.updateJournal.mockResolvedValue(draft())
  journalApi.deleteJournal.mockResolvedValue(null)
  journalApi.approveJournal.mockResolvedValue(draft({ status: 'approved', posted_transaction_id: 99 }))
  journalApi.approveJournals.mockResolvedValue({ results: [{ id: 1, ok: true }] })
})

describe('JournalPage', () => {
  it('renders journal entries with their lines', async () => {
    wrap(<JournalPage />)
    expect(await screen.findByText('1 ledger entry')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Gear')).toBeInTheDocument()
  })

  it('hides the editor on a compact screen and shows the entry count + desktop nudge', async () => {
    wrap(<JournalPage />, { compact: true })
    expect(await screen.findByText('1 ledger entry')).toBeInTheDocument()
    expect(screen.getByText(/open on a desktop to edit/i)).toBeInTheDocument()
    // the editing controls must not render
    expect(screen.queryByPlaceholderText('Description')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add journal entry/i })).not.toBeInTheDocument()
  })

  it('adds a journal entry', async () => {
    const user = userEvent.setup()
    wrap(<JournalPage />)
    await screen.findByText('1 ledger entry')
    await user.click(screen.getByRole('button', { name: /add journal entry/i }))
    await waitFor(() => expect(journalApi.createJournal).toHaveBeenCalledTimes(1))
  })

  it('adds a line within an entry via the popper', async () => {
    const user = userEvent.setup()
    wrap(<JournalPage />)
    await screen.findByText('1 ledger entry')
    await user.click(screen.getByRole('button', { name: /line actions/i }))
    await user.click(await screen.findByRole('button', { name: /add line/i }))
    // a second Description input now exists
    await waitFor(() => expect(screen.getAllByPlaceholderText('Description')).toHaveLength(2))
  })

  it('duplicates and deletes a line via the popper', async () => {
    const user = userEvent.setup()
    wrap(<JournalPage />)
    await screen.findByText('1 ledger entry')
    await user.click(screen.getByRole('button', { name: /line actions/i }))
    await user.click(await screen.findByRole('button', { name: /duplicate line/i }))
    await waitFor(() => expect(screen.getAllByPlaceholderText('Description')).toHaveLength(2))

    await user.click(screen.getAllByRole('button', { name: /line actions/i })[0])
    await user.click(await screen.findByRole('button', { name: /delete line/i }))
    await waitFor(() => expect(screen.getAllByPlaceholderText('Description')).toHaveLength(1))
  })

  it('debit and credit are mutually exclusive', async () => {
    const user = userEvent.setup()
    journalApi.listJournals.mockResolvedValue([draft({ lines: [{ id: 1, description: '', account_code: '', vat_rate: 0, side: null, amount_cents: 0, balancing_account_code: '', position: 0 }] })])
    wrap(<JournalPage />)
    await screen.findByText('1 ledger entry')
    const debit = screen.getByPlaceholderText('Debit')
    const credit = screen.getByPlaceholderText('Credit')
    await user.type(debit, '100')
    await user.tab()
    expect(debit).toHaveValue('100.00')
    expect(credit).toHaveValue('')
    // Now entering a credit takes over the active side.
    await user.type(credit, '50')
    await user.tab()
    expect(credit).toHaveValue('50.00')
    expect(debit).toHaveValue('')
  })

  it('"Approve all" approves all drafts when nothing is selected', async () => {
    const user = userEvent.setup()
    wrap(<JournalPage />)
    await screen.findByText('1 ledger entry')
    await user.click(screen.getByRole('button', { name: /approve all/i }))
    await waitFor(() => expect(journalApi.approveJournals).toHaveBeenCalledWith([1]))
  })

  it('shows an error dialog listing entries that failed approval', async () => {
    const user = userEvent.setup()
    journalApi.approveJournals.mockResolvedValue({
      results: [{ id: 1, ok: false, error: 'Line 1 is not postable (account)', code: 'invalid_account_code', line: 1 }],
    })
    wrap(<JournalPage />)
    await screen.findByText('1 ledger entry')
    await user.click(screen.getByRole('button', { name: /approve all/i }))

    expect(await screen.findByText(/could not be approved/i)).toBeInTheDocument()
    expect(screen.getByText('Entry J5')).toBeInTheDocument()
    expect(screen.getByText(/Line 1: A line is missing a valid account/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^ok$/i }))
    await waitFor(() => expect(screen.queryByText(/could not be approved/i)).not.toBeInTheDocument())
  })

  it('selecting entries swaps the toolbar and approves only the selection', async () => {
    const user = userEvent.setup()
    journalApi.listJournals.mockResolvedValue([
      draft({ id: 1, entry_number: 5 }),
      draft({ id: 2, entry_number: 6 }),
    ])
    wrap(<JournalPage />)
    await screen.findByText('2 ledger entries')

    await user.click(screen.getByRole('checkbox', { name: /select journal 6/i }))
    expect(await screen.findByText('1 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /approve selected/i }))
    await waitFor(() => expect(journalApi.approveJournals).toHaveBeenCalledWith([2]))
  })

  it('deletes the selected entries after confirming in the dialog', async () => {
    const user = userEvent.setup()
    wrap(<JournalPage />)
    await screen.findByText('1 ledger entry')

    await user.click(screen.getByRole('checkbox', { name: /select journal 5/i }))
    await user.click(screen.getByRole('button', { name: /delete selected/i }))

    // confirm dialog
    await screen.findByText(/delete selected entries\?/i)
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(journalApi.deleteJournal).toHaveBeenCalledWith(1))
  })

  it('shows the save status in the toolbar instead of inside the entry row', async () => {
    let resolveSave
    journalApi.updateJournal.mockImplementation(() => new Promise((res) => { resolveSave = res }))
    const user = userEvent.setup()
    wrap(<JournalPage />)
    expect(await screen.findByText('1 ledger entry')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Description'), 'x')

    const saving = await screen.findByText('Saving…')
    // rendered in the toolbar (next to the Add button), not inside the entry list
    expect(saving.closest('[data-testid="journal-toolbar"]')).not.toBeNull()

    resolveSave(draft())
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument())
  })

  it('shows "Save failed" in the toolbar when a debounced save errors', async () => {
    journalApi.updateJournal.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    wrap(<JournalPage />)
    expect(await screen.findByText('1 ledger entry')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Description'), 'x')

    const failed = await screen.findByText('Save failed')
    expect(failed.closest('[data-testid="journal-toolbar"]')).not.toBeNull()
  })

  it('seeds a blank draft when the list loads empty', async () => {
    journalApi.listJournals.mockReset()
    journalApi.listJournals
      .mockResolvedValueOnce([])
      .mockResolvedValue([draft({ id: 2, entry_number: 6, lines: [] })])
    wrap(<JournalPage />)
    expect(await screen.findByText('1 ledger entry')).toBeInTheDocument()
    await waitFor(() => expect(journalApi.createJournal).toHaveBeenCalledTimes(1))
  })

  it('re-seeds a blank draft after deleting the last draft', async () => {
    const user = userEvent.setup()
    journalApi.listJournals.mockReset()
    journalApi.listJournals
      .mockResolvedValueOnce([draft({ id: 1, entry_number: 5 })])
      .mockResolvedValueOnce([])
      .mockResolvedValue([draft({ id: 2, entry_number: 6, lines: [] })])
    wrap(<JournalPage />)
    await screen.findByText('1 ledger entry')

    await user.click(screen.getByRole('checkbox', { name: /select journal 5/i }))
    await user.click(screen.getByRole('button', { name: /delete selected/i }))
    await screen.findByText(/delete selected entries\?/i)
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(journalApi.deleteJournal).toHaveBeenCalledWith(1))
    await waitFor(() => expect(journalApi.createJournal).toHaveBeenCalledTimes(1))
  })

  it('re-seeds a blank draft after approving all drafts', async () => {
    const user = userEvent.setup()
    journalApi.listJournals.mockReset()
    journalApi.listJournals
      .mockResolvedValueOnce([draft({ id: 1, entry_number: 5 })])
      .mockResolvedValueOnce([])
      .mockResolvedValue([draft({ id: 2, entry_number: 6, lines: [] })])
    wrap(<JournalPage />)
    await screen.findByText('1 ledger entry')

    await user.click(screen.getByRole('button', { name: /approve all/i }))

    await waitFor(() => expect(journalApi.approveJournals).toHaveBeenCalledWith([1]))
    await waitFor(() => expect(journalApi.createJournal).toHaveBeenCalledTimes(1))
  })

  it('select-all selects every draft entry', async () => {
    const user = userEvent.setup()
    journalApi.listJournals.mockResolvedValue([
      draft({ id: 1, entry_number: 5 }),
      draft({ id: 2, entry_number: 6 }),
    ])
    wrap(<JournalPage />)
    await screen.findByText('2 ledger entries')
    await user.click(screen.getByRole('checkbox', { name: /select all draft entries/i }))
    expect(await screen.findByText('2 selected')).toBeInTheDocument()
  })
})
