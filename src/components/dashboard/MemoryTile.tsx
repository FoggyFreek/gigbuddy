import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import CheckIcon from '@mui/icons-material/Check'
import CollectionsIcon from '@mui/icons-material/Collections'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import DashboardCard from './DashboardCard.tsx'
import ImageCropDialog from '../ImageCropDialog.tsx'
import { useImageCrop, JPEG_PNG } from '../../hooks/useImageCrop.ts'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import { useToast } from '../../contexts/toastContext.ts'
import { compressMemoryPhoto } from '../../utils/compressImage.ts'
import { deleteMemoryImage, updateProfile, uploadMemoryImage } from '../../api/profile.ts'
import type { Gig, Id } from '../../types/entities.ts'

export interface MemoryPatch {
  memory_image_path?: string | null
  memory_caption?: string | null
  memory_gig_id?: Id | null
}

interface MemoryTileProps {
  imagePath: string | null
  caption: string | null
  gigId: Id | null
  /** All gigs, for resolving the linked-gig label and the picker options. */
  gigs: Gig[]
  /** Whether the viewer may edit (planning write). Read-only members just view. */
  canEdit: boolean
  /** Called after a field persists, so the parent can update its profile state. */
  onSaved: (patch: MemoryPatch) => void
}

const IMAGE_MAX_HEIGHT = 400

function gigLabel(gig: Gig, locale: string): string {
  const date = gig.event_date
    ? new Date(gig.event_date).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
    : ''
  return [gig.event_description, date].filter(Boolean).join(' · ')
}

export default function MemoryTile({ imagePath, caption, gigId, gigs, canEdit, onSaved }: Readonly<MemoryTileProps>) {
  const { t, i18n } = useTranslation('dashboard')
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const showToast = useToast()

  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  // Local caption for the controlled TextField, re-seeded (render-phase sync, the
  // React-recommended alternative to a setState-in-effect) whenever the persisted
  // prop changes so it never drifts from the source.
  const [captionDraft, setCaptionDraft] = useState(caption ?? '')
  const [seededCaption, setSeededCaption] = useState(caption)
  if (seededCaption !== caption) {
    setSeededCaption(caption)
    setCaptionDraft(caption ?? '')
  }

  const inputRef = useRef<HTMLInputElement>(null)
  const crop = useImageCrop(
    compressMemoryPhoto,
    async (file) => {
      const { memory_image_path } = await uploadMemoryImage(file)
      onSaved({ memory_image_path: memory_image_path ?? null })
    },
    (msg) => showToast?.(msg || t($ => $.memory.uploadError), 'error'),
    JPEG_PNG,
  )

  const { schedule, flush, cancel } = useDebouncedSave<{ memory_caption: string | null }>(
    async ({ memory_caption }) => {
      await updateProfile({ memory_caption })
      onSaved({ memory_caption })
    },
  )

  // Gigs newest-first for the picker; a linked gig celebrates a past moment.
  const gigOptions = useMemo(
    () => [...gigs].sort((a, b) => String(b.event_date ?? '').localeCompare(String(a.event_date ?? ''))),
    [gigs],
  )
  const linkedGig = gigId != null ? gigs.find((g) => g.id === gigId) ?? null : null

  async function saveGig(next: Gig | null) {
    const nextId = next?.id ?? null
    try {
      await updateProfile({ memory_gig_id: nextId })
      onSaved({ memory_gig_id: nextId })
    } catch {
      showToast?.(t($ => $.memory.uploadError), 'error')
    }
  }

  async function removePhoto() {
    // Drop any in-flight caption edit so its debounced save can't resurrect the
    // caption after we clear the whole tile.
    cancel()
    setRemoving(true)
    try {
      await deleteMemoryImage()
      onSaved({ memory_image_path: null, memory_caption: null, memory_gig_id: null })
    } catch {
      showToast?.(t($ => $.memory.removeError), 'error')
    } finally {
      setRemoving(false)
    }
  }

  function toggleEditing() {
    if (editing) flush()
    setEditing((prev) => !prev)
  }

  const hasContent = Boolean(imagePath || caption || gigId)
  // A read-only member with nothing to show gets no empty card.
  if (!canEdit && !hasContent) return null

  const editAction = canEdit ? (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      {/* Remove sits next to Done while editing, but only when there's a photo. */}
      {editing && imagePath && (
        <Tooltip title={t($ => $.memory.removePhoto)}>
          <span>
            <IconButton
              size="small"
              onClick={removePhoto}
              disabled={removing || crop.uploading}
              color="error"
              aria-label={t($ => $.memory.removePhoto)}
            >
              {removing ? <CircularProgress size={18} /> : <DeleteIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      )}
      <Tooltip title={editing ? t($ => $.memory.done) : t($ => $.memory.edit)}>
        <IconButton
          size="small"
          onClick={toggleEditing}
          color={editing ? 'primary' : 'default'}
          aria-label={editing ? t($ => $.memory.done) : t($ => $.memory.edit)}
        >
          {editing ? <CheckIcon fontSize="small" /> : <EditIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Box>
  ) : undefined

  return (
    <DashboardCard title={t($ => $.memory.title)} icon={CollectionsIcon} action={editAction}>
      {imagePath ? (
        <Box sx={{ position: 'relative', mb: 0.75 }}>
          <Box
            component="img"
            src={`/api/files/${imagePath}`}
            alt={t($ => $.memory.imageAlt)}
            sx={{
              display: 'block',
              width: '100%',
              maxHeight: IMAGE_MAX_HEIGHT,
              objectFit: 'cover',
              borderRadius: 1,
            }}
          />
          {crop.uploading && (
            <Box sx={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.4)', borderRadius: 2,
            }}>
              <CircularProgress size={28} sx={{ color: '#fff' }} />
            </Box>
          )}
          {editing && (
            <Tooltip title={t($ => $.memory.changePhoto)}>
              <IconButton
                size="small"
                onClick={() => inputRef.current?.click()}
                disabled={crop.uploading}
                aria-label={t($ => $.memory.changePhoto)}
                sx={{
                  position: 'absolute', top: 8, right: 8,
                  bgcolor: 'rgba(0,0,0,0.5)', color: '#fff',
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.72)' },
                }}
              >
                <PhotoCameraIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {/* Linked gig sits over the photo's bottom-right corner (read view). */}
          {!editing && linkedGig && (
            <Chip
              icon={<CollectionsIcon />}
              label={gigLabel(linkedGig, locale)}
              onClick={() => navigate(`/gigs/${linkedGig.id}`)}
              size="small"
              sx={{
                position: 'absolute', bottom: 8, right: 8, maxWidth: 'calc(100% - 16px)',
                bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', backdropFilter: 'blur(4px)',
                '& .MuiChip-icon': { color: '#fff' },
                '&:hover': { bgcolor: 'rgba(0,0,0,0.78)' },
              }}
            />
          )}
        </Box>
      ) : (
        canEdit && (
          <Button
            fullWidth
            variant="outlined"
            startIcon={crop.uploading ? <CircularProgress size={18} /> : <AddPhotoAlternateIcon />}
            onClick={() => inputRef.current?.click()}
            disabled={crop.uploading}
            sx={{ height: 120, mb: 1.5, borderStyle: 'dashed', textTransform: 'none' }}
          >
            {t($ => $.memory.addPhoto)}
          </Button>
        )
      )}

      {editing ? (
        <TextField
          fullWidth
          multiline
          size="small"
          minRows={1}
          maxRows={4}
          label={t($ => $.memory.captionLabel)}
          placeholder={t($ => $.memory.captionPlaceholder)}
          value={captionDraft}
          onChange={(e) => { setCaptionDraft(e.target.value); schedule({ memory_caption: e.target.value || null }) }}
          onBlur={() => flush()}
          slotProps={{ htmlInput: { maxLength: 500 } }}
          sx={{ mb: 1.5 }}
        />
      ) : (
        caption && (
          <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
            {caption}
          </Typography>
        )
      )}

      {editing ? (
        <Autocomplete
          options={gigOptions}
          value={linkedGig}
          onChange={(_, next) => saveGig(next)}
          getOptionLabel={(g) => gigLabel(g, locale)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          size="small"
          renderInput={(params) => (
            <TextField {...params} label={t($ => $.memory.gigLabel)} placeholder={t($ => $.memory.gigNone)} />
          )}
        />
      ) : (
        // With an image the chip is overlaid on it; only the imageless read view
        // needs the chip here.
        !imagePath && linkedGig && (
          <Chip
            icon={<CollectionsIcon />}
            label={gigLabel(linkedGig, locale)}
            onClick={() => navigate(`/gigs/${linkedGig.id}`)}
            size="small"
            variant="outlined"
            sx={{ maxWidth: '100%' }}
          />
        )
      )}

      {/* Hidden file input drives both the "add" and "change" affordances. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={crop.handleFileChange}
      />
      <ImageCropDialog
        open={crop.cropOpen}
        imageSrc={crop.cropSrc}
        title={t($ => $.memory.cropTitle)}
        onConfirm={crop.handleCropConfirm}
        onCancel={crop.handleCropCancel}
      />
    </DashboardCard>
  )
}
