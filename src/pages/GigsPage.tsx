import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import ShareIcon from '@mui/icons-material/Share'
import GigsTable, { type GigsFilterSelection, type GigsTab } from '../components/GigsTable.tsx'
import GigFormModal from '../components/GigFormModal.tsx'
import SplitView from '../components/SplitView.tsx'
import TourShareDialog from '../components/TourShareDialog.tsx'
import TourExportDialog from '../components/TourExportDialog.tsx'
import BannerMosaicDialog from '../components/BannerMosaicDialog.tsx'
import BandsintownImportDialog from '../components/BandsintownImportDialog.tsx'
import BandsintownApiImportDialog from '../components/BandsintownApiImportDialog.tsx'
import { listGigs, listPastGigs, listUpcomingGigs, searchGigs } from '../api/gigs.ts'
import { getProfile } from '../api/profile.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { downloadBandsintownCsv } from '../utils/bandsintownExport.ts'
import { ALL_STATUSES } from '../utils/gigStatus.ts'
import { isPastDate, localDateString } from '../utils/dateFormat.ts'
import type { ListCollectionCursor } from '../types/api.ts'
import type { Gig } from '../types/entities.ts'

// Bounded page size for the Upcoming/Past tabs — matches the server's
// MAX_LIST_LIMIT. Past gigs paginate further via a keyset cursor ("load more").
const TAB_PAGE_SIZE = 100
const SEARCH_MIN_CHARS = 3

export default function GigsPage() {
  const { t } = useTranslation(['gigs', 'common'])
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null

  // Full, unscoped gig list — needed only by Tour Share/Export/Banner Mosaic,
  // which select across every gig regardless of which tab is open. Fetched
  // lazily (requestAllGigs) the first time one of those is opened, not on
  // mount, since most page visits never touch them.
  const [allGigs, setAllGigs] = useState<Gig[]>([])
  const [allGigsRequested, setAllGigsRequested] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<GigsTab>('upcoming')
  // Read by handleDetailLoaded without being a dependency, so that callback
  // stays stable across ordinary tab switches (see outletContext below).
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const [tabGigs, setTabGigs] = useState<Gig[]>([])
  const [tabLoading, setTabLoading] = useState(true)
  const [pastCursor, setPastCursor] = useState<ListCollectionCursor | null>(null)
  const [pastHasMore, setPastHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // On a fresh deep link (/gigs/:id landed on directly, e.g. page refresh or
  // shared URL) the gig's date — and so its tab — isn't known yet. Defer the
  // default 'upcoming' fetch until handleDetailLoaded resolves the real tab,
  // so a past-gig deep link doesn't fire a throwaway upcoming request.
  const deferInitialTabLoadRef = useRef(selectedIdParam != null)
  // Guards against out-of-order responses (fast tab switching, or the
  // deep-link resolution flipping tabs while a request is in flight) — only
  // the most recently issued loadTab() may commit its result.
  const tabRequestIdRef = useRef(0)

  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Gig[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const isSearching = search.trim().length >= SEARCH_MIN_CHARS

  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const [tourMenuAnchor, setTourMenuAnchor] = useState<HTMLElement | null>(null)
  const [importMenuAnchor, setImportMenuAnchor] = useState<HTMLElement | null>(null)
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null)
  const [tourShareOpen, setTourShareOpen] = useState(false)
  const [tourExportOpen, setTourExportOpen] = useState(false)
  const [mosaicOpen, setMosaicOpen] = useState(false)
  const [shareFilterSelection, setShareFilterSelection] = useState<GigsFilterSelection>(() => ({
    selectedStatuses: new Set(ALL_STATUSES),
    selectedTags: new Set(),
  }))
  const [bandsintownArtistName, setBandsintownArtistName] = useState('')
  const [bandsintownImportOpen, setBandsintownImportOpen] = useState(false)
  const [bandsintownApiImportOpen, setBandsintownApiImportOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listGigs()
      setAllGigs(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTab = useCallback(async (tab: GigsTab) => {
    const requestId = ++tabRequestIdRef.current
    try {
      setTabLoading(true)
      const today = localDateString()
      if (tab === 'upcoming') {
        const res = await listUpcomingGigs(TAB_PAGE_SIZE, today)
        if (tabRequestIdRef.current !== requestId) return
        setTabGigs(res.items)
        setPastCursor(null)
        setPastHasMore(false)
      } else {
        const res = await listPastGigs(TAB_PAGE_SIZE, today)
        if (tabRequestIdRef.current !== requestId) return
        setTabGigs(res.items)
        setPastCursor(res.meta.nextCursor)
        setPastHasMore(res.meta.nextCursor !== null)
      }
    } catch (e) {
      if (tabRequestIdRef.current === requestId) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (tabRequestIdRef.current === requestId) setTabLoading(false)
    }
  }, [])

  useEffect(() => {
    if (allGigsRequested) load()
  }, [allGigsRequested, load])
  useEffect(() => {
    if (deferInitialTabLoadRef.current) return
    loadTab(activeTab)
  }, [activeTab, loadTab])

  function requestAllGigs() {
    setAllGigsRequested(true)
  }

  // Resolve which tab a deep-linked gig (/gigs/:id) belongs to from its
  // event_date, so the split view opens on the right tab instead of showing
  // an empty list until the user switches. Fed by the detail pane's own
  // getGig() fetch (via onGigDetailLoaded in the outlet context) rather than
  // a second, redundant fetch of the same gig here.
  const handleDetailLoaded = useCallback((gig: Gig) => {
    const wasDeferred = deferInitialTabLoadRef.current
    deferInitialTabLoadRef.current = false
    const tab: GigsTab = isPastDate(gig.event_date) ? 'past' : 'upcoming'
    if (tab === activeTabRef.current) {
      // Already the default tab (e.g. an upcoming-gig deep link) — setActiveTab
      // wouldn't change state and so wouldn't re-trigger the load effect, so
      // fire the deferred load explicitly.
      if (wasDeferred) loadTab(tab)
    } else {
      setActiveTab(tab)
    }
  }, [loadTab])

  // The deep-linked gig failed to load (deleted, 404, network error) — the
  // tab it belongs to will never be resolved, so fall back to loading the
  // default tab instead of leaving the list stuck deferred forever.
  const handleDetailLoadError = useCallback(() => {
    if (!deferInitialTabLoadRef.current) return
    deferInitialTabLoadRef.current = false
    loadTab(activeTabRef.current)
  }, [loadTab])

  useEffect(() => {
    // `search` only changes after GigsTable's own debounce has settled, so no
    // further debouncing is needed here.
    const q = search.trim()
    if (q.length < SEARCH_MIN_CHARS) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    let cancelled = false
    setSearchLoading(true)
    searchGigs(q)
      .then((rows) => { if (!cancelled) setSearchResults(rows) })
      .catch(() => { if (!cancelled) setSearchResults([]) })
      .finally(() => { if (!cancelled) setSearchLoading(false) })
    return () => { cancelled = true }
  }, [search])

  useEffect(() => {
    getProfile().then((p) => setBandsintownArtistName((p as { bandsintown_artist_name?: string }).bandsintown_artist_name || '')).catch(() => {})
  }, [])

  function refreshAll() {
    if (allGigsRequested) load()
    loadTab(activeTab)
  }

  function handleClose() {
    setModal(null)
    refreshAll()
  }

  async function handleLoadMorePast() {
    if (!pastCursor) return
    try {
      setLoadingMore(true)
      const today = localDateString()
      const res = await listPastGigs(TAB_PAGE_SIZE, today, pastCursor)
      setTabGigs((prev) => [...prev, ...res.items])
      setPastCursor(res.meta.nextCursor)
      setPastHasMore(res.meta.nextCursor !== null)
    } finally {
      setLoadingMore(false)
    }
  }

  const handleGigUpdate = useCallback((gigId: number, patch: Partial<Gig>) => {
    const apply = (list: Gig[]) => list.map((g) => (g.id === gigId ? { ...g, ...patch } : g))
    setAllGigs(apply)
    setTabGigs(apply)
    setSearchResults(apply)
  }, [])

  const handleGigDelete = useCallback((gigId: number) => {
    const apply = (list: Gig[]) => list.filter((g) => g.id !== gigId)
    setAllGigs(apply)
    setTabGigs(apply)
    setSearchResults(apply)
  }, [])

  const filteredForExport = useMemo(() => allGigs
    .filter((gig) => gig.status === 'confirmed' || gig.status === 'announced')
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date))), [allGigs])

  const filteredForCardShare = useMemo(() => allGigs
    .filter((gig) => {
      if (!shareFilterSelection.selectedStatuses.has(gig.status ?? '')) return false
      if (shareFilterSelection.selectedTags.size === 0) return true
      return (gig.tags ?? []).some((tag) => tag.name && shareFilterSelection.selectedTags.has(tag.name))
    })
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date))), [allGigs, shareFilterSelection])

  const displayGigs = isSearching ? searchResults : tabGigs
  const displayLoading = isSearching ? searchLoading : tabLoading

  // Stable reference so unrelated re-renders (typing, tab switches, load
  // more) don't force the open detail pane to re-render — it reads this via
  // useOutletContext(), which re-renders every consumer on identity change.
  const outletContext = useMemo(
    () => ({
      onGigUpdate: handleGigUpdate,
      onGigDelete: handleGigDelete,
      onGigDetailLoaded: handleDetailLoaded,
      onGigDetailLoadError: handleDetailLoadError,
    }),
    [handleGigUpdate, handleGigDelete, handleDetailLoaded, handleDetailLoadError],
  )

  return (
    <SplitView
      basePath="/gigs"
      outletContext={outletContext}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 0.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t($ => $.title)}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {canWritePlanning && (
          <>
            <Tooltip title={t($ => $.toolbar.import)}>
              <IconButton onClick={(e) => setImportMenuAnchor(e.currentTarget)}>
                <FileDownloadOutlinedIcon />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={importMenuAnchor}
              open={!!importMenuAnchor}
              onClose={() => setImportMenuAnchor(null)}
            >
              <MenuItem
                onClick={() => { setImportMenuAnchor(null); setBandsintownApiImportOpen(true) }}
                dense
              >
                <Button variant="outlined" size="small" fullWidth>
                  {t($ => $.toolbar.importFromBandsintownApi)}
                </Button>
              </MenuItem>
              <MenuItem
                onClick={() => { setImportMenuAnchor(null); setBandsintownImportOpen(true) }}
                dense
              >
                <Button variant="outlined" size="small" fullWidth>
                  {t($ => $.toolbar.importFromBandsintown)}
                </Button>
              </MenuItem>
            </Menu>
          </>
        )}
        <Tooltip title={t($ => $.toolbar.export)}>
          <IconButton onClick={(e) => { requestAllGigs(); setExportMenuAnchor(e.currentTarget) }}>
            <FileUploadOutlinedIcon />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={exportMenuAnchor}
          open={!!exportMenuAnchor}
          onClose={() => setExportMenuAnchor(null)}
        >
          <MenuItem
            disabled={loading || filteredForExport.length === 0}
            onClick={() => { setExportMenuAnchor(null); setTourExportOpen(true) }}
            dense
          >
            <Button variant="outlined" size="small" fullWidth disabled={loading || filteredForExport.length === 0}>
              {t($ => $.toolbar.exportTourDates)}
            </Button>
          </MenuItem>
          <MenuItem
            disabled={loading || filteredForExport.length === 0}
            onClick={() => {
              setExportMenuAnchor(null)
              downloadBandsintownCsv(filteredForExport, bandsintownArtistName)
            }}
            dense
          >
            <Button variant="outlined" size="small" fullWidth disabled={loading || filteredForExport.length === 0}>
              {t($ => $.toolbar.exportToBandsintown)}
            </Button>
          </MenuItem>
        </Menu>
        <Tooltip title={t($ => $.toolbar.shareTourDates)}>
          <IconButton onClick={(e) => { requestAllGigs(); setTourMenuAnchor(e.currentTarget) }}>
            <ShareIcon />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={tourMenuAnchor}
          open={!!tourMenuAnchor}
          onClose={() => setTourMenuAnchor(null)}
        >
          <MenuItem
            disabled={loading || filteredForCardShare.length === 0}
            onClick={() => { setTourMenuAnchor(null); setTourShareOpen(true) }}
            dense
          >
            <Button variant="contained" size="small" fullWidth>
              {t($ => $.toolbar.createTourCard)}
            </Button>
          </MenuItem>
          <MenuItem
            disabled={loading || filteredForCardShare.length === 0}
            onClick={() => { setTourMenuAnchor(null); setMosaicOpen(true) }}
            dense
          >
            <Button variant="contained" size="small" fullWidth>
              {t($ => $.toolbar.bannerMosaic)}
            </Button>
          </MenuItem>
        </Menu>
        {canWritePlanning && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setModal({ mode: 'create' })}
          >
            {t($ => $.common.actions.add)}
          </Button>
        )}
      </Box>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      <GigsTable
        gigs={displayGigs}
        loading={displayLoading}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRowClick={(gig) => navigate(`/gigs/${gig.id}`)}
        selectedId={selectedId ?? undefined}
        onFilterSelectionChange={setShareFilterSelection}
        search={search}
        onSearchChange={setSearch}
        isSearching={isSearching}
        hasMore={pastHasMore}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMorePast}
      />

      {modal && (
        <GigFormModal
          mode="create"
          onClose={handleClose}
        />
      )}

      <TourShareDialog
        open={tourShareOpen}
        onClose={() => setTourShareOpen(false)}
        gigs={filteredForCardShare}
      />

      <TourExportDialog
        open={tourExportOpen}
        onClose={() => setTourExportOpen(false)}
        gigs={filteredForExport}
      />

      <BannerMosaicDialog
        open={mosaicOpen}
        onClose={() => setMosaicOpen(false)}
        gigs={filteredForCardShare}
      />

      {bandsintownApiImportOpen && (
        <BandsintownApiImportDialog
          onClose={(didImport) => {
            setBandsintownApiImportOpen(false)
            if (didImport) refreshAll()
          }}
        />
      )}
      {bandsintownImportOpen && (
        <BandsintownImportDialog
          onClose={(didImport) => {
            setBandsintownImportOpen(false)
            if (didImport) refreshAll()
          }}
        />
      )}
    </SplitView>
  )
}
