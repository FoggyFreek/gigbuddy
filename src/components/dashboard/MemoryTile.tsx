import { type Dispatch, type SetStateAction, useRef, useState } from 'react'
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
import useRemoteSearch from '../../hooks/useRemoteSearch.ts'
import { useToast } from '../../contexts/toastContext.ts'
import { compressMemoryPhoto } from '../../utils/compressImage.ts'
import { getGig, searchGigs } from '../../api/gigs.ts'
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
  /** Gigs already needed for display (normally just the linked memory gig). */
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

// The persisted gigId is resolved against the freshest source that has the gig:
// an explicit selection, the gigs the parent already loaded, then search results.
function resolveLinkedGig(gigId: Id | null, selectedGig: Gig | null, gigs: Gig[], gigOptions: Gig[]): Gig | null {
  if (gigId == null) return null
  return (selectedGig?.id === gigId ? selectedGig : null)
    ?? gigs.find((gig) => gig.id === gigId)
    ?? gigOptions.find((gig) => gig.id === gigId)
    ?? null
}

interface GigChipProps {
  gig: Gig
  locale: string
  /** Overlay style sits on the photo's bottom-right corner (read view). */
  overlay?: boolean
}

function GigChip({ gig, locale, overlay = false }: Readonly<GigChipProps>) {
  const navigate = useNavigate()
  return (
    <Chip
      icon={<CollectionsIcon />}
      label={gigLabel(gig, locale)}
      onClick={() => navigate(`/gigs/${gig.id}`)}
      size="small"
      variant={overlay ? 'filled' : 'outlined'}
      sx={overlay ? {
        position: 'absolute', bottom: 8, right: 8, maxWidth: 'calc(100% - 16px)',
        bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', backdropFilter: 'blur(4px)',
        '& .MuiChip-icon': { color: '#fff' },
        '&:hover': { bgcolor: 'rgba(0,0,0,0.78)' },
      } : { maxWidth: '100%' }}
    />
  )
}

interface MemoryEditActionsProps {
  editing: boolean
  hasPhoto: boolean
  removing: boolean
  uploading: boolean
  onRemovePhoto: () => void
  onToggleEditing: () => void
}

function MemoryEditActions({
  editing, hasPhoto, removing, uploading, onRemovePhoto, onToggleEditing,
}: Readonly<MemoryEditActionsProps>) {
  const { t } = useTranslation('dashboard')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      {/* Remove sits next to Done while editing, but only when there's a photo. */}
      {editing && hasPhoto && (
        <Tooltip title={t($ => $.memory.removePhoto)}>
          <span>
            <IconButton
              size="small"
              onClick={onRemovePhoto}
              disabled={removing || uploading}
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
          onClick={onToggleEditing}
          color={editing ? 'primary' : 'default'}
          aria-label={editing ? t($ => $.memory.done) : t($ => $.memory.edit)}
        >
          {editing ? <CheckIcon fontSize="small" /> : <EditIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Box>
  )
}

interface MemoryPhotoProps {
  imagePath: string | null
  canEdit: boolean
  editing: boolean
  uploading: boolean
  linkedGig: Gig | null
  locale: string
  onPickFile: () => void
}

function MemoryPhoto({
  imagePath, canEdit, editing, uploading, linkedGig, locale, onPickFile,
}: Readonly<MemoryPhotoProps>) {
  const { t } = useTranslation('dashboard')
  if (!imagePath) {
    if (!canEdit) return null
    return (
      <Button
        fullWidth
        variant="outlined"
        startIcon={uploading ? <CircularProgress size={18} /> : <AddPhotoAlternateIcon />}
        onClick={onPickFile}
        disabled={uploading}
        sx={{ height: 120, mb: 1.5, borderStyle: 'dashed', textTransform: 'none' }}
      >
        {t($ => $.memory.addPhoto)}
      </Button>
    )
  }

  return (
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
      {uploading && (
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
            onClick={onPickFile}
            disabled={uploading}
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
      {!editing && linkedGig && <GigChip gig={linkedGig} locale={locale} overlay />}
    </Box>
  )
}

interface MemoryCaptionFieldProps {
  caption: string | null
  schedule: (value: { memory_caption: string | null }) => void
  flush: () => void
}

function MemoryCaptionField({ caption, schedule, flush }: Readonly<MemoryCaptionFieldProps>) {
  const { t } = useTranslation('dashboard')
  // Local caption for the controlled TextField, re-seeded (render-phase sync, the
  // React-recommended alternative to a setState-in-effect) whenever the persisted
  // prop changes so it never drifts from the source.
  const [captionDraft, setCaptionDraft] = useState(caption ?? '')
  const [seededCaption, setSeededCaption] = useState(caption)
  if (seededCaption !== caption) {
    setSeededCaption(caption)
    setCaptionDraft(caption ?? '')
  }

  return (
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
  )
}

interface MemoryGigPickerProps {
  gigId: Id | null
  gigs: Gig[]
  selectedGig: Gig | null
  setSelectedGig: Dispatch<SetStateAction<Gig | null>>
  locale: string
  onSaved: (patch: MemoryPatch) => void
}

// Only mounted while editing, so its search state resets when edit mode closes.
function MemoryGigPicker({
  gigId, gigs, selectedGig, setSelectedGig, locale, onSaved,
}: Readonly<MemoryGigPickerProps>) {
  const { t } = useTranslation('dashboard')
  const { t: tCommon } = useTranslation('common')
  const showToast = useToast()

  const {
    inputValue: gigInput,
    options: gigOptions,
    loading: gigsLoading,
    tooShort: gigQueryTooShort,
    minChars: gigSearchMinChars,
    onInputChange: handleGigInputChange,
    clearQuery: clearGigQuery,
  } = useRemoteSearch<Gig>({ search: searchGigs })

  const linkedGig = resolveLinkedGig(gigId, selectedGig, gigs, gigOptions)

  async function saveGig(next: Gig | null) {
    const nextId = next?.id ?? null
    try {
      await updateProfile({ memory_gig_id: nextId })
    } catch {
      showToast?.(t($ => $.memory.uploadError), 'error')
      return
    }

    // Keep the clicked search result as the controlled value while the picker
    // query is cleared, then replace it with the canonical detail response.
    setSelectedGig(next)
    onSaved({ memory_gig_id: nextId })
    clearGigQuery()

    if (nextId != null) {
      try {
        setSelectedGig(await getGig(nextId))
      } catch {
        // The link was saved successfully; retain the search result if the
        // follow-up refresh fails instead of making the selection disappear.
      }
    }
  }

  const noOptionsText = gigQueryTooShort
    ? tCommon($ => $.picker.typeMinChars, { count: gigSearchMinChars })
    : gigsLoading
      ? tCommon($ => $.picker.searching)
      : tCommon($ => $.picker.noMatches)

  return (
    <Autocomplete
      options={gigOptions}
      value={linkedGig}
      onChange={(_, next) => saveGig(next)}
      inputValue={gigInput}
      onInputChange={handleGigInputChange}
      filterOptions={(options) => options}
      loading={gigsLoading}
      getOptionLabel={(g) => gigLabel(g, locale)}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      noOptionsText={noOptionsText}
      size="small"
      renderInput={(params) => (
        <TextField {...params} label={t($ => $.memory.gigLabel)} placeholder={t($ => $.memory.gigNone)} />
      )}
    />
  )
}

export default function MemoryTile({ imagePath, caption, gigId, gigs, canEdit, onSaved }: Readonly<MemoryTileProps>) {
  const { t, i18n } = useTranslation('dashboard')
  const locale = i18n.resolvedLanguage ?? 'en'
  const showToast = useToast()

  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [selectedGig, setSelectedGig] = useState<Gig | null>(null)

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

  // Read-view resolution; while editing the picker resolves with its own
  // search results as an extra fallback.
  const linkedGig = resolveLinkedGig(gigId, selectedGig, gigs, [])

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
    <MemoryEditActions
      editing={editing}
      hasPhoto={Boolean(imagePath)}
      removing={removing}
      uploading={crop.uploading}
      onRemovePhoto={removePhoto}
      onToggleEditing={toggleEditing}
    />
  ) : undefined

  return (
    <DashboardCard title={t($ => $.memory.title)} icon={CollectionsIcon} action={editAction}>
      <MemoryPhoto
        imagePath={imagePath}
        canEdit={canEdit}
        editing={editing}
        uploading={crop.uploading}
        linkedGig={linkedGig}
        locale={locale}
        onPickFile={() => inputRef.current?.click()}
      />

      {editing ? (
        <MemoryCaptionField caption={caption} schedule={schedule} flush={flush} />
      ) : (
        caption && (
          <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
            {caption}
          </Typography>
        )
      )}

      {editing ? (
        <MemoryGigPicker
          gigId={gigId}
          gigs={gigs}
          selectedGig={selectedGig}
          setSelectedGig={setSelectedGig}
          locale={locale}
          onSaved={onSaved}
        />
      ) : (
        // With an image the chip is overlaid on it; only the imageless read view
        // needs the chip here.
        !imagePath && linkedGig && <GigChip gig={linkedGig} locale={locale} />
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
