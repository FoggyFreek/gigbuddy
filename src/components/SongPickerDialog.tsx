import type { Song } from '../types/entities.ts'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import { listSongs } from '../api/songs.ts'
import { formatDuration } from '../utils/formatDuration.ts'

// Modal that lists the band's songs (searchable) and calls onSelect(song) when one
// is picked. Used by the setlist editor to add a song to a set.

interface SongPickerDialogProps {
  open: boolean
  onClose: () => void
  onSelect: (song: Song) => void
}

export default function SongPickerDialog({ open, onClose, onSelect }: SongPickerDialogProps) {
  const { t } = useTranslation('songs')
  const [songs, setSongs] = useState<Song[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) return
    listSongs().then(setSongs).catch(() => setSongs([]))
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return songs
    return songs.filter((s) =>
      [s.title, s.artist].some((f) => f?.toLowerCase().includes(q)))
  }, [songs, search])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t($ => $.addSong)}</DialogTitle>
      <DialogContent>
        <TextField
          size="small"
          fullWidth
          autoFocus
          placeholder={t($ => $.searchSongs)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 1 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        {filtered.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            {t($ => $.noSongsFound)}
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 400, overflow: 'auto' }}>
            {filtered.map((s) => {
              const meta = [s.artist, s.song_key, formatDuration(s.duration_seconds)]
                .filter(Boolean).join(' · ')
              return (
                <ListItemButton key={String(s.id)} onClick={() => onSelect(s)}>
                  <ListItemText
                    primary={s.title}
                    secondary={meta || null}
                    slotProps={{ primary: { noWrap: true } }}
                  />
                  <Box sx={{ flexShrink: 0, ml: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {formatDuration(s.duration_seconds)}
                    </Typography>
                  </Box>
                </ListItemButton>
              )
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  )
}
