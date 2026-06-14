// Session-scoped persistence for the ledger entries page filters, so drilling
// into an entry detail and coming back (or returning from elsewhere in the same
// tab) restores the previous view. Stored in sessionStorage, so it resets on a
// full reload / new tab.
import { ALL_LEDGER_GROUPS } from './ledgerEntryType.ts'

const STORAGE_KEY = 'gigbuddy.ledgerFilters.v1'

export interface LedgerFilterSnapshot {
  activeGroups?: string[]
  [key: string]: unknown
}

// Reads the saved filter snapshot, or null when nothing is stored / unreadable.
// `activeGroups` is normalized back to a valid array (stale codes dropped).
export function loadLedgerFilters(): LedgerFilterSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LedgerFilterSnapshot
    if (!parsed || typeof parsed !== 'object') return null
    if (Array.isArray(parsed.activeGroups)) {
      parsed.activeGroups = parsed.activeGroups.filter((g) => ALL_LEDGER_GROUPS.includes(g))
    }
    return parsed
  } catch {
    return null
  }
}

// Persists the filter snapshot. Never throws (private mode / quota limits must
// not break the page).
export function saveLedgerFilters(snapshot: LedgerFilterSnapshot): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // ignore — persistence is best-effort
  }
}
