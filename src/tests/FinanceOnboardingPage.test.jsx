import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import FinanceOnboardingPage from '../pages/FinanceOnboardingPage.tsx'
import { getFinanceOnboardingStatus, setOpeningBalance } from '../api/financeOnboarding.ts'
import { getProfile, updateProfile, getMollieKey, getShopifySecret, getShopifyDomain, getShopifyClientId } from '../api/profile.ts'
import { listAccounts, getAccountingSettings } from '../api/accounts.ts'

vi.mock('../api/financeOnboarding.ts', () => ({
  getFinanceOnboardingStatus: vi.fn(),
  setOpeningBalance: vi.fn(),
}))
vi.mock('../api/profile.ts', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  // Read by the reused Mollie/Shopify integration cards on the integrations step.
  // The cards hand the whole get/set/clear trio to SecretKeySection while
  // rendering, so the writers must exist even though these tests never save.
  getMollieKey: vi.fn(),
  setMollieKey: vi.fn(),
  clearMollieKey: vi.fn(),
  getShopifySecret: vi.fn(),
  setShopifySecret: vi.fn(),
  clearShopifySecret: vi.fn(),
  getShopifyDomain: vi.fn(),
  setShopifyDomain: vi.fn(),
  getShopifyClientId: vi.fn(),
  setShopifyClientId: vi.fn(),
  clearShopifyClientId: vi.fn(),
}))
vi.mock('../api/accounts.ts', () => ({
  listAccounts: vi.fn(),
  getAccountingSettings: vi.fn(),
  updateAccountingSettings: vi.fn(),
}))
vi.mock('../api/accountingProfile.ts', () => ({
  getAccountingProfile: vi.fn(),
  updateAccountingProfile: vi.fn(),
  confirmAccountingProfile: vi.fn(),
}))
// The reused AccountingProfileSection reads the profile from its context rather
// than fetching per-render, so the context is what the step needs stubbed.
vi.mock('../contexts/accountingProfileContext.ts', () => ({
  useAccountingProfile: () => ({
    profile: {
      tenant_id: 1,
      country_code: 'nl',
      base_currency: 'EUR',
      profile_status: 'incomplete',
      profile_source: 'tenant_creation',
      presentation_state: 'incomplete',
      reviewed_at: null,
      reviewed_by_user_id: null,
      legal_form: null,
      local_legal_form_code: null,
      local_legal_form_label: null,
      entity_size: 'micro',
      financial_accounting_basis: 'accrual',
      vat_accounting_basis: 'unknown',
      reporting_framework_code: null,
      financial_year_start_month: 1,
      financial_year_start_day: 1,
      vat_registered: null,
      vat_filing_frequency: 'unconfigured',
      pack_version: null,
    },
    loading: false,
    applyProfile: vi.fn(),
  }),
}))

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getFinanceOnboardingStatus.mockResolvedValue({ openingBalanceSet: false })
  getProfile.mockResolvedValue({})
  updateProfile.mockResolvedValue({})
  listAccounts.mockResolvedValue([])
  getAccountingSettings.mockResolvedValue({ currency: 'EUR' })
  setOpeningBalance.mockResolvedValue({ posted: true, transactionId: 1 })
  getMollieKey.mockResolvedValue({ isSet: false, changedAt: null })
  getShopifySecret.mockResolvedValue({ isSet: false, changedAt: null })
  getShopifyDomain.mockResolvedValue({ domain: null })
  getShopifyClientId.mockResolvedValue({ clientId: null })
})

// The accounting-profile step saves each field as it is chosen, so there is
// nothing to commit — advancing is enough. Asserting its heading here is what
// keeps the step itself covered.
async function advancePastAccountingProfile(user) {
  // Queried by a field only the section renders — the step label in the stepper
  // carries the same title text.
  expect(await screen.findByLabelText('Accounting country')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Next' }))
}

// The financial profile follows it and owns the invoice identity. Asserting a field
// unique to each step is what proves the two do not overlap.
async function advancePastFinancialProfile(user) {
  expect(await screen.findByLabelText(/legal name|formal name/i)).toBeInTheDocument()
  // The regime questions belong to the previous step only.
  expect(screen.queryByLabelText('Accounting country')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Next' }))
}

describe('FinanceOnboardingPage', () => {
  it('posts a manual opening balance (parsed to signed cents) on advancing', async () => {
    wrap(<FinanceOnboardingPage />)
    const user = userEvent.setup()

    // Welcome → accounting profile → opening balance.
    expect(await screen.findByText('Set up your finances')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await advancePastAccountingProfile(user)
    await advancePastFinancialProfile(user)

    expect(await screen.findByText('Tell gigBuddy how much was in your bank account when you start keeping books here.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Bank balance'), '1.250,50')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(setOpeningBalance).toHaveBeenCalledTimes(1))
    const arg = setOpeningBalance.mock.calls[0][0]
    expect(arg.amountCents).toBe(125050)
    expect(arg.entryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('skips posting when the user chooses to set it later', async () => {
    wrap(<FinanceOnboardingPage />)
    const user = userEvent.setup()
    await screen.findByText('Set up your finances')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await advancePastAccountingProfile(user)
    await advancePastFinancialProfile(user)

    await user.click(await screen.findByRole('radio', { name: 'Set it later from a bank statement' }))
    // The action button becomes a skip; advancing must not post.
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(await screen.findByText('Connect Mollie and Shopify')).toBeInTheDocument()
    expect(setOpeningBalance).not.toHaveBeenCalled()
  })

  it('shows the already-set notice and does not re-post when a balance exists', async () => {
    getFinanceOnboardingStatus.mockResolvedValue({ openingBalanceSet: true })
    wrap(<FinanceOnboardingPage />)
    const user = userEvent.setup()
    await screen.findByText('Set up your finances')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await advancePastAccountingProfile(user)
    await advancePastFinancialProfile(user)

    expect(await screen.findByText('An opening balance is already set for this band.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Connect Mollie and Shopify')).toBeInTheDocument()
    expect(setOpeningBalance).not.toHaveBeenCalled()
  })

  it('shows the Mollie and Shopify integration options on the integrations step', async () => {
    wrap(<FinanceOnboardingPage />)
    const user = userEvent.setup()
    await screen.findByText('Set up your finances')

    // welcome → accounting profile → financial profile → opening balance (skip) → integrations
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await advancePastAccountingProfile(user)
    await advancePastFinancialProfile(user)
    await user.click(await screen.findByRole('radio', { name: 'Set it later from a bank statement' }))
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(await screen.findByText('Connect Mollie and Shopify')).toBeInTheDocument()
    expect(screen.getByAltText('Mollie')).toBeInTheDocument()
    expect(screen.getByAltText('Shopify')).toBeInTheDocument()
  })
})
