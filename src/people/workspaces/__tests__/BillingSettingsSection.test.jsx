import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../commerce/billing/billing.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getBillingState: vi.fn(),
    subscribe: vi.fn(),
    changePlan: vi.fn(),
    downgrade: vi.fn(),
    cancelSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
    syncSubscription: vi.fn(),
  }
})

import * as api from '../../../commerce/billing/billing.ts'
import BillingSettingsSection from '../../../finance/accounts/components/BillingSettingsSection.tsx'
import { AuthContext } from '../../../contexts/authContext.ts'
import theme from '../../../theme.ts'

// Both ladders, each with its own free floor. sort_order restarts per audience.
const PLANS = [
  {
    id: 1, slug: 'bronze', name: 'Bronze', audience: 'band',
    monthly_price_cents: 0, yearly_price_cents: 0,
    entitlements: { features: {}, limits: { storage_mb: 50, members: 5, bands: 1 } },
    is_active: true, is_fallback: true, sort_order: 1,
  },
  {
    id: 2, slug: 'silver', name: 'Silver', audience: 'band',
    monthly_price_cents: 999, yearly_price_cents: 9999,
    entitlements: { features: { integrations: true }, limits: { storage_mb: 150, members: 10, bands: 3 } },
    is_active: true, is_fallback: false, sort_order: 2,
  },
  {
    id: 3, slug: 'artist_bronze', name: 'Artist Bronze', audience: 'artist',
    monthly_price_cents: 0, yearly_price_cents: 0,
    entitlements: { features: {}, limits: { storage_mb: 50, members: 1, bands: 0 } },
    is_active: true, is_fallback: true, sort_order: 1,
  },
  {
    id: 4, slug: 'artist_gold', name: 'Artist Gold', audience: 'artist',
    monthly_price_cents: 1499, yearly_price_cents: 14999,
    entitlements: { features: { chordpro: true }, limits: { storage_mb: 250, members: 1, bands: 0 } },
    is_active: true, is_fallback: false, sort_order: 2,
  },
]

function subscription(overrides = {}) {
  return {
    id: 1, planId: 2, planSlug: 'silver', audience: 'band', status: 'active',
    billingInterval: 'month', priceCents: 999, cancelAtPeriodEnd: false,
    currentPeriodEnd: '2026-08-01T00:00:00Z', trialEndsAt: null, isComplimentary: false,
    complimentaryExpiresAt: null, pendingChange: null, downgradeScheduled: false,
    pendingLimitsSnapshot: null, scheduleStale: false, repairNeeded: false,
    ...overrides,
  }
}

function state({ band = null, artist = null, ownedBandCount = 1, hasPersonalWorkspace = true } = {}) {
  return {
    subscriptions: { band, artist },
    ownedBandCount,
    hasPersonalWorkspace,
    plans: PLANS,
  }
}

function wrap(ui, user, { initialEntry = '/settings/billing' } = {}) {
  const auth = {
    user,
    setUser: () => {},
    logout: async () => {},
    switchTenant: async () => undefined,
    refreshUser: vi.fn().mockResolvedValue(user),
  }
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const participantUser = {
  id: 7, email: 'p@test.local', name: 'Participant',
  memberships: [{ tenantId: 1, tenantName: 'Alpha', status: 'approved', role: 'contributor' }],
}

const ladder = (audience) => screen.getByTestId(`plan-ladder-${audience}`)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BillingSettingsSection — two ladders', () => {
  it('renders a section per product, each with only its own plans', async () => {
    api.getBillingState.mockResolvedValue(state())
    wrap(<BillingSettingsSection />, participantUser)

    await screen.findByText('Your band plan')
    expect(screen.getByText('Your artist plan')).toBeInTheDocument()

    // Neither ladder renders the other's plans.
    const band = within(ladder('band'))
    expect(band.getByText('Silver')).toBeInTheDocument()
    expect(band.queryByText('Artist Gold')).toBeNull()

    const artist = within(ladder('artist'))
    expect(artist.getByText('Artist Gold')).toBeInTheDocument()
    expect(artist.queryByText('Silver')).toBeNull()
  })

  // A band subscription must not rank the artist ladder. Under the old flat
  // sort_order comparison, artist_gold read as an "Upgrade" from gold — an
  // action the API then rejected.
  it('offers a fresh subscription on the other ladder, never an upgrade', async () => {
    api.getBillingState.mockResolvedValue(state({ band: subscription() }))
    wrap(<BillingSettingsSection />, participantUser)

    const artistGold = (await screen.findByText('Artist Gold')).closest('.MuiPaper-root')
    expect(within(artistGold).getByRole('button')).toHaveTextContent('Subscribe')
  })

  it('marks the current plan in each ladder independently', async () => {
    api.getBillingState.mockResolvedValue(state({
      band: subscription(),
      artist: subscription({ id: 2, planId: 4, planSlug: 'artist_gold', audience: 'artist', priceCents: 1499 }),
    }))
    wrap(<BillingSettingsSection />, participantUser)

    await screen.findByText('Your band plan')
    expect(within(ladder('band')).getByText('Current')).toBeInTheDocument()
    expect(within(ladder('artist')).getByText('Current')).toBeInTheDocument()
  })
})

describe('BillingSettingsSection — current plan tier logo', () => {
  it('shows the tier logo for the active subscription plan', async () => {
    api.getBillingState.mockResolvedValue(state({ band: subscription() }))
    const { container } = wrap(<BillingSettingsSection />, participantUser)
    await screen.findAllByText('Silver')
    expect(container.querySelector('img[src="/icons/gb_silver.png"]')).toBeTruthy()
  })

  it('shows no tier logo without a subscription', async () => {
    api.getBillingState.mockResolvedValue(state())
    wrap(<BillingSettingsSection />, participantUser)
    // Scope to a current-subscription card only; the plan cards below legitimately
    // render their own tier logos, so a container-wide query would false-positive.
    const cards = await screen.findAllByText(/You are on the free plan/)
    for (const card of cards) {
      expect(card.closest('.MuiPaper-root')?.querySelector('img[src^="/icons/gb_"]')).toBeNull()
    }
  })
})

describe('BillingSettingsSection — checkout return', () => {
  it('syncs only the ladder named by the checkout redirect', async () => {
    api.getBillingState.mockResolvedValue(state())
    api.syncSubscription.mockResolvedValue({ subscriptions: { band: null, artist: null } })
    wrap(<BillingSettingsSection />, participantUser, {
      initialEntry: '/settings/billing?checkout=return&audience=artist',
    })
    await waitFor(() => expect(api.syncSubscription).toHaveBeenCalledWith('artist'))
  })

  it('syncs both ladders when the redirect names none', async () => {
    api.getBillingState.mockResolvedValue(state())
    api.syncSubscription.mockResolvedValue({ subscriptions: { band: null, artist: null } })
    wrap(<BillingSettingsSection />, participantUser, {
      initialEntry: '/settings/billing?checkout=return',
    })
    await waitFor(() => expect(api.syncSubscription).toHaveBeenCalledWith(undefined))
  })

  it('does not sync on a normal visit', async () => {
    api.getBillingState.mockResolvedValue(state())
    wrap(<BillingSettingsSection />, participantUser)
    await screen.findAllByText(/You are on the free plan/)
    expect(api.syncSubscription).not.toHaveBeenCalled()
  })
})

describe('BillingSettingsSection — scheduled downgrade note', () => {
  it('shows the pending-downgrade limits note when a downgrade is confirmed', async () => {
    api.getBillingState.mockResolvedValue(state({
      band: subscription({
        cancelAtPeriodEnd: true, downgradeScheduled: true, pendingLimitsSnapshot: { storage_mb: 50 },
      }),
    }))
    wrap(<BillingSettingsSection />, participantUser)
    expect(await screen.findByText(/A downgrade is scheduled/)).toBeInTheDocument()
    expect(screen.getByText(/no longer add data beyond the new plan's limits/)).toBeInTheDocument()
  })
})

describe('BillingSettingsSection — empty states per ladder', () => {
  it('explains there is no subscription and no payment due when the user owns no band', async () => {
    api.getBillingState.mockResolvedValue(state({ ownedBandCount: 0 }))
    wrap(<BillingSettingsSection />, participantUser)

    expect(await screen.findByText('No subscription')).toBeInTheDocument()
    expect(screen.getByText(/nothing for you to pay/i)).toBeInTheDocument()
    expect(screen.getByText(/another member's plan/i)).toBeInTheDocument()
  })

  it('keeps the free-plan copy for a user who owns a band', async () => {
    api.getBillingState.mockResolvedValue(state({ ownedBandCount: 1 }))
    wrap(<BillingSettingsSection />, participantUser)

    await screen.findByText('Your band plan')
    expect(within(ladder('band')).getByText(/You are on the free plan/)).toBeInTheDocument()
    expect(screen.queryByText(/another member's plan/i)).not.toBeInTheDocument()
  })

  it('points a user without an artist workspace at creating one', async () => {
    api.getBillingState.mockResolvedValue(state({ hasPersonalWorkspace: false }))
    wrap(<BillingSettingsSection />, participantUser)

    expect(await screen.findByText(/do not have your own artist workspace yet/i)).toBeInTheDocument()
  })

  it('keeps the free-plan copy for a user with no approved memberships', async () => {
    api.getBillingState.mockResolvedValue(state({ ownedBandCount: 0 }))
    wrap(<BillingSettingsSection />, { id: 8, email: 'new@test.local', memberships: [] })

    await screen.findAllByText(/You are on the free plan/)
    expect(screen.queryByText(/another member's plan/i)).not.toBeInTheDocument()
  })
})
