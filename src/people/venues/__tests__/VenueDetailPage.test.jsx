import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../venues.ts', () => ({
  getVenue: vi.fn(),
  updateVenue: vi.fn().mockResolvedValue({}),
  deleteVenue: vi.fn().mockResolvedValue({}),
  getVenueCategoryImpact: vi.fn().mockResolvedValue({ affected_gigs: [] }),
  enrichVenue: vi.fn(),
  listVenueContacts: vi.fn(),
  addVenueContact: vi.fn(),
  setVenueContactPrimary: vi.fn().mockResolvedValue({}),
  removeVenueContact: vi.fn().mockResolvedValue({}),
  listVenueEvents: vi.fn(),
}))

vi.mock('../../contacts/contacts.ts', () => ({
  searchContacts: vi.fn().mockResolvedValue([]),
  createContact: vi.fn(),
  getContact: vi.fn(),
  updateContact: vi.fn().mockResolvedValue({}),
}))

vi.mock('../places.ts', () => ({
  searchPlaces: vi.fn().mockResolvedValue([]),
}))

import VenueDetailPage from '../VenueDetailPage.tsx'
import {
  getVenue,
  enrichVenue,
  listVenueEvents,
  listVenueContacts,
  addVenueContact,
  setVenueContactPrimary,
  removeVenueContact,
} from '../venues.ts'
import { searchContacts } from '../../contacts/contacts.ts'
import { searchPlaces } from '../places.ts'
import { AuthContext } from '../../../contexts/authContext.ts'
import theme from '../../../theme.ts'
import { CompactLayoutContext } from '../../../hooks/useCompactLayout.ts'

const VENUE = { id: 1, category: 'venue', name: 'Test Venue' }

// Editing a venue's contacts is gated on planning.write, so the page needs an
// authenticated user with that permission in context.
const AUTH_VALUE = {
  user: { id: 1, permissions: ['app.view', 'planning.write', 'purchase.create'], activeTenantRole: 'contributor' },
  setUser: () => {},
  logout: async () => {},
  switchTenant: async () => undefined,
  refreshUser: async () => undefined,
}

function ContactStub() {
  const { id } = useParams()
  return <div>Contact page {id}</div>
}

// A reader keeps app.view but loses planning.write.
const READER_AUTH_VALUE = {
  ...AUTH_VALUE,
  user: { id: 1, permissions: ['app.view'], activeTenantRole: 'reader' },
}

// A writer on a plan without `integrations`: the place lookup is a paid feature,
// so the button becomes the usual diamond upsell.
const LOCKED_AUTH_VALUE = {
  ...AUTH_VALUE,
  user: {
    ...AUTH_VALUE.user,
    entitlements: {
      planSlug: 'bronze',
      subscriptionStatus: null,
      locked: false,
      financeReadOnly: false,
      flags: { integrations: false },
      limits: {},
    },
  },
}

function wrap(authValue = AUTH_VALUE, compact = false) {
  return render(
    <MemoryRouter initialEntries={['/venues/1']}>
      <AuthContext.Provider value={authValue}>
        <ThemeProvider theme={theme}>
          <CompactLayoutContext.Provider value={compact}>
          <Routes>
            <Route path="/venues/:id" element={<VenueDetailPage />} />
            <Route path="/contacts/:id" element={<ContactStub />} />
          </Routes>
          </CompactLayoutContext.Provider>
        </ThemeProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  getVenue.mockReset().mockResolvedValue(VENUE)
  listVenueContacts.mockReset().mockResolvedValue([])
  addVenueContact.mockReset()
  setVenueContactPrimary.mockClear()
  removeVenueContact.mockClear()
  searchContacts.mockReset().mockResolvedValue([])
  searchPlaces.mockReset().mockResolvedValue([])
  enrichVenue.mockReset()
  listVenueEvents.mockReset().mockResolvedValue({ items: [], meta: { limit: 10, returned: 0, nextCursor: null } })
})

describe('VenueDetailPage — Contacts section', () => {
  it('renders linked contacts with the primary one starred', async () => {
    listVenueContacts.mockResolvedValue([
      { id: 5, name: 'Alice', category: 'press', email: '', phone: '', is_primary: false },
      { id: 6, name: 'Bob', category: 'booker', email: '', phone: '', is_primary: true },
    ])
    wrap()

    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())
    expect(screen.getByText('Alice')).toBeInTheDocument()
    // Bob is primary → one "unset primary" star; Alice → "set primary"
    expect(screen.getByLabelText('unset primary')).toBeInTheDocument()
    expect(screen.getByLabelText('set primary')).toBeInTheDocument()
  })

  it('marking a contact primary moves the star to it', async () => {
    listVenueContacts.mockResolvedValue([
      { id: 5, name: 'Alice', category: 'press', email: '', phone: '', is_primary: false },
      { id: 6, name: 'Bob', category: 'booker', email: '', phone: '', is_primary: true },
    ])
    const user = userEvent.setup()
    wrap()

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    await user.click(screen.getByLabelText('set primary'))

    expect(setVenueContactPrimary).toHaveBeenCalledWith(1, 5, true)
    // Now Alice is the only primary
    await waitFor(() => expect(screen.getAllByLabelText('unset primary')).toHaveLength(1))
    expect(screen.getByLabelText('set primary')).toBeInTheDocument()
  })

  it('navigates to the contact detail page via the open button', async () => {
    listVenueContacts.mockResolvedValue([
      { id: 5, name: 'Alice', category: 'press', email: '', phone: '', is_primary: false },
    ])
    const user = userEvent.setup()
    wrap()

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    await user.click(screen.getByLabelText('open contact'))

    await waitFor(() => expect(screen.getByText('Contact page 5')).toBeInTheDocument())
  })

  it('removes a linked contact', async () => {
    listVenueContacts.mockResolvedValue([
      { id: 5, name: 'Alice', category: 'press', email: '', phone: '', is_primary: false },
    ])
    const user = userEvent.setup()
    wrap()

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    await user.click(screen.getByLabelText('remove contact'))

    expect(removeVenueContact).toHaveBeenCalledWith(1, 5)
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())
  })

  it('searches contacts after 3 characters and links the chosen one', async () => {
    searchContacts.mockResolvedValue([
      { id: 9, name: 'Carol', category: 'promotion', email: 'carol@x.com', phone: '' },
    ])
    addVenueContact.mockResolvedValue({
      id: 9, name: 'Carol', category: 'promotion', email: 'carol@x.com', phone: '', is_primary: false,
    })
    const user = userEvent.setup()
    wrap()

    await waitFor(() => expect(screen.getByLabelText('Add contact')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Add contact'), 'car')

    const option = await screen.findByText('Carol')
    await user.click(option)

    await waitFor(() => expect(addVenueContact).toHaveBeenCalledWith(1, 9))
    await waitFor(() => expect(screen.getByText('Carol (carol@x.com)')).toBeInTheDocument())
  })
})

describe('VenueDetailPage — address enrichment', () => {
  it('offers the lookup button to a writer', async () => {
    wrap()
    const button = await screen.findByRole('button', { name: 'Look up address' })
    const heading = screen.getByRole('heading', { name: 'Venue' })
    expect(within(heading.parentElement).getByRole('button', { name: 'Look up address' })).toBe(button)
  })

  it('hides the lookup button from a reader', async () => {
    wrap(READER_AUTH_VALUE)

    await waitFor(() => expect(getVenue).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Look up address' })).not.toBeInTheDocument()
  })

  it('turns the lookup into a diamond upsell link when the plan lacks integrations', async () => {
    wrap(LOCKED_AUTH_VALUE)

    const link = await screen.findByRole('link', { name: 'Look up address' })
    expect(link).toHaveAttribute('href', '/upgrade/integrations')
    expect(within(link).getByTestId('DiamondOutlinedIcon')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Look up address' })).not.toBeInTheDocument()
  })

  it('keeps the upsell link hidden from a reader', async () => {
    wrap({ ...LOCKED_AUTH_VALUE, user: { ...LOCKED_AUTH_VALUE.user, permissions: ['app.view'], activeTenantRole: 'reader' } })

    await waitFor(() => expect(getVenue).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'Look up address' })).not.toBeInTheDocument()
  })

  it('disables the lookup until the venue has a name to search on', async () => {
    getVenue.mockResolvedValue({ id: 1, category: 'venue', name: '' })
    wrap()

    expect(await screen.findByRole('button', { name: 'Look up address' })).toBeDisabled()
  })

  it('narrows the lookup with the address the venue already has', async () => {
    getVenue.mockResolvedValue({ ...VENUE, city: 'Amsterdam', country: 'NL' })
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Look up address' }))

    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith(
      'Test Venue', expect.objectContaining({ country: 'NL', city: 'Amsterdam' }),
    ))
  })

  it('applies the server-reported row rather than the raw suggestion', async () => {
    enrichVenue.mockResolvedValue({
      venue: { ...VENUE, city: 'Amsterdam', postal_code: '1017SG' },
      filled: ['city', 'postal_code'],
    })
    searchPlaces.mockResolvedValue([{
      id: 'poi-1',
      name: 'Test Venue',
      street_and_number: 'Weteringschans 6',
      postal_code: '1017SG',
      city: 'Amsterdam',
      region: null,
      country: null,
      website: null,
      phone: null,
      latitude: 52.3624,
      longitude: 4.8838,
      freeform_address: 'Weteringschans 6, 1017SG Amsterdam',
      categories: [],
    }])
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Look up address' }))
    await user.click(await screen.findByRole('button', { name: /^Fill/ }))

    await waitFor(() => expect(enrichVenue).toHaveBeenCalledWith(1, expect.objectContaining({ id: 'poi-1' })))
    // The server said street_and_number was NOT filled, so it must stay empty
    // even though the suggestion carried a value.
    await waitFor(() => expect(screen.getByLabelText(/City/)).toHaveValue('Amsterdam'))
    expect(screen.getByLabelText(/Street and number/)).toHaveValue('')
  })
})

describe('VenueDetailPage — floating tabs', () => {
  const ADDRESSED = {
    ...VENUE,
    street_and_number: 'Weteringschans 6',
    street_additional: '2nd floor',
    city: 'Amsterdam',
    organization_name: 'Zwaan BV',
  }

  it('renders the name and address over the location header', async () => {
    getVenue.mockResolvedValue(ADDRESSED)
    wrap()

    const header = await screen.findByTestId('venue-location-header')
    expect(within(header).getByRole('heading', { name: 'Test Venue' })).toBeInTheDocument()
    expect(within(header).getByText('Weteringschans 6, 2nd floor')).toBeInTheDocument()
    expect(within(header).getByText('Amsterdam')).toBeInTheDocument()
  })

  it('links the header action to Google Maps in a new tab', async () => {
    getVenue.mockResolvedValue(ADDRESSED)
    wrap()

    const header = await screen.findByTestId('venue-location-header')
    const link = within(header).getByRole('link', { name: 'Open in Google Maps' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('href')).toContain('google.com/maps')
    expect(link.getAttribute('href')).toContain(encodeURIComponent('Test Venue, Weteringschans 6'))
  })

  it('opens on Information and moves the invoicing fields to their own tab', async () => {
    getVenue.mockResolvedValue(ADDRESSED)
    const user = userEvent.setup()
    wrap()

    expect(await screen.findByLabelText(/Street and number/)).toBeVisible()
    expect(screen.getByLabelText(/Organization name/)).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Invoicing' }))

    expect(screen.getByLabelText(/Organization name/)).toBeVisible()
    expect(screen.getByLabelText(/Street and number/)).not.toBeVisible()
  })

  const EVENT = {
    id: 7,
    event_date: '2026-05-01',
    event_description: 'Spring show',
    status: 'confirmed',
    start_time: '20:00:00',
    end_time: '23:30:00',
  }

  it('lists the venue events in a table on the Events tab', async () => {
    listVenueEvents.mockResolvedValue({ items: [EVENT], meta: { limit: 10, returned: 1, nextCursor: null } })
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Events' }))

    const row = (await screen.findByText('Spring show')).closest('tr')
    // formatShortDate's nl-NL default, as everywhere else in the app.
    expect(within(row).getByText('01 mei 2026')).toBeInTheDocument()
    expect(within(row).getByText('20:00–23:30')).toBeInTheDocument()
    // Status is a column without a header — three named columns only.
    expect(screen.getAllByRole('columnheader').filter((h) => h.textContent).map((h) => h.textContent))
      .toEqual(['Event', 'Date', 'Time'])
    expect(listVenueEvents).toHaveBeenCalledWith(1, 10, undefined, expect.anything())
  })

  it('drops the table for stacked rows in a compact pane', async () => {
    listVenueEvents.mockResolvedValue({ items: [EVENT], meta: { limit: 10, returned: 1, nextCursor: null } })
    const user = userEvent.setup()
    wrap(AUTH_VALUE, true)

    await user.click(await screen.findByRole('button', { name: 'Events' }))

    expect(await screen.findByText('Spring show')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('does not fetch events until the Events tab is opened', async () => {
    wrap()

    await waitFor(() => expect(getVenue).toHaveBeenCalled())
    expect(listVenueEvents).not.toHaveBeenCalled()
  })
})
