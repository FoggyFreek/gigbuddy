import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../vatReturnsApi.ts', () => ({
  listVatReturns: vi.fn(),
  previewVatReturn: vi.fn(),
  createVatReturn: vi.fn(),
  getVatReturn: vi.fn(),
  recordVatPayment: vi.fn(),
}))
vi.mock('../../accounts/accounts.ts', () => ({
  listAccounts: vi.fn(),
  getAccountingSettings: vi.fn(),
}))

import {
  listVatReturns,
  previewVatReturn,
  createVatReturn,
  getVatReturn,
  recordVatPayment,
} from '../vatReturnsApi.ts'
import { listAccounts, getAccountingSettings } from '../../accounts/accounts.ts'
import VatReturnsPage from '../VatReturnsPage.tsx'
import VatReturnDetailPage from '../VatReturnDetailPage.tsx'
import theme from '../../../theme.ts'

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
    expect(screen.getByTestId('vat-returns-heading')).toBeInTheDocument()

    const q1Row = await screen.findByTestId('vat-return-row-1')
    const q4Row = screen.getByTestId('vat-return-row-2')
    // Unpaid (due 2026-04-30, today 2026-06-11) → overdue; the other is paid.
    // Scope to the rows — the summary cards repeat the status labels.
    expect(q1Row).toHaveAttribute('data-status', 'overdue')
    expect(q4Row).toHaveAttribute('data-status', 'paid')
    // Amounts appear in both the summary cards and the rows.
    expect(q1Row).toHaveAttribute('data-net-cents', '21000')
    expect(q4Row).toHaveAttribute('data-net-cents', '52000')
  })

  it('summary cards filter the list by settlement state', async () => {
    const user = userEvent.setup()
    wrap(<VatReturnsPage />)
    await screen.findByTestId('vat-return-row-1')

    // Cards show counts and totals per state.
    expect(screen.getByTestId('vat-summary-all')).toHaveAttribute('data-count', '2')
    expect(screen.getByTestId('vat-summary-open')).toHaveAttribute('data-count', '0')

    // Q1 2026 is overdue, Q4 2025 is paid → the Settled card hides Q1.
    await user.click(screen.getByTestId('vat-summary-settled'))
    expect(screen.queryByTestId('vat-return-row-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('vat-return-row-2')).toBeInTheDocument()

    await user.click(screen.getByTestId('vat-summary-all'))
    expect(screen.getByTestId('vat-return-row-1')).toBeInTheDocument()
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
    await screen.findByTestId('vat-returns-empty')

    await user.click(screen.getByTestId('new-vat-return'))

    // Defaults to the previous quarter (today 2026-06-11 → Q1 2026).
    await waitFor(() => expect(previewVatReturn).toHaveBeenCalledWith(2026, 1))
    expect(screen.getByTestId('vat-preview-output')).toHaveAttribute('data-cents', '42000')
    expect(screen.getByTestId('vat-preview-input')).toHaveAttribute('data-cents', '21000')
    // € 210,00 appears as both the input VAT and the net amount.
    expect(screen.getByTestId('vat-preview-net')).toHaveAttribute('data-cents', '21000')
    expect(screen.getByTestId('vat-preview-net')).toHaveAttribute('data-direction', 'payable')

    await user.click(screen.getByTestId('settle-vat-quarter'))

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
    await screen.findByTestId('vat-returns-empty')

    await user.click(screen.getByTestId('new-vat-return'))

    await screen.findByTestId('vat-quarter-not-ended')
    expect(screen.getByTestId('settle-vat-quarter')).toBeDisabled()
  })

  it('shows worksheet box descriptions with the same formatted columns as the detail page', async () => {
    const user = userEvent.setup()
    listVatReturns.mockResolvedValue([])
    previewVatReturn.mockResolvedValue({
      year: 2026,
      quarter: 1,
      period_from: '2026-01-01',
      period_to: '2026-03-31',
      due_date: '2026-04-30',
      output_vat_cents: 2100,
      input_vat_cents: 0,
      net_cents: 2100,
      direction: 'payable',
      period_ended: true,
      calculation_mode: 'category_workpaper',
      boxes: {
        '1a': {
          description: 'Leveringen/diensten belast met hoog tarief',
          section: { id: '1', title: 'Rubriek 1: Prestaties binnenland' },
          base_declared_euros: 100,
          vat_declared_euros: 21,
        },
      },
      exceptions: [],
      facts: [{ id: 1, classification_status: 'confirmed' }],
    })

    wrap(<VatReturnsPage />)
    await screen.findByTestId('vat-returns-empty')
    await user.click(screen.getByTestId('new-vat-return'))

    const headers = await screen.findByTestId('vat-box-column-headers')
    expect(within(headers).getByText('Box')).toBeInTheDocument()
    expect(within(headers).getByText('Description')).toBeInTheDocument()
    expect(within(headers).getByText('Turnover')).toBeInTheDocument()
    expect(within(headers).getByText('VAT')).toBeInTheDocument()
    expect(screen.getByTestId('vat-box-section-1')).toHaveTextContent('Rubriek 1: Prestaties binnenland')
    const description = screen.getByText('Leveringen/diensten belast met hoog tarief')
    expect(description).toBeInTheDocument()
    expect(within(description.parentElement).getByText(/100,00/)).toBeInTheDocument()
    expect(within(description.parentElement).getByText(/21,00/)).toBeInTheDocument()
  })

  it('record payment defaults to the primary checking account and posts', async () => {
    const user = userEvent.setup()
    getVatReturn.mockResolvedValue({ ...PAYABLE_RETURN, payments: [], ledger_transaction_id: 77 })
    recordVatPayment.mockResolvedValue({ id: 9 })
    wrap(<VatReturnsPage />)
    const row = await screen.findByTestId('vat-return-row-1')

    await user.click(row)
    await waitFor(() => expect(getVatReturn).toHaveBeenCalledWith(1))
    expect(screen.getByTestId('vat-ledger-entry-link')).toBeInTheDocument()

    await user.click(screen.getByTestId('record-vat-settlement'))

    // Bank picker defaults to the settings' checking account.
    await waitFor(() =>
      expect(within(screen.getByTestId('vat-bank-account')).getByRole('combobox')).toHaveTextContent('11000'),
    )

    await user.click(screen.getByTestId('submit-vat-settlement'))

    await waitFor(() =>
      expect(recordVatPayment).toHaveBeenCalledWith(1, {
        amount_cents: 21000,
        paid_on: '2026-06-11',
        direction: 'payment',
        bank_account_code: '11000',
      }),
    )
  })

  it('shows country-pack descriptions beside VAT return boxes', async () => {
    const user = userEvent.setup()
    getVatReturn.mockResolvedValue({
      ...PAYABLE_RETURN,
      workflow_status: 'submitted',
      calculation_mode: 'category_workpaper',
      schema_version: 'nl-ob-2026.1',
      payments: [],
      boxes: [{
        box_code: '1a',
        description: 'Leveringen/diensten belast met hoog tarief',
        section: { id: '1', title: 'Rubriek 1: Prestaties binnenland' },
        base_declared_euros: 100,
        vat_declared_euros: 21,
      }],
    })
    wrap(<VatReturnsPage />)

    await user.click(await screen.findByTestId('vat-return-row-1'))

    const headers = await screen.findByTestId('vat-box-column-headers')
    expect(within(headers).getByText('Box')).toBeInTheDocument()
    expect(within(headers).getByText('Description')).toBeInTheDocument()
    expect(within(headers).getByText('Turnover')).toBeInTheDocument()
    expect(within(headers).getByText('VAT')).toBeInTheDocument()
    expect(screen.getByTestId('vat-box-section-1')).toHaveTextContent('Rubriek 1: Prestaties binnenland')
    expect(await screen.findByText('Leveringen/diensten belast met hoog tarief')).toBeInTheDocument()
    expect(screen.getByText(/100,00/)).toBeInTheDocument()
    expect(screen.getByText(/21,00/)).toBeInTheDocument()
  })

  it('translates VAT workpaper exception codes', async () => {
    const user = userEvent.setup()
    getVatReturn.mockResolvedValue({
      ...PAYABLE_RETURN,
      workflow_status: 'prepared',
      calculation_mode: 'category_workpaper',
      payments: [],
      boxes: [],
      exceptions_snapshot: [{ key: 'prior_period_amendments', blocking: false, count: 2 }],
      acknowledgements: [],
    })
    wrap(<VatReturnsPage />)

    await user.click(await screen.findByTestId('vat-return-row-1'))

    expect(await screen.findByText('Prior-period amendments (2)')).toBeInTheDocument()
    expect(screen.queryByText(/prior_period_amendments/)).not.toBeInTheDocument()
  })
})
