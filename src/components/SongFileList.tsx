import type { SongFile, Id } from '../types/entities.ts'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { formatBytes } from '../utils/formatBytes.ts'

// Generic uploaded-file list for a song: used for PDF documents and mp3
// recordings. When `isAudio` is set, each row also renders an inline player.

interface SongFileListProps {
  songId: number
  initialFiles?: SongFile[]
  accept: string
  maxBytes: number
  uploadFn: (songId: number, file: File) => Promise<SongFile>
  deleteFn: (songId: number, fileId: Id | undefined) => Promise<void>
  isAudio?: boolean
  addLabel?: string
  canWrite?: boolean
}

export default function SongFileList({
  songId,
  initialFiles = [],
  accept,
  maxBytes,
  uploadFn,
  deleteFn,
  isAudio = false,
  addLabel,
  canWrite = true,
}: SongFileListProps) {
  const { t } = useTranslation(['songs', 'common'])
  const [files, setFiles] = useState<SongFile[]>(initialFiles)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<Id | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const confirmTarget = files.find((f) => f.id === confirmId)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size > maxBytes) {
      setError(t($ => $.files.sizeLimit, { size: formatBytes(maxBytes) }))
      return
    }
    setError(null)
    setUploading(true)
    try {
      const uploaded = await uploadFn(songId, file)
      setFiles((prev) => [...prev, uploaded])
    } catch (err) {
      setError((err as Error).message || t($ => $.files.uploadFailed))
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirmDelete() {
    const id = confirmId
    setConfirmId(null)
    setError(null)
    try {
      await deleteFn(songId, id ?? undefined)
      setFiles((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      setError((err as Error).message || t($ => $.files.deleteFailed))
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
          key={String(f.id)}
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
            {canWrite && (
              <IconButton size="small" color="error" onClick={() => setConfirmId(f.id ?? null)} aria-label={t($ => $.files.deleteAria)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
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

      {canWrite && (
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
            {uploading ? t($ => $.files.uploading) : (addLabel ?? t($ => $.common.actions.add))}
          </Button>
        </Box>
      )}

      <Dialog open={confirmId !== null} onClose={() => setConfirmId(null)}>
        <DialogTitle>{t($ => $.files.deleteTitle)}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t($ => $.files.deleteBody, { name: confirmTarget?.original_filename ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmId(null)}>{t($ => $.common.actions.cancel)}</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            {t($ => $.common.actions.delete)}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
