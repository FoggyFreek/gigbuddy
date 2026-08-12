import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../accounts/accounts.ts', () => ({
  listAccounts: vi.fn(),
  getAccountingSettings: vi.fn(),
}))

vi.mock('../../ledger/ledger.ts', () => ({
  reclassifyLedgerEntry: vi.fn(),
}))

import * as accountsApi from '../../accounts/accounts.ts'
import ReclassifyDialog from '../../ledger/components/ReclassifyDialog.tsx'
import RecordVatPaymentDialog from '../components/RecordVatPaymentDialog.tsx'
import theme from '../../../theme.ts'

const ACCOUNTS = [
  { id: 1, code: '11000', name: 'Bank', type: 'asset', is_active: true },
  { id: 2, code: '15000', name: 'Input VAT', type: 'asset', is_active: true },
  { id: 3, code: '24000', name: 'Output VAT', type: 'liability', is_active: true },
  { id: 4, code: '62100', name: 'Expense', type: 'expense', is_active: true },
  { id: 5, code: '64200', name: 'Other expense', type: 'expense', is_active: true },
]

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

beforeEach(() => {
  accountsApi.listAccounts.mockResolvedValue(ACCOUNTS)
  accountsApi.getAccountingSettings.mockResolvedValue({
    primary_checking_account_code: '11000',
    input_vat_account_code: '15000',
    output_vat_account_code: '24000',
  })
})

describe('VAT control account filtering', () => {
  it('excludes VAT control accounts from VAT-return bank selection', async () => {
    const user = userEvent.setup()
    wrap(<RecordVatPaymentDialog
      vatReturn={{ id: 1, direction: 'payable', net_cents: 1000, paid_cents: 0, year: 2026, quarter: 1 }}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
    />)

    await user.click(await screen.findByRole('combobox', { name: /from account/i }))
    expect(screen.getByRole('option', { name: /11000/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /15000/ })).not.toBeInTheDocument()
  })

  it('excludes VAT lines and destinations from reclassification', async () => {
    const user = userEvent.setup()
    wrap(<ReclassifyDialog
      entryId={1}
      lines={[
        { id: 10, account_code: '15000', account_name: 'Input VAT', debit_cents: 2100, credit_cents: 0, reclassification: null },
        { id: 11, account_code: '62100', account_name: 'Expense', debit_cents: 10000, credit_cents: 0, reclassification: null },
      ]}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />)

    const source = await screen.findByRole('combobox', { name: /ledger line/i })
    await user.click(source)
    expect(screen.queryByRole('option', { name: /15000/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /62100/ })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('combobox', { name: /destination account/i }))
    expect(await screen.findByRole('option', { name: /64200/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /15000/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /24000/ })).not.toBeInTheDocument()
  })
})
