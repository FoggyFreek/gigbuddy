import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/venues.js', () => ({
  getVenue: vi.fn(),
  updateVenue: vi.fn().mockResolvedValue({}),
  deleteVenue: vi.fn().mockResolvedValue({}),
  getVenueCategoryImpact: vi.fn().mockResolvedValue({ affected_gigs: [] }),
  listVenueContacts: vi.fn(),
  addVenueContact: vi.fn(),
  setVenueContactPrimary: vi.fn().mockResolvedValue({}),
  removeVenueContact: vi.fn().mockResolvedValue({}),
}))

vi.mock('../api/contacts.js', () => ({
  searchContacts: vi.fn().mockResolvedValue([]),
  createContact: vi.fn(),
  getContact: vi.fn(),
  updateContact: vi.fn().mockResolvedValue({}),
}))

import VenueDetailPage from '../pages/VenueDetailPage.jsx'
import {
  getVenue,
  listVenueContacts,
  addVenueContact,
  setVenueContactPrimary,
  removeVenueContact,
} from '../api/venues.js'
import { searchContacts } from '../api/contacts.js'
import theme from '../theme.js'

const VENUE = { id: 1, category: 'venue', name: 'Test Venue' }

function ContactStub() {
  const { id } = useParams()
  return <div>Contact page {id}</div>
}

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/venues/1']}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/venues/:id" element={<VenueDetailPage />} />
          <Route path="/contacts/:id" element={<ContactStub />} />
        </Routes>
      </ThemeProvider>
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
