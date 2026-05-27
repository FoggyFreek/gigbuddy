import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/contacts.js', () => ({
  listContacts: vi.fn(),
  getContact: vi.fn(),
  updateContact: vi.fn().mockResolvedValue({}),
  deleteContact: vi.fn().mockResolvedValue({}),
  createContact: vi.fn(),
  importContacts: vi.fn(),
  addContactNote: vi.fn(),
  deleteContactNote: vi.fn().mockResolvedValue({}),
}))

import ContactsPage from '../pages/ContactsPage.jsx'
import ContactDetailPage from '../pages/ContactDetailPage.jsx'
import { addContactNote, deleteContactNote, deleteContact, listContacts, getContact, updateContact } from '../api/contacts.js'
import theme from '../theme.js'

const NOTE = { id: 10, contact_id: 1, tenant_id: 1, note: 'Test note', created_at: '2026-01-01T12:00:00Z' }
const CONTACT = { id: 1, name: 'Alice', email: '', phone: '', category: 'press', notes: [] }

function wrapWithRoutes({ initialEntries }) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/contacts" element={<ContactsPage />}>
            <Route path=":id" element={<ContactDetailPage />} />
          </Route>
        </Routes>
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
    deleteContact.mockClear()
    addContactNote.mockClear()
    deleteContactNote.mockClear()
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
    await user.click(screen.getByRole('button', { name: /^add$/i }))

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
