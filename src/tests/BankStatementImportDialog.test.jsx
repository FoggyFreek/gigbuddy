import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BankStatementImportDialog from '../components/ledger/BankStatementImportDialog.tsx'
import { parseBankStatement, commitBankImport, cancelBankImport, setOpeningBalanceFromImport } from '../api/bankImport.ts'
import { listAccounts, getAccountingSettings } from '../api/accounts.ts'
import { getProfile } from '../api/profile.ts'
import { getAccountingProfile } from '../api/accountingProfile.ts'
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

vi.mock('../api/accountingProfile.ts', () => ({
  getAccountingProfile: vi.fn(),
}))
vi.mock('../api/profile.ts', () => ({
  getProfile: vi.fn(),
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
  { code: '62200', name: 'Travel', type: 'expense', is_active: true },
  { code: '41000', name: 'Performance revenue', type: 'revenue', is_active: true },
  { code: '41100', name: 'Merch revenue', type: 'revenue', is_active: true },
]

const emptySuggestion = {
  possibleDuplicate: false, supplierMatches: [], invoiceMatches: [], purchaseMatches: [], paidPurchaseMatches: [],
}

// The dialog reads the scheme in force TODAY off the accounting profile — the
// server resolves it date-aware from the enrolment, so the dialog never has to
// look at a projection that a scheduled enrolment leaves stale.
function accountingProfile(country, schemeExempt) {
  return {
    country_code: country,
    current_sales_treatment: {
      accounting_country: country,
      vat_scheme_code: schemeExempt ? 'nl_kor' : null,
      vat_treatment: schemeExempt ? 'small_business_exempt' : 'standard',
      scheme_exempt: schemeExempt,
      input_vat_recoverable: !schemeExempt,
    },
  }
}

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
  // NL band, 9% on its own turnover, not on the small-business scheme.
  getProfile.mockResolvedValue({ vat_country: 'nl', tax_percentage: 9 })
  getAccountingProfile.mockResolvedValue(accountingProfile('nl', false))
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

  it('closes on cancel when the re-uploaded file was already imported', async () => {
    // Re-uploading a file resolves to the existing import (same file hash), with
    // every line already terminal — so there is nothing left to book or discard.
    parseBankStatement.mockResolvedValue({
      import: { ...PARSE_RESULT.import, status: 'committed' },
      lines: [
        { ...PARSE_RESULT.lines[0], status: 'imported' },
        { ...PARSE_RESULT.lines[1], status: 'reconciled_invoice' },
      ],
      openingBalanceSuggested: false,
    })
    // The server refuses to delete an import that has committed lines.
    cancelBankImport.mockRejectedValue(Object.assign(new Error('Import has already committed lines'), {
      status: 409,
      body: { error: 'Import has already committed lines', code: 'bank_import_has_committed_lines' },
    }))
    const onClose = vi.fn()
    wrap(<BankStatementImportDialog onClose={onClose} />)
    await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
    await uploadFile()

    expect(await screen.findByText('Booked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()

    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toBeEnabled()
    await userEvent.setup().click(cancel)

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(false))
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
        line_id: 1, action: 'journal_paid', contra_account_code: '62100', vat_rate: 21,
        create_supplier: { name: 'String Supply Co', iban: 'NL00TEST0000000001' },
      },
      { line_id: 2, action: 'journal_received', contra_account_code: '41000', vat_rate: 9 },
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
      line_id: 7, action: 'journal_paid', contra_account_code: '62100', vat_rate: 21,
      create_supplier: { name: 'String Supply Co', iban: 'NL00TEST0000000001' },
    }])
  })

  describe('applying an expense account to a whole supplier', () => {
    // Same creditor, two spellings of the name — grouped by the counterparty IBAN.
    const sameSupplier = {
      import: PARSE_RESULT.import,
      lines: [
        { ...PARSE_RESULT.lines[0], id: 21, counterparty_name: 'ACME 0012' },
        { ...PARSE_RESULT.lines[0], id: 22, counterparty_name: 'ACME AMSTERDAM', amount_cents: 4500 },
      ],
    }

    async function pickTravelOnFirstLine() {
      const user = userEvent.setup()
      await user.click((await screen.findAllByRole('combobox', { name: 'Expense account' }))[0])
      await user.click(await screen.findByRole('option', { name: '62200 — Travel' }))
      return user
    }

    it('offers the other lines of that supplier and applies the account to all', async () => {
      parseBankStatement.mockResolvedValue(sameSupplier)
      commitBankImport.mockResolvedValue({
        imported: 2, skipped: 0,
        results: [{ line_id: 21, status: 'imported' }, { line_id: 22, status: 'imported' }],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
      await uploadFile()

      const user = await pickTravelOnFirstLine()
      expect(await screen.findByText('Apply to all payments to ACME 0012?')).toBeInTheDocument()
      expect(screen.getByText(/1 other payment to ACME 0012/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Apply to all' }))

      await user.click(screen.getByRole('button', { name: 'Import 2 selected' }))
      await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
      expect(commitBankImport.mock.calls[0][1]).toEqual([
        {
          line_id: 21, action: 'journal_paid', contra_account_code: '62200', vat_rate: 21,
          create_supplier: { name: 'ACME 0012', iban: 'NL00TEST0000000001' },
        },
        {
          line_id: 22, action: 'journal_paid', contra_account_code: '62200', vat_rate: 21,
          create_supplier: { name: 'ACME AMSTERDAM', iban: 'NL00TEST0000000001' },
        },
      ])
    })

    it('leaves the other lines untouched when only this line is kept', async () => {
      parseBankStatement.mockResolvedValue(sameSupplier)
      commitBankImport.mockResolvedValue({
        imported: 2, skipped: 0,
        results: [{ line_id: 21, status: 'imported' }, { line_id: 22, status: 'imported' }],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
      await uploadFile()

      const user = await pickTravelOnFirstLine()
      await user.click(await screen.findByRole('button', { name: 'Only this line' }))

      await user.click(screen.getByRole('button', { name: 'Import 2 selected' }))
      await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
      const [, decisions] = commitBankImport.mock.calls[0]
      expect(decisions.map((d) => d.contra_account_code)).toEqual(['62200', '62100'])
    })

    it('groups lines of a known supplier by the linked contact, not the bank name', async () => {
      // Both lines auto-link to contact 7; nothing else about them matches —
      // different counterparty names, only one carries an IBAN.
      const match = { id: 7, name: 'Jansen PA Rental', category: 'supplier', iban: 'NL91ABNA0417164300' }
      parseBankStatement.mockResolvedValue({
        import: PARSE_RESULT.import,
        lines: [
          {
            ...PARSE_RESULT.lines[0], id: 41, counterparty_name: 'JANSEN PA RENTAL',
            counterparty_iban: 'NL91ABNA0417164300',
            suggestion: { ...emptySuggestion, supplierMatches: [match] },
          },
          {
            ...PARSE_RESULT.lines[0], id: 42, counterparty_name: 'Jansen PA Rental A\'dam',
            counterparty_iban: null, amount_cents: 8000,
            suggestion: { ...emptySuggestion, supplierMatches: [match] },
          },
        ],
      })
      commitBankImport.mockResolvedValue({
        imported: 2, skipped: 0,
        results: [{ line_id: 41, status: 'imported' }, { line_id: 42, status: 'imported' }],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
      await uploadFile()

      const user = await pickTravelOnFirstLine()
      // Named after the linked contact, not the counterparty string on the line.
      expect(await screen.findByText('Apply to all payments to Jansen PA Rental?')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Apply to all' }))

      await user.click(screen.getByRole('button', { name: 'Import 2 selected' }))
      await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
      expect(commitBankImport.mock.calls[0][1]).toEqual([
        { line_id: 41, action: 'journal_paid', contra_account_code: '62200', vat_rate: 21, supplier_contact_id: 7 },
        { line_id: 42, action: 'journal_paid', contra_account_code: '62200', vat_rate: 21, supplier_contact_id: 7 },
      ])
    })

    it('does not ask when the other line is a different counterparty', async () => {
      parseBankStatement.mockResolvedValue({
        import: PARSE_RESULT.import,
        lines: [
          { ...PARSE_RESULT.lines[0], id: 31 },
          {
            ...PARSE_RESULT.lines[0], id: 32, counterparty_name: 'Drum Heads BV',
            counterparty_iban: 'NL00TEST0000000009',
          },
        ],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
      await uploadFile()

      await pickTravelOnFirstLine()
      expect(screen.queryByRole('button', { name: 'Apply to all' })).not.toBeInTheDocument()
    })
  })

  describe('applying an income account to a whole relation', () => {
    async function pickMerchOnFirstLine() {
      const user = userEvent.setup()
      await user.click((await screen.findAllByRole('combobox', { name: 'Income account' }))[0])
      await user.click(await screen.findByRole('option', { name: '41100 — Merch revenue' }))
      return user
    }

    it('offers the other incoming lines of that relation and applies the account to all', async () => {
      parseBankStatement.mockResolvedValue({
        import: PARSE_RESULT.import,
        lines: [
          { ...PARSE_RESULT.lines[1], id: 51, counterparty_iban: 'NL39RABO0300065264' },
          {
            ...PARSE_RESULT.lines[1], id: 52, amount_cents: 12500,
            // Same payer, a different name on this line — grouped by IBAN.
            counterparty_name: 'CAFE DE KROON BV', counterparty_iban: 'NL39RABO0300065264',
          },
        ],
      })
      commitBankImport.mockResolvedValue({
        imported: 2, skipped: 0,
        results: [{ line_id: 51, status: 'imported' }, { line_id: 52, status: 'imported' }],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
      await uploadFile()

      const user = await pickMerchOnFirstLine()
      expect(await screen.findByText('Apply to all receipts from Cafe De Kroon?')).toBeInTheDocument()
      expect(screen.getByText(/1 other receipt from Cafe De Kroon/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Apply to all' }))

      await user.click(screen.getByRole('button', { name: 'Import 2 selected' }))
      await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
      expect(commitBankImport.mock.calls[0][1]).toEqual([
        { line_id: 51, action: 'journal_received', contra_account_code: '41100', vat_rate: 9 },
        { line_id: 52, action: 'journal_received', contra_account_code: '41100', vat_rate: 9 },
      ])
    })

    it('leaves the other incoming lines untouched when only this line is kept', async () => {
      parseBankStatement.mockResolvedValue({
        import: PARSE_RESULT.import,
        lines: [
          { ...PARSE_RESULT.lines[1], id: 53 },
          { ...PARSE_RESULT.lines[1], id: 54, amount_cents: 12500 },
        ],
      })
      commitBankImport.mockResolvedValue({
        imported: 2, skipped: 0,
        results: [{ line_id: 53, status: 'imported' }, { line_id: 54, status: 'imported' }],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
      await uploadFile()

      const user = await pickMerchOnFirstLine()
      await user.click(await screen.findByRole('button', { name: 'Only this line' }))

      await user.click(screen.getByRole('button', { name: 'Import 2 selected' }))
      await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
      const [, decisions] = commitBankImport.mock.calls[0]
      expect(decisions.map((d) => d.contra_account_code)).toEqual(['41100', '41000'])
    })

    it('never groups the incoming and outgoing lines of one relation', async () => {
      parseBankStatement.mockResolvedValue({
        import: PARSE_RESULT.import,
        lines: [
          { ...PARSE_RESULT.lines[0], id: 61 },
          {
            ...PARSE_RESULT.lines[1], id: 62, counterparty_name: 'String Supply Co',
            counterparty_iban: 'NL00TEST0000000001',
          },
        ],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getAccountingSettings).toHaveBeenCalled())
      await uploadFile()

      // An expense account is no answer for the receipt from the same party.
      const user = userEvent.setup()
      await user.click(await screen.findByRole('combobox', { name: 'Expense account' }))
      await user.click(await screen.findByRole('option', { name: '62200 — Travel' }))
      expect(screen.queryByRole('button', { name: 'Apply to all' })).not.toBeInTheDocument()
    })
  })

  describe('already-paid bill guard', () => {
    const paidBill = {
      id: 31, receipt_number: 7001, supplier_name: 'String Supply Co',
      total_cents: 3000, paid_at: '2026-02-03',
    }
    const withPaidBill = {
      import: PARSE_RESULT.import,
      lines: [
        {
          ...PARSE_RESULT.lines[0],
          suggestion: { ...emptySuggestion, paidPurchaseMatches: [paidBill] },
        },
        PARSE_RESULT.lines[1],
      ],
    }

    it('warns and preselects skip so the payment is not booked twice', async () => {
      parseBankStatement.mockResolvedValue(withPaidBill)
      commitBankImport.mockResolvedValue({
        imported: 1, skipped: 1,
        results: [{ line_id: 1, status: 'skipped' }, { line_id: 2, status: 'imported' }],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getProfile).toHaveBeenCalled())
      await uploadFile()

      expect(await screen.findByText(/Bill #7001 was already paid on/)).toBeInTheDocument()
      // Only the incoming line is counted as something to book.
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Import 1 selected' }))

      await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
      expect(commitBankImport.mock.calls[0][1]).toEqual([
        { line_id: 1, action: 'skip' },
        { line_id: 2, action: 'journal_received', contra_account_code: '41000', vat_rate: 9 },
      ])
    })

    it('still lets the reviewer book the line explicitly', async () => {
      parseBankStatement.mockResolvedValue(withPaidBill)
      commitBankImport.mockResolvedValue({
        imported: 2, skipped: 0,
        results: [{ line_id: 1, status: 'imported' }, { line_id: 2, status: 'imported' }],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getProfile).toHaveBeenCalled())
      await uploadFile()

      // The skip default must not disable the toggle: pressing Expense hands
      // back the ordinary booking decision.
      const user = userEvent.setup()
      await user.click((await screen.findAllByRole('button', { name: 'Expense' }))[0])
      await user.click(screen.getByRole('button', { name: 'Import 2 selected' }))

      await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
      expect(commitBankImport.mock.calls[0][1][0]).toEqual({
        line_id: 1, action: 'journal_paid', contra_account_code: '62100', vat_rate: 21,
        create_supplier: { name: 'String Supply Co', iban: 'NL00TEST0000000001' },
      })
    })
  })

  describe('per-line VAT', () => {
    it('defaults outgoing lines to the standard rate and incoming to the band rate', async () => {
      parseBankStatement.mockResolvedValue(PARSE_RESULT)
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getProfile).toHaveBeenCalled())
      await uploadFile()

      const vatSelects = await screen.findAllByRole('combobox', { name: 'VAT' })
      expect(vatSelects).toHaveLength(2)
      expect(vatSelects[0]).toHaveTextContent('21%')
      expect(vatSelects[1]).toHaveTextContent('9%')
      // The split shown is the one the server will post: 3000 incl. 21% and
      // 60000 incl. 9%.
      expect(screen.getByText('net € 24,79 · VAT € 5,21')).toBeInTheDocument()
      expect(screen.getByText('net € 550,46 · VAT € 49,54')).toBeInTheDocument()
    })

    it('sends no rate for a line switched to "No VAT"', async () => {
      parseBankStatement.mockResolvedValue(PARSE_RESULT)
      commitBankImport.mockResolvedValue({
        imported: 2, skipped: 0,
        results: [{ line_id: 1, status: 'imported' }, { line_id: 2, status: 'imported' }],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getProfile).toHaveBeenCalled())
      await uploadFile()

      const user = userEvent.setup()
      await user.click((await screen.findAllByRole('combobox', { name: 'VAT' }))[0])
      await user.click(await screen.findByRole('option', { name: 'No VAT' }))
      expect(screen.queryByText('net € 24,79 · VAT € 5,21')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Import 2 selected' }))
      await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
      const [, decisions] = commitBankImport.mock.calls[0]
      expect(decisions[0].vat_rate).toBeNull()
      expect(decisions[1].vat_rate).toBe(9)
    })

    it('offers every rate of the tenant VAT country, not a fixed pair', async () => {
      // A Belgian band: 21 / 12 / 6, and 0 is folded into "No VAT".
      getProfile.mockResolvedValue({ vat_country: 'be', tax_percentage: 6 })
      getAccountingProfile.mockResolvedValue(accountingProfile('be', false))
      parseBankStatement.mockResolvedValue(PARSE_RESULT)
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getProfile).toHaveBeenCalled())
      await uploadFile()

      const user = userEvent.setup()
      await user.click((await screen.findAllByRole('combobox', { name: 'VAT' }))[0])
      const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
      expect(options).toEqual(['No VAT', '21%', '12%', '6%'])
    })

    it('offers no VAT control at all for a band on the KOR', async () => {
      getProfile.mockResolvedValue({ vat_country: 'nl', tax_percentage: 9 })
      getAccountingProfile.mockResolvedValue(accountingProfile('nl', true))
      parseBankStatement.mockResolvedValue(PARSE_RESULT)
      commitBankImport.mockResolvedValue({
        imported: 2, skipped: 0,
        results: [{ line_id: 1, status: 'imported' }, { line_id: 2, status: 'imported' }],
      })
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getProfile).toHaveBeenCalled())
      await uploadFile()

      expect(await screen.findByRole('combobox', { name: 'Expense account' })).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'VAT' })).not.toBeInTheDocument()

      await userEvent.setup().click(screen.getByRole('button', { name: 'Import 2 selected' }))
      await waitFor(() => expect(commitBankImport).toHaveBeenCalled())
      const [, decisions] = commitBankImport.mock.calls[0]
      expect(decisions.map((d) => d.vat_rate)).toEqual([null, null])
    })

    it('books no VAT when the profile cannot be read', async () => {
      getProfile.mockRejectedValue(new Error('offline'))
      getAccountingProfile.mockRejectedValue(new Error('offline'))
      parseBankStatement.mockResolvedValue(PARSE_RESULT)
      wrap(<BankStatementImportDialog onClose={() => {}} />)
      await waitFor(() => expect(getProfile).toHaveBeenCalled())
      await uploadFile()

      // Fails closed on VAT, but the account pickers still load.
      expect(await screen.findByRole('combobox', { name: 'Expense account' })).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'VAT' })).not.toBeInTheDocument()
    })
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
      line_id: 8, action: 'journal_paid', contra_account_code: '62100', vat_rate: 21,
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
