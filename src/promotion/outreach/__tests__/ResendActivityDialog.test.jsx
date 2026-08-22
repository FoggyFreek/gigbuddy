import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../../../theme.ts'
import ResendActivityDialog from '../components/ResendActivityDialog.tsx'
import {
  addOutreachSuppression, listOutreachCampaigns, listOutreachSuppressions, removeOutreachSuppression,
} from '../outreachCampaigns.ts'

vi.mock('../outreachCampaigns.ts', () => ({
  listOutreachCampaigns: vi.fn(),
  getOutreachCampaign: vi.fn(),
  listOutreachSuppressions: vi.fn(),
  addOutreachSuppression: vi.fn(),
  removeOutreachSuppression: vi.fn(),
}))

vi.mock('../../../hooks/usePermissions.ts', () => ({
  usePermissions: () => ({ canWritePlanning: true }),
}))

const INVOICE_ROW = {
  id: 2, type: 'invoice', invoice_id: 9, template_id: 5,
  status: 'sent', created_at: '2026-03-02T10:00:00Z', sent_at: '2026-03-02T10:01:00Z',
}
const SUPPRESSION = { id: 4, email: 'blocked@example.test', reason: 'manual', created_at: '2026-03-01T10:00:00Z' }

const renderDialog = () => render(
  <ThemeProvider theme={theme}><ResendActivityDialog open onClose={vi.fn()} /></ThemeProvider>,
)

describe('ResendActivityDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listOutreachCampaigns.mockResolvedValue({ items: [INVOICE_ROW], meta: { limit: 100, returned: 1 } })
    listOutreachSuppressions.mockResolvedValue({ items: [SUPPRESSION], meta: { limit: 100, returned: 1 } })
  })

  it('opens on the email log', async () => {
    renderDialog()
    await waitFor(() => expect(listOutreachCampaigns).toHaveBeenCalled())
    expect(screen.getByRole('gridcell', { name: 'Invoice' })).toBeInTheDocument()
    // The suppression list is not fetched until it is asked for.
    expect(listOutreachSuppressions).not.toHaveBeenCalled()
  })

  it('switches to suppressions through the toggle', async () => {
    renderDialog()
    await waitFor(() => expect(listOutreachCampaigns).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Suppressions' }))

    expect(await screen.findByText(/blocked@example\.test/)).toBeInTheDocument()
    expect(screen.queryByRole('gridcell', { name: 'Invoice' })).toBeNull()
  })

  it('says plainly that suppressions do not withhold invoices', async () => {
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Suppressions' }))

    expect(await screen.findByText(/still delivered to a suppressed address/i)).toBeInTheDocument()
  })

  it('suppresses an address from the dialog', async () => {
    addOutreachSuppression.mockResolvedValue({ ...SUPPRESSION, id: 5, email: 'new@example.test' })
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Suppressions' }))
    await screen.findByText(/blocked@example\.test/)

    await userEvent.type(screen.getByLabelText('Email address'), 'new@example.test')
    await userEvent.click(screen.getByRole('button', { name: 'Suppress address' }))

    await waitFor(() => expect(addOutreachSuppression).toHaveBeenCalledWith('new@example.test'))
    expect(await screen.findByText(/new@example\.test/)).toBeInTheDocument()
  })

  it('removes a suppression from the dialog', async () => {
    removeOutreachSuppression.mockResolvedValue(undefined)
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Suppressions' }))
    await screen.findByText(/blocked@example\.test/)

    await userEvent.click(screen.getByRole('button', { name: 'Remove suppression' }))

    await waitFor(() => expect(removeOutreachSuppression).toHaveBeenCalledWith(4))
    expect(screen.queryByText(/blocked@example\.test/)).toBeNull()
  })
})
