import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/reimbursements.js', () => ({
  listMemberPurchases: vi.fn(),
}))

import * as api from '../api/reimbursements.js'
import RegisterReimbursementDialog from '../components/reimbursements/RegisterReimbursementDialog.jsx'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const MEMBER = { band_member_id: 1, band_member_name: 'Alice', outstanding_cents: 42000, outstanding_count: 2 }

const PURCHASES = [
  { id: 10, receipt_number: 5, supplier_name: 'Acme', receipt_date: '2026-06-01', total_cents: 30000, description: 'Strings' },
  { id: 11, receipt_number: 6, supplier_name: 'Music BV', receipt_date: '2026-06-02', total_cents: 12000, description: 'Cables' },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.listMemberPurchases.mockResolvedValue([...PURCHASES])
})

describe('RegisterReimbursementDialog', () => {
  it('submits all outstanding purchases by default', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    wrap(<RegisterReimbursementDialog member={MEMBER} onSubmit={onSubmit} onClose={onClose} />)

    await screen.findByText(/Acme/)
    await user.click(screen.getByRole('button', { name: /register reimbursement/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      band_member_id: 1,
      purchase_ids: [10, 11],
      memo: null,
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('excludes a deselected purchase from the submission', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    wrap(<RegisterReimbursementDialog member={MEMBER} onSubmit={onSubmit} onClose={vi.fn()} />)

    await screen.findByText(/Acme/)
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0]) // deselect purchase 10

    await user.click(screen.getByRole('button', { name: /register reimbursement/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ purchase_ids: [11] }))
  })

  it('surfaces a server error and stays open', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Nothing outstanding for this member'))
    const onClose = vi.fn()
    wrap(<RegisterReimbursementDialog member={MEMBER} onSubmit={onSubmit} onClose={onClose} />)

    await screen.findByText(/Acme/)
    await user.click(screen.getByRole('button', { name: /register reimbursement/i }))

    expect(await screen.findByText(/Nothing outstanding/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
