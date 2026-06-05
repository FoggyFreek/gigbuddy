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
import SongsTable from '../components/SongsTable.jsx'
import SongFormModal from '../components/SongFormModal.jsx'
import SongImportDialog from '../components/SongImportDialog.jsx'
import SplitView from '../components/SplitView.jsx'
import { listSongs } from '../api/songs.js'

export default function SongsPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [songs, setSongs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'create' }
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listSongs()
      setSongs(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSongUpdate = useCallback((id, patch) => {
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const handleSongDelete = useCallback((id) => {
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
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
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
