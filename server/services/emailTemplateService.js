// Email-template domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import { buildTemplateUpdateFields } from '../validators/emailTemplateValidators.js'
import {
  listTemplates,
  fetchTemplate,
  insertTemplate,
  updateTemplateFields,
  deleteTemplate as deleteTemplateRow,
} from '../repositories/emailTemplateRepository.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

export async function listEmailTemplates(db, tenantId) {
  return listTemplates(db, tenantId)
}

export async function getEmailTemplate(db, tenantId, templateId) {
  const template = await fetchTemplate(db, templateId, tenantId)
  if (!template) return NOT_FOUND
  return { template }
}

export async function createEmailTemplate(db, tenantId, body) {
  const { name, subject, body_html } = body
  if (!name) return badRequest('name is required')
  const template = await insertTemplate(db, tenantId, {
    name,
    subject: subject || '',
    bodyHtml: body_html || '',
  })
  return { template }
}

export async function patchEmailTemplate(db, tenantId, templateId, body) {
  const built = buildTemplateUpdateFields(body)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const template = await updateTemplateFields(db, tenantId, templateId, built.fields, built.values)
  if (!template) return NOT_FOUND
  return { template }
}

export async function deleteEmailTemplate(db, tenantId, templateId) {
  const deleted = await deleteTemplateRow(db, templateId, tenantId)
  return deleted ? {} : NOT_FOUND
}
