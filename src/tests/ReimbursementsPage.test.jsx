import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/reimbursements.ts', () => ({
  listOutstanding: vi.fn(),
  listMemberPurchases: vi.fn(),
  createReimbursement: vi.fn(),
  reimburseMemberFull: vi.fn(),
}))

import * as api from '../api/reimbursements.ts'
import ReimbursementsPage from '../pages/ReimbursementsPage.tsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'
import theme from '../theme.ts'

function wrap(ui, { compact = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/reimbursements']}>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>{ui}</CompactLayoutContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

// Renders where the navigate() landed plus the openNewPurchase flag it carried.
function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="purchases-location">
      {location.pathname} openNewPurchase:{String(Boolean(location.state?.openNewPurchase))}
    </div>
  )
}

const OUTSTANDING = [
  { band_member_id: 1, band_member_name: 'Alice', user_id: 7, outstanding_cents: 42000, outstanding_count: 2 },
  { band_member_id: 2, band_member_name: 'Bob', user_id: null, outstanding_cents: 15000, outstanding_count: 1 },
]

const ALICE_PURCHASES = [
  { id: 10, receipt_number: 5, supplier_name: 'Acme', receipt_date: '2026-06-01', total_cents: 30000, description: 'Strings' },
  { id: 11, receipt_number: 6, supplier_name: 'Music BV', receipt_date: '2026-06-02', total_cents: 12000, description: 'Cables' },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.listOutstanding.mockResolvedValue([...OUTSTANDING])
  api.listMemberPurchases.mockResolvedValue([...ALICE_PURCHASES])
  api.reimburseMemberFull.mockResolvedValue({ id: 99 })
  api.createReimbursement.mockResolvedValue({ id: 99 })
})

describe('ReimbursementsPage — outstanding', () => {
  it('renders a row per member with their outstanding balance', async () => {
    wrap(<ReimbursementsPage />)
    await screen.findByText('Alice')
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(api.listOutstanding).toHaveBeenCalledTimes(1)
  })

  it('expands a member to load their outstanding purchases', async () => {
    const user = userEvent.setup()
    wrap(<ReimbursementsPage />)
    const aliceRow = (await screen.findByText('Alice')).closest('tr')
    await user.click(within(aliceRow).getByRole('button', { name: /expand/i }))

    await waitFor(() => expect(api.listMemberPurchases).toHaveBeenCalledWith(1))
    expect(await screen.findByText(/Strings/)).toBeInTheDocument()
  })

  it('marks a member fully reimbursed', async () => {
    const user = userEvent.setup()
    wrap(<ReimbursementsPage />)
    const aliceRow = (await screen.findByText('Alice')).closest('tr')
    await user.click(within(aliceRow).getByRole('button', { name: /mark reimbursed/i }))

    await waitFor(() => expect(api.reimburseMemberFull).toHaveBeenCalledWith(1, {}))
    // List reloads after the action.
    await waitFor(() => expect(api.listOutstanding).toHaveBeenCalledTimes(2))
  })

  it('renders a card layout (no table) in compact mode and still allows mark reimbursed', async () => {
    const user = userEvent.setup()
    wrap(<ReimbursementsPage />, { compact: true })
    await screen.findByText('Alice')
    expect(screen.queryByRole('table')).toBeNull()

    await user.click(screen.getAllByRole('button', { name: /mark reimbursed/i })[0])
    await waitFor(() => expect(api.reimburseMemberFull).toHaveBeenCalledWith(1, {}))
  })

  it('does not render tabs — history lives in the ledger', async () => {
    wrap(<ReimbursementsPage />)
    await screen.findByText('Alice')
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('shows the empty state (no total card, no table) when nothing is outstanding', async () => {
    api.listOutstanding.mockResolvedValue([])
    wrap(<ReimbursementsPage />)

    expect(await screen.findByText('No unpaid reimbursements?')).toBeInTheDocument()
    expect(screen.getByText('That’s not rock ’n’ roll')).toBeInTheDocument()
    // The total-owed card and the member table are hidden when there's nothing owed.
    expect(screen.queryByText('Total owed to members')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('navigates to purchases with the new-purchase flag from the empty state', async () => {
    api.listOutstanding.mockResolvedValue([])
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/reimbursements']}>
        <ThemeProvider theme={theme}>
          <CompactLayoutContext.Provider value={false}>
            <Routes>
              <Route path="/reimbursements" element={<ReimbursementsPage />} />
              <Route path="/purchases" element={<LocationProbe />} />
            </Routes>
          </CompactLayoutContext.Provider>
        </ThemeProvider>
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /create purchase/i }))

    expect(await screen.findByTestId('purchases-location')).toHaveTextContent('openNewPurchase:true')
  })
})
