import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/purchases.ts', () => ({
  listPurchases: vi.fn(),
  listPurchasePeriods: vi.fn(),
}))

// ContactDetailPage pulls in the full contacts + venues API surface.
vi.mock('../api/contacts.ts', () => ({
  getContact: vi.fn(),
  updateContact: vi.fn().mockResolvedValue({}),
  deleteContact: vi.fn().mockResolvedValue({}),
  addContactNote: vi.fn(),
  deleteContactNote: vi.fn().mockResolvedValue({}),
  listContactVenues: vi.fn().mockResolvedValue([]),
  addContactVenue: vi.fn(),
  removeContactVenue: vi.fn().mockResolvedValue({}),
}))

vi.mock('../api/venues.ts', () => ({
  searchVenues: vi.fn().mockResolvedValue([]),
}))

import * as purchasesApi from '../api/purchases.ts'
import { getContact } from '../api/contacts.ts'
import SupplierPurchasesSection from '../components/SupplierPurchasesSection.tsx'
import ContactDetailPage from '../pages/ContactDetailPage.tsx'
import { AuthContext } from '../contexts/authContext.ts'
import theme from '../theme.ts'

const PURCHASES = [
  {
    id: 1,
    receipt_number: 7,
    supplier_name: 'mi5 Studios',
    supplier_contact_id: 5,
    receipt_date: '2024-05-01',
    due_date: null,
    status: 'paid',
    subtotal_cents: 10000,
    tax_cents: 2100,
    total_cents: 12100,
    description: 'Mix session',
  },
]

function financeUser() {
  return {
    id: 1,
    permissions: ['app.view', 'planning.write', 'purchase.create', 'finance.view'],
    activeTenantRole: 'financial_admin',
  }
}

function authValue(user) {
  return {
    user,
    setUser: () => {},
    logout: async () => {},
    switchTenant: async () => undefined,
    refreshUser: async () => undefined,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  purchasesApi.listPurchases.mockResolvedValue(PURCHASES)
  purchasesApi.listPurchasePeriods.mockResolvedValue(['2024-05-01'])
})

function renderSection() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <SupplierPurchasesSection contactId={5} />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('SupplierPurchasesSection', () => {
  it('loads the supplier’s purchases scoped by supplier_contact_id and a data-derived period', async () => {
    renderSection()

    expect(await screen.findByText('mi5 Studios')).toBeInTheDocument()
    expect(purchasesApi.listPurchasePeriods).toHaveBeenCalledWith({ supplierContactId: 5 })
    // Periods returned only 2024, so the picker defaults to FY 2024, not the
    // current fiscal year — and the list fetch uses that supplier-scoped period.
    expect(purchasesApi.listPurchases).toHaveBeenCalledWith(
      { mode: 'fiscal_year', year: 2024 },
      { supplierContactId: 5 },
    )
  })

  it('re-fetches when the period changes', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByText('mi5 Studios')
    purchasesApi.listPurchases.mockClear()

    await user.click(screen.getByRole('button', { name: /FY 2024/ }))
    await user.click(await screen.findByRole('button', { name: 'All Time' }))

    await waitFor(() =>
      expect(purchasesApi.listPurchases).toHaveBeenCalledWith(
        { mode: 'all_time' },
        { supplierContactId: 5 },
      ),
    )
  })
})

function renderContact(user, category) {
  getContact.mockResolvedValue({ id: 5, name: 'Carol', email: '', phone: '', category, notes: [] })
  return render(
    <MemoryRouter initialEntries={['/contacts/5']}>
      <AuthContext.Provider value={authValue(user)}>
        <ThemeProvider theme={theme}>
          <Routes>
            <Route path="/contacts/:id" element={<ContactDetailPage />} />
          </Routes>
        </ThemeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('ContactDetailPage — supplier purchases gating', () => {
  it('shows the purchases section for a supplier contact with finance access', async () => {
    renderContact(financeUser(), 'supplier')

    expect(await screen.findByText('mi5 Studios')).toBeInTheDocument()
    expect(purchasesApi.listPurchases).toHaveBeenCalledWith(expect.anything(), { supplierContactId: 5 })
  })

  it('hides the section for a non-supplier contact', async () => {
    renderContact(financeUser(), 'press')

    await screen.findByText('Notes')
    expect(purchasesApi.listPurchases).not.toHaveBeenCalled()
  })

  it('hides the section when the user lacks finance access', async () => {
    renderContact(
      { id: 2, permissions: ['app.view', 'planning.write', 'purchase.create'], activeTenantRole: 'contributor' },
      'supplier',
    )

    await screen.findByText('Notes')
    expect(purchasesApi.listPurchases).not.toHaveBeenCalled()
  })
})
