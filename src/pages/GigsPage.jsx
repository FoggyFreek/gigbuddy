import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import ShareIcon from '@mui/icons-material/Share'
import GigsTable from '../components/GigsTable.jsx'
import GigFormModal from '../components/GigFormModal.jsx'
import SplitView from '../components/SplitView.jsx'
import TourShareDialog from '../components/TourShareDialog.jsx'
import TourExportDialog from '../components/TourExportDialog.jsx'
import BannerMosaicDialog from '../components/BannerMosaicDialog.jsx'
import BandsintownImportDialog from '../components/BandsintownImportDialog.jsx'
import { listGigs } from '../api/gigs.js'
import { getProfile } from '../api/profile.js'
import { downloadBandsintownCsv } from '../utils/bandsintownExport.js'

export default function GigsPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [gigs, setGigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'create' }
  const [tourMenuAnchor, setTourMenuAnchor] = useState(null)
  const [importMenuAnchor, setImportMenuAnchor] = useState(null)
  const [exportMenuAnchor, setExportMenuAnchor] = useState(null)
  const [tourIncludeConfirmed, setTourIncludeConfirmed] = useState(true)
  const [tourIncludeAnnounced, setTourIncludeAnnounced] = useState(true)
  const [tourShareOpen, setTourShareOpen] = useState(false)
  const [tourExportOpen, setTourExportOpen] = useState(false)
  const [mosaicOpen, setMosaicOpen] = useState(false)
  const [bandsintownArtistName, setBandsintownArtistName] = useState('')
  const [bandsintownImportOpen, setBandsintownImportOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listGigs()
      setGigs(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    getProfile().then((p) => setBandsintownArtistName(p.bandsintown_artist_name || '')).catch(() => {})
  }, [])

  function handleClose() {
    setModal(null)
    load()
  }

  const handleGigUpdate = useCallback((gigId, patch) => {
    setGigs((prev) => prev.map((g) => (g.id === gigId ? { ...g, ...patch } : g)))
  }, [])

  const handleGigDelete = useCallback((gigId) => {
    setGigs((prev) => prev.filter((g) => g.id !== gigId))
  }, [])

  const filteredForShare = gigs
    .filter((g) =>
      (tourIncludeConfirmed && g.status === 'confirmed') ||
      (tourIncludeAnnounced && g.status === 'announced'),
    )
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))

  return (
    <SplitView
      basePath="/gigs"
      outletContext={{ onGigUpdate: handleGigUpdate, onGigDelete: handleGigDelete }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1.5 }}>
        <Typography variant="h5" fontWeight={600}>
          Gigs
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Import">
          <IconButton onClick={(e) => setImportMenuAnchor(e.currentTarget)}>
            <FileUploadOutlinedIcon />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={importMenuAnchor}
          open={!!importMenuAnchor}
          onClose={() => setImportMenuAnchor(null)}
        >
          <MenuItem
            onClick={() => { setImportMenuAnchor(null); setBandsintownImportOpen(true) }}
            dense
          >
            <Button variant="outlined" size="small" fullWidth>
              Import from Bandsintown
            </Button>
          </MenuItem>
        </Menu>
        <Tooltip title="Export">
          <IconButton onClick={(e) => setExportMenuAnchor(e.currentTarget)}>
            <FileDownloadOutlinedIcon />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={exportMenuAnchor}
          open={!!exportMenuAnchor}
          onClose={() => setExportMenuAnchor(null)}
        >
          <MenuItem
            disabled={filteredForShare.length === 0}
            onClick={() => { setExportMenuAnchor(null); setTourExportOpen(true) }}
            dense
          >
            <Button variant="outlined" size="small" fullWidth disabled={filteredForShare.length === 0}>
              Export tour dates
            </Button>
          </MenuItem>
          <MenuItem
            disabled={filteredForShare.length === 0}
            onClick={() => {
              setExportMenuAnchor(null)
              downloadBandsintownCsv(filteredForShare, bandsintownArtistName)
            }}
            dense
          >
            <Button variant="outlined" size="small" fullWidth disabled={filteredForShare.length === 0}>
              Export to Bandsintown
            </Button>
          </MenuItem>
        </Menu>
        <Tooltip title="Share tour dates">
          <IconButton onClick={(e) => setTourMenuAnchor(e.currentTarget)}>
            <ShareIcon />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={tourMenuAnchor}
          open={!!tourMenuAnchor}
          onClose={() => setTourMenuAnchor(null)}
        >
          <MenuItem onClick={() => setTourIncludeConfirmed((v) => !v)} dense>
            <Checkbox checked={tourIncludeConfirmed} size="small" sx={{ p: 0.5 }} />
            <ListItemText primary="Confirmed" />
          </MenuItem>
          <MenuItem onClick={() => setTourIncludeAnnounced((v) => !v)} dense>
            <Checkbox checked={tourIncludeAnnounced} size="small" sx={{ p: 0.5 }} />
            <ListItemText primary="Announced" />
          </MenuItem>
          <Divider />
          <MenuItem
            disabled={!tourIncludeConfirmed && !tourIncludeAnnounced}
            onClick={() => { setTourMenuAnchor(null); setTourShareOpen(true) }}
            dense
          >
            <Button variant="contained" size="small" fullWidth>
              Create Tour Card
            </Button>
          </MenuItem>
           <MenuItem
            disabled={!tourIncludeConfirmed && !tourIncludeAnnounced}
            onClick={() => { setTourMenuAnchor(null); setMosaicOpen(true) }}
            dense
          >
            <Button variant="contained" size="small" fullWidth>
              Banner Mosaic
            </Button>
          </MenuItem>
        </Menu>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          Add
        </Button>
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
          selectedId={selectedId}
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
        gigs={filteredForShare}
      />

      <TourExportDialog
        open={tourExportOpen}
        onClose={() => setTourExportOpen(false)}
        gigs={filteredForShare}
      />

      <BannerMosaicDialog
        open={mosaicOpen}
        onClose={() => setMosaicOpen(false)}
        gigs={filteredForShare}
      />

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
