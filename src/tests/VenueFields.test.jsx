import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import VenueFields from '../components/VenueFields.tsx'
import theme from '../theme.ts'
import Grid from '@mui/material/Grid'

function wrap(form, extra = {}) {
  const noop = () => {}
  return render(
    <ThemeProvider theme={theme}>
      <Grid container spacing={2}>
        <VenueFields form={form} onChange={noop} {...extra} />
      </Grid>
    </ThemeProvider>
  )
}

const venueForm = {
  category: 'venue',
  name: 'Café De Zwaan',
  title: '',
  given_name: '',
  family_name: '',
  organization_name: '',
  street_and_number: '',
  street_additional: '',
  postal_code: '',
  city: '',
  region: '',
  country: '',
  website: '',
  phone: '',
  email: '',
}

const festivalForm = { ...venueForm, category: 'festival', name: 'Texel Blues Festival' }

describe('VenueFields — label changes by category', () => {
  it('shows "Venue name" label for category=venue', () => {
    wrap(venueForm)
    expect(screen.getByLabelText(/Venue name/i)).toBeInTheDocument()
  })

  it('shows "Festival / event name" label for category=festival', () => {
    wrap(festivalForm)
    expect(screen.getByLabelText(/Festival \/ event name/i)).toBeInTheDocument()
  })

  it('does not render a "Festival name" field', () => {
    wrap(festivalForm)
    expect(screen.queryByLabelText(/^Festival name$/i)).not.toBeInTheDocument()
  })

  it('does not render a "Venue name" field when category=festival', () => {
    wrap(festivalForm)
    expect(screen.queryByLabelText(/^Venue name$/i)).not.toBeInTheDocument()
  })
})
