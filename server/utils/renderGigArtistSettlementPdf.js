// Renders the post-show artist settlement for a gig. The financial values come
// from the shared deal engine, so this document and the Terms tab cannot drift.
// Like the itinerary, it is generated from a tenant-scoped snapshot and is not
// stored: download it after ticket sales and costs have been finalized.
import PDFDocument from 'pdfkit'
import {
  computeArtistStatement,
  computeSoldTicketShare,
  sumCostsCents,
} from '../../shared/gigDealEngine.js'
import { gigCopyrightPercentage, gigTicketVatPercentage } from '../../shared/gigDealVat.js'
import { createDocumentI18n, documentIntlLocale } from './documentI18n.js'

const getSettlementT = createDocumentI18n('artistSettlement')

const PAGE_MARGIN = 48
const PAGE_W = 595.28
const USABLE_W = PAGE_W - 2 * PAGE_MARGIN
const RIGHT_EDGE = PAGE_W - PAGE_MARGIN
const HEADER_LEFT_W = 200
const HEADER_GUTTER = 16
const HEADER_RIGHT_X = PAGE_MARGIN + HEADER_LEFT_W + HEADER_GUTTER
const HEADER_RIGHT_W = USABLE_W - HEADER_LEFT_W - HEADER_GUTTER
const HEADER_MARK_H = 55
const LABEL_W = 145
const VALUE_X = PAGE_MARGIN + LABEL_W
const VALUE_W = USABLE_W - LABEL_W
const AMOUNT_W = 115

const INK = '#000000'
const MUTED = '#555555'
const RULE = '#cccccc'
const HEADING_RULE = '#999999'
const TABLE_FILL = '#f2f2f2'

function bufferDocument(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

function hline(doc, y, color = RULE) {
  doc.moveTo(PAGE_MARGIN, y).lineTo(RIGHT_EDGE, y).strokeColor(color).lineWidth(0.5).stroke()
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

function fmtEventDate(value, locale, opts = {}) {
  if (!value) return null
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(locale, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC', ...opts,
  })
}

function fmtTimestamp(value, locale) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Amsterdam', timeZoneName: 'short',
  }).format(date)
}

function money(cents, locale) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' })
    .format((Number(cents) || 0) / 100)
}

function percentage(value, locale) {
  const number = Number(value)
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
    .format(Number.isFinite(number) ? number : 0)
}

function placeLines(place) {
  if (!place) return []
  return [
    place.name,
    place.organization_name,
    place.street_and_number,
    [place.postal_code, place.city].filter(Boolean).join(' '),
    place.region,
    place.country,
  ].map((line) => (typeof line === 'string' ? line.trim() : line)).filter(Boolean)
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
  doc.text(name, PAGE_MARGIN, y, {
    width: HEADER_LEFT_W, height: HEADER_MARK_H, ellipsis: true,
  })
}

function drawHeader(doc, gig, { logoBuffer, bandName }, { t, locale }) {
  const y = PAGE_MARGIN
  if (!drawLogo(doc, logoBuffer, y)) drawBandName(doc, bandName, y)

  const eventName = String(gig.event_description || '').trim() || t('eventFallback')
  doc.fontSize(16).font('Helvetica-Bold').fillColor(INK)
  doc.text(eventName, HEADER_RIGHT_X, y, { width: HEADER_RIGHT_W, align: 'right' })
  let metaY = Math.max(doc.y, y + 20) + 2

  const eventDate = fmtEventDate(gig.event_date, locale, { weekday: 'long' })
  doc.fontSize(10).font('Helvetica').fillColor(MUTED)
  if (eventDate) {
    doc.text(eventDate, HEADER_RIGHT_X, metaY, { width: HEADER_RIGHT_W, align: 'right' })
    metaY += 14
  }
  doc.fontSize(9).text(t('documentTitle'), HEADER_RIGHT_X, metaY, {
    width: HEADER_RIGHT_W, align: 'right',
  })
  metaY += 14

  const bottom = Math.max(metaY, y + HEADER_MARK_H + 5)
  hline(doc, bottom, HEADING_RULE)
  return bottom + 16
}

function infoRow(doc, y, label, value) {
  const lines = Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean)
  if (!lines.length) return y
  const text = lines.join('\n')
  doc.fontSize(9).font('Helvetica')
  const needed = doc.heightOfString(text, { width: VALUE_W }) + 4
  y = ensureSpace(doc, y, needed)
  doc.font('Helvetica-Bold').fillColor(MUTED).text(label, PAGE_MARGIN, y, { width: LABEL_W - 8 })
  doc.font('Helvetica').fillColor(INK).text(text, VALUE_X, y, { width: VALUE_W })
  return y + needed
}

function dealLabel(gig, t) {
  if (gig.deal_type === 'guarantee') {
    return gig.guarantee_variant === 'versus' ? t('dealTypes.guaranteeVersus') : t('dealTypes.guaranteePlus')
  }
  return t(`dealTypes.${gig.deal_type}`, { defaultValue: String(gig.deal_type || '') })
}

function feeTerm(gig, prefix, t, locale) {
  const basis = gig[`${prefix}_basis`]
  if (basis === 'percentage') {
    return t('percentageValue', { percentage: percentage(gig[`${prefix}_percentage`], locale) })
  }
  if (basis === 'amount') return money(gig[`${prefix}_amount_cents`], locale)
  return t('notAgreed')
}

function drawEventAndTerms(doc, gig, generatedAt, y, { t, locale }) {
  y = sectionTitle(doc, y, t('eventAndTerms'))
  y = infoRow(doc, y, t('venue'), placeLines(gig.venue).length ? placeLines(gig.venue) : t('notSet'))
  y = infoRow(doc, y, t('eventDate'), fmtEventDate(gig.event_date, locale, { weekday: 'long' }))
  y = infoRow(doc, y, t('settlementDate'), fmtTimestamp(generatedAt, locale))
  y = infoRow(doc, y, t('dealType'), dealLabel(gig, t))
  y = infoRow(doc, y, t('guaranteedFee'), money(gig.guaranteed_fee_cents, locale))
  y = infoRow(doc, y, t('artistTicketShare'), t('percentageValue', {
    percentage: percentage(gig.percentage_of_sales, locale),
  }))
  y = infoRow(doc, y, t('bookingFee'), feeTerm(gig, 'agency_fee', t, locale))
  y = infoRow(doc, y, t('commission'), feeTerm(gig, 'commission', t, locale))
  return y + 10
}

function tableHeader(doc, y, columns) {
  y = ensureSpace(doc, y, 24)
  doc.save().rect(PAGE_MARGIN, y - 3, USABLE_W, 20).fill(TABLE_FILL).restore()
  doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED)
  for (const column of columns) {
    doc.text(column.label, column.x, y, { width: column.width, align: column.align || 'left' })
  }
  return y + 22
}

function amountRow(doc, y, label, amount, locale, { bold = false, indent = 0 } = {}) {
  y = ensureSpace(doc, y, 18)
  doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK)
  doc.text(label, PAGE_MARGIN + indent, y, { width: USABLE_W - AMOUNT_W - indent - 8 })
  doc.text(money(amount, locale), RIGHT_EDGE - AMOUNT_W, y, { width: AMOUNT_W, align: 'right' })
  return y + 16
}

function drawRevenue(doc, gig, y, { t, locale }) {
  const sold = computeSoldTicketShare(gig)
  const visitors = gig.tickets_sold == null ? t('notSet') : String(Math.max(0, Number(gig.tickets_sold) || 0))
  const ticketPrice = gig.ticket_price_net_cents == null ? t('notSet') : money(gig.ticket_price_net_cents, locale)
  const grossCents = sold?.ticketRevenueCents ?? 0
  const vatCents = sold?.ticketVatCents ?? 0
  const copyrightCents = sold?.copyrightCents ?? 0
  const netCents = grossCents - vatCents - copyrightCents
  const vatRate = gigTicketVatPercentage(gig)
  const copyrightRate = gigCopyrightPercentage(gig)

  y = sectionTitle(doc, y, t('revenue'))
  const columns = [
    { label: t('revenueColumns.description'), x: PAGE_MARGIN, width: 205 },
    { label: t('revenueColumns.visitors'), x: PAGE_MARGIN + 205, width: 70, align: 'right' },
    { label: t('revenueColumns.ticketPrice'), x: PAGE_MARGIN + 285, width: 95, align: 'right' },
    { label: t('revenueColumns.gross'), x: RIGHT_EDGE - AMOUNT_W, width: AMOUNT_W, align: 'right' },
  ]
  y = tableHeader(doc, y, columns)
  doc.fontSize(9).font('Helvetica').fillColor(INK)
  doc.text(t('ticketSales'), columns[0].x, y, { width: columns[0].width })
  doc.text(visitors, columns[1].x, y, { width: columns[1].width, align: 'right' })
  doc.text(ticketPrice, columns[2].x, y, { width: columns[2].width, align: 'right' })
  doc.text(money(grossCents, locale), columns[3].x, y, { width: columns[3].width, align: 'right' })
  y += 18
  y = amountRow(doc, y, t('ticketVat', { percentage: percentage(vatRate, locale) }), -vatCents, locale)
  if (copyrightRate > 0) {
    y = amountRow(
      doc,
      y,
      t('copyright', { percentage: percentage(copyrightRate, locale) }),
      -copyrightCents,
      locale,
    )
  }
  hline(doc, y, RULE)
  const netLabel = copyrightRate > 0 ? t('netGrossAfterDeductions') : t('netGrossAfterVat')
  return amountRow(doc, y + 6, netLabel, netCents, locale, { bold: true }) + 8
}

function drawExpenses(doc, gig, costs, y, { t, locale }) {
  const venueCostsCents = Number(gig.venue_costs_cents) || 0
  const otherCostsCents = sumCostsCents(costs)
  y = sectionTitle(doc, y, t('expenses'))
  y = amountRow(doc, y, t('productionCosts'), venueCostsCents, locale)
  y = amountRow(doc, y, t('otherCosts'), otherCostsCents, locale)
  hline(doc, y, RULE)
  return amountRow(doc, y + 6, t('totalExpenses'), venueCostsCents + otherCostsCents, locale, { bold: true }) + 8
}

function drawSettlement(doc, gig, costs, y, { t, locale }) {
  const statement = computeArtistStatement({ ...gig, costs })
  y = sectionTitle(doc, y, t('settlement'))
  y = amountRow(doc, y, t('guaranteedFee'), statement.guaranteedFeeCents, locale)
  y = amountRow(doc, y, t('artistTicketRevenue'), statement.ticketRevenueCents, locale)
  y = amountRow(doc, y, t('grossArtistFee'), statement.grossFeeCents, locale, { bold: true })
  y = amountRow(doc, y, t('artistAgencyCosts'), -statement.costsPaidByArtistAgencyCents, locale)
  y = amountRow(doc, y, t('bookingFee'), -statement.agencyFeeCents, locale)
  y = amountRow(doc, y, t('commission'), -statement.commissionCents, locale)
  y = amountRow(doc, y, t('artistCosts'), -statement.costsPaidByArtistCents, locale)
  y = amountRow(doc, y, t('dueToBooker'), statement.dueToBookerCents, locale)
  hline(doc, y, HEADING_RULE)
  return amountRow(doc, y + 7, t('dueToArtist'), statement.dueToArtistCents, locale, { bold: true })
}

export async function renderGigArtistSettlementPdf({
  gig,
  costs = [],
  logoBuffer = null,
  bandName = '',
  lng = 'en',
  generatedAt = new Date(),
}) {
  const t = getSettlementT(lng)
  const locale = documentIntlLocale(lng)
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
  const done = bufferDocument(doc)

  let y = drawHeader(doc, gig, { logoBuffer, bandName }, { t, locale })
  y = drawEventAndTerms(doc, gig, generatedAt, y, { t, locale })
  y = drawRevenue(doc, gig, y, { t, locale })
  y = drawExpenses(doc, gig, costs, y, { t, locale })
  drawSettlement(doc, gig, costs, y, { t, locale })

  doc.end()
  return done
}
