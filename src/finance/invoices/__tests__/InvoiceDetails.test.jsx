import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../invoices.ts', () => ({
  createInvoicePaymentLink: vi.fn(),
  deleteInvoicePaymentLink: vi.fn(),
  deleteInvoice: vi.fn(async () => {}),
  downloadInvoiceEml: vi.fn(),
  downloadInvoiceUbl: vi.fn(),
  downloadInvoiceUblWithPdf: vi.fn(),
  getInvoice: vi.fn(),
  getInvoiceEmailDefaults: vi.fn(),
  previewInvoiceEmail: vi.fn(),
  createInvoiceEmailCampaign: vi.fn(),
  sendInvoiceEmailCampaign: vi.fn(),
  removeInvoiceLogo: vi.fn(),
  renderInvoice: vi.fn(),
  syncInvoicePaymentLink: vi.fn(),
  updateInvoice: vi.fn(async () => ({})),
  uploadInvoiceLogo: vi.fn(),
}))

vi.mock('../../../utils/compressImage.ts', () => ({
  compressLogo: vi.fn(async (file) => new File([file], `compressed-${file.name}`, { type: file.type })),
}))

import * as invoicesApi from '../invoices.ts'
import { compressLogo } from '../../../utils/compressImage.ts'
import InvoiceDetails from '../components/InvoiceDetails.tsx'
import { AccountingProfileContext } from '../../../contexts/accountingProfileContext.ts'
import { ProfileContext } from '../../../contexts/profileContext.ts'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import i18n from '../../../i18n/index.ts'
import theme from '../../../theme.ts'

function wrap(ui, accountingProfile = null, mollie = true, withDialog = false) {
  const wrapContent = (child) => {
    const content = accountingProfile
      ? (
        <AccountingProfileContext.Provider value={{ profile: accountingProfile, loading: false, applyProfile: vi.fn() }}>
          {child}
        </AccountingProfileContext.Provider>
      )
      : child
    return (
      <ThemeProvider theme={theme}>
        <ProfileContext.Provider value={{
          bandName: '', setBandName: vi.fn(), accentColor: null, setAccentColor: vi.fn(),
          integrations: { shopify: true, bandsintown: true, mollie, resend: true },
          isIntegrationConfigured: (integration) => integration !== 'mollie' || mollie,
          setIntegrationConfigured: vi.fn(),
        }}>
          {content}
        </ProfileContext.Provider>
      </ThemeProvider>
    )
  }
  const withRouter = (child) => (
    <MemoryRouter>
      {withDialog ? <DialogProvider>{child}</DialogProvider> : child}
    </MemoryRouter>
  )
  const result = render(withRouter(wrapContent(ui)))
  return { ...result, rerender: (nextUi) => result.rerender(withRouter(wrapContent(nextUi))) }
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
  it('saves edited business identifiers, updates the list, and stays on the invoice', async () => {
    const onClose = vi.fn()
    const onInvoiceUpdate = vi.fn()
    invoicesApi.getInvoice.mockResolvedValueOnce({
      ...EDIT_INVOICE,
      customer_kvk: '50048295',
      customer_tax_id: 'NL001794860B34',
    })
    invoicesApi.updateInvoice.mockResolvedValueOnce({
      ...EDIT_INVOICE,
      customer_kvk: '50048295',
      customer_tax_id: 'NL819789471B01',
    })
    wrap(<InvoiceDetails invoiceId={7} onClose={onClose} onInvoiceUpdate={onInvoiceUpdate} />)

    const chamberNumber = await screen.findByRole('textbox', { name: 'Chamber of Commerce number' })
    const vatId = screen.getByRole('textbox', { name: 'VAT ID' })
    expect(chamberNumber).toHaveValue('50048295')
    await userEvent.clear(vatId)
    await userEvent.type(vatId, 'NL819789471B01')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(invoicesApi.updateInvoice).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        customer_kvk: '50048295',
        customer_tax_id: 'NL819789471B01',
      }),
    )
    // Saving keeps the editor open; only delete and the close control leave it.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    // The list still learns about the change.
    await waitFor(() => expect(onInvoiceUpdate).toHaveBeenCalledWith(
      7, expect.objectContaining({ customer_tax_id: 'NL819789471B01' }),
    ))
  })

  it('hides Mollie payment-link UI when Mollie is not configured', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />, null, false)

    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())
    expect(screen.queryByText('Payment link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create payment link/ })).not.toBeInTheDocument()
  })

  it('only offers VAT rates from the tenant accounting country on invoice lines', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce({
      ...EDIT_INVOICE,
      currency: 'GBP',
      lines: [{ ...EDIT_INVOICE.lines[0], tax_percentage: 20 }],
    })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />, {
      country_code: 'gb',
      base_currency: 'GBP',
    })

    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: 'VAT %' })).toBeInTheDocument()
    await userEvent.click(document.querySelector('[role="gridcell"][data-field="tax_percentage"]'))

    expect(screen.getByRole('option', { name: '20%' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '5%' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '0%' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '21%' })).not.toBeInTheDocument()
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

  it('renders a finalized invoice read-only (no Save, fields disabled)', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(FINALIZED_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    expect(screen.getByText(/This invoice is finalized/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByDisplayValue('Venue BV')).toBeDisabled()
  })

  it('re-generates a finalized PDF by reloading the full invoice', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(RENDERED_INVOICE)
    // The endpoint answers with the new key only — not a whole invoice.
    invoicesApi.renderInvoice.mockResolvedValueOnce({ pdf_path: 'tenants/1/invoices/new-key.pdf' })
    invoicesApi.getInvoice.mockResolvedValueOnce({
      ...RENDERED_INVOICE,
      pdf_path: 'tenants/1/invoices/new-key.pdf',
    })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    await waitFor(() => expect(invoicesApi.renderInvoice).toHaveBeenCalledWith(7))
    // The download entry follows the newly stored key (the old one is deleted server-side).
    await openDownloadMenu()
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /Download PDF/ }))
      .toHaveAttribute('href', '/api/files/tenants/1/invoices/new-key.pdf'))
    // Everything derived from the loaded invoice must survive. Overwriting the
    // invoice with the partial render response would drop all three.
    expect(await screen.findByText(/This invoice is finalized/)).toBeInTheDocument()
    expect(screen.getByText('sent')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Venue BV')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(invoicesApi.updateInvoice).not.toHaveBeenCalled()
  })

  it('surfaces an error when re-generating the PDF fails', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(RENDERED_INVOICE)
    invoicesApi.renderInvoice.mockRejectedValueOnce(new Error('render boom'))
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    expect(await screen.findByText('render boom')).toBeInTheDocument()
    // The previously stored PDF is still downloadable.
    await openDownloadMenu()
    expect(screen.getByRole('menuitem', { name: /Download PDF/ }))
      .toHaveAttribute('href', '/api/files/tenants/1/invoices/old-key.pdf')
  })

  // Reader mode: finance.view without finance.manage. Every invoice mutation is
  // finance.manage on the server, so nothing may be offered as editable.
  describe('without finance.manage', () => {
    it('makes a draft read-only without withholding downloads', async () => {
      invoicesApi.getInvoice.mockResolvedValueOnce(RENDERED_INVOICE)
      wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} canWrite={false} />)
      await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

      expect(screen.getByDisplayValue('Venue BV')).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Mark as sent' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
      expect(screen.getByRole('button', { name: /Add item/ })).toBeDisabled()
      expect(screen.getByLabelText('remove line')).toBeDisabled()
      // Downloads are read affordances — those routes carry no finance.manage gate.
      await openDownloadMenu()
      expect(screen.getByRole('menuitem', { name: /Download PDF/ }))
        .toHaveAttribute('href', '/api/files/tenants/1/invoices/old-key.pdf')
    })

  })

  it('adds and removes invoice lines', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    expect(screen.getAllByLabelText('remove line')).toHaveLength(1)
    // With a single line the remove control is disabled.
    expect(screen.getByLabelText('remove line')).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getAllByLabelText('remove line')).toHaveLength(2)

    await userEvent.click(screen.getAllByLabelText('remove line')[0])
    expect(screen.getAllByLabelText('remove line')).toHaveLength(1)
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

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(invoicesApi.updateInvoice).not.toHaveBeenCalled()

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Void' }))
    await userEvent.click(screen.getByRole('button', { name: 'Void invoice' }))
    await waitFor(() => expect(invoicesApi.updateInvoice).toHaveBeenCalledWith(7, { status: 'void' }))
  })

  it('confirms marking a sent invoice as paid before recording the status change', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(FINALIZED_INVOICE)
    invoicesApi.updateInvoice.mockResolvedValueOnce({ ...FINALIZED_INVOICE, status: 'paid' })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Mark as paid' }))
    expect(await screen.findByText(/Mark invoice 2026-0007 as paid\?/)).toBeInTheDocument()
    expect(invoicesApi.updateInvoice).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm payment' }))
    await waitFor(() => expect(invoicesApi.updateInvoice).toHaveBeenCalledWith(7, { status: 'paid' }))
  })

  it('only deletes a draft after the shared destructive confirmation is accepted', async () => {
    const onClose = vi.fn()
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={onClose} />, null, true, true)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const cancelDialog = await screen.findByRole('dialog')
    await userEvent.click(within(cancelDialog).getByRole('button', { name: 'Cancel' }))
    expect(invoicesApi.deleteInvoice).not.toHaveBeenCalled()

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const confirmDialog = await screen.findByRole('dialog')
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(invoicesApi.deleteInvoice).toHaveBeenCalledWith(7))
    expect(onClose).toHaveBeenCalledWith(true)
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

  it('loads the default message into the email dialog from its own button', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.getInvoiceEmailDefaults.mockResolvedValueOnce({
      templates: [{ id: 3, name: 'Invoice email', locale: 'nl' }],
      message: 'Hartelijk dank voor de samenwerking.',
      to: 'klant@example.com',
      status: 'draft',
    })
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    // Emailing has its own control now; it is not in the download menu.
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByDisplayValue('Hartelijk dank voor de samenwerking.')).toBeInTheDocument()
    expect(invoicesApi.getInvoiceEmailDefaults).toHaveBeenCalledWith(7)
  })

  it('renders the invoice editor in Dutch', async () => {
    await i18n.changeLanguage('nl')
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())
    expect(screen.getByLabelText('Factuurdatum')).toBeInTheDocument()
    expect(screen.getByText('Klant')).toBeInTheDocument()
    expect(screen.getByText('Regels')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Opslaan' })).toBeInTheDocument()
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

  it('downloads a UBL containing the embedded PDF invoice', async () => {
    invoicesApi.getInvoice.mockResolvedValueOnce(EDIT_INVOICE)
    invoicesApi.downloadInvoiceUblWithPdf.mockResolvedValueOnce(new Blob(['<Invoice/>']))
    wrap(<InvoiceDetails invoiceId={7} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('The Band')).toBeInTheDocument())

    await openDownloadMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'UBL with embedded PDF invoice' }))

    await waitFor(() => expect(invoicesApi.downloadInvoiceUblWithPdf).toHaveBeenCalledWith(7))
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
    expect(screen.getByRole('menuitem', { name: 'UBL met ingesloten pdf-factuur' })).toBeInTheDocument()
  })

})
