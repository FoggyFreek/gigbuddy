import { useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import DeleteIcon from '@mui/icons-material/Delete'
import { formatBytes } from '../utils/formatBytes.js'
import { songFileShape } from '../propTypes/shared.js'

// Generic uploaded-file list for a song: used for PDF documents and mp3
// recordings. When `isAudio` is set, each row also renders an inline player.
export default function SongFileList({
  songId,
  initialFiles = [],
  accept,
  maxBytes,
  uploadFn,
  deleteFn,
  isAudio = false,
  addLabel = 'Add',
}) {
  const [files, setFiles] = useState(initialFiles)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const inputRef = useRef(null)

  const confirmTarget = files.find((f) => f.id === confirmId)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size > maxBytes) {
      setError(`File exceeds the ${formatBytes(maxBytes)} limit.`)
      return
    }
    setError(null)
    setUploading(true)
    try {
      const uploaded = await uploadFn(songId, file)
      setFiles((prev) => [...prev, uploaded])
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirmDelete() {
    const id = confirmId
    setConfirmId(null)
    setError(null)
    try {
      await deleteFn(songId, id)
      setFiles((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      setError(err.message || 'Delete failed.')
    }
  }

  return (
    <Stack spacing={1}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0 }}>
          {error}
        </Alert>
      )}

      {files.map((f) => (
        <Box
          key={f.id}
          sx={{
            px: 1.5,
            py: 0.75,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <AttachFileIcon fontSize="small" color="action" />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Link
                href={`/api/files/${f.object_key}`}
                underline="hover"
                color="text.primary"
                sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}
              >
                {f.original_filename}
              </Link>
              <Typography variant="caption" color="text.secondary">
                {formatBytes(f.file_size)}
              </Typography>
            </Box>
            <IconButton size="small" color="error" onClick={() => setConfirmId(f.id)} aria-label="delete file">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
          {isAudio && (
            <Box
              component="audio"
              controls
              preload="none"
              src={`/api/files/${f.object_key}`}
              sx={{ mt: 1, width: '100%', height: 36 }}
            />
          )}
        </Box>
      ))}

      <Box>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={uploading ? <CircularProgress size={14} color="inherit" /> : <AttachFileIcon />}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Uploading…' : addLabel}
        </Button>
      </Box>

      <Dialog open={confirmId !== null} onClose={() => setConfirmId(null)}>
        <DialogTitle>Delete file?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmTarget?.original_filename} will be permanently deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmId(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

SongFileList.propTypes = {
  songId: PropTypes.number.isRequired,
  initialFiles: PropTypes.arrayOf(songFileShape),
  accept: PropTypes.string.isRequired,
  maxBytes: PropTypes.number.isRequired,
  uploadFn: PropTypes.func.isRequired,
  deleteFn: PropTypes.func.isRequired,
  isAudio: PropTypes.bool,
  addLabel: PropTypes.string,
}
