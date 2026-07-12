// SWIFT MT940 (customer statement message) parser.
//
// A file can contain multiple statements. Each statement is validated and
// parsed independently before same-account/same-currency statements are
// combined into the importer's normalized statement shape.
import { amountToCents, oppositeDirection, normalizeIban, meaningfulRef, BankStatementParseError } from './index.js'

// Value date, optional entry date, D/C mark, optional funds code, amount,
// mandatory four-character transaction type, owner reference and bank ref.
const RE_61 = /^(\d{6})(\d{4})?(RC|RD|EC|ED|C|D)([A-Za-z])?(\d+,\d*)([A-Za-z][A-Za-z0-9]{3})(.*)$/

const STRUCTURED_86_CODEWORDS = new Set([
  'RTRN', 'CREF', 'EREF', 'PREF', 'IREF', 'MARF', 'CSID', 'CNTP',
  'REMI', 'PURP', 'ULTC', 'ULTD', 'EXCH', 'CHGS',
  'TRTP', 'IBAN', 'NAME', 'ORDP', 'BENM', 'RREF', 'RCMT', 'CHRG',
])

function markToDirection(mark) {
  const normalized = mark.toUpperCase()
  const isReversal = normalized.startsWith('R')
  const base = normalized.endsWith('C') ? 'credit' : 'debit'
  return { direction: isReversal ? oppositeDirection(base) : base, isReversal }
}

function isoFromParts(year, month, day, source) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BankStatementParseError(`MT940 date is not a valid date: ${source}`)
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// MT940 dates have no century; uploaded statements are treated as contemporary.
function isoDate(yymmdd) {
  if (!/^\d{6}$/.test(yymmdd)) {
    throw new BankStatementParseError(`MT940 date is not a valid date: ${yymmdd}`)
  }
  return isoFromParts(
    2000 + Number(yymmdd.slice(0, 2)),
    Number(yymmdd.slice(2, 4)),
    Number(yymmdd.slice(4, 6)),
    yymmdd,
  )
}

function isoEntryDate(mmdd, valueIso) {
  if (!mmdd) return null
  return isoFromParts(
    Number(valueIso.slice(0, 4)),
    Number(mmdd.slice(0, 2)),
    Number(mmdd.slice(2, 4)),
    mmdd,
  )
}

function swiftAmountToCents(raw, field) {
  if (!/^\d+,\d*$/.test(raw) || raw.length > 15) {
    throw new BankStatementParseError(`invalid MT940 amount in :${field}: ${raw}`)
  }
  return amountToCents(raw)
}

function firstPhysicalLine(value) {
  return value.split(/\r?\n/, 1)[0].trim()
}

function parseBalance(record) {
  // Transport trailers and multi-statement separators can be appended as a
  // continuation line, so only the balance's first physical line is parsed.
  const value = firstPhysicalLine(record.value)
  const match = /^([CD])(\d{6})([A-Z]{3})(\d+,\d*)$/.exec(value)
  if (!match) throw new BankStatementParseError(`unparseable :${record.tag}: balance`)
  const [, mark, yymmdd, currency, amount] = match
  const cents = swiftAmountToCents(amount, record.tag)
  return {
    currency,
    date: isoDate(yymmdd),
    signedAmountCents: mark === 'D' ? -cents : cents,
  }
}

function currencyFromAccount(value) {
  const match = /\b([A-Z]{3})\s*$/.exec(value.trim())
  return match ? match[1] : null
}

function structured86Fields(text) {
  const matches = Array.from(text.matchAll(/\/([A-Z]{3,4})\//g))
    .filter((match) => STRUCTURED_86_CODEWORDS.has(match[1]))
  if (!matches.length) return null

  const fields = {}
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? text.length
    const value = text.slice(start, end).replace(/\s+/g, ' ').trim()
    fields[match[1]] = [...(fields[match[1]] ?? []), value]
  }
  return fields
}

function trimSubfield(value) {
  return value?.replace(/\/+$/, '').trim() || null
}

function remittanceSubfield(value) {
  let result = trimSubfield(value)
  if (!result) return null
  if (result.startsWith('USTD//')) result = result.slice('USTD//'.length)
  else if (result.startsWith('STRD/CUR/')) result = result.slice('STRD/CUR/'.length)
  else if (result.startsWith('STRD/ISO/')) result = result.slice('STRD/ISO/'.length)
  return trimSubfield(result)
}

function parse86(body) {
  const trimmed = body.trim()
  const fields = trimmed.startsWith('/') ? structured86Fields(trimmed) : null
  if (fields) {
    // ING CNTP is account/BIC/name/city. Empty subfields and slashes inside
    // REMI are significant, so codeword bodies are parsed individually.
    const counterparty = trimSubfield(fields.CNTP?.[0])?.split('/') ?? []
    const name = trimSubfield(fields.NAME?.[0]) ?? trimSubfield(counterparty[2])
    const iban = trimSubfield(fields.IBAN?.[0]) ?? trimSubfield(counterparty[0])
    const remittance = [
      ...(fields.REMI ?? []).map(remittanceSubfield),
      ...(fields.EREF ?? []).map(trimSubfield),
    ].filter(Boolean).join(' ') || null
    return { name, iban, remittance }
  }

  // German-style ?nn subfields: ?20-?29 remittance, ?32/?33 name, ?38 IBAN.
  if (trimmed.includes('?')) {
    const subfields = {}
    for (const match of trimmed.matchAll(/\?(\d{2})([^?]*)/g)) {
      subfields[match[1]] = (subfields[match[1]] ?? '') + match[2]
    }
    const remittance = Array.from({ length: 10 }, (_, index) => subfields[String(20 + index)])
      .filter(Boolean).join(' ') || null
    const name = [subfields['32'], subfields['33']].filter(Boolean).join(' ') || null
    return { name, iban: subfields['38'] ?? null, remittance }
  }

  const flat = trimmed.replace(/\s+/g, ' ').trim()
  return { name: null, iban: null, remittance: flat || null }
}

function findIban(...texts) {
  for (const text of texts) {
    if (!text) continue
    const match = /\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/.exec(text.replace(/\s/g, ''))
    if (match) return match[1]
  }
  return null
}

// Split raw text into tag records while retaining physical continuation lines.
function tokenize(text) {
  const records = []
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const match = /^:(\d{2}[A-Z]?):(.*)$/.exec(rawLine)
    if (match) {
      if (current) records.push(current)
      current = { tag: match[1], value: match[2] }
    } else if (current) {
      current.value += `\n${rawLine}`
    }
  }
  if (current) records.push(current)
  return records
}

function splitStatementRecords(records) {
  const statements = []
  let current = null
  for (const record of records) {
    if (record.tag === '20') {
      if (current) statements.push(current)
      current = [record]
    } else if (!current) {
      throw new BankStatementParseError('MT940 statement missing :20:')
    } else {
      current.push(record)
    }
  }
  if (current) statements.push(current)
  if (!statements.length) throw new BankStatementParseError('MT940 statement missing :20:')
  return statements
}

function requireRecord(records, tag) {
  const matches = records.filter((record) => record.tag === tag)
  if (!matches.length) throw new BankStatementParseError(`MT940 statement missing :${tag}:`)
  if (matches.length > 1) throw new BankStatementParseError(`MT940 statement has duplicate :${tag}:`)
  return matches[0]
}

function requireOptionRecord(records, tags) {
  const matches = records.filter((record) => tags.includes(record.tag))
  if (!matches.length) {
    throw new BankStatementParseError(`MT940 statement missing :${tags[0]}: or :${tags[1]}:`)
  }
  if (matches.length > 1) {
    throw new BankStatementParseError(`MT940 statement has multiple ${tags.join('/')} balances`)
  }
  return matches[0]
}

function statementMetadata(records) {
  const reference = firstPhysicalLine(requireRecord(records, '20').value)
  const accountValue = firstPhysicalLine(requireRecord(records, '25').value)
  const statementNumber = firstPhysicalLine(requireRecord(records, '28C').value)
  const opening = parseBalance(requireOptionRecord(records, ['60F', '60M']))
  const closing = parseBalance(requireOptionRecord(records, ['62F', '62M']))

  if (!reference || reference.length > 16) {
    throw new BankStatementParseError('invalid MT940 :20: transaction reference')
  }
  if (!accountValue || accountValue.length > 35) {
    throw new BankStatementParseError('invalid MT940 :25: account identification')
  }
  if (!/^\d{1,5}(?:\/\d{1,5})?$/.test(statementNumber)) {
    throw new BankStatementParseError('invalid MT940 :28C: statement number')
  }

  const accountCurrency = currencyFromAccount(accountValue)
  const currencies = new Set([opening.currency, closing.currency, accountCurrency].filter(Boolean))
  if (currencies.size > 1) {
    throw new BankStatementParseError('MT940 statement contains multiple currencies')
  }

  const accountId = accountCurrency ? accountValue.slice(0, -accountCurrency.length).trim() : accountValue
  const accountIban = normalizeIban(findIban(accountId) ?? accountId)
  return {
    statementRef: reference,
    accountIban,
    currency: opening.currency,
    openingBalance: { date: opening.date, signedAmountCents: opening.signedAmountCents },
  }
}

function parseStatement(records) {
  const metadata = statementMetadata(records)
  const lines = []
  let pending = null
  let entriesClosed = false

  const flush = () => {
    if (!pending) return
    lines.push(pending)
    pending = null
  }

  for (const record of records) {
    switch (record.tag) {
      case '61': {
        if (entriesClosed) {
          throw new BankStatementParseError('MT940 :61: statement line occurs after closing balance')
        }
        flush()
        const [firstLine, ...continuation] = record.value.split(/\r?\n/)
        const match = RE_61.exec(firstLine.trim())
        if (!match) throw new BankStatementParseError(`unparseable :61: line: ${firstLine}`)
        const [, valueDate, entryDate, mark, , amount, , rest] = match
        if (amount.length > 15) {
          throw new BankStatementParseError(`invalid MT940 amount in :61: ${amount}`)
        }

        const separator = rest.indexOf('//')
        const ownerRef = (separator === -1 ? rest : rest.slice(0, separator)).trim()
        const bankRef = separator === -1 ? null : rest.slice(separator + 2).trim()
        if (!ownerRef || ownerRef.length > 16) {
          throw new BankStatementParseError('invalid MT940 :61: account owner reference')
        }
        if (bankRef && bankRef.length > 16) {
          throw new BankStatementParseError('invalid MT940 :61: bank reference')
        }

        const { direction, isReversal } = markToDirection(mark)
        const valueIso = isoDate(valueDate)
        const detail = [ownerRef, ...continuation.map((line) => line.trim())].filter(Boolean).join(' ')
        pending = {
          bookingDate: isoEntryDate(entryDate, valueIso) ?? valueIso,
          valueDate: valueIso,
          amountCents: swiftAmountToCents(amount, '61'),
          direction,
          currency: metadata.currency,
          counterpartyName: null,
          counterpartyIban: null,
          remittance: detail || null,
          bankRef: meaningfulRef(bankRef),
          endToEndId: null,
          isReversal,
        }
        break
      }
      case '86': {
        if (!pending || entriesClosed) break
        const info = parse86(record.value)
        pending.counterpartyName = info.name ?? pending.counterpartyName
        pending.counterpartyIban = normalizeIban(info.iban ?? findIban(record.value))
        if (info.remittance) pending.remittance = info.remittance
        break
      }
      case '62F':
      case '62M':
        flush()
        entriesClosed = true
        break
      default:
        break
    }
  }
  flush()
  return { ...metadata, lines }
}

export function parseMt940(text) {
  const statements = splitStatementRecords(tokenize(text)).map(parseStatement)
  const accounts = [...new Set(statements.map((statement) => statement.accountIban))]
  if (accounts.length > 1) {
    throw new BankStatementParseError('MT940 document contains multiple accounts')
  }
  const currencies = [...new Set(statements.map((statement) => statement.currency))]
  if (currencies.length > 1) {
    throw new BankStatementParseError('MT940 document contains multiple currencies')
  }

  const first = statements[0]
  return {
    format: 'mt940',
    currency: first.currency,
    accountIban: first.accountIban,
    statementRef: first.statementRef,
    openingBalance: first.openingBalance,
    lines: statements.flatMap((statement) => statement.lines),
  }
}
