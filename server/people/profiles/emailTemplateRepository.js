// Data-access helpers for email templates. Each query takes an `executor` (a
// pool or transaction client) so callers control transactions. Every query is
// scoped by tenant_id.

export async function listTemplates(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT id, name, subject, created_at FROM email_templates WHERE tenant_id = $1 ORDER BY name ASC',
    [tenantId],
  )
  return rows
}

export async function fetchTemplate(executor, templateId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM email_templates WHERE id = $1 AND tenant_id = $2',
    [templateId, tenantId],
  )
  return rows[0] || null
}

export async function insertTemplate(executor, tenantId, { name, subject, bodyHtml }) {
  const { rows } = await executor.query(
    `INSERT INTO email_templates (tenant_id, name, subject, body_html)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [tenantId, name, subject, bodyHtml],
  )
  return rows[0]
}

export async function updateTemplateFields(executor, tenantId, templateId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE email_templates SET ${assignments.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *`,
    [...values, templateId, tenantId],
  )
  return rows[0] || null
}

export async function deleteTemplate(executor, templateId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM email_templates WHERE id = $1 AND tenant_id = $2',
    [templateId, tenantId],
  )
  return rowCount > 0
}
