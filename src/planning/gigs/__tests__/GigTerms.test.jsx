import { render, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GigDetailContent from '../components/gigdetails/GigDetailContent.tsx'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import { AuthContext } from '../../../contexts/authContext.ts'
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
  getGig: vi.fn(),
  getGigMerchSummary: vi.fn().mockResolvedValue({ unitsSold: 0, netCents: 0, grossCents: 0 }),
  updateGig: vi.fn().mockResolvedValue({}),
  addGigParticipant: vi.fn().mockResolvedValue({}),
  removeGigParticipant: vi.fn().mockResolvedValue({}),
  setGigVote: vi.fn().mockResolvedValue({}),
  uploadGigBanner: vi.fn().mockResolvedValue({}),
  deleteGigBanner: vi.fn().mockResolvedValue({}),
  listGigContacts: vi.fn().mockResolvedValue([]),
  addGigContact: vi.fn().mockResolvedValue({}),
  setGigContactPrimary: vi.fn().mockResolvedValue({}),
  removeGigContact: vi.fn().mockResolvedValue(undefined),
  searchGigTags: vi.fn().mockResolvedValue([]),
  setGigTags: vi.fn().mockResolvedValue([]),
  createTask: vi.fn().mockResolvedValue({}),
  updateTask: vi.fn().mockResolvedValue({}),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  uploadGigAttachment: vi.fn().mockResolvedValue({}),
  deleteGigAttachment: vi.fn().mockResolvedValue(undefined),
  listGigCosts: vi.fn().mockResolvedValue([]),
  addGigCost: vi.fn(),
  updateGigCost: vi.fn(),
  deleteGigCost: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../availability/me.ts', () => ({ getMyGig: vi.fn(), setMyTaskDone: vi.fn() }))
vi.mock('../../../people/my-bands/myBands.ts', () => ({
  listMyBands: vi.fn().mockResolvedValue({ items: [] }),
}))
vi.mock('../../../people/profiles/profile.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  getBannerPath: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../../finance/invoices/invoices.ts', () => ({
  listInvoicesByGig: vi.fn().mockResolvedValue([]),
  draftFromGig: vi.fn(),
  createInvoice: vi.fn(),
}))
vi.mock('../../../people/venues/venues.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../people/venues/geocode.ts', () => ({ geocodePlace: vi.fn(() => Promise.resolve(null)) }))
vi.mock('../components/map/GigLocationMap.tsx', () => ({ default: () => <div /> }))

import { addGigCost, deleteGigCost, getGig, updateGigCost } from '../gigs.ts'

// A guarantee that clears break-even well before capacity, so every tile in the
// statement and the simulation carries a number worth asserting on.
const GUARANTEE_GIG = {
  id: 1,
  event_date: '2026-06-15',
  event_description: 'Jazz Night',
  venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
  start_time: '20:00:00',
  end_time: '23:00:00',
  status: 'confirmed',
  admission: 'paid',
  ticket_link: null,
  notes: '',
  tasks: [],
  attachments: [],
  participants: [],
  tags: [],
  deal_type: 'guarantee',
  guaranteed_fee_cents: 100000,
  percentage_of_sales: '70.00',
  breakeven_includes_venue_costs: true,
  venue_costs_cents: 80000,
  venue_capacity: 300,
  expected_visitors: 200,
  tickets_sold: 120,
  ticket_price_net_cents: 2000,
  ticket_price_gross_cents: 2420,
  agency_fee_basis: 'percentage',
  agency_fee_percentage: '10.00',
  agency_fee_amount_cents: 0,
  agency_fee_mode: 'inclusive',
  commission_basis: 'none',
  commission_percentage: '0.00',
  commission_amount_cents: 0,
  costs: [
    { id: 41, label: 'Travel', amount_cents: 12500, position: 0 },
    { id: 42, label: 'Catering', amount_cents: 2500, position: 1 },
  ],
}

const USER = {
  id: 9,
  activeTenantRole: 'tenant_admin',
  permissions: ['app.view', 'planning.write', 'finance.view', 'finance.manage'],
  bandMemberId: 3,
}

function wrap(ui) {
  return render(
    <MemoryRouter>
      <DialogProvider>
        <AuthContext.Provider
          value={{
            user: USER,
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
      </DialogProvider>
    </MemoryRouter>
  )
}

async function openTerms(user) {
  await waitFor(() => screen.getByLabelText(/merchandise cut/i))
  await user.click(screen.getByRole('button', { name: 'Terms' }))
}

// Intl separates the € from the amount with a non-breaking space.
function normalizeSpaces(text) {
  return text.replace(/[\u00a0\u202f]/g, ' ')
}

// Reads the amount out of a statement/upside tile by its label. Intl puts a
// non-breaking space after the €, so normalize it away before comparing.
// Scoped to the owning section: several tile labels also name an input above.
function tileValue(sectionTestId, label) {
  const caption = within(screen.getByTestId(sectionTestId)).getByText(label)
  const text = within(caption.closest('.MuiPaper-root')).getByRole('heading').textContent
  return normalizeSpaces(text)
}


const statementValue = (label) => tileValue('artist-statement', label)
const upsideValue = (label) => tileValue('ticket-upside', label)

beforeEach(() => {
  vi.clearAllMocks()
  getGig.mockResolvedValue(GUARANTEE_GIG)
})

describe('artist statement', () => {
  it('reads the deal back as money', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(statementValue('Gross fee')).toBe('€ 1.000,00')
    expect(statementValue('Costs')).toBe('€ 150,00')
    expect(statementValue('Nett. fee')).toBe('€ 850,00')
    // 10% of the gross fee, inclusive — so it comes out of the artist's side.
    expect(statementValue('Booking fee')).toBe('€ 100,00')
    expect(statementValue('Commission')).toBe('€ 0,00')
    expect(statementValue('Due to booker')).toBe('€ 100,00')
    expect(statementValue('Due to artist')).toBe('€ 750,00')
  })

  it('spells out each figure in a description rather than replacing its label', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    const statement = screen.getByTestId('artist-statement')
    const tile = within(statement).getByText('Nett. fee').closest('.MuiPaper-root')
    expect(tile).toHaveAccessibleDescription(/^Gross fee €\s1\.000,00 minus costs €\s150,00\.$/)
    // The breakdown describes the tile; it must not become the tile's label and
    // hide the figure it is explaining.
    expect(tile).not.toHaveAttribute('aria-label')
    expect(within(tile).getByText('Nett. fee')).toBeInTheDocument()
  })

  it('recalculates while the deal is still being typed', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.clear(screen.getByLabelText(/guaranteed fee/i))
    await user.type(screen.getByLabelText(/guaranteed fee/i), '2000')

    await waitFor(() => expect(statementValue('Gross fee')).toBe('€ 2.000,00'))
    expect(statementValue('Nett. fee')).toBe('€ 1.850,00')
  })
})

describe('ticket upside', () => {
  it('shows break-even, expected and potential shares', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    // € 1000 fee + € 800 venue costs at € 20.00 a ticket.
    expect(upsideValue('Tickets to break even')).toBe('90')
    expect(upsideValue('Tickets sold')).toBe('120 / 300')
    // 200 × € 20.00 − € 1800.00 = € 2200.00 × 70%.
    expect(upsideValue('Expected upside')).toBe('€ 1.540,00')
    // 300 × € 20.00 − € 1800.00 = € 4200.00 × 70%.
    expect(upsideValue('Potential upside')).toBe('€ 2.940,00')
  })

  it('replaces the tiles with a note on a flat fee', async () => {
    getGig.mockResolvedValue({ ...GUARANTEE_GIG, deal_type: 'flat_fee' })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(screen.getByText(/a flat fee takes no share of ticket revenue/i)).toBeInTheDocument()
    expect(screen.queryByText('Tickets to break even')).not.toBeInTheDocument()
  })
})

describe('cost lines', () => {
  it('lists the gig\'s costs with their total', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(screen.getByDisplayValue('Travel')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Catering')).toBeInTheDocument()
    expect(screen.getByText('Total costs').parentElement).toHaveTextContent('€ 150,00')
  })

  it('adds a cost and folds it into the statement', async () => {
    addGigCost.mockResolvedValue({ id: 43, label: 'Backline', amount_cents: 7500, position: 2 })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    const labelInputs = screen.getAllByLabelText(/^cost$/i)
    const amountInputs = screen.getAllByLabelText(/^amount$/i)
    // The last pair is the empty draft row.
    await user.type(labelInputs[labelInputs.length - 1], 'Backline')
    await user.type(amountInputs[amountInputs.length - 1], '75')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(addGigCost).toHaveBeenCalledWith(1, { label: 'Backline', amount_cents: 7500 }))
    await waitFor(() => expect(statementValue('Costs')).toBe('€ 225,00'))
    expect(statementValue('Nett. fee')).toBe('€ 775,00')
  })

  it('will not add a cost without a label', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
    expect(addGigCost).not.toHaveBeenCalled()
  })

  it('saves an edited cost on blur', async () => {
    updateGigCost.mockResolvedValue({ id: 41, label: 'Travel (van)', amount_cents: 20000, position: 0 })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    const travel = screen.getByDisplayValue('Travel')
    await user.clear(travel)
    await user.type(travel, 'Travel (van)')
    await user.tab()

    await waitFor(
      () => expect(updateGigCost).toHaveBeenCalledWith(1, 41, { label: 'Travel (van)', amount_cents: 12500 })
    )
  })

  it('rolls a rejected edit back to the stored row and says why', async () => {
    updateGigCost.mockRejectedValue(new Error('Invalid label'))
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    const travel = screen.getByDisplayValue('Travel')
    await user.clear(travel)
    await user.type(travel, 'Something else')
    await user.tab()

    await waitFor(() => expect(screen.getByText('Invalid label')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Travel')).toBeInTheDocument()
    // The statement keeps the stored figure rather than the rejected one.
    expect(statementValue('Costs')).toBe('€ 150,00')
  })

  it('reports a failed add without clearing what was typed', async () => {
    addGigCost.mockRejectedValue(new Error('A gig can have at most 50 cost lines'))
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    const labelInputs = screen.getAllByLabelText(/^cost$/i)
    await user.type(labelInputs[labelInputs.length - 1], 'Backline')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(screen.getByText(/at most 50 cost lines/i)).toBeInTheDocument())
    expect(screen.getByDisplayValue('Backline')).toBeInTheDocument()
  })

  it('does not save an unchanged cost', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.click(screen.getByDisplayValue('Travel'))
    await user.tab()

    expect(updateGigCost).not.toHaveBeenCalled()
  })

  it('deletes a cost only after the confirmation is accepted', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.click(screen.getAllByRole('button', { name: /delete cost/i })[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/delete "travel"\?/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    expect(deleteGigCost).not.toHaveBeenCalled()

    // The open dialog aria-hides the rest of the app, so the row's own controls
    // are out of the accessible tree until the close transition finishes.
    await waitForElementToBeRemoved(() => screen.queryByRole('dialog'))
    await user.click(screen.getAllByRole('button', { name: /delete cost/i })[0])
    const reopened = await screen.findByRole('dialog')
    await user.click(within(reopened).getByRole('button', { name: /delete/i }))

    await waitFor(() => expect(deleteGigCost).toHaveBeenCalledWith(1, 41))
    await waitFor(() => expect(statementValue('Costs')).toBe('€ 25,00'))
  })
})
