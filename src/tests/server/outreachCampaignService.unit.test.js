// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  fetchCampaign: vi.fn(),
  listCampaignRecipients: vi.fn(),
  setCampaignStatus: vi.fn(),
  setRecipientResult: vi.fn(),
}))
const sendRepository = vi.hoisted(() => ({ isSuppressed: vi.fn() }))

vi.mock('../../../server/promotion/outreach/campaignRepository.js', () => repository)
vi.mock('../../../server/promotion/outreach/sendRepository.js', () => sendRepository)
import { sendCampaign } from '../../../server/promotion/outreach/campaignService.js'

describe('outreach campaign delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the merged template HTML without appending an unsubscribe footer', async () => {
    const campaign = {
      id: 12,
      from_name: 'Example Band',
      from_email: 'hello@example.test',
      reply_to: null,
      body_html_snapshot: '<p>Hello {{band.name}}</p>',
      body_text_snapshot: 'Hello {{band.name}}',
    }
    const pending = {
      id: 34,
      status: 'pending',
      to_email: 'venue@example.test',
      merged_subject: 'Hello venue',
      resolved_fields: { 'band.name': 'Example Band' },
      idempotency_key: 'campaign:12:recipient:34',
    }
    repository.fetchCampaign.mockResolvedValue(campaign)
    repository.listCampaignRecipients
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([{ ...pending, status: 'sent' }])
    repository.setCampaignStatus
      .mockResolvedValueOnce({ ...campaign, status: 'sending' })
      .mockResolvedValueOnce({ ...campaign, status: 'sent' })
    sendRepository.isSuppressed.mockResolvedValue(false)
    const batchDispatcher = {
      dispatch: vi.fn().mockResolvedValue([{ recipientId: pending.id, providerMessageId: 'message-1' }]),
    }

    await sendCampaign({}, 7, campaign.id, { role: 'member', isSuperAdmin: true }, { batchDispatcher })

    expect(batchDispatcher.dispatch).toHaveBeenCalledWith([
      expect.objectContaining({
        payload: expect.objectContaining({
          html: '<p>Hello Example Band</p>',
          text: 'Hello Example Band',
        }),
      }),
    ])
    expect(batchDispatcher.dispatch.mock.calls[0][0][0].payload.html).not.toContain('Unsubscribe')
  })
})
