// Ledger browser endpoints: reads plus the manual void action. All posting
// stays in ledgerService.js, driven by the invoice/purchase/journal/
// reimbursement state machines (and voidLedgerTransaction here).
import { Router } from 'express'
import pool from '../db/index.js'
import { buildPeriodWhere, resolvePeriodRange } from '../utils/periodQuery.js'
import { parseId } from '../validators/journalValidators.js'
import { listEntryDates } from '../repositories/ledgerRepository.js'
import { getLedgerList, getLedgerEntryDetail, getFinancialOverview, voidLedgerTransaction } from '../services/ledgerService.js'
import { getFinancialReport, getReportEntryLines } from '../services/financialReportService.js'
import { renderFinancialReportXlsx } from '../utils/renderFinancialReportXlsx.js'
import { renderFinancialReportPdf } from '../utils/renderFinancialReportPdf.js'

const router = Router()

// Human label for the requested period, used in export headers/filenames.
function periodLabelFor(query) {
  const { mode, year, month, quarter, from, to } = query
  switch (mode) {
    case 'fiscal_year': return `FY ${year}`
    case 'month': return `${year}-${String(Number(month) + 1).padStart(2, '0')}`
    case 'quarter': return `Q${quarter} ${year}`
    case 'custom': return `${from} - ${to}`
    default: return 'All time'
  }
}

async function tenantName(tenantId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(formal_name, band_name) AS name FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0]?.name || ''
}

// ---------- list ----------
router.get('/', async (req, res) => {
  const period = buildPeriodWhere(req.query, 'lt.entry_date')
  if (period.error) return res.status(400).json({ error: period.error })
  res.json(await getLedgerList(pool, req.tenantId, period))
})

// ---------- periods (for the PeriodPicker availability grid) ----------
router.get('/periods', async (req, res) => {
  res.json(await listEntryDates(pool, req.tenantId))
})

// ---------- financial dashboard overview (must precede /:id) ----------
router.get('/overview', async (req, res) => {
  const period = resolvePeriodRange(req.query)
  if (period.error) return res.status(400).json({ error: period.error })
  res.json(await getFinancialOverview(pool, req.tenantId, period.range))
})

// ---------- financial report (must precede /:id) ----------
router.get('/report', async (req, res) => {
  const period = resolvePeriodRange(req.query)
  if (period.error) return res.status(400).json({ error: period.error })
  res.json(await getFinancialReport(pool, req.tenantId, period.range))
})

router.get('/report/export', async (req, res) => {
  const period = resolvePeriodRange(req.query)
  if (period.error) return res.status(400).json({ error: period.error })
  const format = req.query.format
  if (format !== 'xlsx' && format !== 'pdf') {
    return res.status(400).json({ error: 'Invalid format' })
  }

  const [report, name] = await Promise.all([
    getFinancialReport(pool, req.tenantId, period.range),
    tenantName(req.tenantId),
  ])
  const label = periodLabelFor(req.query)
  const safeLabel = label.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '-')
  const filename = `financial-report-${safeLabel || 'all-time'}.${format}`

  if (format === 'xlsx') {
    const lines = await getReportEntryLines(pool, req.tenantId, period.range)
    const buffer = await renderFinancialReportXlsx({ report, lines, tenantName: name, periodLabel: label })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(Buffer.from(buffer))
  }

  const buffer = await renderFinancialReportPdf({ report, tenantName: name, periodLabel: label })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(buffer)
})

// ---------- detail ----------
router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  const detail = await getLedgerEntryDetail(pool, req.tenantId, id)
  if (!detail) return res.status(404).json({ error: 'Not found' })
  res.json(detail)
})

// ---------- void (posts a reversing transaction) ----------
router.post('/:id/void', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  const result = await voidLedgerTransaction(pool, req.tenantId, id, req.user.id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json({ id: result.transactionId })
})

export default router
