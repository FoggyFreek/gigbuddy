// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseBankStatement,
  amountToCents,
  BankStatementParseError,
} from '../../../server/services/bankStatement/index.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bankStatements')
const load = (name) => readFileSync(join(FIXTURES, name))

describe('amountToCents', () => {
  it('parses dot and comma decimals and thousands separators', () => {
    expect(amountToCents('120.50')).toBe(12050)
    expect(amountToCents('120,50')).toBe(12050)
    expect(amountToCents('1.234,56')).toBe(123456)
    expect(amountToCents('1,234.56')).toBe(123456)
    expect(amountToCents('100')).toBe(10000)
  })
  it('throws on garbage', () => {
    expect(() => amountToCents('abc')).toThrow(BankStatementParseError)
  })
})

describe('CAMT.053 parser', () => {
  const result = parseBankStatement(load('camt053_eur.xml'))

  it('reads statement header (format, currency, account, ref)', () => {
    expect(result.format).toBe('camt053')
    expect(result.currency).toBe('EUR')
    expect(result.accountIban).toBe('NL02RABO0123456789')
    expect(result.statementRef).toBe('STMT-2026-02')
  })

  it('expands TxDtls when their amounts reconcile to the entry amount', () => {
    // 5 lines: 1 debit, 1 credit, 2 from a single split entry, 1 reversal.
    expect(result.lines).toHaveLength(5)
    const split = result.lines.filter((l) => l.bookingDate === '2026-02-05')
    expect(split.map((l) => l.amountCents).sort()).toEqual([3000, 5000])
    expect(split.map((l) => l.counterpartyName).sort()).toEqual(['Drum Heads BV', 'String Supply Co'])
  })

  it('picks direction, counterparty and IBAN from the correct party', () => {
    const debit = result.lines[0]
    expect(debit).toMatchObject({
      direction: 'debit', amountCents: 12050,
      counterpartyName: 'Jansen PA Rental', counterpartyIban: 'NL91ABNA0417164300',
      remittance: 'Invoice 2026-014 PA hire', endToEndId: 'E2E-001', isReversal: false,
    })
    const credit = result.lines[1]
    expect(credit).toMatchObject({
      direction: 'credit', counterpartyName: 'Cafe De Kroon',
      counterpartyIban: 'NL39RABO0300065264',
    })
  })

  it('drops NOTPROVIDED end-to-end ids', () => {
    expect(result.lines[1].endToEndId).toBeNull()
  })

  it('keeps the reversal entry direction reported by CdtDbtInd', () => {
    const reversal = result.lines[4]
    expect(reversal.isReversal).toBe(true)
    expect(reversal.direction).toBe('credit')
  })

  it('carries a non-EUR statement currency through for the importer to skip', () => {
    const usd = parseBankStatement(load('camt053_usd.xml'))
    expect(usd.currency).toBe('USD')
    expect(usd.lines[0].currency).toBe('USD')
  })
})

describe('CAMT.053 parser (batched AmtDtls/TxAmt)', () => {
  const result = parseBankStatement(load('camt053_batched_amtdtls.xml'))

  it('uses each detail\'s TxAmt, not the aggregate entry amount', () => {
    expect(result.lines).toHaveLength(2)
    expect(result.lines.map((l) => l.amountCents).sort((a, b) => a - b)).toEqual([4000, 11000])
    expect(result.lines.map((l) => l.counterpartyName).sort()).toEqual(['Vendor A', 'Vendor B'])
  })
})

describe('CAMT.053 booked amount semantics', () => {
  it('uses Ntry/Amt for a single FX transaction instead of the underlying TxAmt', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
        <BkToCstmrStmt><Stmt>
          <Id>FX</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
          <Ntry><Amt Ccy="EUR">91.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-03-02</Dt></BookgDt>
            <NtryDtls><TxDtls>
              <AmtDtls><TxAmt><Amt Ccy="USD">100.00</Amt></TxAmt></AmtDtls>
              <RltdPties><Cdtr><Pty><Nm>US Vendor</Nm></Pty></Cdtr></RltdPties>
            </TxDtls></NtryDtls>
          </Ntry>
        </Stmt></BkToCstmrStmt>
      </Document>`

    const result = parseBankStatement(Buffer.from(xml))
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({
      amountCents: 9100,
      currency: 'EUR',
      counterpartyName: 'US Vendor',
    })
  })

  it('keeps an amount-less multi-detail batch as one aggregate entry', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document><BkToCstmrStmt><Stmt>
        <Id>BATCH</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
        <Ntry><Amt Ccy="EUR">150.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-03-02</Dt></BookgDt>
          <AcctSvcrRef>BATCH-REF</AcctSvcrRef>
          <NtryDtls>
            <TxDtls><Refs><EndToEndId>A</EndToEndId></Refs></TxDtls>
            <TxDtls><Refs><EndToEndId>B</EndToEndId></Refs></TxDtls>
          </NtryDtls>
        </Ntry>
      </Stmt></BkToCstmrStmt></Document>`

    const result = parseBankStatement(Buffer.from(xml))
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({
      amountCents: 15000,
      currency: 'EUR',
      bankRef: 'BATCH-REF',
      endToEndId: null,
    })
  })

  it('keeps a non-reconciling multi-detail batch as one aggregate entry', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document><BkToCstmrStmt><Stmt>
        <Id>BATCH</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
        <Ntry><Amt Ccy="EUR">151.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-03-02</Dt></BookgDt>
          <NtryDtls>
            <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">40.00</Amt></TxAmt></AmtDtls></TxDtls>
            <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">110.00</Amt></TxAmt></AmtDtls></TxDtls>
          </NtryDtls>
        </Ntry>
      </Stmt></BkToCstmrStmt></Document>`

    const result = parseBankStatement(Buffer.from(xml))
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({ amountCents: 15100, currency: 'EUR' })
  })
})

describe('CAMT.053 modern party, reversal, and remittance shapes', () => {
  it('reads a counterparty name through the V08 Party choice', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
        <BkToCstmrStmt><Stmt>
          <Id>V08</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
          <Ntry><Amt Ccy="EUR">25.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-02</Dt></BookgDt>
            <NtryDtls><TxDtls><RltdPties>
              <Dbtr><Pty><Nm>Modern Customer</Nm></Pty></Dbtr>
              <DbtrAcct><Id><IBAN>NL91ABNA0417164300</IBAN></Id></DbtrAcct>
            </RltdPties></TxDtls></NtryDtls>
          </Ntry>
        </Stmt></BkToCstmrStmt>
      </Document>`

    const result = parseBankStatement(Buffer.from(xml))
    expect(result.lines[0]).toMatchObject({
      counterpartyName: 'Modern Customer',
      counterpartyIban: 'NL91ABNA0417164300',
    })
  })

  it('uses the original creditor as counterparty for a reversed debit', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document><BkToCstmrStmt><Stmt>
        <Id>REV</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
        <Ntry><Amt Ccy="EUR">25.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><RvslInd>true</RvslInd><BookgDt><Dt>2026-03-02</Dt></BookgDt>
          <NtryDtls><TxDtls><RltdPties>
            <Dbtr><Nm>Account Owner</Nm></Dbtr>
            <Cdtr><Nm>Original Vendor</Nm></Cdtr>
          </RltdPties></TxDtls></NtryDtls>
        </Ntry>
      </Stmt></BkToCstmrStmt></Document>`

    const result = parseBankStatement(Buffer.from(xml))
    expect(result.lines[0]).toMatchObject({
      direction: 'credit',
      isReversal: true,
      counterpartyName: 'Original Vendor',
    })
  })

  it('preserves repeated structured references alongside unstructured text', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document><BkToCstmrStmt><Stmt>
        <Id>RMT</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
        <Ntry><Amt Ccy="EUR">25.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-02</Dt></BookgDt>
          <NtryDtls><TxDtls><RmtInf>
            <Ustrd>Thanks for the shows</Ustrd>
            <Strd><CdtrRefInf><Ref>RF18539007547034</Ref></CdtrRefInf></Strd>
            <Strd><CdtrRefInf><Ref>INV-2026-017</Ref></CdtrRefInf></Strd>
          </RmtInf></TxDtls></NtryDtls>
        </Ntry>
      </Stmt></BkToCstmrStmt></Document>`

    const result = parseBankStatement(Buffer.from(xml))
    expect(result.lines[0].remittance).toBe('RF18539007547034 INV-2026-017 Thanks for the shows')
  })
})

describe('CAMT.053 parser (multiple statements)', () => {
  it('rejects a document that mixes different statement accounts', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document><BkToCstmrStmt>
        <Stmt><Id>A</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct></Stmt>
        <Stmt><Id>B</Id><Acct><Id><IBAN>NL91ABNA0417164300</IBAN></Id><Ccy>EUR</Ccy></Acct></Stmt>
      </BkToCstmrStmt></Document>`
    expect(() => parseBankStatement(Buffer.from(xml))).toThrow(/multiple accounts/i)
  })

  it('rejects a document that mixes statement currencies', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document><BkToCstmrStmt>
        <Stmt><Id>A</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct></Stmt>
        <Stmt><Id>B</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>USD</Ccy></Acct></Stmt>
      </BkToCstmrStmt></Document>`
    expect(() => parseBankStatement(Buffer.from(xml))).toThrow(/multiple currencies/i)
  })
})

describe('opening balance extraction', () => {
  it('reads the CAMT OPBD balance (positive, CRDT)', () => {
    const result = parseBankStatement(load('camt053_eur.xml'))
    expect(result.openingBalance).toEqual({ date: '2026-01-31', signedAmountCents: 100000 })
  })

  it('reads the MT940 :60F: opening balance (positive, C mark)', () => {
    const result = parseBankStatement(load('mt940_sepa_eur.sta'))
    expect(result.openingBalance).toEqual({ date: '2026-01-31', signedAmountCents: 100000 })
  })

  it('signs an overdrawn (DBIT) CAMT opening balance negative', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document><BkToCstmrStmt><Stmt>
        <Id>A</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
        <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">250.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Dt><Dt>2026-03-01</Dt></Dt></Bal>
        <Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-02</Dt></BookgDt></Ntry>
      </Stmt></BkToCstmrStmt></Document>`
    const result = parseBankStatement(Buffer.from(xml))
    expect(result.openingBalance).toEqual({ date: '2026-03-01', signedAmountCents: -25000 })
  })

  it('returns null opening balance when the statement carries none', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document><BkToCstmrStmt><Stmt>
        <Id>A</Id><Acct><Id><IBAN>NL02RABO0123456789</IBAN></Id><Ccy>EUR</Ccy></Acct>
        <Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-02</Dt></BookgDt></Ntry>
      </Stmt></BkToCstmrStmt></Document>`
    const result = parseBankStatement(Buffer.from(xml))
    expect(result.openingBalance).toBeNull()
  })
})

describe('CAMT.053 parser (real ING InsideBusiness sample)', () => {
  // A real ING export: multiple <Bal> blocks, a <TxsSummry>, per-entry <Chrgs>,
  // a non-IBAN Othr/Id counterparty, and even stray PDF-export text pasted into
  // the XML. Only the single real transaction should surface.
  const result = parseBankStatement(load('camt053_eur_ing.xml'))

  it('extracts the one entry, ignoring balances/summary/PDF artifacts', () => {
    expect(result.lines).toHaveLength(1)
    expect(result.currency).toBe('USD')
    expect(result.accountIban).toBe('HU981370000100000100000000')
    expect(result.statementRef).toBe('202502050000002')
  })

  it('reads the entry amount (incl. charges), counterparty and Othr/Id account', () => {
    expect(result.lines[0]).toMatchObject({
      direction: 'debit', amountCents: 7873038,
      counterpartyName: 'Demo counterparty name',
      counterpartyIban: '33710201000000000019882',
      remittance: 'Thank you very much for your service',
    })
  })
})

describe('CAMT.053 parser (Westpac-style, non-IBAN)', () => {
  const result = parseBankStatement(load('camt053_westpac_aud.xml'))

  it('reads a proprietary (Othr/Id) statement and counterparty account', () => {
    expect(result.currency).toBe('AUD')
    expect(result.accountIban).toBe('032000000007')
    expect(result.lines[0]).toMatchObject({
      direction: 'debit', amountCents: 66735,
      counterpartyName: 'Sydney Sound Hire', counterpartyIban: '062000123456',
    })
  })

  it('concatenates the two Ustrd remittance lines', () => {
    expect(result.lines[0].remittance).toBe('Invoice 8891 PA and lighting')
  })

  it('flags a RtrInf return as a reversal without flipping its direction', () => {
    const ret = result.lines[1]
    expect(ret.isReversal).toBe(true)
    expect(ret.direction).toBe('credit') // CdtDbtInd already shows the return
  })
})

describe('MT940 parser (SEPA structured)', () => {
  const result = parseBankStatement(load('mt940_sepa_eur.sta'))

  it('reads header and account (currency split from IBAN)', () => {
    expect(result.format).toBe('mt940')
    expect(result.currency).toBe('EUR')
    expect(result.accountIban).toBe('NL02RABO0123456789')
    expect(result.statementRef).toBe('STMT-REF-940')
  })

  it('parses :61:/:86: lines with SEPA structured counterparty', () => {
    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toMatchObject({
      direction: 'debit', amountCents: 12050,
      counterpartyName: 'Jansen PA Rental', counterpartyIban: 'NL91ABNA0417164300',
      remittance: 'Invoice 2026-014 PA hire', bankRef: 'ACCTREF-940-1',
    })
    expect(result.lines[1]).toMatchObject({ direction: 'credit', amountCents: 60000 })
  })

  it('treats an RC mark as a reversal and flips direction', () => {
    const reversal = result.lines[2]
    expect(reversal.isReversal).toBe(true)
    expect(reversal.direction).toBe('debit') // RC = reversed credit
  })
})

describe('MT940 parser (real Goldman Sachs sample)', () => {
  // The GS sample carries SWIFT block wrappers ({1:}{2:}{4:...-}), F-prefixed
  // transaction types, wrapped :61: supplementary detail, and a non-EUR currency.
  const result = parseBankStatement(load('statement.mt940.sta'))

  it('parses through block wrappers and wrapped lines', () => {
    expect(result.format).toBe('mt940')
    expect(result.currency).toBe('AUD')
    expect(result.accountIban).toBe('032000000007')
    expect(result.statementRef).toBe('CSCT032000000007')
    expect(result.lines).toHaveLength(10)
  })

  it('reads directions and amounts across the statement', () => {
    expect(result.lines.filter((l) => l.direction === 'debit')).toHaveLength(4)
    expect(result.lines.filter((l) => l.direction === 'credit')).toHaveLength(6)
    expect(result.lines[0]).toMatchObject({ direction: 'debit', amountCents: 500000 })
  })
})

describe('MT940 parser validation and statement boundaries', () => {
  const complete = `:20:STATEMENT-A
:25:NL02RABO0123456789 EUR
:28C:1/1
:60F:C260101EUR0,00
:61:2601010101C10,00NTRFOWNERREF//BANKREF
:86:Transaction remittance
:62F:C260101EUR10,00`

  it.each(['20', '25', '28C', '60F', '62F'])(
    'rejects a statement missing mandatory tag :%s:',
    (tag) => {
      const withoutTag = complete.replace(new RegExp(`^:${tag}:.*(?:\\r?\\n|$)`, 'm'), '')
      expect(() => parseBankStatement(Buffer.from(withoutTag))).toThrow(new RegExp(`missing :${tag}:`, 'i'))
    },
  )

  it('allows a structurally complete statement with no transaction lines', () => {
    const empty = complete
      .replace(/^:61:.*\n/m, '')
      .replace(/^:86:.*\n?/m, '')
    expect(parseBankStatement(Buffer.from(empty)).lines).toEqual([])
  })

  it('rejects invalid SWIFT dates and amount syntax', () => {
    const invalidDate = complete.replace('2601010101C10,00', '2613320101C10,00')
    const invalidAmount = complete.replace('C10,00NTRF', 'C10.00NTRF')
    expect(() => parseBankStatement(Buffer.from(invalidDate))).toThrow(/valid date/i)
    expect(() => parseBankStatement(Buffer.from(invalidAmount))).toThrow(/unparseable :61:/i)
  })

  it('rejects concatenated statements for different accounts', () => {
    const second = complete
      .replaceAll('STATEMENT-A', 'STATEMENT-B')
      .replaceAll('NL02RABO0123456789', 'NL91ABNA0417164300')
      .replaceAll('1/1', '2/1')
    expect(() => parseBankStatement(Buffer.from(`${complete}\n${second}`))).toThrow(/multiple accounts/i)
  })

  it('rejects concatenated statements with different currencies', () => {
    const second = complete
      .replaceAll('STATEMENT-A', 'STATEMENT-B')
      .replaceAll('EUR', 'USD')
      .replaceAll('1/1', '2/1')
    expect(() => parseBankStatement(Buffer.from(`${complete}\n${second}`))).toThrow(/multiple currencies/i)
  })

  it('parses ING codewords with multiple and empty subfields', () => {
    const ing = complete.replace(
      ':86:Transaction remittance',
      ':86:/CNTP/NL91ABNA0417164300/ABNANL2A/Jane Doe/Amsterdam//REMI/USTD//Invoice/2026/014/',
    )
    expect(parseBankStatement(Buffer.from(ing)).lines[0]).toMatchObject({
      counterpartyName: 'Jane Doe',
      counterpartyIban: 'NL91ABNA0417164300',
      remittance: 'Invoice/2026/014',
    })
  })

  it('does not attach a statement-level :86: to the final transaction', () => {
    const withStatementInfo = `${complete}\n:64:C260101EUR10,00\n:86:Statement-level information`
    expect(parseBankStatement(Buffer.from(withStatementInfo)).lines[0].remittance)
      .toBe('Transaction remittance')
  })
})

describe('format sniffing', () => {
  it('rejects unrecognized content', () => {
    expect(() => parseBankStatement(Buffer.from('just some text'))).toThrow(BankStatementParseError)
  })
})
