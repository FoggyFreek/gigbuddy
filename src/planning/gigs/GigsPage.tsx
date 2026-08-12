import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
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
import GigsTable, { type GigsFilterSelection } from './components/GigsTable.tsx'
import GigFormModal from './components/GigFormModal.tsx'
import SplitView from '../../components/SplitView.tsx'
import TourShareDialog from './components/TourShareDialog.tsx'
import TourExportDialog from './components/TourExportDialog.tsx'
import BannerMosaicDialog from './components/BannerMosaicDialog.tsx'
import BandsintownImportDialog from '../../promotion/bandsintown/components/BandsintownImportDialog.tsx'
import BandsintownApiImportDialog from '../../promotion/bandsintown/components/BandsintownApiImportDialog.tsx'
import { listGigs } from './gigs.ts'
import { getProfile } from '../../people/profiles/profile.ts'
import { usePagedEventTabs } from '../shared/usePagedEventTabs.ts'
import { usePlanningSource } from '../shared/usePlanningSource.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import { downloadBandsintownCsv } from '../../promotion/bandsintown/bandsintownExport.ts'
import { ALL_STATUSES } from './gigStatus.ts'
import type { Gig } from '../../types/entities.ts'
import type { MaybeCrossTenant } from '../../types/api.ts'
import { useProfile } from '../../contexts/profileContext.ts'
import { useTenantKind } from '../../hooks/useTenantKind.ts'
import { TENANT_CAPABILITIES } from '../../auth/tenantCapabilities.ts'

const SEARCH_MIN_CHARS = 3

export default function GigsPage() {
  const { t } = useTranslation(['gigs', 'common'])
  const { canWritePlanning } = usePermissions()
  const { isIntegrationConfigured } = useProfile()
  const { supports } = useTenantKind()
  const gigSource = usePlanningSource('gigs')
  const hasBandShare = supports(TENANT_CAPABILITIES.BAND_SHARE)
  const bandsintownConfigured = isIntegrationConfigured('bandsintown')
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

  const {
    activeTab, setActiveTab,
    items: tabGigs, setItems: setTabGigs,
    loading: tabLoading, loadingMore, hasMore: pastHasMore,
    error, setError,
    reload: reloadTab, loadMore: handleLoadMorePast,
    onDetailLoaded, onDetailLoadError,
  } = usePagedEventTabs({
    aggregate: 'gigs',
    dateOf: (gig) => gig.event_date,
    // A gig deep-linked at /gigs/:id has an unknown date, so its tab is resolved
    // from the detail pane's own fetch rather than guessed as 'upcoming'.
    deferInitialLoad: selectedIdParam != null,
  })

  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<MaybeCrossTenant<Gig>[]>([])
  const isSearching = search.trim().length >= SEARCH_MIN_CHARS
  const searchKey = isSearching ? `${gigSource.kind}|${search.trim()}` : null
  const [loadedSearchKey, setLoadedSearchKey] = useState<string | null>(null)
  const searchLoading = searchKey !== null && loadedSearchKey !== searchKey

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
  }, [setError])

  function requestAllGigs() {
    if (allGigsRequested) return
    setAllGigsRequested(true)
    void load()
  }

  useEffect(() => {
    // `search` only changes after GigsTable's own debounce has settled, so no
    // further debouncing is needed here.
    if (searchKey === null) return
    let cancelled = false
    gigSource.api.search(search.trim())
      .then((rows) => { if (!cancelled) setSearchResults(rows) })
      .catch(() => { if (!cancelled) setSearchResults([]) })
      .finally(() => { if (!cancelled) setLoadedSearchKey(searchKey) })
    return () => { cancelled = true }
  }, [search, searchKey, gigSource])

  useEffect(() => {
    if (!bandsintownConfigured) return
    getProfile().then((p) => setBandsintownArtistName((p as { bandsintown_artist_name?: string }).bandsintown_artist_name || '')).catch(() => {})
  }, [bandsintownConfigured])

  function refreshAll() {
    if (allGigsRequested) load()
    reloadTab()
  }

  function handleClose() {
    setModal(null)
    refreshAll()
  }

  const handleGigUpdate = useCallback((gigId: number, patch: Partial<Gig>) => {
    const apply = (list: MaybeCrossTenant<Gig>[]) => list.map((g) => (g.id === gigId ? { ...g, ...patch } : g))
    setAllGigs(apply)
    setTabGigs(apply)
    setSearchResults(apply)
  }, [setTabGigs])

  const handleGigDelete = useCallback((gigId: number) => {
    const apply = (list: MaybeCrossTenant<Gig>[]) => list.filter((g) => g.id !== gigId)
    setAllGigs(apply)
    setTabGigs(apply)
    setSearchResults(apply)
  }, [setTabGigs])

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
      onGigDetailLoaded: onDetailLoaded,
      onGigDetailLoadError: onDetailLoadError,
    }),
    [handleGigUpdate, handleGigDelete, onDetailLoaded, onDetailLoadError],
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
        {canWritePlanning && bandsintownConfigured && (
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
          {bandsintownConfigured && (
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
          )}
        </Menu>
        {hasBandShare && (
          <>
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
          </>
        )}
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
        showBand={gigSource.labelsTenant}
      />

      {modal && (
        <GigFormModal
          mode="create"
          onClose={handleClose}
        />
      )}

      {hasBandShare && (
        <TourShareDialog
          open={tourShareOpen}
          onClose={() => setTourShareOpen(false)}
          gigs={filteredForCardShare}
        />
      )}

      <TourExportDialog
        open={tourExportOpen}
        onClose={() => setTourExportOpen(false)}
        gigs={filteredForExport}
      />

      {hasBandShare && (
        <BannerMosaicDialog
          open={mosaicOpen}
          onClose={() => setMosaicOpen(false)}
          gigs={filteredForCardShare}
        />
      )}

      {bandsintownConfigured && bandsintownApiImportOpen && (
        <BandsintownApiImportDialog
          onClose={(didImport) => {
            setBandsintownApiImportOpen(false)
            if (didImport) refreshAll()
          }}
        />
      )}
      {bandsintownConfigured && bandsintownImportOpen && (
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
