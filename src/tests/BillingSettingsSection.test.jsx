import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/billing.ts', async (importOriginal) => {
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

import * as api from '../api/billing.ts'
import BillingSettingsSection from '../components/account/BillingSettingsSection.tsx'
import { AuthContext } from '../contexts/authContext.ts'
import theme from '../theme.ts'

const PLANS = [
  {
    id: 1, slug: 'bronze', name: 'Bronze',
    monthly_price_cents: 0, yearly_price_cents: 0,
    entitlements: { features: {}, limits: { storage_mb: 50, members: 5, bands: 1 } },
    is_active: true, is_fallback: true, sort_order: 0,
  },
  {
    id: 2, slug: 'silver', name: 'Silver',
    monthly_price_cents: 999, yearly_price_cents: 9999,
    entitlements: { features: { integrations: true }, limits: { storage_mb: 150, members: 10, bands: 3 } },
    is_active: true, is_fallback: false, sort_order: 1,
  },
]

function wrap(ui, user) {
  const auth = {
    user,
    setUser: () => {},
    logout: async () => {},
    switchTenant: async () => undefined,
    refreshUser: vi.fn().mockResolvedValue(user),
  }
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>
    </ThemeProvider>,
  )
}

const participantUser = {
  id: 7, email: 'p@test.local', name: 'Participant',
  memberships: [{ tenantId: 1, tenantName: 'Alpha', status: 'approved', role: 'member' }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BillingSettingsSection — current plan tier logo', () => {
  it('shows the tier logo for the active subscription plan', async () => {
    api.getBillingState.mockResolvedValue({
      subscription: {
        id: 1, planId: 2, planSlug: 'silver', status: 'active', billingInterval: 'month',
        priceCents: 999, cancelAtPeriodEnd: false, currentPeriodEnd: '2026-08-01T00:00:00Z',
        trialEndsAt: null, isComplimentary: false, complimentaryExpiresAt: null,
        pendingChange: null, scheduleStale: false, repairNeeded: false,
      },
      ownedTenantCount: 1,
      plans: PLANS,
    })
    const { container } = wrap(<BillingSettingsSection />, participantUser)
    await screen.findAllByText('Silver')
    expect(container.querySelector('img[src="/icons/gb_silver.png"]')).toBeTruthy()
  })

  it('shows no tier logo without a subscription', async () => {
    api.getBillingState.mockResolvedValue({ subscription: null, ownedTenantCount: 1, plans: PLANS })
    wrap(<BillingSettingsSection />, participantUser)
    // Scope to the current-subscription card only; the plan cards below legitimately
    // render their own tier logos, so a container-wide query would false-positive.
    const currentCard = (await screen.findByText(/You are on the free plan/)).closest('.MuiPaper-root')
    expect(currentCard?.querySelector('img[src^="/icons/gb_"]')).toBeNull()
  })
})

describe('BillingSettingsSection — participant without a subscription', () => {
  it('explains there is no subscription and no payment due when the user owns no tenant', async () => {
    api.getBillingState.mockResolvedValue({ subscription: null, ownedTenantCount: 0, plans: PLANS })
    wrap(<BillingSettingsSection />, participantUser)

    expect(await screen.findByText('No subscription')).toBeInTheDocument()
    expect(screen.getByText(/nothing for you to pay/i)).toBeInTheDocument()
    expect(screen.getByText(/another member's plan/i)).toBeInTheDocument()
    expect(screen.getByText(/don't count toward a plan's band limit/i)).toBeInTheDocument()
    expect(screen.queryByText(/You are on the free plan/)).not.toBeInTheDocument()
  })

  it('keeps the free-plan copy for a user who owns a tenant', async () => {
    api.getBillingState.mockResolvedValue({ subscription: null, ownedTenantCount: 1, plans: PLANS })
    wrap(<BillingSettingsSection />, participantUser)

    expect(await screen.findByText(/You are on the free plan/)).toBeInTheDocument()
    expect(screen.queryByText(/another member's plan/i)).not.toBeInTheDocument()
  })

  it('keeps the free-plan copy for a user with no approved memberships', async () => {
    api.getBillingState.mockResolvedValue({ subscription: null, ownedTenantCount: 0, plans: PLANS })
    wrap(<BillingSettingsSection />, { id: 8, email: 'new@test.local', memberships: [] })

    expect(await screen.findByText(/You are on the free plan/)).toBeInTheDocument()
    expect(screen.queryByText(/another member's plan/i)).not.toBeInTheDocument()
  })
})
