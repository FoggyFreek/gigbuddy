import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import ShareIcon from '@mui/icons-material/Share'
import GigsTable, { type GigsFilterSelection } from '../components/GigsTable.tsx'
import GigFormModal from '../components/GigFormModal.tsx'
import SplitView from '../components/SplitView.tsx'
import TourShareDialog from '../components/TourShareDialog.tsx'
import TourExportDialog from '../components/TourExportDialog.tsx'
import BannerMosaicDialog from '../components/BannerMosaicDialog.tsx'
import BandsintownImportDialog from '../components/BandsintownImportDialog.tsx'
import BandsintownApiImportDialog from '../components/BandsintownApiImportDialog.tsx'
import { listGigs } from '../api/gigs.ts'
import { getProfile } from '../api/profile.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { downloadBandsintownCsv } from '../utils/bandsintownExport.ts'
import { ALL_STATUSES } from '../utils/gigStatus.ts'
import type { Gig } from '../types/entities.ts'

export default function GigsPage() {
  const { t } = useTranslation(['gigs', 'common'])
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [gigs, setGigs] = useState<Gig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
      setGigs(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    getProfile().then((p) => setBandsintownArtistName((p as { bandsintown_artist_name?: string }).bandsintown_artist_name || '')).catch(() => {})
  }, [])

  function handleClose() {
    setModal(null)
    load()
  }

  const handleGigUpdate = useCallback((gigId: number, patch: Partial<Gig>) => {
    setGigs((prev) => prev.map((g) => (g.id === gigId ? { ...g, ...patch } : g)))
  }, [])

  const handleGigDelete = useCallback((gigId: number) => {
    setGigs((prev) => prev.filter((g) => g.id !== gigId))
  }, [])

  const filteredForExport = gigs
    .filter((gig) => gig.status === 'confirmed' || gig.status === 'announced')
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))

  const filteredForCardShare = gigs
    .filter((gig) => {
      if (!shareFilterSelection.selectedStatuses.has(gig.status ?? '')) return false
      if (shareFilterSelection.selectedTags.size === 0) return true
      return (gig.tags ?? []).some((tag) => tag.name && shareFilterSelection.selectedTags.has(tag.name))
    })
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))

  return (
    <SplitView
      basePath="/gigs"
      outletContext={{ onGigUpdate: handleGigUpdate, onGigDelete: handleGigDelete }}
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
          <IconButton onClick={(e) => setExportMenuAnchor(e.currentTarget)}>
            <FileUploadOutlinedIcon />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={exportMenuAnchor}
          open={!!exportMenuAnchor}
          onClose={() => setExportMenuAnchor(null)}
        >
          <MenuItem
            disabled={filteredForExport.length === 0}
            onClick={() => { setExportMenuAnchor(null); setTourExportOpen(true) }}
            dense
          >
            <Button variant="outlined" size="small" fullWidth disabled={filteredForExport.length === 0}>
              {t($ => $.toolbar.exportTourDates)}
            </Button>
          </MenuItem>
          <MenuItem
            disabled={filteredForExport.length === 0}
            onClick={() => {
              setExportMenuAnchor(null)
              downloadBandsintownCsv(filteredForExport, bandsintownArtistName)
            }}
            dense
          >
            <Button variant="outlined" size="small" fullWidth disabled={filteredForExport.length === 0}>
              {t($ => $.toolbar.exportToBandsintown)}
            </Button>
          </MenuItem>
        </Menu>
        <Tooltip title={t($ => $.toolbar.shareTourDates)}>
          <IconButton onClick={(e) => setTourMenuAnchor(e.currentTarget)}>
            <ShareIcon />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={tourMenuAnchor}
          open={!!tourMenuAnchor}
          onClose={() => setTourMenuAnchor(null)}
        >
          <MenuItem
            disabled={filteredForCardShare.length === 0}
            onClick={() => { setTourMenuAnchor(null); setTourShareOpen(true) }}
            dense
          >
            <Button variant="contained" size="small" fullWidth>
              {t($ => $.toolbar.createTourCard)}
            </Button>
          </MenuItem>
          <MenuItem
            disabled={filteredForCardShare.length === 0}
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

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {!loading && (
        <GigsTable
          gigs={gigs}
          onRowClick={(gig) => navigate(`/gigs/${gig.id}`)}
          selectedId={selectedId ?? undefined}
          onFilterSelectionChange={setShareFilterSelection}
        />
      )}

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
            if (didImport) load()
          }}
        />
      )}
      {bandsintownImportOpen && (
        <BandsintownImportDialog
          onClose={(didImport) => {
            setBandsintownImportOpen(false)
            if (didImport) load()
          }}
        />
      )}
    </SplitView>
  )
}
