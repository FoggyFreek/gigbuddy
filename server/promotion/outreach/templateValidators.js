export const TEMPLATE_LOCALES = new Set(['nl', 'en'])
export const EDITABLE_FIELDS = Object.freeze([
  'name', 'subject', 'preview_text', 'body_json', 'body_html', 'body_text', 'origin_key', 'locale',
])

export function validateTemplateCreate(body = {}) {
  const name = String(body.name ?? '').trim()
  if (!name) return { error: 'name is required' }
  if (name.length > 200) return { error: 'name must be at most 200 characters' }
  const locale = body.locale ?? 'nl'
  if (!TEMPLATE_LOCALES.has(locale)) return { error: 'Invalid locale' }
  return { value: {
    name,
    subject: String(body.subject ?? ''),
    previewText: body.preview_text == null ? null : String(body.preview_text),
    bodyJson: body.body_json ?? {},
    bodyHtml: String(body.body_html ?? ''),
    bodyText: String(body.body_text ?? ''),
    originKey: body.origin_key == null ? null : String(body.origin_key),
    locale,
  } }
}

export function buildTemplateUpdateFields(body = {}) {
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
  return { fields, values }
}
