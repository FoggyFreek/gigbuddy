import PDFDocument from 'pdfkit'
import { computeInvoiceTotals } from './computeInvoiceTotals.js'

const PAGE_MARGIN = 48
const COL_WIDTHS = { desc: 240, qty: 60, price: 80, vat: 60, total: 80 }

function fmt(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100)
  const remainder = String(abs % 100).padStart(2, '0')
  return `${sign}€ ${euros.toLocaleString('nl-NL')},${remainder}`
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

function bufferDocument(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

export async function renderInvoicePdf({ invoice, lines, tenant, logoBuffer }) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
  const done = bufferDocument(doc)

  const totals = computeInvoiceTotals({
    lines,
    taxInclusive: invoice.tax_inclusive,
    discountCents: invoice.discount_cents,
    appliesKor: tenant.applies_kor,
  })

  drawHeader(doc, tenant, logoBuffer)
  drawCustomerAndMeta(doc, invoice)
  const linesEndY = drawLinesTable(doc, lines, totals.perLine, tenant.applies_kor)
  drawTotals(doc, totals, tenant.applies_kor, linesEndY)
  drawFooter(doc, invoice, tenant)

  doc.end()
  return done
}

function drawHeader(doc, tenant, logoBuffer) {
  const top = PAGE_MARGIN
  const leftX = PAGE_MARGIN
  const rightX = doc.page.width - PAGE_MARGIN

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, leftX, top, { fit: [140, 60] })
    } catch {
      doc.fontSize(20).font('Helvetica-Bold').text(tenant.band_name || '', leftX, top)
    }
  } else {
    doc.fontSize(20).font('Helvetica-Bold').text(tenant.band_name || '', leftX, top)
  }

  const rightLines = [
    tenant.formal_name || tenant.band_name,
    tenant.address_street,
    [tenant.address_postal_code, tenant.address_city].filter(Boolean).join(' '),
    tenant.address_country,
    '',
    tenant.email,
    tenant.phone,
    tenant.website,
  ].filter(Boolean)

  doc.fontSize(9).font('Helvetica').fillColor('#000')
  let y = top
  for (const line of rightLines) {
    doc.text(line, leftX, y, { width: rightX - leftX, align: 'right' })
    y += 12
  }

  doc.moveTo(leftX, top + 90).lineTo(rightX, top + 90).strokeColor('#cccccc').stroke()
}

function drawCustomerAndMeta(doc, invoice) {
  const top = PAGE_MARGIN + 110
  const leftX = PAGE_MARGIN
  const rightX = doc.page.width - PAGE_MARGIN

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#666').text('FACTUUR AAN', leftX, top)
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text(invoice.customer_name || '', leftX, top + 14)
  const customerLines = [
    invoice.customer_address_street,
    [invoice.customer_address_postal_code, invoice.customer_address_city].filter(Boolean).join(' '),
    invoice.customer_address_country,
    invoice.customer_email,
    invoice.customer_kvk ? `KVK: ${invoice.customer_kvk}` : null,
    invoice.customer_tax_id ? `BTW: ${invoice.customer_tax_id}` : null,
  ].filter(Boolean)
  doc.fontSize(9).font('Helvetica')
  let y = top + 28
  for (const line of customerLines) {
    doc.text(line, leftX, y, { width: 240 })
    y += 12
  }

  const metaY = top
  const labelX = rightX - 200
  const valueX = rightX - 100
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#666')
  doc.text('Factuurnummer', labelX, metaY, { width: 100 })
  doc.text('Factuurdatum', labelX, metaY + 14, { width: 100 })
  if (invoice.due_date) doc.text('Vervaldatum', labelX, metaY + 28, { width: 100 })
  doc.fillColor('#000').font('Helvetica')
  doc.text(invoice.invoice_number || '', valueX, metaY, { width: 100, align: 'right' })
  doc.text(fmtDate(invoice.issue_date), valueX, metaY + 14, { width: 100, align: 'right' })
  if (invoice.due_date) doc.text(fmtDate(invoice.due_date), valueX, metaY + 28, { width: 100, align: 'right' })
}

function drawLinesTable(doc, lines, perLine, appliesKor) {
  const startX = PAGE_MARGIN
  const startY = PAGE_MARGIN + 230

  const colX = {
    desc: startX,
    qty: startX + COL_WIDTHS.desc,
    price: startX + COL_WIDTHS.desc + COL_WIDTHS.qty,
    vat: startX + COL_WIDTHS.desc + COL_WIDTHS.qty + COL_WIDTHS.price,
    total: startX + COL_WIDTHS.desc + COL_WIDTHS.qty + COL_WIDTHS.price + COL_WIDTHS.vat,
  }

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#666')
  doc.text('Omschrijving', colX.desc, startY)
  doc.text('Aantal', colX.qty, startY, { width: COL_WIDTHS.qty, align: 'right' })
  doc.text('Prijs', colX.price, startY, { width: COL_WIDTHS.price, align: 'right' })
  if (!appliesKor) doc.text('BTW', colX.vat, startY, { width: COL_WIDTHS.vat, align: 'right' })
  doc.text('Totaal', colX.total, startY, { width: COL_WIDTHS.total, align: 'right' })

  doc.moveTo(startX, startY + 14).lineTo(doc.page.width - PAGE_MARGIN, startY + 14).strokeColor('#cccccc').stroke()

  doc.fontSize(10).font('Helvetica').fillColor('#000')
  let y = startY + 22
  lines.forEach((line, idx) => {
    const totals = perLine[idx]
    const descHeight = doc.heightOfString(line.description || '', { width: COL_WIDTHS.desc - 8 })
    doc.text(line.description || '', colX.desc, y, { width: COL_WIDTHS.desc - 8 })
    doc.text(fmtQty(line.quantity), colX.qty, y, { width: COL_WIDTHS.qty, align: 'right' })
    doc.text(fmt(line.unit_price_cents), colX.price, y, { width: COL_WIDTHS.price, align: 'right' })
    if (!appliesKor) {
      const taxPct = Number(line.tax_percentage) || 0
      doc.text(`${taxPct.toFixed(0)}%`, colX.vat, y, { width: COL_WIDTHS.vat, align: 'right' })
    }
    doc.text(fmt(totals.grossCents), colX.total, y, { width: COL_WIDTHS.total, align: 'right' })
    y += Math.max(descHeight, 12) + 6
  })

  return y + 6
}

function drawTotals(doc, totals, appliesKor, startY) {
  const labelX = doc.page.width - PAGE_MARGIN - 180
  const valueX = doc.page.width - PAGE_MARGIN - 80
  doc.moveTo(labelX, startY).lineTo(doc.page.width - PAGE_MARGIN, startY).strokeColor('#cccccc').stroke()

  let y = startY + 8
  doc.fontSize(10).font('Helvetica').fillColor('#000')
  doc.text('Subtotaal', labelX, y, { width: 100 })
  doc.text(fmt(totals.subtotalCents), valueX, y, { width: 80, align: 'right' })
  y += 16

  if (totals.discountCents > 0) {
    doc.text('Korting (excl. BTW)', labelX, y, { width: 120 })
    doc.text(`- ${fmt(totals.discountCents)}`, valueX, y, { width: 80, align: 'right' })
    y += 16
  }

  if (!appliesKor) {
    doc.text('BTW', labelX, y, { width: 100 })
    doc.text(fmt(totals.taxCents), valueX, y, { width: 80, align: 'right' })
    y += 16
  }

  doc.moveTo(labelX, y).lineTo(doc.page.width - PAGE_MARGIN, y).strokeColor('#000').stroke()
  y += 6
  doc.fontSize(12).font('Helvetica-Bold')
  doc.text('Totaal', labelX, y, { width: 100 })
  doc.text(fmt(totals.totalCents), valueX, y, { width: 80, align: 'right' })
}

function drawFooter(doc, invoice, tenant) {
  const bottom = doc.page.height - PAGE_MARGIN - 60
  const leftX = PAGE_MARGIN

  doc.fontSize(9).font('Helvetica').fillColor('#333')

  const payLine = tenant.iban
    ? `Gelieve te betalen binnen ${invoice.payment_term_days || 14} dagen op IBAN ${tenant.iban} o.v.v. factuurnummer ${invoice.invoice_number}.`
    : `Gelieve te betalen binnen ${invoice.payment_term_days || 14} dagen o.v.v. factuurnummer ${invoice.invoice_number}.`
  doc.text(payLine, leftX, bottom, { width: doc.page.width - 2 * PAGE_MARGIN })

  const idLine = [
    tenant.kvk_number ? `KVK ${tenant.kvk_number}` : null,
    tenant.tax_id ? `BTW ${tenant.tax_id}` : null,
  ].filter(Boolean).join('   |   ')
  if (idLine) doc.text(idLine, leftX, bottom + 16, { width: doc.page.width - 2 * PAGE_MARGIN })

  if (tenant.applies_kor) {
    doc.fillColor('#666').fontSize(8)
    doc.text(
      'Kleine ondernemersregeling — geen BTW in rekening gebracht.',
      leftX, bottom + 34,
      { width: doc.page.width - 2 * PAGE_MARGIN },
    )
  }

  if (invoice.memo) {
    doc.fillColor('#333').fontSize(9)
    doc.text(invoice.memo, leftX, bottom + 50, { width: doc.page.width - 2 * PAGE_MARGIN })
  }
}
