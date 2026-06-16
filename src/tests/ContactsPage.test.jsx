import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/contacts.ts', () => ({
  listContacts: vi.fn(),
  getContact: vi.fn(),
  updateContact: vi.fn().mockResolvedValue({}),
  deleteContact: vi.fn().mockResolvedValue({}),
  createContact: vi.fn(),
  importContacts: vi.fn(),
  addContactNote: vi.fn(),
  deleteContactNote: vi.fn().mockResolvedValue({}),
  // ContactDetailPage's "Venues & festivals" section loads/edits these.
  listContactVenues: vi.fn().mockResolvedValue([]),
  addContactVenue: vi.fn(),
  removeContactVenue: vi.fn().mockResolvedValue({}),
}))

// The embedded VenuePicker searches venues; nothing else is exercised here.
vi.mock('../api/venues.ts', () => ({
  searchVenues: vi.fn().mockResolvedValue([]),
}))

import ContactsPage from '../pages/ContactsPage.tsx'
import SuppliersPage from '../pages/SuppliersPage.tsx'
import ContactDetailPage from '../pages/ContactDetailPage.tsx'
import { addContactNote, createContact, deleteContactNote, deleteContact, listContacts, getContact, updateContact } from '../api/contacts.ts'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'

// Render as a writer (super admin grants every planning.write capability) so the
// create/edit/delete affordances gated on canWritePlanning are present.
const writerAuth = { user: { isSuperAdmin: true } }

const NOTE = { id: 10, contact_id: 1, tenant_id: 1, note: 'Test note', created_at: '2026-01-01T12:00:00Z' }
const CONTACT = { id: 1, name: 'Alice', email: '', phone: '', category: 'press', notes: [] }
const SUPPLIER = { id: 2, name: 'Studio X', email: '', phone: '', category: 'supplier', notes: [] }

function wrapWithRoutes({ initialEntries }) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={writerAuth}>
          <Routes>
            <Route path="/contacts" element={<ContactsPage />}>
              <Route path=":id" element={<ContactDetailPage />} />
            </Route>
            <Route path="/suppliers" element={<SuppliersPage />}>
              <Route path=":id" element={<ContactDetailPage />} />
            </Route>
          </Routes>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

describe('ContactsPage — split-view list refresh', () => {
  beforeEach(() => {
    listContacts.mockReset()
    listContacts.mockResolvedValue([CONTACT])
    getContact.mockReset()
    getContact.mockResolvedValue(CONTACT)
    updateContact.mockClear()
    createContact.mockReset()
    deleteContact.mockClear()
    addContactNote.mockClear()
    deleteContactNote.mockClear()
  })

  it('loads the contacts page with suppliers excluded', async () => {
    wrapWithRoutes({ initialEntries: ['/contacts'] })

    await waitFor(() => expect(listContacts).toHaveBeenCalledWith({ excludeCategory: 'supplier' }))
    expect(await screen.findByText('Alice')).toBeInTheDocument()
  })

  it('loads suppliers through their own route and navigates inside /suppliers', async () => {
    listContacts.mockResolvedValue([SUPPLIER])
    getContact.mockResolvedValue(SUPPLIER)
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/suppliers'] })

    await waitFor(() => expect(listContacts).toHaveBeenCalledWith({ category: 'supplier' }))
    await user.click(await screen.findByText('Studio X'))

    await waitFor(() => expect(screen.getByDisplayValue('Studio X')).toBeInTheDocument())
    expect(getContact).toHaveBeenCalledWith(2)
  })

  it('creates suppliers with the supplier category by default', async () => {
    listContacts.mockResolvedValue([])
    createContact.mockResolvedValue(SUPPLIER)
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/suppliers'] })

    await screen.findByText(/no suppliers yet/i)
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/name/i), 'Studio X')
    await user.click(within(dialog).getByRole('button', { name: /^add supplier$/i }))

    await waitFor(() => {
      expect(createContact).toHaveBeenCalledWith({
        name: 'Studio X',
        email: null,
        phone: null,
        category: 'supplier',
      })
    })
  })

  it('updates the list row immediately after the detail email field is saved', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/contacts/1'] })

    // Wait for the detail form to load
    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeInTheDocument())

    // Type into the Email field in the detail pane
    await user.type(screen.getByLabelText('Email'), 'alice@test.com')

    // After the debounce fires and the save completes, the list (left pane)
    // should reflect the new email without a full reload
    await waitFor(
      () => expect(screen.getByText('alice@test.com')).toBeInTheDocument(),
      { timeout: 2000 }
    )
    expect(updateContact).toHaveBeenCalledWith(1, { email: 'alice@test.com' })
    // listContacts should NOT have been called again — no full reload
    expect(listContacts).toHaveBeenCalledTimes(1)
  })

  it('updates the list row when a non-required field is saved via flush on close', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/contacts/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeInTheDocument())

    // Type a phone number — it will be pending in the debounce buffer
    await user.type(screen.getByLabelText('Phone'), '0612345678')

    // Close the detail (flush is called before close)
    await user.click(screen.getByRole('button', { name: /close/i }))

    // The list should have the phone number applied
    await waitFor(
      () => expect(screen.getByText('0612345678')).toBeInTheDocument(),
      { timeout: 2000 }
    )
  })

  it('removes a contact from the list after deleting it in detail', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/contacts/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteContact).toHaveBeenCalledWith(1))
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    expect(screen.getByText(/no contacts yet/i)).toBeInTheDocument()
  })

  it('adds a note and shows it in the detail pane', async () => {
    addContactNote.mockResolvedValue(NOTE)
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/contacts/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText(/add a note/i), 'Test note')
    await user.click(screen.getByRole('button', { name: /^add note$/i }))

    await waitFor(() => expect(addContactNote).toHaveBeenCalledWith(1, 'Test note'))
    expect(screen.getByText('Test note')).toBeInTheDocument()
  })

  it('deletes a note and removes it from the detail pane', async () => {
    getContact.mockResolvedValue({ ...CONTACT, notes: [NOTE] })
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/contacts/1'] })

    await waitFor(() => expect(screen.getByText('Test note')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /delete note/i }))

    await waitFor(() => expect(deleteContactNote).toHaveBeenCalledWith(1, 10))
    expect(screen.queryByText('Test note')).not.toBeInTheDocument()
  })
})
