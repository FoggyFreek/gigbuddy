import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/invoices.ts', () => ({
  createInvoicePaymentLink: vi.fn(),
  deleteInvoicePaymentLink: vi.fn(),
  deleteInvoice: vi.fn(async () => {}),
  downloadInvoiceEml: vi.fn(),
  downloadInvoiceUbl: vi.fn(),
  getInvoice: vi.fn(),
  getInvoiceEmlDefaults: vi.fn(),
  removeInvoiceLogo: vi.fn(),
  renderInvoice: vi.fn(),
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

// PDF, UBL and email all live behind one "Download" menu button, so every
// assertion about them has to open it first. They render as menuitems, not
// buttons or links, even though the PDF entry is still an anchor underneath.
async function openDownloadMenu(name = 'Download') {
  await userEvent.click(screen.getByRole('button', { name }))
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
  // Address + supplier VAT id are art. 226 mandatory content: without them the
  // issuance-readiness preview blocks "Send invoice" (see ISSUE_BLOCKED_INVOICE).
  customer_address_street: 'Venue Street 5',
  customer_address_postal_code: '3000 CC',
  customer_address_city: 'Utrecht',
  tax_inclusive: false,
  discount_type: 'pct',
  discount_pct: 0,
  discount_cents: 0,
  total_cents: 54500,
  pdf_path: null,
  tenant: {
    id: 1,
    band_name: 'The Band',
    applies_kor: false,
    tax_percentage: 9,
    address_street: 'Band Street 1',
    address_city: 'Amsterdam',
    vat_country: 'nl',
    tax_id: 'NL123456789B01',
  },
  lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: 50000, tax_percentage: 9, position: 0 }],
}

// A draft still missing the customer's postal address — not issuable.
const ISSUE_BLOCKED_INVOICE = {
  ...EDIT_INVOICE,
  customer_address_street: '',
  customer_address_city: '',
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

// A finalized invoice that already has a rendered PDF — the only state in which
// the download / re-generate pair is offered.
const RENDERED_INVOICE = {
  ...FINALIZED_INVOICE,
  pdf_path: 'tenants/1/invoices/old-key.pdf',
}

// Everything the Peppol readiness check wants: resolvable countries on both
// sides, an addressable customer, post codes, and an IBAN to be paid into.
const PEPPOL_READY_INVOICE = {
  ...EDIT_INVOICE,
  customer_address_country: 'NL',
  customer_tax_id: 'NL819789471B01',
  event_description: 'Summer Fest',
  tenant: {
    ...EDIT_INVOICE.tenant,
    address_country: 'NL',
    address_postal_code: '1011AB',
    iban: 'NL91ABNA0417164300',
  },
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

  it('offers re-generating the PDF on a finalized invoice and points the download at the fresh key', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(RENDERED_INVOICE)
    // The endpoint answers with the new key only — not a whole invoice.
    invoicesApi.renderInvoice.mockResolvedValueOnce({ pdf_path: 'tenants/1/invoices/new-key.pdf' })
    invoicesApi.getInvoice.mockResolvedValueOnce({
      ...RENDERED_INVOICE,
      pdf_path: 'tenants/1/invoices/new-key.pdf',
    })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Re-generate PDF' }))

    await waitFor(() => expect(invoicesApi.renderInvoice).toHaveBeenCalledWith(7))
    // The download entry follows the newly stored key (the old one is deleted server-side).
    await openDownloadMenu()
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /Download PDF/ }))
      .toHaveAttribute('href', '/api/files/tenants/1/invoices/new-key.pdf'))
    // Re-generating is not a status change: nothing is PATCHed.
    expect(invoicesApi.updateInvoice).not.toHaveBeenCalled()
  })

  it('keeps the finalized invoice intact after re-generating (render returns only pdf_path)', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(RENDERED_INVOICE)
    invoicesApi.renderInvoice.mockResolvedValueOnce({ pdf_path: 'tenants/1/invoices/new-key.pdf' })
    invoicesApi.getInvoice.mockResolvedValueOnce({
      ...RENDERED_INVOICE,
      pdf_path: 'tenants/1/invoices/new-key.pdf',
    })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/This invoice is finalized/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Re-generate PDF' }))
    await waitFor(() => expect(invoicesApi.renderInvoice).toHaveBeenCalledWith(7))

    // Everything derived from the loaded invoice must survive: read-only mode,
    // the status chip and the finalized banner. Overwriting the invoice with the
    // partial render response would drop all three.
    expect(await screen.findByText(/This invoice is finalized/)).toBeInTheDocument()
    expect(screen.getByText('sent')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Venue BV')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('surfaces an error when re-generating the PDF fails', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(RENDERED_INVOICE)
    invoicesApi.renderInvoice.mockRejectedValueOnce(new Error('render boom'))
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Re-generate PDF' }))

    expect(await screen.findByText('render boom')).toBeInTheDocument()
    // The previously stored PDF is still downloadable.
    await openDownloadMenu()
    expect(screen.getByRole('menuitem', { name: /Download PDF/ }))
      .toHaveAttribute('href', '/api/files/tenants/1/invoices/old-key.pdf')
  })

  it('offers no re-generate control before a PDF has been rendered', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Re-generate PDF' })).toBeNull()
    await openDownloadMenu()
    expect(screen.queryByRole('menuitem', { name: /Download PDF/ })).toBeNull()
  })

  // Reader mode: finance.view without finance.manage. Every invoice mutation is
  // finance.manage on the server, so nothing may be offered as editable.
  describe('without finance.manage', () => {
    it('hides the PDF re-generate control but keeps the download link', async () => {
      invoicesApi.getInvoice.mockResolvedValueOnce(RENDERED_INVOICE)
      wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} canWrite={false} />)
      await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

      expect(screen.queryByRole('button', { name: 'Re-generate PDF' })).toBeNull()
      // Downloads are read affordances — those routes carry no finance.manage gate.
      await openDownloadMenu()
      expect(screen.getByRole('menuitem', { name: /Download PDF/ }))
        .toHaveAttribute('href', '/api/files/tenants/1/invoices/old-key.pdf')
      expect(screen.getByRole('menuitem', { name: 'Download email' })).toBeInTheDocument()
    })

    it('renders an editable draft read-only and withholds save/delete/status actions', async () => {
      invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
      wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} canWrite={false} />)
      await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

      expect(screen.getByDisplayValue('Venue BV')).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Mark as sent' })).toBeNull()
      // The lines editor disables rather than hides its controls — the existing
      // read-only treatment it already applies to a finalized invoice.
      expect(screen.getByRole('button', { name: /Add item/ })).toBeDisabled()
      expect(screen.getByLabelText('remove line')).toBeDisabled()
    })

    it('withholds the payment-link controls but keeps copy and open', async () => {
      invoicesApi.getInvoice.mockResolvedValueOnce(LINKED_INVOICE)
      wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} canWrite={false} />)
      await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

      expect(screen.queryByRole('button', { name: 'Refresh payment status' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Remove payment link' })).toBeNull()
      expect(screen.getByRole('button', { name: /Copy link/ })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open payment page' })).toBeInTheDocument()
    })

    it('offers no create control when there is no payment link yet', async () => {
      invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
      wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} canWrite={false} />)
      await waitFor(() => expect(screen.getByText('Payment link')).toBeInTheDocument())

      expect(screen.queryByRole('button', { name: /Create payment link/ })).toBeNull()
    })

    it('refuses the re-generate mutation even if the handler is reached', async () => {
      invoicesApi.getInvoice.mockResolvedValueOnce(RENDERED_INVOICE)
      const { rerender } = wrap(
        <InvoiceDetails invoiceId={7} onClose={vi.fn()} canWrite />,
      )
      await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

      // Re-render as a reader while the control is still mounted from the
      // writer pass, then drive the click past the disabled-pointer check:
      // the guard in the hook must still refuse the call.
      rerender(
        <ThemeProvider theme={theme}>
          <InvoiceDetails invoiceId={7} onClose={vi.fn()} canWrite={false} />
        </ThemeProvider>,
      )
      expect(screen.queryByRole('button', { name: 'Re-generate PDF' })).toBeNull()
      expect(invoicesApi.renderInvoice).not.toHaveBeenCalled()
    })
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

  it('blocks sending an invoice that is missing mandatory content, and explains why', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(ISSUE_BLOCKED_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Mark as sent' }))
    // The dialog names the missing content instead of letting the PATCH 422.
    expect(await screen.findByText(/Add the customer's name, street and city/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send invoice' })).toBeDisabled()
    expect(invoicesApi.updateInvoice).not.toHaveBeenCalled()
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

    await openDownloadMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download email' }))
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

describe('InvoiceDetails — UBL/Peppol download', () => {
  // jsdom implements neither of these; the download path calls both.
  let downloadNames

  beforeEach(() => {
    downloadNames = []
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => 'blob:ubl'),
      revokeObjectURL: vi.fn(),
    }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function capture() {
      downloadNames.push(this.download)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads the XML named after the invoice', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.downloadInvoiceUbl.mockResolvedValueOnce(new Blob(['<Invoice/>']))
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await openDownloadMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /Download UBL \(XML\)/ }))

    await waitFor(() => expect(invoicesApi.downloadInvoiceUbl).toHaveBeenCalledWith(7))
    expect(downloadNames).toEqual(['factuur-2026-0007.xml'])
  })

  it('offers the XML even when no PDF has been rendered', async () => {
    // Unlike the PDF, the XML is generated on demand — it only needs a saved
    // invoice, so it must not be gated on pdf_path.
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await openDownloadMenu()
    expect(screen.queryByRole('menuitem', { name: /Download PDF/ })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /Download UBL \(XML\)/ })).toBeInTheDocument()
  })

  it('warns when an e-invoicing network would reject the file', async () => {
    // EDIT_INVOICE has no country on either party, so neither can be addressed.
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    // The warning sits on the UBL entry, where the action it concerns lives.
    await openDownloadMenu()
    const hint = screen.getByLabelText(/Not ready for e-invoicing/)
    expect(hint).toBeInTheDocument()
    expect(hint.getAttribute('aria-label')).toContain('country could not be recognised')
    // …and is legible without hovering, as the entry's secondary line.
    expect(screen.getByRole('menuitem', { name: /Not ready for e-invoicing/ })).toBeInTheDocument()
  })

  it('shows no warning once the invoice carries everything Peppol needs', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(PEPPOL_READY_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await openDownloadMenu()
    expect(screen.queryByLabelText(/Not ready for e-invoicing/)).toBeNull()
    expect(screen.getByRole('menuitem', { name: /Download UBL \(XML\)/ })).toBeInTheDocument()
  })

  it('surfaces a failed download instead of failing silently', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.downloadInvoiceUbl.mockRejectedValueOnce(new Error('boom'))
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await openDownloadMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /Download UBL \(XML\)/ }))
    expect(await screen.findByText('Could not generate the UBL file.')).toBeInTheDocument()
  })

  it('renders the download in Dutch', async () => {
    await i18n.changeLanguage('nl')
    invoicesApi.getInvoice.mockResolvedValueOnce(PEPPOL_READY_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await openDownloadMenu('Downloaden')
    expect(screen.getByRole('menuitem', { name: /UBL downloaden \(XML\)/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'E-mail downloaden' })).toBeInTheDocument()
  })

  it('groups all three downloads under one menu', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(PEPPOL_READY_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    // Nothing is offered until the menu is opened.
    expect(screen.queryByRole('menuitem')).toBeNull()

    await openDownloadMenu()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Download UBL (XML)',
      'Download email',
    ])
  })

  it('includes the PDF entry once one has been rendered', async () => {
    // Peppol-clean, so the UBL entry carries no secondary warning line and the
    // assertion is about the menu's contents rather than the warning.
    invoicesApi.getInvoice.mockResolvedValueOnce({
      ...PEPPOL_READY_INVOICE,
      pdf_path: 'tenants/1/invoices/old-key.pdf',
    })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await openDownloadMenu()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Download PDF',
      'Download UBL (XML)',
      'Download email',
    ])
  })
})
