import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/places.ts', () => ({
  searchPlaces: vi.fn().mockResolvedValue([]),
}))

import PlaceEnrichDialog from '../components/shared/PlaceEnrichDialog.tsx'
import { searchPlaces } from '../api/places.ts'
import i18n from '../i18n/index.ts'
import theme from '../theme.ts'

const PARADISO = {
  id: 'poi-1',
  name: 'Paradiso',
  street_and_number: 'Weteringschans 6',
  postal_code: '1017SG',
  city: 'Amsterdam',
  region: 'Noord-Holland',
  country: 'NL',
  website: 'https://www.paradiso.nl',
  phone: '+31 20 626 4521',
  latitude: 52.3624,
  longitude: 4.8838,
  freeform_address: 'Weteringschans 6, 1017SG Amsterdam',
  categories: [],
}

const MELKWEG = {
  ...PARADISO,
  id: 'poi-2',
  name: 'Melkweg',
  street_and_number: 'Lijnbaansgracht 234A',
  postal_code: '1017PH',
  freeform_address: 'Lijnbaansgracht 234A, 1017PH Amsterdam',
}

const FIELDS = [
  { key: 'street_and_number', label: 'Street and number' },
  { key: 'postal_code', label: 'Postal code' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'Region' },
  { key: 'country', label: 'Country' },
  { key: 'website', label: 'Website' },
  { key: 'phone', label: 'Phone' },
]

function ui(props = {}) {
  return (
    <ThemeProvider theme={theme}>
      <PlaceEnrichDialog
        query="Paradiso"
        current={{}}
        fields={FIELDS}
        onApply={() => {}}
        onClose={() => {}}
        {...props}
      />
    </ThemeProvider>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  searchPlaces.mockReset().mockResolvedValue([])
})

describe('PlaceEnrichDialog', () => {
  it('looks the query up on open', async () => {
    render(ui())
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith('Paradiso'))
  })

  it('previews every field it would fill and counts them in the confirm button', async () => {
    searchPlaces.mockResolvedValue([PARADISO])
    render(ui())

    expect(await screen.findByText('Will fill 7 empty fields:')).toBeInTheDocument()
    expect(screen.getByText('Weteringschans 6')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fill 7 fields' })).toBeEnabled()
  })

  it('lists only the empty fields, never the populated ones', async () => {
    searchPlaces.mockResolvedValue([PARADISO])
    render(ui({ current: { city: 'Utrecht', phone: '030 1234567' } }))

    expect(await screen.findByText('Will fill 5 empty fields:')).toBeInTheDocument()
    // The suggestion's competing values must not appear in the preview.
    expect(screen.queryByText('Amsterdam')).not.toBeInTheDocument()
    expect(screen.queryByText('+31 20 626 4521')).not.toBeInTheDocument()
    expect(screen.getByText('1017SG')).toBeInTheDocument()
  })

  it('recomputes the preview when a different candidate is selected', async () => {
    searchPlaces.mockResolvedValue([PARADISO, MELKWEG])
    const user = userEvent.setup()
    render(ui())

    await screen.findByText('Weteringschans 6, 1017SG Amsterdam')
    await user.click(screen.getByRole('radio', { name: /Melkweg/ }))

    await waitFor(() => expect(screen.getByText('Lijnbaansgracht 234A')).toBeInTheDocument())
    expect(screen.queryByText('Weteringschans 6')).not.toBeInTheDocument()
  })

  it('applies the selected suggestion', async () => {
    const onApply = vi.fn()
    searchPlaces.mockResolvedValue([PARADISO, MELKWEG])
    const user = userEvent.setup()
    render(ui({ onApply }))

    await screen.findByText('Weteringschans 6, 1017SG Amsterdam')
    await user.click(screen.getByRole('radio', { name: /Melkweg/ }))
    await user.click(screen.getByRole('button', { name: /^Fill/ }))

    expect(onApply).toHaveBeenCalledWith(MELKWEG)
  })

  it('disables the confirm button when the place adds nothing new', async () => {
    searchPlaces.mockResolvedValue([PARADISO])
    render(ui({
      current: {
        street_and_number: 'Weteringschans 6',
        postal_code: '1017SG',
        city: 'Amsterdam',
        region: 'Noord-Holland',
        country: 'NL',
        website: 'https://www.paradiso.nl',
        phone: '+31 20 626 4521',
      },
    }))

    expect(
      await screen.findByText('This place adds nothing new — every field it knows is already filled.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Fill/ })).toBeDisabled()
  })

  it('reports when nothing was found', async () => {
    render(ui({ query: 'Jansens Schuur' }))

    expect(
      await screen.findByText('No places found for "Jansens Schuur". Enter the details by hand.'),
    ).toBeInTheDocument()
  })

  it('reports a failed lookup', async () => {
    searchPlaces.mockRejectedValue(new Error('boom'))
    render(ui())

    expect(await screen.findByText('The lookup failed. Please try again.')).toBeInTheDocument()
  })
})
