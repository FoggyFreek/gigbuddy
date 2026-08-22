// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderGigContractPdf } from '../../../../server/utils/renderGigContractPdf.js'

async function pdfPageTexts(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise
  const pages = []
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent()
    pages.push(content.items.map((item) => item.str).join(' '))
  }
  return pages
}

const pdfText = async (buffer) => (await pdfPageTexts(buffer)).join(' ')

const gig = {
  event_description: 'Paradiso Night',
  event_date: '2026-09-12',
  start_time: '20:00:00',
  end_time: '23:30:00',
  deal_type: 'guarantee',
  guarantee_variant: 'versus',
  guaranteed_fee_cents: 125000,
  percentage_of_sales: '72.5',
  breakeven_includes_venue_costs: true,
  venue_costs_cents: 18000,
  venue_capacity: 1500,
  expected_visitors: 900,
  ticket_price_net_cents: 2250,
  ticket_price_gross_cents: 2450,
  agency_fee_basis: 'percentage',
  agency_fee_percentage: '10',
  agency_fee_amount_cents: 0,
  commission_basis: 'amount',
  commission_percentage: '0',
  commission_amount_cents: 7500,
  subject_to_vat: true,
  vat_percentage: '9',
  ticket_vat_percentage: '9',
  copyright_percentage: '3',
  venue: {
    name: 'Paradiso',
    organization_name: 'Stichting Paradiso',
    street_and_number: 'Weteringschans 6-8',
    postal_code: '1017 SG',
    city: 'Amsterdam',
    country: 'NL',
    kvk_number: 'VENUE-123',
    tax_id: 'NLVENUE01',
  },
}

const tenant = {
  display_name: 'The Testing Tones',
  formal_name: 'Testing Tones B.V.',
  address_street: 'Bandstraat 1',
  address_postal_code: '1234 AB',
  address_city: 'Utrecht',
  address_country: 'NL',
  kvk_number: 'BAND-456',
  tax_id: 'NLBAND01',
}

function render(overrides = {}) {
  return renderGigContractPdf({
    gig,
    tenant,
    costs: [
      { label: 'Backline', amount_cents: 15000, paid_by: 'artist_agency' },
      { label: 'Travel', amount_cents: 20000, paid_by: 'artist' },
    ],
    generatedAt: new Date('2026-08-22T10:00:00Z'),
    lng: 'en',
    ...overrides,
  })
}

describe('renderGigContractPdf', () => {
  it('renders the agreement, parties, gig and every agreed deal term', async () => {
    const buffer = await render()
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')

    const text = await pdfText(buffer)
    expect(text).toContain('Performance agreement')
    expect(text).not.toContain('Reference')
    expect(text).not.toContain('Version')
    expect(text).toContain('Testing Tones B.V.')
    expect(text).toContain('Stichting Paradiso')
    expect(text).toContain('agree to the performance and deal terms listed below')
    expect(text).toContain('Paradiso Night')
    expect(text).toContain('12 September 2026')
    expect(text).toContain('20:00 - 23:30')
    expect(text).toContain('Guarantee versus')
    expect(text).toContain('€1,250.00')
    expect(text).toContain('72.5%')
    expect(text).toContain('Production costs included')
    expect(text).toContain('Production costs')
    expect(text).toContain('€180.00')
    expect(text).not.toContain('Venue capacity')
    expect(text).not.toContain('Expected visitors')
    expect(text).toContain('€22.50')
    expect(text).toContain('€24.50')
    expect(text).toContain('10%')
    expect(text).toContain('€75.00')
    expect(text).toContain('Subject to VAT')
    expect(text).toContain('9%')
    expect(text).toContain('3%')
    expect(text).toContain('Backline')
    expect(text).toContain('Travel')
  })

  it('includes signature lines for the band and venue', async () => {
    const buffer = await render()
    const text = await pdfText(buffer)

    expect(text).toContain('For the band')
    expect(text).toContain('For the venue')
    expect(text.match(/Name:/g)).toHaveLength(2)
    expect(text.match(/Signature:/g)).toHaveLength(2)
    expect(text.match(/Date:/g)).toHaveLength(2)
    expect((await pdfPageTexts(buffer)).at(-1).replaceAll(/\s+/g, ' ')).toContain('Agreement For the band')
  })

  it('localizes the fact-only contract in Dutch', async () => {
    const text = await pdfText(await render({ lng: 'nl' }))

    expect(text).toContain('Optredenovereenkomst')
    expect(text).toContain('komen het optreden en de hieronder vermelde afspraken overeen')
    expect(text).toContain('12 september 2026')
    expect(text).toContain('Productiekosten inbegrepen')
    expect(text).toContain('Productiekosten')
    expect(text).not.toContain('Capaciteit locatie')
    expect(text).not.toContain('Verwachte bezoekers')
    expect(text).toContain('Voor de band')
    expect(text).toContain('Voor de locatie')
  })
})
