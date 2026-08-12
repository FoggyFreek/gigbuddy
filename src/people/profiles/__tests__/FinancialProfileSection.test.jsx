import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../profile.ts', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}))
vi.mock('../../../finance/accounting-profile/accountingProfile.ts', () => ({
  getAccountingProfile: vi.fn(),
  updateAccountingProfile: vi.fn(),
  confirmAccountingProfile: vi.fn(),
}))

import * as profileApi from '../profile.ts'
import * as accountingApi from '../../../finance/accounting-profile/accountingProfile.ts'
import FinancialProfileSection from '../../workspaces/components/settings/FinancialProfileSection.tsx'
import { AccountingProfileContext } from '../../../contexts/accountingProfileContext.ts'
import theme from '../../../theme.ts'

const ACCOUNTING = {
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
}

const PROFILE = {
  formal_name: 'The Testers VOF',
  address_street: 'Teststraat 1',
  address_postal_code: '1000 AA',
  address_city: 'Amsterdam',
  address_country: 'Netherlands',
  kvk_number: '',
  registration_office: '',
  directors: 'Anna Mulder',
  email: 'bookings@testers.example',
  phone: '+31 6 1234 5678',
  iban: 'NL91ABNA0417164300',
  tax_id: 'NL123456789B01',
}

function wrap(accountingOverrides = {}, applyProfile = vi.fn()) {
  const value = {
    profile: { ...ACCOUNTING, ...accountingOverrides },
    loading: false,
    applyProfile,
  }
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <AccountingProfileContext.Provider value={value}>
          <FinancialProfileSection />
        </AccountingProfileContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  profileApi.getProfile.mockResolvedValue({ ...PROFILE })
  profileApi.updateProfile.mockResolvedValue({ ...PROFILE })
  accountingApi.updateAccountingProfile.mockImplementation(async (patch) => ({ ...ACCOUNTING, ...patch }))
})

describe('FinancialProfileSection', () => {
  it('loads the identity fields from the band profile', async () => {
    wrap()
    expect(await screen.findByLabelText(/legal name|formal name/i)).toHaveValue('The Testers VOF')
    expect(screen.getByLabelText(/business email/i)).toHaveValue('bookings@testers.example')
    expect(screen.getByLabelText(/iban/i)).toHaveValue('NL91ABNA0417164300')
  })

  it('labels the register field for the accounting country and auto-saves it', async () => {
    const user = userEvent.setup()
    wrap()

    // A Dutch band's register field is the KvK-nummer.
    const kvk = await screen.findByLabelText(/kvk-nummer/i)
    await user.type(kvk, '12345678')

    await waitFor(
      () => expect(profileApi.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ kvk_number: '12345678' }),
      ),
      { timeout: 2000 },
    )
  })

  it('uses the German register label and office field for a German band', async () => {
    wrap({ country_code: 'de' })
    expect(await screen.findByLabelText(/handelsregisternummer/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/registergericht/i)).toBeInTheDocument()
  })

  it('shows no register field where the tax number is the registration', async () => {
    // Belgium: the enterprise number IS the identifier, so there is nothing to ask.
    wrap({ country_code: 'be' })
    await screen.findByLabelText(/business email/i)
    expect(screen.queryByLabelText(/kvk-nummer/i)).not.toBeInTheDocument()
    expect(await screen.findByText(/uses the VAT number as the registration/i)).toBeInTheDocument()
  })

  it('offers only the local legal forms of the accounting country', async () => {
    const user = userEvent.setup()
    wrap()
    await user.click(await screen.findByLabelText('Legal form'))

    expect(await screen.findByRole('option', { name: 'BV' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VOF' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'GmbH' })).not.toBeInTheDocument()
  })

  it('saves the legal form as the code alone, leaving the derivations to the server', async () => {
    const applyProfile = vi.fn()
    const user = userEvent.setup()
    wrap({}, applyProfile)

    await user.click(await screen.findByLabelText('Legal form'))
    await user.click(await screen.findByRole('option', { name: 'BV' }))

    await waitFor(() => expect(accountingApi.updateAccountingProfile)
      .toHaveBeenCalledWith({ local_legal_form_code: 'nl_bv' }))
    await waitFor(() => expect(applyProfile).toHaveBeenCalled())
  })

  it('debounces the legal-form note onto the accounting profile', async () => {
    const user = userEvent.setup()
    wrap()

    await user.type(await screen.findByLabelText(/legal form note/i), 'Maatschap variant')

    await waitFor(
      () => expect(accountingApi.updateAccountingProfile).toHaveBeenCalledWith(
        expect.objectContaining({ local_legal_form_label: 'Maatschap variant' }),
      ),
      { timeout: 2000 },
    )
  })

  // The company-law director disclosure only applies to incorporated forms, so it
  // must not appear for a sole trader or a partnership.
  it('asks for directors only when the legal form is incorporated', async () => {
    wrap({ legal_form: 'company', local_legal_form_code: 'nl_bv' })
    expect(await screen.findByLabelText(/managing director/i)).toBeInTheDocument()
  })

  it('hides directors for an unincorporated legal form', async () => {
    wrap({ legal_form: 'partnership', local_legal_form_code: 'nl_vof' })
    await screen.findByLabelText(/business email/i)
    expect(screen.queryByLabelText(/managing director/i)).not.toBeInTheDocument()
  })

  // The regime belongs to the accounting-profile section; nothing here may edit it.
  it('does not touch any accounting-regime field', async () => {
    wrap()
    await screen.findByLabelText(/business email/i)
    for (const label of [
      /accounting country/i, /base currency/i, /financial year/i,
      /registered for vat/i, /vat filing frequency/i, /default vat rate/i,
    ]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    }
  })

  it('surfaces a rejected identifier as its translated message', async () => {
    profileApi.updateProfile.mockRejectedValue(
      Object.assign(new Error('nope'), { code: 'invalid_tax_id' }),
    )
    const user = userEvent.setup()
    wrap()

    // The seeded VAT number is already at the 14-character cap, so it has to be
    // cleared before typing can register a change.
    const taxId = await screen.findByLabelText(/tax id/i)
    await user.clear(taxId)
    await user.type(taxId, 'NL1')

    await waitFor(
      () => expect(screen.getByText(/VAT number does not match/i)).toBeInTheDocument(),
      { timeout: 2000 },
    )
  })
})
