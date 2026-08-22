import { FIELD_SCOPES, OUTREACH_FIELDS } from './outreachFields.js'

// A template's CONTEXT decides which merge fields it may use. Adding a context
// here (plus its scopes) is the only place that has to know the mapping —
// editor menus, previews, validation and the merge pipeline all read it from
// this registry rather than hardcoding scope lists.
export const TEMPLATE_CONTEXTS = Object.freeze({
  VENUE: 'venue',
  INVOICE: 'invoice',
})

export const DEFAULT_TEMPLATE_CONTEXT = TEMPLATE_CONTEXTS.VENUE

export const OUTREACH_CONTEXTS = Object.freeze({
  [TEMPLATE_CONTEXTS.VENUE]: Object.freeze({
    key: TEMPLATE_CONTEXTS.VENUE,
    scopes: Object.freeze([FIELD_SCOPES.BAND, FIELD_SCOPES.VENUE, FIELD_SCOPES.CONTACT]),
  }),
  [TEMPLATE_CONTEXTS.INVOICE]: Object.freeze({
    key: TEMPLATE_CONTEXTS.INVOICE,
    scopes: Object.freeze([FIELD_SCOPES.BAND, FIELD_SCOPES.INVOICE, FIELD_SCOPES.CUSTOMER]),
  }),
})

export const TEMPLATE_CONTEXT_VALUES = Object.freeze(Object.keys(OUTREACH_CONTEXTS))

export function isTemplateContext(value) {
  return typeof value === 'string' && Object.hasOwn(OUTREACH_CONTEXTS, value)
}

export function normalizeTemplateContext(value) {
  return isTemplateContext(value) ? value : DEFAULT_TEMPLATE_CONTEXT
}

// Every field a template of this context may reference. `venueSafe` still hides
// fields that must never reach a venue-facing template.
export function fieldsForContext(context) {
  const entry = OUTREACH_CONTEXTS[normalizeTemplateContext(context)]
  return OUTREACH_FIELDS.filter((field) => entry.scopes.includes(field.scope) && field.venueSafe !== false)
}

export function fieldKeysForContext(context) {
  return new Set(fieldsForContext(context).map((field) => field.key))
}
