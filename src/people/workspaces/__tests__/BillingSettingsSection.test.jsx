import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../commerce/billing/billing.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getBillingState: vi.fn(),
    startTrial: vi.fn(),
    subscribe: vi.fn(),
    checkout: vi.fn(),
    changeModule: vi.fn(),
    downgradePreview: vi.fn(),
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
    is_active: true, is_fallback: true, is_trial_tier: false, sort_order: 1,
  },
  {
    id: 2, slug: 'silver', name: 'Silver', audience: 'band',
    monthly_price_cents: 999, yearly_price_cents: 9999,
    entitlements: { features: { integrations: true }, limits: { storage_mb: 150, members: 10, bands: 3 } },
    is_active: true, is_fallback: false, is_trial_tier: false, sort_order: 2,
  },
  {
    id: 5, slug: 'gold', name: 'Gold', audience: 'band',
    monthly_price_cents: 2000, yearly_price_cents: 20000,
    entitlements: { features: { integrations: true, chordpro: true }, limits: { storage_mb: 500, members: null, bands: null } },
    is_active: true, is_fallback: false, is_trial_tier: true, sort_order: 3,
  },
  {
    id: 3, slug: 'artist_bronze', name: 'Artist Bronze', audience: 'artist',
    monthly_price_cents: 0, yearly_price_cents: 0,
    entitlements: { features: {}, limits: { storage_mb: 50, members: 1, bands: 0 } },
    is_active: true, is_fallback: true, is_trial_tier: false, sort_order: 1,
  },
  {
    id: 4, slug: 'artist_gold', name: 'Artist Gold', audience: 'artist',
    monthly_price_cents: 1000, yearly_price_cents: 10000,
    entitlements: { features: { chordpro: true }, limits: { storage_mb: 250, members: 1, bands: 0 } },
    is_active: true, is_fallback: false, is_trial_tier: true, sort_order: 2,
  },
]

function moduleRow(overrides = {}) {
  return {
    audience: 'band', planId: 2, planSlug: 'silver', status: 'active',
    priceCents: 999, isStarter: true,
    pendingPlanId: null, pendingPlanSlug: null, pendingChangeKind: null,
    pendingLimitsSnapshot: null,
    ...overrides,
  }
}

function subscription(overrides = {}) {
  return {
    id: 1, status: 'active', billingInterval: 'month', cancelAtPeriodEnd: false,
    currentPeriodStart: '2026-07-01T00:00:00Z',
    currentPeriodEnd: '2026-08-01T00:00:00Z',
    trialEndsAt: null, convertedAt: '2026-07-01T00:00:00Z',
    isComplimentary: false, complimentaryExpiresAt: null,
    priceSnapshot: {
      modules: { band: { plan: 'silver', priceCents: 999 } },
      subtotalCents: 999, discounts: [], totalCents: 999,
    },
    totalCents: 999, nextPriceSnapshot: null, nextTotalCents: null,
    pendingTotalCents: null, refundEligibleUntil: null,
    scheduleStale: false, repairNeeded: false,
    paymentMethodReady: false, paymentVerificationPending: false,
    subscriptionStartsAt: null,
    modules: [moduleRow()],
    ...overrides,
  }
}

function state({
  sub = null, trialAvailable = false, ownedBandCount = 1, hasPersonalWorkspace = true,
} = {}) {
  return {
    subscription: sub,
    trialAvailable,
    trialDays: 30,
    ownedBandCount,
    hasPersonalWorkspace,
    checkoutQuotes: {
      month: {
        modules: { band: { plan: 'gold', priceCents: 2000 } },
        subtotalCents: 2000, discounts: [], totalCents: 2000,
      },
      year: {
        modules: { band: { plan: 'gold', priceCents: 20000 } },
        subtotalCents: 20000, discounts: [], totalCents: 20000,
      },
    },
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

const ownerUser = { id: 1, email: 'o@test.local', name: 'Owner', memberships: [] }
const participantUser = {
  id: 7, email: 'p@test.local', name: 'Participant',
  memberships: [{ tenantId: 1, tenantName: 'Alpha', status: 'approved', role: 'contributor' }],
}

const modulePlans = (audience) => screen.getByTestId(`module-plans-${audience}`)

beforeEach(() => {
  vi.clearAllMocks()
  api.syncSubscription.mockResolvedValue({ subscription: null })
})

describe('BillingSettingsSection — no subscription', () => {
  it('offers the free trial with a module to start on', async () => {
    api.getBillingState.mockResolvedValue(state({ trialAvailable: true }))
    api.startTrial.mockResolvedValue({ subscription: subscription(), trialDays: 30 })
    const user = userEvent.setup()
    wrap(<BillingSettingsSection />, ownerUser)

    expect(await screen.findByText(/Try GigBuddy free for 30 days/)).toBeInTheDocument()
    expect(screen.queryByTestId('module-plans-band')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Band' }))
    await waitFor(() => expect(api.startTrial).toHaveBeenCalledWith('band'))
  })

  it('says the trial is spent instead of offering it again', async () => {
    api.getBillingState.mockResolvedValue(state({ trialAvailable: false }))
    wrap(<BillingSettingsSection />, ownerUser)
    expect(await screen.findByText(/already used your free trial/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Band' })).not.toBeInTheDocument()
  })
})

describe('BillingSettingsSection — modules', () => {
  it('renders a section per product, each with only its own plans', async () => {
    api.getBillingState.mockResolvedValue(state({ sub: subscription() }))
    wrap(<BillingSettingsSection />, ownerUser)

    await screen.findByTestId('module-plans-band')
    expect(within(modulePlans('band')).getByText('Silver')).toBeInTheDocument()
    expect(within(modulePlans('band')).queryByText('Artist Gold')).not.toBeInTheDocument()
    expect(within(modulePlans('artist')).getByText('Artist Gold')).toBeInTheDocument()
    expect(within(modulePlans('artist')).queryByText('Silver')).not.toBeInTheDocument()
  })

  it('marks the plan each module sits on', async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({
        modules: [moduleRow(), moduleRow({ audience: 'artist', planId: 4, planSlug: 'artist_gold' })],
      }),
    }))
    wrap(<BillingSettingsSection />, ownerUser)

    await screen.findByTestId('module-plans-band')
    expect(within(modulePlans('band')).getAllByText('Current')).toHaveLength(1)
    expect(within(modulePlans('artist')).getAllByText('Current')).toHaveLength(1)
  })

  it('adds a module the subscription does not have', async () => {
    api.getBillingState.mockResolvedValue(state({ sub: subscription() }))
    api.changeModule.mockResolvedValue({ changed: true, pending: true, amountCents: 500 })
    const user = userEvent.setup()
    wrap(<BillingSettingsSection />, ownerUser)

    await screen.findByTestId('module-plans-artist')
    await user.click(within(modulePlans('artist')).getByRole('button', { name: 'Add module' }))
    await waitFor(() => expect(api.changeModule).toHaveBeenCalledWith('artist', 4))
  })

  it('offers the free floor as a REMOVAL, not a downgrade to a plan', async () => {
    api.getBillingState.mockResolvedValue(state({ sub: subscription() }))
    api.downgradePreview.mockResolvedValue({
      isDowngrade: true, isRemoval: true, features: [], limitsSnapshot: {},
      blockers: [], nextSnapshot: null, effectiveAt: null,
    })
    const user = userEvent.setup()
    wrap(<BillingSettingsSection />, ownerUser)

    await screen.findByTestId('module-plans-band')
    await user.click(within(modulePlans('band')).getByRole('button', { name: 'Remove module' }))
    await waitFor(() => expect(api.downgradePreview).toHaveBeenCalledWith({ audience: 'band', remove: true }))
  })
})

describe('BillingSettingsSection — the price breakdown', () => {
  it('shows each module line, the discount and the total', async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({
        priceSnapshot: {
          modules: {
            band: { plan: 'gold', priceCents: 2000 },
            artist: { plan: 'artist_gold', priceCents: 1000 },
          },
          subtotalCents: 3000,
          discounts: [{
            code: 'dual_module_bundle', name: 'Two-module bundle', version: 1,
            type: 'percentage', value: 10, amountCents: 300,
          }],
          totalCents: 2700,
        },
        totalCents: 2700,
      }),
    }))
    wrap(<BillingSettingsSection />, ownerUser)

    expect(await screen.findByText(/Band — gold/)).toBeInTheDocument()
    expect(screen.getByText(/Artist — artist_gold/)).toBeInTheDocument()
    expect(screen.getByText('Two-module bundle')).toBeInTheDocument()
    expect(screen.queryByText('dual_module_bundle')).not.toBeInTheDocument()
    expect(screen.getByText('Subtotal')).toBeInTheDocument()
  })

  it('warns when the next renewal costs something different', async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({ nextTotalCents: 2000 }),
    }))
    wrap(<BillingSettingsSection />, ownerUser)
    expect(await screen.findByText(/this becomes/)).toBeInTheDocument()
  })
})

describe('BillingSettingsSection — trial conversion', () => {
  it('discloses the delayed charge and starts mandate verification', async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({
        status: 'trialing', billingInterval: null,
        trialEndsAt: '2026-08-01T00:00:00Z',
        currentPeriodStart: null, currentPeriodEnd: null,
        priceSnapshot: null, totalCents: null,
      }),
    }))
    api.checkout.mockResolvedValue({ checkoutUrl: 'https://pay.test/x', subscriptionId: 1, totalCents: 2000 })
    const user = userEvent.setup()
    wrap(<BillingSettingsSection />, ownerUser)

    expect(await screen.findByText(/Trial ends/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yearly' }))
    expect(screen.getByText(/first subscription charge.*when your paid subscription starts/i))
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /verify payment method and schedule/i }))
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('year'))
  })

  it('allows Band Silver plus Artist Gold before scheduling payment', async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({
        status: 'trialing', billingInterval: null,
        trialEndsAt: '2026-08-31T00:00:00Z',
        currentPeriodStart: null, currentPeriodEnd: null,
        priceSnapshot: null, totalCents: null,
        modules: [moduleRow({ planId: 5, planSlug: 'gold', priceCents: 0 })],
      }),
    }))
    api.changeModule.mockResolvedValue({ changed: true, trial: true })
    const user = userEvent.setup()
    wrap(<BillingSettingsSection />, ownerUser)

    await screen.findByTestId('module-plans-artist')
    expect(within(modulePlans('band')).getByText('Silver')).toBeInTheDocument()
    await user.click(within(modulePlans('band')).getByRole('button', {
      name: /select for paid subscription/i,
    }))
    await waitFor(() => expect(api.changeModule).toHaveBeenCalledWith('band', 2))
    await user.click(within(modulePlans('artist')).getByRole('button', { name: 'Add module' }))
    await waitFor(() => expect(api.changeModule).toHaveBeenCalledWith('artist', 4))
  })

  it('shows the exact charge date after payment has been scheduled', async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({
        status: 'trialing', billingInterval: 'month',
        trialEndsAt: '2026-08-31T00:00:00Z', subscriptionStartsAt: '2026-08-31T00:00:00Z',
        paymentMethodReady: true, nextTotalCents: 2000,
        currentPeriodStart: null, currentPeriodEnd: null,
        priceSnapshot: null, totalCents: null,
      }),
    }))
    wrap(<BillingSettingsSection />, ownerUser)

    expect(await screen.findByText(/Payment is scheduled/)).toHaveTextContent(/€\s*20[,.]00/)
    expect(screen.queryByRole('button', { name: /verify payment method/i })).not.toBeInTheDocument()
  })
})

describe('BillingSettingsSection — cancelling', () => {
  it('offers the refund branch only while the window is open', async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({ refundEligibleUntil: '2099-01-01T00:00:00Z' }),
    }))
    api.cancelSubscription.mockResolvedValue({ canceled: true, refunded: true, refundAmountCents: 999 })
    const user = userEvent.setup()
    wrap(<BillingSettingsSection />, ownerUser)

    await user.click(await screen.findByRole('button', { name: 'Cancel subscription' }))
    await user.click(screen.getByRole('button', { name: 'Cancel now with a refund' }))
    await waitFor(() => expect(api.cancelSubscription).toHaveBeenCalledWith(true))
  })

  it('offers only the period-end branch once the window has closed', async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({ refundEligibleUntil: null }),
    }))
    api.cancelSubscription.mockResolvedValue({ canceled: true, atPeriodEnd: true })
    const user = userEvent.setup()
    wrap(<BillingSettingsSection />, ownerUser)

    await user.click(await screen.findByRole('button', { name: 'Cancel subscription' }))
    expect(screen.queryByRole('button', { name: 'Cancel now with a refund' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel at period end' }))
    await waitFor(() => expect(api.cancelSubscription).toHaveBeenCalledWith(false))
  })
})

describe('BillingSettingsSection — checkout return', () => {
  it('syncs the subscription when returning from checkout', async () => {
    api.getBillingState.mockResolvedValue(state({ sub: subscription() }))
    wrap(<BillingSettingsSection />, ownerUser, { initialEntry: '/settings/billing?checkout=return' })
    await waitFor(() => expect(api.syncSubscription).toHaveBeenCalled())
  })

  it('does not sync on a normal visit', async () => {
    api.getBillingState.mockResolvedValue(state({ sub: subscription() }))
    wrap(<BillingSettingsSection />, ownerUser)
    await screen.findByTestId('module-plans-band')
    expect(api.syncSubscription).not.toHaveBeenCalled()
  })
})

describe('BillingSettingsSection — scheduled change note', () => {
  it('warns that limits already bind once a change is scheduled', async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({
        modules: [moduleRow({
          pendingPlanId: 1, pendingPlanSlug: 'bronze', pendingChangeKind: 'downgrade',
          pendingLimitsSnapshot: { storage_mb: 50 },
        })],
      }),
    }))
    wrap(<BillingSettingsSection />, ownerUser)
    expect(await screen.findByText(/no longer add data beyond the new limits/)).toBeInTheDocument()
  })

  it("warns during a trial too — the selected paid plan's limits bind at once", async () => {
    api.getBillingState.mockResolvedValue(state({
      sub: subscription({
        status: 'trialing', trialEndsAt: '2026-09-01T00:00:00Z', convertedAt: null,
        modules: [moduleRow({
          planId: 5, planSlug: 'gold',
          pendingPlanId: 2, pendingPlanSlug: 'silver', pendingChangeKind: 'trial_selection',
          pendingLimitsSnapshot: { storage_mb: 150 },
        })],
      }),
    }))
    wrap(<BillingSettingsSection />, ownerUser)
    expect(await screen.findByText(/no longer add data beyond the new limits/)).toBeInTheDocument()
  })
})

describe('BillingSettingsSection — empty states per ladder', () => {
  it('explains there is no payment due for a pure participant', async () => {
    api.getBillingState.mockResolvedValue(state({ ownedBandCount: 0, trialAvailable: false }))
    wrap(<BillingSettingsSection />, participantUser)
    expect(await screen.findByText(/taking part in your band\(s\) under another member's plan/))
      .toBeInTheDocument()
  })

  it('keeps the free-plan copy for a user who owns a band', async () => {
    api.getBillingState.mockResolvedValue(state({ ownedBandCount: 1, trialAvailable: false }))
    wrap(<BillingSettingsSection />, participantUser)
    await screen.findByTestId('module-plans-band')
    expect(screen.queryByText(/taking part in your band\(s\)/)).not.toBeInTheDocument()
  })

  it('points a user without an artist workspace at creating one', async () => {
    api.getBillingState.mockResolvedValue(state({ hasPersonalWorkspace: false, trialAvailable: false }))
    wrap(<BillingSettingsSection />, ownerUser)
    expect(await screen.findByText(/do not have your own artist workspace yet/)).toBeInTheDocument()
  })

  it('keeps the free-plan copy for a user with no approved memberships', async () => {
    api.getBillingState.mockResolvedValue(state({ ownedBandCount: 0, trialAvailable: false }))
    wrap(<BillingSettingsSection />, ownerUser)
    await screen.findByTestId('module-plans-band')
    expect(screen.queryByText(/taking part in your band\(s\)/)).not.toBeInTheDocument()
  })
})
