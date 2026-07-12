// Bank statement parsing: normalize CAMT.053 (ISO 20022 XML) and SWIFT MT940
// (line-oriented text) into a common shape the importer stages verbatim.
//
// A parsed statement is { format, currency, accountIban, statementRef,
// openingBalance, lines }. openingBalance is { date, signedAmountCents } (signed:
// positive = a normal positive account balance, negative = overdrawn) or null
// when the statement carries no opening-balance element.
// Each line is a ParsedStatementLine:
//   { bookingDate, valueDate, amountCents (>0), direction 'credit'|'debit',
//     currency, counterpartyName, counterpartyIban, remittance, bankRef,
//     endToEndId, isReversal }
// direction is the booked/effective money movement. CAMT CdtDbtInd already
// carries that direction even when RvslInd is true; MT940 RC/RD marks are
// normalized by its parser.
import { decodeUploadedText } from '../../utils/decodeText.js'
import { parseCamt053 } from './camt053.js'
import { parseMt940 } from './mt940.js'

export class BankStatementParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BankStatementParseError'
  }
}

// A decimal string ("100.00", "1.234,56", "100") → integer cents. Handles both
// '.' and ',' decimal separators and thousands separators of the other kind.
export function amountToCents(raw) {
  if (raw == null) throw new BankStatementParseError('missing amount')
  let s = String(raw).trim().replace(/\s/g, '')
  if (s === '') throw new BankStatementParseError('empty amount')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  // The rightmost separator is the decimal point; the other is a grouping sep.
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = Number(s)
  if (!Number.isFinite(n)) throw new BankStatementParseError(`invalid amount: ${raw}`)
  return Math.round(Math.abs(n) * 100)
}

export function oppositeDirection(direction) {
  return direction === 'credit' ? 'debit' : 'credit'
}

// Bank references that carry no real identity — never a duplicate signal.
const SENTINEL_REFS = new Set(['NONREF', 'NOTPROVIDED', 'NULL', 'NA', 'N/A'])
export function meaningfulRef(value) {
  if (value == null) return null
  const s = String(value).trim()
  return s === '' || SENTINEL_REFS.has(s.toUpperCase()) ? null : s
}

// Sniff format from decoded text and dispatch. XML (CAMT) starts with '<' after
// an optional BOM/declaration; MT940 is SWIFT tag text (:20:/:25:/:61:).
export function parseBankStatement(buffer) {
  const text = decodeUploadedText(buffer)
  const head = text.slice(0, 4096)
  const looksXml = /<\s*(\w+:)?Document[\s>]/.test(head) || head.trimStart().startsWith('<?xml')
  const looksMt940 = /(^|\n)\s*:(20|25|28C|60F|61):/.test(head)

  if (looksXml && !looksMt940) return parseCamt053(text)
  if (looksMt940) return parseMt940(text)
  throw new BankStatementParseError('Unrecognized statement format (expected CAMT.053 XML or MT940)')
}
