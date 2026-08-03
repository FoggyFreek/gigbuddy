import { describe, expect, it } from 'vitest'
import {
  buildAdjustmentMappings,
  customCandidateKey,
  payoutIsComplete,
  selectedCustomCandidates,
  totalCandidateNet,
} from '../components/merch/useShopifyPayoutDialog.ts'

const CANDIDATE = {
  order_financial_id: 3,
  order_name: '#1001',
  shopify_order_id: '1001',
  processed_at: '2025-01-24T15:13:05Z',
  source_payout_id: '124345811272',
  currency: 'EUR',
  net_cents: 3530,
  balance_transaction_ids: [17, 18],
}

const PAYOUT = {
  id: 9,
  shopify_payout_id: '9001',
  origin: 'shopify_api',
  issued_at: '2026-06-03T10:00:00Z',
  transaction_type: 'DEPOSIT',
  currency: 'EUR',
  net_cents: 3530,
  external_trace_id: 'TRACE-9001',
  ready: true,
  orders: [],
  adjustments: [
    { id: 21, type: 'fee', source_type: null, transaction_date: '2026-06-03', net_cents: -120 },
  ],
}

describe('Shopify payout dialog logic', () => {
  it('selects candidates by their balance transaction ids and totals their net amount', () => {
    const second = {
      ...CANDIDATE,
      order_financial_id: 4,
      net_cents: 1470,
      balance_transaction_ids: [19],
    }
    const selected = selectedCustomCandidates(
      [CANDIDATE, second],
      new Set([customCandidateKey(second)]),
    )

    expect(selected).toEqual([second])
    expect(totalCandidateNet(selected)).toBe(1470)
  })

  it('builds settlement mappings and requires every adjustment to be categorized', () => {
    const mappings = { '9': { '21': '64100' } }
    const entryDates = { '9': '2026-06-03' }

    expect(buildAdjustmentMappings(PAYOUT, mappings)).toEqual([
      { balance_transaction_id: 21, account_code: '64100' },
    ])
    expect(payoutIsComplete(PAYOUT, entryDates, mappings)).toBe(true)
    expect(payoutIsComplete(PAYOUT, entryDates, {})).toBe(false)
    expect(payoutIsComplete(PAYOUT, {}, mappings)).toBe(false)
    expect(payoutIsComplete({ ...PAYOUT, ready: false }, entryDates, mappings)).toBe(false)
  })
})
