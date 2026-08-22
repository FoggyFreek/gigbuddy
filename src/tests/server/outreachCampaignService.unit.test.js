// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  fetchCampaign: vi.fn(),
  claimCampaignForSend: vi.fn(),
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
    repository.claimCampaignForSend.mockResolvedValue({ ...campaign, status: 'sending' })
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

  // An invoice email is transactional: it carries its attachments, no
  // unsubscribe headers, and is never withheld because of a suppression.
  function invoiceSetup(overrides = {}) {
    const campaign = {
      id: 21,
      type: 'invoice',
      invoice_id: 5,
      attachments: 'pdf',
      from_name: 'Example Band',
      from_email: 'hello@example.test',
      reply_to: null,
      body_html_snapshot: '<p>Invoice</p>',
      body_text_snapshot: 'Invoice',
      ...overrides,
    }
    const recipient = {
      id: 44,
      status: 'pending',
      to_email: 'customer@example.test',
      merged_subject: 'Invoice 2026-001',
      resolved_fields: {},
      idempotency_key: 'campaign:21:recipient:44',
    }
    repository.fetchCampaign.mockResolvedValue(campaign)
    repository.claimCampaignForSend.mockResolvedValue({ ...campaign, status: 'sending' })
    repository.listCampaignRecipients
      .mockResolvedValueOnce([recipient])
      .mockResolvedValueOnce([{ ...recipient, status: 'sent' }])
    repository.setCampaignStatus.mockResolvedValue({ ...campaign, status: 'sent' })
    return { campaign, recipient }
  }

  const attachment = { filename: 'invoice.pdf', content: 'BASE64', contentType: 'application/pdf' }
  const singleDispatcherFor = (recipientId) => ({
    supportsAttachments: true,
    dispatch: vi.fn().mockResolvedValue([{ recipientId, providerMessageId: 'message-9' }]),
  })

  it('attaches the invoice and sends no unsubscribe headers', async () => {
    const { recipient } = invoiceSetup()
    sendRepository.isSuppressed.mockResolvedValue(false)
    const singleDispatcher = singleDispatcherFor(recipient.id)

    await sendCampaign({}, 7, 21, { role: 'tenant_admin', isSuperAdmin: false }, {
      singleDispatcher,
      attachmentLoader: vi.fn().mockResolvedValue({ attachments: [attachment] }),
    })

    const payload = singleDispatcher.dispatch.mock.calls[0][0][0].payload
    expect(payload.attachments).toEqual([attachment])
    expect(payload.headers).toBeUndefined()
  })

  it('still delivers an invoice to a suppressed address', async () => {
    const { recipient } = invoiceSetup()
    sendRepository.isSuppressed.mockResolvedValue(true)
    const singleDispatcher = singleDispatcherFor(recipient.id)

    await sendCampaign({}, 7, 21, { role: 'tenant_admin', isSuperAdmin: false }, {
      singleDispatcher,
      attachmentLoader: vi.fn().mockResolvedValue({ attachments: [attachment] }),
    })

    expect(singleDispatcher.dispatch).toHaveBeenCalled()
    expect(sendRepository.isSuppressed).not.toHaveBeenCalled()
  })

  it('does not dispatch twice when the campaign is already claimed', async () => {
    invoiceSetup()
    repository.claimCampaignForSend.mockResolvedValue(null)
    const singleDispatcher = singleDispatcherFor(44)

    await sendCampaign({}, 7, 21, { role: 'tenant_admin', isSuperAdmin: false }, {
      singleDispatcher,
      attachmentLoader: vi.fn(),
    })

    expect(singleDispatcher.dispatch).not.toHaveBeenCalled()
  })

  it('refuses an invoice send without finance.manage', async () => {
    invoiceSetup()
    const result = await sendCampaign({}, 7, 21, { role: 'member', isSuperAdmin: false }, {
      singleDispatcher: singleDispatcherFor(44),
      attachmentLoader: vi.fn(),
    })

    expect(result.error.status).toBe(403)
    expect(repository.claimCampaignForSend).not.toHaveBeenCalled()
  })

  it('releases the claim and reports when the attachment cannot be built', async () => {
    invoiceSetup()
    const singleDispatcher = singleDispatcherFor(44)
    const failure = { error: { status: 409, body: { error: 'gone', code: 'invoice_pdf_unavailable' } } }

    const result = await sendCampaign({}, 7, 21, { role: 'tenant_admin', isSuperAdmin: false }, {
      singleDispatcher,
      attachmentLoader: vi.fn().mockResolvedValue(failure),
    })

    expect(result.error.body.code).toBe('invoice_pdf_unavailable')
    expect(singleDispatcher.dispatch).not.toHaveBeenCalled()
    // The campaign must go back to draft so the user can retry.
    expect(repository.setCampaignStatus).toHaveBeenCalledWith({}, 7, 21, 'draft')
  })
})
