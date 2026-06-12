// Renders the financial report (financialReportService.js shape) to an A4 PDF:
// P&L, balance sheet, VAT position and trial balance. Same pdfkit conventions
// as renderInvoicePdf.js (nl-NL money formatting, buffered output).
import PDFDocument from 'pdfkit'

const PAGE_MARGIN = 48
const PAGE_W = 595.28 // A4 width in points
const USABLE_W = PAGE_W - 2 * PAGE_MARGIN
const RIGHT_EDGE = PAGE_W - PAGE_MARGIN

function fmt(cents) {
  const sign = cents < 0 ? '- ' : ''
  const abs = Math.abs(cents || 0)
  const euros = Math.floor(abs / 100)
  const rem = String(abs % 100).padStart(2, '0')
  return `${sign}€ ${euros.toLocaleString('nl-NL')},${rem}`
}

function hline(doc, y, color = '#cccccc') {
  doc.moveTo(PAGE_MARGIN, y).lineTo(RIGHT_EDGE, y).strokeColor(color).lineWidth(0.5).stroke()
}

function bufferDocument(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

// Starts a new page when fewer than `needed` points remain; returns current y.
function ensureSpace(doc, y, needed) {
  if (y + needed <= doc.page.height - PAGE_MARGIN) return y
  doc.addPage()
  return PAGE_MARGIN
}

function sectionTitle(doc, y, title) {
  y = ensureSpace(doc, y, 60)
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#000')
  doc.text(title, PAGE_MARGIN, y)
  hline(doc, y + 18, '#999999')
  return y + 28
}

// One "Code | Name | Amount" row; bold for totals.
function accountRow(doc, y, { code = '', name, amount }, { bold = false } = {}) {
  y = ensureSpace(doc, y, 16)
  doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000')
  doc.text(code, PAGE_MARGIN, y, { width: 60 })
  doc.text(name, PAGE_MARGIN + 65, y, { width: USABLE_W - 65 - 110 })
  doc.text(amount, RIGHT_EDGE - 110, y, { width: 110, align: 'right' })
  return y + 15
}

function subHeader(doc, y, label) {
  y = ensureSpace(doc, y, 24)
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#555')
  doc.text(label, PAGE_MARGIN, y)
  return y + 16
}

function accountSection(doc, y, label, rows, totalLabel, totalCents) {
  y = subHeader(doc, y, label)
  for (const r of rows) {
    y = accountRow(doc, y, { code: r.code, name: r.name, amount: fmt(r.amount_cents) })
  }
  if (!rows.length) {
    y = accountRow(doc, y, { name: '—', amount: fmt(0) })
  }
  y = accountRow(doc, y, { name: totalLabel, amount: fmt(totalCents) }, { bold: true })
  return y + 8
}

export async function renderFinancialReportPdf({ report, tenantName, periodLabel }) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
  const done = bufferDocument(doc)

  // ---- title ----
  let y = PAGE_MARGIN
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000')
  doc.text('Financial Report', PAGE_MARGIN, y)
  doc.fontSize(10).font('Helvetica').fillColor('#444')
  doc.text(`${tenantName} — ${periodLabel}`, PAGE_MARGIN, y + 22)
  doc.text(
    `Generated ${new Date().toISOString().slice(0, 10)} — period ${report.period.from} to ${report.period.to}`,
    PAGE_MARGIN, y + 36,
  )
  y += 60

  // ---- profit & loss ----
  const pl = report.profit_loss
  y = sectionTitle(doc, y, 'Profit & Loss')
  y = accountSection(doc, y, 'Revenue', pl.revenue, 'Total revenue', pl.totals.revenue_cents)
  if (pl.cost_of_goods_sold.length || pl.totals.cogs_cents !== 0) {
    y = accountSection(doc, y, 'Cost of goods sold', pl.cost_of_goods_sold, 'Total cost of goods sold', pl.totals.cogs_cents)
    y = accountRow(doc, y, { name: 'Gross profit', amount: fmt(pl.totals.gross_profit_cents) }, { bold: true }) + 8
  }
  y = accountSection(doc, y, 'Expenses', pl.expenses, 'Total expenses', pl.totals.expense_cents)
  y = ensureSpace(doc, y, 24)
  hline(doc, y, '#999999')
  y = accountRow(doc, y + 6, { name: 'Result', amount: fmt(pl.totals.result_cents) }, { bold: true }) + 16

  // ---- balance sheet ----
  const bs = report.balance_sheet
  y = sectionTitle(doc, y, `Balance Sheet (as of ${bs.as_of})`)
  y = accountSection(doc, y, 'Assets', bs.assets, 'Total assets', bs.totals.assets_cents)
  y = accountSection(doc, y, 'Liabilities', bs.liabilities, 'Total liabilities', bs.totals.liabilities_cents)
  y = subHeader(doc, y, 'Equity')
  for (const r of bs.equity) {
    y = accountRow(doc, y, { code: r.code, name: r.name, amount: fmt(r.amount_cents) })
  }
  y = accountRow(doc, y, { name: 'Unallocated result', amount: fmt(bs.unallocated_result_cents) })
  y = accountRow(doc, y, { name: 'Total equity', amount: fmt(bs.totals.equity_cents) }, { bold: true }) + 8
  y = accountRow(doc, y, { name: 'Total liabilities + equity', amount: fmt(bs.totals.liabilities_and_equity_cents) }, { bold: true }) + 16

  // ---- VAT ----
  y = sectionTitle(doc, y, 'VAT position')
  y = accountRow(doc, y, { name: 'VAT on sales (output)', amount: fmt(report.vat.output_cents) })
  y = accountRow(doc, y, { name: 'VAT on purchases (input)', amount: fmt(report.vat.input_cents) })
  y = accountRow(doc, y, { name: 'Net VAT position', amount: fmt(report.vat.net_cents) }, { bold: true }) + 16

  // ---- trial balance ----
  y = sectionTitle(doc, y, 'Trial Balance')
  const drawTbRow = (yy, code, name, debit, credit, { bold = false } = {}) => {
    yy = ensureSpace(doc, yy, 16)
    doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000')
    doc.text(code, PAGE_MARGIN, yy, { width: 60 })
    doc.text(name, PAGE_MARGIN + 65, yy, { width: USABLE_W - 65 - 200 })
    doc.text(debit, RIGHT_EDGE - 200, yy, { width: 95, align: 'right' })
    doc.text(credit, RIGHT_EDGE - 100, yy, { width: 100, align: 'right' })
    return yy + 15
  }
  y = drawTbRow(y, 'Code', 'Account', 'Debit', 'Credit', { bold: true })
  for (const r of report.trial_balance.rows) {
    y = drawTbRow(y, r.code, r.name, fmt(r.debit_cents), fmt(r.credit_cents))
  }
  y = ensureSpace(doc, y, 24)
  hline(doc, y, '#999999')
  drawTbRow(y + 6, '', 'Total', fmt(report.trial_balance.totals.debit_cents), fmt(report.trial_balance.totals.credit_cents), { bold: true })

  doc.end()
  return done
}
