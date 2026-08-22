import { MemoryRouter } from 'react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../invoices.ts', () => ({
  getInvoiceEmailDefaults: vi.fn(),
  previewInvoiceEmail: vi.fn(),
  createInvoiceEmailCampaign: vi.fn(),
  sendInvoiceEmailCampaign: vi.fn(),
  downloadInvoiceEml: vi.fn(),
}))
vi.mock('../../../promotion/outreach/outreachSender.ts', () => ({
  getOutreachSender: vi.fn(),
}))

import * as invoicesApi from '../invoices.ts'
import { getOutreachSender } from '../../../promotion/outreach/outreachSender.ts'
import theme from '../../../theme.ts'
import InvoiceEmailDialog from '../components/InvoiceEmailDialog.tsx'
import { useInvoiceEmailActions } from '../components/useInvoiceEmailActions.ts'

const TEMPLATE = { id: 3, name: 'Invoice mail', locale: 'nl' }
const INVOICE = { id: 7, invoice_number: '2026-001', status: 'draft' }

// A host with the same "open it" button the invoice page has, so the tests
// exercise the real hook rather than a hand-built state object.
function Host({ invoice = INVOICE, markSent }) {
  const state = useInvoiceEmailActions({ invoiceId: invoice.id, invoice, markSent })
  return (
    <>
      <button type="button" onClick={() => { void state.openEmailDialog() }}>Open</button>
      <InvoiceEmailDialog
        {...state}
        isDraft={invoice.status === 'draft'}
        peppolBlockers={[]}
      />
    </>
  )
}

async function renderDialog(props = {}) {
  const result = render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <Host {...props} />
      </ThemeProvider>
    </MemoryRouter>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  return result
}

function defaults(templates) {
  return { templates, message: 'Bedankt voor de samenwerking.', to: 'customer@example.test', status: 'draft' }
}

describe('InvoiceEmailDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOutreachSender.mockResolvedValue({ configured: true, fromName: 'Band', fromEmail: 'b@x.test', replyTo: null })
    invoicesApi.previewInvoiceEmail.mockResolvedValue({ subject: 'Factuur 2026-001', html: '<p>Hallo</p>' })
    invoicesApi.getInvoiceEmailDefaults.mockResolvedValue(defaults([TEMPLATE]))
  })

  it('tells the user to create a template when none exists, and offers no actions', async () => {
    invoicesApi.getInvoiceEmailDefaults.mockResolvedValue(defaults([]))
    await renderDialog()

    expect(await screen.findByText(/no invoice email template yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download .eml' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('does not ask which template to use when there is exactly one', async () => {
    await renderDialog()

    await screen.findByDisplayValue('Bedankt voor de samenwerking.')
    expect(screen.queryByLabelText('Template')).toBeNull()
  })

  it('offers a picker defaulted to the first when several exist', async () => {
    invoicesApi.getInvoiceEmailDefaults.mockResolvedValue(
      defaults([TEMPLATE, { id: 9, name: 'Invoice mail EN', locale: 'en' }]),
    )
    await renderDialog()

    const picker = await screen.findByLabelText('Template')
    expect(picker).toHaveValue('3')
  })

  it('previews the merged email with the custom message', async () => {
    await renderDialog()

    await waitFor(() => expect(invoicesApi.previewInvoiceEmail).toHaveBeenCalledWith(7, {
      templateId: 3, message: 'Bedankt voor de samenwerking.',
    }), { timeout: 3000 })
    expect(await screen.findByTitle('Email preview')).toBeInTheDocument()
  })

  it('hides Send when no Resend sender is configured', async () => {
    getOutreachSender.mockResolvedValue({ configured: false, fromName: null, fromEmail: null, replyTo: null })
    await renderDialog()

    await screen.findByDisplayValue('Bedankt voor de samenwerking.')
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download .eml' })).toBeEnabled()
  })

  it('creates then sends the campaign, with the chosen attachments', async () => {
    invoicesApi.createInvoiceEmailCampaign.mockResolvedValue({ id: 55 })
    invoicesApi.sendInvoiceEmailCampaign.mockResolvedValue({ id: 55, status: 'sent' })
    await renderDialog()

    await screen.findByDisplayValue('Bedankt voor de samenwerking.')
    await userEvent.click(screen.getByRole('radio', { name: 'PDF and e-invoice (XML)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(invoicesApi.createInvoiceEmailCampaign).toHaveBeenCalledWith(7, {
      templateId: 3, message: 'Bedankt voor de samenwerking.', attachments: 'pdf_xml',
    }))
    expect(invoicesApi.sendInvoiceEmailCampaign).toHaveBeenCalledWith(7, 55)
  })

  it('marks the invoice as sent before sending when asked', async () => {
    const order = []
    const markSent = vi.fn(async () => { order.push('markSent') })
    invoicesApi.createInvoiceEmailCampaign.mockImplementation(async () => { order.push('create'); return { id: 55 } })
    invoicesApi.sendInvoiceEmailCampaign.mockResolvedValue({ id: 55, status: 'sent' })
    await renderDialog({ markSent })

    await screen.findByDisplayValue('Bedankt voor de samenwerking.')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(invoicesApi.sendInvoiceEmailCampaign).toHaveBeenCalled())
    expect(order).toEqual(['markSent', 'create'])
  })

  it('says the invoice was finalized when the send fails afterwards', async () => {
    const markSent = vi.fn(async () => {})
    invoicesApi.createInvoiceEmailCampaign.mockRejectedValue(new Error('Provider down'))
    await renderDialog({ markSent })

    await screen.findByDisplayValue('Bedankt voor de samenwerking.')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText(/Provider down \(the invoice was marked as sent\)/)).toBeInTheDocument()
  })

  it('offers no mark-as-sent checkbox for an invoice that is already sent', async () => {
    await renderDialog({ invoice: { ...INVOICE, status: 'sent' } })

    await screen.findByDisplayValue('Bedankt voor de samenwerking.')
    expect(screen.queryByRole('checkbox')).toBeNull()
    // Resending stays available.
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })
})
