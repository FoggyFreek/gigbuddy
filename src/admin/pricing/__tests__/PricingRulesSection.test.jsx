import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../adminPricingRules.ts', () => ({
  listPricingRules: vi.fn(),
  createPricingRule: vi.fn(),
  createPricingRuleVersion: vi.fn(),
  renamePricingRule: vi.fn(),
  retirePricingRule: vi.fn(),
}))

import * as api from '../adminPricingRules.ts'
import PricingRulesSection from '../PricingRulesSection.tsx'
import { formatEur } from '../../../finance/invoices/invoiceTotals.ts'
import theme from '../../../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const BUNDLE_V2 = {
  id: 2, code: 'dual_module_bundle', version: 2, name: 'Dual module bundle',
  discount_type: 'percentage', percent: '10.00', amount_cents: null,
  combinable: false, is_active: true, effective_from: null, effective_to: null,
  required_audiences: ['band', 'artist'], min_module_count: 2,
  billing_intervals: ['month', 'year'], priority: 0,
}

const BUNDLE_V1 = { ...BUNDLE_V2, id: 1, version: 1, percent: '15.00', is_active: false }

const PROMO = {
  id: 3, code: 'apr_2027_marketing', version: 1, name: 'April campaign',
  discount_type: 'fixed', percent: null, amount_cents: 500,
  combinable: true, is_active: true,
  effective_from: '2027-04-01T00:00:00.000Z', effective_to: '2027-05-01T00:00:00.000Z',
  required_audiences: [], min_module_count: 1, billing_intervals: ['year'], priority: 5,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listPricingRules.mockResolvedValue([BUNDLE_V2, BUNDLE_V1, PROMO])
})

function rowFor(code, version) {
  const cells = screen.getAllByText(code)
  const row = cells
    .map((el) => el.closest('tr'))
    .find((tr) => within(tr).queryByText(String(version)) !== null)
  return row
}

describe('PricingRulesSection', () => {
  it('lists every version and marks the retired ones', async () => {
    wrap(<PricingRulesSection />)
    await screen.findAllByText('dual_module_bundle')

    expect(within(rowFor('dual_module_bundle', 2)).getByText('10%')).toBeInTheDocument()
    expect(within(rowFor('dual_module_bundle', 1)).getByText('retired')).toBeInTheDocument()
    // A retired version offers no actions — its terms are frozen.
    expect(within(rowFor('dual_module_bundle', 1)).queryByRole('button', { name: 'New version' })).toBeNull()
  })

  it('describes the discount, conditions and window of each rule', async () => {
    wrap(<PricingRulesSection />)
    await screen.findByText('apr_2027_marketing')

    const promo = rowFor('apr_2027_marketing', 1)
    // formatEur takes cents (a fixed rule shows its own amount, not a hundredth
    // of it) and separates symbol from digits with a non-breaking space, which
    // this collapses on both sides just like Testing Library would.
    const norm = (s) => s.replace(/\s+/g, ' ')
    expect(norm(promo.textContent)).toContain(norm(formatEur(500)))
    expect(within(promo).getByText(/year only/)).toBeInTheDocument()
    expect(within(promo).getByText(/combinable/)).toBeInTheDocument()
    expect(within(promo).getByText('2027-04-01 → 2027-05-01')).toBeInTheDocument()

    const bundle = rowFor('dual_module_bundle', 2)
    expect(within(bundle).getByText(/2\+ modules/)).toBeInTheDocument()
    expect(within(bundle).getByText(/needs band \+ artist/)).toBeInTheDocument()
    expect(within(bundle).getByText('Always')).toBeInTheDocument()
  })

  it('creates a new rule', async () => {
    api.createPricingRule.mockResolvedValue(PROMO)
    const user = userEvent.setup()
    wrap(<PricingRulesSection />)
    await screen.findAllByText('dual_module_bundle')

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await user.type(screen.getByLabelText('Code'), 'summer_2027')
    await user.type(screen.getByLabelText('Name'), 'Summer deal')
    await user.type(screen.getByLabelText('Percent'), '20')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.createPricingRule).toHaveBeenCalled())
    expect(api.createPricingRule.mock.calls[0][0]).toMatchObject({
      code: 'summer_2027', name: 'Summer deal', discount_type: 'percentage',
      percent: 20, amount_cents: null, min_module_count: 1, priority: 0,
      billing_intervals: ['month', 'year'],
    })
  })

  it('supersedes a live rule, carrying its conditions into the new version', async () => {
    api.createPricingRuleVersion.mockResolvedValue({ ...BUNDLE_V2, id: 4, version: 3 })
    const user = userEvent.setup()
    wrap(<PricingRulesSection />)
    await screen.findAllByText('dual_module_bundle')

    await user.click(within(rowFor('dual_module_bundle', 2)).getByRole('button', { name: 'New version' }))
    expect(screen.getByLabelText('Code')).toBeDisabled()

    const percent = screen.getByLabelText('Percent')
    await user.clear(percent)
    await user.type(percent, '12.5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.createPricingRuleVersion).toHaveBeenCalled())
    const [id, terms] = api.createPricingRuleVersion.mock.calls[0]
    expect(id).toBe(2)
    expect(terms).toMatchObject({
      percent: 12.5,
      // Conditions survive the bump — silently resetting them would change who
      // the discount applies to.
      required_audiences: ['band', 'artist'],
      min_module_count: 2,
    })
    expect(terms).not.toHaveProperty('code')
  })

  it('rejects an out-of-range percentage before calling the API', async () => {
    const user = userEvent.setup()
    wrap(<PricingRulesSection />)
    await screen.findAllByText('dual_module_bundle')

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await user.type(screen.getByLabelText('Code'), 'bad_rule')
    await user.type(screen.getByLabelText('Name'), 'Bad')
    await user.type(screen.getByLabelText('Percent'), '150')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.createPricingRule).not.toHaveBeenCalled()
  })

  it('retires a rule after confirmation', async () => {
    api.retirePricingRule.mockResolvedValue({ ...BUNDLE_V2, is_active: false })
    const user = userEvent.setup()
    wrap(<PricingRulesSection />)
    await screen.findAllByText('dual_module_bundle')

    await user.click(within(rowFor('dual_module_bundle', 2)).getByRole('button', { name: 'Retire' }))
    await user.click(screen.getByRole('button', { name: 'Retire', hidden: false }))

    await waitFor(() => expect(api.retirePricingRule).toHaveBeenCalledWith(2))
  })

  it('explains the empty state', async () => {
    api.listPricingRules.mockResolvedValue([])
    wrap(<PricingRulesSection />)
    expect(await screen.findByText(/No pricing rules yet/)).toBeInTheDocument()
  })
})
