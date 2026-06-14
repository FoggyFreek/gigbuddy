import { beforeEach, describe, expect, it } from 'vitest'
import { loadLedgerFilters, saveLedgerFilters } from '../utils/ledgerFilterStorage.ts'

const KEY = 'gigbuddy.ledgerFilters.v1'

beforeEach(() => {
  sessionStorage.clear()
})

describe('ledgerFilterStorage', () => {
  it('returns null when nothing is stored', () => {
    expect(loadLedgerFilters()).toBeNull()
  })

  it('round-trips a saved snapshot', () => {
    const snapshot = {
      searchQuery: 'mi5',
      showVoided: true,
      activeGroups: ['purchases', 'invoices'],
      sortDesc: false,
      page: 2,
      rowsPerPage: 100,
      period: { mode: 'month', year: 2026, month: 2 },
    }
    saveLedgerFilters(snapshot)
    expect(loadLedgerFilters()).toEqual(snapshot)
  })

  it('drops unknown group codes from activeGroups', () => {
    saveLedgerFilters({ activeGroups: ['purchases', 'bogus'] })
    expect(loadLedgerFilters().activeGroups).toEqual(['purchases'])
  })

  it('returns null on malformed JSON', () => {
    sessionStorage.setItem(KEY, '{not json')
    expect(loadLedgerFilters()).toBeNull()
  })
})
