import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import RehearsalsTable from '../components/RehearsalsTable.jsx'
import RehearsalFormModal from '../components/RehearsalFormModal.jsx'
import { deleteRehearsal, listRehearsals, setVote } from '../api/rehearsals.js'
import { rehearsalShareUrl } from '../utils/shareUtils.js'
import { useAuth } from '../contexts/authContext.js'

export default function RehearsalsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [rehearsals, setRehearsals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'create' }
  const [confirmDelete, setConfirmDelete] = useState(null) // null | rehearsal object

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listRehearsals()
      setRehearsals(data)
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

  function handleDelete(rehearsal) {
    setConfirmDelete(rehearsal)
  }

  async function handleConfirmDelete() {
    await deleteRehearsal(confirmDelete.id)
    setConfirmDelete(null)
    load()
  }

  async function handleVote(rehearsalId, memberId, vote) {
    await setVote(rehearsalId, memberId, vote)
    setRehearsals((prev) =>
      prev.map((r) =>
        r.id !== rehearsalId
          ? r
          : {
              ...r,
              participants: r.participants.map((p) =>
                p.band_member_id === memberId ? { ...p, vote } : p
              ),
            }
      )
    )
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          Rehearsals
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          Propose rehearsal
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
        <RehearsalsTable
          rehearsals={rehearsals}
          bandMemberId={user?.bandMemberId}
          onVote={handleVote}
          onRowClick={(r) => navigate(`/rehearsals/${r.id}`)}
          onDelete={handleDelete}
          onShare={(r) => window.open(rehearsalShareUrl(r), '_blank')}
        />
      )}

      {modal && (
        <RehearsalFormModal
          mode="create"
          onClose={handleClose}
        />
      )}

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete rehearsal?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmDelete && (
              <>
                Delete rehearsal on{' '}
                {confirmDelete.proposed_date
                  ? new Date(confirmDelete.proposed_date).toLocaleDateString()
                  : 'this date'}
                ? This cannot be undone.
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
