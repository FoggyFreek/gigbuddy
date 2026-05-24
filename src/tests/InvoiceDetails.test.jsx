import { render, screen, waitFor } from '@testing-library/react'
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
})
