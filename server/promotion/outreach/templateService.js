import { hasPermission, PERMISSIONS } from '../../auth/permissions.js'
import { limitedCollection } from '../../platform/collections/limitedCollectionService.js'
import { badRequest, conflict, forbidden, notFound } from '../../platform/http/serviceErrors.js'
import { fieldsForContext, isTemplateContext, normalizeTemplateContext } from '../../../shared/outreachContexts.js'
import { formatOutreachValue } from './fields/formatters.js'
import { resolveOutreachRawValues } from './fields/resolvers.js'
import { fetchProfileTenant } from '../../people/profiles/profileRepository.js'
import { buildTemplateUpdateFields, validateTemplateCreate } from './templateValidators.js'
import { archiveTemplate, copyTemplate, fetchTemplate, insertTemplate, listTemplates, updateTemplateFields } from './templateRepository.js'

const NOT_FOUND = notFound('Not found')
const canWrite = (caller) => hasPermission(caller.role, PERMISSIONS.PLANNING_WRITE, { isSuperAdmin: caller.isSuperAdmin })
const permissionDenied = () => forbidden('Permission denied')
const COPY_ATTEMPTS = 10_000

function copyName(name, attempt) {
  const match = /^(.* Copy)(?:\((\d+)\))?$/.exec(name)
  let base
  let suffix
  if (match) {
    const parsedIndex = match[2] === undefined ? 0 : Number.parseInt(match[2], 10)
    const nextIndex = (Number.isSafeInteger(parsedIndex) ? parsedIndex : 0) + attempt + 1
    base = match[1]
    suffix = `(${nextIndex})`
  } else {
    base = name
    suffix = attempt === 0 ? ' Copy' : ` Copy(${attempt})`
  }
  return `${base.slice(0, Math.max(0, 200 - suffix.length))}${suffix}`
}

export async function listOutreachTemplates(db, tenantId, query = {}) {
  if (query.context !== undefined && !isTemplateContext(query.context)) return badRequest('Invalid context')
  const context = query.context ?? null
  return limitedCollection(query.limit, (limit) => listTemplates(db, tenantId, limit, context))
}

export async function getOutreachTemplate(db, tenantId, templateId) {
  const template = await fetchTemplate(db, templateId, tenantId)
  return template ? { template } : NOT_FOUND
}

export async function createOutreachTemplate(db, tenantId, body, caller) {
  const parsed = validateTemplateCreate(body)
  if (parsed.error) return badRequest(parsed.error)
  if (!canWrite(caller)) return permissionDenied()
  try {
    return { template: await insertTemplate(db, tenantId, parsed.value) }
  } catch (err) {
    if (err.code === '23505') return conflict('A template with that name already exists', { code: 'template_exists' })
    throw err
  }
}

export async function patchOutreachTemplate(db, tenantId, templateId, body, caller) {
  const current = await fetchTemplate(db, templateId, tenantId)
  if (!current) return NOT_FOUND
  if (!canWrite(caller)) return permissionDenied()
  const built = buildTemplateUpdateFields(body, current.context)
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('No valid fields to update')
  try {
    return { template: await updateTemplateFields(db, tenantId, templateId, built.fields, built.values) }
  } catch (err) {
    if (err.code === '23505') return conflict('A template with that name already exists', { code: 'template_exists' })
    throw err
  }
}

export async function copyOutreachTemplate(db, tenantId, templateId, caller) {
  const current = await fetchTemplate(db, templateId, tenantId)
  if (!current) return NOT_FOUND
  if (!canWrite(caller)) return permissionDenied()
  for (let attempt = 0; attempt < COPY_ATTEMPTS; attempt += 1) {
    try {
      const template = await copyTemplate(db, templateId, tenantId, copyName(current.name, attempt))
      return template ? { template } : NOT_FOUND
    } catch (err) {
      if (err.code !== '23505' || err.constraint !== 'outreach_templates_tenant_name_uidx') throw err
    }
  }
  return conflict('Unable to allocate a copy name', { code: 'template_copy_name_exhausted' })
}

export async function deleteOutreachTemplate(db, tenantId, templateId, caller) {
  const current = await fetchTemplate(db, templateId, tenantId)
  if (!current) return NOT_FOUND
  if (!canWrite(caller)) return permissionDenied()
  return (await archiveTemplate(db, templateId, tenantId)) ? {} : NOT_FOUND
}

export async function listOutreachFields(db, tenantId, query = {}) {
  if (query.context !== undefined && !isTemplateContext(query.context)) return badRequest('Invalid context')
  const tenant = await fetchProfileTenant(db, tenantId) ?? {}
  const raw = resolveOutreachRawValues({ tenant }, { locale: query.locale === 'en' ? 'en' : 'nl' })
  const fields = fieldsForContext(normalizeTemplateContext(query.context)).map((entry) => ({
    key: entry.key,
    token: `{{${entry.block ? '#' : ''}${entry.key}}}`,
    label: entry.key,
    scope: entry.scope,
    block: entry.block,
    sample: entry.block ? '' : formatOutreachValue(raw[entry.key], entry.format, { locale: query.locale === 'en' ? 'en' : 'nl' }),
  }))
  return { fields }
}
