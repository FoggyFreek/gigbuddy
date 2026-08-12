// Session-scoped persistence for the ledger entry-search page filters, so
// navigating away and back (within the same tab) restores the previous view —
// account selection, period, search, sort and pagination. Stored in
// sessionStorage, so it resets on a full reload / new tab. Mirrors
// ledgerFilterStorage.ts for the transactions browser.

const STORAGE_KEY = 'gigbuddy.ledgerEntrySearchFilters.v1'

export interface LedgerEntrySearchFilterSnapshot {
  selectedCodes?: string[]
  [key: string]: unknown
}

// Reads the saved filter snapshot, or null when nothing is stored / unreadable.
export function loadLedgerEntrySearchFilters(): LedgerEntrySearchFilterSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LedgerEntrySearchFilterSnapshot
    if (!parsed || typeof parsed !== 'object') return null
    if (!Array.isArray(parsed.selectedCodes)) parsed.selectedCodes = []
    return parsed
  } catch {
    return null
  }
}

// Persists the filter snapshot. Never throws (private mode / quota limits must
// not break the page).
export function saveLedgerEntrySearchFilters(snapshot: LedgerEntrySearchFilterSnapshot): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // ignore — persistence is best-effort
  }
}
