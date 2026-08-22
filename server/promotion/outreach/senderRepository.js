export async function getSenderIdentity(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT t.outreach_from_name, t.outreach_from_email, t.outreach_reply_to,
            (ti.resend_api_key_encrypted IS NOT NULL) AS resend_configured
       FROM tenants t LEFT JOIN tenant_integrations ti ON ti.tenant_id = t.id WHERE t.id = $1`,
    [tenantId],
  )
  return rows[0] ?? null
}

export async function saveSenderIdentity(executor, tenantId, { fromName, fromEmail, replyTo }) {
  const { rows } = await executor.query(
    `UPDATE tenants SET outreach_from_name = $2, outreach_from_email = $3, outreach_reply_to = $4, updated_at = NOW()
      WHERE id = $1 RETURNING outreach_from_name, outreach_from_email, outreach_reply_to`,
    [tenantId, fromName, fromEmail, replyTo],
  )
  return rows[0]
}
