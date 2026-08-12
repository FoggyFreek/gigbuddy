import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/billing.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getBillingState: vi.fn() }
})

import * as api from '../api/billing.ts'
import SubscriptionSummaryCard from '../components/settings/SubscriptionSummaryCard.tsx'
import { AuthContext } from '../contexts/authContext.ts'
import theme from '../theme.ts'

const PLANS = [
  {
    id: 1, slug: 'bronze', name: 'Bronze', audience: 'band',
    monthly_price_cents: 0, yearly_price_cents: 0,
    entitlements: { features: {}, limits: {} },
    is_active: true, is_fallback: true, sort_order: 1,
  },
  {
    id: 2, slug: 'gold', name: 'Gold', audience: 'band',
    monthly_price_cents: 1999, yearly_price_cents: 19999,
    entitlements: { features: {}, limits: {} },
    is_active: true, is_fallback: false, sort_order: 3,
  },
  {
    id: 3, slug: 'artist_bronze', name: 'Artist Bronze', audience: 'artist',
    monthly_price_cents: 0, yearly_price_cents: 0,
    entitlements: { features: {}, limits: {} },
    is_active: true, is_fallback: true, sort_order: 1,
  },
  {
    id: 4, slug: 'artist_gold', name: 'Artist Gold', audience: 'artist',
    monthly_price_cents: 1499, yearly_price_cents: 14999,
    entitlements: { features: {}, limits: {} },
    is_active: true, is_fallback: false, sort_order: 2,
  },
]

function subscription(over) {
  return {
    id: 1, planId: 2, planSlug: 'gold', audience: 'band', status: 'active',
    billingInterval: 'month', priceCents: 1999, cancelAtPeriodEnd: false,
    currentPeriodEnd: null, trialEndsAt: null, isComplimentary: false,
    complimentaryExpiresAt: null, pendingChange: null, downgradeScheduled: false,
    pendingLimitsSnapshot: null, scheduleStale: false, repairNeeded: false,
    ...over,
  }
}

// activeTenantKind is what /auth/me reports, and what useTenantKind reads.
function wrap(activeTenantKind) {
  const auth = {
    user: { id: 1, email: 'a@test.local', memberships: [], activeTenantKind },
    setUser: () => {},
    logout: async () => {},
    switchTenant: async () => undefined,
    refreshUser: vi.fn(),
  }
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={auth}><SubscriptionSummaryCard /></AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Both ladders live at once — the card must pick, not merge.
  api.getBillingState.mockResolvedValue({
    subscriptions: {
      band: subscription(),
      artist: subscription({ id: 2, planId: 4, planSlug: 'artist_gold', audience: 'artist' }),
    },
    ownedBandCount: 1,
    hasPersonalWorkspace: true,
    plans: PLANS,
  })
})

// The card sits on every settings page, so it must describe the workspace the
// user is actually looking at — matching useEntitlements().planSlug elsewhere.
describe('SubscriptionSummaryCard — follows the active tenant', () => {
  it('summarises the band subscription in a band workspace', async () => {
    wrap('band')
    expect(await screen.findByText('Gold')).toBeInTheDocument()
    expect(screen.queryByText('Artist Gold')).not.toBeInTheDocument()
  })

  it('summarises the artist subscription in a personal workspace', async () => {
    wrap('personal')
    expect(await screen.findByText('Artist Gold')).toBeInTheDocument()
    expect(screen.queryByText('Gold')).not.toBeInTheDocument()
  })

  it('falls back to that ladder’s free floor when it has no subscription', async () => {
    api.getBillingState.mockResolvedValue({
      subscriptions: { band: subscription(), artist: null },
      ownedBandCount: 1,
      hasPersonalWorkspace: true,
      plans: PLANS,
    })
    wrap('personal')
    expect(await screen.findByText('Artist Bronze')).toBeInTheDocument()
  })
})
