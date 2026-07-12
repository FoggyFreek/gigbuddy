import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BankStatementImportDialog from '../components/ledger/BankStatementImportDialog.tsx'
import { parseBankStatement, commitBankImport, cancelBankImport, setOpeningBalanceFromImport } from '../api/bankImport.ts'
import { listAccounts, getAccountingSettings } from '../api/accounts.ts'
import theme from '../theme.ts'

vi.mock('../api/bankImport.ts', () => ({
  parseBankStatement: vi.fn(),
  commitBankImport: vi.fn(),
  cancelBankImport: vi.fn(),
  setOpeningBalanceFromImport: vi.fn(),
}))

vi.mock('../api/accounts.ts', () => ({
  listAccounts: vi.fn(),
  getAccountingSettings: vi.fn(),
}))

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

const ACCOUNTS = [
  { code: '62100', name: 'Equipment', type: 'expense', is_active: true },
  { code: '41000', name: 'Performance revenue', type: 'revenue', is_active: true },
]

const emptySuggestion = { possibleDuplicate: false, supplierMatches: [], invoiceMatches: [], purchaseMatches: [] }

const PARSE_RESULT = {
  import: { id: 99, filename: 's.xml', format: 'camt053', currency: 'EUR', statement_ref: null, account_iban: null, status: 'staged' },
  lines: [
    {
      id: 1, line_index: 0, booking_date: '2026-02-03', value_date: null, amount_cents: 3000,
      direction: 'debit', currency: 'EUR', counterparty_name: 'String Supply Co',
      counterparty_iban: 'NL00TEST0000000001', remittance_info: 'Strings', is_reversal: false,
      status: 'pending', suggestion: emptySuggestion,
    },
    {
      id: 2, line_index: 1, booking_date: '2026-02-04', value_date: null, amount_cents: 60000,
      direction: 'credit', currency: 'EUR', counterparty_name: 'Cafe De Kroon',
      counterparty_iban: null, remittance_info: 'Gig payment', is_reversal: false,
      status: 'pending', suggestion: emptySuggestion,
    },
  ],
}

async function uploadFile() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Choose file' }))
  const input = document.querySelector('input[type="file"]')
  await user.upload(input, new File(['<xml/>'], 'statement.xml', { type: 'application/xml' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  listAccounts.mockResolvedValue(ACCOUNTS)
  getAccountingSettings.mockResolvedValue({
    default_revenue_account_code: '41000',
    default_expense_account_code: '62100',
    primary_checking_account_code: '11000',
  })
})

describe('BankStatementImportDialog', () => {
  it('deletes the staged import before closing on cancel', async () => {
    parseBankStatement.mockResolvedValue(PARSE_RESULT)
    cancelBankImport.mockResolvedValue(undefined)
    const onClose = vi.fn()
    wrap(<BankStatementImportDialog onClose={onClose} />)
    await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
    await uploadFile()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(cancelBankImport).toHaveBeenCalledWith(99))
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('defaults a new outgoing counterparty to create-supplier and commits per-line decisions', async () => {
    parseBankStatement.mockResolvedValue(PARSE_RESULT)
    commitBankImport.mockResolvedValue({
      imported: 2, skipped: 0,
      results: [{ line_id: 1, status: 'imported' }, { line_id: 2, status: 'imported' }],
    })
    wrap(<BankStatementImportDialog onClose={() => {}} />)
    await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())

    await uploadFile()

    // Review step: the new outgoing counterparty defaults to a "create supplier" option.
    expect(await screen.findByText('Create "String Supply Co"')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Import 2 selected' }))

    await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
    const [importId, decisions] = commitBankImport.mock.calls[0]
    expect(importId).toBe(99)
    expect(decisions).toEqual([
      {
        line_id: 1, action: 'journal_paid', contra_account_code: '62100',
        create_supplier: { name: 'String Supply Co', iban: 'NL00TEST0000000001' },
      },
      { line_id: 2, action: 'journal_received', contra_account_code: '41000' },
    ])

    expect(await screen.findByText('Booked 2, skipped 0.')).toBeInTheDocument()
  })

  it('shows a possible duplicate as a warning without preselecting skip', async () => {
    parseBankStatement.mockResolvedValue({
      import: PARSE_RESULT.import,
      lines: [{
        ...PARSE_RESULT.lines[0], id: 7,
        suggestion: { ...emptySuggestion, possibleDuplicate: true },
      }],
    })
    commitBankImport.mockResolvedValue({ imported: 1, skipped: 0, results: [{ line_id: 7, status: 'imported' }] })
    wrap(<BankStatementImportDialog onClose={() => {}} />)
    await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
    await uploadFile()

    expect(await screen.findByText('Bank reference appeared in an earlier import')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Import 1 selected' }))

    await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
    expect(commitBankImport.mock.calls[0][1]).toEqual([{
      line_id: 7, action: 'journal_paid', contra_account_code: '62100',
      create_supplier: { name: 'String Supply Co', iban: 'NL00TEST0000000001' },
    }])
  })

  it('shows a foreign-currency line as skipped and excludes it from the count', async () => {
    parseBankStatement.mockResolvedValue({
      import: PARSE_RESULT.import,
      lines: [{
        ...PARSE_RESULT.lines[0], id: 5, status: 'skipped_currency', currency: 'USD',
      }],
    })
    wrap(<BankStatementImportDialog onClose={() => {}} />)
    await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
    await uploadFile()

    expect(await screen.findByText('Foreign currency — skipped')).toBeInTheDocument()
    // No pending lines → the commit button is disabled (shows "Finish").
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
  })

  it('allows a supplier name to be entered for an unstructured MT940 line', async () => {
    parseBankStatement.mockResolvedValue({
      import: { ...PARSE_RESULT.import, format: 'mt940' },
      lines: [{
        ...PARSE_RESULT.lines[0], id: 8, counterparty_name: null,
        counterparty_iban: null, remittance_info: 'WITHDRAWAL 12345',
      }],
    })
    commitBankImport.mockResolvedValue({ imported: 1, skipped: 0, results: [{ line_id: 8, status: 'imported' }] })
    wrap(<BankStatementImportDialog onClose={() => {}} />)
    await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
    await uploadFile()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: 'Create new supplier' }))
    await user.type(await screen.findByLabelText('Supplier name'), 'Manual Supplier')
    await user.click(screen.getByRole('button', { name: 'Import 1 selected' }))

    await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
    expect(commitBankImport.mock.calls[0][1]).toEqual([{
      line_id: 8, action: 'journal_paid', contra_account_code: '62100',
      create_supplier: { name: 'Manual Supplier', iban: null },
    }])
  })

  it('labels a linked invoice match as deactivating its Mollie link', async () => {
    parseBankStatement.mockResolvedValue({
      import: PARSE_RESULT.import,
      lines: [{
        ...PARSE_RESULT.lines[1],
        suggestion: {
          ...emptySuggestion,
          invoiceMatches: [{
            id: 12, invoice_number: 'INV-12', customer_name: 'Cafe De Kroon',
            total_cents: 60000, mollie_payment_link_id: 'pl_12',
          }],
        },
      }],
    })
    wrap(<BankStatementImportDialog onClose={() => {}} />)
    await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
    await uploadFile()

    expect(await screen.findByText('Match invoice INV-12 and deactivate Mollie link')).toBeInTheDocument()
  })

  it('offers to set the opening balance from the statement and calls the API', async () => {
    parseBankStatement.mockResolvedValue({
      ...PARSE_RESULT,
      import: { ...PARSE_RESULT.import, opening_balance_cents: 100000, opening_balance_date: '2026-01-31' },
      openingBalanceSuggested: true,
    })
    setOpeningBalanceFromImport.mockResolvedValue({ posted: true, transactionId: 5 })
    wrap(<BankStatementImportDialog onClose={() => {}} />)
    await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
    await uploadFile()

    const user = userEvent.setup()
    const setButton = await screen.findByRole('button', { name: 'Set opening balance' })
    await user.click(setButton)

    await waitFor(() => expect(setOpeningBalanceFromImport).toHaveBeenCalledWith(99))
    expect(await screen.findByText('Opening balance set from this statement.')).toBeInTheDocument()
  })

  it('hides the opening-balance nudge when the tenant already has one', async () => {
    parseBankStatement.mockResolvedValue({ ...PARSE_RESULT, openingBalanceSuggested: false })
    wrap(<BankStatementImportDialog onClose={() => {}} />)
    await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
    await uploadFile()

    await screen.findByText('Create "String Supply Co"')
    expect(screen.queryByRole('button', { name: 'Set opening balance' })).not.toBeInTheDocument()
  })
})
