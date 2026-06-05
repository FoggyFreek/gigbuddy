import PropTypes from 'prop-types'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import DeleteIcon from '@mui/icons-material/Delete'
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic'
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutlined'
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast'
import SetlistItemCard from './SetlistItemCard.jsx'
import SetlistTransition from './SetlistTransition.jsx'
import { formatDuration } from '../../utils/formatDuration.js'
import { setlistSetShape } from '../../propTypes/shared.js'
import { itemDomId, setDomId } from './ids.js'

function countSongsThrough(items, index) {
  return items.slice(0, index + 1).filter((item) => item.item_type === 'song').length
}

export default function SetlistSet({
  set,
  index,
  setCount,
  onRename,
  onToggleTotal,
  onDelete,
  onAddSong,
  onAddPause,
  onAddBreak,
  onMoveUp,
  onMoveDown,
  onDeleteItem,
  onUpdateItem,
  songOrderStart = 0,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: setDomId(set.id) })
  const itemIds = set.items.map((it) => itemDomId(it.id))
  const setSeconds = set.items.reduce((acc, it) => acc + (it.duration_seconds || 0), 0)

  return (
    <Box
      sx={{
        mb: 2,
        borderRadius: 0.5,
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
        }}
      >
        <TextField
          variant="standard"
          defaultValue={set.name}
          onBlur={(e) => {
            const name = e.target.value.trim()
            if (name && name !== set.name) onRename(name)
          }}
          slotProps={{
            input: { disableUnderline: true, sx: { color: 'inherit', fontWeight: 700 } },
            htmlInput: { 'aria-label': 'set name' },
          }}
          sx={{ flexGrow: 1 }}
        />
        <Typography variant="caption" sx={{ opacity: 0.9 }}>
          {formatDuration(setSeconds) || '0:00'}
        </Typography>
        <FormControlLabel
          sx={{ mr: 0, color: 'inherit' }}
          control={
            <Switch
              size="small"
              checked={!!set.include_in_total}
              onChange={(e) => onToggleTotal(e.target.checked)}
              color="default"
            />
          }
          label={<Typography variant="caption">In total</Typography>}
        />
        <Tooltip title="Move set up">
          <span>
            <IconButton size="small" color="inherit" disabled={index === 0} onClick={onMoveUp} aria-label="move set up">
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Move set down">
          <span>
            <IconButton size="small" color="inherit" disabled={index === setCount - 1} onClick={onMoveDown} aria-label="move set down">
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Delete set">
          <IconButton size="small" color="inherit" onClick={onDelete} aria-label="delete set">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box ref={setNodeRef} sx={{ p: 1.5, bgcolor: isOver ? 'action.hover' : 'background.default', minHeight: 56 }}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {set.items.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1, textAlign: 'center' }}>
              Empty — add songs, pauses or breaks, or drag items here.
            </Typography>
          )}
          {set.items.map((it, i) => {
            const next = set.items[i + 1]
            const canSegue = it.item_type === 'song' && next?.item_type === 'song'
            const itemSongOrder = it.item_type === 'song' ? songOrderStart + countSongsThrough(set.items, i) : null
            return (
              <Box key={it.id}>
                <SetlistItemCard
                  item={it}
                  songOrder={itemSongOrder}
                  onDelete={() => onDeleteItem(it.id)}
                  onUpdate={(patch) => onUpdateItem(it.id, patch)}
                />
                {canSegue && (
                  <SetlistTransition
                    linked={!!it.linked_to_next}
                    note={it.transition_note}
                    onUpdate={(patch) => onUpdateItem(it.id, patch)}
                  />
                )}
              </Box>
            )
          })}
        </SortableContext>

        <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          <Button size="small" startIcon={<LibraryMusicIcon />} onClick={onAddSong}>
            Add song
          </Button>
          <Button size="small" startIcon={<PauseCircleOutlineIcon />} onClick={onAddPause}>
            Add pause
          </Button>
          <Button size="small" startIcon={<FreeBreakfastIcon />} onClick={onAddBreak}>
            Add break
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

SetlistSet.propTypes = {
  set: setlistSetShape.isRequired,
  index: PropTypes.number.isRequired,
  setCount: PropTypes.number.isRequired,
  onRename: PropTypes.func.isRequired,
  onToggleTotal: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onAddSong: PropTypes.func.isRequired,
  onAddPause: PropTypes.func.isRequired,
  onAddBreak: PropTypes.func.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onDeleteItem: PropTypes.func.isRequired,
  onUpdateItem: PropTypes.func.isRequired,
  songOrderStart: PropTypes.number,
}
