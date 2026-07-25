import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { getInvoiceT, resolveInvoiceLng, invoiceIntlLocale } from '../../server/utils/invoiceI18n.js'

// Server-side invoice-document i18n — deliberately separate from the client UI
// i18n in src/i18n; language follows the supplier's VAT country.
describe('invoice PDF i18n (server)', () => {
  it('resolves the document language from the supplier VAT country', () => {
    expect(resolveInvoiceLng('nl')).toBe('nl')
    expect(resolveInvoiceLng('be')).toBe('nl') // Dutch-speaking
    expect(resolveInvoiceLng('de')).toBe('en')
    expect(resolveInvoiceLng('fr')).toBe('en')
    expect(resolveInvoiceLng('gb')).toBe('en')
    expect(resolveInvoiceLng('xx')).toBe('nl') // unknown → default VAT country (nl) → Dutch
  })

  it('maps each language to an Intl locale', () => {
    expect(invoiceIntlLocale('nl')).toBe('nl-NL')
    expect(invoiceIntlLocale('en')).toBe('en-IE')
  })

  it('renders Dutch and English document strings', () => {
    const en = getInvoiceT('en')
    const nl = getInvoiceT('nl')
    expect(en('invoiceTitle', { number: '2026-0001' })).toBe('Invoice #2026-0001')
    expect(nl('invoiceTitle', { number: '2026-0001' })).toBe('Factuur #2026-0001')
    expect(nl('subtotal')).toBe('Subtotaal')
    expect(en('subtotal')).toBe('Subtotal')
  })

  it('interpolates the per-country VAT term', () => {
    const en = getInvoiceT('en')
    expect(en('colPriceExclVat', { vat: 'USt' })).toBe('Price excl. USt')
    expect(en('vatTotal', { vat: 'USt', rate: 19 })).toBe('Total USt (19%)')
  })

  it('pluralizes the payment instruction on count', () => {
    const en = getInvoiceT('en')
    expect(en('paymentInstruction', { count: 14, number: 'X' })).toMatch(/within 14 days/)
    expect(en('paymentInstruction', { count: 1, number: 'X' })).toMatch(/within 1 day\b/)
  })

  it('keeps the en and nl document resources in key parity', () => {
    const load = (lng) => JSON.parse(readFileSync(
      `${globalThis.process.cwd()}/server/i18n/${lng}/invoice.json`, 'utf8',
    ))
    expect(new Set(Object.keys(load('en')))).toEqual(new Set(Object.keys(load('nl'))))
  })
})
