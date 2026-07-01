import type { Song } from '../types/entities.ts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import { createSong } from '../api/songs.ts'
import { parseDuration } from '../utils/formatDuration.ts'

const EMPTY_FORM = { title: '', artist: '', song_key: '', tempo: '', duration: '' }

interface SongFormModalProps {
  onClose: () => void
  onCreated?: (song: Song) => void
}

export default function SongFormModal({ onClose, onCreated }: Readonly<SongFormModalProps>) {
  const { t } = useTranslation(['songs', 'common'])
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleCreate() {
    if (!form.title.trim()) {
      setErrors({ title: t($ => $.fields.required) })
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
      <DialogTitle>{t($ => $.addSong)}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid size={12}>
            <TextField
              label={t($ => $.fields.title)}
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
              label={t($ => $.fields.artist)}
              fullWidth
              value={form.artist}
              onChange={(e) => handleChange('artist', e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField
              label={t($ => $.fields.key)}
              fullWidth
              value={form.song_key}
              onChange={(e) => handleChange('song_key', e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField
              label={t($ => $.fields.tempoBpm)}
              fullWidth
              type="number"
              value={form.tempo}
              onChange={(e) => handleChange('tempo', e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField
              label={t($ => $.fields.durationMmss)}
              fullWidth
              placeholder={t($ => $.fields.durationPlaceholder)}
              value={form.duration}
              onChange={(e) => handleChange('duration', e.target.value)}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" onClick={handleCreate}>{t($ => $.addSong)}</Button>
      </DialogActions>
    </Dialog>
  )
}
