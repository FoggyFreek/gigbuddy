import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GigDetailContent from '../components/gigdetails/GigDetailContent.tsx'
import theme from '../../../theme.ts'

vi.mock('../../availability/availability.ts', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  evaluateEventAvailability: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))

vi.mock('../../../people/memberships/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock('../gigs.ts', () => ({
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
    tasks: [],
    attachments: [],
    participants: [],
    tags: [],
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
  searchGigTags: vi.fn().mockResolvedValue([{ id: 7, name: 'Summer Tour' }]),
  setGigTags: vi.fn().mockImplementation(async (_id, tags) =>
    tags.map((name, index) => ({ id: index + 1, name }))),
  createTask: vi.fn().mockResolvedValue({}),
  updateTask: vi.fn().mockResolvedValue({}),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  uploadGigAttachment: vi.fn().mockResolvedValue({}),
  deleteGigAttachment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../availability/me.ts', () => ({
  getMyGig: vi.fn(),
  setMyTaskDone: vi.fn(),
}))

// The blurred header banner behind the gig is the active tenant's own.
vi.mock('../../../people/profiles/profile.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  getBannerPath: vi.fn().mockResolvedValue('tenants/1/banner/own.jpg'),
}))

vi.mock('../../../finance/invoices/invoices.ts', () => ({
  listInvoicesByGig: vi.fn().mockResolvedValue([]),
  draftFromGig: vi.fn(),
  createInvoice: vi.fn(),
}))

const navigate = vi.fn()
vi.mock('react-router', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}))

vi.mock('../../../people/venues/venues.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))

// Geocoding is the browser cache/dedupe layer; mock it so the location map is
// deterministic and no /api/geocode network call fires. Default: no result
// (falsy) so existing tests render no map.
vi.mock('../../../people/venues/geocode.ts', () => ({ geocodePlace: vi.fn(() => Promise.resolve(null)) }))

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

import { getGig, getGigMerchSummary, listGigContacts, setGigTags, setGigVote, updateGig, updateTask } from '../gigs.ts'
import { createInvoice, draftFromGig, listInvoicesByGig } from '../../../finance/invoices/invoices.ts'
import { evaluateEventAvailability, getAvailabilityOn } from '../../availability/availability.ts'
import { listMembers } from '../../../people/memberships/bandMembers.ts'
import { getMyGig, setMyTaskDone } from '../../availability/me.ts'
import { AuthContext } from '../../../contexts/authContext.ts'
import { geocodePlace } from '../../../people/venues/geocode.ts'

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
  tasks: [],
  attachments: [],
  participants: [],
  tags: [],
}

const DEFAULT_USER = {
  id: 9,
  activeTenantRole: 'tenant_admin',
  permissions: ['app.view', 'planning.write', 'finance.view', 'finance.manage'],
  bandMemberId: 3,
}

function wrap(ui) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{
          user: DEFAULT_USER,
          setUser: () => {},
          logout: async () => {},
          switchTenant: async () => undefined,
          refreshUser: async () => undefined,
        }}
      >
        <ThemeProvider theme={theme}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
        </ThemeProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

function wrapAsRole(user, ui) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{
          user,
          setUser: () => {},
          logout: async () => {},
          switchTenant: async () => undefined,
          refreshUser: async () => undefined,
        }}
      >
        <ThemeProvider theme={theme}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
        </ThemeProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

// The detail body is split across tabbed panels (Event/Terms/Participants/
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

describe('GigDetailContent — banner tags', () => {
  beforeEach(() => {
    getGig.mockClear()
    setGigTags.mockClear()
  })

  it('shows Add tag at the top-left of the banner when no tag exists', async () => {
    wrap(<GigDetailContent gigId={1} />)
    expect(await screen.findByRole('button', { name: 'Add tag' })).toBeInTheDocument()
  })

  it('shows deletable tag chips and a square add button when tags exist', async () => {
    getGig.mockResolvedValueOnce({ ...GIG_PAID, tags: [{ id: 7, name: 'Summer Tour' }] })
    wrap(<GigDetailContent gigId={1} />)

    expect(await screen.findByText('Summer Tour')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add another tag' })).toBeInTheDocument()
    const chip = screen.getByText('Summer Tour').closest('.MuiChip-root')
    expect(chip?.querySelector('[data-testid="CloseIcon"]')).toBeInTheDocument()
  })

  it('deletes a tag inline from its chip', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce({ ...GIG_PAID, tags: [{ id: 7, name: 'Summer Tour' }] })
    wrap(<GigDetailContent gigId={1} />)

    const chip = (await screen.findByText('Summer Tour')).closest('.MuiChip-root')
    const deleteIcon = chip?.querySelector('[data-testid="CloseIcon"]')
    expect(deleteIcon).toBeInTheDocument()
    await user.click(deleteIcon)

    await waitFor(() => expect(setGigTags).toHaveBeenCalledWith(1, []))
  })

  it('adds a tag inline from earlier tag suggestions', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)

    await user.click(await screen.findByRole('button', { name: 'Add tag' }))
    await user.type(screen.getByRole('combobox', { name: 'Tag' }), 'Summer')
    await user.click(await screen.findByText('Summer Tour'))

    await waitFor(() => expect(setGigTags).toHaveBeenCalledWith(1, ['Summer Tour']))
  })

  it('closes the tag textbox when clicking outside it', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)

    await user.click(await screen.findByRole('button', { name: 'Add tag' }))
    expect(screen.getByRole('combobox', { name: 'Tag' })).toBeInTheDocument()
    await user.click(screen.getByText('No event banner'))

    expect(screen.queryByRole('combobox', { name: 'Tag' })).not.toBeInTheDocument()
  })

  it('closes the tag textbox when pressing Escape', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)

    await user.click(await screen.findByRole('button', { name: 'Add tag' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('combobox', { name: 'Tag' })).not.toBeInTheDocument()
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
      () => expect(updateGig).toHaveBeenCalledWith(1, { merchandise_cut: 15 })
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
      () => expect(updateGig).toHaveBeenCalledWith(1, { percentage_of_sales: 20 })
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
        })
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

describe('GigDetailContent — task tab count', () => {
  const GIG_WITH_TASKS = {
    ...GIG_PAID,
    tasks: [
      { id: 1, title: 'Confirm arrival time', done: false },
      { id: 2, title: 'Bring cables', done: false },
      { id: 3, title: 'Send rider', done: true },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the number of open tasks in a primary-colour badge', async () => {
    getGig.mockResolvedValueOnce(GIG_WITH_TASKS)
    wrap(<GigDetailContent gigId={1} />)

    const tasksTab = await screen.findByRole('button', { name: 'Tasks' })
    const badge = within(tasksTab).getByText('2')
    expect(badge).toHaveClass('MuiBadge-colorPrimary')
    expect(badge).toHaveClass('MuiBadge-anchorOriginTopLeftRectangular')
  })

  it('updates the badge when an open task is completed', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_TASKS)
    updateTask.mockResolvedValueOnce({ ...GIG_WITH_TASKS.tasks[0], done: true })
    wrap(<GigDetailContent gigId={1} />)

    const tasksTab = await screen.findByRole('button', { name: 'Tasks' })
    await user.click(tasksTab)
    await user.click(screen.getAllByRole('checkbox')[0])

    await waitFor(() => expect(within(tasksTab).getByText('1')).toBeInTheDocument())
  })
})

describe('GigDetailContent — Terms role gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getGigMerchSummary.mockResolvedValue({ unitsSold: 2, netCents: 10000, grossCents: 10900 })
    listInvoicesByGig.mockResolvedValue([
      { id: 5, invoice_number: '2026-001', status: 'draft', issue_date: '2026-06-16', total_cents: 15000 },
    ])
  })

  it.each([
    ['reader', ['app.view', 'task.complete.self', 'rehearsal.respond.self', 'availability.write.self'], false],
    ['contributor', ['app.view', 'task.complete.self', 'rehearsal.respond.self', 'availability.write.self', 'planning.write', 'purchase.create'], true],
  ])('hides financial terms and related invoices for %s', async (role, permissions, canWrite) => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce({
      ...GIG_PAID,
      equipment: [{ item: 'pa_system', provider: 'venue' }],
    })
    wrapAsRole(
      { id: 9, activeTenantRole: role, permissions, bandMemberId: 3 },
      <GigDetailContent gigId={1} canWrite={canWrite} />,
    )

    await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())
    await openTab(user, 'Terms')

    expect(screen.queryByRole('heading', { name: /^terms$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/paid admission/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/guaranteed fee/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/merchandise cut/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/percentage of net sales/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/ticket link/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/merchandise sold/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/related invoices/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /equipment/i })).toBeInTheDocument()
    expect(getGigMerchSummary).not.toHaveBeenCalled()
    expect(listInvoicesByGig).not.toHaveBeenCalled()
  })
})

describe('GigDetailContent — participants voting', () => {
  const GIG_WITH_VOTE = (vote) => ({
    id: 1,
    event_date: '2099-06-15',
    event_description: 'Jazz Night',
    venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
    event_link: '',
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'option',
    booking_fee_cents: 15000,
    admission: 'free',
    ticket_link: null,
    notes: '',
    tasks: [],
    attachments: [],
    participants: [{ band_member_id: 1, name: 'Alice', position: 'guitar', color: '#f00', vote }],
    tags: [],
  })

  beforeEach(() => {
    getGig.mockClear()
    setGigVote.mockClear()
  })

  it('does not save when Yes is clicked on a participant already voted yes', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_VOTE('yes'))
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    await openTab(user, 'Participants')
    await user.click(screen.getByRole('button', { name: 'Yes' }))
    expect(setGigVote).not.toHaveBeenCalled()
    expect(getGig).toHaveBeenCalledTimes(1)
  })

  it('saves when Yes is clicked on a participant who has not voted yes', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_VOTE('no'))
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    await openTab(user, 'Participants')
    await user.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(setGigVote).toHaveBeenCalledWith(1, 1, 'yes'))
  })

  it('does not save when No is clicked on a participant already voted no', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_VOTE('no'))
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    await openTab(user, 'Participants')
    await user.click(screen.getByRole('button', { name: 'No' }))
    expect(setGigVote).not.toHaveBeenCalled()
    expect(getGig).toHaveBeenCalledTimes(1)
  })

  it('saves when No is clicked on a participant who has not voted no', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_VOTE('yes'))
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    await openTab(user, 'Participants')
    await user.click(screen.getByRole('button', { name: 'No' }))
    await waitFor(() => expect(setGigVote).toHaveBeenCalledWith(1, 1, 'no'))
  })

  it('shows the participant roster on the Participants tab even when status is not "option"', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce({ ...GIG_WITH_VOTE('yes'), status: 'confirmed' })
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())
    await openTab(user, 'Participants')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Participants' })).toBeInTheDocument()
  })

  it.each(['Confirmed', 'Announced'])(
    'hides vote toggles immediately when status changes from option to %s',
    async (status) => {
      const user = userEvent.setup()
      getGig.mockResolvedValueOnce(GIG_WITH_VOTE('yes'))
      wrap(<GigDetailContent gigId={1} />)
      await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())

      await user.click(screen.getByRole('combobox', { name: 'Status' }))
      await user.click(screen.getByRole('option', { name: status }))
      await openTab(user, 'Participants')

      expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'No' })).not.toBeInTheDocument()
    },
  )

  it.each(['confirmed', 'announced'])(
    'shows vote toggles immediately when status changes from %s to option',
    async (status) => {
      const user = userEvent.setup()
      getGig.mockResolvedValueOnce({ ...GIG_WITH_VOTE('yes'), status })
      wrap(<GigDetailContent gigId={1} />)
      await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())

      await user.click(screen.getByRole('combobox', { name: 'Status' }))
      await user.click(screen.getByRole('option', { name: 'Option' }))
      await openTab(user, 'Participants')

      expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
    },
  )
})

describe('GigDetailContent — participant availability', () => {
  beforeEach(() => {
    getGig.mockClear()
    evaluateEventAvailability.mockClear()
    evaluateEventAvailability.mockResolvedValue({ bandWide: null, members: [] })
  })

  it('renders availability inside the matching participant row', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce({
      ...GIG_PAID,
      admission: 'free',
      participants: [
        { band_member_id: 1, name: 'Alice', position: 'guitar', color: '#f00', vote: 'yes' },
      ],
    })
    evaluateEventAvailability.mockResolvedValueOnce({
      bandWide: null,
      members: [
        { member_id: 1, name: 'Alice', position: 'guitar', status: 'available', reason: null },
      ],
    })
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())
    await openTab(user, 'Participants')

    const participantSection = screen.getByRole('heading', { name: 'Participants' }).parentElement
    expect(participantSection).not.toBeNull()
    expect(await within(participantSection).findByText('Available')).toBeInTheDocument()
    expect(within(participantSection).getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /member availability/i })).not.toBeInTheDocument()
    await waitFor(() => expect(evaluateEventAvailability).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'gig',
      event_id: 1,
      start_date: '2026-06-15',
    })), { timeout: 1000 })
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
      () => expect(updateGig).toHaveBeenCalledWith(1, { admission: 'paid' })
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
        })
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
        )
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

describe('GigDetailContent — create invoice from Terms tab', () => {
  const FINANCE_USER = {
    id: 9,
    activeTenantRole: 'financial_admin',
    permissions: ['app.view', 'planning.write', 'finance.view', 'finance.manage'],
    bandMemberId: 3,
  }

  const GIG_WITH_ORG = {
    ...GIG_PAID,
    admission: 'free',
    ticket_link: null,
    venue: { id: 11, name: 'Bimhuis', organization_name: 'Stichting Bimhuis', category: 'venue', city: 'Amsterdam' },
  }

  function wrapAs(user, ui) {
    return render(
      <MemoryRouter>
        <AuthContext.Provider
          value={{
            user,
            setUser: () => {},
            logout: async () => {},
            switchTenant: async () => undefined,
            refreshUser: async () => undefined,
          }}
        >
          <ThemeProvider theme={theme}>
            <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
          </ThemeProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    )
  }

  beforeEach(() => {
    getGig.mockClear()
    listInvoicesByGig.mockReset()
    listInvoicesByGig.mockResolvedValue([])
    draftFromGig.mockReset()
    createInvoice.mockReset()
    navigate.mockClear()
  })

  async function openTerms(user) {
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await openTab(user, 'Terms')
  }

  it('creates a draft invoice after confirmation and navigates to it', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_ORG)
    draftFromGig.mockResolvedValue({
      billing_targets: [],
      draft: {
        gig_id: 1,
        customer_name: 'Stichting Bimhuis',
        lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: 15000, tax_percentage: 9, position: 0 }],
      },
    })
    createInvoice.mockResolvedValue({ id: 55 })

    wrapAs(FINANCE_USER, <GigDetailContent gigId={1} />)
    await openTerms(user)

    // The button lives under the "Related invoices" section heading
    const createButton = await screen.findByRole('button', { name: /create invoice/i })
    expect(screen.getByText('Related invoices')).toBeInTheDocument()
    await user.click(createButton)

    // Confirmation modal states the result: a draft invoice for the organisation
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/stichting bimhuis/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /create invoice/i }))

    await waitFor(() => expect(createInvoice).toHaveBeenCalled())
    expect(draftFromGig).toHaveBeenCalledWith(1)
    expect(createInvoice.mock.calls[0][0]).toMatchObject({ gig_id: 1, customer_name: 'Stichting Bimhuis' })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/invoices/55'))
  })

  it('does not create an invoice when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_ORG)

    wrapAs(FINANCE_USER, <GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.click(await screen.findByRole('button', { name: /create invoice/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(draftFromGig).not.toHaveBeenCalled()
    expect(createInvoice).not.toHaveBeenCalled()
  })

  it('uses the festival organisation when both a venue and festival are linked', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce({
      ...GIG_WITH_ORG,
      festival: { id: 22, name: 'Pinkpop', organization_name: 'Buro Pinkpop', category: 'festival', city: 'Landgraaf' },
    })

    wrapAs(FINANCE_USER, <GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.click(await screen.findByRole('button', { name: /create invoice/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/buro pinkpop/i)).toBeInTheDocument()
  })

  it('hides the button when an invoice is already linked to the gig', async () => {
    listInvoicesByGig.mockResolvedValue([
      { id: 5, invoice_number: '2026-001', status: 'draft', issue_date: '2026-06-16', total_cents: 15000 },
    ])
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_ORG)

    wrapAs(FINANCE_USER, <GigDetailContent gigId={1} />)
    await openTerms(user)

    await screen.findByText('#2026-001')
    expect(screen.queryByRole('button', { name: /create invoice/i })).not.toBeInTheDocument()
  })

  it('hides the button when neither venue nor festival has an organization name', async () => {
    const user = userEvent.setup()
    // default getGig venue has no organization_name

    wrapAs(FINANCE_USER, <GigDetailContent gigId={1} />)
    await openTerms(user)

    await waitFor(() => expect(listInvoicesByGig).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /create invoice/i })).not.toBeInTheDocument()
  })

  it('hides the button without the finance.manage permission', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_ORG)
    const viewer = { ...FINANCE_USER, activeTenantRole: 'contributor', permissions: ['app.view', 'planning.write', 'finance.view'] }

    wrapAs(viewer, <GigDetailContent gigId={1} />)
    await openTerms(user)

    await waitFor(() => expect(listInvoicesByGig).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /create invoice/i })).not.toBeInTheDocument()
  })
})

// A personal workspace reads through the cross-tenant hub instead of the active
// tenant — usePlanningSource decides that from the tenant kind on /auth/me, so
// the component takes no source prop. A gig owned by another band is read-only
// and loses the Terms and Participants tabs; a gig owned by the personal
// workspace itself behaves like any other.
describe('GigDetailContent — personal workspace', () => {
  const ARTIST_USER = {
    id: 9,
    activeTenantId: 1,
    activeTenantKind: 'personal',
    activeTenantRole: 'tenant_admin',
    permissions: ['app.view', 'planning.write', 'finance.view', 'finance.manage'],
    bandMemberId: 3,
  }

  const CROSS_BAND_GIG = {
    id: 1,
    tenantId: 9,
    tenantName: 'Other Band',
    tenantAvatarPath: null,
    event_date: '2026-08-12',
    event_description: 'Festival set',
    venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
    event_link: '',
    start_time: '20:00:00',
    end_time: '23:00:00',
    // Status no longer gates anything: the Participants tab always renders
    // BandParticipantsSection, whose inline availability is gated on tenant
    // kind/cross-band rather than status.
    status: 'confirmed',
    booking_fee_cents: 15000,
    admission: 'free',
    ticket_link: null,
    notes: 'Bring own PA',
    viewerBandMemberId: 22,
    tasks: [{ id: 5, title: 'Bring charts', assigned_to: 22, done: false }],
    attachments: [{ id: 6, original_filename: 'rider.pdf', file_size: 10 }],
    tags: [],
  }

  const OWN_GIG = { ...CROSS_BAND_GIG, tenantId: 1, tenantName: 'Solo', viewerBandMemberId: null }

  function asArtist(ui) {
    return (
      <MemoryRouter>
        <AuthContext.Provider
          value={{
            user: ARTIST_USER,
            setUser: () => {},
            logout: async () => {},
            switchTenant: async () => undefined,
            refreshUser: async () => undefined,
          }}
        >
          <ThemeProvider theme={theme}>
            <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
          </ThemeProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    )
  }

  const wrapAsArtist = (ui) => render(asArtist(ui))

  beforeEach(() => {
    vi.clearAllMocks()
    getMyGig.mockResolvedValue(CROSS_BAND_GIG)
    setMyTaskDone.mockImplementation(async (id, done) => ({ ...CROSS_BAND_GIG.tasks[0], id, done }))
    getGigMerchSummary.mockResolvedValue({ unitsSold: 0, netCents: 0, grossCents: 0 })
    listInvoicesByGig.mockResolvedValue([])
    listMembers.mockResolvedValue([])
    getAvailabilityOn.mockResolvedValue({ bandWide: null, members: [] })
  })

  // The split view swaps the gig id under a mounted detail pane. Until the new
  // gig arrives nothing is known about who owns it, so no tenant-scoped
  // sub-resource may be fetched for it — the previous gig's ownership says
  // nothing about this one, and in a personal workspace every such read 404s.
  it('fetches no sub-resources for a gig id whose owner is not known yet', async () => {
    getMyGig.mockResolvedValue(OWN_GIG)
    const view = wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    listGigContacts.mockClear()
    getGigMerchSummary.mockClear()
    listInvoicesByGig.mockClear()
    getMyGig.mockResolvedValue({ ...CROSS_BAND_GIG, id: 2 })

    view.rerender(asArtist(<GigDetailContent gigId={2} />))
    await act(async () => {})

    for (const fetcher of [listGigContacts, getGigMerchSummary, listInvoicesByGig]) {
      expect(fetcher.mock.calls.map(([id]) => id)).not.toContain(2)
    }
  })

  it("shows only Event and Tasks for another band's gig", async () => {
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'Event' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Terms' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Participants' })).not.toBeInTheDocument()

    // The Terms/Participants panels are unmounted, not merely hidden, so their
    // fields are gone too. The Event tab's band-availability panel is gated on
    // tenant kind (personal here) regardless, so it never mounts either.
    expect(screen.queryByLabelText(/paid admission/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/guaranteed fee/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/member availability/i)).not.toBeInTheDocument()
    expect(getAvailabilityOn).not.toHaveBeenCalled()
  })

  it('gives the event-banner slot to the source band', async () => {
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    // The gig banner is stripped cross-tenant, so the source band stands in for
    // it. The artist's own blurred banner behind it is untouched.
    expect(screen.getByTestId('source-tenant-switch')).toBeInTheDocument()
    expect(screen.getByText('Other Band')).toBeInTheDocument()
    expect(screen.queryByText(/no event banner/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add event banner/i })).not.toBeInTheDocument()
  })

  // The header banner is the viewer's own artist profile, so it frames every
  // gig they open from here — their own and the ones they play in other bands.
  it("keeps the artist's own header banner behind another band's gig", async () => {
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    expect(screen.getByTestId('band-banner')).toBeInTheDocument()
  })

  it('reads through /api/me and never calls a tenant-scoped endpoint', async () => {
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    expect(getMyGig.mock.calls[0][0]).toBe(1)
    expect(getGig).not.toHaveBeenCalled()
    expect(listMembers).not.toHaveBeenCalled()
    expect(getGigMerchSummary).not.toHaveBeenCalled()
    expect(listInvoicesByGig).not.toHaveBeenCalled()
    expect(getAvailabilityOn).not.toHaveBeenCalled()
  })

  it('renders the event fields read-only and saves nothing', async () => {
    const user = userEvent.setup()
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    expect(screen.getByLabelText(/event description/i)).toHaveAttribute('readonly')
    expect(screen.getByText(/you have read-only access/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/event description/i), 'x')
    expect(updateGig).not.toHaveBeenCalled()
  })

  it('lists attachments as plain text and drops the open-venue shortcut', async () => {
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    // object_key is stripped from the cross-tenant payload, so there is nothing
    // to link to; /venues/:id is tenant-scoped and would 404 from here.
    expect(screen.getByText('rider.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'rider.pdf' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('OpenInNewIcon')).not.toBeInTheDocument()
  })

  it('completes the viewer\'s own task through /api/me', async () => {
    const user = userEvent.setup()
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    await openTab(user, 'Tasks')
    await user.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(setMyTaskDone).toHaveBeenCalledWith(5, true))
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('keeps all four tabs and stays editable for the workspace\'s own gig', async () => {
    const user = userEvent.setup()
    getMyGig.mockResolvedValue(OWN_GIG)
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'Terms' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Participants' })).toBeInTheDocument()
    expect(screen.queryByTestId('source-tenant-switch')).not.toBeInTheDocument()
    // /band-members is band-only, so a personal workspace has no roster to load
    // even for its own gig — asking would 403.
    expect(listMembers).not.toHaveBeenCalled()

    await openTab(user, 'Terms')
    await user.type(screen.getByLabelText(/merchandise cut/i), '15')
    await waitFor(() => expect(updateGig).toHaveBeenCalledWith(1, { merchandise_cut: 15 }))
  })
})
