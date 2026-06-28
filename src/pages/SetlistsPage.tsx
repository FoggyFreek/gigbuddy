import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { createSetlist, listSetlists } from '../api/setlists.ts'
import { formatDuration } from '../utils/formatDuration.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Setlist } from '../types/entities.ts'

interface SetlistCardProps {
  setlist: Setlist
  onClick: () => void
}

function SetlistCard({ setlist, onClick }: SetlistCardProps) {
  const { t } = useTranslation('setlists')
  const parts = [
    t($ => $.list.setCount, { count: setlist.set_count ?? 0 }),
    t($ => $.list.songCount, { count: setlist.song_count ?? 0 }),
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
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
          {setlist.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {parts.join(' · ')}
        </Typography>
      </Box>
    </Paper>
  )
}

export default function SetlistsPage() {
  const { t } = useTranslation(['setlists', 'common'])
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const [setlists, setSetlists] = useState<Setlist[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setSetlists(await listSetlists() as Setlist[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    const setlist = await createSetlist({ name }) as Setlist
    setCreating(false)
    setNewName('')
    navigate(`/setlists/${setlist.id}`)
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 600,  flexGrow: 1  }}>
          {t($ => $.title)}
        </Typography>
        {canWritePlanning && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
            {t($ => $.common.actions.add)}
          </Button>
        )}
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {!loading && setlists.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {t($ => $.list.empty)}
        </Typography>
      )}

      {!loading && setlists.length > 0 && (
        <Grid container spacing={2}>
          {setlists.map((s) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={String(s.id)}>
              <SetlistCard setlist={s} onClick={() => navigate(`/setlists/${s.id}`)} />
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t($ => $.create.title)}</DialogTitle>
        <DialogContent>
          <TextField
            label={t($ => $.create.nameLabel)}
            fullWidth
            autoFocus
            sx={{ mt: 1 }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreating(false)}>{t($ => $.common.actions.cancel)}</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newName.trim()}>
            {t($ => $.create.submit)}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
