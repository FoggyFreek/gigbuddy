import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/invoices.ts', () => ({
  searchInvoiceGigs: vi.fn(),
}))

import { searchInvoiceGigs } from '../api/invoices.ts'
import GigPicker from '../components/GigPicker.tsx'
import i18n from '../i18n/index.ts'
import theme from '../theme.ts'

afterEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

describe('GigPicker invoice UI', () => {
  it('searches remotely after three characters and disables gigs with an invoice', async () => {
    searchInvoiceGigs.mockResolvedValue([
      { id: 1, event_date: '2026-07-20', event_description: 'Available show', has_invoice: false },
      { id: 2, event_date: '2026-07-21', event_description: 'Invoiced show', has_invoice: true },
    ])
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ThemeProvider theme={theme}>
        <GigPicker value={null} onChange={onChange} />
      </ThemeProvider>,
    )

    const input = screen.getByLabelText('Gig')
    await user.type(input, 'Sh')
    expect(searchInvoiceGigs).not.toHaveBeenCalled()

    await user.type(input, 'o')
    await waitFor(() => expect(searchInvoiceGigs).toHaveBeenCalledWith('Sho'))

    const invoiced = await screen.findByRole('option', { name: /Invoiced show.*Already has an invoice/i })
    expect(invoiced).toHaveAttribute('aria-disabled', 'true')
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('option', { name: /Available show/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('renders its minimum-query hint in Dutch', async () => {
    searchInvoiceGigs.mockResolvedValue([])
    await i18n.changeLanguage('nl')

    render(
      <ThemeProvider theme={theme}>
        <GigPicker value={null} onChange={vi.fn()} />
      </ThemeProvider>,
    )

    expect(screen.getByLabelText('Optreden')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Optreden'))
    expect(screen.getByText('Typ minstens 3 tekens…')).toBeInTheDocument()
    expect(searchInvoiceGigs).not.toHaveBeenCalled()
  })
})
