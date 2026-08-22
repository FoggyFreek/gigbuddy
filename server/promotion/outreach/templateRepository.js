export async function listTemplates(executor, tenantId, limit, context = null) {
  const { rows } = await executor.query(
    `SELECT id, name, subject, locale, context, origin_key, created_at, updated_at
       FROM outreach_templates
      WHERE tenant_id = $1 AND archived_at IS NULL
        AND ($3::text IS NULL OR context = $3)
      ORDER BY updated_at DESC, id DESC LIMIT $2`,
    [tenantId, limit, context],
  )
  return rows
}

export async function fetchTemplate(executor, templateId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM outreach_templates WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL',
    [templateId, tenantId],
  )
  return rows[0] ?? null
}

export async function insertTemplate(executor, tenantId, data) {
  const { rows } = await executor.query(
    `INSERT INTO outreach_templates
      (tenant_id, name, subject, preview_text, body_json, body_html, body_text, origin_key, locale, context)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [tenantId, data.name, data.subject, data.previewText, data.bodyJson, data.bodyHtml,
      data.bodyText, data.originKey, data.locale, data.context],
  )
  return rows[0]
}

export async function copyTemplate(executor, templateId, tenantId, name) {
  const { rows } = await executor.query(
    `INSERT INTO outreach_templates
      (tenant_id, name, subject, preview_text, body_json, body_html, body_text, origin_key, locale, context)
     SELECT tenant_id, $3, subject, preview_text, body_json, body_html, body_text, origin_key, locale, context
       FROM outreach_templates
      WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL
     RETURNING *`,
    [templateId, tenantId, name],
  )
  return rows[0] ?? null
}

export async function updateTemplateFields(executor, tenantId, templateId, fields, values) {
  const whereIndex = values.length + 1
  const { rows } = await executor.query(
    `UPDATE outreach_templates SET ${[...fields, 'updated_at = NOW()'].join(', ')}
      WHERE id = $${whereIndex} AND tenant_id = $${whereIndex + 1} AND archived_at IS NULL RETURNING *`,
    [...values, templateId, tenantId],
  )
  return rows[0] ?? null
}

export async function archiveTemplate(executor, templateId, tenantId) {
  const { rowCount } = await executor.query(
    'UPDATE outreach_templates SET archived_at = NOW(), updated_at = NOW() WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL',
    [templateId, tenantId],
  )
  return rowCount > 0
}
