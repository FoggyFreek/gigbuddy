import { useRef, useState } from 'react'
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
import { deleteGigAttachment, uploadGigAttachment } from '../api/gigs.js'

const MAX_BYTES = 1 * 1024 * 1024
const ACCEPT = '.pdf,.xls,.xlsx,.doc,.docx,.txt'

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function GigAttachments({ gigId, initialAttachments = [] }) {
  const [attachments, setAttachments] = useState(initialAttachments)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const inputRef = useRef(null)

  const confirmTarget = attachments.find((a) => a.id === confirmId)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (file.size > MAX_BYTES) {
      setError('File exceeds the 1 MB limit.')
      return
    }

    setError(null)
    setUploading(true)
    try {
      const attachment = await uploadGigAttachment(gigId, file)
      setAttachments((prev) => [...prev, attachment])
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
      await deleteGigAttachment(gigId, id)
      setAttachments((prev) => prev.filter((a) => a.id !== id))
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

      {attachments.map((a) => (
        <Stack
          key={a.id}
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            px: 1.5,
            py: 0.75,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          <AttachFileIcon fontSize="small" color="action" />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Link
              href={`/api/files/${a.object_key}`}
              underline="hover"
              color="text.primary"
              sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}
            >
              {a.original_filename}
            </Link>
            <Typography variant="caption" color="text.secondary">
              {formatBytes(a.file_size)}
            </Typography>
          </Box>
          <IconButton size="small" color="error" onClick={() => setConfirmId(a.id)}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Box>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
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
          {uploading ? 'Uploading…' : 'Add'}
        </Button>
      </Box>

      <Dialog open={confirmId !== null} onClose={() => setConfirmId(null)}>
        <DialogTitle>Delete attachment?</DialogTitle>
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
