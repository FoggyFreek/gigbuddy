import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import DateEntryField from '../../../components/DateEntryField.tsx'
import ImageCropDialog from '../../../components/ImageCropDialog.tsx'
import SongCoverThumb from './SongCoverThumb.tsx'
import { JPEG_PNG_WEBP, useImageCrop } from '../../../hooks/useImageCrop.ts'
import { compressAlbumArt } from '../../../utils/compressImage.ts'
import { useEntitlements } from '../../../hooks/useEntitlements.ts'
import {
  createAlbum,
  deleteAlbumArt,
  updateAlbum,
  uploadAlbumArt,
} from '../songs.ts'
import type { Album } from '../../../types/entities.ts'

interface Props {
  album?: Album | null
  initialTitle?: string
  onSaved: (album: Album) => void
  onClose: () => void
}

export default function AlbumFormModal({ album = null, initialTitle = '', onSaved, onClose }: Readonly<Props>) {
  const { t } = useTranslation(['songs', 'common'])
  const { has } = useEntitlements()
  const canCustomize = has('customization')
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(album?.title ?? initialTitle)
  const [releaseDate, setReleaseDate] = useState(album?.release_date ?? '')
  const [pendingArt, setPendingArt] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [removeArt, setRemoveArt] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isEdit = album?.id !== undefined

  const crop = useImageCrop(
    compressAlbumArt,
    async (file) => {
      setPendingArt(file)
      setPendingPreview(URL.createObjectURL(file))
      setRemoveArt(false)
    },
    setError,
    JPEG_PNG_WEBP,
  )

  useEffect(() => () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
  }, [pendingPreview])

  async function handleSave() {
    if (!title.trim()) {
      setError(t($ => $.fields.required))
      return
    }
    setSaving(true)
    setError(null)
    try {
      let saved = isEdit
        ? await updateAlbum(album.id!, { title: title.trim(), release_date: releaseDate || null })
        : await createAlbum({ title: title.trim(), release_date: releaseDate || null })
      if (pendingArt && saved.id !== undefined) {
        saved = await uploadAlbumArt(saved.id, pendingArt)
      } else if (removeArt && saved.id !== undefined) {
        saved = await deleteAlbumArt(saved.id)
      }
      onSaved(saved)
    } catch {
      setError(t($ => $.albums.saveFailed))
    } finally {
      setSaving(false)
    }
  }

  const storedArt = removeArt ? null : album?.album_art_url
  const previewSrc = pendingPreview ?? (storedArt ? `/api/files/${storedArt}` : null)

  return (
    <>
      <Dialog open fullWidth maxWidth="xs" onClose={saving ? undefined : onClose}>
        <DialogTitle>{isEdit ? t($ => $.albums.editTitle) : t($ => $.albums.createTitle)}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t($ => $.fields.albumTitle)}
              value={title}
              onChange={(event) => { setTitle(event.target.value); setError(null) }}
              required
              autoFocus
              error={Boolean(error)}
              helperText={error || undefined}
            />
            <DateEntryField
              fullWidth
              label={t($ => $.fields.releaseDate)}
              value={releaseDate}
              onChange={(event) => setReleaseDate(event.target.value)}
              openPickerLabel={t($ => $.albums.openDatePicker)}
            />
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              {previewSrc ? (
                <Box
                  component="img"
                  src={previewSrc}
                  alt={t($ => $.albums.artPreviewAlt)}
                  sx={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 1 }}
                />
              ) : (
                <SongCoverThumb size={80} alt="" />
              )}
              {canCustomize && (
                <Stack spacing={1}>
                  <Button variant="outlined" onClick={() => inputRef.current?.click()} disabled={crop.uploading}>
                    {previewSrc ? t($ => $.albums.changeArt) : t($ => $.albums.chooseArt)}
                  </Button>
                  {previewSrc && (
                    <Button
                      onClick={() => {
                        setPendingArt(null)
                        setPendingPreview(null)
                        setRemoveArt(true)
                      }}
                    >
                      {t($ => $.albums.removeArt)}
                    </Button>
                  )}
                </Stack>
              )}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={saving}>{t($ => $.common.actions.cancel)}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || crop.uploading}>
            {isEdit ? t($ => $.common.actions.save) : t($ => $.albums.createAction)}
          </Button>
        </DialogActions>
      </Dialog>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={crop.handleFileChange}
      />
      <ImageCropDialog
        open={crop.cropOpen}
        imageSrc={crop.cropSrc}
        aspect={1}
        title={t($ => $.albums.cropTitle)}
        onConfirm={crop.handleCropConfirm}
        onCancel={crop.handleCropCancel}
      />
    </>
  )
}
