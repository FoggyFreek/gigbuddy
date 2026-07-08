import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'
import { ThemeModeContext } from '../contexts/themeModeContext.ts'

vi.mock('../api/notifications.ts', () => ({
  getNotificationPrefs: vi.fn(),
  updateNotificationPrefs: vi.fn(),
}))
const subscribe = vi.fn().mockResolvedValue(undefined)
const unsubscribe = vi.fn().mockResolvedValue(undefined)
let pushStatus = 'unsubscribed'
vi.mock('../hooks/usePushNotifications.ts', () => ({
  usePushNotifications: () => ({ status: pushStatus, subscribe, unsubscribe }),
}))

import NotificationSettingsSection from '../components/account/NotificationSettingsSection.tsx'
import ThemeSettingsSection from '../components/account/ThemeSettingsSection.tsx'
import { getNotificationPrefs, updateNotificationPrefs } from '../api/notifications.ts'

const PREFS = {
  types: [
    { type: 'gig-new', enabled: true },
    { type: 'gig-confirmed', enabled: true },
    { type: 'gig-import', enabled: true },
    { type: 'rehearsal-new', enabled: false },
    { type: 'rehearsal-confirmed', enabled: true },
    { type: 'invoice-paid', enabled: true },
    { type: 'task-assigned', enabled: true },
    { type: 'invite-redeemed', enabled: true },
  ],
  tenants: [
    { tenantId: 1, tenantName: 'Alpha Band', avatarPath: null, enabled: true },
    { tenantId: 2, tenantName: 'Beta Band', avatarPath: 'tenants/2/avatar/profile.png', enabled: false },
  ],
}

function wrapNotifications() {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationSettingsSection />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  pushStatus = 'unsubscribed'
  getNotificationPrefs.mockResolvedValue(PREFS)
  updateNotificationPrefs.mockResolvedValue(PREFS)
})

describe('My preferences — notifications', () => {
  it('renders the browser push toggle and subscribes on enable', async () => {
    const user = userEvent.setup()
    wrapNotifications()
    const toggle = await screen.findByRole('switch', { name: 'Browser push notifications' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes when push is already on', async () => {
    pushStatus = 'subscribed'
    const user = userEvent.setup()
    wrapNotifications()
    const toggle = await screen.findByRole('switch', { name: 'Browser push notifications' })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('disables the push toggle when the browser blocked notifications', async () => {
    pushStatus = 'denied'
    wrapNotifications()
    const toggle = await screen.findByRole('switch', { name: 'Browser push notifications' })
    expect(toggle).toBeDisabled()
    expect(screen.getByText('Notifications blocked in browser')).toBeInTheDocument()
  })

  it('renders the per-type switches from prefs and saves a toggle', async () => {
    const user = userEvent.setup()
    wrapNotifications()

    const gigNew = await screen.findByRole('switch', { name: 'New gig options' })
    expect(gigNew).toBeChecked()
    expect(screen.getByRole('switch', { name: 'New rehearsal options' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'New members awaiting approval' })).toBeChecked()

    await user.click(gigNew)
    await waitFor(() =>
      expect(updateNotificationPrefs).toHaveBeenCalledWith({
        types: [{ type: 'gig-new', enabled: false }],
      }),
    )
  })

  it('renders the per-band switches and saves a toggle', async () => {
    const user = userEvent.setup()
    wrapNotifications()

    const beta = await screen.findByRole('switch', { name: 'Beta Band' })
    expect(beta).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Alpha Band' })).toBeChecked()

    await user.click(beta)
    await waitFor(() =>
      expect(updateNotificationPrefs).toHaveBeenCalledWith({
        tenants: [{ tenantId: 2, enabled: true }],
      }),
    )
  })

  it('shows the circular band profile picture and the fallback for bands without one', async () => {
    const { container } = wrapNotifications()
    await screen.findByRole('switch', { name: 'Beta Band' })
    const srcs = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))
    expect(srcs).toContain('/api/notifications/tenant-avatar/2')
    expect(srcs).toContain('/share/logo.png')
    const profilePicture = [...container.querySelectorAll('img')]
      .find((img) => img.getAttribute('src') === '/api/notifications/tenant-avatar/2')
    const avatar = profilePicture.closest('.MuiAvatar-root')
    const style = getComputedStyle(avatar)
    expect(style.width).toBe('32px')
    expect(style.height).toBe('32px')
    expect(avatar).toHaveClass('MuiAvatar-circular')
  })
})

describe('My preferences — theme', () => {
  it('changes the device theme variant', async () => {
    const setVariant = vi.fn()
    const user = userEvent.setup()
    render(
      <ThemeModeContext.Provider value={{ mode: 'light', toggleTheme: vi.fn(), variant: 'default', setVariant }}>
        <ThemeProvider theme={theme}>
          <ThemeSettingsSection />
        </ThemeProvider>
      </ThemeModeContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: /warm/i }))
    expect(setVariant).toHaveBeenCalledWith('warm')
  })
})
