import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'
import { TERMS_VERSION } from '../../shared/termsVersion.js'
import OnboardingPage from '../pages/OnboardingPage.tsx'

vi.mock('../api/auth.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  acceptTerms: vi.fn(),
  onboardingComplete: vi.fn(),
}))
vi.mock('../api/billing.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  getBillingState: vi.fn(),
  subscribe: vi.fn(),
  syncSubscription: vi.fn(),
}))
vi.mock('../api/tenants.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  createOwnedTenant: vi.fn(),
  listOwnedTenants: vi.fn(),
}))
vi.mock('../api/profile.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadLogo: vi.fn(),
}))
vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))

import { acceptTerms, onboardingComplete } from '../api/auth.ts'
import { getBillingState, subscribe, syncSubscription } from '../api/billing.ts'
import { createOwnedTenant, listOwnedTenants } from '../api/tenants.ts'
import { uploadLogo } from '../api/profile.ts'
import { useAuth } from '../contexts/authContext.ts'

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

const baseUser = {
  id: 1,
  status: 'approved',
  isSuperAdmin: false,
  memberships: [],
  termsVersion: null,
  termsAcceptedAt: null,
  onboardingTenantId: null,
}

let auth

function mockAuth(userOverrides = {}) {
  auth = {
    user: { ...baseUser, ...userOverrides },
    setUser: vi.fn(),
    logout: vi.fn(),
    switchTenant: vi.fn().mockResolvedValue(undefined),
    refreshUser: vi.fn().mockResolvedValue(undefined),
  }
  useAuth.mockReturnValue(auth)
}

function wrap(initialEntry = '/onboarding') {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/" element={<div>app home</div>} />
          <Route path="/redeem-invite" element={<div>redeem page</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

// Walks step 1: select a plan by name, tick the terms box, click the CTA.
async function completeWelcomeStep(user, planName = 'Bronze') {
  await screen.findByText(planName)
  await user.click(screen.getByText(planName))
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /start/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth()
  getBillingState.mockResolvedValue({ subscription: null, ownedTenantCount: 0, plans: PLANS })
  listOwnedTenants.mockResolvedValue([])
  acceptTerms.mockResolvedValue({ termsAcceptedAt: 'now', termsVersion: TERMS_VERSION })
  onboardingComplete.mockResolvedValue(undefined)
})

describe('OnboardingPage — welcome step', () => {
  it('disables the CTA until a plan is selected and terms are agreed', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Silver')
    const cta = screen.getByRole('button', { name: /start/i })
    expect(cta).toBeDisabled()

    await user.click(screen.getByText('Silver'))
    expect(cta).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(cta).toBeEnabled()
  })

  it('opens the terms dialog from the agreement label', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Silver')
    await user.click(screen.getByRole('button', { name: /terms & conditions/i }))
    expect(await screen.findByText('GigBuddy Terms & Conditions')).toBeInTheDocument()
  })

  it('records terms acceptance with the current version on Next', async () => {
    const user = userEvent.setup()
    wrap()
    await completeWelcomeStep(user)
    await waitFor(() => expect(acceptTerms).toHaveBeenCalledWith(TERMS_VERSION))
  })

  it('skips the accept call when this version is already recorded', async () => {
    mockAuth({ termsVersion: TERMS_VERSION, termsAcceptedAt: '2026-07-01T00:00:00Z' })
    const user = userEvent.setup()
    wrap()
    await completeWelcomeStep(user)
    await screen.findByLabelText('Band name')
    expect(acceptTerms).not.toHaveBeenCalled()
  })

  it('links to the invite redemption page', async () => {
    wrap()
    await screen.findByText('Silver')
    expect(screen.getByRole('link', { name: /redeem your invite code/i })).toHaveAttribute(
      'href', '/redeem-invite',
    )
  })
})

describe('OnboardingPage — confirm (bronze, free path)', () => {
  it('creates the band with the onboarding pointer, then completes without payment', async () => {
    createOwnedTenant.mockResolvedValue({ id: 42, slug: 'the-band', band_name: 'The Band' })
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user)
    await user.type(await screen.findByLabelText('Band name'), 'The Band')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Create my band' }))

    await waitFor(() => expect(createOwnedTenant).toHaveBeenCalledWith({
      band_name: 'The Band', onboarding: true,
    }))
    await waitFor(() => expect(auth.switchTenant).toHaveBeenCalledWith(42))
    await waitFor(() => expect(onboardingComplete).toHaveBeenCalled())
    expect(subscribe).not.toHaveBeenCalled()
    expect(await screen.findByText('app home')).toBeInTheDocument()
  })
})

describe('OnboardingPage — confirm (paid path)', () => {
  it('creates, switches, then subscribes with the onboarding redirect', async () => {
    createOwnedTenant.mockResolvedValue({ id: 42, slug: 'the-band', band_name: 'The Band' })
    subscribe.mockResolvedValue({ checkoutUrl: 'https://pay.test/tr_1', trial: true })
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user, 'Silver')
    await user.type(await screen.findByLabelText('Band name'), 'The Band')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }))

    await waitFor(() => expect(subscribe).toHaveBeenCalledWith(2, 'month', 'onboarding'))
    // Order: create → switch → subscribe.
    expect(createOwnedTenant.mock.invocationCallOrder[0])
      .toBeLessThan(auth.switchTenant.mock.invocationCallOrder[0])
    expect(auth.switchTenant.mock.invocationCallOrder[0])
      .toBeLessThan(subscribe.mock.invocationCallOrder[0])
    // No purchase completed yet — the pointer must survive the Mollie hop.
    expect(onboardingComplete).not.toHaveBeenCalled()
    expect(uploadLogo).not.toHaveBeenCalled()
  })
})

describe('OnboardingPage — resume via onboarding pointer', () => {
  it('adopts only the pointer tenant and never re-creates', async () => {
    mockAuth({ onboardingTenantId: 42, termsVersion: TERMS_VERSION })
    listOwnedTenants.mockResolvedValue([
      { id: 42, slug: 'the-band', band_name: 'The Band', archived_at: null },
    ])
    subscribe.mockResolvedValue({ checkoutUrl: 'https://pay.test/tr_2', trial: true })
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user, 'Silver')
    // Band name is prefilled from the resumed tenant and locked.
    const nameField = await screen.findByLabelText('Band name')
    expect(nameField).toHaveValue('The Band')
    expect(nameField).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }))

    await waitFor(() => expect(subscribe).toHaveBeenCalledWith(2, 'month', 'onboarding'))
    expect(createOwnedTenant).not.toHaveBeenCalled()
    expect(auth.switchTenant).toHaveBeenCalledWith(42)
  })

  it('waits for the resume lookup before the wizard becomes interactive', async () => {
    let resolveOwned
    listOwnedTenants.mockReturnValue(new Promise((r) => { resolveOwned = r }))
    mockAuth({ onboardingTenantId: 42, termsVersion: TERMS_VERSION })
    wrap()

    // Plans have loaded but the resume-pointer lookup is still in flight — the
    // plan step must NOT be reachable yet (else confirm could create a dup band).
    await waitFor(() => expect(getBillingState).toHaveBeenCalled())
    expect(screen.queryByText('Silver')).not.toBeInTheDocument()

    await act(async () => {
      resolveOwned([{ id: 42, slug: 'the-band', band_name: 'The Band', archived_at: null }])
    })
    expect(await screen.findByText('Silver')).toBeInTheDocument()
  })

  it('blocks the wizard when the resume lookup fails, rather than risking a duplicate create', async () => {
    mockAuth({ onboardingTenantId: 42, termsVersion: TERMS_VERSION })
    listOwnedTenants.mockRejectedValue(new Error('network'))
    wrap()

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
    expect(screen.queryByText('Silver')).not.toBeInTheDocument()
    expect(createOwnedTenant).not.toHaveBeenCalled()
  })

  it('never adopts an owned band without the pointer: cap error is a dead end with an exit', async () => {
    // User owns a band but onboarding_tenant_id is null → create 409s.
    mockAuth({
      termsVersion: TERMS_VERSION,
      memberships: [{ tenantId: 9, status: 'approved', role: 'tenant_admin' }],
    })
    createOwnedTenant.mockRejectedValue(Object.assign(new Error('cap'), { code: 'band_limit_reached' }))
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user, 'Silver')
    await user.type(await screen.findByLabelText('Band name'), 'Second Band')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }))

    expect(await screen.findByText(/already own a band/i)).toBeInTheDocument()
    expect(listOwnedTenants).not.toHaveBeenCalled()
    expect(auth.switchTenant).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })
})

describe('OnboardingPage — checkout return', () => {
  it('settles on the sync result (re-ingested state), completes onboarding, offers the app', async () => {
    // Settlement comes from syncSubscription's returned status, not a passive
    // getBillingState read — the poll re-ingests each attempt.
    syncSubscription.mockResolvedValue({ subscription: { status: 'trialing' } })
    wrap('/onboarding?checkout=return')

    expect(await screen.findByText(/your subscription is active/i)).toBeInTheDocument()
    expect(syncSubscription).toHaveBeenCalled()
    await waitFor(() => expect(onboardingComplete).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Enter GigBuddy' })).toBeInTheDocument()
  })

  it('re-syncs on later polls so a payment settling after the first attempt still activates', async () => {
    vi.useFakeTimers()
    try {
      // Pending on the first sync, settled on the next — proves the loop
      // re-ingests rather than syncing once up front.
      syncSubscription
        .mockResolvedValueOnce({ subscription: { status: 'pending_mandate' } })
        .mockResolvedValue({ subscription: { status: 'trialing' } })
      wrap('/onboarding?checkout=return')

      await act(async () => { await vi.runAllTimersAsync() })

      expect(syncSubscription.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(onboardingComplete).toHaveBeenCalled()
      expect(screen.getByText(/your subscription is active/i)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
