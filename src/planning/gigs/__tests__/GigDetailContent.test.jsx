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
    guaranteed_fee_cents: 15000,
    admission: 'free',
    ticket_link: null,
    info_blocks: [{ id: 9, label: 'remarks', label_is_custom: false, content: 'Bring own PA', position: 0 }],
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
  addGigInfoBlock: vi.fn().mockResolvedValue({ id: 9, label: 'remarks', label_is_custom: false, content: '', position: 0 }),
  updateGigInfoBlock: vi.fn().mockResolvedValue({}),
  deleteGigInfoBlock: vi.fn().mockResolvedValue(undefined),
  listGigCosts: vi.fn().mockResolvedValue([]),
  addGigCost: vi.fn().mockResolvedValue({ id: 1, label: 'Travel', amount_cents: 12500, position: 0 }),
  updateGigCost: vi.fn().mockResolvedValue({ id: 1, label: 'Travel', amount_cents: 15000, position: 0 }),
  deleteGigCost: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../availability/me.ts', () => ({
  getMyGig: vi.fn(),
  setMyTaskDone: vi.fn(),
}))

// The band picker only fetches in a personal workspace; a band tenant fails the
// capability gate before this is ever called.
vi.mock('../../../people/my-bands/myBands.ts', () => ({
  listMyBands: vi.fn().mockResolvedValue({ items: [] }),
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

import { getGig, getGigMerchSummary, listGigContacts, setGigTags, setGigVote, updateGig, updateGigInfoBlock, updateTask } from '../gigs.ts'
import { createInvoice, draftFromGig, listInvoicesByGig } from '../../../finance/invoices/invoices.ts'
import { evaluateEventAvailability, getAvailabilityOn } from '../../availability/availability.ts'
import { listMembers } from '../../../people/memberships/bandMembers.ts'
import { getMyGig, setMyTaskDone } from '../../availability/me.ts'
import { listMyBands } from '../../../people/my-bands/myBands.ts'
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
  guaranteed_fee_cents: 15000,
  admission: 'paid',
  ticket_link: 'https://tickets.example.com',
  notes: '',
  tasks: [],
  attachments: [],
  participants: [],
  tags: [],
}

const GIG_FREE = { ...GIG_PAID, admission: 'free', ticket_link: null }

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

  // The deal type carries what the paid-admission switch used to say, so the
  // switch is gone and the ticket link no longer hides behind it.
  it('has no paid admission switch', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    expect(screen.queryByLabelText(/paid admission/i)).not.toBeInTheDocument()
  })

  it('always shows the ticket link field', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    expect(screen.getByLabelText(/ticket link/i)).toBeInTheDocument()
  })

  it('populates the ticket link when the gig has one', async () => {
    getGig.mockResolvedValueOnce(GIG_PAID)
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    expect(screen.getByDisplayValue('https://tickets.example.com')).toBeInTheDocument()
    expect(screen.getByLabelText(/guaranteed fee/i)).toBeInTheDocument()
  })

  // The old free-text notes field became the Remarks block of the Additional
  // information section, which migration 190 carried the content into.
  it('shows the migrated notes as the Remarks block on the Tasks tab', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Tasks')

    expect(screen.getByText('Additional information')).toBeInTheDocument()
    expect(screen.getByLabelText('Remarks / Notes')).toHaveValue('Bring own PA')
  })

  it('saves an edited information block against its own endpoint', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Tasks')
    await user.type(screen.getByLabelText('Remarks / Notes'), ' + DI')

    await waitFor(
      () => expect(updateGigInfoBlock).toHaveBeenCalledWith(1, 9, { content: 'Bring own PA + DI' }),
      { timeout: 3000 },
    )
    // The gig's own PATCH is untouched: blocks are a sub-resource now.
    expect(updateGig).not.toHaveBeenCalled()
  })

  it('renders the deal sections when the Terms tab is selected', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Terms')
    expect(screen.getByRole('heading', { name: /^deal$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^booking fee$/i })).toBeInTheDocument()
  })

  it('renames Band fee to Guaranteed fee', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/guaranteed fee/i))
    expect(screen.queryByLabelText(/band fee/i)).not.toBeInTheDocument()
  })

  // The ticket share hangs off the deal type, not off admission: a door deal
  // can be agreed before ticketing is, and free admission must not wipe it.
  it('hides the ticket share on a flat fee', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    expect(screen.queryByLabelText(/ticket percentage/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/venue \/ promoter/i)).not.toBeInTheDocument()
  })

  it('shows the ticket share on a guarantee, free admission or not', async () => {
    getGig.mockResolvedValueOnce({ ...GIG_FREE, deal_type: 'guarantee', percentage_of_sales: 70 })
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket percentage/i))
    expect(screen.getByLabelText(/ticket percentage/i)).toHaveValue(70)
    // The venue's half of the split is derived, never stored.
    expect(screen.getByLabelText(/venue \/ promoter/i)).toHaveValue(30)
  })

  // One label for the pair, whatever the deal type: whether the share is taken
  // before or after break-even is the deal type's own business.
  it('names the share the same way on a guarantee vs.', async () => {
    getGig.mockResolvedValueOnce({
      ...GIG_FREE,
      deal_type: 'guarantee',
      guarantee_variant: 'versus',
      percentage_of_sales: 50,
    })
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket percentage/i))
    expect(screen.getByLabelText(/ticket percentage/i)).toHaveValue(50)
    expect(screen.getByLabelText(/venue \/ promoter/i)).toHaveValue(50)
  })

  it('drops the guaranteed fee on a door deal', async () => {
    getGig.mockResolvedValueOnce({ ...GIG_FREE, deal_type: 'door_deal', percentage_of_sales: 70 })
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket percentage/i))
    expect(screen.queryByLabelText(/guaranteed fee/i)).not.toBeInTheDocument()
  })

  // A band's own gigs are already the band's, so there is nothing to pick and
  // the collection is never fetched.
  it('shows no band picker in a band workspace', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())
    expect(screen.queryByTestId('my-band-identity')).not.toBeInTheDocument()
    expect(listMyBands).not.toHaveBeenCalled()
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

  it('saves the artist ticket share as a number', async () => {
    getGig.mockResolvedValueOnce({ ...GIG_PAID, deal_type: 'guarantee' })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket percentage/i))
    await openTab(user, 'Terms')
    await user.type(screen.getByLabelText(/ticket percentage/i), '20')
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { percentage_of_sales: 20 })
    )
  })

  // Editing the venue's half writes the artist's, so the pair cannot drift
  // off 100 — there is only ever one stored number.
  it('saves the complement when the venue share is edited', async () => {
    getGig.mockResolvedValueOnce({ ...GIG_PAID, deal_type: 'guarantee' })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/venue \/ promoter/i))
    await openTab(user, 'Terms')
    await user.type(screen.getByLabelText(/venue \/ promoter/i), '30')
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { percentage_of_sales: 70 })
    )
  })

  it('saves money terms as cents and counts as whole numbers', async () => {
    getGig.mockResolvedValueOnce({ ...GIG_PAID, deal_type: 'guarantee' })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Terms')

    await user.type(screen.getByRole('spinbutton', { name: /^venue costs$/i }), '800')
    await waitFor(() => expect(updateGig).toHaveBeenCalledWith(1, { venue_costs_cents: 80000 }))

    await user.type(screen.getByLabelText(/venue capacity/i), '300')
    await waitFor(() => expect(updateGig).toHaveBeenCalledWith(1, {
      venue_capacity: 300,
      venue_costs_cents: 80000,
    }))
  })

  // The booking fee and commission sit on NOT NULL columns: a blanked input has
  // to send 0, never null, or the server 400s on a constraint it owns.
  it('sends zero rather than null when a NOT NULL fee input is blanked', async () => {
    getGig.mockResolvedValueOnce({ ...GIG_PAID, agency_fee_basis: 'amount', agency_fee_amount_cents: 5000 })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Terms')
    await user.clear(screen.getByLabelText(/booking fee amount/i))
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { agency_fee_amount_cents: 0 })
    )
  })

  it('saves the deal type on its own when it is switched', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Terms')
    // Exact: the field's help icon is named "About this deal type".
    await user.click(screen.getByLabelText('Deal type'))
    await user.click(screen.getByRole('option', { name: 'Door deal' }))
    await waitFor(() => expect(updateGig).toHaveBeenCalledWith(1, {
      deal_type: 'door_deal',
      guarantee_variant: null,
    }))
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
    expect(screen.getByLabelText(/guaranteed fee/i)).toHaveAttribute('readonly')
    expect(screen.getByLabelText(/venue costs/i)).toHaveAttribute('readonly')
    expect(screen.getByLabelText(/notes/i)).toHaveAttribute('readonly')
    expect(screen.getByText(/you have read-only access/i)).toBeInTheDocument()
  })

  it('hides the banner upload control', async () => {
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    expect(screen.queryByRole('button', { name: /upload banner/i })).not.toBeInTheDocument()
  })

  it('does not auto-save when a disabled control is clicked', async () => {
    // pointerEventsCheck:0 lets us drive the click through the disabled control;
    // because the select is disabled its onChange never fires, so nothing saves.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Terms')
    expect(screen.getByLabelText('Deal type')).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByLabelText('Deal type'))
    expect(updateGig).not.toHaveBeenCalled()
  })

  it('offers no way to add or remove a cost line', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Terms')
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete cost/i })).not.toBeInTheDocument()
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
    getGig.mockResolvedValueOnce({ ...GIG_PAID })
    wrapAsRole(
      { id: 9, activeTenantRole: role, permissions, bandMemberId: 3 },
      <GigDetailContent gigId={1} canWrite={canWrite} />,
    )

    await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())
    await openTab(user, 'Terms')

    expect(screen.queryByRole('heading', { name: /^terms$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/guaranteed fee/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/venue costs/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/ticket link/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finance' })).not.toBeInTheDocument()
    expect(screen.queryByText(/merchandise sold/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/related invoices/i)).not.toBeInTheDocument()
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
    guaranteed_fee_cents: 15000,
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
    const user = userEvent.setup()
    getGigMerchSummary.mockResolvedValueOnce({ unitsSold: 37, netCents: 12345, grossCents: 14937 })
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Finance')
    await waitFor(() => expect(screen.getByText(/merchandise sold/i)).toBeInTheDocument())
    expect(screen.getByText(/37 items · excl\. VAT/i)).toBeInTheDocument()
    expect(screen.getByText(/123,45/)).toBeInTheDocument()
  })

  it('renders "1 item" (singular) for a single unit', async () => {
    const user = userEvent.setup()
    getGigMerchSummary.mockResolvedValueOnce({ unitsSold: 1, netCents: 1000, grossCents: 1210 })
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Finance')
    await waitFor(() => expect(screen.getByText(/1 item · excl\. VAT/i)).toBeInTheDocument())
  })

  it('hides the card when there are no sales', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Finance')
    expect(screen.queryByText(/merchandise sold/i)).not.toBeInTheDocument()
  })

  it('does not render the card or fetch the summary for readers', async () => {
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    expect(screen.queryByText(/merchandise sold/i)).not.toBeInTheDocument()
    expect(getGigMerchSummary).not.toHaveBeenCalled()
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
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Terms')
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
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Terms')
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
    guaranteed_fee_cents: 15000,
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
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    expect(geocodePlace).not.toHaveBeenCalled()
    expect(screen.queryByTestId('gig-location-map')).not.toBeInTheDocument()
  })

  it('drops a geocode result that resolves after unmount (no stale pin)', async () => {
    let resolve
    geocodePlace.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const { unmount } = wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    unmount()
    await act(async () => { resolve({ lat: 1, lon: 2 }) })
    expect(screen.queryByTestId('gig-location-map')).not.toBeInTheDocument()
  })
})

describe('GigDetailContent — create invoice from Finance tab', () => {
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

  async function openFinance(user) {
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    await openTab(user, 'Finance')
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
    await openFinance(user)

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
    await openFinance(user)

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
    await openFinance(user)

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
    await openFinance(user)

    await screen.findByText('#2026-001')
    expect(screen.queryByRole('button', { name: /create invoice/i })).not.toBeInTheDocument()
  })

  it('hides the button when neither venue nor festival has an organization name', async () => {
    const user = userEvent.setup()
    // default getGig venue has no organization_name

    wrapAs(FINANCE_USER, <GigDetailContent gigId={1} />)
    await openFinance(user)

    await waitFor(() => expect(listInvoicesByGig).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /create invoice/i })).not.toBeInTheDocument()
  })

  it('hides the button without the finance.manage permission', async () => {
    const user = userEvent.setup()
    getGig.mockResolvedValueOnce(GIG_WITH_ORG)
    const viewer = { ...FINANCE_USER, activeTenantRole: 'contributor', permissions: ['app.view', 'planning.write', 'finance.view'] }

    wrapAs(viewer, <GigDetailContent gigId={1} />)
    await openFinance(user)

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
    guaranteed_fee_cents: 15000,
    admission: 'free',
    ticket_link: null,
    info_blocks: [{ id: 9, label: 'remarks', label_is_custom: false, content: 'Bring own PA', position: 0 }],
    viewerBandMemberId: 22,
    tasks: [{ id: 5, title: 'Bring charts', assigned_to: 22, done: false }],
    attachments: [{ id: 6, original_filename: 'rider.pdf', file_size: 10 }],
    tags: [],
  }

  const OWN_GIG = {
    ...CROSS_BAND_GIG,
    tenantId: 1,
    tenantName: 'Solo',
    viewerBandMemberId: null,
    my_band: { id: 4, name: 'Static Waves', country_code: 'NL' },
  }

  const MY_BANDS = [
    { id: 4, bandProfile: { id: 40, name: 'Static Waves', country_code: 'NL' }, eventCounts: {}, addedAt: '2026-01-01' },
    { id: 5, bandProfile: { id: 50, name: 'Nirvana', country_code: 'US' }, eventCounts: {}, addedAt: '2026-01-01' },
  ]

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
    listMyBands.mockResolvedValue({ items: MY_BANDS })
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
    expect(screen.queryByRole('button', { name: 'Finance' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Participants' })).not.toBeInTheDocument()

    // The Terms/Participants panels are unmounted, not merely hidden, so their
    // fields are gone too. The Event tab's band-availability panel is gated on
    // tenant kind (personal here) regardless, so it never mounts either.
    expect(screen.queryByLabelText(/ticket link/i)).not.toBeInTheDocument()
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
    // The personal workspace has a fixed participant, not an editable roster.
    expect(listMembers).not.toHaveBeenCalled()

    await openTab(user, 'Terms')
    await user.type(screen.getByLabelText(/venue capacity/i), '15')
    await waitFor(() => expect(updateGig).toHaveBeenCalledWith(1, { venue_capacity: 15 }))
  })

  // The band switcher takes the event-banner slot for a gigbuddy band's gig; a
  // band profile is not a tenant to switch into, so it gets the top of the Event
  // tab instead — between the tab pill and the event fields.
  it("labels the workspace's own gig with its band, above the Event tab content", async () => {
    getMyGig.mockResolvedValue(OWN_GIG)
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    const identity = screen.getByTestId('my-band-identity')
    expect(identity).toHaveTextContent('SW')
    expect(screen.getByRole('combobox', { name: 'Band' })).toHaveTextContent('Static Waves')

    const tabPill = screen.getByRole('button', { name: 'Tasks' })
    const description = screen.getByLabelText(/event description/i)
    expect(tabPill.compareDocumentPosition(identity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(identity.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('relinks the gig to another band through the tenant route', async () => {
    const user = userEvent.setup()
    getMyGig.mockResolvedValue(OWN_GIG)
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    await user.click(await screen.findByRole('combobox', { name: 'Band' }))
    await user.click(screen.getByRole('option', { name: 'Nirvana' }))

    await waitFor(() => expect(updateGig).toHaveBeenCalledWith(1, { my_band_id: 5 }))
    // Re-read so the avatar follows what the server actually stored.
    await waitFor(() => expect(getMyGig.mock.calls.length).toBeGreaterThan(1))
  })

  it("shows no band picker for another band's gig", async () => {
    wrapAsArtist(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    expect(screen.queryByTestId('my-band-identity')).not.toBeInTheDocument()
    expect(screen.getByTestId('source-tenant-switch')).toBeInTheDocument()
  })

  it('leaves the picker read-only for a reader', async () => {
    getMyGig.mockResolvedValue(OWN_GIG)
    wrapAsArtist(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => expect(screen.getByDisplayValue('Festival set')).toBeInTheDocument())

    expect(await screen.findByRole('combobox', { name: 'Band' })).toHaveAttribute('aria-disabled', 'true')
  })
})
