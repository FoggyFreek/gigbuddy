// CAMT.053 (ISO 20022 bank-to-customer statement) parser.
//
// Structure: Document/BkToCstmrStmt/Stmt/Ntry, and each Ntry may carry several
// NtryDtls/TxDtls. Ntry/Amt is always the booked cash movement. We expand a
// multi-detail entry only when every detail has an amount in the booked currency
// and those amounts add up exactly to Ntry/Amt; otherwise it remains one line.
import { XMLParser } from 'fast-xml-parser'
import { normalizeIban } from '../../utils/normalizeIban.js'
import { amountToCents, meaningfulRef, BankStatementParseError } from './index.js'

// removeNSPrefix strips the camt namespace prefix; nodes that may repeat are
// coerced to arrays so single/multiple cases share one code path.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // Keep every text value a string: numeric coercion would strip leading zeros
  // from account ids (e.g. Westpac's 032000000007) and reshape amount strings.
  parseTagValue: false,
  isArray: (name) => ['Stmt', 'Ntry', 'NtryDtls', 'TxDtls', 'Bal'].includes(name),
})

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])
// A CAMT element is often { '#text': '100.00', '@_Ccy': 'EUR' } or a bare string.
const text = (v) => (v && typeof v === 'object' ? v['#text'] : v)
const trimOrNull = (v) => {
  const t = text(v)
  return t == null || String(t).trim() === '' ? null : String(t).trim()
}

function dirFromInd(ind) {
  const v = trimOrNull(ind)
  if (v === 'CRDT') return 'credit'
  if (v === 'DBIT') return 'debit'
  return null
}

// true when a boolean-ish node ('true'/'1') is set.
function isTrueFlag(v) {
  const t = trimOrNull(v)
  return t === 'true' || t === '1'
}

// Prefer the IBAN; fall back to a proprietary account id (Othr/Id), which
// non-SEPA banks (e.g. Westpac AU) use instead of an IBAN.
function ibanOf(acct) {
  return normalizeIban(trimOrNull(acct?.Id?.IBAN) ?? trimOrNull(acct?.Id?.Othr?.Id))
}

// The statement's opening balance → { date, signedAmountCents } (CRDT = positive
// account balance, DBIT = overdrawn). Prefers the opening booked balance (OPBD);
// falls back to the previously-closed balance (PRCD) some banks emit instead.
function openingBalanceOf(stmt) {
  const balances = asArray(stmt.Bal)
  const codeOf = (bal) => trimOrNull(bal?.Tp?.CdOrPrtry?.Cd)
  const bal = balances.find((b) => codeOf(b) === 'OPBD') ?? balances.find((b) => codeOf(b) === 'PRCD')
  if (!bal) return null
  const dir = dirFromInd(bal.CdtDbtInd)
  const amt = text(bal.Amt)
  if (!dir || amt == null) return null
  const cents = amountToCents(amt)
  const date = trimOrNull(bal.Dt?.Dt) ?? trimOrNull(bal.Dt?.DtTm)?.slice(0, 10) ?? null
  return { date, signedAmountCents: dir === 'debit' ? -cents : cents }
}

// Preserve both structured creditor references and unstructured remittance text.
// Both elements may repeat, and structured references are the more useful value
// for automated reconciliation, so place those first.
function remittanceOf(rmtInf) {
  if (!rmtInf) return null
  const ustrd = asArray(rmtInf.Ustrd).map(trimOrNull).filter(Boolean)
  const structured = asArray(rmtInf.Strd)
    .map((item) => trimOrNull(item?.CdtrRefInf?.Ref))
    .filter(Boolean)
  const parts = [...new Set([...structured, ...ustrd])]
  return parts.length ? parts.join(' ') : null
}

function detailAmountNode(txDtls) {
  return txDtls?.Amt ?? txDtls?.AmtDtls?.TxAmt?.Amt ?? null
}

function currencyOf(amountNode, fallback) {
  return (amountNode && typeof amountNode === 'object' ? amountNode['@_Ccy'] : null) ?? fallback ?? null
}

// Detail amounts describe underlying/original transactions, not necessarily the
// booked movement. They are safe to use as a split only if they reconcile to the
// entry amount in the same currency.
function detailsReconcile(txDetails, entryAmt, entryCcy, entryDir) {
  if (txDetails.length < 2 || entryAmt == null || !entryDir) return false
  const entryAmountCents = amountToCents(text(entryAmt))
  let detailTotalCents = 0
  for (const txDtls of txDetails) {
    const amountNode = detailAmountNode(txDtls)
    if (amountNode == null || currencyOf(amountNode, entryCcy) !== entryCcy) return false
    const detailDir = dirFromInd(txDtls?.CdtDbtInd)
    if (detailDir && detailDir !== entryDir) return false
    detailTotalCents += amountToCents(text(amountNode))
  }
  return detailTotalCents === entryAmountCents
}

function partyNameOf(party) {
  // V02 puts Nm directly below Dbtr/Cdtr. V08+ wraps it in the Party choice.
  return trimOrNull(party?.Pty?.Nm) ?? trimOrNull(party?.Nm)
}

// Build one normalized line from a TxDtls (or the aggregate entry). RvslInd
// explains why the entry exists; CdtDbtInd remains the booked direction.
function buildLine({
  txDtls, entryDir, amountNode, entryCcy, bookingDate, valueDate, entryRef,
  isReversal, partiesUseOriginalDirection,
}) {
  if (!entryDir) throw new BankStatementParseError('entry missing CdtDbtInd')
  const direction = entryDir
  const amountCents = amountToCents(text(amountNode))
  const currency = currencyOf(amountNode, entryCcy)

  const parties = txDtls?.RltdPties
  // Reversal parties retain their roles from the original transaction, whose
  // direction is the opposite of this booked reversal movement.
  const partyDirection = partiesUseOriginalDirection
    ? (direction === 'credit' ? 'debit' : 'credit')
    : direction
  const counterparty = partyDirection === 'debit' ? parties?.Cdtr : parties?.Dbtr
  const counterpartyAcct = partyDirection === 'debit' ? parties?.CdtrAcct : parties?.DbtrAcct
  const refs = txDtls?.Refs

  return {
    bookingDate,
    valueDate,
    amountCents,
    direction,
    currency,
    counterpartyName: partyNameOf(counterparty),
    counterpartyIban: ibanOf(counterpartyAcct),
    remittance: remittanceOf(txDtls?.RmtInf),
    bankRef: meaningfulRef(trimOrNull(refs?.AcctSvcrRef) ?? entryRef),
    endToEndId: meaningfulRef(trimOrNull(refs?.EndToEndId)),
    isReversal,
  }
}

export function parseCamt053(xml) {
  let doc
  try {
    doc = parser.parse(xml)
  } catch (err) {
    throw new BankStatementParseError(`invalid CAMT XML: ${err.message}`)
  }
  const bkToCstmr = doc?.Document?.BkToCstmrStmt
  if (!bkToCstmr) throw new BankStatementParseError('not a CAMT.053 document (missing BkToCstmrStmt)')

  const stmts = asArray(bkToCstmr.Stmt)
  if (!stmts.length) throw new BankStatementParseError('CAMT statement has no Stmt')
  const statementAccounts = [...new Set(stmts.map((stmt) => ibanOf(stmt.Acct)).filter(Boolean))]
  if (statementAccounts.length > 1) {
    throw new BankStatementParseError('CAMT document contains multiple accounts')
  }
  const statementCurrencies = [...new Set(stmts.map((stmt) => trimOrNull(stmt.Acct?.Ccy)).filter(Boolean))]
  if (statementCurrencies.length > 1) {
    throw new BankStatementParseError('CAMT document contains multiple currencies')
  }
  const first = stmts[0]
  const accountIban = statementAccounts[0] ?? null
  const statementCcy = statementCurrencies[0] ?? null
  const statementRef = trimOrNull(first.Id) ?? trimOrNull(first.ElctrncSeqNb) ?? null

  const lines = []
  for (const stmt of stmts) {
    const stmtCcy = trimOrNull(stmt.Acct?.Ccy) ?? statementCcy
    for (const ntry of asArray(stmt.Ntry)) {
      const entryDir = dirFromInd(ntry.CdtDbtInd)
      const entryCcy = (ntry.Amt && typeof ntry.Amt === 'object' ? ntry.Amt['@_Ccy'] : null) ?? stmtCcy
      const bookingDate = trimOrNull(ntry.BookgDt?.Dt) ?? trimOrNull(ntry.BookgDt?.DtTm)?.slice(0, 10)
      const valueDate = trimOrNull(ntry.ValDt?.Dt) ?? trimOrNull(ntry.ValDt?.DtTm)?.slice(0, 10) ?? null
      const entryRef = trimOrNull(ntry.AcctSvcrRef) ?? trimOrNull(ntry.NtryRef)
      const entryReversal = isTrueFlag(ntry.RvslInd)
      if (!bookingDate) throw new BankStatementParseError('entry missing booking date')

      const entryReturn = Boolean(ntry.RtrInf)
      const txDetails = asArray(ntry.NtryDtls).flatMap((d) => asArray(d.TxDtls))
      if (!txDetails.length) {
        lines.push(buildLine({
          txDtls: null, entryDir, amountNode: ntry.Amt, entryCcy,
          bookingDate, valueDate, entryRef,
          isReversal: entryReversal || entryReturn,
          partiesUseOriginalDirection: entryReversal,
        }))
        continue
      }

      if (txDetails.length === 1) {
        const txDtls = txDetails[0]
        const txReversal = isTrueFlag(txDtls.RvslInd)
        lines.push(buildLine({
          txDtls, entryDir, amountNode: ntry.Amt, entryCcy,
          bookingDate, valueDate, entryRef,
          isReversal: entryReversal || txReversal || entryReturn || Boolean(txDtls.RtrInf),
          partiesUseOriginalDirection: entryReversal || txReversal,
        }))
        continue
      }

      if (!detailsReconcile(txDetails, ntry.Amt, entryCcy, entryDir)) {
        lines.push(buildLine({
          txDtls: null, entryDir, amountNode: ntry.Amt, entryCcy,
          bookingDate, valueDate, entryRef,
          isReversal: entryReversal || entryReturn
            || txDetails.some((tx) => isTrueFlag(tx.RvslInd) || Boolean(tx.RtrInf)),
          partiesUseOriginalDirection: entryReversal,
        }))
        continue
      }

      for (const txDtls of txDetails) {
        const txReversal = isTrueFlag(txDtls.RvslInd)
        lines.push(buildLine({
          txDtls, entryDir, amountNode: detailAmountNode(txDtls), entryCcy,
          bookingDate, valueDate, entryRef,
          isReversal: entryReversal || txReversal || entryReturn || Boolean(txDtls.RtrInf),
          partiesUseOriginalDirection: entryReversal || txReversal,
        }))
      }
    }
  }

  return {
    format: 'camt053',
    currency: statementCcy ?? lines[0]?.currency ?? null,
    accountIban,
    statementRef,
    openingBalance: openingBalanceOf(first),
    lines,
  }
}
