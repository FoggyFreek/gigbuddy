import type { SongLink } from '../types/entities.ts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import LinkIcon from '@mui/icons-material/Link'
import { addSongLink, deleteSongLink } from '../api/songs.ts'

interface SongLinksProps {
  songId: number
  initialLinks?: SongLink[]
  canWrite?: boolean
}

export default function SongLinks({ songId, initialLinks = [], canWrite = true }: SongLinksProps) {
  const { t } = useTranslation(['songs', 'common'])
  const [links, setLinks] = useState<SongLink[]>(initialLinks)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return
    setError(null)
    try {
      const link = await addSongLink(songId, { label: label.trim() || null, url: trimmedUrl })
      setLinks((prev) => [...prev, link])
      setLabel('')
      setUrl('')
    } catch (err) {
      setError((err as Error).message || t($ => $.links.addError))
    }
  }

  async function handleDelete(id: number | string | undefined) {
    if (id === undefined) return
    await deleteSongLink(songId, id)
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  return (
    <Stack spacing={1}>
      {links.map((l) => (
        <Stack
          key={String(l.id)}
          direction="row"
          spacing={1}
          sx={{
            alignItems: 'center',
            px: 1.5,
            py: 0.75,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <LinkIcon fontSize="small" color="action" />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Link
              href={l.url}
              target="_blank"
              rel="noopener"
              underline="hover"
              sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}
            >
              {l.label || l.url}
            </Link>
            {l.label && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                {l.url}
              </Typography>
            )}
          </Box>
          {canWrite && (
            <IconButton size="small" color="error" onClick={() => handleDelete(l.id)} aria-label={t($ => $.links.deleteAria)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      ))}

      {canWrite && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            label={t($ => $.links.label)}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            sx={{ flex: '0 0 30%' }}
          />
          <TextField
            size="small"
            label={t($ => $.links.url)}
            placeholder={t($ => $.links.urlPlaceholder)}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            sx={{ flexGrow: 1 }}
            error={!!error}
            helperText={error || ''}
          />
          <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAdd} disabled={!url.trim()}>
            {t($ => $.common.actions.add)}
          </Button>
        </Stack>
      )}
    </Stack>
  )
}
