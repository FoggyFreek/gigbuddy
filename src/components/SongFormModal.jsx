import { useState } from 'react'
import PropTypes from 'prop-types'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import { createSong } from '../api/songs.js'
import { parseDuration } from '../utils/formatDuration.js'

const EMPTY_FORM = { title: '', artist: '', song_key: '', tempo: '', duration: '' }

export default function SongFormModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleCreate() {
    if (!form.title.trim()) {
      setErrors({ title: 'Required' })
      return
    }
    const song = await createSong({
      title: form.title.trim(),
      artist: form.artist.trim() || null,
      song_key: form.song_key.trim() || null,
      tempo: form.tempo ? Number(form.tempo) : null,
      duration_seconds: parseDuration(form.duration),
    })
    onCreated?.(song)
    onClose()
  }

  return (
    <Dialog open fullWidth maxWidth="sm">
      <DialogTitle>Add song</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid size={12}>
            <TextField
              label="Title"
              fullWidth
              required
              autoFocus
              value={form.title}
              onChange={(e) => handleChange('title', e.target.value)}
              error={!!errors.title}
              helperText={errors.title}
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Artist"
              fullWidth
              value={form.artist}
              onChange={(e) => handleChange('artist', e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField
              label="Key"
              fullWidth
              value={form.song_key}
              onChange={(e) => handleChange('song_key', e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField
              label="Tempo (BPM)"
              fullWidth
              type="number"
              value={form.tempo}
              onChange={(e) => handleChange('tempo', e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField
              label="Duration (mm:ss)"
              fullWidth
              placeholder="3:45"
              value={form.duration}
              onChange={(e) => handleChange('duration', e.target.value)}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleCreate}>Add song</Button>
      </DialogActions>
    </Dialog>
  )
}

SongFormModal.propTypes = {
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func,
}
