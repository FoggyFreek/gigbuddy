import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// pdf.js can't run in jsdom (no DOMMatrix/worker); stub the react-pdf surface.
vi.mock('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}))

vi.mock('../api/purchases.js', () => ({
  listPurchases: vi.fn(),
  listPurchasePeriods: vi.fn(),
  getPurchase: vi.fn(),
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
  deletePurchase: vi.fn(),
  registerPurchasePayment: vi.fn(),
}))

vi.mock('../api/contacts.js', () => ({
  searchContacts: vi.fn(async () => []),
  createContact: vi.fn(),
}))

vi.mock('../api/accounts.js', () => ({
  getAccountingSettings: vi.fn(async () => ({
    default_expense_account_code: '62100',
  })),
  listAccounts: vi.fn(async () => [
    { id: 1, code: '62100', name: 'Instruments & Equipment', type: 'expense', is_active: true },
  ]),
}))

import * as purchasesApi from '../api/purchases.js'
import PurchaseDetailPage from '../pages/PurchaseDetailPage.jsx'
import PurchasesPage from '../pages/PurchasesPage.jsx'
import theme from '../theme.js'

function wrap(ui) {
  return render(
    <MemoryRouter initialEntries={['/purchases']}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function wrapWithRoutes() {
  return render(
    <MemoryRouter initialEntries={['/purchases']}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route
            path="/purchases"
            element={
              <>
                <LocationProbe />
                <PurchasesPage />
              </>
            }
          >
            <Route path=":id" element={<PurchaseDetailPage />} />
          </Route>
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const PURCHASES = [
  {
    id: 1,
    receipt_number: 2,
    supplier_name: 'mi5 Studios',
    receipt_date: '2026-06-03',
    due_date: null,
    status: 'draft',
    subtotal_cents: 123967,
    tax_cents: 26033,
    total_cents: 150000,
    description: 'Studio recording day',
  },
]

const CREATED_PURCHASE = {
  id: 99,
  receipt_number: 3,
  supplier_name: 'New Supplier BV',
  supplier_contact_id: null,
  receipt_date: '2026-06-09',
  due_date: null,
  currency: 'EUR',
  status: 'draft',
  finalized_at: null,
  subtotal_cents: 0,
  tax_cents: 0,
  total_cents: 0,
  memo: null,
  lines: [{ description: '', expense_category: '', tax_rate: 21, amount_incl_cents: 0, position: 0 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  purchasesApi.listPurchases.mockResolvedValue(PURCHASES)
  purchasesApi.listPurchasePeriods.mockResolvedValue(PURCHASES.map((p) => p.receipt_date))
  purchasesApi.createPurchase.mockResolvedValue(CREATED_PURCHASE)
  purchasesApi.getPurchase.mockResolvedValue(CREATED_PURCHASE)
})

describe('PurchasesPage', () => {
  it('renders the list with supplier and description', async () => {
    wrap(<PurchasesPage />)
    expect(await screen.findByText('mi5 Studios')).toBeInTheDocument()
    expect(screen.getByText('Studio recording day')).toBeInTheDocument()
    // Summary "Purchases" card label is present.
    expect(screen.getByRole('heading', { name: 'Purchases', level: 5 })).toBeInTheDocument()
    expect(purchasesApi.listPurchases).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fiscal_year' }))
  })

  it('paginates the table at 25 rows per page', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      receipt_number: 100 + i,
      supplier_name: `Supplier ${100 + i}`,
      receipt_date: '2026-06-03',
      due_date: null,
      status: 'paid',
      subtotal_cents: 1000,
      tax_cents: 210,
      total_cents: 1210,
      description: '',
    }))
    purchasesApi.listPurchases.mockResolvedValue(many)
    wrap(<PurchasesPage />)
    await screen.findByText('Supplier 100')

    expect(screen.getByText('Supplier 124')).toBeInTheDocument()
    expect(screen.queryByText('Supplier 125')).not.toBeInTheDocument()
    expect(screen.getByText('1–25 of 30')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next page/i }))

    expect(screen.getByText('Supplier 125')).toBeInTheDocument()
    expect(screen.queryByText('Supplier 100')).not.toBeInTheDocument()
  })

  it('hides pagination controls when purchases fit on one page', async () => {
    wrap(<PurchasesPage />)
    await screen.findByText('mi5 Studios')
    expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument()
  })

  it('opens the create dialog', async () => {
    const user = userEvent.setup()
    wrap(<PurchasesPage />)
    await screen.findByText('mi5 Studios')
    await user.click(screen.getByRole('button', { name: /create purchase/i }))
    await waitFor(() => expect(screen.getByText('New purchase')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument()
  })

  it('creates a purchase and opens it in the nested detail view', async () => {
    const user = userEvent.setup()
    wrapWithRoutes()

    await screen.findByText('mi5 Studios')
    await user.click(screen.getByRole('button', { name: /create purchase/i }))
    await user.type(screen.getByPlaceholderText(/Search or type contact name/), 'New Supplier BV')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(purchasesApi.createPurchase).toHaveBeenCalledTimes(1))
    expect(purchasesApi.createPurchase).toHaveBeenCalledWith(expect.objectContaining({
      supplier_name: 'New Supplier BV',
      status: 'draft',
    }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/purchases/99'))
    expect(purchasesApi.getPurchase).toHaveBeenCalledWith(99)
    expect(await screen.findByRole('heading', { name: 'Purchase' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('New Supplier BV')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
