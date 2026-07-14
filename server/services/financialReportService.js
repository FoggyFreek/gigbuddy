// Read-only financial report over the ledger: profit & loss, balance sheet,
// VAT position and trial balance for one period. Built entirely from posted
// ledger entries (the immutable source of truth), so the figures are exactly
// what a tax filing should be based on. Posting stays in ledgerService.js.
import {
  accountActivity,
  accountBalancesBefore,
  reportEntryLines,
  vatTotals,
} from '../repositories/ledgerRepository.js'
import { listVatReturnsInRange } from '../repositories/vatReturnRepository.js'
import { fetchBooksClosedThrough, loadAccountingSettings, resolveEffectiveRange } from './ledgerService.js'

const PL_TYPES = new Set(['revenue', 'cost_of_goods_sold', 'expense'])

// Natural sign per account type: assets & expenses grow with debits,
// liabilities/equity/revenue with credits.
function naturalAmount(type, debitCents, creditCents) {
  return type === 'asset' || type === 'expense' || type === 'cost_of_goods_sold'
    ? debitCents - creditCents
    : creditCents - debitCents
}

function toReportRow(row) {
  return {
    code: row.code,
    name: row.name,
    amount_cents: naturalAmount(row.type, row.debit_cents, row.credit_cents),
  }
}

function sumCents(rows) {
  return rows.reduce((acc, r) => acc + r.amount_cents, 0)
}

// 'YYYY-MM-DD' of the day before the exclusive upper bound.
function dayBefore(toExclusive) {
  const d = new Date(`${toExclusive}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// The full report. `range` is { from, toExclusive } or null (all time).
export async function getFinancialReport(executor, tenantId, range) {
  const effectiveRange = await resolveEffectiveRange(executor, tenantId, range)

  const periodEnd = dayBefore(effectiveRange.toExclusive)

  const [activity, balances, vat, settings, closedThrough, vatReturns] = await Promise.all([
    accountActivity(executor, tenantId, effectiveRange),
    accountBalancesBefore(executor, tenantId, effectiveRange.toExclusive),
    vatTotals(executor, tenantId, effectiveRange),
    loadAccountingSettings(executor, tenantId),
    fetchBooksClosedThrough(executor, tenantId),
    listVatReturnsInRange(executor, tenantId, { from: effectiveRange.from, to: periodEnd }),
  ])

  // ---- profit & loss: period movement on result accounts ----
  const plRows = activity.filter((r) => PL_TYPES.has(r.type))
  const revenue = plRows.filter((r) => r.type === 'revenue').map(toReportRow).filter((r) => r.amount_cents !== 0)
  const cogs = plRows.filter((r) => r.type === 'cost_of_goods_sold').map(toReportRow).filter((r) => r.amount_cents !== 0)
  const expenses = plRows.filter((r) => r.type === 'expense').map(toReportRow).filter((r) => r.amount_cents !== 0)
  const revenueCents = sumCents(revenue)
  const cogsCents = sumCents(cogs)
  const expenseCents = sumCents(expenses)

  // ---- balance sheet: running balances through the period end ----
  const bsRow = (r) => ({
    code: r.code,
    name: r.name,
    amount_cents: naturalAmount(r.type, r.balance_cents, 0),
  })
  const assets = balances.filter((r) => r.type === 'asset').map(bsRow).filter((r) => r.amount_cents !== 0)
  const liabilities = balances.filter((r) => r.type === 'liability').map(bsRow).filter((r) => r.amount_cents !== 0)
  const equity = balances.filter((r) => r.type === 'equity').map(bsRow).filter((r) => r.amount_cents !== 0)
  // Result accounts are never closed to retained earnings, so their cumulative
  // balance is the unallocated result — the line that makes the sheet balance.
  // balance_cents is debit-credit; result = Σcredit-Σdebit over P&L accounts.
  const unallocatedResultCents = -balances
    .filter((r) => PL_TYPES.has(r.type))
    .reduce((acc, r) => acc + r.balance_cents, 0)

  const assetsCents = sumCents(assets)
  const liabilitiesCents = sumCents(liabilities)
  const equityCents = sumCents(equity) + unallocatedResultCents

  const outputCents = vat?.output_cents || 0
  const inputCents = vat?.input_cents || 0

  // ---- trial balance: period debit/credit per account, all types ----
  const trialBalance = activity.map((r) => ({
    code: r.code,
    name: r.name,
    type: r.type,
    debit_cents: r.debit_cents,
    credit_cents: r.credit_cents,
  }))

  return {
    currency: settings?.currency || 'EUR',
    period: { from: effectiveRange.from, to: dayBefore(effectiveRange.toExclusive) },
    profit_loss: {
      revenue,
      cost_of_goods_sold: cogs,
      expenses,
      totals: {
        revenue_cents: revenueCents,
        cogs_cents: cogsCents,
        gross_profit_cents: revenueCents - cogsCents,
        expense_cents: expenseCents,
        result_cents: revenueCents - cogsCents - expenseCents,
      },
    },
    balance_sheet: {
      as_of: dayBefore(effectiveRange.toExclusive),
      assets,
      liabilities,
      equity,
      unallocated_result_cents: unallocatedResultCents,
      totals: {
        assets_cents: assetsCents,
        liabilities_cents: liabilitiesCents,
        equity_cents: equityCents,
        liabilities_and_equity_cents: liabilitiesCents + equityCents,
      },
    },
    vat: {
      output_cents: outputCents,
      input_cents: inputCents,
      net_cents: outputCents - inputCents,
      // VAT declaration / period-close status for this period. The books are
      // considered closed for the report when the close date reaches the period
      // end; `returns` lists the filed quarters that overlap the period.
      books_closed_through: closedThrough,
      books_closed: Boolean(closedThrough && closedThrough >= periodEnd),
      period_to: periodEnd,
      returns: vatReturns,
    },
    trial_balance: {
      rows: trialBalance,
      totals: {
        debit_cents: trialBalance.reduce((a, r) => a + r.debit_cents, 0),
        credit_cents: trialBalance.reduce((a, r) => a + r.credit_cents, 0),
      },
    },
  }
}

// Line-level detail for the exports: every journal line in the period.
export async function getReportEntryLines(executor, tenantId, range) {
  const effectiveRange = await resolveEffectiveRange(executor, tenantId, range)
  return reportEntryLines(executor, tenantId, effectiveRange)
}
