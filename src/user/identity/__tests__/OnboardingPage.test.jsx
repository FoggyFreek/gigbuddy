import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../../../theme.ts'
import { TERMS_VERSION } from '../../../../shared/termsVersion.js'
import OnboardingPage from '../OnboardingPage.tsx'

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  acceptTerms: vi.fn(),
  onboardingComplete: vi.fn(),
}))
vi.mock('../../../commerce/billing/billing.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  getBillingState: vi.fn(),
  startTrial: vi.fn(),
  subscribe: vi.fn(),
  syncSubscription: vi.fn(),
}))
vi.mock('../../../people/workspaces/tenants.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  createOwnedTenant: vi.fn(),
  createPersonalTenant: vi.fn(),
  getTenantOnboardingStatus: vi.fn(),
  listOwnedTenants: vi.fn(),
}))
vi.mock('../../../people/band-profiles/bandProfiles.ts', () => ({ searchBandProfiles: vi.fn() }))
vi.mock('../../../people/band-profiles/bandProfileClaims.ts', () => ({ requestClaim: vi.fn() }))
vi.mock('../../../people/profiles/profile.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadLogo: vi.fn(),
}))
vi.mock('../../../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))
vi.mock('../../../finance/invoices/checkoutNavigation.ts', () => ({
  redirectToCheckout: vi.fn(),
}))
vi.mock('../../../utils/randomBackground.ts', () => ({
  pickRandomBackground: vi.fn(),
}))

import { acceptTerms, onboardingComplete } from '../auth.ts'
import { searchBandProfiles } from '../../../people/band-profiles/bandProfiles.ts'
import { requestClaim } from '../../../people/band-profiles/bandProfileClaims.ts'
import { getBillingState, startTrial, subscribe, syncSubscription } from '../../../commerce/billing/billing.ts'
import {
  createOwnedTenant,
  createPersonalTenant,
  getTenantOnboardingStatus,
  listOwnedTenants,
} from '../../../people/workspaces/tenants.ts'
import { uploadLogo } from '../../../people/profiles/profile.ts'
import { useAuth } from '../../../contexts/authContext.ts'
import { redirectToCheckout } from '../../../finance/invoices/checkoutNavigation.ts'
import { pickRandomBackground } from '../../../utils/randomBackground.ts'

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
    monthly_price_cents: 1999, yearly_price_cents: 19999,
    entitlements: { features: { chordpro: true }, limits: { storage_mb: 500, members: null, bands: null } },
    is_active: true, is_fallback: false, is_trial_tier: true, sort_order: 3,
  },
  // The artist ladder, offered when the personal workspace kind is chosen.
  {
    id: 3, slug: 'artist_bronze', name: 'Artist Bronze', audience: 'artist',
    monthly_price_cents: 0, yearly_price_cents: 0,
    entitlements: { features: {}, limits: { storage_mb: 50, members: 1, bands: 0 } },
    is_active: true, is_fallback: true, is_trial_tier: false, sort_order: 1,
  },
  {
    id: 4, slug: 'artist_gold', name: 'Artist Gold', audience: 'artist',
    monthly_price_cents: 1499, yearly_price_cents: 14999,
    entitlements: { features: { chordpro: true }, limits: { storage_mb: 250, members: 1, bands: 0 } },
    is_active: true, is_fallback: false, is_trial_tier: true, sort_order: 2,
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
// The workspace kind lives on the welcome step because it decides WHICH plan
// ladder is shown, so it must be chosen before a plan.
async function completeWelcomeStep(user, planName = 'Bronze', { kind = null } = {}) {
  if (kind) {
    await user.click(await screen.findByRole('radio', { name: kind }))
  }
  await screen.findByText(/30-day Gold trial starts first|Choose your plan/)
  const plan = screen.queryByText(planName)
  if (plan) await user.click(plan)
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /start/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth()
  // Deterministic stand-in for the random pick: each call yields the next
  // background, so "re-picked" is observable without fighting Math.random.
  let pick = 0
  pickRandomBackground.mockImplementation(() => {
    pick += 1
    return {
      image: `url(/backgrounds/bg_0${pick}_light.webp)`,
      position: '0% 0%',
      id: `bg_0${pick}_light`,
      meta: { description: '', credit: '' },
    }
  })
  getBillingState.mockResolvedValue({
    subscription: null, trialAvailable: true, trialDays: 30,
    ownedBandCount: 0, hasPersonalWorkspace: false, plans: PLANS,
  })
  getTenantOnboardingStatus.mockResolvedValue({ tenantOnboardingEnabled: true })
  listOwnedTenants.mockResolvedValue([])
  acceptTerms.mockResolvedValue({ termsAcceptedAt: 'now', termsVersion: TERMS_VERSION })
  onboardingComplete.mockResolvedValue(undefined)
  startTrial.mockResolvedValue({ subscription: { status: 'trialing' }, trialDays: 30 })
})

describe('OnboardingPage — welcome step', () => {
  it('starts with Gold trial copy and disables the CTA until terms are agreed', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText(/30-day Gold trial starts first/)
    const cta = screen.getByRole('button', { name: /start/i })
    expect(cta).toBeDisabled()
    expect(screen.queryByText('Silver')).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox'))
    expect(cta).toBeEnabled()
  })

  it('opens the terms dialog from the agreement label', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText(/30-day Gold trial starts first/)
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
    await screen.findByText(/30-day Gold trial starts first/)
    expect(screen.getByRole('link', { name: /redeem your invite code/i })).toHaveAttribute(
      'href', '/redeem-invite',
    )
  })

  it('redirects to invite redemption when new tenant onboarding is disabled', async () => {
    getTenantOnboardingStatus.mockResolvedValue({ tenantOnboardingEnabled: false })
    wrap()

    expect(await screen.findByText('redeem page')).toBeInTheDocument()
    expect(screen.queryByText('Silver')).not.toBeInTheDocument()
  })
})

// The band step needs a name AND an accounting country before it can advance.
async function fillBandStep(user, name = 'The Band', country = 'Netherlands (NL)') {
  if (name !== null) {
    await user.type(await screen.findByLabelText('Band name'), name)
  }
  await user.click(await screen.findByLabelText('Accounting country'))
  await user.click(await screen.findByRole('option', { name: country }))
}

describe('OnboardingPage — trial-first confirmation', () => {
  it('creates the band, starts Gold, and completes without payment', async () => {
    createOwnedTenant.mockResolvedValue({ id: 42, slug: 'the-band', band_name: 'The Band' })
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user)
    await fillBandStep(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: /create workspace and start trial/i }))

    await waitFor(() => expect(createOwnedTenant).toHaveBeenCalledWith({
      band_name: 'The Band', country_code: 'nl', onboarding: true,
    }))
    await waitFor(() => expect(auth.switchTenant).toHaveBeenCalledWith(42))
    await waitFor(() => expect(startTrial).toHaveBeenCalledWith('band'))
    await waitFor(() => expect(onboardingComplete).toHaveBeenCalled())
    expect(subscribe).not.toHaveBeenCalled()
    expect(await screen.findByText('app home')).toBeInTheDocument()
  })
})

describe('OnboardingPage — confirm (paid path)', () => {
  it('creates, switches, then subscribes with the onboarding redirect', async () => {
    getBillingState.mockResolvedValue({
      subscription: null, trialAvailable: false, trialDays: 30,
      ownedBandCount: 0, hasPersonalWorkspace: false, plans: PLANS,
    })
    createOwnedTenant.mockResolvedValue({ id: 42, slug: 'the-band', band_name: 'The Band' })
    subscribe.mockResolvedValue({ checkoutUrl: 'https://pay.test/tr_1', trial: true })
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user, 'Silver')
    await fillBandStep(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }))

    await waitFor(() => expect(subscribe).toHaveBeenCalledWith('band', 2, 'month', 'onboarding'))
    expect(redirectToCheckout).toHaveBeenCalledWith('https://pay.test/tr_1')
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

// jsdom quotes the url(); strip it so the expectations read as plain paths.
const backgroundImages = () =>
  screen.getAllByTestId('onboarding-background-layer')
    .map((layer) => getComputedStyle(layer).backgroundImage.replace(/"/g, ''))

describe('OnboardingPage — background', () => {
  it('shows a random background and re-picks it on every step change', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText(/30-day Gold trial starts first/)

    expect(backgroundImages()).toEqual(['url(/backgrounds/bg_01_light.webp)'])

    await completeWelcomeStep(user)
    expect(await screen.findByLabelText('Band name')).toBeInTheDocument()
    expect(backgroundImages()).toContain('url(/backgrounds/bg_02_light.webp)')

    // Back counts too — every step change is a new picture.
    await waitFor(() => expect(backgroundImages()).toEqual(['url(/backgrounds/bg_02_light.webp)']))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText(/30-day Gold trial starts first/)
    expect(backgroundImages()).toContain('url(/backgrounds/bg_03_light.webp)')
  })

  // Crossfade, not a swap: the outgoing picture stays underneath until the new
  // one has faded in over it, then it's dropped.
  it('keeps the outgoing image mounted while the new one fades in', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText(/30-day Gold trial starts first/)

    await completeWelcomeStep(user)
    expect(await screen.findByLabelText('Band name')).toBeInTheDocument()

    expect(backgroundImages()).toEqual([
      'url(/backgrounds/bg_01_light.webp)',
      'url(/backgrounds/bg_02_light.webp)',
    ])
    await waitFor(() => expect(backgroundImages()).toEqual(['url(/backgrounds/bg_02_light.webp)']))
  })
})

describe('OnboardingPage — what are you setting up?', () => {
  it('offers both kinds before any paid subscription choices', async () => {
    const user = userEvent.setup()
    wrap()

    const choices = await screen.findAllByRole('radio')
    expect(choices.map((c) => c.textContent)).toEqual([
      expect.stringContaining('A band'),
      expect.stringContaining('My own artist workspace'),
    ])
    expect(screen.getByText(/30-day Gold trial starts first/)).toBeInTheDocument()
    expect(screen.queryByText('Bronze')).not.toBeInTheDocument()
    expect(screen.queryByText('Artist Bronze')).not.toBeInTheDocument()

    await completeWelcomeStep(user)
    expect(await screen.findByLabelText('Band name')).toBeInTheDocument()
  })

  // Decorative illustrations: the tile's accessible name must stay the copy.
  it('illustrates each kind with a square image', async () => {
    wrap()

    const [band, artist] = await screen.findAllByRole('radio')
    expect(band.querySelector('img')).toHaveAttribute('src', '/images/band-rehearsal.webp')
    expect(band.querySelector('img')).toHaveAttribute('alt', '')
    expect(artist.querySelector('img')).toHaveAttribute('src', '/images/artist.webp')
    expect(artist.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('keeps paid plan choices hidden when the artist workspace kind is chosen', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('radio', { name: /my own artist workspace/i }))

    expect(await screen.findByText(/30-day Gold trial starts first/)).toBeInTheDocument()
    expect(screen.queryByText('Artist Gold')).not.toBeInTheDocument()
    expect(screen.queryByText('Silver')).not.toBeInTheDocument()
  })

  it('redirects before offering workspace kinds when onboarding is disabled', async () => {
    getTenantOnboardingStatus.mockResolvedValue({ tenantOnboardingEnabled: false })
    wrap()

    expect(await screen.findByText('redeem page')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('creates a personal workspace when that kind is chosen', async () => {
    createPersonalTenant.mockResolvedValue({
      id: 7, slug: 'alpha-user', kind: 'personal', display_name: 'Alpha User',
    })
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user, 'Artist Bronze', { kind: /my own artist workspace/i })
    await user.type(await screen.findByLabelText('Artist name'), 'Alpha User')
    await user.click(await screen.findByLabelText('Accounting country'))
    await user.click(await screen.findByRole('option', { name: 'Netherlands (NL)' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: /create workspace and start trial/i }))

    await waitFor(() => expect(createPersonalTenant).toHaveBeenCalledWith({
      display_name: 'Alpha User', country_code: 'nl', onboarding: true,
    }))
    expect(createOwnedTenant).not.toHaveBeenCalled()
    await waitFor(() => expect(auth.switchTenant).toHaveBeenCalledWith(7))
    await waitFor(() => expect(startTrial).toHaveBeenCalledWith('artist'))
  })

  it('a resumed personal onboarding does not offer the band path again', async () => {
    mockAuth({ onboardingTenantId: 7, termsVersion: TERMS_VERSION })
    listOwnedTenants.mockResolvedValue([{
      id: 7, slug: 'alpha-user', kind: 'personal', display_name: 'Alpha User',
      accounting_country: 'nl', archived_at: null,
    }])
    const user = userEvent.setup()
    wrap()

    // The kind came from the resumed tenant — no choice offered, and the artist
    // ladder is the only one shown.
    await completeWelcomeStep(user, 'Artist Bronze')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    const nameField = await screen.findByLabelText('Artist name')
    expect(nameField).toHaveValue('Alpha User')
    expect(nameField).toBeDisabled()
    expect(screen.queryByLabelText('Band name')).not.toBeInTheDocument()
  })
})

describe('OnboardingPage — resume via onboarding pointer', () => {
  it('adopts only the pointer tenant and resumes trial-first onboarding', async () => {
    mockAuth({ onboardingTenantId: 42, termsVersion: TERMS_VERSION })
    listOwnedTenants.mockResolvedValue([
      { id: 42, slug: 'the-band', band_name: 'The Band', accounting_country: 'nl', archived_at: null },
    ])
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user, 'Silver')
    // Band name is prefilled from the resumed tenant and locked.
    const nameField = await screen.findByLabelText('Band name')
    expect(nameField).toHaveValue('The Band')
    expect(nameField).toBeDisabled()
    // The accounting country is fixed once the band exists.
    expect(await screen.findByLabelText('Accounting country')).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: /create workspace and start trial/i }))

    await waitFor(() => expect(startTrial).toHaveBeenCalledWith('band'))
    expect(redirectToCheckout).not.toHaveBeenCalled()
    expect(createOwnedTenant).not.toHaveBeenCalled()
    expect(auth.switchTenant).toHaveBeenCalledWith(42)
  })

  it('still resumes a pointer tenant when new tenant onboarding is disabled', async () => {
    getTenantOnboardingStatus.mockResolvedValue({ tenantOnboardingEnabled: false })
    mockAuth({ onboardingTenantId: 42, termsVersion: TERMS_VERSION })
    listOwnedTenants.mockResolvedValue([
      { id: 42, slug: 'the-band', band_name: 'The Band', vat_country: 'nl', archived_at: null },
    ])
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user, 'Bronze')
    expect(await screen.findByLabelText('Band name')).toHaveValue('The Band')
    expect(createOwnedTenant).not.toHaveBeenCalled()
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
      resolveOwned([{ id: 42, slug: 'the-band', band_name: 'The Band', vat_country: 'nl', archived_at: null }])
    })
    expect(await screen.findByText(/30-day Gold trial starts first/)).toBeInTheDocument()
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
    await fillBandStep(user, 'Second Band')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: /create workspace and start trial/i }))

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
        .mockResolvedValueOnce({ subscription: { status: 'pending_activation' } })
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

describe('OnboardingPage — claiming a band profile', () => {
  beforeEach(() => {
    searchBandProfiles.mockResolvedValue({
      items: [{
        id: 5001, name: 'Off Platform', countryCode: 'nl', spotifyUrl: null,
        websiteUrl: 'https://offplatform.example', contactEmail: null,
        status: 'claimable', claimed: false, claimedTenant: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
      meta: { limit: 10, returned: 1 },
    })
  })

  // The regression guard for the reason this is NOT a payload field on tenant
  // creation: a resumed onboarding short-circuits ensureOnboardingTenant, so a
  // claim carried in that call would be skipped for exactly the people most
  // likely to have been interrupted.
  it('submits the claim on a RESUMED onboarding too', async () => {
    mockAuth({ onboardingTenantId: 42, termsVersion: TERMS_VERSION })
    listOwnedTenants.mockResolvedValue([
      { id: 42, slug: 'the-band', band_name: 'The Band', accounting_country: 'nl', archived_at: null },
    ])
    requestClaim.mockResolvedValue({ id: 1, status: 'pending' })
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user, 'Bronze')
    await user.type(await screen.findByLabelText('Search for your band'), 'Off Platform')
    await user.click(await screen.findByRole('button', { name: /Off Platform/ }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: /create|finish|start/i }))

    await waitFor(() => expect(requestClaim).toHaveBeenCalledWith(5001))
    expect(createOwnedTenant).not.toHaveBeenCalled()
  })

  it('never blocks workspace creation when the claim fails', async () => {
    mockAuth({ onboardingTenantId: 42, termsVersion: TERMS_VERSION })
    listOwnedTenants.mockResolvedValue([
      { id: 42, slug: 'the-band', band_name: 'The Band', accounting_country: 'nl', archived_at: null },
    ])
    requestClaim.mockRejectedValue(new Error('claim_pending_elsewhere'))
    const user = userEvent.setup()
    wrap()

    await completeWelcomeStep(user, 'Bronze')
    await user.type(await screen.findByLabelText('Search for your band'), 'Off Platform')
    await user.click(await screen.findByRole('button', { name: /Off Platform/ }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: /create|finish|start/i }))

    await waitFor(() => expect(onboardingComplete).toHaveBeenCalled())
  })
})
