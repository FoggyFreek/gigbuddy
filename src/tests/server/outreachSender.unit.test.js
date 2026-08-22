// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { configureOutreachSender, getOutreachSender } from '../../../server/promotion/outreach/senderService.js'

function executorWith(...rows) {
  return { query: vi.fn().mockImplementation(async () => ({ rows: [rows.shift()] })) }
}

describe('outreach sender configuration', () => {
  it('reads stored readiness without calling the Resend Domains API', async () => {
    const db = executorWith({
      resend_configured: true,
      outreach_from_name: 'The Woods',
      outreach_from_email: 'bookings@thewoodsband.nl',
      outreach_reply_to: 'info@thewoodsband.nl',
    })

    await expect(getOutreachSender(db, 4)).resolves.toEqual({ sender: {
      configured: true,
      fromName: 'The Woods',
      fromEmail: 'bookings@thewoodsband.nl',
      replyTo: 'info@thewoodsband.nl',
    } })
    expect(db.query).toHaveBeenCalledOnce()
  })

  it('saves a syntactically valid sender when a Resend key is configured, without remote verification', async () => {
    const db = executorWith(
      { resend_configured: true },
      { outreach_from_name: 'The Woods', outreach_from_email: 'bookings@thewoodsband.nl', outreach_reply_to: null },
    )

    await expect(configureOutreachSender(db, 4, {
      fromName: ' The Woods ', fromEmail: 'BOOKINGS@THEWOODSBAND.NL', replyTo: '',
    })).resolves.toEqual({ sender: {
      configured: true,
      fromName: 'The Woods',
      fromEmail: 'bookings@thewoodsband.nl',
      replyTo: null,
    } })
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it('requires a stored Resend key before saving the sender identity', async () => {
    const db = executorWith({ resend_configured: false })
    const result = await configureOutreachSender(db, 4, {
      fromName: 'The Woods', fromEmail: 'bookings@thewoodsband.nl',
    })
    expect(result).toMatchObject({ error: { status: 400, body: { code: 'sender_not_configured' } } })
    expect(db.query).toHaveBeenCalledOnce()
  })
})
