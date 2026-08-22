import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import GigTerms from '../components/gigdetails/GigTerms.tsx'
import { AuthContext } from '../../../contexts/authContext.ts'
import theme from '../../../theme.ts'

const FORM = {
  event_date: '2026-06-15', end_date: '', event_description: 'Jazz Night', venue_id: null, festival_id: null,
  event_link: '', start_time: '', end_time: '', status: 'confirmed', ticket_link: '',
  deal_type: 'guarantee', guarantee_variant: 'plus', guaranteed_fee: '1000.00', percentage_of_sales: '70',
  breakeven_includes_venue_costs: true, venue_costs: '800.00', venue_capacity: '300', expected_visitors: '200',
  tickets_sold: '120', ticket_price_net: '20.00', ticket_price_gross: '24.20',
  agency_fee_basis: 'none', agency_fee_percentage: '', agency_fee_amount: '',
  commission_basis: 'none', commission_percentage: '', commission_amount: '',
  subject_to_vat: true, vat_percentage: '', ticket_vat_percentage: '', copyright_percentage: '',
}

const USER = { id: 9, activeTenantRole: 'tenant_admin', permissions: ['app.view', 'planning.write', 'finance.view'] }

function wrap({ form = FORM, onChange = vi.fn() } = {}) {
  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: USER, setUser: () => {}, logout: async () => {}, switchTenant: async () => {}, refreshUser: async () => {} }}>
        <ThemeProvider theme={theme}>
          <GigTerms editable form={form} costs={[]} onChange={onChange} onAddCost={vi.fn()} onUpdateCost={vi.fn()} onDeleteCost={vi.fn()} />
        </ThemeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
  return onChange
}

describe('GigTerms', () => {
  it('composes the editable terms sections for a finance user', () => {
    wrap()

    expect(screen.getByRole('heading', { name: 'Deal' })).toBeInTheDocument()
    expect(screen.getByLabelText('Ticket link')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByTestId('ticket-upside')).toBeInTheDocument()
    expect(screen.getByTestId('gig-costs-table')).toBeInTheDocument()
    expect(screen.getByTestId('booking-fee-table')).toBeInTheDocument()
    expect(screen.getByTestId('tax-table')).toBeInTheDocument()
  })

  it('keeps the ticket link separate from the deal type and reports edits', async () => {
    const user = userEvent.setup()
    const onChange = wrap({ form: { ...FORM, deal_type: 'flat_fee', guarantee_variant: null } })

    const input = screen.getByLabelText('Ticket link')
    await user.click(input)
    await user.paste('https://tickets.test')

    expect(onChange).toHaveBeenLastCalledWith('ticket_link', 'https://tickets.test')
    expect(screen.getByText(/a flat fee takes no share of ticket revenue/i)).toBeInTheDocument()
  })

  it('renders an existing ticket link as a safe external link', () => {
    wrap({ form: { ...FORM, ticket_link: 'https://tickets.example.com' } })

    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://tickets.example.com')
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
