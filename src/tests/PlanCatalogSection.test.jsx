import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/adminSubscriptions.ts', () => ({
  createAdminPlan: vi.fn(),
  updateAdminPlan: vi.fn(),
  deleteAdminPlan: vi.fn(),
}))

import * as api from '../api/adminSubscriptions.ts'
import PlanCatalogSection from '../components/admin/PlanCatalogSection.tsx'
import { formatEur } from '../utils/invoiceTotals.ts'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const entitlements = (features = {}, limits = {}) => ({
  features: {
    finance: false, integrations: false, customization: false,
    song_files: false, chordpro: false, public_promotion: false, linkpage: false,
    ...features,
  },
  limits: {
    storage_mb: null, members: null, bands: null,
    linkpage_pages: null, linkpage_stats_days: null,
    ...limits,
  },
})

const PLANS = [
  {
    id: 1, slug: 'bronze', name: 'Bronze',
    monthly_price_cents: 0, yearly_price_cents: 0,
    entitlements: entitlements({}, { storage_mb: 50, members: 5, bands: 1 }),
    is_active: true, is_fallback: true, sort_order: 0,
  },
  {
    id: 2, slug: 'silver', name: 'Silver',
    monthly_price_cents: null, yearly_price_cents: null,
    entitlements: entitlements({ integrations: true }, { storage_mb: 150, bands: 3 }),
    is_active: true, is_fallback: false, sort_order: 1,
  },
  {
    id: 3, slug: 'gold', name: 'Gold',
    monthly_price_cents: 1500, yearly_price_cents: 15000,
    entitlements: entitlements(
      { finance: true, integrations: true, customization: true, song_files: true, chordpro: true, public_promotion: true },
      { storage_mb: 500 },
    ),
    is_active: true, is_fallback: false, sort_order: 2,
  },
]

const onChanged = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  api.createAdminPlan.mockResolvedValue(PLANS[2])
  api.updateAdminPlan.mockResolvedValue(PLANS[0])
  api.deleteAdminPlan.mockResolvedValue(null)
})

describe('PlanCatalogSection — table', () => {
  it('renders one row per plan with prices, fallback marker, and an em dash for unpriced intervals', () => {
    wrap(<PlanCatalogSection plans={PLANS} onChanged={onChanged} />)

    expect(screen.getByText('Bronze')).toBeInTheDocument()
    expect(screen.getByText('Silver')).toBeInTheDocument()
    expect(screen.getByText('Gold')).toBeInTheDocument()
    expect(screen.getByText('fallback')).toBeInTheDocument()

    // formatEur uses a non-breaking space between symbol and digits — normalize both sides.
    const norm = (s) => s.replace(/\u00A0/g, ' ')
    const goldRow = screen.getByText('Gold').closest('tr')
    expect(norm(goldRow.textContent)).toContain(norm(formatEur(1500)))
    expect(norm(goldRow.textContent)).toContain(norm(formatEur(15000)))

    const silverRow = screen.getByText('Silver').closest('tr')
    expect(within(silverRow).getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('hides the delete action for the fallback plan', () => {
    wrap(<PlanCatalogSection plans={PLANS} onChanged={onChanged} />)
    const bronzeRow = screen.getByText('Bronze').closest('tr')
    const goldRow = screen.getByText('Gold').closest('tr')
    expect(within(bronzeRow).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(within(goldRow).getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })
})

describe('PlanCatalogSection — create', () => {
  it('creates a plan with prices converted to cents and complete entitlements', async () => {
    const user = userEvent.setup()
    wrap(<PlanCatalogSection plans={PLANS} onChanged={onChanged} />)

    await user.click(screen.getByRole('button', { name: /new plan/i }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText(/name/i), 'Platinum')
    await user.type(within(dialog).getByLabelText(/slug/i), 'platinum')
    await user.type(within(dialog).getByLabelText(/monthly price/i), '19.99')
    // yearly left blank → null (interval unavailable)
    await user.click(within(dialog).getByLabelText('Finance'))
    await user.type(within(dialog).getByLabelText(/storage/i), '1000')

    await user.click(within(dialog).getByRole('button', { name: /save/i }))

    await waitFor(() => expect(api.createAdminPlan).toHaveBeenCalledTimes(1))
    expect(api.createAdminPlan).toHaveBeenCalledWith({
      slug: 'platinum',
      name: 'Platinum',
      monthly_price_cents: 1999,
      yearly_price_cents: null,
      is_active: true,
      sort_order: 0,
      entitlements: entitlements({ finance: true }, { storage_mb: 1000 }),
    })
    expect(onChanged).toHaveBeenCalled()
  })
})

describe('PlanCatalogSection — edit', () => {
  it('locks identity, pricing, and active fields for the fallback plan and only sends entitlements + sort order', async () => {
    const user = userEvent.setup()
    wrap(<PlanCatalogSection plans={PLANS} onChanged={onChanged} />)

    const bronzeRow = screen.getByText('Bronze').closest('tr')
    await user.click(within(bronzeRow).getByRole('button', { name: /edit/i }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByLabelText(/name/i)).toBeDisabled()
    expect(within(dialog).getByLabelText(/slug/i)).toBeDisabled()
    expect(within(dialog).getByLabelText(/monthly price/i)).toBeDisabled()
    expect(within(dialog).getByLabelText(/yearly price/i)).toBeDisabled()
    expect(within(dialog).getByLabelText(/^active$/i)).toBeDisabled()

    const members = within(dialog).getByLabelText(/members/i)
    await user.clear(members)
    await user.type(members, '10')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))

    await waitFor(() => expect(api.updateAdminPlan).toHaveBeenCalledTimes(1))
    expect(api.updateAdminPlan).toHaveBeenCalledWith(1, {
      sort_order: 0,
      entitlements: entitlements({}, { storage_mb: 50, members: 10, bands: 1 }),
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('sends the full editable field set for a non-fallback plan', async () => {
    const user = userEvent.setup()
    wrap(<PlanCatalogSection plans={PLANS} onChanged={onChanged} />)

    const silverRow = screen.getByText('Silver').closest('tr')
    await user.click(within(silverRow).getByRole('button', { name: /edit/i }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText(/monthly price/i), '9,50')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))

    await waitFor(() => expect(api.updateAdminPlan).toHaveBeenCalledTimes(1))
    expect(api.updateAdminPlan).toHaveBeenCalledWith(2, {
      slug: 'silver',
      name: 'Silver',
      monthly_price_cents: 950,
      yearly_price_cents: null,
      is_active: true,
      sort_order: 1,
      entitlements: entitlements({ integrations: true }, { storage_mb: 150, bands: 3 }),
    })
  })
})

describe('PlanCatalogSection — delete', () => {
  it('deletes after confirmation and refreshes', async () => {
    const user = userEvent.setup()
    wrap(<PlanCatalogSection plans={PLANS} onChanged={onChanged} />)

    const goldRow = screen.getByText('Gold').closest('tr')
    await user.click(within(goldRow).getByRole('button', { name: /delete/i }))

    const confirm = await screen.findByRole('dialog')
    await user.click(within(confirm).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(api.deleteAdminPlan).toHaveBeenCalledWith(3))
    expect(onChanged).toHaveBeenCalled()
  })
})
