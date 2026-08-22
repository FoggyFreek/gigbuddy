import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../../../theme.ts'
import EmailLogSection from '../components/EmailLogSection.tsx'
import { getOutreachCampaign, listOutreachCampaigns } from '../outreachCampaigns.ts'

vi.mock('../outreachCampaigns.ts', () => ({
  listOutreachCampaigns: vi.fn(),
  getOutreachCampaign: vi.fn(),
}))

const OUTREACH_ROW = {
  id: 1, type: 'outreach', invoice_id: null, template_id: 4,
  status: 'sent', created_at: '2026-03-01T10:00:00Z', sent_at: '2026-03-01T10:01:00Z',
}
const INVOICE_ROW = {
  id: 2, type: 'invoice', invoice_id: 9, template_id: 5,
  status: 'failed', created_at: '2026-03-02T10:00:00Z', sent_at: null,
}

const renderSection = () => render(
  <ThemeProvider theme={theme}><EmailLogSection /></ThemeProvider>,
)

describe('EmailLogSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listOutreachCampaigns.mockResolvedValue({ items: [OUTREACH_ROW, INVOICE_ROW], meta: { limit: 100, returned: 2 } })
  })

  // "Outreach"/"Invoice" also label the filter's options, so the log assertions
  // look at grid cells specifically.
  const typeCell = (label) => screen.getByRole('gridcell', { name: label })

  it('lists every send with its type', async () => {
    renderSection()
    await waitFor(() => expect(typeCell('Outreach')).toBeInTheDocument())
    expect(typeCell('Invoice')).toBeInTheDocument()
    expect(listOutreachCampaigns).toHaveBeenCalledWith(100, undefined)
  })

  it('filters the log by type', async () => {
    renderSection()
    await waitFor(() => expect(typeCell('Outreach')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'invoice')

    await waitFor(() => expect(listOutreachCampaigns).toHaveBeenCalledWith(100, 'invoice'))
  })

  it('reveals the delivery error when a send is inspected', async () => {
    getOutreachCampaign.mockResolvedValue({
      ...INVOICE_ROW,
      recipients: [{
        id: 7, to_name: 'Venue BV', to_email: 'customer@example.test',
        merged_subject: 'Factuur 2026-001', status: 'failed', error_message: 'Mailbox unavailable',
      }],
    })
    renderSection()
    await waitFor(() => expect(typeCell('Invoice')).toBeInTheDocument())

    await userEvent.click(typeCell('Invoice'))

    expect(await screen.findByText('Mailbox unavailable')).toBeInTheDocument()
    expect(getOutreachCampaign).toHaveBeenCalledWith(2)
  })
})
