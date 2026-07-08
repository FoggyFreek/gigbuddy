import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GigDetailContent from '../components/GigDetailContent.tsx'
import theme from '../theme.ts'

vi.mock('../api/availability.ts', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))

vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/gigs.ts', () => ({
  getGig: vi.fn().mockResolvedValue({
    id: 1,
    event_date: '2026-06-15',
    event_description: 'Jazz Night',
    venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
    event_link: '',
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'option',
    booking_fee_cents: 15000,
    admission: 'free',
    ticket_link: null,
    notes: 'Bring own PA',
    has_pa_system: false,
    has_drumkit: false,
    has_stage_lights: false,
    tasks: [],
    attachments: [],
    participants: [],
  }),
  getGigMerchSummary: vi.fn().mockResolvedValue({ unitsSold: 0, netCents: 0, grossCents: 0 }),
  updateGig: vi.fn().mockResolvedValue({}),
  addGigParticipant: vi.fn().mockResolvedValue({}),
  removeGigParticipant: vi.fn().mockResolvedValue({}),
  setGigVote: vi.fn().mockResolvedValue({}),
  uploadGigBanner: vi.fn().mockResolvedValue({ banner_path: 'test/banner.jpg' }),
  deleteGigBanner: vi.fn().mockResolvedValue({}),
  listGigContacts: vi.fn().mockResolvedValue([]),
  addGigContact: vi.fn().mockResolvedValue({}),
  setGigContactPrimary: vi.fn().mockResolvedValue({}),
  removeGigContact: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../api/venues.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))

// Geocoding is the browser cache/dedupe layer; mock it so the location map is
// deterministic and no /api/geocode network call fires. Default: no result
// (falsy) so existing tests render no map.
vi.mock('../utils/geocode.ts', () => ({ geocodePlace: vi.fn(() => Promise.resolve(null)) }))

// Stub the lazy Leaflet map so tests don't pull in leaflet; expose the props we
// assert on as data-attributes.
vi.mock('../components/map/GigLocationMap.tsx', () => ({
  default: (props) => (
    <div
      data-testid="gig-location-map"
      data-href={props.mapsHref}
      data-zoom={String(props.zoom)}
      data-label={props.label}
    >
      {props.openLabel}
    </div>
  ),
}))

import { getGig, getGigMerchSummary, updateGig } from '../api/gigs.ts'
import { geocodePlace } from '../utils/geocode.ts'

const GIG_PAID = {
  id: 1,
  event_date: '2026-06-15',
  event_description: 'Jazz Night',
  venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
  event_link: '',
  start_time: '20:00:00',
  end_time: '23:00:00',
  status: 'option',
  booking_fee_cents: 15000,
  admission: 'paid',
  ticket_link: 'https://tickets.example.com',
  notes: '',
  has_pa_system: false,
  has_drumkit: false,
  has_stage_lights: false,
  tasks: [],
  attachments: [],
  participants: [],
}

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

// The detail body is split across tabbed panels (Event/Terms/Availability/
// Tasks). Panels stay mounted but inactive ones are display:none, so a test
// must activate the owning tab before interacting with (or role-querying) its
// fields. Label/text/display-value queries still match across hidden panels.
async function openTab(user, label) {
  await user.click(screen.getByRole('button', { name: label }))
}

describe('GigDetailContent — field rendering', () => {
  beforeEach(() => {
    getGig.mockClear()
    updateGig.mockClear()
  })

  it('loads and displays gig data', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Bimhuis — Amsterdam')).toBeInTheDocument()
  })

  it('renders the Paid admission switch', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.getByLabelText(/paid admission/i)).toBeInTheDocument()
  })

  it('switch is unchecked by default when admission is free', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.getByLabelText(/paid admission/i)).not.toBeChecked()
  })

  it('does not show ticket link field when admission is free', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.queryByLabelText(/ticket link/i)).not.toBeInTheDocument()
  })

  it('loads with switch checked and ticket link populated when gig has admission=paid', async () => {
    getGig.mockResolvedValueOnce(GIG_PAID)
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByLabelText(/paid admission/i)).toBeChecked())
    expect(screen.getByDisplayValue('https://tickets.example.com')).toBeInTheDocument()
  })

  it('renders Guaranteed fee and Ticket link on the same row when admission=paid', async () => {
    getGig.mockResolvedValueOnce(GIG_PAID)
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    expect(screen.getByLabelText(/guaranteed fee/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/ticket link/i)).toBeInTheDocument()
  })

  it('renders the Terms section heading', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await openTab(user, 'Terms')
    expect(screen.getByRole('heading', { name: /^terms$/i })).toBeInTheDocument()
  })

  it('renames Band fee to Guaranteed fee', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/guaranteed fee/i))
    expect(screen.queryByLabelText(/band fee/i)).not.toBeInTheDocument()
  })

  it('shows Merchandise cut regardless of admission', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.getByLabelText(/merchandise cut/i)).toBeInTheDocument()
  })

  it('does not show Percentage of sales when admission is free', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.queryByLabelText(/percentage of net sales/i)).not.toBeInTheDocument()
  })

  it('shows Percentage of sales when admission=paid', async () => {
    getGig.mockResolvedValueOnce(GIG_PAID)
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/percentage of net sales/i))
    expect(screen.getByLabelText(/percentage of net sales/i)).toBeInTheDocument()
  })
})

describe('GigDetailContent — Terms field saving', () => {
  beforeEach(() => {
    getGig.mockClear()
    updateGig.mockClear()
  })

  it('saves Merchandise cut as a number', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/merchandise cut/i))
    await openTab(user, 'Terms')
    await user.type(screen.getByLabelText(/merchandise cut/i), '15')
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { merchandise_cut: 15 }),
      { timeout: 2000 }
    )
  })

  it('saves Percentage of sales as a number when admission=paid', async () => {
    getGig.mockResolvedValueOnce(GIG_PAID)
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/percentage of net sales/i))
    await openTab(user, 'Terms')
    await user.type(screen.getByLabelText(/percentage of net sales/i), '20')
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { percentage_of_sales: 20 }),
      { timeout: 2000 }
    )
  })

  it('clears Percentage of sales when admission switched to free', async () => {
    getGig.mockResolvedValueOnce(GIG_PAID)
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByLabelText(/paid admission/i)).toBeChecked())
    await openTab(user, 'Terms')
    await user.click(screen.getByLabelText(/paid admission/i))
    await waitFor(
      () =>
        expect(updateGig).toHaveBeenCalledWith(1, {
          admission: 'free',
          ticket_link: null,
          percentage_of_sales: null,
        }),
      { timeout: 2000 }
    )
  })
})

describe('GigDetailContent — reader mode (canWrite=false)', () => {
  beforeEach(() => {
    getGig.mockClear()
    updateGig.mockClear()
  })

  it('keeps text fields readable but read-only', async () => {
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())
    expect(screen.getByLabelText(/event description/i)).toHaveAttribute('readonly')
    expect(screen.getByLabelText(/event description/i)).not.toBeDisabled()
    expect(screen.getByLabelText(/paid admission/i)).toBeDisabled()
    expect(screen.getByLabelText(/guaranteed fee/i)).toHaveAttribute('readonly')
    expect(screen.getByLabelText(/notes/i)).toHaveAttribute('readonly')
    expect(screen.getByText(/you have read-only access/i)).toBeInTheDocument()
  })

  it('hides the banner upload control', async () => {
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.queryByRole('button', { name: /upload banner/i })).not.toBeInTheDocument()
  })

  it('does not auto-save when a disabled control is clicked', async () => {
    // pointerEventsCheck:0 lets us drive the click through the disabled control;
    // because the input is disabled its onChange never fires, so nothing saves.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await openTab(user, 'Terms')
    await user.click(screen.getByLabelText(/paid admission/i))
    expect(updateGig).not.toHaveBeenCalled()
  })
})

describe('GigDetailContent — merch sold summary', () => {
  beforeEach(() => {
    getGig.mockClear()
    getGigMerchSummary.mockClear()
    getGigMerchSummary.mockResolvedValue({ unitsSold: 0, netCents: 0, grossCents: 0 })
  })

  it('shows the card with units and excl-VAT total when there are sales', async () => {
    getGigMerchSummary.mockResolvedValueOnce({ unitsSold: 37, netCents: 12345, grossCents: 14937 })
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByText(/merchandise sold/i)).toBeInTheDocument())
    expect(screen.getByText(/37 items · excl\. VAT/i)).toBeInTheDocument()
    expect(screen.getByText(/123,45/)).toBeInTheDocument()
  })

  it('renders "1 item" (singular) for a single unit', async () => {
    getGigMerchSummary.mockResolvedValueOnce({ unitsSold: 1, netCents: 1000, grossCents: 1210 })
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByText(/1 item · excl\. VAT/i)).toBeInTheDocument())
  })

  it('hides the card when there are no sales', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.queryByText(/merchandise sold/i)).not.toBeInTheDocument()
  })

  it('does not render the card or fetch the summary for readers', async () => {
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.queryByText(/merchandise sold/i)).not.toBeInTheDocument()
    expect(getGigMerchSummary).not.toHaveBeenCalled()
  })
})

describe('GigDetailContent — admission toggle', () => {
  beforeEach(() => {
    getGig.mockClear()
    updateGig.mockClear()
  })

  it('shows ticket link field after toggling to paid', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await openTab(user, 'Terms')
    await user.click(screen.getByLabelText(/paid admission/i))
    expect(screen.getByLabelText(/ticket link/i)).toBeInTheDocument()
  })

  it('auto-saves admission=paid when toggled on', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await openTab(user, 'Terms')
    await user.click(screen.getByLabelText(/paid admission/i))
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { admission: 'paid' }),
      { timeout: 2000 }
    )
  })

  it('hides ticket link field after toggling back to free', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await openTab(user, 'Terms')
    await user.click(screen.getByLabelText(/paid admission/i))
    expect(screen.getByLabelText(/ticket link/i)).toBeInTheDocument()
    await user.click(screen.getByLabelText(/paid admission/i))
    expect(screen.queryByLabelText(/ticket link/i)).not.toBeInTheDocument()
  })

  it('auto-saves admission=free and ticket_link=null when toggled off', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await openTab(user, 'Terms')
    await user.click(screen.getByLabelText(/paid admission/i))
    await user.click(screen.getByLabelText(/paid admission/i))
    await waitFor(
      () =>
        expect(updateGig).toHaveBeenCalledWith(1, {
          admission: 'free',
          ticket_link: null,
          percentage_of_sales: null,
        }),
      { timeout: 2000 }
    )
  })
})

describe('GigDetailContent — ticket link field', () => {
  beforeEach(() => {
    getGig.mockClear()
    updateGig.mockClear()
  })

  it('auto-saves ticket_link when typed', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await openTab(user, 'Terms')
    await user.click(screen.getByLabelText(/paid admission/i))
    // Paste the whole URL in one event rather than typing it character by
    // character: each keystroke re-renders the (heavy) detail body, and ~20 of
    // those under load is what made this test flake past the 5s budget.
    await user.click(screen.getByLabelText(/ticket link/i))
    await user.paste('https://tickets.test')
    await waitFor(
      () =>
        expect(updateGig).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ ticket_link: 'https://tickets.test' })
        ),
      { timeout: 2000 }
    )
  })

  it('shows open-link anchor when ticket_link has a value', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_PAID)
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Terms')
    const links = screen.getAllByRole('link')
    expect(links.some((l) => l.getAttribute('href') === GIG_PAID.ticket_link)).toBe(true)
  })

  it('does not show open-link anchor when ticket_link is empty', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await openTab(user, 'Terms')
    await user.click(screen.getByLabelText(/paid admission/i))
    // ticket_link is empty — no anchor with a ticket URL should exist
    const links = screen.queryAllByRole('link')
    expect(links.every((l) => !l.getAttribute('href')?.startsWith('https://'))).toBe(true)
  })
})

describe('GigDetailContent — location map', () => {
  const baseGig = {
    id: 1,
    event_date: '2026-06-15',
    event_description: 'Jazz Night',
    event_link: '',
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'option',
    booking_fee_cents: 15000,
    admission: 'free',
    ticket_link: null,
    notes: '',
    has_pa_system: false,
    has_drumkit: false,
    has_stage_lights: false,
    tasks: [],
    attachments: [],
    participants: [],
  }
  const gigWith = (extra) => ({ ...baseGig, ...extra })

  beforeEach(() => {
    getGig.mockClear()
    geocodePlace.mockReset()
    geocodePlace.mockResolvedValue({ lat: 52.37, lon: 4.9 })
  })

  it('renders the map at city zoom and geocodes the venue city when no street is set', async () => {
    // default getGig mock: venue Amsterdam, city only
    wrap(<GigDetailContent gigId={1} />)
    const map = await screen.findByTestId('gig-location-map')
    expect(map).toHaveAttribute('data-zoom', '11')
    expect(geocodePlace).toHaveBeenCalledWith(expect.objectContaining({ city: 'Amsterdam' }))
    // marker link points at an external maps search including the city
    const href = map.getAttribute('data-href')
    expect(href).toContain('google.com/maps')
    expect(decodeURIComponent(href)).toContain('Amsterdam')
  })

  it('uses street zoom and passes the address when the venue has a street', async () => {
    getGig.mockResolvedValueOnce(
      gigWith({ venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam', street_and_number: 'Piet Heinkade 3' } }),
    )
    wrap(<GigDetailContent gigId={1} />)
    const map = await screen.findByTestId('gig-location-map')
    expect(map).toHaveAttribute('data-zoom', '16')
    expect(geocodePlace).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Amsterdam', address: 'Piet Heinkade 3' }),
    )
  })

  it('prefers the venue over the festival when both have a city', async () => {
    getGig.mockResolvedValueOnce(
      gigWith({
        venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
        festival: { id: 22, name: 'Pinkpop', category: 'festival', city: 'Landgraaf' },
      }),
    )
    wrap(<GigDetailContent gigId={1} />)
    await screen.findByTestId('gig-location-map')
    expect(geocodePlace).toHaveBeenCalledWith(expect.objectContaining({ city: 'Amsterdam' }))
  })

  it('falls back to the festival when the venue has no city', async () => {
    getGig.mockResolvedValueOnce(
      gigWith({
        venue: { id: 11, name: 'TBD', category: 'venue' },
        festival: { id: 22, name: 'Pinkpop', category: 'festival', city: 'Landgraaf' },
      }),
    )
    wrap(<GigDetailContent gigId={1} />)
    await screen.findByTestId('gig-location-map')
    expect(geocodePlace).toHaveBeenCalledWith(expect.objectContaining({ city: 'Landgraaf' }))
  })

  it('hides the map and does not geocode when neither venue nor festival has a city', async () => {
    getGig.mockResolvedValueOnce(gigWith({ venue: { id: 11, name: 'TBD', category: 'venue' }, festival: null }))
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(geocodePlace).not.toHaveBeenCalled()
    expect(screen.queryByTestId('gig-location-map')).not.toBeInTheDocument()
  })

  it('drops a geocode result that resolves after unmount (no stale pin)', async () => {
    let resolve
    geocodePlace.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const { unmount } = wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    unmount()
    await act(async () => { resolve({ lat: 1, lon: 2 }) })
    expect(screen.queryByTestId('gig-location-map')).not.toBeInTheDocument()
  })
})
