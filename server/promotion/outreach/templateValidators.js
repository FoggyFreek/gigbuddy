import { extractTokens } from '../../../shared/outreachMerge.js'
import { fieldKeysForContext, isTemplateContext, DEFAULT_TEMPLATE_CONTEXT } from '../../../shared/outreachContexts.js'

export const TEMPLATE_LOCALES = new Set(['nl', 'en'])
// The PATCH whitelist. `context` is deliberately absent: a template's field
// vocabulary must not shift under an already-authored body.
export const EDITABLE_FIELDS = Object.freeze([
  'name', 'subject', 'preview_text', 'body_json', 'body_html', 'body_text', 'origin_key', 'locale',
])

// Filtering the editor's field menu is UX, not enforcement — a hand-crafted
// request could still put {{invoice.total}} in a venue template.
export function findForeignTokens(context, parts) {
  const allowed = fieldKeysForContext(context)
  const seen = new Set()
  for (const part of parts) {
    for (const token of extractTokens(part ?? '')) {
      const key = token.replace(/^#/, '')
      if (!allowed.has(key)) seen.add(key)
    }
  }
  return [...seen]
}

function tokenError(context, parts) {
  const foreign = findForeignTokens(context, parts)
  return foreign.length ? `Unknown merge fields for the ${context} context: ${foreign.join(', ')}` : null
}

export function validateTemplateCreate(body = {}) {
  const name = String(body.name ?? '').trim()
  if (!name) return { error: 'name is required' }
  if (name.length > 200) return { error: 'name must be at most 200 characters' }
  const locale = body.locale ?? 'nl'
  if (!TEMPLATE_LOCALES.has(locale)) return { error: 'Invalid locale' }
  const context = body.context ?? DEFAULT_TEMPLATE_CONTEXT
  if (!isTemplateContext(context)) return { error: 'Invalid context' }
  const subject = String(body.subject ?? '')
  const bodyHtml = String(body.body_html ?? '')
  const bodyText = String(body.body_text ?? '')
  const error = tokenError(context, [subject, bodyHtml, bodyText])
  if (error) return { error }
  return { value: {
    name,
    subject,
    previewText: body.preview_text == null ? null : String(body.preview_text),
    bodyJson: body.body_json ?? {},
    bodyHtml,
    bodyText,
    originKey: body.origin_key == null ? null : String(body.origin_key),
    locale,
    context,
  } }
}

// `context` is the template's own, read from the stored row — a PATCH may not
// change it, so tokens are always validated against the context it was created with.
export function buildTemplateUpdateFields(body = {}, context = DEFAULT_TEMPLATE_CONTEXT) {
  if ('context' in body) return { error: 'context cannot be changed' }
  const fields = []
  const values = []
  for (const key of EDITABLE_FIELDS) {
    if (!(key in body)) continue
    if (key === 'locale' && !TEMPLATE_LOCALES.has(body[key])) return { error: 'Invalid locale' }
    if (key === 'name') {
      const name = String(body[key] ?? '').trim()
      if (!name) return { error: 'name is required' }
      if (name.length > 200) return { error: 'name must be at most 200 characters' }
      values.push(name)
    } else if (key === 'body_json') values.push(body[key] ?? {})
    else values.push(body[key] === '' ? '' : body[key] ?? null)
    fields.push(`${key} = $${values.length}`)
  }
  const error = tokenError(context, ['subject', 'body_html', 'body_text'].filter((key) => key in body).map((key) => String(body[key] ?? '')))
  if (error) return { error }
  return { fields, values }
}
