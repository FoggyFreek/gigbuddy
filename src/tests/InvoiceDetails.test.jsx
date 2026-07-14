import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/invoices.ts', () => ({
  createInvoicePaymentLink: vi.fn(),
  deleteInvoicePaymentLink: vi.fn(),
  deleteInvoice: vi.fn(async () => {}),
  downloadInvoiceEml: vi.fn(),
  getInvoice: vi.fn(),
  getInvoiceEmlDefaults: vi.fn(),
  removeInvoiceLogo: vi.fn(),
  syncInvoicePaymentLink: vi.fn(),
  updateInvoice: vi.fn(async () => ({})),
  uploadInvoiceLogo: vi.fn(),
}))

vi.mock('../utils/compressImage.ts', () => ({
  compressLogo: vi.fn(async (file) => new File([file], `compressed-${file.name}`, { type: file.type })),
}))

import * as invoicesApi from '../api/invoices.ts'
import { compressLogo } from '../utils/compressImage.ts'
import InvoiceDetails from '../components/InvoiceDetails.tsx'
import i18n from '../i18n/index.ts'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const EDIT_INVOICE = {
  id: 7,
  invoice_number: '2026-0007',
  status: 'draft',
  finalized_at: null,
  issue_date: '2026-05-01',
  due_date: '2026-05-15',
  payment_term_days: 14,
  customer_name: 'Venue BV',
  tax_inclusive: false,
  discount_type: 'pct',
  discount_pct: 0,
  discount_cents: 0,
  total_cents: 54500,
  pdf_path: null,
  tenant: { id: 1, band_name: 'The Band', applies_kor: false, tax_percentage: 9 },
  lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: 50000, tax_percentage: 9, position: 0 }],
}

const LINKED_INVOICE = {
  ...EDIT_INVOICE,
  status: 'sent',
  finalized_at: '2026-05-02T00:00:00.000Z',
  mollie_payment_link_id: 'pl_test123',
  mollie_payment_link_url: 'https://paymentlink.mollie.com/payment/test123',
  mollie_payment_status: 'open',
}

const FINALIZED_INVOICE = {
  ...EDIT_INVOICE,
  status: 'sent',
  finalized_at: '2026-05-02T00:00:00.000Z',
}

afterEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

describe('InvoiceDetails', () => {
  it('saves invoice changes via updateInvoice and closes', async () => {
    const onClose = vi.fn()
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(invoicesApi.updateInvoice).toHaveBeenCalledTimes(1))
    expect(invoicesApi.updateInvoice).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ customer_name: 'Venue BV' }),
    )
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('loads and renders an existing invoice in edit mode', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())
    // Payment-link panel is only rendered in edit mode once the invoice loads.
    expect(screen.getByText('Payment link')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create payment link/ })).toBeInTheDocument()
  })

  it('shows a friendly error when payment-link creation fails', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.createInvoicePaymentLink.mockRejectedValueOnce(new Error('mollie_key_missing'))
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Create payment link/ }))
    expect(await screen.findByText(/Mollie API key not configured/)).toBeInTheDocument()
  })

  it('immediately renders the payment link returned after successful creation', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.createInvoicePaymentLink.mockResolvedValueOnce(LINKED_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Create payment link/ }))

    expect(await screen.findByText(LINKED_INVOICE.mollie_payment_link_url)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open payment page' })).toHaveAttribute(
      'href', LINKED_INVOICE.mollie_payment_link_url,
    )
    expect(screen.getByRole('button', { name: 'Remove payment link' })).toBeInTheDocument()
  })

  it('reflects a successful payment-link sync (maps the API response shape)', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(LINKED_INVOICE)
    // Real sync response shape: { paymentLinkId, paymentLinkUrl, paymentId, status, paidAt, invoiceStatus }
    invoicesApi.syncInvoicePaymentLink.mockResolvedValueOnce({
      paymentLinkId: 'pl_test123',
      paymentLinkUrl: LINKED_INVOICE.mollie_payment_link_url,
      paymentId: 'tr_paid789',
      status: 'paid',
      paidAt: '2026-05-15T10:00:00.000Z',
      invoiceStatus: 'paid',
    })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }))
    // Both the payment-status chip and the invoice-status chip move to 'paid'
    // (proving result.status and result.invoiceStatus both flow through onUpdated).
    await waitFor(() => expect(screen.getAllByText('paid')).toHaveLength(2))
  })

  it('shows an error when payment-link sync fails', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(LINKED_INVOICE)
    invoicesApi.syncInvoicePaymentLink.mockRejectedValueOnce(new Error('sync boom'))
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }))
    expect(await screen.findByText('sync boom')).toBeInTheDocument()
  })

  it('renders a finalized invoice read-only (no Save, fields disabled)', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(FINALIZED_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    expect(screen.getByText(/This invoice is finalized/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByDisplayValue('Venue BV')).toBeDisabled()
  })

  it('adds and removes invoice lines', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    expect(screen.getAllByPlaceholderText(/Start typing/)).toHaveLength(1)
    // With a single line the remove control is disabled.
    expect(screen.getByLabelText('remove line')).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getAllByPlaceholderText(/Start typing/)).toHaveLength(2)

    await userEvent.click(screen.getAllByLabelText('remove line')[0])
    expect(screen.getAllByPlaceholderText(/Start typing/)).toHaveLength(1)
  })

  it('surfaces a logo upload error', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.uploadInvoiceLogo.mockRejectedValueOnce(new Error('upload boom'))
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    const fileInput = document.querySelector('input[type="file"]')
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(await screen.findByText('upload boom')).toBeInTheDocument()
    expect(compressLogo).toHaveBeenCalledWith(file)
    expect(invoicesApi.uploadInvoiceLogo).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ name: 'compressed-logo.png', type: 'image/png' }),
    )
  })

  it('removes the payment link via the remove button', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(LINKED_INVOICE)
    invoicesApi.deleteInvoicePaymentLink.mockResolvedValueOnce({
      ...LINKED_INVOICE,
      mollie_payment_link_id: null,
      mollie_payment_link_url: null,
      mollie_payment_status: null,
    })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Remove payment link' }))
    await waitFor(() => expect(invoicesApi.deleteInvoicePaymentLink).toHaveBeenCalledWith(7))
    // Back to the create state once the link columns are cleared.
    expect(await screen.findByRole('button', { name: /Create payment link/ })).toBeInTheDocument()
  })

  it('shows a friendly message when the link turns out to be paid', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(LINKED_INVOICE)
    invoicesApi.deleteInvoicePaymentLink.mockRejectedValueOnce(
      Object.assign(new Error('Payment link has a paid payment'), { code: 'payment_link_paid' }),
    )
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Remove payment link' }))
    expect(await screen.findByText(/already been paid/)).toBeInTheDocument()
  })

  it('does not offer the remove button for a paid link', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce({ ...LINKED_INVOICE, mollie_payment_status: 'paid' })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Remove payment link' })).toBeNull()
  })

  it('asks for confirmation before voiding and only PATCHes after confirm', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(FINALIZED_INVOICE)
    invoicesApi.updateInvoice.mockResolvedValueOnce({ ...FINALIZED_INVOICE, status: 'void' })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    // Click the "Void" status action → dialog appears, nothing PATCHed yet.
    await userEvent.click(screen.getByRole('button', { name: 'Void' }))
    expect(await screen.findByText(/Void invoice 2026-0007\?/)).toBeInTheDocument()
    expect(screen.getByText(/voiding is permanent/i)).toBeInTheDocument()
    expect(screen.getByText(/reversing entry is posted/i)).toBeInTheDocument()
    expect(invoicesApi.updateInvoice).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Void invoice' }))
    await waitFor(() => expect(invoicesApi.updateInvoice).toHaveBeenCalledWith(7, { status: 'void' }))
  })

  it('cancelling the void dialog leaves the invoice untouched', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(FINALIZED_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Void' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(invoicesApi.updateInvoice).not.toHaveBeenCalled()
  })

  it('confirms the consequences before marking a draft as sent', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.updateInvoice.mockResolvedValueOnce({ ...EDIT_INVOICE, status: 'sent' })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    // Click the "Mark as sent" status action → consequences dialog, nothing PATCHed yet.
    await userEvent.click(screen.getByRole('button', { name: 'Mark as sent' }))
    expect(await screen.findByText(/Mark invoice 2026-0007 as sent\?/)).toBeInTheDocument()
    expect(screen.getByText(/invoice is finalized/i)).toBeInTheDocument()
    expect(invoicesApi.updateInvoice).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }))
    await waitFor(() => expect(invoicesApi.updateInvoice).toHaveBeenCalledWith(7, { status: 'sent' }))
  })

  it('hides the "Use alternative logo" toggle when the tenant has no alternative logo', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())
    expect(screen.queryByLabelText('Use alternative logo')).toBeNull()
  })

  it('shows the "Use alternative logo" toggle and switches the preview when tenant has an alternative logo', async () => {
    const invoiceWithLogos = {
      ...EDIT_INVOICE,
      tenant: {
        ...EDIT_INVOICE.tenant,
        logo_path: 'logo/light.png',
        logo_dark_path: 'logo/dark.png',
      },
    }
    invoicesApi.getInvoice.mockResolvedValueOnce(invoiceWithLogos)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    const toggle = screen.getByLabelText('Use alternative logo')
    expect(toggle).not.toBeChecked()
    // Preview shows the light logo initially.
    expect(screen.getByAltText('Invoice logo').src).toContain('/api/files/logo/light.png')

    await userEvent.click(toggle)

    // Preview now shows the dark logo.
    expect(screen.getByAltText('Invoice logo').src).toContain('/api/files/logo/dark.png')
  })

  it('loads the default personal message into the EML dialog', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.getInvoiceEmlDefaults.mockResolvedValueOnce({ personalMessage: 'Hartelijk dank voor de samenwerking.' })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Download email' }))
    expect(await screen.findByDisplayValue('Hartelijk dank voor de samenwerking.')).toBeInTheDocument()
    expect(invoicesApi.getInvoiceEmlDefaults).toHaveBeenCalledWith(7)
  })

  it('renders the invoice editor in Dutch', async () => {
    await i18n.changeLanguage('nl')
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())
    expect(screen.getByLabelText('Factuurdatum')).toBeInTheDocument()
    expect(screen.getByText('Klant')).toBeInTheDocument()
    expect(screen.getByText('Regels')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wijzigingen opslaan' })).toBeInTheDocument()
    expect(screen.getByText('Betaallink')).toBeInTheDocument()
  })
})
