import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import SongsTable from '../components/SongsTable.tsx'
import SongFormModal from '../components/SongFormModal.tsx'
import SongImportDialog from '../components/SongImportDialog.tsx'
import SplitView from '../components/SplitView.tsx'
import { listSongs } from '../api/songs.ts'
import type { Song, Id } from '../types/entities.ts'

export default function SongsPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const [importOpen, setImportOpen] = useState(false)

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
          Songs
        </Typography>
        <Tooltip title="Import">
          <IconButton onClick={() => setImportOpen(true)}>
            <FileUploadOutlinedIcon />
          </IconButton>
        </Tooltip>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          Add
        </Button>
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

      {importOpen && (
        <SongImportDialog
          onClose={(reloaded) => {
            setImportOpen(false)
            if (reloaded) load()
          }}
        />
      )}
    </SplitView>
  )
}
