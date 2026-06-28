import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
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
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listSongs()
      setSongs(data as Song[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSongUpdate = useCallback((id: Id, patch: Partial<Song>) => {
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const handleSongDelete = useCallback((id: Id) => {
    setSongs((prev) => prev.filter((s) => s.id !== id))
  }, [])

  useEffect(() => { load() }, [load])

  function handleClose() {
    setModal(null)
    load()
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
            onImported={load}
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
