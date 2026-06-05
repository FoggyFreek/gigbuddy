import { useCallback, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import QueueMusicIcon from '@mui/icons-material/QueueMusic'
import { createSetlist, listSetlists } from '../api/setlists.js'
import { formatDuration } from '../utils/formatDuration.js'
import { setlistShape } from '../propTypes/shared.js'

function SetlistCard({ setlist, onClick }) {
  const parts = [
    `${setlist.set_count} set${setlist.set_count === 1 ? '' : 's'}`,
    `${setlist.song_count} song${setlist.song_count === 1 ? '' : 's'}`,
    formatDuration(setlist.total_seconds) || '0:00',
  ]
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <QueueMusicIcon color="primary" />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={600} noWrap>
          {setlist.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {parts.join(' · ')}
        </Typography>
      </Box>
    </Paper>
  )
}

SetlistCard.propTypes = {
  setlist: setlistShape.isRequired,
  onClick: PropTypes.func.isRequired,
}

export default function SetlistsPage() {
  const navigate = useNavigate()
  const [setlists, setSetlists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setSetlists(await listSetlists())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    const setlist = await createSetlist({ name })
    setCreating(false)
    setNewName('')
    navigate(`/setlists/${setlist.id}`)
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          Setlists
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          Add
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {!loading && setlists.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          No setlists yet — create one to start building.
        </Typography>
      )}

      {!loading && setlists.length > 0 && (
        <Grid container spacing={2}>
          {setlists.map((s) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={s.id}>
              <SetlistCard setlist={s} onClick={() => navigate(`/setlists/${s.id}`)} />
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="sm">
        <DialogTitle>New setlist</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            fullWidth
            autoFocus
            sx={{ mt: 1 }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreating(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
