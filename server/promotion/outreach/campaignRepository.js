export async function fetchTemplateForCampaign(executor, tenantId, templateId) {
  const { rows } = await executor.query('SELECT * FROM outreach_templates WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL', [templateId, tenantId])
  return rows[0] ?? null
}
export async function fetchContactForCampaign(executor, tenantId, contactId) {
  const { rows } = await executor.query('SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2', [contactId, tenantId])
  return rows[0] ?? null
}
export async function fetchVenueForCampaign(executor, tenantId, venueId) {
  if (!venueId) return null
  const { rows } = await executor.query('SELECT * FROM venues WHERE id = $1 AND tenant_id = $2', [venueId, tenantId])
  return rows[0] ?? null
}
export async function insertCampaign(executor, tenantId, data) {
  const { rows } = await executor.query(
    `INSERT INTO outreach_campaigns (tenant_id, template_id, subject_snapshot, body_html_snapshot, body_text_snapshot,
      from_name, from_email, reply_to, created_by_user_id, type, invoice_id, attachments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [tenantId, data.templateId, data.subject, data.bodyHtml, data.bodyText, data.fromName, data.fromEmail, data.replyTo, data.userId,
      data.type ?? 'outreach', data.invoiceId ?? null, data.attachments ?? 'pdf'],
  )
  return rows[0]
}
export async function insertRecipient(executor, tenantId, campaignId, data, index) {
  const { rows } = await executor.query(
    `INSERT INTO outreach_recipients (tenant_id, campaign_id, contact_id, venue_id, to_email, to_name,
      merged_subject, resolved_fields, status, error_message, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [tenantId, campaignId, data.contactId, data.venueId, data.toEmail, data.toName, data.mergedSubject,
      data.resolvedFields, data.status, data.errorMessage, `campaign:${campaignId}:draft:${index}`],
  )
  const recipient = rows[0]
  const key = `campaign:${campaignId}:recipient:${recipient.id}`
  await executor.query('UPDATE outreach_recipients SET idempotency_key = $2 WHERE id = $1', [recipient.id, key])
  return { ...recipient, idempotency_key: key }
}
export async function listCampaignRows(executor, tenantId, limit, type = null) {
  const { rows } = await executor.query(
    `SELECT * FROM outreach_campaigns WHERE tenant_id = $1 AND ($3::text IS NULL OR type = $3)
      ORDER BY created_at DESC, id DESC LIMIT $2`, [tenantId, limit, type])
  return rows
}
export async function fetchCampaign(executor, tenantId, campaignId) {
  const { rows } = await executor.query('SELECT * FROM outreach_campaigns WHERE id = $1 AND tenant_id = $2', [campaignId, tenantId])
  return rows[0] ?? null
}
export async function listCampaignRecipients(executor, tenantId, campaignId) {
  const { rows } = await executor.query('SELECT * FROM outreach_recipients WHERE campaign_id = $1 AND tenant_id = $2 ORDER BY id', [campaignId, tenantId])
  return rows
}
// Atomically claims a campaign for sending. Returns null when another request
// already claimed it or it reached a terminal status — the status check and the
// write must not be two statements, or two concurrent sends both dispatch.
export async function claimCampaignForSend(executor, tenantId, campaignId) {
  const { rows } = await executor.query(
    `UPDATE outreach_campaigns SET status = 'sending'
      WHERE id = $1 AND tenant_id = $2 AND status = 'draft' RETURNING *`,
    [campaignId, tenantId],
  )
  return rows[0] ?? null
}
export async function setCampaignStatus(executor, tenantId, campaignId, status, sent = false) {
  const { rows } = await executor.query(`UPDATE outreach_campaigns SET status = $3${sent ? ', sent_at = NOW()' : ''} WHERE id = $1 AND tenant_id = $2 RETURNING *`, [campaignId, tenantId, status])
  return rows[0] ?? null
}
export async function setRecipientResult(executor, tenantId, recipientId, result) {
  const { rows } = await executor.query(
    `UPDATE outreach_recipients SET status = $3, provider_message_id = $4, error_message = $5,
       sent_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE sent_at END WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [recipientId, tenantId, result.status, result.providerMessageId ?? null, result.error ?? null],
  )
  return rows[0] ?? null
}
