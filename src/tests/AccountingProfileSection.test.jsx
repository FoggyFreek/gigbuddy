import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/accountingProfile.ts', () => ({
  getAccountingProfile: vi.fn(),
  updateAccountingProfile: vi.fn(),
  confirmAccountingProfile: vi.fn(),
}))
// The default VAT rate and the small-business flag still live on the tenant row, so
// the section reads and writes them through the band-profile endpoint.
vi.mock('../api/profile.ts', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}))
// The scheme editor renders inside this section; its own behaviour is covered by
// VatSchemeEnrolments.test.jsx, so here it only needs to not hit the network.
vi.mock('../api/taxSchemes.ts', () => ({
  listTaxSchemeEnrolments: vi.fn(),
  startTaxSchemeEnrolment: vi.fn(),
  updateTaxSchemeEnrolment: vi.fn(),
  voidTaxSchemeEnrolment: vi.fn(),
  deleteTaxSchemeEnrolment: vi.fn(),
}))

import * as profileApi from '../api/accountingProfile.ts'
import * as bandProfileApi from '../api/profile.ts'
import * as schemeApi from '../api/taxSchemes.ts'
import AccountingProfileSection from '../components/settings/AccountingProfileSection.tsx'
import { AccountingProfileContext } from '../contexts/accountingProfileContext.ts'
import theme from '../theme.ts'

const BASE_PROFILE = {
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
  current_sales_treatment: null,
}

// The section reads from the context and writes through the api, so the test
// supplies the context directly rather than mounting the real provider (which
// would also need auth).
function wrap(overrides = {}, applyProfile = vi.fn()) {
  const value = {
    profile: { ...BASE_PROFILE, ...overrides },
    loading: false,
    applyProfile,
  }
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <AccountingProfileContext.Provider value={value}>
          <AccountingProfileSection />
        </AccountingProfileContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  bandProfileApi.getProfile.mockResolvedValue({ tax_percentage: 21 })
  schemeApi.listTaxSchemeEnrolments.mockResolvedValue([])
  bandProfileApi.updateProfile.mockResolvedValue({})
  profileApi.updateAccountingProfile.mockImplementation(async (patch) => ({ ...BASE_PROFILE, ...patch }))
  profileApi.confirmAccountingProfile.mockResolvedValue({
    ...BASE_PROFILE, profile_status: 'complete', presentation_state: 'complete', reviewed_at: '2026-07-30T00:00:00Z',
  })
})

describe('AccountingProfileSection', () => {
  it('shows the country and base currency as read-only facts', async () => {
    wrap()
    const country = await screen.findByLabelText('Accounting country')
    expect(country).toHaveValue('Netherlands (NL)')
    expect(country).toBeDisabled()

    const currency = screen.getByLabelText('Base currency')
    expect(currency).toHaveValue('EUR')
    expect(currency).toBeDisabled()
  })

  it('warns that a non-euro base currency is recorded but not yet applied', async () => {
    wrap({ country_code: 'gb', base_currency: 'GBP' })
    expect(await screen.findByText(/Multi-currency bookkeeping is not available yet/i)).toBeInTheDocument()
  })

  it('does not warn for a euro tenant', async () => {
    wrap()
    await screen.findByLabelText('Accounting country')
    expect(screen.queryByText(/Multi-currency bookkeeping is not available yet/i)).not.toBeInTheDocument()
  })

  it('disables the filing period until registration is confirmed', async () => {
    wrap()
    await screen.findByLabelText('Accounting country')
    expect(screen.getByLabelText('VAT filing frequency')).toHaveAttribute('aria-disabled', 'true')
  })

  it('enables the filing period once the tenant is registered', async () => {
    wrap({ vat_registered: true })
    await screen.findByLabelText('Accounting country')
    expect(screen.getByLabelText('VAT filing frequency')).not.toHaveAttribute('aria-disabled', 'true')
  })

  // Entity size, the accounting basis, the VAT basis and the reporting framework
  // are derived or product facts. Asking a band about them would invite an answer
  // the software does not honour, so they are recorded but never rendered.
  it('does not ask about the derived or product-fact fields', async () => {
    wrap({ vat_registered: true })
    await screen.findByLabelText('Accounting country')
    for (const label of ['Entity size', 'Accounting basis', 'VAT basis', 'Reporting framework']) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    }
  })

  it('sends a tri-state vat_registered rather than a boolean for "not confirmed"', async () => {
    const user = userEvent.setup()
    wrap({ vat_registered: true })

    await user.click(await screen.findByLabelText('Registered for VAT'))
    await user.click(await screen.findByRole('option', { name: 'Not yet confirmed' }))

    await waitFor(() => expect(profileApi.updateAccountingProfile)
      .toHaveBeenCalledWith({ vat_registered: null }))
  })

  it('only offers financial-year start days that exist in the chosen month', async () => {
    const user = userEvent.setup()
    wrap({ financial_year_start_month: 2, financial_year_start_day: 1 })

    await user.click(await screen.findByLabelText('Day'))
    expect(await screen.findByRole('option', { name: '28' })).toBeInTheDocument()
    // February must not offer the 29th: a financial year has to start on a date
    // that exists in every year.
    expect(screen.queryByRole('option', { name: '29' })).not.toBeInTheDocument()
  })

  it('offers a confirmation when the values were inherited and are complete', async () => {
    const applyProfile = vi.fn()
    const user = userEvent.setup()
    wrap({ profile_status: 'complete', presentation_state: 'needs_review', profile_source: 'legacy_backfill' }, applyProfile)

    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(profileApi.confirmAccountingProfile).toHaveBeenCalled())
    await waitFor(() => expect(applyProfile).toHaveBeenCalled())
  })

  it('shows no confirmation prompt once the profile is confirmed', async () => {
    wrap({ profile_status: 'complete', presentation_state: 'complete', reviewed_at: '2026-07-30T00:00:00Z' })
    await screen.findByLabelText('Accounting country')
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  })

  // The legal form belongs to the financial profile now; this section must not
  // offer it, or the two would edit the same field.
  it('does not ask for the legal form', async () => {
    wrap()
    await screen.findByLabelText('Accounting country')
    expect(screen.queryByLabelText('Legal form')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/legal form note/i)).not.toBeInTheDocument()
  })

  it('shows the invoice VAT defaults from the band profile', async () => {
    wrap()
    expect(await screen.findByLabelText(/default vat rate/i)).toHaveValue(21)
  })

  it('saves a changed default VAT rate', async () => {
    const user = userEvent.setup()
    wrap()

    const rate = await screen.findByLabelText(/default vat rate/i)
    await user.clear(rate)
    await user.type(rate, '9')

    await waitFor(
      () => expect(bandProfileApi.updateProfile).toHaveBeenCalledWith({ tax_percentage: 9 }),
      { timeout: 2000 },
    )
  })

  // One control for one fact: the small-business scheme is the filing period's
  // "exempt" answer, not a second toggle that could disagree with it.
  it('has no separate small-business toggle', async () => {
    wrap()
    await screen.findByLabelText('Accounting country')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/small-business scheme/i)).not.toBeInTheDocument()
  })

  // 'exempt' is no longer a period a band picks: it is derived from a scheme
  // enrolment, which carries dates and a jurisdiction this select cannot express.
  it('does not offer exempt as a filing period', async () => {
    const user = userEvent.setup()
    wrap({ vat_registered: true })

    await user.click(await screen.findByLabelText('VAT filing frequency'))
    expect(screen.queryByRole('option', { name: /exempt/i })).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Quarterly' })).toBeInTheDocument()
  })

  it('locks the filing period and points at the scheme while one is in force', async () => {
    wrap({ vat_registered: true, vat_filing_frequency: 'exempt' })
    const field = await screen.findByLabelText('VAT filing frequency')
    expect(field).toHaveAttribute('aria-disabled', 'true')
    expect(await screen.findByText(/End the scheme below to choose a filing period/i))
      .toBeInTheDocument()
  })

  it('surfaces a known backend error code as its translated message', async () => {
    profileApi.updateAccountingProfile.mockRejectedValue(
      Object.assign(new Error('nope'), { code: 'vat_fields_require_registration' }),
    )
    const user = userEvent.setup()
    wrap({ vat_registered: true })

    await user.click(await screen.findByLabelText('VAT filing frequency'))
    await user.click(await screen.findByRole('option', { name: 'Quarterly' }))

    expect(await screen.findByText(/before choosing a VAT basis or filing frequency/i)).toBeInTheDocument()
  })
})
