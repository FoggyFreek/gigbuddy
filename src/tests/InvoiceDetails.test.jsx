import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/invoices.js', () => ({
  createInvoice: vi.fn(async () => ({ id: 1 })),
  createInvoicePaymentLink: vi.fn(),
  deleteInvoice: vi.fn(async () => {}),
  downloadInvoiceEml: vi.fn(),
  getInvoice: vi.fn(),
  getInvoiceEmlDefaults: vi.fn(),
  removeInvoiceLogo: vi.fn(),
  syncInvoicePaymentLink: vi.fn(),
  updateInvoice: vi.fn(async () => ({})),
  uploadInvoiceLogo: vi.fn(),
}))

import * as invoicesApi from '../api/invoices.js'
import InvoiceDetails from '../components/InvoiceDetails.jsx'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const DRAFT = {
  tenant: { id: 1, band_name: 'The Band', applies_kor: false, tax_percentage: 9 },
  draft: {
    gig_id: null,
    issue_date: '2026-05-01',
    due_date: '2026-05-15',
    payment_term_days: 14,
    customer_name: 'Venue BV',
    customer_email: '',
    customer_address_country: 'NL',
    memo: null,
    tax_inclusive: false,
    invert_logo: false,
    discount_type: 'pct',
    discount_pct: 0,
    discount_cents: 0,
    lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: 50000, tax_percentage: 9, position: 0 }],
  },
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

afterEach(() => { vi.clearAllMocks() })

describe('InvoiceDetails', () => {
  it('renders create mode with the draft customer and line', () => {
    wrap(<InvoiceDetails mode="create" draft={DRAFT} onClose={vi.fn()} />)
    expect(screen.getByText('New invoice')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Venue BV')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Optreden')).toBeInTheDocument()
  })

  it('saves a new invoice via createInvoice and closes', async () => {
    const onClose = vi.fn()
    wrap(<InvoiceDetails mode="create" draft={DRAFT} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(invoicesApi.createInvoice).toHaveBeenCalledTimes(1))
    expect(invoicesApi.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ customer_name: 'Venue BV' }),
    )
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('loads and renders an existing invoice in edit mode', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails mode="edit" invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Invoice 2026-0007')).toBeInTheDocument())
    // Payment-link panel is only rendered in edit mode once the invoice loads.
    expect(screen.getByText('Payment link')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create payment link/ })).toBeInTheDocument()
  })

  it('shows a friendly error when payment-link creation fails', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.createInvoicePaymentLink.mockRejectedValueOnce(new Error('mollie_key_missing'))
    wrap(<InvoiceDetails mode="edit" invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Create payment link/ }))
    expect(await screen.findByText(/Mollie API key not configured/)).toBeInTheDocument()
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
    wrap(<InvoiceDetails mode="edit" invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }))
    // Both the payment-status chip and the invoice-status chip move to 'paid'
    // (proving result.status and result.invoiceStatus both flow through onUpdated).
    await waitFor(() => expect(screen.getAllByText('paid')).toHaveLength(2))
  })

  it('shows an error when payment-link sync fails', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(LINKED_INVOICE)
    invoicesApi.syncInvoicePaymentLink.mockRejectedValueOnce(new Error('sync boom'))
    wrap(<InvoiceDetails mode="edit" invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Refresh payment status' }))
    expect(await screen.findByText('sync boom')).toBeInTheDocument()
  })

  it('renders a finalized invoice read-only (no Save, fields disabled)', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(FINALIZED_INVOICE)
    wrap(<InvoiceDetails mode="edit" invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Invoice 2026-0007')).toBeInTheDocument())

    expect(screen.getByText(/This invoice is finalized/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByDisplayValue('Venue BV')).toBeDisabled()
  })

  it('adds and removes invoice lines', async () => {
    wrap(<InvoiceDetails mode="create" draft={DRAFT} onClose={vi.fn()} />)
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
    wrap(<InvoiceDetails mode="edit" invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Invoice 2026-0007')).toBeInTheDocument())

    // The Dialog portals into document.body, so query there (not the container).
    const fileInput = document.querySelector('input[type="file"]')
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(await screen.findByText('upload boom')).toBeInTheDocument()
    expect(invoicesApi.uploadInvoiceLogo).toHaveBeenCalledWith(7, file)
  })

  it('loads the default personal message into the EML dialog', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.getInvoiceEmlDefaults.mockResolvedValueOnce({ personalMessage: 'Hartelijk dank voor de samenwerking.' })
    wrap(<InvoiceDetails mode="edit" invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Invoice 2026-0007')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Download email' }))
    expect(await screen.findByDisplayValue('Hartelijk dank voor de samenwerking.')).toBeInTheDocument()
    expect(invoicesApi.getInvoiceEmlDefaults).toHaveBeenCalledWith(7)
  })
})
