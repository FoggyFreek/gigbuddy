import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { computeInvoiceTotals } from './computeInvoiceTotals.js'
import { logger } from './logger.js'
import { getRegistrationLabel, getRegistrationOfficeLabel, requiresCompanyDisclosure } from '../../shared/businessRegistry.js'
import { normalizeVatCountry, getVatLabel, getVatIdLabel } from '../../shared/vatRates.js'
import { resolveInvoiceLng, getInvoiceT, invoiceIntlLocale } from './invoiceI18n.js'

const PAGE_MARGIN = 48
const PAGE_W = 595.28   // A4 width in points
const USABLE_W = PAGE_W - 2 * PAGE_MARGIN   // ≈ 499
const RIGHT_EDGE = PAGE_W - PAGE_MARGIN      // ≈ 547

// Line-items table column widths
const COL_DESC  = 190
const COL_QTY   = 55
const COL_PRICE = 85
const COL_VAT   = 50
const COL_TOTAL = USABLE_W - COL_DESC - COL_QTY - COL_PRICE - COL_VAT  // ≈ 119

// Totals block — right-aligned; label | value occupy the rightmost 270pt
const TOT_W     = 270
const TOT_VAL_W = 95
const TOT_LBL_W = TOT_W - TOT_VAL_W   // 175
const TOT_X     = RIGHT_EDGE - TOT_W   // ≈ 277
const TOT_VAL_X = RIGHT_EDGE - TOT_VAL_W

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(cents, locale = 'nl-NL') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100)
}

function fmtDate(value, locale = 'nl-NL') {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtQty(q) {
  const n = Number(q) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function hline(doc, x1, x2, y, color = '#cccccc') {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(0.5).stroke()
}

function bufferDocument(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end',  () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

// ─── main ─────────────────────────────────────────────────────────────────────

export async function renderInvoicePdf({ invoice, lines, tenant, logoBuffer }) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
  const done = bufferDocument(doc)

  const totals = computeInvoiceTotals({
    lines,
    taxInclusive: invoice.tax_inclusive,
    discountType: invoice.discount_type,
    discountPct:  invoice.discount_pct,
    discountCents: invoice.discount_cents,
    appliesKor: tenant.applies_kor,
    reverseCharge: invoice.reverse_charge,
  })
  // Both KOR and reverse charge zero the VAT, so the line table and totals hide
  // the VAT column; the reason is spelled out in a note under the totals.
  const noVat = Boolean(tenant.applies_kor) || Boolean(invoice.reverse_charge)
  // Invoice is issued by the supplier, so the VAT term follows the supplier's
  // country (btw / USt / TVA / …).
  const vatLabel = getVatLabel(tenant.vat_country)
  // The whole document is localized to the supplier's country language (Dutch
  // for NL/BE, English otherwise); money and dates format for that locale.
  const lng = resolveInvoiceLng(tenant.vat_country)
  const t = getInvoiceT(lng)
  const locale = invoiceIntlLocale(lng)

  // Generate QR code buffer if a payment link exists.
  let qrBuffer = null
  if (invoice.mollie_payment_link_url) {
    try {
      qrBuffer = await QRCode.toBuffer(invoice.mollie_payment_link_url, {
        type: 'png',
        width: 200,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      })
    } catch (err) {
      logger.warn('invoice_pdf.qr_generation_failed', { err })
    }
  }

  const ctx = { t, locale }
  const titleBottom = drawTitle(doc, invoice, tenant, logoBuffer, ctx)
  const addrBottom  = drawAddresses(doc, invoice, tenant, titleBottom + 20, ctx)
  hline(doc, PAGE_MARGIN, RIGHT_EDGE, addrBottom + 8)
  const linesBottom = drawLinesTable(doc, lines, totals.perLine, invoice.tax_inclusive, noVat, vatLabel, addrBottom + 24, ctx)
  const totalsBottom = drawTotals(doc, totals, noVat, vatLabel, linesBottom, ctx)
  drawVatNotes(doc, invoice, tenant, totalsBottom, ctx)
  drawFooter(doc, invoice, tenant, qrBuffer, ctx)

  doc.end()
  return done
}

// ─── title row ────────────────────────────────────────────────────────────────
// Logo top-left; "Factuur #xxx" large top-right; date + payment terms below.

function drawTitle(doc, invoice, tenant, logoBuffer, { t, locale }) {
  const y = PAGE_MARGIN

  // Logo — top left, max 90×55 pt
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, PAGE_MARGIN, y, { fit: [90, 55] })
    } catch {
      // ignore bad image; fall through to text fallback below
    }
  }

  // Invoice title — large, right-aligned
  const titleText = t('invoiceTitle', { number: invoice.invoice_number || t('draftNumber') })
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#000')
  doc.text(titleText, PAGE_MARGIN, y, { width: USABLE_W, align: 'right' })

  // Date + payment terms — smaller, right-aligned below title
  doc.fontSize(9).font('Helvetica').fillColor('#444')
  let metaY = y + 30
  doc.text(`${t('issueDate')}: ${fmtDate(invoice.issue_date, locale)}`, PAGE_MARGIN, metaY, { width: USABLE_W, align: 'right' })
  metaY += 13
  // Date of supply (art. 226(7)) — shown when it differs from the issue date.
  if (invoice.supply_date && fmtDate(invoice.supply_date, locale) !== fmtDate(invoice.issue_date, locale)) {
    doc.text(`${t('supplyDate')}: ${fmtDate(invoice.supply_date, locale)}`, PAGE_MARGIN, metaY, { width: USABLE_W, align: 'right' })
    metaY += 13
  }
  if (invoice.payment_term_days) {
    doc.text(t('paymentTerm', { count: invoice.payment_term_days }), PAGE_MARGIN, metaY, { width: USABLE_W, align: 'right' })
    metaY += 13
  }
  if (invoice.due_date) {
    doc.text(`${t('dueDate')}: ${fmtDate(invoice.due_date, locale)}`, PAGE_MARGIN, metaY, { width: USABLE_W, align: 'right' })
    metaY += 13
  }

  // Return bottom of the title block (at least logo height)
  return Math.max(metaY, y + 60)
}

// ─── address columns ──────────────────────────────────────────────────────────
// Sender (band) details left-aligned; customer right-aligned.

function drawAddresses(doc, invoice, tenant, startY, { t }) {
  const colW = Math.floor(USABLE_W / 2) - 10
  const rightColX = PAGE_MARGIN + colW + 20

  // ── left: band / sender ──
  let leftY = startY
  const senderName = tenant.formal_name || tenant.band_name || ''
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
  doc.text(senderName, PAGE_MARGIN, leftY, { width: colW })
  leftY += 14

  doc.fontSize(9).font('Helvetica').fillColor('#000')
  for (const line of [
    tenant.address_street,
    [tenant.address_postal_code, tenant.address_city].filter(Boolean).join(' '),
    tenant.address_country,
  ].filter(Boolean)) {
    doc.text(line, PAGE_MARGIN, leftY, { width: colW })
    leftY += 12
  }

  // Contact
  const contactLines = [tenant.email, tenant.phone, tenant.website].filter(Boolean)
  if (contactLines.length) leftY += 4
  for (const line of contactLines) {
    doc.text(line, PAGE_MARGIN, leftY, { width: colW })
    leftY += 12
  }

  // Registration numbers — labelled by the supplier's VAT country (KvK,
  // Handelsregister, SIREN, …) with the court/city/province where applicable.
  const regLabel = getRegistrationLabel(tenant.vat_country)
  const officeLabel = getRegistrationOfficeLabel(tenant.vat_country)
  const regLines = [
    tenant.kvk_number && regLabel ? `${regLabel}: ${tenant.kvk_number}` : null,
    tenant.kvk_number && tenant.registration_office && officeLabel
      ? `${officeLabel}: ${tenant.registration_office}` : null,
    tenant.tax_id     ? `${getVatIdLabel(tenant.vat_country)}: ${tenant.tax_id}` : null,
    // Company-law disclosure (e.g. Germany's GmbHG §35a): only an incorporated
    // band lists its managing directors on the invoice.
    requiresCompanyDisclosure(tenant.legal_form) && tenant.directors
      ? `${t('directors')}: ${tenant.directors}` : null,
  ].filter(Boolean)
  if (regLines.length) {
    leftY += 4
    doc.fontSize(8).fillColor('#555')
    for (const line of regLines) {
      doc.text(line, PAGE_MARGIN, leftY, { width: colW })
      leftY += 11
    }
  }

  // ── right: customer ──
  let rightY = startY
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
  doc.text(invoice.customer_name || '', rightColX, rightY, { width: colW, align: 'right' })
  rightY += 14

  doc.fontSize(9).font('Helvetica').fillColor('#000')

  // Contact person line: "t.a.v. [title] [given_name] [family_name]"
  const contactParts = [
    invoice.customer_contact_title,
    invoice.customer_contact_given_name,
    invoice.customer_contact_family_name,
  ].filter(Boolean)
  if (contactParts.length) {
    doc.text(`${t('attnPrefix')} ${contactParts.join(' ')}`, rightColX, rightY, { width: colW, align: 'right' })
    rightY += 12
  }

  const custCountry = normalizeVatCountry(invoice.customer_address_country)
  const customerRegLabel = (custCountry && getRegistrationLabel(custCountry)) || 'Reg.'
  const customerVatIdLabel = custCountry ? getVatIdLabel(custCountry) : 'VAT no.'
  for (const line of [
    invoice.customer_address_street,
    [invoice.customer_address_postal_code, invoice.customer_address_city].filter(Boolean).join(' '),
    invoice.customer_address_country,
    invoice.customer_email,
    invoice.customer_kvk ? `${customerRegLabel}: ${invoice.customer_kvk}` : null,
    invoice.customer_tax_id ? `${customerVatIdLabel}: ${invoice.customer_tax_id}` : null,
  ].filter(Boolean)) {
    doc.text(line, rightColX, rightY, { width: colW, align: 'right' })
    rightY += 12
  }

  return Math.max(leftY, rightY)
}

// ─── line items table ─────────────────────────────────────────────────────────

function drawLinesTable(doc, lines, perLine, taxInclusive, noVat, vatLabel, startY, { t, locale }) {
  const sx = PAGE_MARGIN
  let y = startY

  // Column x positions
  const xQty   = sx + COL_DESC
  const xPrice = xQty + COL_QTY
  const xVat   = xPrice + COL_PRICE
  const xTotal = xVat + (noVat ? 0 : COL_VAT)
  // With no VAT (KOR / reverse charge), merge the VAT column into total width
  const totalW = noVat ? COL_VAT + COL_TOTAL : COL_TOTAL

  // Header
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#888')
  doc.text(t('colDescription'), sx,     y, { width: COL_DESC - 8 })
  doc.text(t('colQuantity'),    xQty,   y, { width: COL_QTY,   align: 'right' })
  doc.text(t('colPriceExclVat', { vat: vatLabel }), xPrice, y, { width: COL_PRICE, align: 'right' })
  if (!noVat) doc.text(vatLabel, xVat, y, { width: COL_VAT, align: 'right' })
  doc.text(t('colTotal'), xTotal, y, { width: totalW, align: 'right' })

  hline(doc, sx, RIGHT_EDGE, y + 14)
  y += 22

  // Rows
  doc.fontSize(10).font('Helvetica').fillColor('#000')
  lines.forEach((line, idx) => {
    const lt = perLine[idx] || { netCents: 0, grossCents: 0 }
    // Always show the line total net of VAT (the VAT is broken out in the totals);
    // under KOR / reverse charge net == gross since no VAT is charged.
    const displayTotal = lt.netCents
    // Art. 226(10): the unit price must be shown EXCLUDING VAT. In tax-inclusive
    // mode the entered price is gross, so derive the net unit price.
    const rate = Number(line.tax_percentage) || 0
    const unitCents = Number(line.unit_price_cents) || 0
    const displayUnit = (taxInclusive && !noVat && rate > 0)
      ? Math.round((unitCents * 100) / (100 + rate))
      : unitCents
    const descH = doc.heightOfString(line.description || '', { width: COL_DESC - 8 })

    doc.text(line.description || '', sx,     y, { width: COL_DESC - 8 })
    doc.text(fmtQty(line.quantity),  xQty,   y, { width: COL_QTY,   align: 'right' })
    doc.text(fmt(displayUnit, locale), xPrice, y, { width: COL_PRICE, align: 'right' })
    if (!noVat) {
      doc.text(`${Number(line.tax_percentage).toFixed(0)}%`, xVat, y, { width: COL_VAT, align: 'right' })
    }
    doc.text(fmt(displayTotal, locale), xTotal, y, { width: totalW, align: 'right' })

    y += Math.max(descH, 12) + 8
    hline(doc, sx, RIGHT_EDGE, y - 4, '#eeeeee')
  })

  return y + 10
}

// ─── totals block ─────────────────────────────────────────────────────────────

function totRow(doc, label, value, y, { bold = false, fontSize = 10 } = {}) {
  doc.fontSize(fontSize).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000')
  doc.text(label, TOT_X,     y, { width: TOT_LBL_W })
  doc.text(value, TOT_VAL_X, y, { width: TOT_VAL_W, align: 'right' })
}

function drawTotals(doc, totals, noVat, vatLabel, startY, { t, locale }) {
  let y = startY
  hline(doc, TOT_X, RIGHT_EDGE, y)
  y += 10

  totRow(doc, t('subtotal'), fmt(totals.subtotalCents, locale), y)
  y += 16

  if (totals.discountCents > 0) {
    totRow(doc, t('discount'), `- ${fmt(totals.discountCents, locale)}`, y)
    y += 10
    hline(doc, TOT_X, RIGHT_EDGE, y)
    y += 8
    totRow(doc, t('subtotalAfterDiscount'), fmt(totals.subtotalCents - totals.discountCents, locale), y)
    y += 16
  }

  // No VAT is charged under KOR or reverse charge; the reason is stated in the
  // note below the totals (drawVatNotes), so no VAT rows are shown here.
  if (!noVat) {
    for (const { rate, cents } of totals.vatByRate) {
      totRow(doc, t('vatTotal', { vat: vatLabel, rate }), fmt(cents, locale), y)
      y += 16
    }
  }

  hline(doc, TOT_X, RIGHT_EDGE, y)
  y += 8
  totRow(doc, t('total'), fmt(totals.totalCents, locale), y)
  y += 14

  hline(doc, TOT_X, RIGHT_EDGE, y)
  y += 8
  totRow(doc, t('amountDue'), fmt(totals.totalCents, locale), y, { bold: true, fontSize: 11 })
  return y + 20
}

// Legally-required VAT notes under the totals (EU VAT Directive art. 226):
// reverse-charge notation, or the KOR exemption reference. Reverse charge takes
// precedence (an invoice is one or the other, never both).
function drawVatNotes(doc, invoice, tenant, startY, { t }) {
  let y = startY
  doc.fontSize(8).font('Helvetica').fillColor('#555')
  if (invoice.reverse_charge) {
    doc.text(t('reverseChargeNote'), PAGE_MARGIN, y, { width: USABLE_W })
    y += 12
  } else if (tenant.applies_kor) {
    doc.text(t('korNote'), PAGE_MARGIN, y, { width: USABLE_W })
    y += 12
  }
  return y
}

// ─── footer ───────────────────────────────────────────────────────────────────

const QR_SIZE   = 65  // pt — rendered size of the QR code image in the PDF
const QR_GAP    = 10  // pt — gap between QR code and text column

function drawFooter(doc, invoice, tenant, qrBuffer, { t }) {
  const hasQr = Boolean(qrBuffer)

  // Reserve extra vertical space when a QR code is present.
  const footerHeight = hasQr ? QR_SIZE + 20 : 48
  const y = doc.page.height - PAGE_MARGIN - footerHeight

  hline(doc, PAGE_MARGIN, RIGHT_EDGE, y - 8, '#cccccc')

  if (hasQr) {
    // QR code — bottom-left
    try {
      doc.image(qrBuffer, PAGE_MARGIN, y, { fit: [QR_SIZE, QR_SIZE] })
    } catch {
      // ignore render failure; fall through to text-only footer
    }
    doc.fontSize(7).font('Helvetica').fillColor('#888')
    doc.text(t('scanToPay'), PAGE_MARGIN, y + QR_SIZE + 3, {
      width: QR_SIZE,
      align: 'center',
    })
  }

  // Payment instruction text — shifted right when QR is present
  const textX = hasQr ? PAGE_MARGIN + QR_SIZE + QR_GAP : PAGE_MARGIN
  const textW = hasQr ? USABLE_W - QR_SIZE - QR_GAP    : USABLE_W
  const textY = y + (hasQr ? 4 : 0)

  doc.fontSize(9).font('Helvetica').fillColor('#555')
  const days = invoice.payment_term_days || 14
  const payLine = tenant.iban
    ? t('paymentInstructionIban', {
        count: days,
        iban: tenant.iban,
        name: tenant.formal_name || tenant.band_name || '',
        number: invoice.invoice_number,
      })
    : t('paymentInstruction', { count: days, number: invoice.invoice_number })
  doc.text(payLine, textX, textY, { width: textW })

  if (invoice.memo) {
    doc.fillColor('#333').text(invoice.memo, textX, textY + 20, { width: textW })
  }
}
