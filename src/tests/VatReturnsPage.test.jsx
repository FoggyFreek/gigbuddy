import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/vatReturns.js', () => ({
  listVatReturns: vi.fn(),
  previewVatReturn: vi.fn(),
  createVatReturn: vi.fn(),
  getVatReturn: vi.fn(),
  recordVatPayment: vi.fn(),
}))
vi.mock('../api/accounts.js', () => ({
  listAccounts: vi.fn(),
  getAccountingSettings: vi.fn(),
}))

import {
  listVatReturns,
  previewVatReturn,
  createVatReturn,
  getVatReturn,
  recordVatPayment,
} from '../api/vatReturns.js'
import { listAccounts, getAccountingSettings } from '../api/accounts.js'
import VatReturnsPage from '../pages/VatReturnsPage.jsx'
import VatReturnDetailPage from '../pages/VatReturnDetailPage.jsx'
import theme from '../theme.js'

const PAYABLE_RETURN = {
  id: 1,
  year: 2026,
  quarter: 1,
  period_from: '2026-01-01',
  period_to: '2026-03-31',
  input_vat_cents: 21000,
  output_vat_cents: 42000,
  net_cents: 21000,
  direction: 'payable',
  settlement_account_code: '24010',
  due_date: '2026-04-30',
  status: 'unpaid',
  paid_cents: 0,
}

const PAID_RETURN = {
  ...PAYABLE_RETURN,
  id: 2,
  year: 2025,
  quarter: 4,
  net_cents: 52000,
  due_date: '2026-01-31',
  status: 'paid',
  paid_cents: 52000,
}

const ACCOUNTS = [
  { id: 1, code: '11000', name: 'Primary Bank Account', type: 'asset', is_active: true },
  { id: 2, code: '12000', name: 'Inventory', type: 'asset', is_active: true },
  { id: 3, code: '41000', name: 'Gig fees', type: 'revenue', is_active: true },
]

function wrap(ui) {
  return render(
    <MemoryRouter initialEntries={['/vat-returns']}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/vat-returns" element={ui}>
            <Route path=":id" element={<VatReturnDetailPage />} />
          </Route>
          <Route path="/ledger/:id" element={<div>ledger-detail-route</div>} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'))
  listVatReturns.mockResolvedValue([PAYABLE_RETURN, PAID_RETURN])
  listAccounts.mockResolvedValue(ACCOUNTS)
  getAccountingSettings.mockResolvedValue({ primary_checking_account_code: '11000' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('VatReturnsPage', () => {
  it('lists filed quarters with status and net amount', async () => {
    wrap(<VatReturnsPage />)
    expect(screen.getByRole('heading', { name: /vat declarations/i })).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('1st quarter 2026')).toBeInTheDocument())
    expect(screen.getByText('4th quarter 2025')).toBeInTheDocument()
    // Unpaid (due 2026-04-30, today 2026-06-11) → overdue; the other is paid.
    // Scope to the rows — the summary cards repeat the status labels.
    const q1Row = screen.getByText('1st quarter 2026').closest('div')
    expect(within(q1Row).getByText('Overdue')).toBeInTheDocument()
    const q4Row = screen.getByText('4th quarter 2025').closest('div')
    expect(within(q4Row).getByText('Paid')).toBeInTheDocument()
    // Amounts appear in both the summary cards and the rows.
    expect(within(q1Row.parentElement).getByText(/210,00/)).toBeInTheDocument()
    expect(within(q4Row.parentElement).getByText(/520,00/)).toBeInTheDocument()
  })

  it('summary cards filter the list by settlement state', async () => {
    const user = userEvent.setup()
    wrap(<VatReturnsPage />)
    await waitFor(() => expect(screen.getByText('1st quarter 2026')).toBeInTheDocument())

    // Cards show counts and totals per state.
    expect(screen.getByText('All declarations')).toBeInTheDocument()
    expect(screen.getByText('Ready to pay / receive')).toBeInTheDocument()

    // Q1 2026 is overdue, Q4 2025 is paid → the Settled card hides Q1.
    await user.click(screen.getByText('Settled'))
    expect(screen.queryByText('1st quarter 2026')).not.toBeInTheDocument()
    expect(screen.getByText('4th quarter 2025')).toBeInTheDocument()

    await user.click(screen.getByText('All declarations'))
    expect(screen.getByText('1st quarter 2026')).toBeInTheDocument()
  })

  it('new declaration: shows the quarter breakdown and files via createVatReturn', async () => {
    const user = userEvent.setup()
    listVatReturns.mockResolvedValue([])
    previewVatReturn.mockResolvedValue({
      year: 2026,
      quarter: 1,
      period_from: '2026-01-01',
      period_to: '2026-03-31',
      due_date: '2026-04-30',
      output_vat_cents: 42000,
      input_vat_cents: 21000,
      net_cents: 21000,
      direction: 'payable',
      period_ended: true,
    })
    createVatReturn.mockResolvedValue(PAYABLE_RETURN)
    wrap(<VatReturnsPage />)
    await waitFor(() => expect(screen.getByText(/no vat declarations/i)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /new declaration/i }))

    // Defaults to the previous quarter (today 2026-06-11 → Q1 2026).
    await waitFor(() => expect(previewVatReturn).toHaveBeenCalledWith(2026, 1))
    expect(screen.getByText(/output vat/i)).toBeInTheDocument()
    expect(screen.getByText(/420,00/)).toBeInTheDocument()
    expect(screen.getByText(/input vat/i)).toBeInTheDocument()
    // € 210,00 appears as both the input VAT and the net amount.
    expect(screen.getAllByText(/210,00/)).toHaveLength(2)
    expect(screen.getByText('To pay')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /settle quarter/i }))

    await waitFor(() => expect(createVatReturn).toHaveBeenCalledWith({ year: 2026, quarter: 1 }))
    // The list reloads after filing.
    expect(listVatReturns).toHaveBeenCalledTimes(2)
  })

  it('an unfinished quarter cannot be settled', async () => {
    const user = userEvent.setup()
    listVatReturns.mockResolvedValue([])
    previewVatReturn.mockResolvedValue({
      year: 2026,
      quarter: 1,
      period_from: '2026-01-01',
      period_to: '2026-03-31',
      due_date: '2026-04-30',
      output_vat_cents: 1000,
      input_vat_cents: 0,
      net_cents: 1000,
      direction: 'payable',
      period_ended: false,
    })
    wrap(<VatReturnsPage />)
    await waitFor(() => expect(screen.getByText(/no vat declarations/i)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /new declaration/i }))

    await waitFor(() => expect(screen.getByText(/has not ended yet/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /settle quarter/i })).toBeDisabled()
  })

  it('record payment defaults to the primary checking account and posts', async () => {
    const user = userEvent.setup()
    getVatReturn.mockResolvedValue({ ...PAYABLE_RETURN, payments: [], ledger_transaction_id: 77 })
    recordVatPayment.mockResolvedValue({ id: 9 })
    wrap(<VatReturnsPage />)
    await waitFor(() => expect(screen.getByText('1st quarter 2026')).toBeInTheDocument())

    await user.click(screen.getByText('1st quarter 2026'))
    await waitFor(() => expect(getVatReturn).toHaveBeenCalledWith(1))
    expect(screen.getByText(/view settlement ledger entry/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /record payment/i }))

    // Bank picker defaults to the settings' checking account.
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /from account/i })).toHaveTextContent('11000'),
    )

    const dialogs = screen.getAllByRole('dialog')
    const payDialog = dialogs[dialogs.length - 1]
    await user.click(within(payDialog).getByRole('button', { name: /record payment/i }))

    await waitFor(() =>
      expect(recordVatPayment).toHaveBeenCalledWith(1, {
        amount_cents: 21000,
        paid_on: '2026-06-11',
        direction: 'payment',
        bank_account_code: '11000',
      }),
    )
  })
})
