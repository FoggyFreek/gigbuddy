import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import Grid from '@mui/material/Grid'
import { describe, expect, it } from 'vitest'
import BookerSection from '../components/gigdetails/terms/BookerSection.tsx'
import theme from '../../../theme.ts'

const FORM = {
  agency_fee_basis: 'percentage',
  agency_fee_percentage: '10.00',
  agency_fee_amount: '0.00',
  commission_basis: 'percentage',
  commission_percentage: '5.00',
  commission_amount: '0.00',
}

function wrap({ form = FORM, editable = true } = {}) {
  render(
    <ThemeProvider theme={theme}>
      <Grid container>
        <BookerSection editable={editable} form={form} onChange={() => {}} />
      </Grid>
    </ThemeProvider>,
  )
}

// The MUI select renders as a div combobox, not a native <select>, so jest-dom's
// toBeDisabled() (which only recognizes real form elements) can't see it — the
// grey-out has to be read off aria-disabled instead. MUI only sets the
// attribute at all once the field is actually disabled.
function expectSelectDisabled(labelText, disabled) {
  if (disabled) {
    expect(screen.getByLabelText(labelText)).toHaveAttribute('aria-disabled', 'true')
  } else {
    expect(screen.getByLabelText(labelText)).not.toHaveAttribute('aria-disabled')
  }
}

describe('BookerSection', () => {
  it('lists the booking fee and the commission as tables with column captions', () => {
    wrap()

    const bookingFeeHeader = screen.getByTestId('booking-fee-header')
    expect(within(bookingFeeHeader).getByText('Booking fee')).toBeInTheDocument()
    expect(within(bookingFeeHeader).getByText('Percentage')).toBeInTheDocument()
    expect(within(bookingFeeHeader).getByText('Fixed amount')).toBeInTheDocument()

    const commissionHeader = screen.getByTestId('commission-header')
    expect(within(commissionHeader).getByText('Commission')).toBeInTheDocument()
    expect(within(commissionHeader).getByText('Percentage')).toBeInTheDocument()
    expect(within(commissionHeader).getByText('Fixed amount')).toBeInTheDocument()
  })

  it('enables only the field matching the chosen basis', () => {
    wrap()

    expect(screen.getByLabelText('Booking fee percentage')).toBeEnabled()
    expect(screen.getByLabelText('Booking fee amount')).toBeDisabled()
    expect(screen.getByLabelText('Commission percentage')).toBeEnabled()
    expect(screen.getByLabelText('Commission amount')).toBeDisabled()
  })

  it('greys out the percentage and amount instead of hiding them when no fee is agreed', () => {
    wrap({ form: { ...FORM, agency_fee_basis: 'none' } })

    expectSelectDisabled('Booking fee', false)
    expect(screen.getByLabelText('Booking fee percentage')).toBeDisabled()
    expect(screen.getByLabelText('Booking fee amount')).toBeDisabled()
    // The commission is unaffected by the booking fee's basis.
    expect(screen.getByLabelText('Commission percentage')).toBeEnabled()
  })

  it('greys every field when the section is read-only', () => {
    wrap({ editable: false })

    expectSelectDisabled('Booking fee', true)
  })
})
