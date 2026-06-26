import type { RefObject } from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SetlistItem } from '../../types/entities.ts'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Popover from '@mui/material/Popover'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import StickyNote2Icon from '@mui/icons-material/StickyNote2'
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined'
import { formatDuration, parseDuration } from '../../utils/formatDuration.ts'
import { itemDomId } from './ids.ts'

// A member's personal note on a song-in-set, edited in a popover anchored to the
// note icon. The icon fills in when a note exists. Saving happens on close (when
// the text changed), mirroring the on-blur save pattern used for break fields.
interface SongNoteButtonProps {
  note?: string
  onUpdateNote: (note: string) => void
}

function SongNoteButton({ note, onUpdateNote }: SongNoteButtonProps) {
  const { t } = useTranslation('setlists')
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const inputRef: RefObject<HTMLInputElement | null> = useRef(null)
  const hasNote = Boolean(note?.trim())

  function handleClose() {
    const value = inputRef.current?.value ?? ''
    if (value !== (note || '')) onUpdateNote(value)
    setAnchorEl(null)
  }

  return (
    <>
      <Tooltip title={t($ => $.item.myNote)}>
        <IconButton
          size="small"
          color={hasNote ? 'primary' : 'default'}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label={t($ => $.item.noteAria)}
        >
          {hasNote ? <StickyNote2Icon fontSize="small" /> : <StickyNote2OutlinedIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <TextField
          inputRef={inputRef}
          defaultValue={note || ''}
          multiline
          minRows={3}
          autoFocus
          placeholder={t($ => $.item.notePlaceholder)}
          sx={{ m: 1.5, width: 260 }}
          slotProps={{ htmlInput: { 'aria-label': t($ => $.item.noteTextAria), maxLength: 280 } }}
        />
      </Popover>
    </>
  )
}

interface SongBodyProps {
  item: SetlistItem
}

function SongBody({ item }: SongBodyProps) {
  const { t } = useTranslation('setlists')
  const meta = [
    item.tag,
    item.song_key,
    item.tempo ? t($ => $.item.bpm, { tempo: item.tempo }) : null,
    formatDuration(item.duration_seconds),
  ].filter(Boolean).join(' · ')
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
        {item.title || t($ => $.item.unknownSong)}
      </Typography>
      {meta && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {meta}
        </Typography>
      )}
    </Box>
  )
}

interface SetlistItemPatch {
  duration_seconds?: number
  label?: string | null
}

interface BreakBodyProps {
  item: SetlistItem
  onUpdate: (patch: SetlistItemPatch) => void
  editing?: boolean
}

function BreakBody({ item, onUpdate, editing = true }: BreakBodyProps) {
  const { t } = useTranslation('setlists')
  const isPause = item.item_type === 'pause'
  if (!editing) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, minWidth: 0 }}>
        <Chip
          label={isPause ? t($ => $.item.pause) : t($ => $.item.break)}
          size="small"
          color={isPause ? 'default' : 'secondary'}
        />
        <Typography variant="body2" color="text.secondary">
          {formatDuration(item.duration_seconds)}
        </Typography>
        {item.label && (
          <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {item.label}
          </Typography>
        )}
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, minWidth: 0 }}>
      <Chip
        label={isPause ? t($ => $.item.pause) : t($ => $.item.break)}
        size="small"
        color={isPause ? 'default' : 'secondary'}
      />
      <TextField
        size="small"
        variant="standard"
        defaultValue={formatDuration(item.duration_seconds)}
        onBlur={(e) => {
          const secs = parseDuration(e.target.value)
          if (secs !== null && secs !== item.duration_seconds) onUpdate({ duration_seconds: secs })
        }}
        sx={{ width: 70 }}
        slotProps={{ htmlInput: { 'aria-label': t($ => $.item.durationAria), style: { textAlign: 'center' } } }}
      />
      <TextField
        size="small"
        variant="standard"
        placeholder={t($ => $.item.labelPlaceholder)}
        defaultValue={item.label || ''}
        onBlur={(e) => {
          const label = e.target.value.trim()
          if (label !== (item.label || '')) onUpdate({ label: label || null })
        }}
        sx={{ flexGrow: 1, minWidth: 0 }}
      />
    </Box>
  )
}

interface SetlistItemCardProps {
  item: SetlistItem
  onDelete: () => void
  onUpdate: (patch: SetlistItemPatch) => void
  onUpdateNote?: (note: string) => void
  dragOverlay?: boolean
  songOrder?: number | null
  editing?: boolean
}

export default function SetlistItemCard({ item, onDelete, onUpdate, onUpdateNote = () => {}, dragOverlay = false, songOrder = null, editing = true }: SetlistItemCardProps) {
  const { t } = useTranslation('setlists')
  const sortable = useSortable({ id: itemDomId(item.id!), disabled: !editing })
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable
  const isSong = item.item_type === 'song'

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.75,
        mb: 0.75,
        borderRadius: 0.25,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        opacity: isDragging && !dragOverlay ? 0.4 : 1,
        boxShadow: dragOverlay ? 4 : 'none',
      }}
    >
      {editing && (
        <IconButton
          size="small"
          {...attributes}
          {...listeners}
          sx={{ cursor: 'grab', touchAction: 'none' }}
          aria-label={t($ => $.item.dragAria)}
        >
          <DragIndicatorIcon fontSize="small" />
        </IconButton>
      )}
      {isSong && songOrder !== null && (
        <Box
          aria-label={t($ => $.item.songOrderAria, { order: songOrder })}
          sx={{
            mx: 0.5,
            width: 24,
            height: 24,
            borderRadius: '50%',
            bgcolor: 'action.hover',
            color: 'text.secondary',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>
            {songOrder}
          </span>
        </Box>
      )}
      {isSong ? <SongBody item={item} /> : <BreakBody item={item} onUpdate={onUpdate} editing={editing} />}
      <Box sx={{ flexGrow: isSong ? 1 : 0 }} />
      {isSong && !dragOverlay && (
        <SongNoteButton note={item.my_note} onUpdateNote={onUpdateNote} />
      )}
      {editing && (
        <IconButton size="small" color="error" onClick={onDelete} aria-label={t($ => $.item.deleteAria)}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  )
}
