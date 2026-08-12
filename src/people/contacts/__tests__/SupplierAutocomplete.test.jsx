import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contacts.ts', () => ({
  searchContacts: vi.fn(async () => []),
  createContact: vi.fn(),
}))

import * as contactsApi from '../contacts.ts'
import SupplierAutocomplete from '../../../finance/purchases/components/SupplierAutocomplete.tsx'
import theme from '../../../theme.ts'

function Harness({ onPick, createDefaults }) {
  const [name, setName] = useState('')
  return (
    <SupplierAutocomplete
      value={name}
      onChange={(patch) => { setName(patch.supplier_name); onPick(patch) }}
      createDefaults={createDefaults}
    />
  )
}

function wrap(onPick, createDefaults) {
  return render(
    <ThemeProvider theme={theme}>
      <Harness onPick={onPick} createDefaults={createDefaults} />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  contactsApi.searchContacts.mockResolvedValue([])
})

describe('SupplierAutocomplete', () => {
  it('silently creates a supplier contact when none matches', async () => {
    const created = { id: 9, name: 'Studio X', category: 'supplier' }
    contactsApi.createContact.mockResolvedValue(created)
    const onPick = vi.fn()
    const user = userEvent.setup()
    wrap(onPick)

    await user.type(screen.getByPlaceholderText('Search or type contact name…'), 'Studio X')
    await screen.findByText("+ Add 'Studio X' as supplier")
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(contactsApi.createContact).toHaveBeenCalledWith({ name: 'Studio X', category: 'supplier' }))
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ supplier_name: 'Studio X', supplier_contact_id: 9 }))
  })

  it('feeds imported e-invoice seller data into a newly created supplier', async () => {
    const created = { id: 10, name: 'Studio X', category: 'supplier' }
    contactsApi.createContact.mockResolvedValue(created)
    const onPick = vi.fn()
    const user = userEvent.setup()
    wrap(onPick, {
      name: 'Original legal name',
      email: 'billing@studio.example',
      iban: 'NL55RABO0127957391',
      kvk_number: '50048295',
      tax_id: 'NL001794860B34',
    })

    await user.type(screen.getByRole('combobox', { name: 'Supplier' }), 'Studio X')
    await screen.findByText("+ Add 'Studio X' as supplier")
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(contactsApi.createContact).toHaveBeenCalledWith({
      name: 'Studio X',
      category: 'supplier',
      email: 'billing@studio.example',
      iban: 'NL55RABO0127957391',
      kvk_number: '50048295',
      tax_id: 'NL001794860B34',
    }))
  })

  it('falls back to an existing match when create fails', async () => {
    const match = { id: 42, name: 'Studio X', category: 'supplier' }
    contactsApi.searchContacts
      .mockResolvedValueOnce([]) // typing search
      .mockResolvedValueOnce([match]) // re-search after failed create
    contactsApi.createContact.mockRejectedValue(new Error('A contact with that name already exists'))
    const onPick = vi.fn()
    const user = userEvent.setup()
    wrap(onPick)

    await user.type(screen.getByPlaceholderText('Search or type contact name…'), 'Studio X')
    await screen.findByText("+ Add 'Studio X' as supplier")
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ supplier_name: 'Studio X', supplier_contact_id: 42 }))
  })

  it('selects an existing contact from search results', async () => {
    contactsApi.searchContacts.mockResolvedValue([{ id: 3, name: 'mi5 Studios', category: 'supplier', email: 'hi@mi5.nl' }])
    const onPick = vi.fn()
    const user = userEvent.setup()
    wrap(onPick)

    await user.type(screen.getByPlaceholderText('Search or type contact name…'), 'mi5')
    await screen.findByText('mi5 Studios')
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ supplier_name: 'mi5 Studios', supplier_contact_id: 3 }))
  })

})
