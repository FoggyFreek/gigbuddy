import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Snackbar from '@mui/material/Snackbar'
import Tooltip from '@mui/material/Tooltip'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import SongImportDialog from './SongImportDialog.tsx'
import { createSong, deleteSong, uploadSongChart } from '../api/songs.ts'
import { lyricsHtmlFromChordPro, songFieldsFromChordPro } from '../utils/chordpro.ts'
import type { Song, Id } from '../types/entities.ts'

// Import menu for the Songs page: bulk CSV import, or a single ChordPro (.pro)
// file. The ChordPro path seeds a new song from the file's metadata
// (title/artist/key/tempo) and attaches the file as the song's first chart.
const CHART_ACCEPT = '.cho,.pro,.chopro,.chordpro,.crd,.chord'
const CHART_MAX = 512 * 1024

interface SongImportMenuProps {
  onImported: () => void
  onSongCreated: (song: Song) => void
}

export default function SongImportMenu({ onImported, onSongCreated }: Readonly<SongImportMenuProps>) {
  const { t } = useTranslation('songs')
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [csvOpen, setCsvOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  function openCsv() {
    setAnchorEl(null)
    setCsvOpen(true)
  }

  function pickChordPro() {
    setAnchorEl(null)
    inputRef.current?.click()
  }

  async function handleChordProFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size > CHART_MAX) {
      setError(t($ => $.import.sizeLimit))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const text = await file.text()
      const fields = songFieldsFromChordPro(text)
      const song = await createSong({
        title: fields.title || file.name.replace(/\.[^.]+$/, ''),
        artist: fields.artist,
        song_key: fields.song_key,
        tempo: fields.tempo,
        lyrics_html: lyricsHtmlFromChordPro(text),
      })
      try {
        await uploadSongChart(song.id as Id, file)
      } catch (err) {
        await deleteSong(song.id as Id).catch(() => {}) // best-effort cleanup so a rejected file leaves no orphan song
        throw err
      }
      onImported()
      onSongCreated(song)
    } catch (err) {
      setError((err as Error).message || t($ => $.import.failed))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={CHART_ACCEPT}
        style={{ display: 'none' }}
        onChange={handleChordProFile}
      />
      <Tooltip title={t($ => $.import.menuTooltip)}>
        <span>
          <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} disabled={busy} aria-label={t($ => $.import.menuTooltip)}>
            {busy ? <CircularProgress size={20} color="inherit" /> : <FileUploadOutlinedIcon />}
          </IconButton>
        </span>
      </Tooltip>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={openCsv}>
          <ListItemIcon><UploadFileIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t($ => $.import.fromCsv)}</ListItemText>
        </MenuItem>
        <MenuItem onClick={pickChordPro}>
          <ListItemIcon><LibraryMusicIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t($ => $.import.fromChordPro)}</ListItemText>
        </MenuItem>
      </Menu>

      {csvOpen && (
        <SongImportDialog
          onClose={(reloaded) => {
            setCsvOpen(false)
            if (reloaded) onImported()
          }}
        />
      )}

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </>
  )
}
