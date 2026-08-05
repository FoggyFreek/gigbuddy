import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'
import MyHubPage from '../pages/MyHubPage.tsx'
import { listMyAgenda, listMyBands, listMyPastAgenda, listMyEarnings } from '../api/me.ts'
import { createContact } from '../api/contacts.ts'

vi.mock('../api/contacts.ts', () => ({ createContact: vi.fn() }))
vi.mock('../api/me.ts', () => ({
  listMyBands: vi.fn(),
  listMyAgenda: vi.fn(),
  listMyPastAgenda: vi.fn(),
  listMyEarnings: vi.fn(),
}))

const USER = {
  id: 1,
  name: 'Alpha User',
  activeTenantId: 1,
  memberships: [{ tenantId: 7, kind: 'personal', status: 'approved' }],
}

let switchTenant

function wrap() {
  switchTenant = vi.fn().mockResolvedValue({})
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/me']}>
        <AuthContext.Provider
          value={{ user: USER, setUser: vi.fn(), logout: vi.fn(), switchTenant, refreshUser: vi.fn() }}
        >
          <Routes>
            <Route path="/me" element={<MyHubPage />} />
            <Route path="/gigs/:id" element={<div>gig detail</div>} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

const agendaItem = (over = {}) => ({
  type: 'gig',
  id: 10,
  date: '2099-07-10',
  title: 'A Show',
  status: 'confirmed',
  tenantId: 2,
  tenantName: 'Band A',
  kind: 'band',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  listMyAgenda.mockResolvedValue({ items: [], meta: { from: '', to: '', returned: 0 } })
  listMyPastAgenda.mockResolvedValue({ items: [], meta: { limit: 20, returned: 0, nextCursor: null } })
  listMyEarnings.mockResolvedValue({ items: [], meta: { from: '', to: '', returned: 0 } })
  listMyBands.mockResolvedValue({ items: [] })
  createContact.mockResolvedValue({ id: 12, name: 'Side Project', category: 'ensemble' })
})

describe('MyHubPage â€” external bands', () => {
  it('switches to the personal workspace before creating the ensemble contact', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Add a band' }))
    await user.type(screen.getByLabelText('Band name'), 'Side Project')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(switchTenant).toHaveBeenCalledWith(7))
    await waitFor(() => expect(createContact).toHaveBeenCalledWith({
      name: 'Side Project', category: 'ensemble',
    }))
    expect(switchTenant.mock.invocationCallOrder[0])
      .toBeLessThan(createContact.mock.invocationCallOrder[0])
  })
})

describe('MyHubPage — agenda', () => {
  it('shows each item with the band it belongs to', async () => {
    listMyAgenda.mockResolvedValue({
      items: [agendaItem(), agendaItem({ id: 11, type: 'rehearsal', title: 'B Practice', tenantName: 'Band B' })],
      meta: { from: '', to: '', returned: 2 },
    })
    wrap()

    expect(await screen.findByText('A Show')).toBeInTheDocument()
    expect(screen.getByText('Band A')).toBeInTheDocument()
    expect(screen.getByText('B Practice')).toBeInTheDocument()
    expect(screen.getByText('Band B')).toBeInTheDocument()
  })

  // Every row belongs to another tenant, so opening one must switch first —
  // otherwise the detail page would read the wrong tenant's data.
  it('switches to the item\'s tenant before navigating into it', async () => {
    listMyAgenda.mockResolvedValue({ items: [agendaItem()], meta: { from: '', to: '', returned: 1 } })
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByText('A Show'))
    await waitFor(() => expect(switchTenant).toHaveBeenCalledWith(2))
    expect(await screen.findByText('gig detail')).toBeInTheDocument()
  })

  it('stays put when the tenant switch fails', async () => {
    listMyAgenda.mockResolvedValue({ items: [agendaItem()], meta: { from: '', to: '', returned: 1 } })
    const user = userEvent.setup()
    wrap()
    // Same mock instance the context already holds — rejecting it now is what
    // the component will see on click.
    switchTenant.mockRejectedValue(new Error('denied'))

    await user.click(await screen.findByText('A Show'))
    await waitFor(() => expect(switchTenant).toHaveBeenCalled())
    expect(screen.queryByText('gig detail')).not.toBeInTheDocument()
  })

  it('requests a new window when the month changes', async () => {
    const user = userEvent.setup()
    wrap()
    await waitFor(() => expect(listMyAgenda).toHaveBeenCalledTimes(1))
    const first = listMyAgenda.mock.calls[0][0]

    await user.click(screen.getByLabelText('next month'))
    await waitFor(() => expect(listMyAgenda).toHaveBeenCalledTimes(2))
    const second = listMyAgenda.mock.calls[1][0]
    expect(second.from > first.from).toBe(true)
  })

  it('pages the past feed with the keyset cursor and stops when it runs out', async () => {
    listMyPastAgenda
      .mockResolvedValueOnce({
        items: [agendaItem({ id: 9, title: 'Older', date: '2098-01-01' })],
        meta: { limit: 20, returned: 1, nextCursor: { date: '2098-01-01', id: 9 } },
      })
      .mockResolvedValueOnce({
        items: [agendaItem({ id: 8, title: 'Oldest', date: '2097-01-01' })],
        meta: { limit: 20, returned: 1, nextCursor: null },
      })
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Show past' }))
    expect(await screen.findByText('Older')).toBeInTheDocument()
    // First page carries no cursor.
    expect(listMyPastAgenda.mock.calls[0][0].cursor).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(listMyPastAgenda.mock.calls[1][0].cursor)
      .toEqual({ date: '2098-01-01', id: 9 }))
    expect(await screen.findByText('Oldest')).toBeInTheDocument()
    // Appends rather than replacing.
    expect(screen.getByText('Older')).toBeInTheDocument()
    // A null cursor ends the feed.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument())
  })
})

describe('MyHubPage — earnings', () => {
  const row = (over = {}) => ({
    tenantId: 2, tenantName: 'Band A', kind: 'band',
    revenueCents: 70000, expenseCents: 10000, resultCents: 60000, ...over,
  })

  // Two sets of books stay two sets of books: the view shows a figure per band
  // and never a combined total.
  it('reports one row per band and never a combined total', async () => {
    listMyEarnings.mockResolvedValue({
      // Chosen so the would-be combined total (1.000,00) equals no single cell.
      items: [row(), row({ tenantId: 3, tenantName: 'Band B', revenueCents: 45000, expenseCents: 5000, resultCents: 40000 })],
      meta: { from: '', to: '', returned: 2 },
    })
    wrap()

    const table = await screen.findByRole('table')
    const bodyRows = within(table).getAllByRole('row').slice(1)
    expect(bodyRows).toHaveLength(2)
    expect(within(bodyRows[0]).getByText('Band A')).toBeInTheDocument()
    expect(within(bodyRows[1]).getByText('Band B')).toBeInTheDocument()
    // Nothing anywhere shows the sum of the two results.
    expect(within(table).queryByText(/1\.000,00/)).not.toBeInTheDocument()
  })

  it('says so when no band shares its finances', async () => {
    wrap()
    expect(await screen.findByText('No band shares its finances with you.')).toBeInTheDocument()
  })
})
