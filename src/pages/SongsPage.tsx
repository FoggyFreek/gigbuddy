import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import SongsTable from '../components/SongsTable.tsx'
import SongFormModal from '../components/SongFormModal.tsx'
import SongImportMenu from '../components/SongImportMenu.tsx'
import SplitView from '../components/SplitView.tsx'
import { listSongs } from '../api/songs.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Song, Id } from '../types/entities.ts'

export default function SongsPage() {
  const { t } = useTranslation(['songs', 'common'])
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)

  // The fetched list is tagged with the reload it answered, so `loading` and
  // `error` are derived from whether the newest reload has landed.
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])
  const [songsState, setSongsState] = useState<{ key: number; songs: Song[]; error: string | null } | null>(null)
  const songs = songsState?.songs ?? []
  const loading = songsState?.key !== reloadNonce
  const error = songsState?.key === reloadNonce ? songsState.error : null

  useEffect(() => {
    let cancelled = false
    listSongs()
      .then((data) => {
        if (!cancelled) setSongsState({ key: reloadNonce, songs: data as Song[], error: null })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setSongsState((prev) => ({
            key: reloadNonce,
            songs: prev?.songs ?? [],
            error: e instanceof Error ? e.message : String(e),
          }))
        }
      })
    return () => { cancelled = true }
  }, [reloadNonce])

  const handleSongUpdate = useCallback((id: Id, patch: Partial<Song>) => {
    setSongsState((prev) => (prev
      ? { ...prev, songs: prev.songs.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
      : prev))
  }, [])

  const handleSongDelete = useCallback((id: Id) => {
    setSongsState((prev) => (prev ? { ...prev, songs: prev.songs.filter((s) => s.id !== id) } : prev))
  }, [])

  function handleClose() {
    setModal(null)
    reload()
  }

  return (
    <SplitView
      basePath="/songs"
      outletContext={{ onSongUpdate: handleSongUpdate, onSongDelete: handleSongDelete }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 600,  flexGrow: 1  }}>
          {t($ => $.title)}
        </Typography>
        {canWritePlanning && (
          <SongImportMenu
            onImported={reload}
            onSongCreated={(song) => navigate(`/songs/${song.id}`)}
          />
        )}
        {canWritePlanning && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setModal({ mode: 'create' })}
          >
            {t($ => $.common.actions.add)}
          </Button>
        )}
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {!loading && (
        <SongsTable
          songs={songs}
          onRowClick={(s) => navigate(`/songs/${s.id}`)}
          selectedId={selectedId}
        />
      )}

      {modal && (
        <SongFormModal
          onClose={handleClose}
          onCreated={(song) => navigate(`/songs/${song.id}`)}
        />
      )}
    </SplitView>
  )
}
