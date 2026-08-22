import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import DeleteIcon from '@mui/icons-material/Delete'
import FilePresentIcon from '@mui/icons-material/FilePresent'
import { deleteGigAttachment, uploadGigAttachment } from '../../gigs.ts'
import { formatBytes } from '../../../../utils/formatBytes.ts'
import { useDialog } from '../../../../contexts/dialogContext.ts'
import type { Id, PurchaseAttachment } from '../../../../types/entities.ts'

const MAX_BYTES = 1 * 1024 * 1024
const ACCEPT = '.pdf,.xls,.xlsx,.doc,.docx,.txt'

interface GigAttachmentsProps {
  gigId: Id
  initialAttachments?: PurchaseAttachment[]
  canWrite?: boolean
  // Cross-tenant reads strip `object_key`, so there is no file to link to;
  plainText?: boolean
}

export default function GigAttachments({ gigId, initialAttachments = [], canWrite = true, plainText = false }: Readonly<GigAttachmentsProps>) {
  const { t } = useTranslation(['gigs', 'common'])
  const { confirmDelete } = useDialog()
  const [attachments, setAttachments] = useState<PurchaseAttachment[]>(initialAttachments)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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

  async function handleDelete(attachment: PurchaseAttachment) {
    const confirmed = await confirmDelete({
      title: t($ => $.attachments.deleteTitle),
      body: t($ => $.attachments.deleteBody, { filename: attachment.original_filename ?? '' }),
    })
    if (!confirmed) return
    const id = attachment.id ?? null
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
          <FilePresentIcon fontSize="small" color="action" />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            {plainText ? (
              <Typography sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
                {a.original_filename}
              </Typography>
            ) : (
              <Link
                href={`/api/files/${a.object_key}`}
                underline="hover"
                color="text.primary"
                sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}
              >
                {a.original_filename}
              </Link>
            )}
            <Typography variant="caption" color="text.secondary">
              {formatBytes(a.file_size ?? 0)}
            </Typography>
          </Box>
          {canWrite && (
            <IconButton size="small" color="error" onClick={() => { void handleDelete(a) }}>
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
            {uploading ? t($ => $.attachments.uploading) : t($ => $.actions.add, { ns: 'common' })}
          </Button>
        </Box>
      )}

    </Stack>
  )
}
