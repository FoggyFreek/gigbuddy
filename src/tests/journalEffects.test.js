import { describe, expect, it } from 'vitest'
import { computeJournalEffects } from '../utils/journalEffects.ts'

const accounts = [
  { id: 1, code: '11000', name: 'Primary Bank Account', type: 'asset', is_active: true },
  { id: 2, code: '15000', name: 'VAT Receivable', type: 'asset', is_active: true },
  { id: 3, code: '24000', name: 'VAT Payable', type: 'liability', is_active: true },
  { id: 4, code: '41000', name: 'Gig fees', type: 'revenue', is_active: true },
  { id: 5, code: '51000', name: 'Merchandise', type: 'cost_of_goods_sold', is_active: true },
  { id: 6, code: '62100', name: 'Instruments & Equipment', type: 'expense', is_active: true },
]

const settings = { input_vat_account_code: '15000', output_vat_account_code: '24000' }

const form = (lines) => ({ entry_date: '2026-06-09', description: '', status: 'draft', lines })

const line = (over = {}) => ({
  _key: 'k', description: '', account_code: '', vat_rate: 0, side: null,
  amount_cents: 0, balancing_account_code: '', position: 0, ...over,
})

describe('computeJournalEffects', () => {
  it('splits a gross debit into net + input VAT debits and the balancing credit', () => {
    const effects = computeJournalEffects(
      [form([line({ account_code: '62100', side: 'debit', amount_cents: 12100, vat_rate: 21, balancing_account_code: '11000' })])],
      accounts, settings,
    )
    expect(effects.debit).toEqual([
      { code: '15000', name: 'VAT Receivable', amountCents: 2100 },
      { code: '62100', name: 'Instruments & Equipment', amountCents: 10000 },
    ])
    expect(effects.credit).toEqual([
      { code: '11000', name: 'Primary Bank Account', amountCents: 12100 },
    ])
    expect(effects.totalDebitCents).toBe(12100)
    expect(effects.totalCreditCents).toBe(12100)
    expect(effects.differenceCents).toBe(0)
  })

  it('splits a gross credit into net + output VAT credits and the balancing debit', () => {
    const effects = computeJournalEffects(
      [form([line({ account_code: '41000', side: 'credit', amount_cents: 12100, vat_rate: 21, balancing_account_code: '11000' })])],
      accounts, settings,
    )
    expect(effects.debit).toEqual([
      { code: '11000', name: 'Primary Bank Account', amountCents: 12100 },
    ])
    expect(effects.credit).toEqual([
      { code: '24000', name: 'VAT Payable', amountCents: 2100 },
      { code: '41000', name: 'Gig fees', amountCents: 10000 },
    ])
    expect(effects.differenceCents).toBe(0)
  })

  it('folds VAT into the line account when no VAT account is configured', () => {
    const effects = computeJournalEffects(
      [form([line({ account_code: '62100', side: 'debit', amount_cents: 12100, vat_rate: 21 })])],
      accounts, null,
    )
    expect(effects.debit).toEqual([
      { code: '62100', name: 'Instruments & Equipment', amountCents: 12100 },
    ])
    expect(effects.credit).toEqual([])
    expect(effects.differenceCents).toBe(12100)
  })

  it('skips lines without an account, side, or positive amount', () => {
    const effects = computeJournalEffects(
      [form([
        line({ side: 'debit', amount_cents: 100 }),
        line({ account_code: '62100', amount_cents: 100 }),
        line({ account_code: '62100', side: 'debit', amount_cents: 0 }),
      ])],
      accounts, settings,
    )
    expect(effects.debit).toEqual([])
    expect(effects.credit).toEqual([])
    expect(effects.totalDebitCents).toBe(0)
    expect(effects.totalCreditCents).toBe(0)
  })

  it('aggregates across forms and drops accounts whose debits and credits cancel', () => {
    const effects = computeJournalEffects(
      [
        form([line({ account_code: '11000', side: 'debit', amount_cents: 5000 })]),
        form([
          line({ account_code: '11000', side: 'credit', amount_cents: 5000 }),
          line({ account_code: '51000', side: 'debit', amount_cents: 3000 }),
        ]),
      ],
      accounts, settings,
    )
    expect(effects.debit).toEqual([
      { code: '51000', name: 'Merchandise', amountCents: 3000 },
    ])
    expect(effects.credit).toEqual([])
    expect(effects.totalDebitCents).toBe(3000)
    expect(effects.totalCreditCents).toBe(0)
    expect(effects.differenceCents).toBe(3000)
  })

  it('falls back to the code as label for an unknown account', () => {
    const effects = computeJournalEffects(
      [form([line({ account_code: '99999', side: 'debit', amount_cents: 700 })])],
      accounts, settings,
    )
    expect(effects.debit).toEqual([
      { code: '99999', name: null, amountCents: 700 },
    ])
  })
})
