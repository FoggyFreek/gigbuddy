import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import PropTypes from 'prop-types'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import {
  deleteSong,
  deleteSongDocument,
  deleteSongRecording,
  getSong,
  searchSongTags,
  setSongTags,
  updateSong,
  uploadSongDocument,
  uploadSongRecording,
} from '../api/songs.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { formatDuration, parseDuration } from '../utils/formatDuration.js'
import RichTextEditor from '../components/RichTextEditor.jsx'
import SaveStatusLabel from '../components/SaveStatusLabel.jsx'
import SongLinks from '../components/SongLinks.jsx'
import SongFileList from '../components/SongFileList.jsx'

const DOCUMENT_ACCEPT = '.pdf,application/pdf'
const DOCUMENT_MAX = 5 * 1024 * 1024
const RECORDING_ACCEPT = '.mp3,audio/mpeg'
const RECORDING_MAX = 20 * 1024 * 1024

function SectionHeading({ children }) {
  return (
    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
      {children}
    </Typography>
  )
}
SectionHeading.propTypes = { children: PropTypes.node }

export default function SongDetailPage() {
  const { id } = useParams()
  const songId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  const [song, setSong] = useState(null)
  const [form, setForm] = useState({ title: '', artist: '', song_key: '', tempo: '', duration: '', notes: '' })
  const [tags, setTags] = useState([])
  const [tagOptions, setTagOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const saveFn = useCallback(async (patch) => { await updateSong(songId, patch) }, [songId])
  const { schedule, flush, status: saveStatus } = useDebouncedSave(
    saveFn,
    600,
    (patch) => outletCtx.onSongUpdate?.(songId, patch),
  )

  useEffect(() => {
    let cancelled = false
    // Reset so the detail body unmounts while the new song loads — children
    // seeded from `initial*` props (lyrics editor, links, files) only read them
    // on mount, so they must remount to pick up the new song.
    setLoading(true)
    setSong(null)
    getSong(songId)
      .then((s) => {
        if (cancelled) return
        setSong(s)
        setForm({
          title: s.title || '',
          artist: s.artist || '',
          song_key: s.song_key || '',
          tempo: s.tempo != null ? String(s.tempo) : '',
          duration: formatDuration(s.duration_seconds),
          notes: s.notes || '',
        })
        setTags((s.tags || []).map((t) => t.name))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    searchSongTags('').then((rows) => { if (!cancelled) setTagOptions(rows.map((t) => t.name)) }).catch(() => {})
    return () => { cancelled = true }
  }, [songId])

  function closeView() {
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  function handleField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field === 'title' && !value.trim()) return // title required — don't save blank
    if (field === 'tempo') {
      schedule({ tempo: value === '' ? null : Number(value) })
    } else if (field === 'duration') {
      // Only persist once it parses; otherwise wait for valid input.
      const secs = parseDuration(value)
      if (value === '' || secs !== null) schedule({ duration_seconds: secs })
    } else {
      schedule({ [field]: value.trim() === '' ? null : value })
    }
  }

  async function handleTagsChange(_event, newValue) {
    const names = [...new Set(newValue.map((t) => String(t).trim()).filter(Boolean))]
    setTags(names)
    const resolved = await setSongTags(songId, names)
    const resolvedNames = resolved.map((t) => t.name)
    setTags(resolvedNames)
    setTagOptions((prev) => [...new Set([...prev, ...resolvedNames])])
    outletCtx.onSongUpdate?.(songId, { tags: resolved })
  }

  async function handleDelete() {
    await deleteSong(songId)
    outletCtx.onSongDelete?.(songId)
    closeView()
  }

  async function handleBack() {
    await flush()
    closeView()
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" fontWeight={600}>Song</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={handleBack} aria-label="close">
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      {loading || !song ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Grid container spacing={2}>
            <Grid size={12}>
              <TextField
                label="Title"
                fullWidth
                required
                value={form.title}
                onChange={(e) => handleField('title', e.target.value)}
                error={!form.title.trim()}
                helperText={!form.title.trim() ? 'Required' : ''}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Artist"
                fullWidth
                value={form.artist}
                onChange={(e) => handleField('artist', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField
                label="Key"
                fullWidth
                value={form.song_key}
                onChange={(e) => handleField('song_key', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField
                label="Tempo"
                fullWidth
                type="number"
                value={form.tempo}
                onChange={(e) => handleField('tempo', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField
                label="Duration"
                fullWidth
                placeholder="3:45"
                value={form.duration}
                onChange={(e) => handleField('duration', e.target.value)}
              />
            </Grid>
            <Grid size={12}>
              <Autocomplete
                multiple
                freeSolo
                options={tagOptions}
                value={tags}
                onChange={handleTagsChange}
                renderValue={(value, getItemProps) =>
                  value.map((option, index) => {
                    const { key, ...itemProps } = getItemProps({ index })
                    return <Chip key={key} label={option} size="small" {...itemProps} />
                  })
                }
                renderInput={(params) => (
                  <TextField {...params} label="Tags" placeholder="Search or add…" />
                )}
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 3 }} />
          <SectionHeading>Lyrics</SectionHeading>
          <RichTextEditor
            initialHtml={song.lyrics_html || ''}
            onChange={(html) => schedule({ lyrics_html: html })}
            minHeight={200}
          />

          <Divider sx={{ my: 3 }} />
          <SectionHeading>Links</SectionHeading>
          <SongLinks songId={songId} initialLinks={song.links || []} />

          <Divider sx={{ my: 3 }} />
          <SectionHeading>Documents</SectionHeading>
          <SongFileList
            songId={songId}
            initialFiles={song.documents || []}
            accept={DOCUMENT_ACCEPT}
            maxBytes={DOCUMENT_MAX}
            uploadFn={uploadSongDocument}
            deleteFn={deleteSongDocument}
            addLabel="Add PDF"
          />

          <Divider sx={{ my: 3 }} />
          <SectionHeading>Recordings</SectionHeading>
          <SongFileList
            songId={songId}
            initialFiles={song.recordings || []}
            accept={RECORDING_ACCEPT}
            maxBytes={RECORDING_MAX}
            uploadFn={uploadSongRecording}
            deleteFn={deleteSongRecording}
            isAudio
            addLabel="Add mp3"
          />

          <Divider sx={{ my: 3 }} />
          <SectionHeading>Notes</SectionHeading>
          <TextField
            fullWidth
            multiline
            minRows={3}
            placeholder="Song notes…"
            value={form.notes}
            onChange={(e) => handleField('notes', e.target.value)}
          />
        </>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        <SaveStatusLabel status={saveStatus} />
      </Box>

      {!loading && song && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" variant="contained" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </Box>
      )}

      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)}>
        <DialogTitle>Delete song?</DialogTitle>
        <DialogContent>
          <DialogContentText>This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
