import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../invoices.ts', () => ({
  createInvoicePaymentLink: vi.fn(),
  deleteInvoicePaymentLink: vi.fn(),
  syncInvoicePaymentLink: vi.fn(),
}))

import * as invoicesApi from '../invoices.ts'
import { ThemeModeContext } from '../../../contexts/themeModeContext.ts'
import theme from '../../../theme.ts'
import PaymentLinkPanel from '../components/PaymentLinkPanel.tsx'

const INVOICE = {
  id: 7,
  status: 'sent',
  total_cents: 54500,
  mollie_payment_link_id: 'pl_test123',
  mollie_payment_link_url: 'https://paymentlink.mollie.com/payment/test123',
  mollie_payment_status: 'open',
}

function renderPanel({ invoice = INVOICE, canWrite = true, onUpdated = vi.fn() } = {}) {
  return {
    onUpdated,
    ...render(
      <ThemeProvider theme={theme}>
        <ThemeModeContext.Provider value={{ mode: 'light', toggleTheme: vi.fn(), variant: 'default', setVariant: vi.fn() }}>
          <PaymentLinkPanel invoice={invoice} canWrite={canWrite} onUpdated={onUpdated} />
        </ThemeModeContext.Provider>
      </ThemeProvider>,
    ),
  }
}

describe('PaymentLinkPanel', () => {
  it('creates a payment link and reports the returned invoice patch', async () => {
    const onUpdated = vi.fn()
    const linkedInvoice = { ...INVOICE, mollie_payment_link_id: 'pl_new' }
    invoicesApi.createInvoicePaymentLink.mockResolvedValueOnce(linkedInvoice)
    renderPanel({ invoice: { ...INVOICE, mollie_payment_link_id: null, mollie_payment_link_url: null }, onUpdated })

    await userEvent.click(screen.getByRole('button', { name: /Create payment link/ }))

    await waitFor(() => expect(invoicesApi.createInvoicePaymentLink).toHaveBeenCalledWith(7))
    expect(onUpdated).toHaveBeenCalledWith(linkedInvoice)
  })

  it('maps a payment-link creation error to useful copy', async () => {
    invoicesApi.createInvoicePaymentLink.mockRejectedValueOnce(new Error('mollie_key_missing'))
    renderPanel({ invoice: { ...INVOICE, mollie_payment_link_id: null, mollie_payment_link_url: null } })

    await userEvent.click(screen.getByRole('button', { name: /Create payment link/ }))

    expect(await screen.findByText(/Mollie API key not configured/)).toBeInTheDocument()
  })

  it('maps the payment-link sync response onto payment and invoice status', async () => {
    const onUpdated = vi.fn()
    invoicesApi.syncInvoicePaymentLink.mockResolvedValueOnce({ status: 'paid', invoiceStatus: 'paid' })
    renderPanel({ onUpdated })

    await userEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }))

    await waitFor(() => expect(invoicesApi.syncInvoicePaymentLink).toHaveBeenCalledWith(7))
    expect(onUpdated).toHaveBeenCalledWith({ mollie_payment_status: 'paid', status: 'paid' })
  })

  it('shows a sync failure instead of silently retaining a stale payment status', async () => {
    invoicesApi.syncInvoicePaymentLink.mockRejectedValueOnce(new Error('sync boom'))
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }))

    expect(await screen.findByText('sync boom')).toBeInTheDocument()
  })

  it('removes an unpaid payment link and maps a paid-link rejection', async () => {
    const onUpdated = vi.fn()
    invoicesApi.deleteInvoicePaymentLink.mockResolvedValueOnce({
      ...INVOICE,
      mollie_payment_link_id: null,
      mollie_payment_link_url: null,
      mollie_payment_status: null,
    })
    const { rerender } = renderPanel({ onUpdated })

    await userEvent.click(screen.getByRole('button', { name: 'Remove payment link' }))
    await waitFor(() => expect(invoicesApi.deleteInvoicePaymentLink).toHaveBeenCalledWith(7))
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ mollie_payment_link_id: null }))

    invoicesApi.deleteInvoicePaymentLink.mockRejectedValueOnce(
      Object.assign(new Error('Payment link has a paid payment'), { code: 'payment_link_paid' }),
    )
    rerender(
      <ThemeProvider theme={theme}>
        <ThemeModeContext.Provider value={{ mode: 'light', toggleTheme: vi.fn(), variant: 'default', setVariant: vi.fn() }}>
          <PaymentLinkPanel invoice={INVOICE} onUpdated={onUpdated} />
        </ThemeModeContext.Provider>
      </ThemeProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove payment link' }))
    expect(await screen.findByText(/already been paid/)).toBeInTheDocument()
  })

  it('keeps payment links readable but withholds all mutations from viewers', () => {
    const { rerender } = renderPanel({ canWrite: false })
    expect(screen.getByRole('button', { name: /Copy link/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open payment page' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh payment status' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove payment link' })).toBeNull()

    rerender(
      <ThemeProvider theme={theme}>
        <ThemeModeContext.Provider value={{ mode: 'light', toggleTheme: vi.fn(), variant: 'default', setVariant: vi.fn() }}>
          <PaymentLinkPanel invoice={{ ...INVOICE, mollie_payment_link_id: null, mollie_payment_link_url: null }} canWrite={false} onUpdated={vi.fn()} />
        </ThemeModeContext.Provider>
      </ThemeProvider>,
    )
    expect(screen.queryByRole('button', { name: /Create payment link/ })).toBeNull()
  })

  it('does not offer removing a payment link that is already paid', () => {
    renderPanel({ invoice: { ...INVOICE, mollie_payment_status: 'paid' } })
    expect(screen.queryByRole('button', { name: 'Remove payment link' })).toBeNull()
  })
})
