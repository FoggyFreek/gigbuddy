import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../../../theme.ts'
import VenueCampaignDialogContent from '../components/VenueCampaignDialogContent.tsx'
import { createOutreachCampaign, sendOutreachCampaign } from '../outreachCampaigns.ts'
import { listOutreachTemplates } from '../outreachTemplates.ts'

vi.mock('../outreachCampaigns.ts', () => ({
  createOutreachCampaign: vi.fn(),
  sendOutreachCampaign: vi.fn(),
}))
vi.mock('../outreachTemplates.ts', () => ({
  listOutreachTemplates: vi.fn(),
}))

const VENUES = [
  { id: 1, name: 'Venue One', email: 'venue-one@example.com', primary_contact_id: 11, primary_contact_name: 'Alice', primary_contact_email: 'alice@example.com' },
  { id: 2, name: 'Festival Two', category: 'festival', email: 'festival@example.com', primary_contact_id: null, primary_contact_email: null },
]
const CAMPAIGN = {
  id: 31,
  status: 'draft',
  recipients: [
    { id: 101, to_name: 'Venue One', to_email: 'venue-one@example.com', merged_subject: 'Hello Venue One', status: 'pending', error_message: null },
    { id: 102, to_name: 'Festival Two', to_email: 'festival@example.com', merged_subject: 'Hello Festival Two', status: 'pending', error_message: null },
  ],
}

describe('VenueCampaignDialogContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listOutreachTemplates.mockResolvedValue({ items: [
      { id: 7, name: 'Venue pitch' },
      { id: 8, name: 'Venue follow-up' },
    ] })
    createOutreachCampaign.mockResolvedValue(CAMPAIGN)
    sendOutreachCampaign.mockResolvedValue({ ...CAMPAIGN, status: 'sent' })
  })

  it('prompts for a venue template and address source, then reviews and sends without navigation', async () => {
    const user = userEvent.setup()
    render(<ThemeProvider theme={theme}><VenueCampaignDialogContent venues={VENUES} onClose={vi.fn()} /></ThemeProvider>)

    const templateSelect = await screen.findByRole('combobox', { name: 'Email template' })
    expect(templateSelect).toHaveTextContent('Venue pitch')
    await user.click(templateSelect)
    expect(screen.getByRole('option', { name: 'Venue pitch' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Venue follow-up' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('radio', { name: 'Venue / festival email address' }))
    await user.click(screen.getByRole('button', { name: 'Review recipients' }))

    expect(createOutreachCampaign).toHaveBeenCalledWith({
      templateId: 7,
      recipients: [
        { venueId: 1, contactId: 11, addressSource: 'venue' },
        { venueId: 2, addressSource: 'venue' },
      ],
    })
    expect(await screen.findByText('venue-one@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send campaign' }))
    expect(sendOutreachCampaign).toHaveBeenCalledWith(31)
    expect(await screen.findByText('Campaign sent.')).toBeInTheDocument()
  })

  it.each([
    ['partial', 'Campaign partially sent. Review the recipients that failed or were skipped.'],
    ['failed', 'Campaign failed. Review the recipient errors and try again.'],
  ])('reports a %s delivery result instead of claiming the campaign was sent', async (status, message) => {
    const user = userEvent.setup()
    sendOutreachCampaign.mockResolvedValue({
      ...CAMPAIGN,
      status,
      recipients: CAMPAIGN.recipients.map((recipient) => ({ ...recipient, status: 'failed', error_message: 'Domain rejected' })),
    })
    render(<ThemeProvider theme={theme}><VenueCampaignDialogContent venues={VENUES} onClose={vi.fn()} /></ThemeProvider>)

    await screen.findByRole('combobox', { name: 'Email template' })
    await user.click(screen.getByRole('button', { name: 'Review recipients' }))
    await user.click(await screen.findByRole('button', { name: 'Send campaign' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('Campaign sent.')).not.toBeInTheDocument()
  })
})
