import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/invoices.ts', () => ({
  createInvoice: vi.fn(),
  draftFromGig: vi.fn(),
}))

vi.mock('../components/GigPicker.tsx', () => ({
  default: ({ onChange }) => (
    <button type="button" onClick={() => onChange({ id: 42 })}>
      Pick gig
    </button>
  ),
}))

import { createInvoice, draftFromGig } from '../api/invoices.ts'
import NewInvoiceDialog from '../components/NewInvoiceDialog.tsx'
import i18n from '../i18n/index.ts'
import theme from '../theme.ts'

const DRAFT_PAYLOAD = {
  tenant: { id: 1, band_name: 'The Band', applies_kor: false, tax_percentage: 9 },
  billing_targets: [],
  draft: {
    gig_id: 42,
    issue_date: '2026-06-09',
    due_date: '2026-06-23',
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

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  draftFromGig.mockResolvedValue(DRAFT_PAYLOAD)
  createInvoice.mockResolvedValue({ id: 123 })
})

describe('NewInvoiceDialog', () => {
  it('creates the invoice after a gig is selected and reports the new id', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    wrap(<NewInvoiceDialog onClose={vi.fn()} onCreated={onCreated} />)

    await user.click(screen.getByRole('button', { name: 'Pick gig' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1))
    expect(createInvoice).toHaveBeenCalledWith(expect.objectContaining({
      gig_id: 42,
      customer_name: 'Venue BV',
      lines: [expect.objectContaining({ description: 'Optreden' })],
    }))
    expect(onCreated).toHaveBeenCalledWith(123)
  })

  it('applies the selected billing target before creating the invoice', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    draftFromGig.mockResolvedValueOnce({
      ...DRAFT_PAYLOAD,
      billing_targets: [
        { type: 'festival', name: 'Festival Org', address_city: 'Utrecht', email: 'festival@example.test' },
        { type: 'venue', name: 'Venue Org', address_city: 'Amsterdam', email: 'venue@example.test' },
      ],
    })

    wrap(<NewInvoiceDialog onClose={vi.fn()} onCreated={onCreated} />)

    await user.click(screen.getByRole('button', { name: 'Pick gig' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText('Select billing target')
    expect(createInvoice).not.toHaveBeenCalled()

    await user.click(screen.getByLabelText(/Venue \/ physical location/))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1))
    expect(createInvoice).toHaveBeenCalledWith(expect.objectContaining({
      customer_name: 'Venue Org',
      customer_email: 'venue@example.test',
    }))
    expect(onCreated).toHaveBeenCalledWith(123)
  })

  it('renders the new-invoice flow in Dutch', async () => {
    await i18n.changeLanguage('nl')
    wrap(<NewInvoiceDialog onClose={vi.fn()} onCreated={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Nieuwe factuur' })).toBeInTheDocument()
    expect(screen.getByText(/Kies een optreden/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annuleren' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Doorgaan' })).toBeInTheDocument()
  })
})
