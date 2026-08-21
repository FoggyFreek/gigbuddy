import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import Grid from '@mui/material/Grid'
import { describe, expect, it } from 'vitest'
import ContactFields from '../components/ContactFields.tsx'
import theme from '../../../theme.ts'

function wrap(category) {
  return render(
    <ThemeProvider theme={theme}>
      <Grid container spacing={2}>
        <ContactFields
          form={{
            name: '',
            email: '',
            phone: '',
            category,
            iban: '',
            kvk_number: '',
            tax_id: '',
          }}
          onChange={() => {}}
        />
      </Grid>
    </ThemeProvider>,
  )
}

describe('ContactFields business identifiers', () => {
  it('shows optional registration and VAT identifiers for suppliers', () => {
    wrap('supplier')

    expect(screen.getByLabelText('Chamber of Commerce number')).toBeInTheDocument()
    expect(screen.getByLabelText('VAT ID')).toBeInTheDocument()
  })

  it('shows optional finance identifiers for bookers', () => {
    wrap('booker')

    expect(screen.getByLabelText('IBAN')).toBeInTheDocument()
    expect(screen.getByLabelText('Chamber of Commerce number')).toBeInTheDocument()
    expect(screen.getByLabelText('VAT ID')).toBeInTheDocument()
  })

  it('keeps supplier-only financial fields out of ordinary contact forms', () => {
    wrap('press')

    expect(screen.queryByLabelText('Chamber of Commerce number')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('VAT ID')).not.toBeInTheDocument()
  })
})
