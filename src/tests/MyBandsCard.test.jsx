import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'
import MyBandsCard from '../components/hub/MyBandsCard.tsx'
import { listMyBands } from '../api/me.ts'
import { createContact } from '../api/contacts.ts'

vi.mock('../api/me.ts', () => ({ listMyBands: vi.fn() }))
vi.mock('../api/contacts.ts', () => ({ createContact: vi.fn() }))

const WORKSPACE_ID = 3

let switchTenant

function wrap(personalTenantId = WORKSPACE_ID) {
  switchTenant = vi.fn().mockResolvedValue({})
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider
        value={{
          user: { id: 1, name: 'Alpha User' },
          setUser: vi.fn(),
          logout: vi.fn(),
          switchTenant,
          refreshUser: vi.fn(),
        }}
      >
        <MyBandsCard personalTenantId={personalTenantId} />
      </AuthContext.Provider>
    </ThemeProvider>,
  )
}

const tenantBand = (over = {}) => ({
  source: 'tenant',
  tenantId: 2,
  contactId: null,
  displayName: 'Band A',
  slug: 'band-a',
  kind: 'band',
  role: 'contributor',
  logoPath: null,
  ...over,
})

const externalBand = (over = {}) => ({
  source: 'contact',
  tenantId: WORKSPACE_ID,
  contactId: 7,
  displayName: 'The Covers Band',
  slug: null,
  kind: null,
  role: null,
  logoPath: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  listMyBands.mockResolvedValue({ items: [] })
  createContact.mockResolvedValue({ id: 9 })
})

describe('MyBandsCard', () => {
  it('shows both sorts of band and labels which is which', async () => {
    listMyBands.mockResolvedValue({ items: [tenantBand(), externalBand()] })
    wrap()

    expect(await screen.findByText('Band A')).toBeInTheDocument()
    expect(screen.getByText('The Covers Band')).toBeInTheDocument()
    expect(screen.getByText('On gigbuddy')).toBeInTheDocument()
    expect(screen.getByText('Not on gigbuddy')).toBeInTheDocument()
  })

  // A real tenant can be opened; an external band has no data of its own, so
  // its row must not offer a way in.
  it('only makes the gigbuddy band clickable', async () => {
    listMyBands.mockResolvedValue({ items: [tenantBand(), externalBand()] })
    const user = userEvent.setup()
    wrap()

    const list = await screen.findByRole('list')
    const buttons = within(list).getAllByRole('button')
    expect(buttons).toHaveLength(1)

    await user.click(buttons[0])
    await waitFor(() => expect(switchTenant).toHaveBeenCalledWith(2))
  })

  it('adds an external band as an ensemble contact in the personal workspace', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Add a band' }))
    await user.type(screen.getByLabelText('Band name'), 'The Covers Band')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    // Contacts are tenant-scoped, so the workspace has to be active first.
    await waitFor(() => expect(switchTenant).toHaveBeenCalledWith(WORKSPACE_ID))
    await waitFor(() => expect(createContact).toHaveBeenCalledWith({
      name: 'The Covers Band', category: 'ensemble',
    }))
    expect(switchTenant.mock.invocationCallOrder[0])
      .toBeLessThan(createContact.mock.invocationCallOrder[0])
    // The list refreshes so the new band appears without a reload.
    await waitFor(() => expect(listMyBands).toHaveBeenCalledTimes(2))
  })

  // External bands live in the musician's own workspace, so without one there
  // is nowhere to put them.
  it('does not offer to add a band when the user has no workspace', async () => {
    wrap(null)
    await waitFor(() => expect(listMyBands).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Add a band' })).not.toBeInTheDocument()
  })

  it('reports a failed add without closing the dialog', async () => {
    createContact.mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Add a band' }))
    await user.type(screen.getByLabelText('Band name'), 'The Covers Band')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Could not add that band.')).toBeInTheDocument()
    expect(screen.getByLabelText('Band name')).toBeInTheDocument()
  })

  it('says so when the musician is in no band at all', async () => {
    wrap()
    expect(await screen.findByText("You're not in any band yet.")).toBeInTheDocument()
  })
})
