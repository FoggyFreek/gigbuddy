import { describe, expect, it } from 'vitest'
import {
  buildBankImportRequest,
  createInitialBankImportDecisions,
} from '../components/ledger/useBankStatementImportDialog.ts'

const EMPTY_SUGGESTION = {
  possibleDuplicate: false,
  supplierMatches: [],
  invoiceMatches: [],
  purchaseMatches: [],
  paidPurchaseMatches: [],
  recordedShopifyPayoutMatches: [],
}

function line(id, direction = 'debit', suggestion = EMPTY_SUGGESTION) {
  return {
    id,
    direction,
    status: 'pending',
    counterparty_name: null,
    counterparty_iban: null,
    suggestion,
  }
}

describe('bank statement import dialog logic', () => {
  it('seeds pending lines while guarding payments that were already recorded', () => {
    const paidPurchase = line(1, 'debit', {
      ...EMPTY_SUGGESTION,
      paidPurchaseMatches: [{ id: 41 }],
    })
    const recordedPayout = line(2, 'credit', {
      ...EMPTY_SUGGESTION,
      recordedShopifyPayoutMatches: [{ id: 42 }],
    })
    const alreadyImported = { ...line(3), status: 'imported' }

    expect(createInitialBankImportDecisions(
      [paidPurchase, recordedPayout, alreadyImported],
      null,
      { enabled: false, country: 'nl', paid: 0, received: 0 },
      true,
    )).toEqual({
      1: { kind: 'skip' },
      2: { kind: 'skip' },
    })
  })

  it('builds the commit payload with account fallbacks and supplier details', () => {
    const lines = [line(1), line(2, 'credit'), line(3)]
    const decisions = {
      1: {
        kind: 'journal_paid',
        contraAccountCode: '',
        vatRate: 21,
        taxCategoryCode: 'domestic_standard',
        taxJurisdictionCode: 'nl',
        supplier: { kind: 'create', name: 'String Supply', iban: 'NL00TEST' },
      },
      2: {
        kind: 'journal_received',
        contraAccountCode: '',
        vatRate: 9,
        taxCategoryCode: 'domestic_reduced',
        taxJurisdictionCode: 'nl',
      },
      3: { kind: 'skip' },
    }

    expect(buildBankImportRequest(lines, decisions, {
      defaultExpenseCode: '62100',
      defaultIncomeCode: '41000',
    })).toEqual([
      {
        line_id: 1,
        action: 'journal_paid',
        contra_account_code: '62100',
        vat_rate: 21,
        tax_category_code: 'domestic_standard',
        tax_jurisdiction_code: 'nl',
        create_supplier: { name: 'String Supply', iban: 'NL00TEST' },
      },
      {
        line_id: 2,
        action: 'journal_received',
        contra_account_code: '41000',
        vat_rate: 9,
        tax_category_code: 'domestic_reduced',
        tax_jurisdiction_code: 'nl',
      },
      { line_id: 3, action: 'skip' },
    ])
  })
})
