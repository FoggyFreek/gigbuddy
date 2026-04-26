import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import GigsTable from '../components/GigsTable.jsx'
import GigFormModal from '../components/GigFormModal.jsx'
import { deleteGig, listGigs } from '../api/gigs.js'

export default function GigsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [gigs, setGigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'create' } | { mode: 'edit', gigId: number }
  const [confirmDelete, setConfirmDelete] = useState(null) // null | gig object
  const [statusFilter, setStatusFilter] = useState('all')

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
    if (loading) return
    const id = Number(searchParams.get('open'))
    if (id) setModal({ mode: 'edit', gigId: id })
  }, [loading, searchParams])

  function handleClose() {
    if (searchParams.has('open')) {
      setSearchParams((p) => { p.delete('open'); return p }, { replace: true })
    }
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

  return (
    <>
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
          onRowClick={(gig) => setModal({ mode: 'edit', gigId: gig.id })}
          onDelete={handleDelete}
        />
      )}

      {modal && (
        <GigFormModal
          mode={modal.mode}
          gigId={modal.gigId}
          onClose={handleClose}
        />
      )}

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
    </>
  )
}
