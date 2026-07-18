import { Fragment, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import GridOnOutlined from '@mui/icons-material/GridOnOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined'
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined'
import PeriodPicker from '../components/shared/periodPicker.tsx'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { exportFinancialReport, getFinancialReport, listLedgerPeriods } from '../api/ledger.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import { defaultPeriodForDates, periodLabel } from '../utils/invoicePeriod.ts'
import { downloadBlob } from '../utils/shareCard.ts'
import type { Period } from '../types/entities.ts'

interface AccountRow {
  code: string
  name: string
  amount_cents: number
}

interface ExtraRow {
  label: string
  amount_cents: number
}

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
function AccountCode({ code }: Readonly<{ code: string }>) {
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

// Amount with the € symbol pinned to the left of a fixed-width column so all
// currency symbols line up vertically; digits use tabular numerals. With
// `fullWidth` the block spans its cell, pushing the € to the column's left
// edge — used where sibling columns must stay width-identical.
function Money({ cents, fullWidth = false }: Readonly<{ cents: number; fullWidth?: boolean }>) {
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

// One P&L / balance-sheet block: account rows under a subheader plus a bold
// total row. Extra rows (e.g. the unallocated result) slot in before the total.
function AccountSection({ label, rows, totalLabel, totalCents, extraRows }: Readonly<{
  label: string
  rows: AccountRow[]
  totalLabel: string
  totalCents: number
  extraRows?: ExtraRow[]
}>) {
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

function ReportCard({ title, subtitle, children }: Readonly<{ title: string; subtitle?: string; children?: ReactNode }>) {
  const isCompact = useCompactLayout()
  return (
    <Paper variant="outlined" sx={{ p: isCompact ? 1.5 : 2.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
      {subtitle && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{subtitle}</Typography>
      )}
      {children}
    </Paper>
  )
}

interface PlTotals {
  revenue_cents: number
  other_operating_income_cents: number
  cogs_cents: number
  gross_profit_cents: number
  expense_cents: number
  result_cents: number
}

interface ProfitLossData {
  revenue: AccountRow[]
  other_operating_income: AccountRow[]
  cost_of_goods_sold: AccountRow[]
  expenses: AccountRow[]
  totals: PlTotals
}

function ProfitLossCard({ profitLoss }: Readonly<{ profitLoss: ProfitLossData }>) {
  const { t } = useTranslation('reports')
  const { totals } = profitLoss
  const showCogs = profitLoss.cost_of_goods_sold.length > 0 || totals.cogs_cents !== 0
  const showOtherOperatingIncome = profitLoss.other_operating_income.length > 0
    || totals.other_operating_income_cents !== 0
  return (
    <ReportCard title={t($ => $.profitLoss.title)} subtitle={t($ => $.profitLoss.subtitle)}>
      <Table size="small">
        <TableBody>
          <AccountSection
            label={t($ => $.profitLoss.revenue)}
            rows={profitLoss.revenue}
            totalLabel={t($ => $.profitLoss.totalRevenue)}
            totalCents={totals.revenue_cents}
          />
          {showCogs && (
            <AccountSection
              label={t($ => $.profitLoss.costOfGoodsSold)}
              rows={profitLoss.cost_of_goods_sold}
              totalLabel={t($ => $.profitLoss.grossProfit)}
              totalCents={totals.gross_profit_cents}
            />
          )}
          {!showCogs && showOtherOperatingIncome && (
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>{t($ => $.profitLoss.grossProfit)}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>
                <Money cents={totals.gross_profit_cents} />
              </TableCell>
            </TableRow>
          )}
          {showOtherOperatingIncome && (
            <AccountSection
              label={t($ => $.profitLoss.otherOperatingIncome)}
              rows={profitLoss.other_operating_income}
              totalLabel={t($ => $.profitLoss.totalOtherOperatingIncome)}
              totalCents={totals.other_operating_income_cents}
            />
          )}
          <AccountSection
            label={t($ => $.profitLoss.expenses)}
            rows={profitLoss.expenses}
            totalLabel={t($ => $.profitLoss.totalExpenses)}
            totalCents={totals.expense_cents}
          />
          <TableRow>
            <TableCell sx={{ fontWeight: 700, borderBottom: 'none' }}>{t($ => $.profitLoss.result)}</TableCell>
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

interface BalanceSheetData {
  as_of: string
  assets: AccountRow[]
  liabilities: AccountRow[]
  equity: AccountRow[]
  unallocated_result_cents: number
  totals: {
    assets_cents: number
    liabilities_cents: number
    equity_cents: number
    liabilities_and_equity_cents: number
  }
}

function BalanceSheetCard({ balanceSheet }: Readonly<{ balanceSheet: BalanceSheetData }>) {
  const { t } = useTranslation('reports')
  const { totals } = balanceSheet
  return (
    <ReportCard
      title={t($ => $.balanceSheet.title)}
      subtitle={t($ => $.balanceSheet.subtitle, { date: balanceSheet.as_of })}
    >
      <Table size="small">
        <TableBody>
          <AccountSection
            label={t($ => $.balanceSheet.assets)}
            rows={balanceSheet.assets}
            totalLabel={t($ => $.balanceSheet.totalAssets)}
            totalCents={totals.assets_cents}
          />
          <AccountSection
            label={t($ => $.balanceSheet.liabilities)}
            rows={balanceSheet.liabilities}
            totalLabel={t($ => $.balanceSheet.totalLiabilities)}
            totalCents={totals.liabilities_cents}
          />
          <AccountSection
            label={t($ => $.balanceSheet.equity)}
            rows={balanceSheet.equity}
            extraRows={[{
              label: t($ => $.balanceSheet.unallocatedResult),
              amount_cents: balanceSheet.unallocated_result_cents,
            }]}
            totalLabel={t($ => $.balanceSheet.totalEquity)}
            totalCents={totals.equity_cents}
          />
          <TableRow>
            <TableCell sx={{ fontWeight: 700, borderBottom: 'none' }}>
              {t($ => $.balanceSheet.totalLiabilitiesAndEquity)}
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, borderBottom: 'none' }}>
              <Money cents={totals.liabilities_and_equity_cents} />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ReportCard>
  )
}

interface VatReturnSummary {
  year: number
  quarter: number
  period_from: string
  period_to: string
  filed_on: string | null
  direction: 'payable' | 'receivable' | 'nil'
  net_cents: number
}

interface VatData {
  output_cents: number
  input_cents: number
  net_cents: number
  books_closed_through: string | null
  books_closed: boolean
  period_to: string
  returns: VatReturnSummary[]
}

// Whether the VAT declaration for the period was filed and the books closed.
// A period can span several quarters, so each filed quarter is shown as a chip.
function VatFilingStatus({ vat }: Readonly<{ vat: VatData }>) {
  const { t } = useTranslation('reports')
  const declared = vat.returns.length > 0
  return (
    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          icon={vat.books_closed ? <LockOutlined /> : <LockOpenOutlined />}
          color={vat.books_closed ? 'success' : 'default'}
          variant={vat.books_closed ? 'filled' : 'outlined'}
          label={vat.books_closed ? t($ => $.vat.booksClosed) : t($ => $.vat.booksOpen)}
        />
        {vat.books_closed_through && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t($ => $.vat.closedThrough, { date: vat.books_closed_through })}
          </Typography>
        )}
      </Box>
      {declared ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t($ => $.vat.declared)}</Typography>
          {vat.returns.map((r) => (
            <Chip key={`${r.year}-Q${r.quarter}`} size="small" variant="outlined" color="success" label={`Q${r.quarter} ${r.year}`} />
          ))}
        </Box>
      ) : (
        <Typography variant="caption" sx={{ color: 'warning.main' }}>{t($ => $.vat.notDeclared)}</Typography>
      )}
    </Box>
  )
}

function VatCard({ vat }: Readonly<{ vat: VatData }>) {
  const { t } = useTranslation('reports')
  return (
    <ReportCard title={t($ => $.vat.title)} subtitle={t($ => $.vat.subtitle)}>
      <Table size="small">
        <TableBody>
          <TableRow>
            <TableCell sx={{ borderBottom: 'none' }}>{t($ => $.vat.salesOutput)}</TableCell>
            <TableCell align="right" sx={{ borderBottom: 'none' }}><Money cents={vat.output_cents} /></TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ borderBottom: 'none' }}>{t($ => $.vat.purchasesInput)}</TableCell>
            <TableCell align="right" sx={{ borderBottom: 'none' }}><Money cents={vat.input_cents} /></TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={TOTAL_CELL_SX}>
              {vat.net_cents >= 0 ? t($ => $.vat.netPayable) : t($ => $.vat.netReceivable)}
            </TableCell>
            <TableCell align="right" sx={TOTAL_CELL_SX}><Money cents={vat.net_cents} /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <VatFilingStatus vat={vat} />
    </ReportCard>
  )
}

interface TrialBalanceRow {
  code: string
  name: string
  debit_cents: number
  credit_cents: number
}

interface TrialBalanceData {
  rows: TrialBalanceRow[]
  totals: {
    debit_cents: number
    credit_cents: number
  }
}

function TrialBalanceCard({ trialBalance }: Readonly<{ trialBalance: TrialBalanceData }>) {
  const { t } = useTranslation('reports')
  const isCompact = useCompactLayout()

  if (isCompact) {
    // Two rows per account: the account on its own line, debit/credit beneath,
    // so the amounts keep room on narrow screens.
    return (
      <ReportCard title={t($ => $.trialBalance.title)} subtitle={t($ => $.trialBalance.subtitle)}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell align="right" sx={{ width: '50%' }}>{t($ => $.trialBalance.debit)}</TableCell>
              <TableCell align="right" sx={{ width: '50%' }}>{t($ => $.trialBalance.credit)}</TableCell>
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
              <TableCell colSpan={2} sx={{ ...TOTAL_CELL_SX, pb: 0 }}>{t($ => $.trialBalance.total)}</TableCell>
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
    <ReportCard title={t($ => $.trialBalance.title)} subtitle={t($ => $.trialBalance.subtitle)}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t($ => $.trialBalance.account)}</TableCell>
            {/* Identical fixed widths keep the debit/credit columns symmetric;
                the full-width Money blocks align the € to each column edge. */}
            <TableCell align="right" sx={{ width: 140 }}>{t($ => $.trialBalance.debit)}</TableCell>
            <TableCell align="right" sx={{ width: 140 }}>{t($ => $.trialBalance.credit)}</TableCell>
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
            <TableCell sx={TOTAL_CELL_SX}>{t($ => $.trialBalance.total)}</TableCell>
            <TableCell align="right" sx={TOTAL_CELL_SX}><Money cents={trialBalance.totals.debit_cents} fullWidth /></TableCell>
            <TableCell align="right" sx={TOTAL_CELL_SX}><Money cents={trialBalance.totals.credit_cents} fullWidth /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ReportCard>
  )
}

interface FinancialReportData {
  profit_loss: ProfitLossData
  balance_sheet: BalanceSheetData
  vat: VatData
  trial_balance: TrialBalanceData
}

export default function ReportsPage() {
  const { t } = useTranslation('reports')
  const [period, setPeriod] = useState<Period>(() => ({ mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)
  const [report, setReport] = useState<FinancialReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null)
  const isCompact = useCompactLayout()

  useEffect(() => {
    let cancelled = false
    listLedgerPeriods()
      .then((dates) => {
        if (cancelled) return
        setAvailableDates(dates.filter(Boolean))
        setPeriod((prev) => {
          const currentYear = new Date().getFullYear()
          if (prev.mode !== 'fiscal_year' || prev.year !== currentYear) return prev
          return defaultPeriodForDates(dates)
        })
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setPeriodsLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setReport(await getFinancialReport(period) as unknown as FinancialReportData)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  async function handleExport(format: 'xlsx' | 'pdf') {
    try {
      setExporting(format)
      setError(null)
      const blob = await exportFinancialReport(period, format)
      const safeLabel = periodLabel(period).replace(/[^a-zA-Z0-9_-]+/g, '-')
      downloadBlob(blob, `financial-report-${safeLabel}.${format}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(null)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: isCompact ? 1.5 : 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 600,  flex: 1  }}>
          {t($ => $.title)}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<GridOnOutlined />}
          disabled={exporting !== null || loading}
          onClick={() => handleExport('xlsx')}
        >
          {exporting === 'xlsx' ? t($ => $.actions.exporting) : t($ => $.actions.exportExcel)}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<PictureAsPdfOutlined />}
          disabled={exporting !== null || loading}
          onClick={() => handleExport('pdf')}
        >
          {exporting === 'pdf' ? t($ => $.actions.exporting) : t($ => $.actions.exportPdf)}
        </Button>
        <PeriodPicker availableDates={availableDates} value={period} onChange={setPeriod} />
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Typography sx={{ color: 'error.main', mb: 2 }}>{error}</Typography>
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
