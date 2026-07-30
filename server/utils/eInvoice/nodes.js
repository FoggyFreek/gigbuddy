// Shared reading primitives for the e-invoice syntaxes.
//
// EN 16931 is a SEMANTIC model with two syntax bindings — UBL 2.1 (ubl.js) and
// UN/CEFACT CII (cii.js) — so both readers walk a fast-xml-parser tree looking
// for the same business terms in different places. These are the helpers that
// walking needs; keeping them here is what stops the second reader becoming a
// copy of the first.
//
// Pure: no DB, no IO.
import { XMLParser } from 'fast-xml-parser'

export class EInvoiceParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EInvoiceParseError'
  }
}

/**
 * Builds a parser for one syntax.
 *
 * removeNSPrefix strips the syntax's prefixes (cbc:/cac: for UBL, ram:/rsm:/udt:
 * for CII) so a document using default namespaces parses identically — and so
 * both readers can address elements by local name alone. The namespace itself is
 * therefore checked separately, before parsing (see assertRootElement).
 *
 * parseTagValue stays off: every value is read through an explicit converter,
 * and numeric coercion would reshape amounts and strip leading zeros from
 * identifiers.
 *
 * @param {string[]} repeatable element names that may occur more than once, so
 *   the single and multiple cases share one code path.
 */
export function createParser(repeatable) {
  const names = new Set(repeatable)
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => names.has(name),
  })
}

export const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

/** An element is either a bare string or { '#text': …, '@_attr': … }. */
export const text = (v) => (v && typeof v === 'object' ? v['#text'] : v)

export const trimOrNull = (v) => {
  const t = text(v)
  return t == null || String(t).trim() === '' ? null : String(t).trim()
}

export const attr = (v, name) => (v && typeof v === 'object' ? trimOrNull(v[`@_${name}`]) : null)

export const numberOf = (v) => {
  const n = Number(trimOrNull(v))
  return Number.isFinite(n) ? n : null
}

/**
 * A mandatory field is one EN 16931 marks as such AND that changes how the bill
 * is booked. Defaulting any of these would put a guess into the ledger: a
 * missing issue date silently becomes the wrong VAT period, an unreadable total
 * removes the only cross-check on the lines.
 */
export function required(value, term, name) {
  if (value === null || value === undefined || value === '') {
    throw new EInvoiceParseError(`invoice is missing ${name} (${term})`)
  }
  return value
}

// ---------------------------------------------------------------------------
// Root element identity
// ---------------------------------------------------------------------------

const XML_COMMENTS = /<!--[\s\S]*?-->/g
const XML_PROLOG = /<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g
const FIRST_ELEMENT = /<([A-Za-z_][\w.-]*)(?::([A-Za-z_][\w.-]*))?((?:\s+[^>]*)?)\/?>/

/**
 * The root element's local name and declared namespace, read from the RAW text.
 *
 * This cannot come from the parsed tree: removeNSPrefix makes
 * `<x:Invoice xmlns:x="urn:anything">` parse as `Invoice` and drops the xmlns
 * declarations entirely, so the tree cannot tell a UBL invoice from any other
 * document with a root of that name.
 *
 * @returns {{ localName: string, namespace: string|null }}
 */
export function readRootElement(xml) {
  const head = String(xml ?? '').replace(XML_COMMENTS, '').replace(XML_PROLOG, '')
  const match = FIRST_ELEMENT.exec(head)
  if (!match) throw new EInvoiceParseError('not an XML document')

  const [, first, second, attrs] = match
  const prefix = second ? first : null
  const declaration = prefix
    ? new RegExp(`\\sxmlns:${prefix}\\s*=\\s*["']([^"']*)["']`)
    : /\sxmlns\s*=\s*["']([^"']*)["']/
  return { localName: second ?? first, namespace: declaration.exec(attrs)?.[1] ?? null }
}

/** Throws unless the root is `localName` bound to `namespace`. */
export function assertRootElement(root, { localName, namespace, syntax }) {
  if (root.localName !== localName || root.namespace !== namespace) {
    throw new EInvoiceParseError(`root element is not a ${syntax} document (expected ${localName} in ${namespace})`)
  }
}
