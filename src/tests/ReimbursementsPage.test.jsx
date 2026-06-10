import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/reimbursements.js', () => ({
  listOutstanding: vi.fn(),
  listMemberPurchases: vi.fn(),
  listReimbursements: vi.fn(),
  listReimbursementPeriods: vi.fn(),
  createReimbursement: vi.fn(),
  reimburseMemberFull: vi.fn(),
}))

import * as api from '../api/reimbursements.js'
import ReimbursementsPage from '../pages/ReimbursementsPage.jsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.js'
import theme from '../theme.js'

function wrap(ui, { compact = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/reimbursements']}>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>{ui}</CompactLayoutContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
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
  api.listReimbursements.mockResolvedValue([])
  api.listReimbursementPeriods.mockResolvedValue([])
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

  it('loads history when switching tabs', async () => {
    const user = userEvent.setup()
    wrap(<ReimbursementsPage />)
    await screen.findByText('Alice')
    await user.click(screen.getByRole('tab', { name: /history/i }))

    await waitFor(() => expect(api.listReimbursementPeriods).toHaveBeenCalled())
    await waitFor(() => expect(api.listReimbursements).toHaveBeenCalled())
  })
})
