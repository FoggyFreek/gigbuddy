import { useEffect, useRef, useState } from 'react'
import { searchGigs } from '../api/gigs.ts'
import { searchContacts } from '../api/contacts.ts'
import { searchSongs } from '../api/songs.ts'
import { searchSetlists } from '../api/setlists.ts'
import { searchInvoices } from '../api/invoices.ts'
import { searchPurchases } from '../api/purchases.ts'
import { searchLedgerTransactions } from '../api/ledger.ts'
import { searchFiles } from '../api/files.ts'
import { searchVenues } from '../api/venues.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import type {
  Gig, Contact, Song, Setlist, Invoice, Purchase, LedgerEntryRow, Venue,
} from '../types/entities.ts'

export interface SearchResultItem {
  id: string
  label: string
  to: string
  sublabel?: string
  badge?: string
}

export interface CategoryState {
  loading: boolean
  items: SearchResultItem[]
}

// Categories whose endpoints are finance-gated (finance.view). Hidden from the
// chips and the "Add new" menu for members without that permission.
export const FINANCE_CATEGORY_KEYS = new Set(['invoices', 'purchases', 'transaction'])
// Each category shows COLLAPSED_COUNT results; "Show all" expands it to
// EXPANDED_COUNT (the backend search caps at 10, so this reveals the rest).
export const COLLAPSED_COUNT = 5
export const EXPANDED_COUNT = 10

// --- Category searches -----------------------------------------------------
// Each category resolves to its own searcher: a function that hits the resource's
// /search endpoint and maps the rows to a uniform { label, sublabel, to } shape.

function joinDot(...parts: Array<string | null | undefined>): string | undefined {
  return parts.filter(Boolean).join(' · ') || undefined
}

function gigPlace(gig: Gig): string | undefined {
  const place = gig.venue ?? gig.festival
  return joinDot(place?.name, place?.city)
}

async function searchGigsCategory(query: string): Promise<SearchResultItem[]> {
  const gigs = await searchGigs(query)
  return gigs.map((gig) => ({
    id: String(gig.id),
    label: gig.event_description ?? '(untitled gig)',
    sublabel: joinDot(formatShortDate(gig.event_date), gigPlace(gig)),
    to: `/gigs/${gig.id}`,
  }))
}

function contactItem(routeBase: string) {
  return (contact: Contact): SearchResultItem => ({
    id: String(contact.id),
    label: contact.name ?? '(unnamed)',
    sublabel: joinDot(contact.email, contact.phone),
    to: `${routeBase}/${contact.id}`,
  })
}

async function searchContactsCategory(query: string): Promise<SearchResultItem[]> {
  // Suppliers have their own category/page, so exclude them here.
  const contacts = await searchContacts(query, { excludeCategory: 'supplier' })
  return contacts.map(contactItem('/contacts'))
}

async function searchSuppliersCategory(query: string): Promise<SearchResultItem[]> {
  const suppliers = await searchContacts(query, { category: 'supplier' })
  return suppliers.map(contactItem('/suppliers'))
}

// Venues and festivals share one table (distinguished by `category`); the search
// endpoint returns both, and each result carries a 'Venue' / 'Festival' badge.
async function searchVenuesCategory(query: string): Promise<SearchResultItem[]> {
  const venues = await searchVenues(query)
  return venues.map((venue: Venue) => ({
    id: String(venue.id),
    label: venue.name ?? '(unnamed)',
    badge: venue.category === 'festival' ? 'Festival' : 'Venue',
    sublabel: joinDot(venue.city, venue.region),
    to: `/venues/${venue.id}`,
  }))
}

async function searchSongsCategory(query: string): Promise<SearchResultItem[]> {
  const songs = await searchSongs(query)
  return songs.map((song: Song) => ({
    id: String(song.id),
    label: song.title ?? '(untitled)',
    sublabel: song.artist ?? undefined,
    to: `/songs/${song.id}`,
  }))
}

async function searchSetlistsCategory(query: string): Promise<SearchResultItem[]> {
  const setlists = await searchSetlists(query)
  return setlists.map((setlist: Setlist) => ({
    id: String(setlist.id),
    label: setlist.name ?? '(untitled)',
    to: `/setlists/${setlist.id}`,
  }))
}

async function searchInvoicesCategory(query: string): Promise<SearchResultItem[]> {
  const invoices = await searchInvoices(query)
  return invoices.map((invoice: Invoice) => ({
    id: String(invoice.id),
    label: invoice.invoice_number ?? '(draft)',
    sublabel: joinDot(invoice.customer_name, invoice.gig_event_description, formatEur(invoice.total_cents)),
    to: `/invoices/${invoice.id}`,
  }))
}

async function searchPurchasesCategory(query: string): Promise<SearchResultItem[]> {
  const purchases = await searchPurchases(query)
  return purchases.map((purchase: Purchase) => ({
    id: String(purchase.id),
    label: purchase.supplier_name ?? '(no supplier)',
    sublabel: joinDot(
      purchase.receipt_number != null ? `#${purchase.receipt_number}` : null,
      formatEur(purchase.total_cents),
    ),
    to: `/purchases/${purchase.id}`,
  }))
}

async function searchTransactionsCategory(query: string): Promise<SearchResultItem[]> {
  const rows = await searchLedgerTransactions(query)
  return rows.map((row: LedgerEntryRow) => ({
    id: String(row.id),
    label: row.description || row.type || '(transaction)',
    sublabel: joinDot(row.entry_date, row.amount_cents != null ? formatEur(row.amount_cents) : null),
    to: `/ledger/${row.id}`,
  }))
}

async function searchFilesCategory(query: string): Promise<SearchResultItem[]> {
  const files = await searchFiles(query)
  return files.map((file) => ({
    id: file.id,
    label: file.filename,
    sublabel: file.kind,
    to: file.to,
  }))
}

type CategorySearcher = (query: string) => Promise<SearchResultItem[]>
const SEARCHERS: Record<string, CategorySearcher> = {
  contacts: searchContactsCategory,
  gigs: searchGigsCategory,
  files: searchFilesCategory,
  invoices: searchInvoicesCategory,
  purchases: searchPurchasesCategory,
  songs: searchSongsCategory,
  setlists: searchSetlistsCategory,
  suppliers: searchSuppliersCategory,
  venues: searchVenuesCategory,
  transaction: searchTransactionsCategory,
}

// Dispatch to the category's searcher. Never rejects — on failure (e.g. a
// permission 403) the category renders "No results" instead of hanging on its
// spinner.
async function runCategorySearch(key: string, query: string): Promise<SearchResultItem[]> {
  try {
    const searcher = SEARCHERS[key]
    return searcher ? await searcher(query) : []
  } catch {
    return []
  }
}
// --------------------------------------------------------------------------

// Curried so the settled-result merge isn't an extra arrow nested inside the
// effect's `.then` callback (keeps function nesting shallow).
const settleCategory = (key: string, items: SearchResultItem[]) =>
  (prev: Record<string, CategoryState>): Record<string, CategoryState> =>
    ({ ...prev, [key]: { loading: false, items } })

export interface CategorySearch {
  results: Record<string, CategoryState>
  expanded: Record<string, boolean>
  expandCategory: (key: string) => void
  hasQuery: boolean
}

// Owns the imperative side of search: it debounces the typed query, fires a
// searcher per active category, and tracks per-category loading/results plus the
// "Show all" expansion. Keeping this out of the component lets SearchPanel stay a
// declarative renderer of the returned state.
//
// `canViewFinance` gates the finance-only categories: even if a stale
// localStorage value still lists them in `activeKeys`, they are never searched
// for a member without finance.view.
export function useCategorySearch(
  query: string,
  activeKeys: string[],
  canViewFinance: boolean,
): CategorySearch {
  const [results, setResults] = useState<Record<string, CategoryState>>({})
  // Categories the user expanded via "Show all"; reset on a fresh query.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Mirror of `results` so the effect can see which categories already have data
  // without re-running when results change. `searchedQueryRef` is the text the
  // current results belong to, so we can tell a fresh query from a new category.
  const resultsRef = useRef<Record<string, CategoryState>>({})
  const searchedQueryRef = useRef('')
  useEffect(() => { resultsRef.current = results }, [results])

  // Debounce the typed query so we don't fire a search on every keystroke.
  // Category changes act on this settled value, so adding a category still
  // searches immediately (the query isn't changing).
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  // Fire a search when the query or the set of active categories changes. A new
  // query re-searches everything; merely adding a category only searches the new
  // one and leaves already-loaded categories untouched. The work runs in an
  // async closure so the `setResults`/`setExpanded` calls land in a microtask
  // rather than synchronously in the effect body.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const q = debouncedQuery.trim()
      if (!q) {
        setResults({})
        setExpanded({})
        searchedQueryRef.current = ''
        return
      }
      // Never dispatch finance-gated categories for members without finance.view,
      // even if a stale localStorage value still lists them in activeKeys.
      const searchableKeys = activeKeys.filter(
        (key) => canViewFinance || !FINANCE_CATEGORY_KEYS.has(key),
      )
      const queryChanged = q !== searchedQueryRef.current
      searchedQueryRef.current = q
      if (queryChanged) setExpanded({})
      // On a fresh query, search everything. Otherwise search only categories
      // that don't yet have settled results — but a category still stuck in
      // `loading` (e.g. its in-flight search was cancelled by a remount/dep
      // change) must be re-fired, not treated as already loaded, or its spinner
      // hangs forever.
      const keysToSearch = queryChanged
        ? searchableKeys
        : searchableKeys.filter((key) => {
          const existing = resultsRef.current[key]
          return !existing || existing.loading
        })
      if (keysToSearch.length === 0) return
      setResults((prev) => {
        const next = queryChanged ? {} : { ...prev }
        for (const key of keysToSearch) next[key] = { loading: true, items: [] }
        return next
      })
      for (const key of keysToSearch) {
        runCategorySearch(key, q).then((items) => {
          if (cancelled) return
          setResults(settleCategory(key, items))
        })
      }
    }
    run()
    return () => { cancelled = true }
  }, [debouncedQuery, activeKeys, canViewFinance])

  const expandCategory = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: true }))
  }

  return { results, expanded, expandCategory, hasQuery: debouncedQuery.trim().length > 0 }
}
