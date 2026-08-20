import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import Grid from '@mui/material/Grid'
import { describe, expect, it, vi } from 'vitest'
import TaxesSection from '../components/gigdetails/terms/TaxesSection.tsx'
import theme from '../../../theme.ts'

const FORM = {
  subject_to_vat: true,
  vat_percentage: '',
  ticket_vat_percentage: '9',
}

function wrap({ form = FORM, onChange = () => {} } = {}) {
  render(
    <ThemeProvider theme={theme}>
      <Grid container>
        <TaxesSection editable form={form} onChange={onChange} />
      </Grid>
    </ThemeProvider>,
  )
}

describe('TaxesSection', () => {
  it('lists the flag and both rates as a table with column captions', () => {
    wrap()

    const table = screen.getByTestId('tax-table')
    expect(within(table).getByText('Subject to VAT')).toBeInTheDocument()
    expect(within(table).getByText('General VAT %')).toBeInTheDocument()
    expect(within(table).getByText('Ticket VAT %')).toBeInTheDocument()
    expect(screen.getByLabelText('Subject to VAT')).toBeChecked()
    expect(screen.getByLabelText('Ticket VAT %')).toHaveValue(9)
  })

  // Blank is "no rate agreed", so the field shows what an invoice would fall
  // back to — the accounting country's reduced rate — rather than pretending 0.
  it('offers the country default as the general rate to leave blank', () => {
    wrap()

    expect(screen.getByLabelText('General VAT %')).toHaveAttribute('placeholder', '9')
  })

  it('greys out both rates instead of hiding them on a deal that carries no VAT', () => {
    wrap({ form: { ...FORM, subject_to_vat: false } })

    expect(screen.getByLabelText('Subject to VAT')).not.toBeChecked()
    expect(screen.getByLabelText('General VAT %')).toBeInTheDocument()
    expect(screen.getByLabelText('General VAT %')).toBeDisabled()
    expect(screen.getByLabelText('Ticket VAT %')).toBeDisabled()
  })

  it('reports the flag and each rate to the form', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    wrap({ onChange })

    await user.click(screen.getByLabelText('Subject to VAT'))
    expect(onChange).toHaveBeenCalledWith('subject_to_vat', false)

    await user.type(screen.getByLabelText('General VAT %'), '2')
    expect(onChange).toHaveBeenCalledWith('vat_percentage', '2')
  })
})
