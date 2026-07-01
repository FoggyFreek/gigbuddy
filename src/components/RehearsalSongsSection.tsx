import type { RehearsalSong, Song, Id } from '../types/entities.ts'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import SongPicker from './SongPicker.tsx'

// Songs to practice in this rehearsal: a search picker to link existing songs
// (no create) plus a card per linked song with a detach button.

interface RehearsalSongsSectionProps {
  songs: RehearsalSong[]
  onAddSong: (song: Song) => void
  onRemoveSong: (songId: Id | undefined) => void
  canWrite?: boolean
}

export default function RehearsalSongsSection({ songs, onAddSong, onRemoveSong, canWrite = true }: Readonly<RehearsalSongsSectionProps>) {
  const { t } = useTranslation('rehearsals')
  return (
    <Grid size={12}>
      <Divider sx={{ my: 1 }} />
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        {t($ => $.songs.title)}
      </Typography>
      {canWrite && (
        <Box sx={{ maxWidth: 400, mb: songs.length ? 2 : 0 }}>
          <SongPicker onSelect={onAddSong} excludeIds={songs.map((s) => s.song_id).filter((id): id is Id => id !== undefined)} />
        </Box>
      )}
      {songs.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {songs.map((s) => (
            <Box
              key={String(s.song_id)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                // Full-width rows on phones; compact wrapping cards on desktop.
                width: { xs: '100%', sm: 'auto' },
                minWidth: { sm: 220 },
                maxWidth: { sm: 320 },
              }}
            >
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {s.title}
                </Typography>
                {s.artist && (
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {s.artist}
                  </Typography>
                )}
              </Box>
              <Tooltip title={t($ => $.songs.openSong)}>
                <IconButton
                  size="small"
                  component={RouterLink}
                  to={`/songs/${s.song_id}`}
                  aria-label={t($ => $.songs.openSongAria, { title: s.title })}
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {canWrite && (
                <IconButton
                  size="small"
                  aria-label={t($ => $.songs.detachSong, { title: s.title })}
                  onClick={() => onRemoveSong(s.song_id)}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Grid>
  )
}
