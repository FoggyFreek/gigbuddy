import PDFDocument from 'pdfkit'
import { createDocumentI18n, documentIntlLocale } from './documentI18n.js'

const getContractT = createDocumentI18n('gigContract')

const PAGE_MARGIN = 48
const PAGE_W = 595.28
const USABLE_W = PAGE_W - 2 * PAGE_MARGIN
const RIGHT_EDGE = PAGE_W - PAGE_MARGIN
const HEADER_LEFT_W = 200
const HEADER_GUTTER = 16
const HEADER_RIGHT_X = PAGE_MARGIN + HEADER_LEFT_W + HEADER_GUTTER
const HEADER_RIGHT_W = USABLE_W - HEADER_LEFT_W - HEADER_GUTTER
const HEADER_MARK_H = 55
const LABEL_W = 175
const VALUE_X = PAGE_MARGIN + LABEL_W
const VALUE_W = USABLE_W - LABEL_W
const PARTY_GUTTER = 22
const PARTY_W = (USABLE_W - PARTY_GUTTER) / 2

const INK = '#000000'
const MUTED = '#555555'
const RULE = '#cccccc'
const HEADING_RULE = '#999999'

function bufferDocument(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

function hline(doc, y, color = RULE, x = PAGE_MARGIN, width = USABLE_W) {
  doc.moveTo(x, y).lineTo(x + width, y).strokeColor(color).lineWidth(0.5).stroke()
}

function ensureSpace(doc, y, needed) {
  if (y + needed <= doc.page.height - PAGE_MARGIN) return y
  doc.addPage()
  return PAGE_MARGIN
}

function sectionTitle(doc, y, title) {
  y = ensureSpace(doc, y, 60)
  doc.fontSize(13).font('Helvetica-Bold').fillColor(INK).text(title, PAGE_MARGIN, y)
  hline(doc, y + 18, HEADING_RULE)
  return y + 28
}

function fmtDate(value, locale, options = {}) {
  if (!value) return null
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(locale, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC', ...options,
  })
}

function fmtTime(value) {
  if (!value) return null
  const text = String(value).trim()
  return text ? text.slice(0, 5) : null
}

function timeRange(start, end, t) {
  const from = fmtTime(start)
  const until = fmtTime(end)
  if (from && until) return `${from} - ${until}`
  return from || until || t('notSet')
}

function money(cents, locale) {
  if (cents === null || cents === undefined || cents === '') return null
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' })
    .format(Number(cents) / 100)
}

function percentage(value, locale) {
  if (value === null || value === undefined || value === '') return null
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(value))}%`
}

function compactLines(values) {
  return values.map((value) => typeof value === 'string' ? value.trim() : value).filter(Boolean)
}

function tenantLines(tenant, t) {
  return compactLines([
    tenant.formal_name || tenant.display_name || tenant.band_name,
    tenant.address_street,
    [tenant.address_postal_code, tenant.address_city].filter(Boolean).join(' '),
    tenant.address_country,
    tenant.kvk_number ? t('registrationNumber', { value: tenant.kvk_number }) : null,
    tenant.tax_id ? t('taxId', { value: tenant.tax_id }) : null,
    tenant.email,
    tenant.phone,
  ])
}

function venueLines(venue, t = null) {
  return compactLines([
    venue.organization_name || venue.name,
    venue.street_and_number,
    [venue.postal_code, venue.city].filter(Boolean).join(' '),
    venue.region,
    venue.country,
    venue.kvk_number ? (t ? t('registrationNumber', { value: venue.kvk_number }) : venue.kvk_number) : null,
    venue.tax_id ? (t ? t('taxId', { value: venue.tax_id }) : venue.tax_id) : null,
    venue.email,
    venue.phone,
  ])
}

function drawLogo(doc, logoBuffer, y) {
  if (!logoBuffer) return false
  try {
    doc.image(logoBuffer, PAGE_MARGIN, y, { fit: [HEADER_LEFT_W, HEADER_MARK_H] })
    return true
  } catch {
    return false
  }
}

function drawBandName(doc, bandName, y) {
  const name = String(bandName || '').trim()
  if (!name) return
  doc.fontSize(18).font('Helvetica-Bold').fillColor(INK)
    .text(name, PAGE_MARGIN, y, { width: HEADER_LEFT_W, height: HEADER_MARK_H, ellipsis: true })
}

function drawHeader(doc, meta, { t, locale }) {
  const y = PAGE_MARGIN
  if (!drawLogo(doc, meta.logoBuffer, y)) drawBandName(doc, meta.bandName, y)

  doc.fontSize(16).font('Helvetica-Bold').fillColor(INK)
    .text(t('documentTitle'), HEADER_RIGHT_X, y, { width: HEADER_RIGHT_W, align: 'right' })
  let metaY = Math.max(doc.y, y + 20) + 2
  doc.fontSize(9).font('Helvetica').fillColor(MUTED)
  doc.text(fmtDate(meta.generatedAt, locale), HEADER_RIGHT_X, metaY, { width: HEADER_RIGHT_W, align: 'right' })
  metaY += 13

  const bottom = Math.max(metaY, y + HEADER_MARK_H + 5)
  hline(doc, bottom, HEADING_RULE)
  return bottom + 18
}

function drawAgreement(doc, tenant, venue, y, t) {
  y = ensureSpace(doc, y, 54)
  doc.fontSize(10).font('Helvetica').fillColor(INK)
    .text(t('agreement', {
      band: tenant.formal_name || tenant.display_name || tenant.band_name || t('bandFallback'),
      venue: venue.organization_name || venue.name || t('venueFallback'),
    }), PAGE_MARGIN, y, { width: USABLE_W, lineGap: 2 })
  return doc.y + 18
}

function drawParties(doc, tenant, venue, y, t) {
  y = sectionTitle(doc, y, t('parties'))
  const left = tenantLines(tenant, t)
  const right = venueLines(venue, t)
  doc.fontSize(10).font('Helvetica-Bold').fillColor(MUTED)
    .text(t('band'), PAGE_MARGIN, y, { width: PARTY_W })
  doc.text(t('venue'), PAGE_MARGIN + PARTY_W + PARTY_GUTTER, y, { width: PARTY_W })
  const bodyY = y + 17
  doc.fontSize(9).font('Helvetica').fillColor(INK)
    .text(left.join('\n') || t('notSet'), PAGE_MARGIN, bodyY, { width: PARTY_W })
  const leftBottom = doc.y
  doc.text(right.join('\n') || t('notSet'), PAGE_MARGIN + PARTY_W + PARTY_GUTTER, bodyY, { width: PARTY_W })
  return Math.max(leftBottom, doc.y) + 12
}

function infoRow(doc, y, label, value) {
  if (value === null || value === undefined || value === '') return y
  const text = String(value)
  doc.fontSize(9).font('Helvetica')
  const needed = doc.heightOfString(text, { width: VALUE_W }) + 4
  y = ensureSpace(doc, y, needed)
  doc.font('Helvetica-Bold').fillColor(MUTED).text(label, PAGE_MARGIN, y, { width: LABEL_W - 8 })
  doc.font('Helvetica').fillColor(INK).text(text, VALUE_X, y, { width: VALUE_W })
  return y + needed
}

function dealType(gig, t) {
  if (gig.deal_type === 'guarantee') {
    return gig.guarantee_variant === 'versus' ? t('dealTypes.guaranteeVersus') : t('dealTypes.guaranteePlus')
  }
  return t(`dealTypes.${gig.deal_type}`, { defaultValue: String(gig.deal_type || '') })
}

function feeTerm(gig, prefix, t, locale) {
  const basis = gig[`${prefix}_basis`]
  if (basis === 'percentage') return percentage(gig[`${prefix}_percentage`], locale)
  if (basis === 'amount') return money(gig[`${prefix}_amount_cents`], locale)
  return t('notAgreed')
}

function drawGigDetails(doc, gig, venue, y, { t, locale }) {
  y = sectionTitle(doc, y, t('performance'))
  y = infoRow(doc, y, t('event'), gig.event_description || t('eventFallback'))
  y = infoRow(doc, y, t('date'), fmtDate(gig.event_date, locale, { weekday: 'long' }))
  if (gig.end_date && String(gig.end_date).slice(0, 10) !== String(gig.event_date).slice(0, 10)) {
    y = infoRow(doc, y, t('endDate'), fmtDate(gig.end_date, locale, { weekday: 'long' }))
  }
  y = infoRow(doc, y, t('time'), timeRange(gig.start_time, gig.end_time, t))
  y = infoRow(doc, y, t('location'), venueLines(venue).slice(0, 4).join(', ') || t('notSet'))
  return y + 10
}

function drawDealTerms(doc, gig, y, { t, locale }) {
  y = sectionTitle(doc, y, t('dealTerms'))
  y = infoRow(doc, y, t('dealType'), dealType(gig, t))
  y = infoRow(doc, y, t('guaranteedFee'), money(gig.guaranteed_fee_cents, locale) || t('notAgreed'))
  y = infoRow(doc, y, t('artistShare'), percentage(gig.percentage_of_sales, locale) || t('notAgreed'))
  if (gig.deal_type !== 'flat_fee') {
    y = infoRow(doc, y, t('breakEven'), gig.breakeven_includes_venue_costs ? t('productionCostsIncluded') : t('productionCostsExcluded'))
  }
  y = infoRow(doc, y, t('productionCosts'), money(gig.venue_costs_cents, locale) || t('notAgreed'))
  y = infoRow(doc, y, t('ticketPriceNet'), money(gig.ticket_price_net_cents, locale) || t('notAgreed'))
  y = infoRow(doc, y, t('ticketPriceGross'), money(gig.ticket_price_gross_cents, locale) || t('notAgreed'))
  y = infoRow(doc, y, t('bookingFee'), feeTerm(gig, 'agency_fee', t, locale))
  y = infoRow(doc, y, t('commission'), feeTerm(gig, 'commission', t, locale))
  y = infoRow(doc, y, t('vatTreatment'), gig.subject_to_vat ? t('subjectToVat') : t('notSubjectToVat'))
  if (gig.subject_to_vat) {
    y = infoRow(doc, y, t('vatRate'), percentage(gig.vat_percentage, locale) || t('notAgreed'))
    y = infoRow(doc, y, t('ticketVatRate'), percentage(gig.ticket_vat_percentage, locale) || t('notAgreed'))
    y = infoRow(doc, y, t('copyrightRate'), percentage(gig.copyright_percentage, locale) || t('notAgreed'))
  }
  return y + 10
}

function drawCosts(doc, costs, y, { t, locale }) {
  if (!costs.length) return y
  y = sectionTitle(doc, y, t('costs'))
  for (const cost of costs) {
    y = infoRow(doc, y, cost.label || t('cost'), t('costValue', {
      amount: money(cost.amount_cents, locale),
      payer: t(`costPayers.${cost.paid_by || 'artist'}`),
    }))
  }
  return y + 10
}

function signatureBlock(doc, x, y, title, partyName, t) {
  doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text(title, x, y, { width: PARTY_W })
  doc.fontSize(9).font('Helvetica').text(partyName, x, y + 18, { width: PARTY_W, height: 28, ellipsis: true })
  let lineY = y + 66
  for (const label of [t('signature.name'), t('signature.signature'), t('signature.date')]) {
    doc.fontSize(8).font('Helvetica').fillColor(MUTED).text(`${label}:`, x, lineY, { width: 58 })
    hline(doc, lineY + 10, RULE, x + 58, PARTY_W - 58)
    lineY += 35
  }
}

function drawSignatures(doc, tenant, venue, y, t) {
  y = ensureSpace(doc, y, 215)
  y = sectionTitle(doc, y, t('signatures'))
  signatureBlock(doc, PAGE_MARGIN, y, t('forBand'), tenant.formal_name || tenant.display_name || tenant.band_name || '', t)
  signatureBlock(doc, PAGE_MARGIN + PARTY_W + PARTY_GUTTER, y, t('forVenue'), venue.organization_name || venue.name || '', t)
}

export async function renderGigContractPdf({
  gig,
  tenant = {},
  venue = gig?.venue ?? {},
  costs = [],
  logoBuffer = null,
  bandName = '',
  generatedAt = new Date(),
  lng = 'en',
}) {
  const t = getContractT(lng)
  const locale = documentIntlLocale(lng)
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
  const done = bufferDocument(doc)

  let y = drawHeader(doc, { logoBuffer, bandName, generatedAt }, { t, locale })
  y = drawAgreement(doc, tenant, venue, y, t)
  y = drawParties(doc, tenant, venue, y, t)
  y = drawGigDetails(doc, gig, venue, y, { t, locale })
  y = drawDealTerms(doc, gig, y, { t, locale })
  y = drawCosts(doc, costs, y, { t, locale })
  drawSignatures(doc, tenant, venue, y, t)

  doc.end()
  return done
}
