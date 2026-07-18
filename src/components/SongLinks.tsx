import type { SongLink } from '../types/entities.ts'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import { addSongLink, deleteSongLink } from '../api/songs.ts'
import { PlatformIcon } from './songLinks/platforms.tsx'
import {
  SONG_LINK_PLATFORMS,
  matchPlatform,
  platformByKey,
  urlMatchesPlatform,
} from '../utils/songLinkPlatforms.ts'

interface SongLinksProps {
  songId: number
  initialLinks?: SongLink[]
  canWrite?: boolean
}

/** An unsaved row created by clicking a platform's "+" in the grid. */
interface Draft {
  id: number
  platformKey: string // a SONG_LINK_PLATFORMS key, or 'other'
  url: string
  label: string
  error: string | null
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  px: 1.5,
  py: 0.75,
  borderRadius: 2,
  border: '1px solid',
  borderColor: 'divider',
} as const

export default function SongLinks({ songId, initialLinks = [], canWrite = true }: Readonly<SongLinksProps>) {
  const { t } = useTranslation(['songs', 'common'])
  const [links, setLinks] = useState<SongLink[]>(initialLinks)
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const draftSeq = useRef(0)

  const usedPlatformKeys = new Set([
    ...links.map((l) => matchPlatform(l.url || '')?.key).filter((k): k is string => !!k),
    ...drafts.map((d) => d.platformKey),
  ])
  const availablePlatforms = SONG_LINK_PLATFORMS.filter((p) => !usedPlatformKeys.has(p.key))

  function addDraft(platformKey: string) {
    draftSeq.current += 1
    setDrafts((prev) => [...prev, { id: draftSeq.current, platformKey, url: '', label: '', error: null }])
  }

  function patchDraft(id: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function removeDraft(id: number) {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
  }

  function validateDraft(draft: Draft): string | null {
    const url = draft.url.trim()
    const platform = platformByKey(draft.platformKey)
    if (platform) {
      return urlMatchesPlatform(platform, url) ? null : t($ => $.links.invalidUrl, { prefix: platform.prefix })
    }
    return /^https?:\/\/./i.test(url) ? null : t($ => $.links.invalidOtherUrl)
  }

  // Empty drafts are silently discarded; invalid or failed ones keep their
  // error and hold the section in edit mode. Returns whether the row is settled.
  async function commitDraft(draft: Draft): Promise<boolean> {
    const url = draft.url.trim()
    if (!url) {
      removeDraft(draft.id)
      return true
    }
    const error = validateDraft(draft)
    if (error) {
      patchDraft(draft.id, { error })
      return false
    }
    const platform = platformByKey(draft.platformKey)
    try {
      const link = await addSongLink(songId, { label: platform ? platform.name : draft.label.trim() || null, url })
      setLinks((prev) => [...prev, link])
      removeDraft(draft.id)
      return true
    } catch {
      patchDraft(draft.id, { error: t($ => $.links.addError) })
      return false
    }
  }

  async function handleFinished() {
    let allSettled = true
    for (const draft of drafts) {
      const settled = await commitDraft(draft)
      allSettled = allSettled && settled
    }
    if (allSettled) setEditing(false)
  }

  async function handleDelete(id: number | string | undefined) {
    if (id === undefined) return
    await deleteSongLink(songId, id)
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  function linkDisplayName(l: SongLink): string {
    const platform = matchPlatform(l.url || '')
    return platform ? platform.name : l.label || l.url || ''
  }

  if (!editing) {
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        {links.map((l) => (
          <Link
            key={String(l.id)}
            href={l.url}
            target="_blank"
            rel="noopener"
            underline="none"
            sx={{
              ...rowSx,
              whiteSpace: 'nowrap',
              fontSize: 14,
              fontWeight: 500,
              color: 'text.primary',
              transition: (theme) => theme.transitions.create(['box-shadow', 'transform', 'border-color'], {
                duration: theme.transitions.duration.shorter,
              }),
              '&:hover': {
                bgcolor: 'action.hover',
                borderColor: 'primary.main',
                transform: 'translateY(-2px)',
                boxShadow: 2,
              },
            }}
          >
            <PlatformIcon platformKey={matchPlatform(l.url || '')?.key ?? null} />
            {linkDisplayName(l)}
          </Link>
        ))}
        {canWrite && (
          <Button
            size="small"
            variant="outlined"
            startIcon={links.length ? <EditIcon /> : <AddIcon />}
            onClick={() => setEditing(true)}
            sx={{ px: 1.5, py: 0.75, borderRadius: 2, fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}
          >
            {links.length ? t($ => $.links.editLinks) : t($ => $.links.addLinks)}
          </Button>
        )}
      </Box>
    )
  }

  return (
    <Stack spacing={1}>
      {links.map((l) => (
        <Box key={String(l.id)} sx={rowSx}>
          <PlatformIcon platformKey={matchPlatform(l.url || '')?.key ?? null} />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
              {linkDisplayName(l)}
            </Typography>
            <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
              {l.url}
            </Typography>
          </Box>
          <IconButton size="small" color="error" onClick={() => handleDelete(l.id)} aria-label={t($ => $.links.deleteAria)}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}

      {drafts.map((draft) => {
        const platform = platformByKey(draft.platformKey)
        return (
          <Box key={draft.id} sx={{ ...rowSx, py: 1 }}>
            <PlatformIcon platformKey={platform?.key ?? null} />
            {platform ? (
              <Typography variant="body2" sx={{ fontWeight: 500, flex: '0 0 auto' }}>
                {platform.name}
              </Typography>
            ) : (
              <TextField
                size="small"
                label={t($ => $.links.label)}
                value={draft.label}
                onChange={(e) => patchDraft(draft.id, { label: e.target.value })}
                sx={{ flex: '0 0 30%' }}
              />
            )}
            <TextField
              size="small"
              autoFocus
              label={platform ? undefined : t($ => $.links.url)}
              placeholder={platform ? platform.prefix : t($ => $.links.urlPlaceholder)}
              value={draft.url}
              onChange={(e) => patchDraft(draft.id, { url: e.target.value, error: null })}
              onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(draft) }}
              error={!!draft.error}
              helperText={draft.error || ''}
              sx={{ flexGrow: 1 }}
            />
            <IconButton size="small" onClick={() => removeDraft(draft.id)} aria-label={t($ => $.links.deleteAria)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        )
      })}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
        {availablePlatforms.map((p) => (
          <Box key={p.key} sx={rowSx}>
            <PlatformIcon platformKey={p.key} />
            <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 500 }}>
              {p.name}
            </Typography>
            <IconButton
              size="small"
              onClick={() => addDraft(p.key)}
              aria-label={t($ => $.links.addPlatformAria, { platform: p.name })}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Box sx={rowSx}>
          <PlatformIcon platformKey={null} />
          <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 500 }}>
            {t($ => $.links.other)}
          </Typography>
          <IconButton
            size="small"
            onClick={() => addDraft('other')}
            aria-label={t($ => $.links.addPlatformAria, { platform: t($ => $.links.other) })}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <Box>
        <Button size="small" variant="contained" startIcon={<CheckIcon />} onClick={handleFinished}>
          {t($ => $.links.finished)}
        </Button>
      </Box>
    </Stack>
  )
}
