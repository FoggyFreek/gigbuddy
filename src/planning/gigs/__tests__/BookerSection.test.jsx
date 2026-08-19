import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import Grid from '@mui/material/Grid'
import { describe, expect, it } from 'vitest'
import BookerSection from '../components/gigdetails/terms/BookerSection.tsx'
import { CompactLayoutContext } from '../../../hooks/useCompactLayout.ts'
import theme from '../../../theme.ts'

const FORM = {
  agency_fee_basis: 'percentage',
  agency_fee_percentage: '10.00',
  agency_fee_amount: '0.00',
  agency_fee_mode: 'inclusive',
  commission_basis: 'percentage',
  commission_percentage: '5.00',
  commission_amount: '0.00',
}

function wrap({ compact = false, form = FORM } = {}) {
  render(
    <ThemeProvider theme={theme}>
      <CompactLayoutContext.Provider value={compact}>
        <Grid container>
          <BookerSection editable form={form} onChange={() => {}} />
        </Grid>
      </CompactLayoutContext.Provider>
    </ThemeProvider>,
  )
}

describe('BookerSection', () => {
  it('runs each block along one line on desktop', () => {
    wrap()

    expect(screen.getByTestId('booking-fee-fields')).toHaveStyle({ flexDirection: 'row' })
    expect(screen.getByTestId('commission-fields')).toHaveStyle({ flexDirection: 'row' })
    // The mode belongs to the booking fee, so it shares that line.
    expect(screen.getByTestId('booking-fee-fields')).toContainElement(
      screen.getByLabelText('Exclusive or inclusive'),
    )
    expect(screen.getByTestId('booking-fee-fields')).toContainElement(screen.getByLabelText('Booking fee'))
  })

  it('stacks the fields when the layout is compact', () => {
    wrap({ compact: true })

    expect(screen.getByTestId('booking-fee-fields')).toHaveStyle({ flexDirection: 'column' })
    expect(screen.getByTestId('commission-fields')).toHaveStyle({ flexDirection: 'column' })
  })

  it('leaves out the amount and the mode when no fee is agreed', () => {
    wrap({ form: { ...FORM, agency_fee_basis: 'none' } })

    expect(screen.getByLabelText('Booking fee')).toBeInTheDocument()
    expect(screen.queryByLabelText('Exclusive or inclusive')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Percentage')).toBeInTheDocument() // the commission's
  })
})
