import PropTypes from 'prop-types'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { formatDuration, parseDuration } from '../../utils/formatDuration.js'
import { setlistItemShape } from '../../propTypes/shared.js'
import { itemDomId } from './ids.js'

function SongBody({ item }) {
  const meta = [
    item.tag,
    item.song_key,
    item.tempo ? `${item.tempo} BPM` : null,
    formatDuration(item.duration_seconds),
  ].filter(Boolean).join(' · ')
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
        {item.title || '(unknown song)'}
      </Typography>
      {meta && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {meta}
        </Typography>
      )}
    </Box>
  )
}
SongBody.propTypes = { item: setlistItemShape.isRequired }

function BreakBody({ item, onUpdate }) {
  const isPause = item.item_type === 'pause'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, minWidth: 0 }}>
      <Chip
        label={isPause ? 'Pause' : 'Break'}
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
        slotProps={{ htmlInput: { 'aria-label': 'duration', style: { textAlign: 'center' } } }}
      />
      <TextField
        size="small"
        variant="standard"
        placeholder="Label (optional)"
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
BreakBody.propTypes = {
  item: setlistItemShape.isRequired,
  onUpdate: PropTypes.func.isRequired,
}

export default function SetlistItemCard({ item, onDelete, onUpdate, dragOverlay = false, songOrder = null }) {
  const sortable = useSortable({ id: itemDomId(item.id) })
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
      <IconButton
        size="small"
        {...attributes}
        {...listeners}
        sx={{ cursor: 'grab', touchAction: 'none' }}
        aria-label="drag"
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      {isSong && songOrder !== null && (
        <Box
          aria-label={`song order ${songOrder}`}
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
      {isSong ? <SongBody item={item} /> : <BreakBody item={item} onUpdate={onUpdate} />}
      <Box sx={{ flexGrow: isSong ? 1 : 0 }} />
      <IconButton size="small" color="error" onClick={onDelete} aria-label="delete item">
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

SetlistItemCard.propTypes = {
  item: setlistItemShape.isRequired,
  onDelete: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
  dragOverlay: PropTypes.bool,
  songOrder: PropTypes.number,
}
