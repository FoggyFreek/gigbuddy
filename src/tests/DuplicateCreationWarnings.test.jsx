import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/contacts.ts', () => ({
  checkContactDuplicates: vi.fn().mockResolvedValue({ items: [], meta: { limit: 5, returned: 0 } }),
  createContact: vi.fn(),
  getContact: vi.fn(),
  updateContact: vi.fn(),
}))

vi.mock('../api/venues.ts', () => ({
  checkVenueDuplicates: vi.fn().mockResolvedValue({ items: [], meta: { limit: 5, returned: 0 } }),
  createVenue: vi.fn(),
  getVenue: vi.fn(),
  getVenueCategoryImpact: vi.fn(),
  updateVenue: vi.fn(),
}))

import ContactFormModal from '../components/ContactFormModal.tsx'
import VenueFormModal from '../components/VenueFormModal.tsx'
import { checkContactDuplicates } from '../api/contacts.ts'
import { checkVenueDuplicates } from '../api/venues.ts'
import { AuthContext } from '../contexts/authContext.ts'
import theme from '../theme.ts'

const AUTH_VALUE = { user: { isSuperAdmin: true } }

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={AUTH_VALUE}>{ui}</AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('creation duplicate warnings', () => {
  beforeEach(() => {
    checkContactDuplicates.mockReset().mockResolvedValue({ items: [], meta: { limit: 5, returned: 0 } })
    checkVenueDuplicates.mockReset().mockResolvedValue({ items: [], meta: { limit: 5, returned: 0 } })
  })

  it('warns about a contact match and links to the existing contact', async () => {
    checkContactDuplicates.mockResolvedValue({
      items: [{ id: 7, name: 'Alice Existing', category: 'booker', matched_fields: ['email'] }],
      meta: { limit: 5, returned: 1 },
    })
    const user = userEvent.setup()
    wrap(<ContactFormModal mode="create" onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')

    await waitFor(() => expect(checkContactDuplicates).toHaveBeenLastCalledWith(
      { name: '', email: 'alice@example.com', category: 'press', iban: '' },
      { signal: expect.any(AbortSignal) },
    ))
    const link = await screen.findByRole('link', { name: 'Alice Existing' })
    expect(link).toHaveAttribute('href', '/contacts/7')
    expect(screen.getByRole('alert')).toHaveTextContent(/entered information seems to match/i)
  })

  it('includes IBAN in supplier checks and links to the supplier directory', async () => {
    checkContactDuplicates.mockResolvedValue({
      items: [{ id: 8, name: 'Existing Supplier', category: 'supplier', matched_fields: ['iban'] }],
      meta: { limit: 5, returned: 1 },
    })
    const user = userEvent.setup()
    wrap(<ContactFormModal mode="create" initial={{ category: 'supplier' }} categories={['supplier']} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('IBAN'), 'NL91 ABNA 0417 1643 00')

    await waitFor(() => expect(checkContactDuplicates).toHaveBeenLastCalledWith(
      { name: '', email: '', category: 'supplier', iban: 'NL91 ABNA 0417 1643 00' },
      { signal: expect.any(AbortSignal) },
    ))
    expect(await screen.findByRole('link', { name: 'Existing Supplier' }))
      .toHaveAttribute('href', '/suppliers/8')
  })

  it('warns about a venue match and links to the existing venue', async () => {
    checkVenueDuplicates.mockResolvedValue({
      items: [{ id: 9, name: 'Existing Hall', matched_fields: ['organization_name'] }],
      meta: { limit: 5, returned: 1 },
    })
    const user = userEvent.setup()
    wrap(<VenueFormModal mode="create" onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('Organization name'), 'Existing Org')

    await waitFor(() => expect(checkVenueDuplicates).toHaveBeenLastCalledWith(
      expect.objectContaining({ organization_name: 'Existing Org' }),
      { signal: expect.any(AbortSignal) },
    ))
    expect(await screen.findByRole('link', { name: 'Existing Hall' }))
      .toHaveAttribute('href', '/venues/9')
  })
})
