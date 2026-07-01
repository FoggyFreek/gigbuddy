import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/merch.ts', () => ({
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  archiveProduct: vi.fn(),
  listMerchSales: vi.fn(),
  listMerchSalesSummary: vi.fn(),
  listMerchSalePeriods: vi.fn(),
  recordMerchSale: vi.fn(),
  voidMerchSale: vi.fn(),
}))
vi.mock('../api/gigs.ts', () => ({
  listGigs: vi.fn(),
}))
vi.mock('../api/accounts.ts', () => ({
  listAccounts: vi.fn(),
  getAccountingSettings: vi.fn(),
}))

import * as api from '../api/merch.ts'
import * as gigsApi from '../api/gigs.ts'
import * as accountsApi from '../api/accounts.ts'
import MerchPage from '../pages/MerchPage.tsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'
import theme from '../theme.ts'

function DetailStub() {
  const { id } = useParams()
  return <div>Detail for {id}</div>
}

// Renders MerchPage inside the real nested-route shape so summary-row clicks can
// navigate to the detail outlet.
function wrap(ui, { compact = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/merch']}>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>
          <Routes>
            <Route path="/merch" element={ui}>
              <Route path=":id" element={<DetailStub />} />
            </Route>
          </Routes>
        </CompactLayoutContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const PRODUCTS = [
  {
    id: 1, name: 'Band T-Shirt', unit_cost_cents: 1200, default_price_incl_cents: 3630,
    vat_rate: '21.00', quantity_on_hand: 9, archived_at: null,
  },
  {
    id: 2, name: 'Old Cap', unit_cost_cents: 500, default_price_incl_cents: 1500,
    vat_rate: '21.00', quantity_on_hand: 0, archived_at: '2026-01-01T00:00:00Z',
  },
]

const SUMMARY = [
  {
    product_id: 1, product_name: 'Band T-Shirt', revenue_account_code: '42000',
    revenue_account_name: 'Merchandise Sales', total_qty: 2, total_amount_cents: 7260,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.listProducts.mockResolvedValue([...PRODUCTS])
  api.listMerchSalesSummary.mockResolvedValue([...SUMMARY])
  api.listMerchSalePeriods.mockResolvedValue(['2026-06-01'])
  api.listMerchSales.mockResolvedValue([])
  api.createProduct.mockResolvedValue({ id: 3 })
  api.recordMerchSale.mockResolvedValue({ id: 6 })
  api.voidMerchSale.mockResolvedValue({})
  gigsApi.listGigs.mockResolvedValue([])
  accountsApi.listAccounts.mockResolvedValue([])
  accountsApi.getAccountingSettings.mockResolvedValue({})
})

const REVENUE_ACCOUNTS = [
  { code: '40000', name: 'Revenue', type: 'revenue', parent_code: null, is_active: true },
  { code: '42000', name: 'Merchandise Sales', type: 'revenue', parent_code: '40000', is_active: true },
  { code: '42100', name: 'Vinyl and CDs', type: 'revenue', parent_code: '42000', is_active: true },
  { code: '41000', name: 'Gig fees', type: 'revenue', parent_code: '40000', is_active: true },
]

describe('MerchPage — products', () => {
  it('renders the product table with stock and prices', async () => {
    wrap(<MerchPage />)
    // The name shows in both the products table and the per-product summary.
    const [productCell] = await screen.findAllByText('Band T-Shirt')
    const row = productCell.closest('tr')
    expect(within(row).getByText('9')).toBeInTheDocument()
  })

  it('hides archived products until the toggle is enabled', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    // Archived by default is hidden.
    expect(screen.queryByText('Old Cap')).toBeNull()
    await user.click(screen.getByRole('button', { name: /show archived products/i }))
    expect(screen.getByText('Old Cap')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    // Toggle flips to hide.
    await user.click(screen.getByRole('button', { name: /hide archived products/i }))
    expect(screen.queryByText('Old Cap')).toBeNull()
  })

  it('creates a product through the dialog', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /new product/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/name/i), 'Hoodie')
    await user.click(within(dialog).getByRole('button', { name: /create/i }))

    await waitFor(() => expect(api.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hoodie', vat_rate: 21 }),
    ))
    // List reloads after the action.
    await waitFor(() => expect(api.listProducts).toHaveBeenCalledTimes(2))
  })

  it('archives a product only after confirming the consequences', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /^archive$/i }))
    // A confirmation dialog appears; nothing is archived yet.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/can't be undone/i)).toBeInTheDocument()
    expect(api.archiveProduct).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: /^archive$/i }))
    await waitFor(() => expect(api.archiveProduct).toHaveBeenCalledWith(1))
  })

  it('offers only the merch revenue account and its descendants, and submits the chosen code', async () => {
    accountsApi.listAccounts.mockResolvedValue(REVENUE_ACCOUNTS)
    accountsApi.getAccountingSettings.mockResolvedValue({ merch_revenue_account_code: '42000' })
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /new product/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/name/i), 'Hoodie')

    await user.click(within(dialog).getByLabelText(/revenue account/i))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText(/42000 — Merchandise Sales/)).toBeInTheDocument()
    expect(within(listbox).getByText(/42100 — Vinyl and CDs/)).toBeInTheDocument()
    expect(within(listbox).queryByText(/41000/)).toBeNull()
    await user.click(within(listbox).getByText(/42100 — Vinyl and CDs/))

    await user.click(within(dialog).getByRole('button', { name: /create/i }))
    await waitFor(() => expect(api.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hoodie', revenue_account_code: '42100' }),
    ))
  })

  it('submits a null revenue account when none is chosen', async () => {
    accountsApi.listAccounts.mockResolvedValue(REVENUE_ACCOUNTS)
    accountsApi.getAccountingSettings.mockResolvedValue({ merch_revenue_account_code: '42000' })
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /new product/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/name/i), 'Hoodie')
    await user.click(within(dialog).getByRole('button', { name: /create/i }))
    await waitFor(() => expect(api.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hoodie', revenue_account_code: null }),
    ))
  })
})

describe('MerchPage — per-product summary', () => {
  it('renders one summary row per product with account, qty and total', async () => {
    wrap(<MerchPage />)
    const accountCell = await screen.findByText(/42000 — Merchandise Sales/)
    const row = accountCell.closest('tr')
    expect(within(row).getByText('2')).toBeInTheDocument()        // total qty
    expect(within(row).getByText('72,60')).toBeInTheDocument()    // total amount
  })

  it('navigates to the product detail when a summary row is clicked', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />)
    const accountCell = await screen.findByText(/42000 — Merchandise Sales/)
    await user.click(within(accountCell.closest('tr')).getByText('Band T-Shirt'))
    expect(await screen.findByText('Detail for 1')).toBeInTheDocument()
  })

  it('queries the summary for all time by default', async () => {
    wrap(<MerchPage />)
    await screen.findByText(/42000 — Merchandise Sales/)
    await waitFor(() => expect(api.listMerchSalesSummary).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'all_time' }),
    ))
  })
})

describe('MerchPage — recording a sale', () => {
  it('records a sale and refreshes the summary', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /record sale/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText(/product/i))
    const listbox = await screen.findByRole('listbox')
    // Archived products are not sellable.
    expect(within(listbox).queryByText(/Old Cap/)).toBeNull()
    await user.click(within(listbox).getByText(/Band T-Shirt/))

    await user.click(within(dialog).getByRole('button', { name: /record sale/i }))
    await waitFor(() => expect(api.recordMerchSale).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: 1, quantity: 1, unit_price_incl_cents: 3630, vat_rate: 21, gig_id: null }),
    ))
    // The summary reloads after recording.
    await waitFor(() => expect(api.listMerchSalesSummary).toHaveBeenCalledTimes(2))
  })

  it('shows the no-stock info dialog when no product has stock on hand', async () => {
    api.listProducts.mockResolvedValue([
      {
        id: 1, name: 'Band T-Shirt', unit_cost_cents: 1200, default_price_incl_cents: 3630,
        vat_rate: '21.00', quantity_on_hand: 0, archived_at: null,
      },
    ])
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /record sale/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/no stock available/i)).toBeInTheDocument()
    // The sale form is not opened, so nothing can be recorded.
    expect(within(dialog).queryByLabelText(/quantity/i)).toBeNull()
    expect(api.recordMerchSale).not.toHaveBeenCalled()
  })

  it('surfaces an insufficient-stock error in the dialog', async () => {
    api.recordMerchSale.mockRejectedValue(new Error('Insufficient stock'))
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /record sale/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText(/product/i))
    await user.click(within(await screen.findByRole('listbox')).getByText(/Band T-Shirt/))
    await user.click(within(dialog).getByRole('button', { name: /record sale/i }))

    expect(await screen.findByText(/insufficient stock/i)).toBeInTheDocument()
  })
})

