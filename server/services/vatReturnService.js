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
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { vatAccountBalances } from '../repositories/ledgerRepository.js'
import {
  vatReturnExists,
  insertVatReturn,
  closeBooksThrough,
  lockVatReturn,
  sumVatReturnPayments,
  getAccountType,
  insertVatReturnPayment,
  listVatReturns as listVatReturnRows,
  fetchVatReturn,
  listVatReturnPayments,
  findFilingTransactionId,
  activeVatReturnForPeriod,
  insertPreparedVatReturn,
  insertVatReturnBoxes,
  linkVatReturnTaxFacts,
  listVatReturnBoxes,
  listVatReturnFacts,
  listExceptionAcknowledgements,
  acknowledgeVatReturnException as acknowledgeExceptionRow,
  submitPreparedVatReturn,
  lockPreparedVatReturn,
  lockVatPeriodThrough,
} from '../repositories/vatReturnRepository.js'
import { loadAccountingProfile } from './accountingProfileService.js'
import {
  listUnreportedTaxFacts,
  reconcileTaxFactsToLedger,
} from '../repositories/taxFactRepository.js'
import {
  NL_VAT_RETURN_SCHEMA_2026,
  computeNlVatReturnBoxes,
  declaredEuroFor,
  getNlVatReturnBoxDescription,
} from '../domain/vat/nlVatReturn2026.js'

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
  // VAT filing quarters remain calendar-based and do not follow the reporting
  // fiscal-year start stored in the accounting profile.
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
  const profile = await loadAccountingProfile(executor, tenantId)
  if (profile.country_code === 'nl' && year === NL_VAT_RETURN_SCHEMA_2026.year) {
    return previewNlVatReturn(executor, tenantId, {
      year,
      quarter,
      profile,
      range,
    })
  }
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
      calculation_mode: 'legacy_generic',
      warning_code: profile.country_code === 'nl'
        ? 'country_schema_unavailable'
        : 'generic_vat_balance_fallback',
    },
  }
}

function declaredBoxes(rawBoxes) {
  const boxes = Object.fromEntries(Object.entries(rawBoxes).map(([code, value]) => [
    code,
    {
      ...value,
      description: getNlVatReturnBoxDescription(code),
      base_declared_euros: 'base_cents' in value
        ? declaredEuroFor(value.base_cents, 'base')
        : null,
      vat_declared_euros: 'vat_cents' in value
        ? declaredEuroFor(value.vat_cents, code === '5b' ? 'input_vat' : 'output_vat')
        : null,
    },
  ]))
  boxes['5c'].vat_declared_euros =
    boxes['5a'].vat_declared_euros - boxes['5b'].vat_declared_euros
  return boxes
}

function describeNlBoxRows(boxes) {
  return boxes.map((box) => ({
    ...box,
    description: getNlVatReturnBoxDescription(box.box_code),
  }))
}

function workpaperExceptions(facts, unmapped, reconciliation) {
  const exceptions = []
  const reviewFacts = facts.filter((fact) => fact.classification_status !== 'confirmed')
  if (reviewFacts.length) {
    exceptions.push({
      key: 'unconfirmed_tax_categories',
      blocking: true,
      count: reviewFacts.length,
      tax_fact_ids: reviewFacts.map((fact) => fact.id),
    })
  }
  const unmappedAmounts = unmapped.filter((fact) =>
    Number(fact.output_vat_cents) !== 0 || Number(fact.deductible_input_vat_cents) !== 0)
  if (unmappedAmounts.length) {
    exceptions.push({
      key: 'unmapped_tax_amounts',
      blocking: true,
      count: unmappedAmounts.length,
      tax_fact_ids: unmappedAmounts.map((fact) => fact.id),
    })
  }
  if (reconciliation.output_difference_cents !== 0 || reconciliation.input_difference_cents !== 0) {
    exceptions.push({
      key: 'ledger_reconciliation_difference',
      blocking: true,
      output_difference_cents: reconciliation.output_difference_cents,
      input_difference_cents: reconciliation.input_difference_cents,
    })
  }
  const amendments = facts.filter((fact) => fact.inclusion_kind === 'amendment')
  if (amendments.length) {
    exceptions.push({
      key: 'prior_period_amendments',
      blocking: false,
      count: amendments.length,
      tax_fact_ids: amendments.map((fact) => fact.id),
    })
  }
  return exceptions
}

async function previewNlVatReturn(executor, tenantId, { year, quarter, profile, range }) {
  const facts = await listUnreportedTaxFacts(executor, tenantId, {
    jurisdiction: 'nl',
    from: range.period_from,
    to: range.period_to,
  })
  const computed = computeNlVatReturnBoxes(facts)
  const boxes = declaredBoxes(computed.boxes)
  const reconciliation = await reconcileTaxFactsToLedger(
    executor,
    tenantId,
    facts.map((fact) => fact.id),
    { asOf: range.period_to },
  )
  const exceptions = workpaperExceptions(facts, computed.unmapped, reconciliation)
  const rawOutput = boxes['5a'].vat_cents
  const rawInput = boxes['5b'].vat_cents
  const rawNet = rawOutput - rawInput
  return {
    preview: {
      year,
      quarter,
      period_key: `${year}-Q${quarter}`,
      ...range,
      schema_country_code: 'nl',
      schema_version: NL_VAT_RETURN_SCHEMA_2026.version,
      schema_source_url: NL_VAT_RETURN_SCHEMA_2026.sourceUrl,
      calculation_mode: 'category_workpaper',
      filing_frequency: profile.vat_filing_frequency,
      output_vat_cents: rawOutput,
      input_vat_cents: rawInput,
      net_cents: rawNet,
      declared_net_cents: boxes['5c'].vat_declared_euros * 100,
      direction: directionFor(boxes['5c'].vat_declared_euros),
      period_ended: range.period_to < today(),
      boxes,
      reconciliation,
      exceptions,
      facts,
      icp_candidates: computed.icp_candidates,
    },
  }
}

export async function prepareNlVatReturn(
  pool, tenantId, { year, quarter, notes }, actorUserId = null,
) {
  const range = quarterRange(year, quarter)
  if (range.period_to >= today()) {
    return { error: { status: 400, body: { error: 'The quarter has not ended yet', code: 'period_not_ended' } } }
  }
  return withTransaction(async (client) => {
    const profile = await loadAccountingProfile(client, tenantId)
    if (profile.country_code !== 'nl' || year !== NL_VAT_RETURN_SCHEMA_2026.year) {
      abortTransaction({
        error: {
          status: 409,
          body: { error: 'No country workpaper is available for this period', code: 'country_schema_unavailable' },
        },
      })
    }
    if (await activeVatReturnForPeriod(client, tenantId, range.period_from, range.period_to)) {
      abortTransaction({ error: { status: 409, body: { error: 'This period already has a return', code: 'already_filed' } } })
    }
    const { preview } = await previewNlVatReturn(client, tenantId, { year, quarter, profile, range })
    if (!preview.facts.length) {
      abortTransaction({ error: { status: 400, body: { error: 'No VAT facts in this period', code: 'nothing_to_settle' } } })
    }
    if (preview.facts.some((fact) => fact.classification_status !== 'confirmed')) {
      abortTransaction({
        error: {
          status: 409,
          body: {
            error: 'Review inferred VAT categories before preparing the return',
            code: 'vat_categories_require_review',
          },
        },
      })
    }
    if (preview.reconciliation.output_difference_cents !== 0
      || preview.reconciliation.input_difference_cents !== 0) {
      abortTransaction({
        error: {
          status: 409,
          body: {
            error: 'VAT control accounts do not reconcile to tax facts',
            code: 'vat_ledger_reconciliation_required',
            reconciliation: preview.reconciliation,
          },
        },
      })
    }
    const row = await insertPreparedVatReturn(client, tenantId, {
      year,
      quarter,
      periodFrom: range.period_from,
      periodTo: range.period_to,
      periodKey: preview.period_key,
      schemaCountryCode: 'nl',
      schemaVersion: preview.schema_version,
      filingFrequency: preview.filing_frequency,
      inputVatCents: preview.boxes['5b'].vat_declared_euros * 100,
      outputVatCents: preview.boxes['5a'].vat_declared_euros * 100,
      netCents: preview.declared_net_cents,
      rawInputVatCents: preview.input_vat_cents,
      rawOutputVatCents: preview.output_vat_cents,
      rawNetCents: preview.net_cents,
      direction: directionFor(preview.declared_net_cents),
      dueDate: range.due_date,
      notes,
      actorUserId,
      boxes: preview.boxes,
      reconciliation: preview.reconciliation,
      exceptions: preview.exceptions,
    })
    await insertVatReturnBoxes(client, tenantId, row.id, preview.boxes)
    await linkVatReturnTaxFacts(client, tenantId, row.id, preview.facts)
    const boxes = describeNlBoxRows(await listVatReturnBoxes(client, tenantId, row.id))
    return { vatReturn: { ...row, boxes, facts: preview.facts } }
  }, {
    db: pool,
    mapError: (err) => err.code === '23505'
      ? { error: { status: 409, body: { error: 'This period already has a return', code: 'already_filed' } } }
      : null,
  })
}

// Files the quarter: inserts the vat_returns row, posts the settlement journal
// and auto-closes the books through the period end — all in one transaction.
async function createLegacyVatReturn(pool, tenantId, { year, quarter, notes }, actorUserId = null) {
  const range = quarterRange(year, quarter)
  if (range.period_to >= today()) {
    return { error: { status: 400, body: { error: 'The quarter has not ended yet', code: 'period_not_ended' } } }
  }

  return withTransaction(async (client) => {
    const settings = await loadAccountingSettings(client, tenantId)
    const profile = await loadAccountingProfile(client, tenantId)
    const inputCode = requireCode(settings, 'input_vat_account_code')
    const outputCode = requireCode(settings, 'output_vat_account_code')

    // Friendly pre-check; the UNIQUE (tenant_id, year, quarter) constraint is
    // the backstop against concurrent filings. Must run before the period-open
    // check: refiling a settled quarter should say "already filed", not
    // "period closed".
    if (await vatReturnExists(client, tenantId, year, quarter)) {
      abortTransaction({ error: { status: 409, body: { error: 'This quarter is already filed', code: 'already_filed' } } })
    }

    // Quarters file in order: the settlement journal is dated period_to, so a
    // quarter at or before books_closed_through (set by a later filing or a
    // manual period close) is rejected up front with the standard 409.
    await assertPeriodOpen(client, tenantId, range.period_to)

    const { output_cents, input_cents } = await vatAccountBalances(client, tenantId, { asOf: range.period_to })
    if (output_cents === 0 && input_cents === 0) {
      abortTransaction({ error: { status: 400, body: { error: 'No VAT to settle in this period', code: 'nothing_to_settle' } } })
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

    const row = await insertVatReturn(client, tenantId, {
      year,
      quarter,
      periodFrom: range.period_from,
      periodTo: range.period_to,
      inputVatCents: input_cents,
      outputVatCents: output_cents,
      netCents: net,
      direction,
      settlementAccountCode: settlementCode,
      dueDate: range.due_date,
      notes: notes ?? null,
      createdByUserId: actorUserId,
    })
    const legacyFacts = await listUnreportedTaxFacts(client, tenantId, {
      jurisdiction: profile.country_code,
      from: range.period_from,
      to: range.period_to,
    })
    await linkVatReturnTaxFacts(
      client,
      tenantId,
      row.id,
      legacyFacts.map((fact) => ({ ...fact, inclusion_kind: 'legacy_assigned' })),
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
    await closeBooksThrough(client, tenantId, range.period_to)

    return { vatReturn: withStatus({ ...row, paid_cents: 0 }) }
  }, {
    db: pool,
    mapError: (err) => {
      const mapped = ledgerErrorResult(err)
      if (mapped) return mapped
      if (err.code === '23505') {
        return { error: { status: 409, body: { error: 'This quarter is already filed', code: 'already_filed' } } }
      }
      return null
    },
  })
}

export async function createVatReturn(pool, tenantId, request, actorUserId = null) {
  const profile = await loadAccountingProfile(pool, tenantId)
  if (request.calculationMode === 'category_workpaper'
    && profile.country_code === 'nl'
    && request.year === NL_VAT_RETURN_SCHEMA_2026.year) {
    return prepareNlVatReturn(pool, tenantId, request, actorUserId)
  }
  return createLegacyVatReturn(pool, tenantId, request, actorUserId)
}

export async function acknowledgeVatReturnException(
  pool, tenantId, vatReturnId, { exceptionKey, note }, actorUserId,
) {
  const row = await acknowledgeExceptionRow(
    pool, tenantId, vatReturnId, exceptionKey, note, actorUserId,
  )
  return row
    ? { acknowledgement: row }
    : { error: { status: 404, body: { error: 'Not found' } } }
}

function sumJournalSides(lines) {
  return lines.reduce((totals, line) => ({
    debit: totals.debit + Number(line.debit_cents ?? 0),
    credit: totals.credit + Number(line.credit_cents ?? 0),
  }), { debit: 0, credit: 0 })
}

export async function submitNlVatReturn(
  pool, tenantId, vatReturnId, { submissionReference }, actorUserId = null,
) {
  return withTransaction(async (client) => {
    const ret = await lockPreparedVatReturn(client, tenantId, vatReturnId)
    if (!ret) abortTransaction({ error: { status: 404, body: { error: 'Not found' } } })
    if (ret.calculation_mode !== 'category_workpaper' || ret.workflow_status !== 'prepared') {
      abortTransaction({
        error: { status: 409, body: { error: 'Return is not prepared', code: 'return_not_prepared' } },
      })
    }
    const exceptions = Array.isArray(ret.exceptions_snapshot) ? ret.exceptions_snapshot : []
    const acknowledgements = await listExceptionAcknowledgements(client, tenantId, vatReturnId)
    const acknowledged = new Set(acknowledgements.map((item) => item.exception_key))
    const unresolved = exceptions.filter((item) => item.blocking && !acknowledged.has(item.key))
    if (unresolved.length) {
      abortTransaction({
        error: {
          status: 409,
          body: {
            error: 'Blocking VAT exceptions must be resolved or acknowledged',
            code: 'vat_exceptions_unresolved',
            exception_keys: unresolved.map((item) => item.key),
          },
        },
      })
    }

    const settings = await loadAccountingSettings(client, tenantId)
    const inputCode = requireCode(settings, 'input_vat_account_code')
    const outputCode = requireCode(settings, 'output_vat_account_code')
    let settlementCode = null
    if (ret.direction === 'payable') {
      settlementCode = requireCode(settings, 'vat_payable_settlement_account_code')
    } else if (ret.direction === 'receivable') {
      settlementCode = requireCode(settings, 'vat_receivable_settlement_account_code')
    }
    const lines = [
      clearingLine(outputCode, Number(ret.raw_output_vat_cents), 'debit'),
      clearingLine(inputCode, Number(ret.raw_input_vat_cents), 'credit'),
    ].filter(Boolean)
    if (ret.direction === 'payable') {
      lines.push({ account_code: settlementCode, credit_cents: Number(ret.net_cents) })
    } else if (ret.direction === 'receivable') {
      lines.push({ account_code: settlementCode, debit_cents: -Number(ret.net_cents) })
    }
    const sides = sumJournalSides(lines)
    const roundingCents = sides.debit - sides.credit
    if (roundingCents !== 0) {
      const roundingCode = requireCode(settings, 'vat_rounding_account_code')
      lines.push(roundingCents > 0
        ? { account_code: roundingCode, credit_cents: roundingCents }
        : { account_code: roundingCode, debit_cents: -roundingCents })
    }

    await postJournal(client, tenantId, {
      entryDate: ret.period_to,
      description: `VAT return ${ret.period_key}`,
      sourceType: 'vat_settlement',
      sourceId: ret.id,
      sourceEvent: 'filed',
      lines,
      actorUserId,
    })
    const submitted = await submitPreparedVatReturn(client, tenantId, vatReturnId, {
      settlementAccountCode: settlementCode,
      reference: submissionReference,
      actorUserId,
    })
    await lockVatPeriodThrough(client, tenantId, ret.period_to)
    return { vatReturn: withStatus({ ...submitted, paid_cents: 0 }) }
  }, { db: pool, mapError: ledgerErrorResult })
}

// Records one (partial) payment/refund against a filed return and posts the
// cash journal. The return row is locked FOR UPDATE so concurrent payments
// serialize and the overpay check cannot race.
export async function recordVatPayment(pool, tenantId, vatReturnId, payment, actorUserId = null) {
  return withTransaction(async (client) => {
    const settings = await loadAccountingSettings(client, tenantId)

    const ret = await lockVatReturn(client, tenantId, vatReturnId)
    if (!ret) abortTransaction({ error: { status: 404, body: { error: 'Not found' } } })
    if (ret.workflow_status !== 'submitted') {
      abortTransaction({
        error: { status: 409, body: { error: 'Return has not been submitted', code: 'return_not_submitted' } },
      })
    }

    let required = null
    if (ret.direction === 'payable') required = 'payment'
    else if (ret.direction === 'receivable') required = 'refund'
    if (payment.direction !== required) {
      abortTransaction({
        error: {
          status: 400,
          body: { error: `This return does not take a ${payment.direction}`, code: 'direction_mismatch' },
        },
      })
    }

    const paid_cents = await sumVatReturnPayments(client, tenantId, vatReturnId)
    const outstanding = Math.abs(ret.net_cents) - paid_cents
    if (payment.amount_cents > outstanding) {
      abortTransaction({
        error: {
          status: 400,
          body: { error: 'Amount exceeds the outstanding balance', code: 'overpayment', outstanding_cents: outstanding },
        },
      })
    }

    const bankCode = payment.bank_account_code ?? requireCode(settings, 'primary_checking_account_code')
    if (await getAccountType(client, tenantId, bankCode) !== 'asset') {
      abortTransaction({ error: { status: 400, body: { error: 'Bank account must be an asset account', code: 'invalid_bank_account' } } })
    }

    const row = await insertVatReturnPayment(client, tenantId, vatReturnId, {
      amountCents: payment.amount_cents,
      direction: payment.direction,
      bankAccountCode: bankCode,
      paidOn: payment.paid_on,
      createdByUserId: actorUserId,
    })

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

    return { payment: row }
  }, { db: pool, mapError: ledgerErrorResult })
}

export async function listVatReturns(executor, tenantId) {
  return (await listVatReturnRows(executor, tenantId)).map(withStatus)
}

// Header + payments + the settlement ledger transaction id, or null (route 404s).
export async function getVatReturn(executor, tenantId, vatReturnId) {
  const row = await fetchVatReturn(executor, tenantId, vatReturnId)
  if (!row) return null

  const payments = await listVatReturnPayments(executor, tenantId, vatReturnId)
  const paidCents = payments.reduce((s, p) => s + p.amount_cents, 0)

  const categoryWorkpaper = row.calculation_mode === 'category_workpaper'
  return {
    ...withStatus({ ...row, paid_cents: paidCents }),
    payments,
    ledger_transaction_id: await findFilingTransactionId(executor, tenantId, vatReturnId),
    boxes: categoryWorkpaper
      ? describeNlBoxRows(await listVatReturnBoxes(executor, tenantId, vatReturnId))
      : [],
    facts: categoryWorkpaper ? await listVatReturnFacts(executor, tenantId, vatReturnId) : [],
    acknowledgements: categoryWorkpaper
      ? await listExceptionAcknowledgements(executor, tenantId, vatReturnId)
      : [],
  }
}
