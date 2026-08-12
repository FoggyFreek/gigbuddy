import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../taxSchemesApi.ts', () => ({
  listTaxSchemeEnrolments: vi.fn(),
  startTaxSchemeEnrolment: vi.fn(),
  updateTaxSchemeEnrolment: vi.fn(),
  voidTaxSchemeEnrolment: vi.fn(),
  deleteTaxSchemeEnrolment: vi.fn(),
}))
vi.mock('../../accounting-profile/accountingProfile.ts', () => ({
  getAccountingProfile: vi.fn(),
}))

import * as schemeApi from '../taxSchemesApi.ts'
import * as profileApi from '../../accounting-profile/accountingProfile.ts'
import VatSchemeEnrolments from '../../../people/workspaces/components/settings/VatSchemeEnrolments.tsx'
import { AccountingProfileContext } from '../../../contexts/accountingProfileContext.ts'
import { formatShortDate } from '../../../utils/dateFormat.ts'
import theme from '../../../theme.ts'

const PROFILE = {
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
  vat_registered: true,
  vat_filing_frequency: 'unconfigured',
  pack_version: null,
  current_sales_treatment: null,
}

function enrolment(overrides = {}) {
  return {
    id: 1,
    tenant_id: 1,
    country_code: 'nl',
    scheme_code: 'nl_kor',
    scheme_scope: 'national_home',
    valid_from: '2025-01-01',
    valid_to: null,
    status: 'confirmed',
    source_confirmation_date: null,
    voided_at: null,
    void_reason: null,
    scheme_label: 'Kleineondernemersregeling (KOR)',
    scheme_implemented: true,
    scheme_sales_treatment: 'small_business_exempt',
    ...overrides,
  }
}

function wrap(profile = PROFILE, applyProfile = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <AccountingProfileContext.Provider value={{ profile, loading: false, applyProfile }}>
        <VatSchemeEnrolments />
      </AccountingProfileContext.Provider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  schemeApi.listTaxSchemeEnrolments.mockResolvedValue([])
  profileApi.getAccountingProfile.mockResolvedValue(PROFILE)
})

describe('VatSchemeEnrolments', () => {
  it('says plainly that no scheme is recorded', async () => {
    wrap()
    expect(await screen.findByText(/charges and files VAT normally/i)).toBeInTheDocument()
  })

  it('lists an enrolment with its inclusive period', async () => {
    schemeApi.listTaxSchemeEnrolments.mockResolvedValue([
      enrolment({ valid_to: '2025-12-31' }),
    ])
    wrap()
    expect(await screen.findByText('Kleineondernemersregeling (KOR)')).toBeInTheDocument()
    // Both ends are shown: the last day is part of the period, so a user can
    // check it against the authority's letter.
    // Formatted through the shared helper: the assertion is that BOTH ends are
    // shown, not what the locale renders them as.
    expect(screen.getByText(formatShortDate('2025-01-01', 'en'))).toBeInTheDocument()
    expect(screen.getByText(formatShortDate('2025-12-31', 'en'))).toBeInTheDocument()
  })

  it('flags a migration-inferred start date as needing confirmation', async () => {
    schemeApi.listTaxSchemeEnrolments.mockResolvedValue([enrolment({ status: 'legacy_inferred' })])
    wrap()
    expect(await screen.findByText('Start date not confirmed')).toBeInTheDocument()
  })

  it('marks a destination enrolment as such and never as the home regime', async () => {
    schemeApi.listTaxSchemeEnrolments.mockResolvedValue([
      enrolment({
        scheme_code: 'eu_sme',
        scheme_scope: 'eu_sme_destination',
        country_code: 'be',
        scheme_implemented: false,
        scheme_label: 'EU SME scheme (Directive (EU) 2020/285)',
      }),
    ])
    wrap()
    expect(await screen.findByText('Destination: BE')).toBeInTheDocument()
    expect(screen.getByText('Recorded only')).toBeInTheDocument()
  })

  it('shows a retracted enrolment rather than hiding it, with no actions', async () => {
    schemeApi.listTaxSchemeEnrolments.mockResolvedValue([
      enrolment({ voided_at: '2026-01-05T10:00:00Z', void_reason: 'never enrolled' }),
    ])
    wrap()
    // The row is the evidence explaining any invoice issued under it, so it stays.
    expect(await screen.findByText('Retracted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retract' })).not.toBeInTheDocument()
  })

  it('starts a scheme and republishes the profile the filing period derives from', async () => {
    const applyProfile = vi.fn()
    schemeApi.startTaxSchemeEnrolment.mockResolvedValue(enrolment())
    schemeApi.listTaxSchemeEnrolments.mockResolvedValue([])
    const user = userEvent.setup()
    wrap(PROFILE, applyProfile)

    await user.click(await screen.findByRole('button', { name: /Start a scheme/i }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('First day'))
    await user.type(within(dialog).getByLabelText('First day'), '2025-01-01')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(schemeApi.startTaxSchemeEnrolment).toHaveBeenCalledWith({
      scheme_code: 'nl_kor',
      country_code: 'nl',
      valid_from: '2025-01-01',
      valid_to: null,
      source_confirmation_date: null,
    }))
    // Starting a scheme flips the derived filing period, so the shared profile
    // must be refreshed or the section above would show a stale answer.
    await waitFor(() => expect(applyProfile).toHaveBeenCalled())
  })

  it('warns when the chosen scheme is recorded but changes nothing', async () => {
    const user = userEvent.setup()
    wrap({ ...PROFILE, country_code: 'de' })

    await user.click(await screen.findByRole('button', { name: /Start a scheme/i }))
    expect(await screen.findByText(/only implemented for the Dutch KOR/i)).toBeInTheDocument()
  })

  it('states that issued invoices are unaffected, so correcting dates is safe', async () => {
    const user = userEvent.setup()
    wrap()
    await user.click(await screen.findByRole('button', { name: /Start a scheme/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/so correcting these dates is safe/i)).toBeInTheDocument()
  })

  it('refuses to submit a last day before the first day', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: /Start a scheme/i }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('First day'))
    await user.type(within(dialog).getByLabelText('First day'), '2025-06-01')
    await user.type(within(dialog).getByLabelText('Last day'), '2025-05-31')

    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(schemeApi.startTaxSchemeEnrolment).not.toHaveBeenCalled()
  })

  it('locks the scheme when editing — a different scheme is a different enrolment', async () => {
    schemeApi.listTaxSchemeEnrolments.mockResolvedValue([enrolment({ status: 'legacy_inferred' })])
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Scheme')).toHaveAttribute('aria-disabled', 'true')
  })

  it('retracts rather than deletes, and surfaces a refusal', async () => {
    schemeApi.listTaxSchemeEnrolments.mockResolvedValue([enrolment()])
    schemeApi.voidTaxSchemeEnrolment.mockRejectedValue(
      Object.assign(new Error('nope'), { code: 'enrolment_referenced' }),
    )
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Retract' }))
    expect(schemeApi.deleteTaxSchemeEnrolment).not.toHaveBeenCalled()
    expect(await screen.findByText(/Invoices or bills were issued during this period/i))
      .toBeInTheDocument()
  })
})
