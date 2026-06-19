import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Paper from '@mui/material/Paper'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import CloseIcon from '@mui/icons-material/Close'
import HistoryIcon from '@mui/icons-material/History'
import type { SvgIconComponent } from '@mui/icons-material'
import ContactsOutlined from '@mui/icons-material/ContactsOutlined'
import EventOutlined from '@mui/icons-material/EventOutlined'
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined'
import LibraryMusicOutlined from '@mui/icons-material/LibraryMusicOutlined'
import QueueMusicOutlined from '@mui/icons-material/QueueMusicOutlined'
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined'
import ListAltOutlined from '@mui/icons-material/ListAltOutlined'
import { useRecentSearches } from '../../hooks/useRecentSearches.ts'
import { useSearchCategories } from '../../hooks/useSearchCategories.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import { PERMISSIONS } from '../../auth/permissions.ts'
import { searchGigs } from '../../api/gigs.ts'
import { searchContacts } from '../../api/contacts.ts'
import { searchSongs } from '../../api/songs.ts'
import { searchSetlists } from '../../api/setlists.ts'
import { searchInvoices } from '../../api/invoices.ts'
import { searchPurchases } from '../../api/purchases.ts'
import { searchLedgerTransactions } from '../../api/ledger.ts'
import { searchFiles } from '../../api/files.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import type {
  Gig, Contact, Song, Setlist, Invoice, Purchase, LedgerEntryRow, Id,
} from '../../types/entities.ts'

interface SearchCategory {
  key: string
  label: string
  icon: SvgIconComponent
}

interface SearchResultItem {
  id: string
  label: string
  to: string
  sublabel?: string
}

interface CategoryState {
  loading: boolean
  items: SearchResultItem[]
}

interface SearchPanelProps {
  query: string
  tenantId: Id | null
  onNavigate: () => void
}

// All searchable areas. The first three are active by default; the rest are
// added on demand from the "Add new" menu.
const ALL_CATEGORIES: SearchCategory[] = [
  { key: 'contacts', label: 'Contacts', icon: ContactsOutlined },
  { key: 'gigs', label: 'Gigs', icon: EventOutlined },
  { key: 'files', label: 'Files', icon: InsertDriveFileOutlined },
  { key: 'invoices', label: 'Invoices', icon: ReceiptLongOutlined },
  { key: 'purchases', label: 'Purchases', icon: ShoppingCartOutlined },
  { key: 'songs', label: 'Songs', icon: LibraryMusicOutlined },
  { key: 'setlists', label: 'Setlists', icon: QueueMusicOutlined },
  { key: 'suppliers', label: 'Suppliers', icon: StorefrontOutlined },
  { key: 'transaction', label: 'Transaction', icon: ListAltOutlined },
]

const DEFAULT_KEYS = ['contacts', 'gigs', 'files']
// Categories whose endpoints are finance-gated (finance.view). Hidden from the
// chips and the "Add new" menu for members without that permission.
const FINANCE_CATEGORY_KEYS = new Set(['invoices', 'purchases', 'transaction'])
// Each category shows COLLAPSED_COUNT results; "Show all" expands it to
// EXPANDED_COUNT (the backend search caps at 10, so this reveals the rest).
const COLLAPSED_COUNT = 5
const EXPANDED_COUNT = 10
// Results list indents to line up with the category name: icon width + gap.
const RESULT_INDENT = '28px'

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
    sublabel: gigPlace(gig),
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

function CountCircle({ count }: { count: number }) {
  return (
    <Box
      sx={{
        minWidth: 20,
        height: 20,
        px: 0.75,
        borderRadius: '999px',
        bgcolor: 'action.selected',
        color: 'text.secondary',
        fontSize: 11,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {count}
    </Box>
  )
}

function RecentRow({ item, onClick, onRemove }: {
  item: { category: string; label: string }
  onClick: () => void
  onRemove: () => void
}) {
  const Icon = ALL_CATEGORIES.find((c) => c.key === item.category)?.icon ?? ListAltOutlined
  return (
    <ListItem
      disablePadding
      secondaryAction={
        <IconButton
          edge="end"
          size="small"
          aria-label="remove recent search"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      }
    >
      <ListItemButton onClick={onClick} sx={{ borderRadius: 1, py: 0.25 }}>
        <ListItemIcon sx={{ minWidth: 32 }}>
          <Icon fontSize="small" sx={{ color: 'text.secondary' }} />
        </ListItemIcon>
        <ListItemText primary={item.label} slotProps={{ primary: { variant: 'body2', noWrap: true } }} />
      </ListItemButton>
    </ListItem>
  )
}

export default function SearchPanel({ query, tenantId, onNavigate }: SearchPanelProps) {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const canViewFinance = can(PERMISSIONS.FINANCE_VIEW)
  const { recents, addRecent, removeRecent, clearRecents } = useRecentSearches(tenantId)
  const { activeKeys, addCategory: persistCategory, removeCategory } = useSearchCategories(tenantId, DEFAULT_KEYS)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
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

  // Hide finance categories from members without finance.view.
  const visibleCategories = ALL_CATEGORIES.filter(
    (c) => canViewFinance || !FINANCE_CATEGORY_KEYS.has(c.key),
  )
  const active = activeKeys
    .map((key) => visibleCategories.find((c) => c.key === key))
    .filter((c): c is SearchCategory => Boolean(c))
  const available = visibleCategories.filter((c) => !activeKeys.includes(c.key))

  const addCategory = (key: string) => {
    persistCategory(key)
    setMenuAnchor(null)
  }

  // Fire a (stubbed) search when the query or the set of active categories
  // changes. A new query re-searches everything; merely adding a category only
  // searches the new one and leaves already-loaded categories untouched.
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
          setResults((prev) => ({ ...prev, [key]: { loading: false, items } }))
        })
      }
    }
    run()
    return () => { cancelled = true }
  }, [debouncedQuery, activeKeys, canViewFinance])

  const hasQuery = debouncedQuery.trim().length > 0
  // Hide recents the moment the user starts typing (use the immediate query,
  // not the debounced one, so it disappears without the debounce lag).
  const showRecent = query.trim().length === 0 && recents.length > 0

  // Record the destination (not the query) before navigating, then close.
  const handleItemClick = (category: string, item: SearchResultItem) => {
    addRecent({ category, id: item.id, label: item.label, to: item.to })
    onNavigate()
    navigate(item.to)
  }

  const handleRecentClick = (item: { category: string; id: string; label: string; to: string }) => {
    addRecent({ category: item.category, id: item.id, label: item.label, to: item.to })
    onNavigate()
    navigate(item.to)
  }

  return (
    <Paper
      elevation={6}
      sx={{
        mt: 2,
        p: 1.5,
        borderRadius: 1,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 96px)',
      }}
    >
      {showRecent && (
        <Box sx={{ mb: 1.5, maxHeight: 280, overflowY: 'auto' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <HistoryIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            <Typography variant="overline" color="text.secondary">Recent</Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" sx={{ fontSize: 12 }} onClick={clearRecents}>Clear</Button>
          </Box>
          <List dense disablePadding sx={{ mt: 0.5 }}>
            {recents.map((item) => (
              <RecentRow
                key={`${item.category}:${item.id}`}
                item={item}
                onClick={() => handleRecentClick(item)}
                onRemove={() => removeRecent(item.category, item.id)}
              />
            ))}
          </List>
        </Box>
      )}

      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
        Search in
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
        {active.map((cat) => (
          <Chip
            key={cat.key}
            label={cat.label}
            variant="outlined"
            onDelete={() => removeCategory(cat.key)}
            deleteIcon={<CloseIcon />}
            size="small"
            sx={{
              fontSize: 12,
              '& .MuiChip-deleteIcon': { fontSize: 14, backgroundColor: 'transparent' },
            }}
          />
        ))}
        {available.length > 0 && (
          <Chip
            label="+ Add new"
            variant="outlined"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            aria-label="add search category"
            size="small"
            sx={{ fontSize: 12 }}
          />
        )}
      </Box>

      {hasQuery && (
        <Box sx={{ mt: 1.5, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {active.map((cat, idx) => {
            const Icon = cat.icon
            const state = results[cat.key]
            const items = state?.items ?? []
            const loading = state?.loading ?? false
            const limit = expanded[cat.key] ? EXPANDED_COUNT : COLLAPSED_COUNT
            return (
              <Box key={cat.key} sx={{ mt: idx === 0 ? 0 : 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icon fontSize="small" sx={{ color: 'text.secondary' }} />
                  <Typography variant="subtitle2">{cat.label}</Typography>
                  {loading ? (
                    <CircularProgress size={16} thickness={5} sx={{ ml: 0.5 }} />
                  ) : (
                    <CountCircle count={items.length} />
                  )}
                  <Box sx={{ flexGrow: 1 }} />
                  {!loading && items.length > limit && (
                    <Button
                      size="small"
                      sx={{ fontSize: 12 }}
                      onClick={() => setExpanded((prev) => ({ ...prev, [cat.key]: true }))}
                    >
                      Show all
                    </Button>
                  )}
                </Box>
                {!loading && (
                  items.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ ml: RESULT_INDENT, mt: 0.5 }}>
                      No results
                    </Typography>
                  ) : (
                    <List dense disablePadding sx={{ ml: RESULT_INDENT, mt: 0.5 }}>
                      {items.slice(0, limit).map((item) => (
                        <ListItemButton
                          key={item.id}
                          onClick={() => handleItemClick(cat.key, item)}
                          sx={{ borderRadius: 1, py: 0.25 }}
                        >
                          <ListItemText
                            primary={item.label}
                            secondary={item.sublabel}
                            slotProps={{
                              primary: { variant: 'body2', noWrap: true },
                              secondary: { variant: 'caption', noWrap: true },
                            }}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  )
                )}
                {idx < active.length - 1 && <Divider sx={{ mt: 1.5 }} />}
              </Box>
            )
          })}
        </Box>
      )}

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {available.map((cat) => {
          const Icon = cat.icon
          return (
            <MenuItem key={cat.key} onClick={() => addCategory(cat.key)}>
              <ListItemIcon><Icon fontSize="small" /></ListItemIcon>
              <ListItemText>{cat.label}</ListItemText>
            </MenuItem>
          )
        })}
      </Menu>
    </Paper>
  )
}
