import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/merch.ts', () => ({
  listMerchSales: vi.fn(),
  voidMerchSale: vi.fn(),
}))

import * as api from '../api/merch.ts'
import MerchandiseDetails from '../components/merch/MerchandiseDetails.tsx'
import theme from '../theme.ts'

const PERIOD = { mode: 'fiscal_year', year: 2026 }

function recorded(id, sale_date, quantity, unit_price_incl_cents, payment_method = 'bank') {
  return {
    id, product_id: 1, product_name: 'Band T-Shirt', sale_date, quantity,
    unit_price_incl_cents, vat_rate: '21.00', unit_cost_cents: 1200,
    payment_method, status: 'recorded', voided_at: null,
  }
}

// Three sales whose date / qty / amount orderings all differ, so each sort
// column produces a distinct row order.
const SALES = [
  recorded(5, '2026-06-01', 2, 3630),          // amount 7260
  recorded(6, '2026-06-10', 1, 1000, 'cash'),  // amount 1000
  { ...recorded(7, '2026-06-05', 5, 500), status: 'voided', voided_at: '2026-06-06T00:00:00Z' }, // amount 2500
]

function renderDetails(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MerchandiseDetails productId={1} period={PERIOD} {...props} />
    </ThemeProvider>,
  )
}

// First-cell (Date) text of each data row, top to bottom (header dropped).
function dateOrder() {
  return screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent?.slice(0, 10))
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listMerchSales.mockResolvedValue([...SALES])
  api.voidMerchSale.mockResolvedValue({})
})

describe('MerchandiseDetails', () => {
  it('fetches the product sales for the period and renders the rows', async () => {
    renderDetails()
    await screen.findByRole('heading', { name: 'Band T-Shirt' })
    expect(api.listMerchSales).toHaveBeenCalledWith(PERIOD, 1)
    // Payment method column maps cash → "Cash on hand", bank → "Bank".
    expect(screen.getByText('Cash on hand')).toBeInTheDocument()
    expect(screen.getAllByText('Bank').length).toBeGreaterThan(0)
    // Voided sales are hidden entirely.
    expect(screen.queryByText('Voided')).not.toBeInTheDocument()
    // Two recorded sales → two void buttons.
    expect(screen.getAllByRole('button', { name: /void sale/i })).toHaveLength(2)
  })

  it('sorts by date (default desc), qty and amount', async () => {
    const user = userEvent.setup()
    renderDetails()
    await screen.findByRole('heading', { name: 'Band T-Shirt' })

    // Default: date descending (voided id=7 on 06-05 is hidden).
    expect(dateOrder()).toEqual(['2026-06-10', '2026-06-01'])

    await user.click(screen.getByRole('button', { name: /qty/i }))
    // Qty desc: 2 (06-01), 1 (06-10).
    expect(dateOrder()).toEqual(['2026-06-01', '2026-06-10'])

    await user.click(screen.getByRole('button', { name: /^total$/i }))
    // Amount desc: 7260 (06-01), 1000 (06-10).
    expect(dateOrder()).toEqual(['2026-06-01', '2026-06-10'])

    await user.click(screen.getByRole('button', { name: /^total$/i }))
    // Toggling the same column flips to ascending.
    expect(dateOrder()).toEqual(['2026-06-10', '2026-06-01'])
  })

  it('paginates at 25 rows per page', async () => {
    const user = userEvent.setup()
    // 30 sales on descending dates June 1..30; default date-desc puts day 30 first.
    const many = Array.from({ length: 30 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0')
      return recorded(100 + i, `2026-06-${day}`, 1, 1000)
    })
    api.listMerchSales.mockResolvedValue(many)
    renderDetails()
    await screen.findByRole('heading', { name: 'Band T-Shirt' })

    // 25 of 30 rows on the first page; the oldest five are on page two.
    expect(screen.getByText('2026-06-30')).toBeInTheDocument()
    expect(screen.getByText('2026-06-06')).toBeInTheDocument()
    expect(screen.queryByText('2026-06-05')).not.toBeInTheDocument()
    expect(screen.getByText('1–25 of 30')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getByText('2026-06-05')).toBeInTheDocument()
    expect(screen.queryByText('2026-06-30')).not.toBeInTheDocument()
  })

  it('voids a sale, refetches and notifies the parent; a fully-voided list keeps no void action', async () => {
    const onReload = vi.fn()
    // After the void the only remaining row for this product is voided.
    api.listMerchSales
      .mockResolvedValueOnce([recorded(5, '2026-06-01', 2, 3630)])
      .mockResolvedValueOnce([{ ...recorded(5, '2026-06-01', 2, 3630), status: 'voided', voided_at: '2026-06-02T00:00:00Z' }])
    const user = userEvent.setup()
    renderDetails({ onReload })
    await screen.findByRole('heading', { name: 'Band T-Shirt' })

    await user.click(screen.getByRole('button', { name: /void sale/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /void sale/i }))

    await waitFor(() => expect(api.voidMerchSale).toHaveBeenCalledWith(5))
    await waitFor(() => expect(onReload).toHaveBeenCalled())
    // Voided sale is hidden; with no remaining rows the empty state shows.
    expect(await screen.findByText('No sales in this period.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /void sale/i })).toBeNull()
  })
})
