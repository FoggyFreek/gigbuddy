// Renders the financial report (financialReportService.js shape) to an .xlsx
// workbook: P&L, balance sheet, VAT, trial balance, plus the line-level
// journal entries backing the figures. Amounts are written in euros (numbers),
// formatted as currency, so the sheet is directly usable in tax submissions.
import ExcelJS from 'exceljs'

const EUR_FMT = '€ #,##0.00;[Red]-€ #,##0.00'

const toEuros = (cents) => (cents || 0) / 100

function addHeaderRow(sheet, values) {
  const row = sheet.addRow(values)
  row.font = { bold: true }
  return row
}

function addSectionTitle(sheet, title) {
  const row = sheet.addRow([title])
  row.font = { bold: true, size: 12 }
  return row
}

function moneyColumns(sheet, columns) {
  for (const col of columns) sheet.getColumn(col).numFmt = EUR_FMT
}

function addAccountRows(sheet, rows) {
  for (const r of rows) sheet.addRow([r.code, r.name, toEuros(r.amount_cents)])
}

function addTotalRow(sheet, label, cents) {
  const row = sheet.addRow(['', label, toEuros(cents)])
  row.font = { bold: true }
  return row
}

export async function renderFinancialReportXlsx({ report, lines, tenantName, periodLabel }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = tenantName || 'GigBuddy'

  // ---- Profit & Loss ----
  const pl = wb.addWorksheet('Profit & Loss')
  pl.columns = [{ width: 12 }, { width: 46 }, { width: 16 }]
  addSectionTitle(pl, `Profit & Loss — ${tenantName} — ${periodLabel}`)
  pl.addRow([])
  addHeaderRow(pl, ['Code', 'Revenue', 'Amount'])
  addAccountRows(pl, report.profit_loss.revenue)
  addTotalRow(pl, 'Total revenue', report.profit_loss.totals.revenue_cents)
  pl.addRow([])
  addHeaderRow(pl, ['Code', 'Cost of goods sold', 'Amount'])
  addAccountRows(pl, report.profit_loss.cost_of_goods_sold)
  addTotalRow(pl, 'Total cost of goods sold', report.profit_loss.totals.cogs_cents)
  addTotalRow(pl, 'Gross profit', report.profit_loss.totals.gross_profit_cents)
  pl.addRow([])
  addHeaderRow(pl, ['Code', 'Other operating income', 'Amount'])
  addAccountRows(pl, report.profit_loss.other_operating_income)
  addTotalRow(pl, 'Total other operating income', report.profit_loss.totals.other_operating_income_cents)
  pl.addRow([])
  addHeaderRow(pl, ['Code', 'Expenses', 'Amount'])
  addAccountRows(pl, report.profit_loss.expenses)
  addTotalRow(pl, 'Total expenses', report.profit_loss.totals.expense_cents)
  pl.addRow([])
  addTotalRow(pl, 'Result', report.profit_loss.totals.result_cents)
  moneyColumns(pl, [3])

  // ---- Balance Sheet ----
  const bs = wb.addWorksheet('Balance Sheet')
  bs.columns = [{ width: 12 }, { width: 46 }, { width: 16 }]
  addSectionTitle(bs, `Balance Sheet — ${tenantName} — as of ${report.balance_sheet.as_of}`)
  bs.addRow([])
  addHeaderRow(bs, ['Code', 'Assets', 'Amount'])
  addAccountRows(bs, report.balance_sheet.assets)
  addTotalRow(bs, 'Total assets', report.balance_sheet.totals.assets_cents)
  bs.addRow([])
  addHeaderRow(bs, ['Code', 'Liabilities', 'Amount'])
  addAccountRows(bs, report.balance_sheet.liabilities)
  addTotalRow(bs, 'Total liabilities', report.balance_sheet.totals.liabilities_cents)
  bs.addRow([])
  addHeaderRow(bs, ['Code', 'Equity', 'Amount'])
  addAccountRows(bs, report.balance_sheet.equity)
  bs.addRow(['', 'Unallocated result', toEuros(report.balance_sheet.unallocated_result_cents)])
  addTotalRow(bs, 'Total equity', report.balance_sheet.totals.equity_cents)
  bs.addRow([])
  addTotalRow(bs, 'Total liabilities + equity', report.balance_sheet.totals.liabilities_and_equity_cents)
  moneyColumns(bs, [3])

  // ---- VAT ----
  const vat = wb.addWorksheet('VAT')
  vat.columns = [{ width: 46 }, { width: 16 }]
  addSectionTitle(vat, `VAT — ${tenantName} — ${periodLabel}`)
  vat.addRow([])
  vat.addRow(['VAT on sales (output)', toEuros(report.vat.output_cents)])
  vat.addRow(['VAT on purchases (input)', toEuros(report.vat.input_cents)])
  const vatNet = vat.addRow(['Net VAT position', toEuros(report.vat.net_cents)])
  vatNet.font = { bold: true }
  moneyColumns(vat, [2])

  // ---- Trial Balance ----
  const tb = wb.addWorksheet('Trial Balance')
  tb.columns = [{ width: 12 }, { width: 46 }, { width: 22 }, { width: 16 }, { width: 16 }]
  addSectionTitle(tb, `Trial Balance — ${tenantName} — ${periodLabel}`)
  tb.addRow([])
  addHeaderRow(tb, ['Code', 'Account', 'Type', 'Debit', 'Credit'])
  for (const r of report.trial_balance.rows) {
    tb.addRow([r.code, r.name, r.type, toEuros(r.debit_cents), toEuros(r.credit_cents)])
  }
  const tbTotal = tb.addRow([
    '', 'Total', '',
    toEuros(report.trial_balance.totals.debit_cents),
    toEuros(report.trial_balance.totals.credit_cents),
  ])
  tbTotal.font = { bold: true }
  moneyColumns(tb, [4, 5])

  // ---- Entries (line-level detail) ----
  const en = wb.addWorksheet('Entries')
  en.columns = [
    { width: 12 }, { width: 10 }, { width: 40 }, { width: 12 }, { width: 36 },
    { width: 14 }, { width: 14 }, { width: 36 },
  ]
  addSectionTitle(en, `Journal entries — ${tenantName} — ${periodLabel}`)
  en.addRow([])
  addHeaderRow(en, ['Date', 'Entry #', 'Description', 'Account', 'Account name', 'Debit', 'Credit', 'Memo'])
  for (const l of lines) {
    en.addRow([
      l.entry_date, l.transaction_id, l.description || '', l.account_code,
      l.account_name || '', toEuros(l.debit_cents), toEuros(l.credit_cents), l.memo || '',
    ])
  }
  moneyColumns(en, [6, 7])

  return wb.xlsx.writeBuffer()
}
