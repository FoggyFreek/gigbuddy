import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../billing.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getBillingState: vi.fn() }
})

import * as api from '../billing.ts'
import SubscriptionSummaryCard from '../../../people/workspaces/components/settings/SubscriptionSummaryCard.tsx'
import { AuthContext } from '../../../contexts/authContext.ts'
import theme from '../../../theme.ts'

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

function moduleRow(over) {
  return {
    audience: "band", planId: 2, planSlug: "gold", status: "active",
    priceCents: 2000, isStarter: true,
    pendingPlanId: null, pendingPlanSlug: null, pendingChangeKind: null,
    pendingLimitsSnapshot: null,
    ...over,
  }
}

function subscription(modules) {
  return {
    id: 1, status: "active", billingInterval: "month", cancelAtPeriodEnd: false,
    currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null,
    convertedAt: null, isComplimentary: false, complimentaryExpiresAt: null,
    priceSnapshot: null, totalCents: 3000, nextPriceSnapshot: null,
    nextTotalCents: null, pendingTotalCents: null, refundEligibleUntil: null,
    scheduleStale: false, repairNeeded: false, modules,
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
  // Both modules live on ONE subscription — the card must pick, not merge.
  api.getBillingState.mockResolvedValue({
    subscription: subscription([
      moduleRow(),
      moduleRow({ audience: "artist", planId: 4, planSlug: "artist_gold" }),
    ]),
    trialAvailable: false,
    trialDays: 30,
    ownedBandCount: 1,
    hasPersonalWorkspace: true,
    plans: PLANS,
  })
})

// The card sits on every settings page, so it must describe the workspace the
// user is actually looking at — matching useEntitlements().planSlug elsewhere.
describe('SubscriptionSummaryCard — follows the active tenant', () => {
  it('summarises the band MODULE in a band workspace', async () => {
    wrap('band')
    expect(await screen.findByText('Gold')).toBeInTheDocument()
    expect(screen.queryByText('Artist Gold')).not.toBeInTheDocument()
  })

  it('summarises the artist MODULE in a personal workspace', async () => {
    wrap('personal')
    expect(await screen.findByText('Artist Gold')).toBeInTheDocument()
    expect(screen.queryByText('Gold')).not.toBeInTheDocument()
  })

  it('falls back to that ladder’s free floor when it has no module', async () => {
    api.getBillingState.mockResolvedValue({
      subscription: subscription([moduleRow()]),
      trialAvailable: false,
      trialDays: 30,
      ownedBandCount: 1,
      hasPersonalWorkspace: true,
      plans: PLANS,
    })
    wrap('personal')
    expect(await screen.findByText('Artist Bronze')).toBeInTheDocument()
  })
})
