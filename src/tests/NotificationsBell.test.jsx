import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'

vi.mock('../api/notifications.ts', () => ({
  listNotifications: vi.fn(),
  markRead: vi.fn().mockResolvedValue(null),
  markAllRead: vi.fn().mockResolvedValue(null),
  deleteNotification: vi.fn().mockResolvedValue(null),
}))
vi.mock('../contexts/authContext.ts', () => ({ useAuth: vi.fn() }))

import NotificationsBell from '../components/appShell/NotificationsBell.tsx'
import {
  listNotifications,
  markRead,
  markAllRead,
  deleteNotification,
} from '../api/notifications.ts'
import { useAuth } from '../contexts/authContext.ts'

const switchTenant = vi.fn().mockResolvedValue({})

const NOTIFICATIONS = [
  {
    id: 11,
    tenantId: 2,
    tenantName: 'Beta Band',
    tenantAvatarPath: 'tenants/2/avatar/profile.png',
    type: 'gig-confirmed',
    title: 'Gig confirmed!',
    body: 'Beta Hall · 2026-09-01',
    url: '/gigs',
    sourceType: 'gig',
    sourceId: 7,
    readAt: null,
    createdAt: '2026-07-02T10:00:00.000Z',
  },
  {
    id: 10,
    tenantId: 1,
    tenantName: 'Alpha Band',
    tenantAvatarPath: null,
    type: 'rehearsal-new',
    title: 'New rehearsal option',
    body: '2026-07-10',
    url: '/rehearsals',
    sourceType: 'rehearsal',
    sourceId: 3,
    readAt: null,
    createdAt: '2026-07-01T10:00:00.000Z',
  },
]

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/']}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

async function openBell(user) {
  await user.click(screen.getByLabelText('Notifications'))
}

beforeEach(() => {
  vi.clearAllMocks()
  switchTenant.mockResolvedValue({})
  useAuth.mockReturnValue({
    user: { id: 1, activeTenantId: 1, memberships: [] },
    switchTenant,
  })
  listNotifications.mockResolvedValue({
    notifications: NOTIFICATIONS,
    unreadCount: 2,
  })
  markRead.mockResolvedValue(null)
  markAllRead.mockResolvedValue(null)
  deleteNotification.mockResolvedValue(null)
})

describe('NotificationsBell', () => {
  it('shows the unread dot when there are unread notifications', async () => {
    const { container } = wrap(<NotificationsBell />)
    await waitFor(() => expect(listNotifications).toHaveBeenCalled())
    const badge = container.querySelector('.MuiBadge-badge')
    await waitFor(() => expect(badge).not.toHaveClass('MuiBadge-invisible'))
  })

  it('hides the dot when everything is read', async () => {
    listNotifications.mockResolvedValue({
      notifications: [{ ...NOTIFICATIONS[0], readAt: '2026-07-02T11:00:00.000Z' }],
      unreadCount: 0,
    })
    const { container } = wrap(<NotificationsBell />)
    await waitFor(() => expect(listNotifications).toHaveBeenCalled())
    const badge = container.querySelector('.MuiBadge-badge')
    await waitFor(() => expect(badge).toHaveClass('MuiBadge-invisible'))
  })

  it('lists notifications with the band profile picture (and fallback) when opened', async () => {
    const user = userEvent.setup()
    wrap(<NotificationsBell />)
    await openBell(user)

    expect(await screen.findByText('Gig confirmed!')).toBeInTheDocument()
    expect(screen.getByText('New rehearsal option')).toBeInTheDocument()

    const imgs = screen.getAllByRole('img')
    const srcs = imgs.map((img) => img.getAttribute('src'))
    expect(srcs).toContain('/api/notifications/tenant-avatar/2')
    expect(srcs).toContain('/share/logo.png')
  })

  it('shows an empty state when there are no notifications', async () => {
    listNotifications.mockResolvedValue({ notifications: [], unreadCount: 0 })
    const user = userEvent.setup()
    wrap(<NotificationsBell />)
    await openBell(user)
    expect(await screen.findByText('No notifications')).toBeInTheDocument()
  })

  it('marks all read', async () => {
    const user = userEvent.setup()
    const { container } = wrap(<NotificationsBell />)
    await openBell(user)
    await screen.findByText('Gig confirmed!')

    await user.click(screen.getByText('Mark all read'))
    expect(markAllRead).toHaveBeenCalledTimes(1)
    const badge = container.querySelector('.MuiBadge-badge')
    await waitFor(() => expect(badge).toHaveClass('MuiBadge-invisible'))
  })

  it('removes a single notification via its cross', async () => {
    const user = userEvent.setup()
    wrap(<NotificationsBell />)
    await openBell(user)
    await screen.findByText('Gig confirmed!')

    const item = screen.getByText('Gig confirmed!').closest('li')
    await user.click(within(item).getByLabelText('Remove notification'))

    expect(deleteNotification).toHaveBeenCalledWith(11)
    await waitFor(() => expect(screen.queryByText('Gig confirmed!')).not.toBeInTheDocument())
    expect(screen.getByText('New rehearsal option')).toBeInTheDocument()
  })

  it('navigates within the active tenant without switching', async () => {
    const user = userEvent.setup()
    wrap(<NotificationsBell />)
    await openBell(user)
    await user.click(await screen.findByText('New rehearsal option'))

    expect(markRead).toHaveBeenCalledWith(10)
    expect(switchTenant).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/rehearsals'))
  })

  it('switches tenant first when the notification belongs to another band', async () => {
    const user = userEvent.setup()
    wrap(<NotificationsBell />)
    await openBell(user)
    await user.click(await screen.findByText('Gig confirmed!'))

    expect(markRead).toHaveBeenCalledWith(11)
    expect(switchTenant).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/gigs'))
  })

  it('opens the notification settings page from the header icon', async () => {
    const user = userEvent.setup()
    wrap(<NotificationsBell />)
    await openBell(user)
    await user.click(await screen.findByLabelText('Notification settings'))
    await waitFor(() =>
      expect(screen.getByTestId('pathname')).toHaveTextContent('/account/notifications'),
    )
  })
})
