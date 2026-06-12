import { Fragment, useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import GridOnOutlined from '@mui/icons-material/GridOnOutlined'
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined'
import PropTypes from 'prop-types'
import PeriodPicker from '../components/shared/periodPicker.jsx'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import { exportFinancialReport, getFinancialReport, listLedgerPeriods } from '../api/ledger.js'
import { formatEur } from '../utils/invoiceTotals.js'
import { defaultPeriodForDates, periodLabel } from '../utils/invoicePeriod.js'
import { downloadBlob } from '../utils/shareCard.js'

const accountRowShape = PropTypes.shape({
  code: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  amount_cents: PropTypes.number.isRequired,
})

// Total rows draw their divider above the figures (not below): no default
// bottom border, a top border instead.
const TOTAL_CELL_SX = {
  fontWeight: 600,
  borderBottom: 'none',
  borderTop: '1px solid',
  borderColor: 'divider',
}

// Account code as a monospace tag on a subtle background, with a margin
// separating it from the account name.
function AccountCode({ code }) {
  return (
    <Box
      component="span"
      sx={{
        fontFamily: 'Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: '0.8rem',
        bgcolor: 'action.hover',
        borderRadius: 1,
        px: 0.75,
        py: 0.25,
        mr: 1.25,
      }}
    >
      {code}
    </Box>
  )
}

AccountCode.propTypes = {
  code: PropTypes.string.isRequired,
}

// Amount with the € symbol pinned to the left of a fixed-width column so all
// currency symbols line up vertically; digits use tabular numerals. With
// `fullWidth` the block spans its cell, pushing the € to the column's left
// edge — used where sibling columns must stay width-identical.
function Money({ cents, fullWidth = false }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        justifyContent: 'space-between',
        gap: 1,
        minWidth: 110,
        width: fullWidth ? '100%' : undefined,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>€</Box>
      <span>{formatEur(cents).replace(/^€\s*/, '')}</span>
    </Box>
  )
}

Money.propTypes = {
  cents: PropTypes.number.isRequired,
  fullWidth: PropTypes.bool,
}

// One P&L / balance-sheet block: account rows under a subheader plus a bold
// total row. Extra rows (e.g. the unallocated result) slot in before the total.
function AccountSection({ label, rows, totalLabel, totalCents, extraRows }) {
  return (
    <>
      <TableRow>
        <TableCell colSpan={2} sx={{ fontWeight: 600, color: 'text.secondary', borderBottom: 'none', pt: 2 }}>
          {label}
        </TableCell>
      </TableRow>
      {rows.map((r) => (
        <TableRow key={r.code}>
          <TableCell sx={{ borderBottom: 'none', py: 0.5 }}><AccountCode code={r.code} />{r.name}</TableCell>
          <TableCell align="right" sx={{ borderBottom: 'none', py: 0.5 }}><Money cents={r.amount_cents} /></TableCell>
        </TableRow>
      ))}
      {(extraRows || []).map((r) => (
        <TableRow key={r.label}>
          <TableCell sx={{ borderBottom: 'none', py: 0.5 }}>{r.label}</TableCell>
          <TableCell align="right" sx={{ borderBottom: 'none', py: 0.5 }}><Money cents={r.amount_cents} /></TableCell>
        </TableRow>
      ))}
      <TableRow>
        <TableCell sx={{ fontWeight: 600 }}>{totalLabel}</TableCell>
        <TableCell align="right" sx={{ fontWeight: 600 }}><Money cents={totalCents} /></TableCell>
      </TableRow>
    </>
  )
}

AccountSection.propTypes = {
  label: PropTypes.string.isRequired,
  rows: PropTypes.arrayOf(accountRowShape).isRequired,
  totalLabel: PropTypes.string.isRequired,
  totalCents: PropTypes.number.isRequired,
  extraRows: PropTypes.arrayOf(PropTypes.shape({
    label: PropTypes.string.isRequired,
    amount_cents: PropTypes.number.isRequired,
  })),
}

function ReportCard({ title, subtitle, children }) {
  const isCompact = useCompactLayout()
  return (
    <Paper variant="outlined" sx={{ p: isCompact ? 1.5 : 2.5 }}>
      <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>
      {subtitle && (
        <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
      )}
      {children}
    </Paper>
  )
}

ReportCard.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  children: PropTypes.node,
}

function ProfitLossCard({ profitLoss }) {
  const { totals } = profitLoss
  const showCogs = profitLoss.cost_of_goods_sold.length > 0 || totals.cogs_cents !== 0
  return (
    <ReportCard title="Profit & Loss" subtitle="Period movement on result accounts, excl. VAT">
      <Table size="small">
        <TableBody>
          <AccountSection label="Revenue" rows={profitLoss.revenue} totalLabel="Total revenue" totalCents={totals.revenue_cents} />
          {showCogs && (
            <AccountSection
              label="Cost of goods sold"
              rows={profitLoss.cost_of_goods_sold}
              totalLabel="Gross profit"
              totalCents={totals.gross_profit_cents}
            />
          )}
          <AccountSection label="Expenses" rows={profitLoss.expenses} totalLabel="Total expenses" totalCents={totals.expense_cents} />
          <TableRow>
            <TableCell sx={{ fontWeight: 700, borderBottom: 'none' }}>Result</TableCell>
            <TableCell
              align="right"
              sx={{ fontWeight: 700, borderBottom: 'none', color: totals.result_cents >= 0 ? 'success.main' : 'error.main' }}
            >
              <Money cents={totals.result_cents} />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ReportCard>
  )
}

const plTotalsShape = PropTypes.shape({
  revenue_cents: PropTypes.number.isRequired,
  cogs_cents: PropTypes.number.isRequired,
  gross_profit_cents: PropTypes.number.isRequired,
  expense_cents: PropTypes.number.isRequired,
  result_cents: PropTypes.number.isRequired,
})

ProfitLossCard.propTypes = {
  profitLoss: PropTypes.shape({
    revenue: PropTypes.arrayOf(accountRowShape).isRequired,
    cost_of_goods_sold: PropTypes.arrayOf(accountRowShape).isRequired,
    expenses: PropTypes.arrayOf(accountRowShape).isRequired,
    totals: plTotalsShape.isRequired,
  }).isRequired,
}

function BalanceSheetCard({ balanceSheet }) {
  const { totals } = balanceSheet
  return (
    <ReportCard title="Balance Sheet" subtitle={`Closing balances as of ${balanceSheet.as_of}`}>
      <Table size="small">
        <TableBody>
          <AccountSection label="Assets" rows={balanceSheet.assets} totalLabel="Total assets" totalCents={totals.assets_cents} />
          <AccountSection label="Liabilities" rows={balanceSheet.liabilities} totalLabel="Total liabilities" totalCents={totals.liabilities_cents} />
          <AccountSection
            label="Equity"
            rows={balanceSheet.equity}
            extraRows={[{ label: 'Unallocated result', amount_cents: balanceSheet.unallocated_result_cents }]}
            totalLabel="Total equity"
            totalCents={totals.equity_cents}
          />
          <TableRow>
            <TableCell sx={{ fontWeight: 700, borderBottom: 'none' }}>Total liabilities + equity</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, borderBottom: 'none' }}>
              <Money cents={totals.liabilities_and_equity_cents} />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ReportCard>
  )
}

BalanceSheetCard.propTypes = {
  balanceSheet: PropTypes.shape({
    as_of: PropTypes.string.isRequired,
    assets: PropTypes.arrayOf(accountRowShape).isRequired,
    liabilities: PropTypes.arrayOf(accountRowShape).isRequired,
    equity: PropTypes.arrayOf(accountRowShape).isRequired,
    unallocated_result_cents: PropTypes.number.isRequired,
    totals: PropTypes.shape({
      assets_cents: PropTypes.number.isRequired,
      liabilities_cents: PropTypes.number.isRequired,
      equity_cents: PropTypes.number.isRequired,
      liabilities_and_equity_cents: PropTypes.number.isRequired,
    }).isRequired,
  }).isRequired,
}

function VatCard({ vat }) {
  return (
    <ReportCard title="VAT position" subtitle="VAT movement within the selected period">
      <Table size="small">
        <TableBody>
          <TableRow>
            <TableCell sx={{ borderBottom: 'none' }}>VAT on sales (output)</TableCell>
            <TableCell align="right" sx={{ borderBottom: 'none' }}><Money cents={vat.output_cents} /></TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ borderBottom: 'none' }}>VAT on purchases (input)</TableCell>
            <TableCell align="right" sx={{ borderBottom: 'none' }}><Money cents={vat.input_cents} /></TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={TOTAL_CELL_SX}>
              Net VAT position {vat.net_cents >= 0 ? '(payable)' : '(receivable)'}
            </TableCell>
            <TableCell align="right" sx={TOTAL_CELL_SX}><Money cents={vat.net_cents} /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ReportCard>
  )
}

VatCard.propTypes = {
  vat: PropTypes.shape({
    output_cents: PropTypes.number.isRequired,
    input_cents: PropTypes.number.isRequired,
    net_cents: PropTypes.number.isRequired,
  }).isRequired,
}

function TrialBalanceCard({ trialBalance }) {
  const isCompact = useCompactLayout()

  if (isCompact) {
    // Two rows per account: the account on its own line, debit/credit beneath,
    // so the amounts keep room on narrow screens.
    return (
      <ReportCard title="Trial Balance" subtitle="Period debit/credit totals per account">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell align="right" sx={{ width: '50%' }}>Debit</TableCell>
              <TableCell align="right" sx={{ width: '50%' }}>Credit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {trialBalance.rows.map((r) => (
              <Fragment key={r.code}>
                <TableRow>
                  <TableCell colSpan={2} sx={{ borderBottom: 'none', pt: 1, pb: 0 }}>
                    <AccountCode code={r.code} />{r.name}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell align="right" sx={{ borderBottom: 'none', pt: 0.25, pb: 0.5 }}><Money cents={r.debit_cents} fullWidth /></TableCell>
                  <TableCell align="right" sx={{ borderBottom: 'none', pt: 0.25, pb: 0.5 }}><Money cents={r.credit_cents} fullWidth /></TableCell>
                </TableRow>
              </Fragment>
            ))}
            <TableRow>
              <TableCell colSpan={2} sx={{ ...TOTAL_CELL_SX, pb: 0 }}>Total</TableCell>
            </TableRow>
            <TableRow>
              <TableCell align="right" sx={{ fontWeight: 600, borderBottom: 'none', pt: 0.25 }}><Money cents={trialBalance.totals.debit_cents} fullWidth /></TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, borderBottom: 'none', pt: 0.25 }}><Money cents={trialBalance.totals.credit_cents} fullWidth /></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ReportCard>
    )
  }

  return (
    <ReportCard title="Trial Balance" subtitle="Period debit/credit totals per account">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Account</TableCell>
            {/* Identical fixed widths keep the debit/credit columns symmetric;
                the full-width Money blocks align the € to each column edge. */}
            <TableCell align="right" sx={{ width: 140 }}>Debit</TableCell>
            <TableCell align="right" sx={{ width: 140 }}>Credit</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {trialBalance.rows.map((r) => (
            <TableRow key={r.code}>
              <TableCell sx={{ borderBottom: 'none', py: 0.5 }}><AccountCode code={r.code} />{r.name}</TableCell>
              <TableCell align="right" sx={{ borderBottom: 'none', py: 0.5 }}><Money cents={r.debit_cents} fullWidth /></TableCell>
              <TableCell align="right" sx={{ borderBottom: 'none', py: 0.5 }}><Money cents={r.credit_cents} fullWidth /></TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell sx={TOTAL_CELL_SX}>Total</TableCell>
            <TableCell align="right" sx={TOTAL_CELL_SX}><Money cents={trialBalance.totals.debit_cents} fullWidth /></TableCell>
            <TableCell align="right" sx={TOTAL_CELL_SX}><Money cents={trialBalance.totals.credit_cents} fullWidth /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ReportCard>
  )
}

TrialBalanceCard.propTypes = {
  trialBalance: PropTypes.shape({
    rows: PropTypes.arrayOf(PropTypes.shape({
      code: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      debit_cents: PropTypes.number.isRequired,
      credit_cents: PropTypes.number.isRequired,
    })).isRequired,
    totals: PropTypes.shape({
      debit_cents: PropTypes.number.isRequired,
      credit_cents: PropTypes.number.isRequired,
    }).isRequired,
  }).isRequired,
}

export default function ReportsPage() {
  const [period, setPeriod] = useState(() => ({ mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(null) // 'xlsx' | 'pdf' | null
  const isCompact = useCompactLayout()

  useEffect(() => {
    let cancelled = false
    listLedgerPeriods()
      .then((dates) => {
        if (cancelled) return
        setAvailableDates(dates)
        setPeriod((prev) => {
          const currentYear = new Date().getFullYear()
          if (prev.mode !== 'fiscal_year' || prev.year !== currentYear) return prev
          return defaultPeriodForDates(dates)
        })
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setPeriodsLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setReport(await getFinancialReport(period))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  async function handleExport(format) {
    try {
      setExporting(format)
      setError(null)
      const blob = await exportFinancialReport(period, format)
      const safeLabel = periodLabel(period).replace(/[^a-zA-Z0-9_-]+/g, '-')
      downloadBlob(blob, `financial-report-${safeLabel}.${format}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(null)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: isCompact ? 1.5 : 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ flex: 1 }}>
          Reports
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<GridOnOutlined />}
          disabled={exporting !== null || loading}
          onClick={() => handleExport('xlsx')}
        >
          {exporting === 'xlsx' ? 'Exporting…' : 'Export Excel'}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<PictureAsPdfOutlined />}
          disabled={exporting !== null || loading}
          onClick={() => handleExport('pdf')}
        >
          {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
        </Button>
        <PeriodPicker availableDates={availableDates} value={period} onChange={setPeriod} />
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>
      )}

      {!loading && !error && report && (
        <Box sx={{ display: 'grid', gap: isCompact ? 1.5 : 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <ProfitLossCard profitLoss={report.profit_loss} />
          <BalanceSheetCard balanceSheet={report.balance_sheet} />
          <VatCard vat={report.vat} />
          <TrialBalanceCard trialBalance={report.trial_balance} />
        </Box>
      )}
    </Box>
  )
}
