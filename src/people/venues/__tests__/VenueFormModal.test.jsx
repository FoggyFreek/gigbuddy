import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../venues.ts', () => ({
  createVenue: vi.fn(async (body) => ({ id: 1, ...body })),
  getVenue: vi.fn(),
  updateVenue: vi.fn(),
  checkVenueDuplicates: vi.fn().mockResolvedValue({ items: [] }),
  getVenueCategoryImpact: vi.fn(),
}))

// Stand in for the real search control: exposes a button that reports a pick, so
// the dialog's fill behavior is tested without driving an Autocomplete.
vi.mock('../../../components/shared/PlaceSearchField.tsx', () => ({
  default: ({ value, onValueChange, onPlaceSelect, country, city }) => (
    <div>
      <input aria-label="place search" value={value} onChange={(e) => onValueChange(e.target.value)} />
      <span data-testid="lookup-scope">{`${country ?? ''}|${city ?? ''}`}</span>
      <button type="button" onClick={() => onPlaceSelect(PARADISO)}>pick place</button>
    </div>
  ),
}))

vi.mock('../../../hooks/usePermissions.ts', () => ({
  usePermissions: () => ({ canWritePlanning: true }),
}))

import VenueFormModal from '../components/VenueFormModal.tsx'
import { createVenue } from '../venues.ts'
import { AuthContext } from '../../../contexts/authContext.ts'
import i18n from '../../../i18n/index.ts'
import theme from '../../../theme.ts'

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

// No AuthContext.Provider by default: the context default carries no user, so
// entitlements resolve to null (ownerless tenant) and everything is allowed.
function ui(props = {}) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <VenueFormModal mode="create" onClose={() => {}} {...props} />
      </ThemeProvider>
    </MemoryRouter>
  )
}

// A plan without `integrations`: place lookup is paid, manual entry is not.
const LOCKED_AUTH_VALUE = {
  user: {
    id: 1,
    entitlements: {
      planSlug: 'bronze',
      subscriptionStatus: null,
      locked: false,
      financeReadOnly: false,
      flags: { integrations: false },
      limits: {},
    },
  },
  setUser: () => {},
  logout: async () => {},
  switchTenant: async () => undefined,
  refreshUser: async () => undefined,
}

function lockedUi(props = {}) {
  return (
    <MemoryRouter>
      <AuthContext.Provider value={LOCKED_AUTH_VALUE}>
        <ThemeProvider theme={theme}>
          <VenueFormModal mode="create" onClose={() => {}} {...props} />
        </ThemeProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
})

describe('VenueFormModal — create mode place lookup', () => {
  it('renders the place search control instead of the plain name field', () => {
    render(ui())
    expect(screen.getByLabelText('place search')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Venue name/)).not.toBeInTheDocument()
  })

  it('falls back to a plain name field with a diamond upsell when the plan lacks integrations', async () => {
    const user = userEvent.setup()
    render(lockedUi())

    expect(screen.queryByLabelText('place search')).not.toBeInTheDocument()
    const nameField = screen.getByLabelText(/^Venue name/)
    const upsell = screen.getByRole('link', { name: /upgrade/i })
    expect(upsell).toHaveAttribute('href', '/upgrade/integrations')
    expect(within(upsell).getByTestId('DiamondOutlinedIcon')).toBeInTheDocument()

    // Creating a venue by hand still works — only the lookup is paid.
    await user.type(nameField, 'Jansens Schuur')
    await user.click(screen.getByRole('button', { name: 'Add venue' }))

    await waitFor(() => expect(createVenue).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jansens Schuur',
    })))
  })

  it('fills the empty address fields from the picked place', async () => {
    const user = userEvent.setup()
    render(ui())

    await user.click(screen.getByRole('button', { name: 'pick place' }))

    expect(screen.getByLabelText('place search')).toHaveValue('Paradiso')
    expect(screen.getByLabelText(/Street and number/)).toHaveValue('Weteringschans 6')
    expect(screen.getByLabelText(/Postal code/)).toHaveValue('1017SG')
    expect(screen.getByLabelText(/City/)).toHaveValue('Amsterdam')
    expect(screen.getByLabelText(/Region/)).toHaveValue('Noord-Holland')
    expect(screen.getByLabelText(/Country/)).toHaveValue('NL')
    expect(screen.getByLabelText(/Website/)).toHaveValue('https://www.paradiso.nl')
    expect(screen.getByLabelText(/Phone/)).toHaveValue('+31 20 626 4521')
  })

  it('hands the already-filled country and city to the search control', async () => {
    const user = userEvent.setup()
    render(ui())

    expect(screen.getByTestId('lookup-scope')).toHaveTextContent('|')

    await user.type(screen.getByLabelText(/Country/), 'nl')
    await user.type(screen.getByLabelText(/City/), 'Utrecht')

    expect(screen.getByTestId('lookup-scope')).toHaveTextContent('NL|Utrecht')
  })

  it('leaves a field the user already typed untouched', async () => {
    const user = userEvent.setup()
    render(ui())

    await user.type(screen.getByLabelText(/City/), 'Utrecht')
    await user.click(screen.getByRole('button', { name: 'pick place' }))

    expect(screen.getByLabelText(/City/)).toHaveValue('Utrecht')
    expect(screen.getByLabelText(/Postal code/)).toHaveValue('1017SG')
  })

  it('sends the coordinates with the create request without ever showing them', async () => {
    const user = userEvent.setup()
    render(ui())

    await user.click(screen.getByRole('button', { name: 'pick place' }))
    await user.click(screen.getByRole('button', { name: 'Add venue' }))

    await waitFor(() => expect(createVenue).toHaveBeenCalled())
    expect(createVenue).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Paradiso',
      city: 'Amsterdam',
      latitude: 52.3624,
      longitude: 4.8838,
    }))
    expect(screen.queryByLabelText(/Latitude/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Longitude/)).not.toBeInTheDocument()
  })

  it('keeps a typed name with no match and creates without coordinates', async () => {
    const user = userEvent.setup()
    render(ui())

    await user.type(screen.getByLabelText('place search'), 'Jansens Schuur')
    await user.click(screen.getByRole('button', { name: 'Add venue' }))

    await waitFor(() => expect(createVenue).toHaveBeenCalled())
    expect(createVenue).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jansens Schuur',
      latitude: null,
      longitude: null,
    }))
  })
})
