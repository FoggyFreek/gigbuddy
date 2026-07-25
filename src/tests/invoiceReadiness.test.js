import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INVOICE_ISSUE_ERROR_CODES,
  checkInvoiceReadyForIssue,
  checkReverseCharge,
  checkViesAttestation,
  normalizeVatNumber,
} from '../../shared/invoiceReadiness.js'
import { invoiceIssueMessage } from '../../server/domain/invoiceIssueErrors.js'

const TENANT = {
  band_name: 'Alpha Band',
  address_street: 'Alpha Street 1',
  address_city: 'Amsterdam',
  vat_country: 'nl',
  tax_id: 'NL123456789B01',
  legal_form: 'sole_trader',
}
const INVOICE = {
  customer_name: 'Alpha Hall',
  customer_address_street: 'Hall Street 3',
  customer_address_city: 'Utrecht',
  issue_date: '2026-05-01',
  tax_cents: 4500,
  reverse_charge: false,
}
const LINES = [{ description: 'Optreden', quantity: 1 }]

const reverseChargeInvoice = (extra = {}) => ({
  ...INVOICE,
  tax_cents: 0,
  reverse_charge: true,
  customer_address_country: 'DE',
  customer_tax_id: 'DE136695976',
  ...extra,
})

describe('invoiceReadiness — art. 226 mandatory content', () => {
  it('passes a complete invoice', () => {
    expect(checkInvoiceReadyForIssue(INVOICE, LINES, TENANT)).toBeNull()
  })

  it.each([
    ['supplier street', { address_street: '' }, 'incomplete_supplier_details'],
    ['supplier city', { address_city: '' }, 'incomplete_supplier_details'],
    ['supplier VAT id (VAT charged)', { tax_id: null }, 'missing_supplier_vat_id'],
  ])('rejects a missing %s', (_label, tenantPatch, code) => {
    expect(checkInvoiceReadyForIssue(INVOICE, LINES, { ...TENANT, ...tenantPatch })).toBe(code)
  })

  it.each([
    ['customer name', { customer_name: '' }, 'incomplete_customer_details'],
    ['customer street', { customer_address_street: '' }, 'incomplete_customer_details'],
    ['issue date', { issue_date: null }, 'missing_issue_date'],
  ])('rejects a missing %s', (_label, invoicePatch, code) => {
    expect(checkInvoiceReadyForIssue({ ...INVOICE, ...invoicePatch }, LINES, TENANT)).toBe(code)
  })

  it('requires at least one usable line', () => {
    expect(checkInvoiceReadyForIssue(INVOICE, [], TENANT)).toBe('invalid_lines')
    expect(checkInvoiceReadyForIssue(INVOICE, [{ description: 'x', quantity: 0 }], TENANT)).toBe('invalid_lines')
    expect(checkInvoiceReadyForIssue(INVOICE, [{ description: '', quantity: 1 }], TENANT)).toBe('invalid_lines')
  })

  it('requires registration disclosure only from an incorporated band', () => {
    const company = { ...TENANT, legal_form: 'company' }
    expect(checkInvoiceReadyForIssue(INVOICE, LINES, company)).toBe('missing_registration_info')
    expect(checkInvoiceReadyForIssue(INVOICE, LINES, { ...company, kvk_number: '12345678' })).toBeNull()
    // A German company must also name its register court.
    const deCompany = { ...company, vat_country: 'de', tax_id: 'DE136695976', kvk_number: 'HRB 12345' }
    expect(checkInvoiceReadyForIssue(INVOICE, LINES, deCompany)).toBe('missing_registration_info')
    expect(checkInvoiceReadyForIssue(INVOICE, LINES, { ...deCompany, registration_office: 'Amtsgericht München' })).toBeNull()
    // A sole trader owes none of it.
    expect(checkInvoiceReadyForIssue(INVOICE, LINES, TENANT)).toBeNull()
  })

  it('does not require a supplier VAT id when no VAT is charged', () => {
    const noVat = { ...INVOICE, tax_cents: 0 }
    expect(checkInvoiceReadyForIssue(noVat, LINES, { ...TENANT, tax_id: null })).toBeNull()
  })
})

describe('invoiceReadiness — reverse charge & VIES attestation', () => {
  it('accepts a valid intra-EU supply with a current attestation', () => {
    const invoice = reverseChargeInvoice({
      vies_checked_at: '2026-05-01T10:00:00Z',
      vies_checked_vat_number: 'DE136695976',
    })
    expect(checkInvoiceReadyForIssue(invoice, LINES, TENANT)).toBeNull()
  })

  it('blocks issuing without a VIES confirmation', () => {
    expect(checkInvoiceReadyForIssue(reverseChargeInvoice(), LINES, TENANT))
      .toBe('reverse_charge_vies_check_required')
  })

  it('treats an attestation for a different number as stale', () => {
    const invoice = reverseChargeInvoice({
      vies_checked_at: '2026-05-01T10:00:00Z',
      vies_checked_vat_number: 'DE100000008',
    })
    expect(checkInvoiceReadyForIssue(invoice, LINES, TENANT)).toBe('reverse_charge_vies_check_stale')
  })

  it('ignores formatting differences when matching the attested number', () => {
    expect(checkViesAttestation({
      customer_tax_id: 'de 136 695 976',
      vies_checked_at: 'x',
      vies_checked_vat_number: 'DE136695976',
    })).toBeNull()
  })

  it.each([
    ['no customer VAT number', { customerTaxId: '' }, 'customer_tax_id_required_for_reverse_charge'],
    ['a Northern Ireland number for a service', { customerTaxId: 'XI980780684' }, 'reverse_charge_xi_services_unsupported'],
    ['a domestic customer', { customerCountry: 'NL', customerTaxId: 'NL123456789B01' }, 'reverse_charge_requires_cross_border'],
    ['a non-EU customer', { customerCountry: 'GB', customerTaxId: 'GB980780684' }, 'reverse_charge_requires_eu_customer'],
    ['a number from another country', { customerTaxId: 'FR40303265045' }, 'customer_vat_number_country_mismatch'],
    ['a checksum-invalid number', { customerTaxId: 'DE123456789' }, 'invalid_customer_vat_number'],
  ])('rejects %s', (_label, patch, code) => {
    expect(checkReverseCharge({
      supplierCountry: 'nl', customerCountry: 'DE', customerTaxId: 'DE136695976', ...patch,
    })).toBe(code)
  })

  it('resolves the customer country from a name as well as a code', () => {
    expect(checkReverseCharge({
      supplierCountry: 'nl', customerCountry: 'Germany', customerTaxId: 'DE136695976',
    })).toBeNull()
  })

  it('normalizes VAT numbers to a comparable form', () => {
    expect(normalizeVatNumber(' de 136 695 976 ')).toBe('DE136695976')
    expect(normalizeVatNumber(null)).toBe('')
  })
})

describe('invoiceReadiness — error message coverage', () => {
  // Each code must be presentable to a user on BOTH surfaces: the server's
  // English fallback sentence in the API envelope, and the SPA's localized
  // `issueErrors` block. A new code without copy would otherwise reach the user
  // as a bare identifier.
  it('gives every code a distinct English sentence on the server', () => {
    for (const code of INVOICE_ISSUE_ERROR_CODES) {
      const message = invoiceIssueMessage(code)
      expect(message).not.toBe(code)
      expect(message.length).toBeGreaterThan(10)
    }
  })

  it.each(['en', 'nl'])('translates every code in the %s invoices bundle', (lng) => {
    const bundle = JSON.parse(readFileSync(
      resolve(globalThis.process.cwd(), `src/i18n/${lng}/invoices.json`), 'utf8',
    ))
    expect(Object.keys(bundle.issueErrors).sort()).toEqual([...INVOICE_ISSUE_ERROR_CODES].sort())
    for (const message of Object.values(bundle.issueErrors)) {
      expect(String(message).length).toBeGreaterThan(10)
    }
  })
})
