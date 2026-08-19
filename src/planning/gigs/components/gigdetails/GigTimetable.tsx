import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { TimeField } from '@mui/x-date-pickers/TimeField'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { useTranslation } from 'react-i18next'
import {
  addGigTimetableEntry,
  deleteGigTimetableEntry,
  reorderGigTimetable,
  updateGigTimetableEntry,
} from '../../gigs.ts'
import type { GigTimetableInput } from '../../gigs.ts'
import { dayjsToTimeString, timeStringToDayjs } from '../../../events/eventFormUtils.ts'
import useDebouncedSave from '../../../../hooks/useDebouncedSave.ts'
import { useDialog } from '../../../../contexts/dialogContext.ts'
import type { GigTimetableEntry, Id } from '../../../../types/entities.ts'

// The line is persisted the moment it is added rather than on first keystroke:
// every field is optional, so there is nothing to wait for, and a row that
// already has its id can be dragged into place straight away.
function isBlank(entry: GigTimetableEntry): boolean {
  return !entry.start_time && !entry.end_time && !entry.description.trim()
}

// The header and every row share one column track so the hairlines line up.
// A reader gets neither the drag handle nor the remove button, so the outer
// columns fall away with them.
function gridColumns(editable: boolean): string {
  return editable ? '40px 88px 88px minmax(0, 1fr) 44px' : '88px 88px minmax(0, 1fr)'
}

const cellSx = {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  borderRight: 1,
  borderColor: 'divider',
  '&:last-of-type': { borderRight: 0 },
} as const

const headCellSx = { ...cellSx, px: 1, py: 0.5 } as const

// The fields fill their cell edge to edge: no outline, no underline, no
// floating label — the grid's own hairlines are the only frame. With the label
// gone the name has to be set explicitly, and for a picker field that means the
// `input` slot: an aria-label on the field itself lands on the wrapper, not on
// the editable sections.
const fieldSx = {
  px: 1,
  '& .MuiInputBase-root': { py: 0.75 },
  '& input': { p: 0 },
} as const

interface Props {
  gigId: Id
  editable: boolean
  initialEntries: GigTimetableEntry[]
}

export default function GigTimetable({ gigId, editable, initialEntries }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const { confirmDelete } = useDialog()
  const [entries, setEntries] = useState<GigTimetableEntry[]>(initialEntries)
  const [error, setError] = useState<string | null>(null)

  // Saves and drags run long after the render that scheduled them, so they read
  // the rows from a ref rather than from `entries`.
  const entriesRef = useRef<GigTimetableEntry[]>(entries)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function mutate(updater: (prev: GigTimetableEntry[]) => GigTimetableEntry[]) {
    const next = updater(entriesRef.current)
    entriesRef.current = next
    setEntries(next)
  }

  const fail = useCallback((err: unknown) => {
    setError((err as Error).message || t($ => $.detail.timetable.saveFailed))
  }, [t])

  const handleSave = useCallback(async (entryId: Id, patch: GigTimetableInput) => {
    try {
      await updateGigTimetableEntry(gigId, entryId, patch)
      setError(null)
    } catch (err) {
      fail(err)
    }
  }, [gigId, fail])

  function handleFieldChange(entryId: Id, patch: Partial<GigTimetableEntry>) {
    mutate((prev) => prev.map((row) => (row.id === entryId ? { ...row, ...patch } : row)))
  }

  // A time is a discrete choice, so it commits as soon as it is made; only the
  // description debounces.
  function handleTimeChange(entryId: Id, field: 'start_time' | 'end_time', value: string) {
    const time = value || null
    handleFieldChange(entryId, { [field]: time })
    void handleSave(entryId, { [field]: time })
  }

  async function handleAdd() {
    try {
      const created = await addGigTimetableEntry(gigId)
      mutate((prev) => [...prev, created])
      setError(null)
    } catch (err) {
      fail(err)
    }
  }

  async function handleDelete(entry: GigTimetableEntry) {
    // Nothing to lose in an empty line the user just added by mistake.
    if (!isBlank(entry)) {
      const confirmed = await confirmDelete({
        title: t($ => $.detail.timetable.deleteTitle, {
          label: entry.description.trim() || t($ => $.detail.timetable.unnamedLine),
        }),
      })
      if (!confirmed) return
    }
    try {
      await deleteGigTimetableEntry(gigId, entry.id)
    } catch (err) {
      fail(err)
      return
    }
    mutate((prev) => prev.filter((row) => row.id !== entry.id))
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const previous = entriesRef.current
    const from = previous.findIndex((row) => String(row.id) === active.id)
    const to = previous.findIndex((row) => String(row.id) === over.id)
    if (from < 0 || to < 0) return

    const next = arrayMove(previous, from, to)
    mutate(() => next)
    try {
      await reorderGigTimetable(gigId, next.map((row) => row.id))
      setError(null)
    } catch (err) {
      // The server kept the old order, so the list goes back to it rather than
      // showing an order that only exists on screen.
      mutate(() => previous)
      fail(err)
    }
  }

  return (
    <Box>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0, mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* One outlined block with hairline-separated rows: the lines read as a
          schedule, not as a stack of individual form controls. The column
          captions carry the field names, so the inputs themselves are labelled
          for assistive technology only. */}
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: gridColumns(editable),
            bgcolor: 'action.hover',
          }}
        >
          {editable && <Box sx={headCellSx} />}
          <Box sx={headCellSx}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {t($ => $.detail.timetable.startTime)}
            </Typography>
          </Box>
          <Box sx={headCellSx}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {t($ => $.detail.timetable.endTime)}
            </Typography>
          </Box>
          <Box sx={headCellSx}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {t($ => $.detail.timetable.description)}
            </Typography>
          </Box>
          {editable && <Box sx={headCellSx} />}
        </Box>

        {entries.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary', px: 1, py: 1.25 }}>
            {t($ => $.detail.timetable.empty)}
          </Typography>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={entries.map((row) => String(row.id))} strategy={verticalListSortingStrategy}>
            {entries.map((entry) => (
              <TimetableRow
                key={entry.id}
                entry={entry}
                editable={editable}
                onFieldChange={handleFieldChange}
                onTimeChange={handleTimeChange}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            ))}
          </SortableContext>
        </DndContext>
      </Box>

      {editable && (
        <Box sx={{ mt: 2 }}>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleAdd}>
            {t($ => $.detail.timetable.add)}
          </Button>
        </Box>
      )}
    </Box>
  )
}

interface RowProps {
  entry: GigTimetableEntry
  editable: boolean
  onFieldChange: (entryId: Id, patch: Partial<GigTimetableEntry>) => void
  onTimeChange: (entryId: Id, field: 'start_time' | 'end_time', value: string) => void
  onSave: (entryId: Id, patch: GigTimetableInput) => Promise<void>
  onDelete: (entry: GigTimetableEntry) => void
}

// One line of the running order: drag handle, start, end, description, remove.
function TimetableRow({ entry, editable, onFieldChange, onTimeChange, onSave, onDelete }: Readonly<RowProps>) {
  const { t } = useTranslation('gigs')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(entry.id),
    disabled: !editable,
  })

  const saveFn = useCallback(
    async (patch: { description: string }) => { await onSave(entry.id, patch) },
    [onSave, entry.id],
  )
  const { schedule, flush } = useDebouncedSave<{ description: string }>(saveFn)

  // Closing the detail — or the modal around it — must not drop the last few
  // characters typed, so the pending save is flushed on the way out too.
  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush }, [flush])
  useEffect(() => () => { void flushRef.current() }, [])

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'grid',
        gridTemplateColumns: gridColumns(editable),
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {editable && (
        <Box sx={{ ...cellSx, justifyContent: 'center' }}>
          <IconButton
            size="small"
            {...attributes}
            {...listeners}
            sx={{ cursor: 'grab', touchAction: 'none' }}
            aria-label={t($ => $.detail.timetable.dragAria)}
          >
            <DragIndicatorIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
      <Box sx={cellSx}>
        <TimeField
          variant="standard"
          fullWidth
          ampm={false}
          format="HH:mm"
          readOnly={!editable}
          value={timeStringToDayjs(entry.start_time)}
          onChange={(value) => onTimeChange(entry.id, 'start_time', dayjsToTimeString(value))}
          sx={fieldSx}
          slotProps={{
            textField: {
              slotProps: {
                input: {
                  disableUnderline: true,
                  'aria-label': t($ => $.detail.timetable.startTime),
                },
              },
            },
          }}
        />
      </Box>
      <Box sx={cellSx}>
        <TimeField
          variant="standard"
          fullWidth
          ampm={false}
          format="HH:mm"
          readOnly={!editable}
          value={timeStringToDayjs(entry.end_time)}
          onChange={(value) => onTimeChange(entry.id, 'end_time', dayjsToTimeString(value))}
          sx={fieldSx}
          slotProps={{
            textField: {
              slotProps: {
                input: {
                  disableUnderline: true,
                  'aria-label': t($ => $.detail.timetable.endTime),
                },
              },
            },
          }}
        />
      </Box>
      <Box sx={cellSx}>
        <TextField
          variant="standard"
          fullWidth
          value={entry.description}
          onChange={(event) => {
            onFieldChange(entry.id, { description: event.target.value })
            schedule({ description: event.target.value })
          }}
          onBlur={() => { void flush() }}
          sx={fieldSx}
          slotProps={{
            input: { disableUnderline: true },
            htmlInput: { readOnly: !editable, 'aria-label': t($ => $.detail.timetable.description) },
          }}
        />
      </Box>
      {editable && (
        <Box sx={{ ...cellSx, justifyContent: 'center' }}>
          <Tooltip title={t($ => $.detail.timetable.remove)}>
            <IconButton size="small" color="primary" onClick={() => onDelete(entry)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  )
}
