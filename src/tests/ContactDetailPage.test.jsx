import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock every contacts API export the page imports so the module loads, plus the
// three reverse venue-link fns under test.
vi.mock('../api/contacts.ts', () => ({
  getContact: vi.fn(),
  updateContact: vi.fn().mockResolvedValue({}),
  deleteContact: vi.fn().mockResolvedValue({}),
  addContactNote: vi.fn(),
  deleteContactNote: vi.fn().mockResolvedValue({}),
  listContactVenues: vi.fn(),
  addContactVenue: vi.fn(),
  removeContactVenue: vi.fn().mockResolvedValue({}),
}))

// VenuePicker searches venues; nothing else from that module is exercised here.
vi.mock('../api/venues.ts', () => ({
  searchVenues: vi.fn().mockResolvedValue([]),
}))

import ContactDetailPage from '../pages/ContactDetailPage.tsx'
import {
  getContact,
  listContactVenues,
  addContactVenue,
  removeContactVenue,
} from '../api/contacts.ts'
import { searchVenues } from '../api/venues.ts'
import theme from '../theme.ts'

const CONTACT = { id: 5, name: 'Carol', email: '', phone: '', category: 'press', notes: [] }

function VenueStub() {
  const { id } = useParams()
  return <div>Venue page {id}</div>
}

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/contacts/5']}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
          <Route path="/venues/:id" element={<VenueStub />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  getContact.mockReset().mockResolvedValue(CONTACT)
  listContactVenues.mockReset().mockResolvedValue([])
  addContactVenue.mockReset()
  removeContactVenue.mockClear()
  searchVenues.mockReset().mockResolvedValue([])
})

describe('ContactDetailPage — Venues & festivals section', () => {
  it('renders linked venues/festivals with a category chip and stars only the primary', async () => {
    listContactVenues.mockResolvedValue([
      { id: 10, name: 'Big Hall', category: 'venue', city: 'Amsterdam', is_primary: true },
      { id: 11, name: 'Summer Fest', category: 'festival', city: 'Utrecht', is_primary: false },
    ])
    wrap()

    await waitFor(() => expect(screen.getByText('Big Hall')).toBeInTheDocument())
    expect(screen.getByText('Summer Fest')).toBeInTheDocument()
    // Category chips, one per row
    expect(screen.getByText('venue')).toBeInTheDocument()
    expect(screen.getByText('festival')).toBeInTheDocument()
    // Exactly one primary star (Big Hall), none on the festival row
    expect(screen.getAllByTitle('primary contact for this venue')).toHaveLength(1)
  })

  it('adds a venue picked from the search and appends it to the list', async () => {
    searchVenues.mockResolvedValue([{ id: 20, name: 'New Venue', category: 'venue', city: 'Delft' }])
    addContactVenue.mockResolvedValue({
      id: 20, name: 'New Venue', category: 'venue', city: 'Delft', is_primary: false,
    })
    const user = userEvent.setup()
    wrap()

    await waitFor(() => expect(screen.getByLabelText('Add venue / festival')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Add venue / festival'), 'New')

    const option = await screen.findByText('New Venue')
    await user.click(option)

    await waitFor(() => expect(addContactVenue).toHaveBeenCalledWith(5, 20))
    await waitFor(() => expect(screen.getByText('New Venue')).toBeInTheDocument())
  })

  it('removes a linked venue', async () => {
    listContactVenues.mockResolvedValue([
      { id: 10, name: 'Big Hall', category: 'venue', city: 'Amsterdam', is_primary: false },
    ])
    const user = userEvent.setup()
    wrap()

    await waitFor(() => expect(screen.getByText('Big Hall')).toBeInTheDocument())
    await user.click(screen.getByLabelText('remove venue'))

    expect(removeContactVenue).toHaveBeenCalledWith(5, 10)
    await waitFor(() => expect(screen.queryByText('Big Hall')).not.toBeInTheDocument())
  })

  it('navigates to the venue detail page via the open button', async () => {
    listContactVenues.mockResolvedValue([
      { id: 10, name: 'Big Hall', category: 'venue', city: 'Amsterdam', is_primary: false },
    ])
    const user = userEvent.setup()
    wrap()

    await waitFor(() => expect(screen.getByText('Big Hall')).toBeInTheDocument())
    await user.click(screen.getByLabelText('open venue'))

    await waitFor(() => expect(screen.getByText('Venue page 10')).toBeInTheDocument())
  })
})
