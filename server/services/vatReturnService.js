// VAT return (declaration) domain logic — the period close for VAT.
//
// 15000 / 24000 accumulate input/output VAT through the quarter (wired into
// invoicing/purchasing). Filing a return posts one settlement journal that
// zeroes both accumulation accounts into a filed-return account (24010 payable
// / 15010 receivable), then payments/refunds move cash against the bank.
//
// Functions return a discriminated result like the other services:
//   { error: { status, body } }  — caller responds with that status/body
//   anything else                — success payload
import {
  loadAccountingSettings,
  postJournal,
  ledgerErrorResult,
  assertPeriodOpen,
  AccountingNotConfiguredError,
} from './ledgerService.js'
import { vatAccountBalances } from '../repositories/ledgerRepository.js'

function today() {
  return new Date().toISOString().slice(0, 10)
}

// 'YYYY-MM-01' of the month `count` months after the given year/month (1-based).
function monthStart(year, month, count = 0) {
  const d = new Date(Date.UTC(year, month - 1 + count, 1))
  return d.toISOString().slice(0, 10)
}

// 'YYYY-MM-DD' of the day before the given ISO date (i.e. last day of the
// previous month when given a month start).
function dayBefore(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Quarter date range + NL filing due date (last day of the month after the
// quarter ends). Same math as currentVatQuarter in ledgerService.js.
export function quarterRange(year, quarter) {
  const startMonth = (quarter - 1) * 3 + 1
  return {
    period_from: monthStart(year, startMonth),
    period_to: dayBefore(monthStart(year, startMonth, 3)),
    due_date: dayBefore(monthStart(year, startMonth, 4)),
  }
}

function requireCode(settings, field) {
  const code = settings?.[field]
  if (!code) throw new AccountingNotConfiguredError(field)
  return code
}

function directionFor(netCents) {
  if (netCents > 0) return 'payable'
  if (netCents < 0) return 'receivable'
  return 'nil'
}

// Derived payment status. Payable returns are paid to the tax authority;
// receivable returns are refunded by it; nil returns need no cash leg.
function statusFor(direction, netCents, paidCents) {
  if (direction === 'nil') return 'settled'
  const outstanding = Math.abs(netCents) - paidCents
  if (direction === 'payable') {
    if (outstanding <= 0) return 'paid'
    return paidCents > 0 ? 'partially_paid' : 'unpaid'
  }
  if (outstanding <= 0) return 'received'
  return paidCents > 0 ? 'partially_received' : 'not_received'
}

// One side of a settlement line, chosen by the sign of the balance being
// cleared. postJournal accepts negative amounts silently (it only drops zero
// lines) and the DB CHECKs would reject them — never emit one.
function clearingLine(accountCode, balanceCents, clearSide) {
  if (balanceCents === 0) return null
  const amount = Math.abs(balanceCents)
  const opposite = clearSide === 'debit' ? 'credit' : 'debit'
  const side = balanceCents > 0 ? clearSide : opposite
  return {
    account_code: accountCode,
    debit_cents: side === 'debit' ? amount : 0,
    credit_cents: side === 'credit' ? amount : 0,
  }
}

const RETURN_COLUMNS = `
  id, tenant_id, year, quarter,
  to_char(period_from, 'YYYY-MM-DD') AS period_from,
  to_char(period_to, 'YYYY-MM-DD') AS period_to,
  input_vat_cents, output_vat_cents, net_cents, direction,
  settlement_account_code,
  to_char(due_date, 'YYYY-MM-DD') AS due_date,
  notes, filed_at, created_by_user_id`

function withStatus(row) {
  const paidCents = Number(row.paid_cents ?? 0)
  return {
    ...row,
    paid_cents: paidCents,
    status: statusFor(row.direction, row.net_cents, paidCents),
  }
}

// The quarter's running VAT position — drives the breakdown/confirm UI.
export async function previewVatReturn(executor, tenantId, { year, quarter }) {
  const range = quarterRange(year, quarter)
  try {
    const settings = await loadAccountingSettings(executor, tenantId)
    requireCode(settings, 'input_vat_account_code')
    requireCode(settings, 'output_vat_account_code')
  } catch (err) {
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
    throw err
  }
  const { output_cents, input_cents } = await vatAccountBalances(executor, tenantId, { asOf: range.period_to })
  const net = output_cents - input_cents
  return {
    preview: {
      year,
      quarter,
      ...range,
      output_vat_cents: output_cents,
      input_vat_cents: input_cents,
      net_cents: net,
      direction: directionFor(net),
      period_ended: range.period_to < today(),
    },
  }
}

// Files the quarter: inserts the vat_returns row, posts the settlement journal
// and auto-closes the books through the period end — all in one transaction.
export async function createVatReturn(pool, tenantId, { year, quarter, notes }, actorUserId = null) {
  const range = quarterRange(year, quarter)
  if (range.period_to >= today()) {
    return { error: { status: 400, body: { error: 'The quarter has not ended yet', code: 'period_not_ended' } } }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const settings = await loadAccountingSettings(client, tenantId)
    const inputCode = requireCode(settings, 'input_vat_account_code')
    const outputCode = requireCode(settings, 'output_vat_account_code')

    // Friendly pre-check; the UNIQUE (tenant_id, year, quarter) constraint is
    // the backstop against concurrent filings. Must run before the period-open
    // check: refiling a settled quarter should say "already filed", not
    // "period closed".
    const { rows: dup } = await client.query(
      'SELECT 1 FROM vat_returns WHERE tenant_id = $1 AND year = $2 AND quarter = $3',
      [tenantId, year, quarter],
    )
    if (dup.length) {
      await client.query('ROLLBACK')
      return { error: { status: 409, body: { error: 'This quarter is already filed', code: 'already_filed' } } }
    }

    // Quarters file in order: the settlement journal is dated period_to, so a
    // quarter at or before books_closed_through (set by a later filing or a
    // manual period close) is rejected up front with the standard 409.
    await assertPeriodOpen(client, tenantId, range.period_to)

    const { output_cents, input_cents } = await vatAccountBalances(client, tenantId, { asOf: range.period_to })
    if (output_cents === 0 && input_cents === 0) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'No VAT to settle in this period', code: 'nothing_to_settle' } } }
    }

    const net = output_cents - input_cents
    const direction = directionFor(net)
    let settlementCode = null
    if (direction === 'payable') settlementCode = requireCode(settings, 'vat_payable_settlement_account_code')
    if (direction === 'receivable') settlementCode = requireCode(settings, 'vat_receivable_settlement_account_code')

    // Clear output VAT (liability: positive balance clears with a debit) and
    // input VAT (asset: positive balance clears with a credit), then book the
    // net on the settlement account.
    const lines = [
      clearingLine(outputCode, output_cents, 'debit'),
      clearingLine(inputCode, input_cents, 'credit'),
    ].filter(Boolean)
    if (direction === 'payable') {
      lines.push({ account_code: settlementCode, debit_cents: 0, credit_cents: net })
    } else if (direction === 'receivable') {
      lines.push({ account_code: settlementCode, debit_cents: -net, credit_cents: 0 })
    }

    const { rows: [row] } = await client.query(
      `INSERT INTO vat_returns (
         tenant_id, year, quarter, period_from, period_to,
         input_vat_cents, output_vat_cents, net_cents, direction,
         settlement_account_code, due_date, notes, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING ${RETURN_COLUMNS}`,
      [
        tenantId, year, quarter, range.period_from, range.period_to,
        input_cents, output_cents, net, direction,
        settlementCode, range.due_date, notes ?? null, actorUserId,
      ],
    )

    await postJournal(client, tenantId, {
      entryDate: range.period_to,
      description: `VAT return ${year} Q${quarter}`,
      sourceType: 'vat_settlement',
      sourceId: row.id,
      sourceEvent: 'filed',
      lines,
      actorUserId,
    })

    // Auto-close the books through the period end: the filed numbers stay
    // final, and anything posted later flows into the next quarter's return.
    await client.query(
      `UPDATE tenant_accounting_settings
          SET books_closed_through = GREATEST(COALESCE(books_closed_through, $2::date), $2::date),
              updated_at = NOW()
        WHERE tenant_id = $1`,
      [tenantId, range.period_to],
    )

    await client.query('COMMIT')
    return { vatReturn: withStatus({ ...row, paid_cents: 0 }) }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'This quarter is already filed', code: 'already_filed' } } }
    }
    throw err
  } finally {
    client.release()
  }
}

// Records one (partial) payment/refund against a filed return and posts the
// cash journal. The return row is locked FOR UPDATE so concurrent payments
// serialize and the overpay check cannot race.
export async function recordVatPayment(pool, tenantId, vatReturnId, payment, actorUserId = null) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const settings = await loadAccountingSettings(client, tenantId)

    const { rows: [ret] } = await client.query(
      `SELECT id, net_cents, direction, settlement_account_code
         FROM vat_returns WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [vatReturnId, tenantId],
    )
    if (!ret) {
      await client.query('ROLLBACK')
      return { error: { status: 404, body: { error: 'Not found' } } }
    }

    let required = null
    if (ret.direction === 'payable') required = 'payment'
    else if (ret.direction === 'receivable') required = 'refund'
    if (payment.direction !== required) {
      await client.query('ROLLBACK')
      return {
        error: {
          status: 400,
          body: { error: `This return does not take a ${payment.direction}`, code: 'direction_mismatch' },
        },
      }
    }

    const { rows: [{ paid_cents }] } = await client.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::int AS paid_cents
         FROM vat_return_payments WHERE vat_return_id = $1 AND tenant_id = $2`,
      [vatReturnId, tenantId],
    )
    const outstanding = Math.abs(ret.net_cents) - paid_cents
    if (payment.amount_cents > outstanding) {
      await client.query('ROLLBACK')
      return {
        error: {
          status: 400,
          body: { error: 'Amount exceeds the outstanding balance', code: 'overpayment', outstanding_cents: outstanding },
        },
      }
    }

    const bankCode = payment.bank_account_code ?? requireCode(settings, 'primary_checking_account_code')
    const { rows: bank } = await client.query(
      `SELECT type FROM chart_of_accounts WHERE tenant_id = $1 AND code = $2`,
      [tenantId, bankCode],
    )
    if (!bank.length || bank[0].type !== 'asset') {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'Bank account must be an asset account', code: 'invalid_bank_account' } } }
    }

    const { rows: [row] } = await client.query(
      `INSERT INTO vat_return_payments (
         tenant_id, vat_return_id, amount_cents, direction, bank_account_code, paid_on, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tenant_id, vat_return_id, amount_cents, direction, bank_account_code,
                 to_char(paid_on, 'YYYY-MM-DD') AS paid_on, created_by_user_id, created_at`,
      [tenantId, vatReturnId, payment.amount_cents, payment.direction, bankCode, payment.paid_on, actorUserId],
    )

    // payment: DR settlement liability / CR bank — refund: DR bank / CR settlement asset
    const settle = { account_code: ret.settlement_account_code }
    const bankLine = { account_code: bankCode }
    if (payment.direction === 'payment') {
      Object.assign(settle, { debit_cents: payment.amount_cents, credit_cents: 0 })
      Object.assign(bankLine, { debit_cents: 0, credit_cents: payment.amount_cents })
    } else {
      Object.assign(settle, { debit_cents: 0, credit_cents: payment.amount_cents })
      Object.assign(bankLine, { debit_cents: payment.amount_cents, credit_cents: 0 })
    }
    await postJournal(client, tenantId, {
      entryDate: payment.paid_on,
      description: `VAT ${payment.direction} for return ${vatReturnId}`,
      sourceType: 'vat_settlement_payment',
      sourceId: row.id,
      sourceEvent: 'paid',
      lines: [settle, bankLine],
      actorUserId,
    })

    await client.query('COMMIT')
    return { payment: row }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
    throw err
  } finally {
    client.release()
  }
}

export async function listVatReturns(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${RETURN_COLUMNS},
            (SELECT COALESCE(SUM(p.amount_cents), 0)::int
               FROM vat_return_payments p
              WHERE p.vat_return_id = vat_returns.id AND p.tenant_id = vat_returns.tenant_id) AS paid_cents
       FROM vat_returns
      WHERE tenant_id = $1
      ORDER BY year DESC, quarter DESC`,
    [tenantId],
  )
  return rows.map(withStatus)
}

// Header + payments + the settlement ledger transaction id, or null (route 404s).
export async function getVatReturn(executor, tenantId, vatReturnId) {
  const { rows: [row] } = await executor.query(
    `SELECT ${RETURN_COLUMNS} FROM vat_returns WHERE id = $1 AND tenant_id = $2`,
    [vatReturnId, tenantId],
  )
  if (!row) return null

  const { rows: payments } = await executor.query(
    `SELECT id, amount_cents, direction, bank_account_code,
            to_char(paid_on, 'YYYY-MM-DD') AS paid_on, created_at
       FROM vat_return_payments
      WHERE vat_return_id = $1 AND tenant_id = $2
      ORDER BY paid_on ASC, id ASC`,
    [vatReturnId, tenantId],
  )
  const paidCents = payments.reduce((s, p) => s + p.amount_cents, 0)

  const { rows: [txn] } = await executor.query(
    `SELECT id FROM ledger_transactions
      WHERE tenant_id = $1 AND source_type = 'vat_settlement' AND source_id = $2 AND source_event = 'filed'`,
    [tenantId, vatReturnId],
  )

  return {
    ...withStatus({ ...row, paid_cents: paidCents }),
    payments,
    ledger_transaction_id: txn?.id ?? null,
  }
}
