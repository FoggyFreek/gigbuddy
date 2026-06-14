import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GigContactsSection from '../components/GigContactsSection.tsx'
import theme from '../theme.ts'

vi.mock('../api/gigs.ts', () => ({
  listGigContacts: vi.fn().mockResolvedValue([]),
  addGigContact: vi.fn(),
  setGigContactPrimary: vi.fn().mockResolvedValue({}),
  removeGigContact: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../api/venues.ts', () => ({
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/contacts.ts', () => ({
  searchContacts: vi.fn().mockResolvedValue([]),
}))

import { listGigContacts, addGigContact, setGigContactPrimary, removeGigContact } from '../api/gigs.ts'
import { listVenueContacts } from '../api/venues.ts'
import { searchContacts } from '../api/contacts.ts'

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listGigContacts.mockResolvedValue([])
  listVenueContacts.mockResolvedValue([])
})

describe('GigContactsSection — inherited contacts', () => {
  it('renders venue and festival contacts with the right source chip', async () => {
    listVenueContacts.mockImplementation((id) =>
      Promise.resolve(
        id === 11
          ? [{ id: 1, name: 'Vicky Venue', email: 'v@hall.com', phone: '111', category: 'booker', is_primary: false }]
          : [{ id: 2, name: 'Fred Fest', email: 'f@fest.com', phone: '222', category: 'promotion', is_primary: false }],
      ),
    )

    wrap(<GigContactsSection gigId={1} venueId={11} festivalId={22} flush={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Vicky Venue')).toBeInTheDocument())
    expect(screen.getByText('Fred Fest')).toBeInTheDocument()
    expect(screen.getByText('Venue')).toBeInTheDocument()
    expect(screen.getByText('Festival')).toBeInTheDocument()
    // Read-only: no remove button for inherited rows
    expect(screen.queryByLabelText('remove contact')).not.toBeInTheDocument()
  })

  it('copies email to the clipboard', async () => {
    const user = userEvent.setup()
    // userEvent.setup() installs its own navigator.clipboard; spy on it.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    listVenueContacts.mockImplementation((id) =>
      Promise.resolve(
        id === 11
          ? [{ id: 1, name: 'Vicky Venue', email: 'v@hall.com', phone: '111', category: 'booker', is_primary: false }]
          : [],
      ),
    )

    wrap(<GigContactsSection gigId={1} venueId={11} festivalId={null} flush={vi.fn()} />)

    await waitFor(() => screen.getByLabelText('copy email'))
    await user.click(screen.getByLabelText('copy email'))
    expect(writeText).toHaveBeenCalledWith('v@hall.com')
  })

  it('does not refetch inherited contacts when ids are unchanged', async () => {
    const flush = vi.fn()
    const { rerender } = wrap(<GigContactsSection gigId={1} venueId={11} festivalId={22} flush={flush} />)

    await waitFor(() => expect(listVenueContacts).toHaveBeenCalledTimes(2))

    rerender(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <GigContactsSection gigId={1} venueId={11} festivalId={22} flush={flush} />
        </ThemeProvider>
      </MemoryRouter>,
    )

    expect(listVenueContacts).toHaveBeenCalledTimes(2)
  })
})

describe('GigContactsSection — gig contacts', () => {
  it('adds a contact via the picker', async () => {
    const user = userEvent.setup()
    searchContacts.mockResolvedValue([{ id: 9, name: 'New Guy', email: 'n@x.com', category: 'booker' }])
    addGigContact.mockResolvedValue({ id: 9, name: 'New Guy', email: 'n@x.com', phone: '', category: 'booker', is_primary: false })

    wrap(<GigContactsSection gigId={1} venueId={null} festivalId={null} flush={vi.fn()} />)

    await user.type(screen.getByLabelText('Add contact'), 'New')
    await waitFor(() => screen.getByText('New Guy'))
    await user.click(screen.getByText('New Guy'))

    await waitFor(() => expect(addGigContact).toHaveBeenCalledWith(1, 9))
  })

  it('sets primary and removes a gig contact', async () => {
    const user = userEvent.setup()
    const contact = { id: 5, name: 'Gary Gig', email: 'g@gig.com', phone: '333', category: 'booker', is_primary: false }
    listGigContacts.mockResolvedValue([contact])
    setGigContactPrimary.mockResolvedValue({})
    removeGigContact.mockResolvedValue(undefined)

    wrap(<GigContactsSection gigId={1} venueId={null} festivalId={null} flush={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/Gary Gig/)).toBeInTheDocument())

    await user.click(screen.getByLabelText('set primary'))
    expect(setGigContactPrimary).toHaveBeenCalledWith(1, 5, true)

    await user.click(screen.getByLabelText('remove contact'))
    expect(removeGigContact).toHaveBeenCalledWith(1, 5)
  })
})
