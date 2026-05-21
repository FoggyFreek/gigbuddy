import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { computeInvoiceTotals } from './computeInvoiceTotals.js'

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

function fmt(cents) {
  const sign = cents < 0 ? '- ' : ''
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100)
  const rem = String(abs % 100).padStart(2, '0')
  return `${sign}€ ${euros.toLocaleString('nl-NL')},${rem}`
}

function fmtDate(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
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
  })

  let effectiveLogo = logoBuffer
  if (logoBuffer && invoice.invert_logo) {
    try {
      effectiveLogo = await sharp(logoBuffer).negate({ alpha: false }).toBuffer()
    } catch {
      effectiveLogo = logoBuffer
    }
  }

  const titleBottom    = drawTitle(doc, invoice, tenant, effectiveLogo)
  const addrBottom     = drawAddresses(doc, invoice, tenant, titleBottom + 20)
  hline(doc, PAGE_MARGIN, RIGHT_EDGE, addrBottom + 8)
  const linesBottom    = drawLinesTable(doc, lines, totals.perLine, invoice.tax_inclusive, tenant.applies_kor, addrBottom + 24)
  drawTotals(doc, totals, tenant.applies_kor, linesBottom)
  drawFooter(doc, invoice, tenant)

  doc.end()
  return done
}

// ─── title row ────────────────────────────────────────────────────────────────
// Logo top-left; "Factuur #xxx" large top-right; date + payment terms below.

function drawTitle(doc, invoice, tenant, logoBuffer) {
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
  const titleText = `Factuur #${invoice.invoice_number || 'concept'}`
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#000')
  doc.text(titleText, PAGE_MARGIN, y, { width: USABLE_W, align: 'right' })

  // Date + payment terms — smaller, right-aligned below title
  doc.fontSize(9).font('Helvetica').fillColor('#444')
  let metaY = y + 30
  doc.text(`Datum van uitgifte: ${fmtDate(invoice.issue_date)}`, PAGE_MARGIN, metaY, { width: USABLE_W, align: 'right' })
  metaY += 13
  if (invoice.payment_term_days) {
    doc.text(`Betaalvoorwaarden: Binnen ${invoice.payment_term_days} dagen`, PAGE_MARGIN, metaY, { width: USABLE_W, align: 'right' })
    metaY += 13
  }
  if (invoice.due_date) {
    doc.text(`Vervaldatum: ${fmtDate(invoice.due_date)}`, PAGE_MARGIN, metaY, { width: USABLE_W, align: 'right' })
    metaY += 13
  }

  // Return bottom of the title block (at least logo height)
  return Math.max(metaY, y + 60)
}

// ─── address columns ──────────────────────────────────────────────────────────
// Sender (band) details left-aligned; customer right-aligned.

function drawAddresses(doc, invoice, tenant, startY) {
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

  // Registration numbers
  const regLines = [
    tenant.kvk_number ? `KVK: ${tenant.kvk_number}` : null,
    tenant.tax_id     ? `BTW: ${tenant.tax_id}`      : null,
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
    doc.text(`t.a.v. ${contactParts.join(' ')}`, rightColX, rightY, { width: colW, align: 'right' })
    rightY += 12
  }

  for (const line of [
    invoice.customer_address_street,
    [invoice.customer_address_postal_code, invoice.customer_address_city].filter(Boolean).join(' '),
    invoice.customer_address_country,
    invoice.customer_email,
    invoice.customer_kvk ? `KVK: ${invoice.customer_kvk}` : null,
    invoice.customer_tax_id ? `BTW: ${invoice.customer_tax_id}` : null,
  ].filter(Boolean)) {
    doc.text(line, rightColX, rightY, { width: colW, align: 'right' })
    rightY += 12
  }

  return Math.max(leftY, rightY)
}

// ─── line items table ─────────────────────────────────────────────────────────

function drawLinesTable(doc, lines, perLine, taxInclusive, appliesKor, startY) {
  const sx = PAGE_MARGIN
  let y = startY

  // Column x positions
  const xQty   = sx + COL_DESC
  const xPrice = xQty + COL_QTY
  const xVat   = xPrice + COL_PRICE
  const xTotal = xVat + (appliesKor ? 0 : COL_VAT)
  // When KOR, merge the VAT column into total width
  const totalW = appliesKor ? COL_VAT + COL_TOTAL : COL_TOTAL

  // Header
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#888')
  doc.text('Beschrijving', sx,     y, { width: COL_DESC - 8 })
  doc.text('Aantal',       xQty,   y, { width: COL_QTY,   align: 'right' })
  doc.text('Prijs',        xPrice, y, { width: COL_PRICE, align: 'right' })
  if (!appliesKor) doc.text('BTW', xVat, y, { width: COL_VAT, align: 'right' })
  doc.text('Totaal', xTotal, y, { width: totalW, align: 'right' })

  hline(doc, sx, RIGHT_EDGE, y + 14)
  y += 22

  // Rows
  doc.fontSize(10).font('Helvetica').fillColor('#000')
  lines.forEach((line, idx) => {
    const lt = perLine[idx] || { netCents: 0, grossCents: 0 }
    // Show the entered price × qty: net for exclusive VAT, gross for inclusive
    const displayTotal = taxInclusive ? lt.grossCents : lt.netCents
    const descH = doc.heightOfString(line.description || '', { width: COL_DESC - 8 })

    doc.text(line.description || '', sx,     y, { width: COL_DESC - 8 })
    doc.text(fmtQty(line.quantity),  xQty,   y, { width: COL_QTY,   align: 'right' })
    doc.text(fmt(line.unit_price_cents), xPrice, y, { width: COL_PRICE, align: 'right' })
    if (!appliesKor) {
      doc.text(`${Number(line.tax_percentage).toFixed(0)}%`, xVat, y, { width: COL_VAT, align: 'right' })
    }
    doc.text(fmt(displayTotal), xTotal, y, { width: totalW, align: 'right' })

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

function drawTotals(doc, totals, appliesKor, startY) {
  let y = startY
  hline(doc, TOT_X, RIGHT_EDGE, y)
  y += 10

  totRow(doc, 'Subtotaal', fmt(totals.subtotalCents), y)
  y += 16

  if (totals.discountCents > 0) {
    totRow(doc, 'Korting', `- ${fmt(totals.discountCents)}`, y)
    y += 10
    hline(doc, TOT_X, RIGHT_EDGE, y)
    y += 8
    totRow(doc, 'Subtotaal met korting', fmt(totals.subtotalCents - totals.discountCents), y)
    y += 16
  }

  if (!appliesKor) {
    for (const { rate, cents } of totals.vatByRate) {
      totRow(doc, `Totaal BTW (${rate}%)`, fmt(cents), y)
      y += 16
    }
  } else {
    doc.fontSize(8).font('Helvetica').fillColor('#666')
    doc.text('Kleine ondernemersregeling — geen BTW in rekening gebracht.', TOT_X, y, { width: TOT_W })
    y += 14
  }

  hline(doc, TOT_X, RIGHT_EDGE, y)
  y += 8
  totRow(doc, 'Totaal (EUR)', fmt(totals.totalCents), y)
  y += 14

  hline(doc, TOT_X, RIGHT_EDGE, y)
  y += 8
  totRow(doc, 'Totaal verschuldigd (EUR)', fmt(totals.totalCents), y, { bold: true, fontSize: 11 })
}

// ─── footer ───────────────────────────────────────────────────────────────────

function drawFooter(doc, invoice, tenant) {
  const y = doc.page.height - PAGE_MARGIN - 48
  const w = USABLE_W

  doc.fontSize(9).font('Helvetica').fillColor('#555')

  hline(doc, PAGE_MARGIN, RIGHT_EDGE, y - 8, '#cccccc')

  const payLine = tenant.iban
    ? `Gelieve te betalen binnen ${invoice.payment_term_days || 14} dagen op IBAN ${tenant.iban} t.a.v. ${tenant.formal_name || tenant.band_name || ''} o.v.v. factuurnummer ${invoice.invoice_number}.`
    : `Gelieve te betalen binnen ${invoice.payment_term_days || 14} dagen o.v.v. factuurnummer ${invoice.invoice_number}.`
  doc.text(payLine, PAGE_MARGIN, y, { width: w })

  if (invoice.memo) {
    doc.fillColor('#333').text(invoice.memo, PAGE_MARGIN, y + 20, { width: w })
  }
}
