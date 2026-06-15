import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/ledger.ts', () => ({
  listLedgerEntries: vi.fn(),
  listLedgerPeriods: vi.fn(),
}))
vi.mock('../api/accounts.ts', () => ({
  listAccounts: vi.fn(),
}))
vi.mock('../components/shared/periodPicker.tsx', () => ({
  default: ({ value, onChange }) => (
    <button onClick={() => onChange({ mode: 'month', year: 2026, month: 2 })}>
      {`FY ${value.year ?? ''}`}
    </button>
  ),
}))

import { listLedgerEntries, listLedgerPeriods } from '../api/ledger.ts'
import { listAccounts } from '../api/accounts.ts'
import LedgerEntrySearchPage from '../pages/LedgerEntrySearchPage.tsx'
import theme from '../theme.ts'

// 10000 Assets is the parent of 11000 Bank and 11100 Cash.
const ACCOUNTS = [
  { id: 1, code: '10000', name: 'Assets', type: 'asset', parent_code: null },
  { id: 2, code: '11000', name: 'Bank', type: 'asset', parent_code: '10000' },
  { id: 3, code: '11100', name: 'Cash', type: 'asset', parent_code: '10000' },
]

const ENTRIES = [
  { id: 10, transaction_id: 100, entry_date: '2026-06-12', account_code: '11000', account_name: 'Bank', type: 'Purchase', description: 'Bill', memo: 'studio day', debit_cents: 0, credit_cents: 2500, source_type: 'purchase', source_event: 'accrued', voided: false },
  { id: 11, transaction_id: 101, entry_date: '2026-06-10', account_code: '11100', account_name: 'Cash', type: 'Journal', description: 'Init', memo: 'opening float', debit_cents: 1000, credit_cents: 0, source_type: 'journal', source_event: 'posted', voided: false },
  { id: 12, transaction_id: 102, entry_date: '2026-06-08', account_code: '11000', account_name: 'Bank', type: 'Invoice (void)', description: 'voided', memo: 'cancelled', debit_cents: 0, credit_cents: 500, source_type: 'invoice', source_event: 'void', voided: true },
]

function wrap(ui) {
  return render(
    <MemoryRouter initialEntries={['/ledger-entries']}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

// Open the accounts dropdown and tick the parent account, which (subtree
// toggle) selects it and both children.
async function selectAssetsTree(user) {
  await user.click(screen.getByRole('button', { name: /accounts: none/i }))
  await user.click(screen.getByRole('menuitem', { name: /10000 — Assets/ }))
  // Close the dropdown so its modal stops aria-hiding the rest of the page.
  await user.keyboard('{Escape}')
}

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'))
  listAccounts.mockResolvedValue(ACCOUNTS)
  listLedgerPeriods.mockResolvedValue(ENTRIES.map((r) => r.entry_date))
  listLedgerEntries.mockResolvedValue(ENTRIES)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('LedgerEntrySearchPage', () => {
  it('prompts for an account and fetches nothing until one is selected', async () => {
    wrap(<LedgerEntrySearchPage />)
    expect(screen.getByRole('heading', { name: /ledger entries/i })).toBeInTheDocument()
    await waitFor(() => expect(listLedgerPeriods).toHaveBeenCalled())
    expect(screen.getByText(/select one or more accounts/i)).toBeInTheDocument()
    expect(listLedgerEntries).not.toHaveBeenCalled()
  })

  it('selecting a parent includes its descendant codes in the API call', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntrySearchPage />)
    await waitFor(() => expect(listAccounts).toHaveBeenCalled())

    await selectAssetsTree(user)

    await waitFor(() => expect(listLedgerEntries).toHaveBeenCalled())
    expect(listLedgerEntries).toHaveBeenCalledWith(expect.anything(), ['10000', '11000', '11100'])
    expect(await screen.findByText('studio day')).toBeInTheDocument()
    // Voided line stays hidden until "Show voided".
    expect(screen.queryByText('cancelled')).not.toBeInTheDocument()

    // Each row links to its parent ledger transaction.
    const row = screen.getByText('studio day').closest('tr')
    expect(within(row).getByRole('link', { name: /open transaction/i })).toHaveAttribute('href', '/ledger/100')
  })

  it('"Show voided" reveals voided entries', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntrySearchPage />)
    await waitFor(() => expect(listAccounts).toHaveBeenCalled())
    await selectAssetsTree(user)
    expect(await screen.findByText('studio day')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /show voided/i }))

    expect(screen.getByText('cancelled')).toBeInTheDocument()
  })

  it('memo search narrows the rows', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntrySearchPage />)
    await waitFor(() => expect(listAccounts).toHaveBeenCalled())
    await selectAssetsTree(user)
    expect(await screen.findByText('studio day')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/search memo/i), 'studio')

    expect(screen.getByText('studio day')).toBeInTheDocument()
    expect(screen.queryByText('opening float')).not.toBeInTheDocument()
  })

  it('totals the debit and credit columns over the filtered rows', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntrySearchPage />)
    await waitFor(() => expect(listAccounts).toHaveBeenCalled())
    await selectAssetsTree(user)
    expect(await screen.findByText('studio day')).toBeInTheDocument()

    // Non-voided rows: debit 10,00 (id 11), credit 25,00 (id 10).
    const totalsRow = screen.getByText(/Totals \(2\)/).closest('tr')
    expect(within(totalsRow).getByText('10,00')).toBeInTheDocument()
    expect(within(totalsRow).getByText('25,00')).toBeInTheDocument()
  })

  it('restores the account selection across remount via sessionStorage', async () => {
    const user = userEvent.setup()
    const first = wrap(<LedgerEntrySearchPage />)
    await waitFor(() => expect(listAccounts).toHaveBeenCalled())
    await selectAssetsTree(user)
    expect(await screen.findByText('studio day')).toBeInTheDocument()

    first.unmount()
    vi.clearAllMocks()
    listAccounts.mockResolvedValue(ACCOUNTS)
    listLedgerPeriods.mockResolvedValue(ENTRIES.map((r) => r.entry_date))
    listLedgerEntries.mockResolvedValue(ENTRIES)

    wrap(<LedgerEntrySearchPage />)
    // The selection is restored, so it refetches and renders without re-picking.
    await waitFor(() => expect(listLedgerEntries).toHaveBeenCalledWith(expect.anything(), ['10000', '11000', '11100']))
    expect(await screen.findByText('studio day')).toBeInTheDocument()
  })

  it('sorts by amount when the Debit header is clicked', async () => {
    const user = userEvent.setup()
    wrap(<LedgerEntrySearchPage />)
    await waitFor(() => expect(listAccounts).toHaveBeenCalled())
    await selectAssetsTree(user)
    expect(await screen.findByText('studio day')).toBeInTheDocument()

    // Amount sort is on the Debit header; descending puts the largest signed
    // amount (the +10,00 debit, id 11) first, above the -25,00 credit (id 10).
    await user.click(screen.getByRole('button', { name: /debit/i }))
    const bodyRows = screen.getAllByRole('row').filter((r) => within(r).queryByText(/studio day|opening float/))
    expect(within(bodyRows[0]).getByText('opening float')).toBeInTheDocument()
  })
})
