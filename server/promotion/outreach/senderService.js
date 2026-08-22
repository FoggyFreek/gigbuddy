import { badRequest, notFound } from '../../platform/http/serviceErrors.js'
import { getSenderIdentity, saveSenderIdentity } from './senderRepository.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function getOutreachSender(db, tenantId) {
  const row = await getSenderIdentity(db, tenantId)
  if (!row) return notFound('Not found')
  const fromEmail = row.outreach_from_email ?? null
  return { sender: {
    configured: Boolean(row.resend_configured && row.outreach_from_name && fromEmail),
    fromName: row.outreach_from_name ?? null,
    fromEmail,
    replyTo: row.outreach_reply_to ?? null,
  } }
}

export async function configureOutreachSender(db, tenantId, body) {
  const fromName = String(body.fromName ?? '').trim()
  const fromEmail = String(body.fromEmail ?? '').trim().toLowerCase()
  const replyTo = body.replyTo ? String(body.replyTo).trim().toLowerCase() : null
  if (!fromName) return badRequest('fromName is required')
  if (!EMAIL.test(fromEmail)) return badRequest('A valid fromEmail is required')
  if (replyTo && !EMAIL.test(replyTo)) return badRequest('replyTo must be a valid email address')
  const current = await getSenderIdentity(db, tenantId)
  if (!current) return notFound('Not found')
  if (!current.resend_configured) return badRequest('Outreach sender is not configured', { code: 'sender_not_configured' })
  const row = await saveSenderIdentity(db, tenantId, { fromName, fromEmail, replyTo })
  return { sender: { configured: true, fromName: row.outreach_from_name, fromEmail: row.outreach_from_email, replyTo: row.outreach_reply_to } }
}
