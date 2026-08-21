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

import { addGigCost, deleteGigCost, getGig, updateGig, updateGigCost } from '../gigs.ts'

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
  guarantee_variant: 'plus',
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
  await waitFor(() => screen.getByLabelText(/ticket link/i))
  await user.click(screen.getByRole('button', { name: 'Terms' }))
}

// The artist statement moved to the Finance tab; Terms keeps the editable
// deal fields and the ticket upside simulation.
async function openFinance(user) {
  await waitFor(() => screen.getByLabelText(/ticket link/i))
  await user.click(screen.getByRole('button', { name: 'Finance' }))
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

// The "Tickets sold" tile's card, for reading its folded caption/tooltip.
function soldTicketsCard() {
  return within(screen.getByTestId('ticket-upside')).getByText('Tickets sold').closest('.MuiPaper-root')
}

// Every explanation hangs off the field it explains, so its icon is found
// through that field rather than by a name of its own.
function fieldHelp(fieldLabel) {
  const field = screen.getByLabelText(fieldLabel).closest('.MuiFormControl-root')
  return within(field).getByRole('button', { name: /more information/i })
}

async function readHelp(user, fieldLabel) {
  await user.hover(fieldHelp(fieldLabel))
  const tip = await screen.findByRole('tooltip')
  return tip.textContent
}

beforeEach(() => {
  vi.clearAllMocks()
  getGig.mockResolvedValue(GUARANTEE_GIG)
})

describe('artist statement', () => {
  it('reads the deal back as money', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openFinance(user)

    // 120 of 300 sold at € 20,00 nett, € 1.800,00 recouped first, 70% of the
    // rest: € 420,00 ticket revenue folded into the € 1.420,00 gross fee.
    expect(statementValue('Gross fee')).toBe('€ 1.420,00')
    expect(statementValue('Costs')).toBe('€ 150,00')
    // Both cost lines default to paid_by artist, which never reaches the nett
    // fee — only a cost paid by artist/agency would.
    expect(statementValue('Nett. fee')).toBe('€ 1.420,00')
    // 10% of the gross fee, so it comes out of the artist's side.
    expect(statementValue('Booking fee')).toBe('€ 142,00')
    expect(statementValue('Commission')).toBe('€ 0,00')
    expect(statementValue('Due to booker')).toBe('€ 142,00')
    expect(statementValue('Due to artist')).toBe('€ 1.128,00')
  })

  it('spells out how the guarantee and the door add up to the gross fee', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openFinance(user)

    const statement = screen.getByTestId('artist-statement')
    const gross = within(statement).getByText('Gross fee').closest('.MuiPaper-root')
    // Ticket revenue has no tile of its own — its share is spelled out in the
    // gross fee's own tooltip instead.
    expect(gross).toHaveAccessibleDescription(
      /^Guaranteed fee €\s1\.000,00 plus €\s420,00 earned on the tickets sold so far\. .*70\.0% share of the 120 tickets sold so far/
    )
  })

  it('reworks the fee the booker earns when the tickets sold change', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.clear(screen.getByLabelText(/tickets sold/i))
    await user.type(screen.getByLabelText(/tickets sold/i), '200')
    await openFinance(user)

    // 200 × € 20,00 = € 4.000,00 − € 1.800,00 = € 2.200,00 × 70% = € 1.540,00
    // ticket revenue, folded into a € 2.540,00 gross fee.
    await waitFor(() => expect(statementValue('Gross fee')).toBe('€ 2.540,00'))
    // The booking fee follows the door, not the guarantee alone.
    expect(statementValue('Booking fee')).toBe('€ 254,00')
  })

  it('counts nothing from a door that has sold nothing yet', async () => {
    getGig.mockResolvedValue({ ...GUARANTEE_GIG, tickets_sold: null })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openFinance(user)

    expect(statementValue('Gross fee')).toBe('€ 1.000,00')
    const gross = within(screen.getByTestId('artist-statement'))
      .getByText('Gross fee')
      .closest('.MuiPaper-root')
    expect(gross).toHaveAccessibleDescription(/No tickets sold have been entered yet\.$/)
  })

  it('spells out each figure in a description rather than replacing its label', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openFinance(user)

    const statement = screen.getByTestId('artist-statement')
    const tile = within(statement).getByText('Nett. fee').closest('.MuiPaper-root')
    // The gig's costs are paid by artist, not artist/agency, so none of the
    // € 150,00 shown on the Costs tile reaches the nett fee.
    expect(tile).toHaveAccessibleDescription(/^Gross fee €\s1\.420,00 minus costs €\s0,00\.$/)
    // The breakdown describes the tile; it must not become the tile's label and
    // hide the figure it is explaining.
    expect(tile).not.toHaveAttribute('aria-label')
    expect(within(tile).getByText('Nett. fee')).toBeInTheDocument()
  })

  it('lets the commission go negative on a gig whose costs have eaten the fee', async () => {
    getGig.mockResolvedValue({
      ...GUARANTEE_GIG,
      tickets_sold: null,
      commission_basis: 'percentage',
      commission_percentage: '10.00',
      // artist_agency, so this cost reaches the shared base both the booking
      // fee and the nett fee are calculated on.
      costs: [{ id: 41, label: 'Backline', amount_cents: 200000, paid_by: 'artist_agency', position: 0 }],
    })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openFinance(user)

    // The € 2.000,00 cost outruns the € 1.000,00 fee, so the shared base
    // goes to -€ 1.000,00: the booking fee floors at zero, but the
    // commission does not — 10% of -€ 1.000,00 is -€ 100,00.
    expect(statementValue('Booking fee')).toBe('€ 0,00')
    expect(statementValue('Commission')).toBe('€ -100,00')
    expect(statementValue('Due to booker')).toBe('€ -100,00')

    const commission = within(screen.getByTestId('artist-statement'))
      .getByText('Commission')
      .closest('.MuiPaper-root')
    expect(commission).toHaveAccessibleDescription('10% of the nett fee minus the booking fee (€ -1.000,00).')
  })

  it('recalculates while the deal is still being typed', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.clear(screen.getByLabelText(/guaranteed fee/i))
    await user.type(screen.getByLabelText(/guaranteed fee/i), '2000')
    await openFinance(user)

    // A bigger guarantee is a higher break-even: € 2.800,00 now has to be
    // recouped, which the 120 tickets sold no longer reach, so the door adds
    // nothing to the gross fee.
    await waitFor(() => expect(statementValue('Gross fee')).toBe('€ 2.000,00'))
    // Unaffected — the gig's costs default to paid_by artist.
    expect(statementValue('Nett. fee')).toBe('€ 2.000,00')
  })
})

describe('deal type controls', () => {
  it('offers three deal types and shows the plus controls for a guarantee', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.click(screen.getByLabelText('Deal type'))
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Flat fee',
      'Guarantee',
      'Door deal',
    ])
    await user.keyboard('{Escape}')

    expect(screen.getByLabelText('Guarantee variant')).toHaveTextContent('Plus')
    expect(screen.getByLabelText(/include venue costs/i)).toBeInTheDocument()
  })

  it('shows no venue-cost toggle for versus and no variant selector outside a guarantee', async () => {
    getGig.mockResolvedValueOnce({ ...GUARANTEE_GIG, guarantee_variant: 'versus' })
    const user = userEvent.setup()
    const rendered = wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(screen.getByLabelText('Guarantee variant')).toHaveTextContent('Versus')
    expect(screen.queryByLabelText(/include venue costs/i)).not.toBeInTheDocument()

    rendered.unmount()
    getGig.mockResolvedValueOnce({ ...GUARANTEE_GIG, deal_type: 'flat_fee', guarantee_variant: null })
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)
    expect(screen.queryByLabelText('Guarantee variant')).not.toBeInTheDocument()
  })
})

describe('field help', () => {
  it('spells out nothing until a field\'s help icon is asked', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(screen.queryByText(/potential upside from ticket sales/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/production costs recouped from ticket revenue/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/used to simulate the potential upside/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/basis for every calculation below/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/calculated from the gross fee/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/split out of the gross fee/i)).not.toBeInTheDocument()

    const help = fieldHelp('Deal type')
    await user.hover(help)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/potential upside from ticket sales/i)
    // The explanation describes the icon; a paragraph must not become its name,
    // or it would answer to the deal fields' own label queries.
    expect(help).toHaveAccessibleDescription(/potential upside from ticket sales/i)
    expect(screen.getByLabelText(/guaranteed fee/i)).toHaveValue(1000)
  })

  it('hangs each explanation off the field it explains', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(await readHelp(user, 'Venue costs')).toMatch(/production costs recouped from ticket revenue/i)
    expect(await readHelp(user, 'Expected visitors')).toMatch(/used to simulate the potential upside/i)
    expect(await readHelp(user, 'Nett. ticket price')).toMatch(/basis for every calculation below/i)
    // Both fee blocks reuse one field pair, so each states its own basis.
    expect(await readHelp(user, 'Booking fee percentage')).toMatch(/calculated from the gross fee/i)
  })

  it('explains the deal type that is actually selected', async () => {
    getGig.mockResolvedValue({ ...GUARANTEE_GIG, deal_type: 'door_deal', guarantee_variant: null })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(await readHelp(user, 'Deal type'))
      .toMatch(/percentage of ticket revenue after the break-even point/i)
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
    getGig.mockResolvedValue({ ...GUARANTEE_GIG, deal_type: 'flat_fee', guarantee_variant: null })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(screen.getByText(/a flat fee takes no share of ticket revenue/i)).toBeInTheDocument()
    expect(screen.queryByText('Tickets to break even')).not.toBeInTheDocument()
  })
})

describe('taxes', () => {
  // The nett ticket price of € 20.00 carries the venue's 9% VAT, so every
  // simulation runs on the € 18,35 that is actually shared.
  const VAT_GIG = { ...GUARANTEE_GIG, subject_to_vat: true, ticket_vat_percentage: '9.00' }

  it('runs the simulation on the ticket price with its VAT taken out', async () => {
    getGig.mockResolvedValue(VAT_GIG)
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    // The corrected per-ticket price is folded into the "Tickets sold" tile's
    // caption, next to what has actually been earned so far.
    expect(within(soldTicketsCard()).getByText(/€\s18,35\s\/\s€\s281,28/)).toBeInTheDocument()
    expect(soldTicketsCard()).toHaveAccessibleDescription(/VAT of 9% comes off the ticket price first\./i)
    // Each ticket brings in less, so break-even takes 99 of them instead of 90.
    expect(upsideValue('Tickets to break even')).toBe('99')
    expect(upsideValue('Expected upside')).toBe('€ 1.308,80')
    expect(upsideValue('Potential upside')).toBe('€ 2.593,21')
  })

  it('says nothing about VAT on a deal that agreed no ticket rate', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(soldTicketsCard()).not.toHaveAccessibleDescription(/vat/i)
    expect(upsideValue('Tickets to break even')).toBe('90')
  })

  it('saves the ticket rate and reworks the door as it is typed', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.type(screen.getByLabelText('Ticket VAT %'), '9')

    await waitFor(() => expect(upsideValue('Potential upside')).toBe('€ 2.593,21'))
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { ticket_vat_percentage: 9 }),
      { timeout: 3000 },
    )
  })

  it('saves Copyright / PRS and applies it after ticket VAT', async () => {
    getGig.mockResolvedValue(VAT_GIG)
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.type(screen.getByLabelText('Copyright / PRS %'), '10')

    await waitFor(() => expect(soldTicketsCard()).toHaveAccessibleDescription(/copyright \/ prs of 10% comes off after vat\./i))
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { copyright_percentage: 10 }),
      { timeout: 3000 },
    )
  })

  it('drops both rates when the deal is not subject to VAT', async () => {
    getGig.mockResolvedValue(VAT_GIG)
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    await user.click(screen.getByLabelText('Subject to VAT'))

    // Greyed out, not hidden — the rates stay visible in the table.
    expect(screen.getByLabelText('Ticket VAT %')).toBeDisabled()
    // Nothing comes out of the door any more, so the shares go back up.
    expect(upsideValue('Potential upside')).toBe('€ 2.940,00')
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { subject_to_vat: false }),
      { timeout: 3000 },
    )
  })
})

describe('cost lines', () => {
  it('lists the gig\'s costs in a table with column captions and a total', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    expect(screen.getByDisplayValue('Travel')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Catering')).toBeInTheDocument()
    // The captions carry the field names, so the cells themselves are labelled
    // for assistive technology only.
    const table = screen.getByTestId('gig-costs-table')
    expect(within(table).getByText('Cost')).toBeInTheDocument()
    expect(within(table).getByText('Amount')).toBeInTheDocument()
    expect(screen.getByTestId('gig-costs-total')).toHaveTextContent('€ 150,00')
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

    await waitFor(() => expect(addGigCost).toHaveBeenCalledWith(
      1, { label: 'Backline', amount_cents: 7500, paid_by: 'artist' }
    ))
    await openFinance(user)
    await waitFor(() => expect(statementValue('Costs')).toBe('€ 225,00'))
    // Unaffected — the new cost defaults to paid_by artist.
    expect(statementValue('Nett. fee')).toBe('€ 1.420,00')
  })

  it('adds a cost from the draft line with the Enter key', async () => {
    addGigCost.mockResolvedValue({ id: 43, label: 'Backline', amount_cents: 7500, position: 2 })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    const labelInputs = screen.getAllByLabelText(/^cost$/i)
    const amountInputs = screen.getAllByLabelText(/^amount$/i)
    await user.type(labelInputs[labelInputs.length - 1], 'Backline')
    await user.type(amountInputs[amountInputs.length - 1], '75{Enter}')

    await waitFor(() => expect(addGigCost).toHaveBeenCalledWith(
      1, { label: 'Backline', amount_cents: 7500, paid_by: 'artist' }
    ))
    // The draft line is empty again, ready for the next cost.
    const drafts = screen.getAllByLabelText(/^cost$/i)
    expect(drafts[drafts.length - 1]).toHaveValue('')
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
      () => expect(updateGigCost).toHaveBeenCalledWith(
        1, 41, { label: 'Travel (van)', amount_cents: 12500, paid_by: 'artist' }
      )
    )
  })

  it('changes who a cost is paid by, saving immediately', async () => {
    updateGigCost.mockResolvedValue({ id: 41, label: 'Travel', amount_cents: 12500, paid_by: 'artist_agency', position: 0 })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    const paidBySelects = screen.getAllByLabelText(/^paid by$/i)
    // The first row is Travel; the last is the draft line.
    await user.click(paidBySelects[0])
    await user.click(await screen.findByRole('option', { name: 'Artist/Agency' }))

    await waitFor(
      () => expect(updateGigCost).toHaveBeenCalledWith(
        1, 41, { label: 'Travel', amount_cents: 12500, paid_by: 'artist_agency' }
      )
    )
  })

  it('adds a cost with the chosen paid_by', async () => {
    addGigCost.mockResolvedValue({ id: 43, label: 'Backline', amount_cents: 7500, paid_by: 'agency', position: 2 })
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await openTerms(user)

    const labelInputs = screen.getAllByLabelText(/^cost$/i)
    const amountInputs = screen.getAllByLabelText(/^amount$/i)
    await user.type(labelInputs[labelInputs.length - 1], 'Backline')
    await user.type(amountInputs[amountInputs.length - 1], '75')

    const paidBySelects = screen.getAllByLabelText(/^paid by$/i)
    await user.click(paidBySelects[paidBySelects.length - 1])
    await user.click(await screen.findByRole('option', { name: 'Agency' }))

    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(addGigCost).toHaveBeenCalledWith(
      1, { label: 'Backline', amount_cents: 7500, paid_by: 'agency' }
    ))
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
    await openFinance(user)
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
    await openFinance(user)
    await waitFor(() => expect(statementValue('Costs')).toBe('€ 25,00'))
  })
})
