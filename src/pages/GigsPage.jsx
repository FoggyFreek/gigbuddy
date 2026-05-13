import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import ShareIcon from '@mui/icons-material/Share'
import GigsTable from '../components/GigsTable.jsx'
import GigFormModal from '../components/GigFormModal.jsx'
import SplitView from '../components/SplitView.jsx'
import TourShareDialog from '../components/TourShareDialog.jsx'
import TourExportDialog from '../components/TourExportDialog.jsx'
import { deleteGig, listGigs } from '../api/gigs.js'

export default function GigsPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [gigs, setGigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'create' }
  const [confirmDelete, setConfirmDelete] = useState(null) // null | gig object
  const [statusFilter, setStatusFilter] = useState('all')
  const [tourMenuAnchor, setTourMenuAnchor] = useState(null)
  const [tourIncludeConfirmed, setTourIncludeConfirmed] = useState(true)
  const [tourIncludeAnnounced, setTourIncludeAnnounced] = useState(true)
  const [tourShareOpen, setTourShareOpen] = useState(false)
  const [tourExportOpen, setTourExportOpen] = useState(false)

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

  function handleClose() {
    setModal(null)
    load()
  }

  function handleDelete(gig) {
    setConfirmDelete(gig)
  }

  async function handleConfirmDelete() {
    await deleteGig(confirmDelete.id)
    setConfirmDelete(null)
    load()
  }

  const handleGigUpdate = useCallback((gigId, patch) => {
    setGigs((prev) => prev.map((g) => (g.id === gigId ? { ...g, ...patch } : g)))
  }, [])

  return (
    <SplitView basePath="/gigs" outletContext={{ onGigUpdate: handleGigUpdate }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1.5 }}>
        <Typography variant="h5" fontWeight={600}>
          Gigs
        </Typography>
        <FormControl size="small">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="option">Option</MenuItem>
            <MenuItem value="confirmed">Confirmed</MenuItem>
            <MenuItem value="announced">Announced</MenuItem>
          </Select>
        </FormControl>
        <Box sx={{ flexGrow: 1 }} />
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
            onClick={() => { setTourMenuAnchor(null); setTourExportOpen(true) }}
            dense
          >
            <Button variant="outlined" size="small" fullWidth>
              Export tour dates
            </Button>
          </MenuItem>
        </Menu>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          Add gig
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
          gigs={statusFilter === 'all' ? gigs : gigs.filter((g) => g.status === statusFilter)}
          onRowClick={(gig) => navigate(`/gigs/${gig.id}`)}
          onDelete={handleDelete}
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
        gigs={gigs
          .filter((g) =>
            (tourIncludeConfirmed && g.status === 'confirmed') ||
            (tourIncludeAnnounced && g.status === 'announced'),
          )
          .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))}
      />

      <TourExportDialog
        open={tourExportOpen}
        onClose={() => setTourExportOpen(false)}
        gigs={gigs
          .filter((g) =>
            (tourIncludeConfirmed && g.status === 'confirmed') ||
            (tourIncludeAnnounced && g.status === 'announced'),
          )
          .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))}
      />

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete gig?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmDelete && (
              <>
                Delete &ldquo;
                {confirmDelete.event_description
                  || (confirmDelete.event_date
                    ? new Date(confirmDelete.event_date).toLocaleDateString()
                    : 'this gig')}
                &rdquo;? This cannot be undone.
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </SplitView>
  )
}
