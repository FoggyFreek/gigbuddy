import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SubscriptionsPage from '../../../admin/subscriptions/SubscriptionsPage.tsx'
import { grantComplimentary, listSubscriptions, listAdminPlans } from '../../../admin/subscriptions/adminSubscriptions.ts'
import { listAllUsers } from '../../../admin/users/adminUsers.ts'
import theme from '../../../theme.ts'

vi.mock('../../../admin/subscriptions/adminSubscriptions.ts', () => ({
  listSubscriptions: vi.fn(),
  grantComplimentary: vi.fn(),
  revokeComplimentary: vi.fn(),
  listAdminPlans: vi.fn(),
  createAdminPlan: vi.fn(),
  updateAdminPlan: vi.fn(),
  deleteAdminPlan: vi.fn(),
}))
vi.mock('../../../admin/users/adminUsers.ts', () => ({ listAllUsers: vi.fn() }))

const users = [
  { id: 10, name: 'Owner Olly', email: 'olly@test.local' },
  { id: 11, name: 'Member Mia', email: 'mia@test.local' },
]

const plans = [
  { id: 1, slug: 'pro', name: 'Pro', monthly_price_cents: 500, yearly_price_cents: 5000, entitlements: { features: {}, limits: {} }, is_active: true, sort_order: 1 },
]

function wrap() {
  return render(<ThemeProvider theme={theme}><SubscriptionsPage /></ThemeProvider>)
}

describe('SubscriptionsPage complimentary grant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listSubscriptions.mockResolvedValue({ subscriptions: [] })
    listAdminPlans.mockResolvedValue(plans)
    listAllUsers.mockResolvedValue(users)
    grantComplimentary.mockResolvedValue({})
  })

  it('searches users by name and grants with the selected user id', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Grant complimentary access')

    const combo = screen.getByRole('combobox', { name: 'User' })
    await user.type(combo, 'Mia')
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).queryByText(/Owner Olly/)).not.toBeInTheDocument()
    await user.click(within(listbox).getByText(/Member Mia/))

    await user.click(screen.getByRole('combobox', { name: 'Plan' }))
    await user.click(await within(await screen.findByRole('listbox')).findByText('Pro'))

    await user.click(screen.getByRole('button', { name: 'Grant' }))
    await waitFor(() => expect(grantComplimentary).toHaveBeenCalledWith(11, 1, null))
  })

  it('passes an expiry date for a temporary grant', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Grant complimentary access')

    await user.type(screen.getByRole('combobox', { name: 'User' }), 'Mia')
    await user.click(within(await screen.findByRole('listbox')).getByText(/Member Mia/))
    await user.click(screen.getByRole('combobox', { name: 'Plan' }))
    await user.click(within(await screen.findByRole('listbox')).getByText('Pro'))
    fireEvent.change(screen.getByLabelText('Expires (optional)'), { target: { value: '2026-08-01' } })

    await user.click(screen.getByRole('button', { name: 'Grant' }))
    await waitFor(() => expect(grantComplimentary).toHaveBeenCalledWith(11, 1, '2026-08-01'))
  })

  it('shows the complimentary expiry in the Period end column', async () => {
    listSubscriptions.mockResolvedValue({
      subscriptions: [{
        id: 5, userId: 11, userName: 'Member Mia', userEmail: 'mia@test.local',
        modules: [{ audience: 'band', planSlug: 'pro', status: 'active', priceCents: 0 }],
        status: 'active', billingInterval: null,
        totalCents: 0, cancelAtPeriodEnd: false, currentPeriodEnd: null,
        trialEndsAt: null, isComplimentary: true,
        complimentaryExpiresAt: '2026-08-01T00:00:00.000Z',
        scheduleStale: false, repairNeeded: false,
        createdAt: '2026-07-01T00:00:00.000Z',
      }],
    })
    wrap()
    const expected = new Date('2026-08-01T00:00:00.000Z').toLocaleDateString()
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('matches on email too', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Grant complimentary access')

    await user.type(screen.getByRole('combobox', { name: 'User' }), 'olly@')
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText(/Owner Olly/)).toBeInTheDocument()
    expect(within(listbox).queryByText(/Member Mia/)).not.toBeInTheDocument()
  })

  it('warns instead of granting when no user is selected', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Grant complimentary access')

    await user.click(screen.getByRole('combobox', { name: 'Plan' }))
    await user.click(await within(await screen.findByRole('listbox')).findByText('Pro'))
    await user.click(screen.getByRole('button', { name: 'Grant' }))
    expect(grantComplimentary).not.toHaveBeenCalled()
  })

  it('does not show paid subscriptions in the complimentary grant register', async () => {
    listSubscriptions.mockResolvedValue({ subscriptions: [{
      id: 6, userId: 11, userName: 'Member Mia', userEmail: 'mia@test.local',
      modules: [{ audience: 'band', planSlug: 'pro', status: 'active', priceCents: 500 }],
      status: 'active', billingInterval: 'month', totalCents: 500,
      cancelAtPeriodEnd: false, currentPeriodEnd: null, trialEndsAt: null,
      isComplimentary: false, complimentaryExpiresAt: null,
      scheduleStale: false, repairNeeded: false, createdAt: '2026-07-01T00:00:00.000Z',
    }] })
    wrap()
    await screen.findByText('No complimentary grants.')
    expect(screen.queryByText('Member Mia')).not.toBeInTheDocument()
  })
})
