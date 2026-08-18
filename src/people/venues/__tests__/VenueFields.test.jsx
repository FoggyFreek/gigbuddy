import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import VenueFields from '../components/VenueFields.tsx'
import theme from '../../../theme.ts'
import Grid from '@mui/material/Grid'
import { CompactLayoutContext } from '../../../hooks/useCompactLayout.ts'

function wrap(form, extra = {}, compact = false) {
  const noop = () => {}
  return render(
    <ThemeProvider theme={theme}>
      <CompactLayoutContext.Provider value={compact}>
        <Grid container spacing={2}>
          <VenueFields form={form} onChange={noop} {...extra} />
        </Grid>
      </CompactLayoutContext.Provider>
    </ThemeProvider>
  )
}

// The grid cell wrapping a field, so a test can assert its column span.
function cellOf(label) {
  return screen.getByLabelText(label).closest('.MuiGrid-root')
}

const venueForm = {
  category: 'venue',
  name: 'Café De Zwaan',
  title: '',
  given_name: '',
  family_name: '',
  organization_name: '',
  kvk_number: '',
  tax_id: '',
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

  it('renders a supplied nameField in place of the plain name input', () => {
    wrap(venueForm, { nameField: <input aria-label="custom name control" /> })
    expect(screen.getByLabelText('custom name control')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Venue name/i)).not.toBeInTheDocument()
  })

  it('still renders the plain name input when no slot is supplied', () => {
    wrap(venueForm)
    expect(screen.getByLabelText(/Venue name/i)).toHaveValue('Café De Zwaan')
  })

  it('shows optional registration and VAT identifier fields for both categories', () => {
    const { unmount } = wrap(venueForm)
    expect(screen.getByLabelText('Chamber of Commerce number')).toBeInTheDocument()
    expect(screen.getByLabelText('VAT ID')).toBeInTheDocument()
    unmount()

    wrap(festivalForm)
    expect(screen.getByLabelText('Chamber of Commerce number')).toBeInTheDocument()
    expect(screen.getByLabelText('VAT ID')).toBeInTheDocument()
  })
})

describe('VenueFields — layout variants', () => {
  // The detail page's Information tab: name/address only, in the requested
  // row order. The billing identity moved to its own tab.
  it('detail renders the address fields and drops the invoicing ones', () => {
    wrap(venueForm, { variant: 'detail' })

    expect(screen.getByLabelText(/Venue name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Street and number/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Street additional/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/City/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Website/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Organization name/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/VAT ID/i)).not.toBeInTheDocument()
  })

  it('invoicing renders exactly the billing identity fields', () => {
    wrap(venueForm, { variant: 'invoicing' })

    for (const label of [/Title/i, /Given name/i, /Family name/i, /Organization name/i, /Chamber of Commerce number/i, /VAT ID/i]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.queryByLabelText(/Venue name/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/City/i)).not.toBeInTheDocument()
  })

  it('keeps every field in the default form variant', () => {
    wrap(venueForm)

    for (const label of [/Venue name/i, /Organization name/i, /VAT ID/i, /Street and number/i, /City/i, /Email/i]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })
})

describe('VenueFields — compact layout', () => {
  const addressed = { ...venueForm, street_and_number: 'Weteringschans 6', city: 'Amsterdam' }

  // A SplitView pane forces compact even on a wide viewport, so the spans come
  // from the context, not from a media query.
  it('stacks the address fields to full width when compact', () => {
    wrap(addressed, { variant: 'detail' }, true)

    expect(cellOf(/Street and number/i)).toHaveClass('MuiGrid-grid-xs-12')
    expect(cellOf(/City/i)).toHaveClass('MuiGrid-grid-xs-12')
    expect(cellOf(/Region/i)).toHaveClass('MuiGrid-grid-xs-6')
  })

  it('keeps the multi-field rows when there is room', () => {
    wrap(addressed, { variant: 'detail' }, false)

    expect(cellOf(/Street and number/i)).toHaveClass('MuiGrid-grid-xs-5')
    expect(cellOf(/City/i)).toHaveClass('MuiGrid-grid-xs-5')
  })
})
