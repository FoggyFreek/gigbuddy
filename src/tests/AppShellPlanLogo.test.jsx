import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'
import AppShell from '../components/AppShell.tsx'

vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))
vi.mock('../contexts/profileContext.ts', () => ({
  useProfile: () => ({ bandName: 'Band A' }),
}))
vi.mock('../contexts/themeModeContext.ts', () => ({
  useThemeMode: () => ({ mode: 'light', toggleTheme: vi.fn() }),
}))
vi.mock('../hooks/usePushNotifications.ts', () => ({
  usePushNotifications: () => ({
    status: 'unsupported',
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}))

import { useAuth } from '../contexts/authContext.ts'

const FLAGS = { finance: true, integrations: true, customization: true, song_files: true, chordpro: true, public_promotion: true }
const LIMITS = { storage_mb: null, members: null, bands: null }

function makeUser(entitlements) {
  return {
    id: 1,
    name: 'Alice',
    email: 'alice@example.com',
    pictureUrl: null,
    isSuperAdmin: false,
    activeTenantId: 1,
    activeTenantRole: 'member',
    memberships: [{ tenantId: 1, tenantSlug: 'a', tenantName: 'Band A', role: 'member', status: 'approved' }],
    entitlements,
  }
}

function wrap(user) {
  useAuth.mockReturnValue({ user, logout: vi.fn(), switchTenant: vi.fn() })
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter><AppShell /></MemoryRouter>
    </ThemeProvider>,
  )
}

describe('AppShell header plan logo', () => {
  it('shows the tier logo for an active gold subscription', () => {
    wrap(makeUser({ planSlug: 'gold', subscriptionStatus: 'active', locked: false, financeReadOnly: false, flags: FLAGS, limits: LIMITS }))
    expect(screen.getByAltText('gigBuddy')).toHaveAttribute('src', '/icons/gb_gold.png')
  })

  it('falls back to the default logo when fallback-locked (no active subscription)', () => {
    wrap(makeUser({ planSlug: 'bronze', subscriptionStatus: null, locked: true, financeReadOnly: false, flags: FLAGS, limits: LIMITS }))
    expect(screen.getByAltText('gigBuddy')).toHaveAttribute('src', '/icons/gigbuddy_logo_pick.png')
  })

  it('falls back to the default logo for an unenforced (ownerless) tenant', () => {
    wrap(makeUser(null))
    expect(screen.getByAltText('gigBuddy')).toHaveAttribute('src', '/icons/gigbuddy_logo_pick.png')
  })

  it('falls back to the default logo for a plan without a tier logo', () => {
    wrap(makeUser({ planSlug: 'pro', subscriptionStatus: 'active', locked: false, financeReadOnly: false, flags: FLAGS, limits: LIMITS }))
    expect(screen.getByAltText('gigBuddy')).toHaveAttribute('src', '/icons/gigbuddy_logo_pick.png')
  })
})
