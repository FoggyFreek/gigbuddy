import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/merch.js', () => ({
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  archiveProduct: vi.fn(),
  listMerchSales: vi.fn(),
  recordMerchSale: vi.fn(),
  voidMerchSale: vi.fn(),
}))
vi.mock('../api/gigs.js', () => ({
  listGigs: vi.fn(),
}))

import * as api from '../api/merch.js'
import * as gigsApi from '../api/gigs.js'
import MerchPage from '../pages/MerchPage.jsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.js'
import theme from '../theme.js'

function wrap(ui, { compact = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/merch']}>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>{ui}</CompactLayoutContext.Provider>
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

const SALES = [
  {
    id: 5, product_id: 1, product_name: 'Band T-Shirt', gig_id: null, sale_date: '2026-06-01',
    quantity: 2, unit_price_incl_cents: 3630, vat_rate: '21.00', unit_cost_cents: 1200,
    status: 'recorded', voided_at: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.listProducts.mockResolvedValue([...PRODUCTS])
  api.listMerchSales.mockResolvedValue([...SALES])
  api.createProduct.mockResolvedValue({ id: 3 })
  api.recordMerchSale.mockResolvedValue({ id: 6 })
  api.voidMerchSale.mockResolvedValue({})
  gigsApi.listGigs.mockResolvedValue([])
})

describe('MerchPage — products', () => {
  it('renders the product table with stock and prices', async () => {
    wrap(<MerchPage />)
    // The name shows in both the products and the sales table.
    const [productCell] = await screen.findAllByText('Band T-Shirt')
    const row = productCell.closest('tr')
    expect(within(row).getByText('9')).toBeInTheDocument()
    expect(screen.getByText('Old Cap')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
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

  it('archives a product', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getAllByRole('button', { name: /archive/i })[0])
    await waitFor(() => expect(api.archiveProduct).toHaveBeenCalledWith(1))
  })
})

describe('MerchPage — sales', () => {
  it('record-sale dialog prefills price and VAT from the selected product and submits', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /record sale/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText(/product/i))
    // Archived products are not sellable.
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).queryByText(/Old Cap/)).toBeNull()
    await user.click(within(listbox).getByText(/Band T-Shirt/))

    await user.click(within(dialog).getByRole('button', { name: /record sale/i }))
    await waitFor(() => expect(api.recordMerchSale).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: 1,
        quantity: 1,
        unit_price_incl_cents: 3630,
        vat_rate: 21,
        gig_id: null,
      }),
    ))
    await waitFor(() => expect(api.listMerchSales).toHaveBeenCalledTimes(2))
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

  it('voids a sale after confirmation', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />)
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /void sale/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /void sale/i }))

    await waitFor(() => expect(api.voidMerchSale).toHaveBeenCalledWith(5))
    await waitFor(() => expect(api.listMerchSales).toHaveBeenCalledTimes(2))
  })
})

describe('MerchPage — compact layout', () => {
  it('renders products and sales as cards instead of tables', async () => {
    wrap(<MerchPage />, { compact: true })
    await screen.findAllByText('Band T-Shirt')
    expect(screen.queryByRole('table')).toBeNull()
    // Product card content
    expect(screen.getByText('Old Cap')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByText(/9 on hand/i)).toBeInTheDocument()
    // Sale card content
    expect(screen.getByText(/2\s*×/)).toBeInTheDocument()
  })

  it('product card actions still work', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />, { compact: true })
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getAllByRole('button', { name: /archive/i })[0])
    await waitFor(() => expect(api.archiveProduct).toHaveBeenCalledWith(1))
  })

  it('voids a sale from a card', async () => {
    const user = userEvent.setup()
    wrap(<MerchPage />, { compact: true })
    await screen.findAllByText('Band T-Shirt')
    await user.click(screen.getByRole('button', { name: /void sale/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /void sale/i }))
    await waitFor(() => expect(api.voidMerchSale).toHaveBeenCalledWith(5))
  })
})
