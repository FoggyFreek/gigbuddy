import type { SetlistSet as SetlistSetType, SetlistItem } from '../../types/entities.ts'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import DeleteIcon from '@mui/icons-material/Delete'
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast'
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic'
import MoreTimeIcon from '@mui/icons-material/MoreTime'
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutlined'
import SetlistItemCard from './SetlistItemCard.tsx'
import SetlistTransition from './SetlistTransition.tsx'
import { formatDuration } from '../../utils/formatDuration.ts'
import { itemDomId, setDomId } from './ids.ts'
import type { Id } from '../../types/entities.ts'

interface SetlistItemPatch {
  duration_seconds?: number
  label?: string | null
  linked_to_next?: boolean
  transition_note?: string | null
}

function countSongsThrough(items: SetlistItem[], index: number): number {
  return items.slice(0, index + 1).filter((item) => item.item_type === 'song').length
}

interface SetlistSetProps {
  set: SetlistSetType
  index: number
  setCount: number
  onRename: (name: string) => void
  onToggleTotal: (value: boolean) => void
  onDelete: () => void
  onAddSong: () => void
  onAddPause: () => void
  onAddBreak: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDeleteItem: (id: Id) => void
  onUpdateItem: (id: Id, patch: SetlistItemPatch) => void
  onUpdateNote: (id: Id, note: string) => void
  editing?: boolean
  songOrderStart?: number
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
  onUpdateNote,
  editing = true,
  songOrderStart = 0,
}: SetlistSetProps) {
  const { setNodeRef, isOver } = useDroppable({ id: setDomId(set.id!) })
  const itemIds = (set.items ?? []).map((it) => itemDomId(it.id!))
  const setSeconds = (set.items ?? []).reduce((acc, it) => acc + (it.duration_seconds || 0), 0)

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
        {editing ? (
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
        ) : (
          <Typography sx={{ flexGrow: 1, fontWeight: 700 }} noWrap>
            {set.name}
          </Typography>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mx: 1, opacity: 0.9 }}>
          <AccessTimeIcon fontSize="small" />
          <Typography variant="caption">{formatDuration(setSeconds) || '0:00'}</Typography>
        </Box>
        {editing && (
          <>
            <Tooltip title="Include in total time">
              <IconButton
                size="small"
                color="inherit"
                onClick={() => onToggleTotal(!set.include_in_total)}
                aria-label="include in total time"
                sx={{ mx: 1, opacity: set.include_in_total ? 0.9 : 0.3 }}
              >
                <MoreTimeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
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
          </>
        )}
      </Box>

      <Box ref={setNodeRef} sx={{ p: 1.5, bgcolor: isOver ? 'action.hover' : 'background.default', minHeight: 56 }}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {(set.items ?? []).length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1, textAlign: 'center' }}>
              {editing ? 'Empty — add songs, pauses or breaks, or drag items here.' : 'Empty'}
            </Typography>
          )}
          {(set.items ?? []).map((it, i) => {
            const next = (set.items ?? [])[i + 1]
            const canSegue = it.item_type === 'song' && next?.item_type === 'song'
            const itemSongOrder = it.item_type === 'song' ? songOrderStart + countSongsThrough(set.items ?? [], i) : null
            return (
              <Box key={String(it.id)}>
                <SetlistItemCard
                  item={it}
                  songOrder={itemSongOrder}
                  editing={editing}
                  onDelete={() => onDeleteItem(it.id!)}
                  onUpdate={(patch) => onUpdateItem(it.id!, patch)}
                  onUpdateNote={(note) => onUpdateNote(it.id!, note)}
                />
                {canSegue && (
                  <SetlistTransition
                    linked={!!it.linked_to_next}
                    note={it.transition_note}
                    editing={editing}
                    onUpdate={(patch) => onUpdateItem(it.id!, patch)}
                  />
                )}
              </Box>
            )
          })}
        </SortableContext>

        {editing && (
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
        )}
      </Box>
    </Box>
  )
}
