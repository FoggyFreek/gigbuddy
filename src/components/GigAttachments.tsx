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
import { deleteGigAttachment, uploadGigAttachment } from '../api/gigs.ts'
import { formatBytes } from '../utils/formatBytes.ts'
import type { Id, PurchaseAttachment } from '../types/entities.ts'

const MAX_BYTES = 1 * 1024 * 1024
const ACCEPT = '.pdf,.xls,.xlsx,.doc,.docx,.txt'

interface GigAttachmentsProps {
  gigId: Id
  initialAttachments?: PurchaseAttachment[]
  canWrite?: boolean
}

export default function GigAttachments({ gigId, initialAttachments = [], canWrite = true }: GigAttachmentsProps) {
  const { t } = useTranslation('gigs')
  const [attachments, setAttachments] = useState<PurchaseAttachment[]>(initialAttachments)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<Id | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const confirmTarget = attachments.find((a) => a.id === confirmId)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (file.size > MAX_BYTES) {
      setError(t($ => $.attachments.fileTooLarge))
      return
    }

    setError(null)
    setUploading(true)
    try {
      const attachment = await uploadGigAttachment(gigId, file)
      setAttachments((prev) => [...prev, attachment])
    } catch (err) {
      setError((err as Error).message || t($ => $.attachments.uploadFailed))
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirmDelete() {
    const id = confirmId
    setConfirmId(null)
    setError(null)
    if (id === null) return
    try {
      await deleteGigAttachment(gigId, id)
      setAttachments((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      setError((err as Error).message || t($ => $.attachments.deleteFailed))
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
          key={String(a.id)}
          direction="row"
          spacing={1}
          sx={{
            alignItems: 'center',
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
              {formatBytes(a.file_size ?? 0)}
            </Typography>
          </Box>
          {canWrite && (
            <IconButton size="small" color="error" onClick={() => setConfirmId(a.id ?? null)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      ))}
      {canWrite && (
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
            {uploading ? t($ => $.attachments.uploading) : t($ => $.attachments.add)}
          </Button>
        </Box>
      )}

      <Dialog open={confirmId !== null} onClose={() => setConfirmId(null)}>
        <DialogTitle>{t($ => $.attachments.deleteTitle)}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t($ => $.attachments.deleteBody, { filename: confirmTarget?.original_filename ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmId(null)}>{t($ => $.attachments.cancel)}</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            {t($ => $.attachments.delete)}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
