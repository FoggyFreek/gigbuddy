import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import DeleteIcon from '@mui/icons-material/Delete'
import DoneIcon from '@mui/icons-material/Done'
import EditIcon from '@mui/icons-material/Edit'
import PlagiarismOutlinedIcon from '@mui/icons-material/PlagiarismOutlined'
import {
  addItem,
  addSet,
  deleteItem,
  deleteSet,
  deleteSetlist,
  getSetlist,
  reorderItems,
  reorderSets,
  saveItemNote,
  updateItem,
  updateSet,
  updateSetlist,
} from '../api/setlists.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { useToast } from '../contexts/toastContext.js'
import { formatDuration } from '../utils/formatDuration.js'
import SaveStatusLabel from '../components/SaveStatusLabel.jsx'
import SongPickerDialog from '../components/SongPickerDialog.jsx'
import SetlistItemCard from '../components/setlist/SetlistItemCard.jsx'
import SetlistSet from '../components/setlist/SetlistSet.jsx'
import SetlistPreviewModal from '../components/setlist/SetlistPreviewModal.jsx'
import { setDomId, parseDomId } from '../components/setlist/ids.js'

const PAUSE_DEFAULT_SECONDS = 60
const BREAK_DEFAULT_SECONDS = 600

// One indicator reflects every save on the page: the debounced name save plus
// the immediate set/item mutations. Saving wins, then error, then saved.
function combineStatus(a, b) {
  if (a === 'saving' || b === 'saving') return 'saving'
  if (a === 'error' || b === 'error') return 'error'
  if (a === 'saved' || b === 'saved') return 'saved'
  return 'idle'
}

function computeTotal(sets) {
  return sets.reduce((total, s) => {
    if (!s.include_in_total) return total
    return total + s.items.reduce((acc, it) => acc + (it.duration_seconds || 0), 0)
  }, 0)
}

// Reflect the server's authoritative segue auto-clear (reorder/delete return the
// ids whose links broke) by clearing those items' link state locally.
function applyClearedLinks(sets, ids) {
  if (!ids?.length) return sets
  const cleared = new Set(ids)
  return sets.map((s) => ({
    ...s,
    items: s.items.map((it) =>
      cleared.has(it.id) ? { ...it, linked_to_next: false, transition_note: null } : it),
  }))
}

function getSongOrder(sets, itemId) {
  let order = 0
  for (const s of sets) {
    for (const item of s.items) {
      if (item.item_type !== 'song') continue
      order += 1
      if (item.id === itemId) return order
    }
  }
  return null
}

function countSongsBeforeSet(sets, setIndex) {
  return sets
    .slice(0, setIndex)
    .reduce((total, s) => total + s.items.filter((it) => it.item_type === 'song').length, 0)
}

export default function SetlistEditorPage() {
  const { id } = useParams()
  const setlistId = Number(id)
  const navigate = useNavigate()
  const showToast = useToast()

  const [name, setName] = useState('')
  const [sets, setSets] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeItem, setActiveItem] = useState(null)
  const [picker, setPicker] = useState({ open: false, setId: null })
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [editing, setEditing] = useState(false) // read-only by default; the Edit toggle enables it
  const [opStatus, setOpStatus] = useState('idle') // status for the immediate (non-debounced) saves

  // Latest sets, for drag handlers that need current state without stale closures.
  const setsRef = useRef(sets)
  useEffect(() => { setsRef.current = sets }, [sets])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const saveName = useCallback(async (patch) => { await updateSetlist(setlistId, patch) }, [setlistId])
  const { schedule: scheduleName, flush: flushName, status: nameStatus } = useDebouncedSave(saveName)

  const reload = useCallback(() => {
    return getSetlist(setlistId).then((tree) => {
      setName(tree.name || '')
      setSets(tree.sets || [])
    })
  }, [setlistId])

  // Wrap an immediate save: drive the saved indicator, and on failure surface a
  // toast and reload to discard the now-stale optimistic state.
  const runSave = useCallback(async (work, errorMsg) => {
    setOpStatus('saving')
    try {
      await work()
      setOpStatus('saved')
    } catch (err) {
      setOpStatus('error')
      showToast?.(errorMsg || err?.message || 'Something went wrong')
      reload().catch(() => {})
    }
  }, [showToast, reload])

  // The debounced name save reports failure through its own status; mirror it as a toast.
  useEffect(() => {
    if (nameStatus === 'error') showToast?.('Failed to save the setlist name')
  }, [nameStatus, showToast])

  useEffect(() => {
    let cancelled = false
    getSetlist(setlistId)
      .then((tree) => {
        if (cancelled) return
        setName(tree.name || '')
        setSets(tree.sets || [])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [setlistId])

  // ----- drag handlers -----

  function findContainer(domId) {
    if (String(domId).startsWith('set:')) return domId
    const numId = parseDomId(domId)
    const s = setsRef.current.find((st) => st.items.some((it) => it.id === numId))
    return s ? setDomId(s.id) : null
  }

  function handleDragStart(event) {
    const numId = parseDomId(event.active.id)
    for (const s of setsRef.current) {
      const found = s.items.find((it) => it.id === numId)
      if (found) { setActiveItem(found); return }
    }
  }

  function handleDragOver(event) {
    const { active, over } = event
    if (!over) return
    const activeC = findContainer(active.id)
    const overC = findContainer(over.id)
    if (!activeC || !overC || activeC === overC) return

    setSets((prev) => {
      const activeIdx = prev.findIndex((s) => setDomId(s.id) === activeC)
      const overIdx = prev.findIndex((s) => setDomId(s.id) === overC)
      if (activeIdx === -1 || overIdx === -1) return prev
      const activeNum = parseDomId(active.id)
      const moving = prev[activeIdx].items.find((it) => it.id === activeNum)
      if (!moving) return prev

      const overItems = prev[overIdx].items
      let insertAt = overItems.length
      if (!String(over.id).startsWith('set:')) {
        const overNum = parseDomId(over.id)
        const oi = overItems.findIndex((it) => it.id === overNum)
        if (oi !== -1) insertAt = oi
      }

      const next = [...prev]
      next[activeIdx] = { ...prev[activeIdx], items: prev[activeIdx].items.filter((it) => it.id !== activeNum) }
      const targetItems = [...next[overIdx].items]
      targetItems.splice(insertAt, 0, moving)
      next[overIdx] = { ...next[overIdx], items: targetItems }
      return next
    })
  }

  function persistOrder(nextSets) {
    const order = nextSets.map((s) => ({ setId: s.id, itemIds: s.items.map((it) => it.id) }))
    runSave(async () => {
      const res = await reorderItems(setlistId, order)
      if (res?.clearedIds?.length) setSets((prev) => applyClearedLinks(prev, res.clearedIds))
    }, 'Failed to reorder items')
  }

  function handleDragEnd(event) {
    const { active, over } = event
    setActiveItem(null)
    if (!over) return
    const overC = findContainer(over.id)
    if (!overC) return

    // Compute from the live ref (handleDragOver may have already moved the item
    // across sets) rather than inside a setSets updater — the updater runs after
    // this function returns, so reading its result here would always be stale.
    const prev = setsRef.current
    const overIdx = prev.findIndex((s) => setDomId(s.id) === overC)
    if (overIdx === -1) return
    const overItems = prev[overIdx].items
    const activeNum = parseDomId(active.id)
    const oldIndex = overItems.findIndex((it) => it.id === activeNum)
    if (oldIndex === -1) return
    let newIndex = overItems.length - 1
    if (!String(over.id).startsWith('set:')) {
      const overNum = parseDomId(over.id)
      const oi = overItems.findIndex((it) => it.id === overNum)
      if (oi !== -1) newIndex = oi
    }
    const next = [...prev]
    next[overIdx] = { ...prev[overIdx], items: arrayMove(overItems, oldIndex, newIndex) }
    setSets(next)
    persistOrder(next)
  }

  // ----- setlist + set + item operations -----

  function handleNameChange(value) {
    setName(value)
    if (value.trim()) scheduleName({ name: value.trim() })
  }

  async function handleBack() {
    await flushName()
    navigate('/setlists')
  }

  async function handleToggleEditing() {
    if (editing) await flushName() // persist a pending name edit before showing the clean view
    setEditing((prev) => !prev)
  }

  async function handleDeleteSetlist() {
    try {
      await deleteSetlist(setlistId)
      navigate('/setlists')
    } catch (err) {
      showToast?.(err?.message || 'Failed to delete the setlist')
    }
  }

  async function handleAddSet() {
    await runSave(async () => {
      const created = await addSet(setlistId, {})
      setSets((prev) => [...prev, { ...created, items: created.items || [] }])
    }, 'Failed to add set')
  }

  async function handleRenameSet(setId, newName) {
    setSets((prev) => prev.map((s) => (s.id === setId ? { ...s, name: newName } : s)))
    await runSave(() => updateSet(setlistId, setId, { name: newName }), 'Failed to rename set')
  }

  async function handleToggleTotal(setId, value) {
    setSets((prev) => prev.map((s) => (s.id === setId ? { ...s, include_in_total: value } : s)))
    await runSave(() => updateSet(setlistId, setId, { include_in_total: value }), 'Failed to update set')
  }

  async function handleDeleteSet(setId) {
    setSets((prev) => prev.filter((s) => s.id !== setId))
    await runSave(() => deleteSet(setlistId, setId), 'Failed to delete set')
  }

  async function handleMoveSet(index, dir) {
    const target = index + dir
    if (target < 0 || target >= sets.length) return
    const next = arrayMove(sets, index, target)
    setSets(next)
    await runSave(() => reorderSets(setlistId, next.map((s) => s.id)), 'Failed to reorder sets')
  }

  function appendItem(setId, item) {
    setSets((prev) => prev.map((s) => (s.id === setId ? { ...s, items: [...s.items, item] } : s)))
  }

  // Merge a partial update into a single item wherever it lives across the sets.
  function applyItemUpdate(itemId, partial) {
    const merge = (items) => items.map((it) => (it.id === itemId ? { ...it, ...partial } : it))
    setSets((prev) => prev.map((s) => ({ ...s, items: merge(s.items) })))
  }

  async function handlePickSong(song) {
    const setId = picker.setId
    setPicker({ open: false, setId: null })
    await runSave(async () => {
      const item = await addItem(setlistId, setId, { item_type: 'song', song_id: song.id })
      appendItem(setId, item)
    }, 'Failed to add song')
  }

  async function handleAddBreakLike(setId, itemType, durationSeconds) {
    await runSave(async () => {
      const item = await addItem(setlistId, setId, { item_type: itemType, duration_seconds: durationSeconds })
      appendItem(setId, item)
    }, 'Failed to add item')
  }

  async function handleDeleteItem(itemId) {
    const without = (items) => items.filter((it) => it.id !== itemId)
    setSets((prev) => prev.map((s) => ({ ...s, items: without(s.items) })))
    await runSave(async () => {
      const res = await deleteItem(setlistId, itemId)
      if (res?.clearedIds?.length) setSets((prev) => applyClearedLinks(prev, res.clearedIds))
    }, 'Failed to delete item')
  }

  async function handleUpdateItem(itemId, patch) {
    await runSave(async () => {
      const updated = await updateItem(setlistId, itemId, patch)
      applyItemUpdate(itemId, updated)
    }, 'Failed to save changes')
  }

  // Save the current member's personal note on a song. Trust the server's
  // canonical { my_note } (trimmed; null when cleared) over the raw typed value.
  async function handleUpdateNote(itemId, note) {
    await runSave(async () => {
      const { my_note } = await saveItemNote(setlistId, itemId, note)
      applyItemUpdate(itemId, { my_note })
    }, 'Failed to save note')
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const total = computeTotal(sets)

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <IconButton onClick={handleBack} aria-label="back">
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          {editing ? (
            <TextField
              variant="standard"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              slotProps={{ input: { sx: { fontSize: '1.5rem', fontWeight: 600 } }, htmlInput: { 'aria-label': 'setlist name' } }}
              fullWidth
            />
          ) : (
            <Typography variant="h5" sx={{ fontWeight: 600 }} noWrap>
              {name || 'Untitled setlist'}
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <AccessTimeIcon fontSize="small" color="disabled" />
            <Typography variant="body2" color="text.secondary">
              Total {formatDuration(total) || '0:00'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
              <Button
                startIcon={editing ? <DoneIcon /> : <EditIcon />}
                onClick={handleToggleEditing}
                size="small"
                variant={editing ? 'contained' : 'text'}
              >
                {editing ? 'Done' : 'Edit'}
              </Button>
              <Button
                startIcon={<PlagiarismOutlinedIcon />}
                onClick={() => setPreviewOpen(true)}
                size="small"
              >
                Preview
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>
      <Box sx={{ mb: 2, minHeight: 20 }}>
        {editing && <SaveStatusLabel status={combineStatus(nameStatus, opStatus)} />}
      </Box>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveItem(null)}
      >
        {sets.map((s, index) => (
          <SetlistSet
            key={s.id}
            set={s}
            index={index}
            setCount={sets.length}
            editing={editing}
            songOrderStart={countSongsBeforeSet(sets, index)}
            onRename={(newName) => handleRenameSet(s.id, newName)}
            onToggleTotal={(value) => handleToggleTotal(s.id, value)}
            onDelete={() => handleDeleteSet(s.id)}
            onAddSong={() => setPicker({ open: true, setId: s.id })}
            onAddPause={() => handleAddBreakLike(s.id, 'pause', PAUSE_DEFAULT_SECONDS)}
            onAddBreak={() => handleAddBreakLike(s.id, 'break', BREAK_DEFAULT_SECONDS)}
            onMoveUp={() => handleMoveSet(index, -1)}
            onMoveDown={() => handleMoveSet(index, 1)}
            onDeleteItem={handleDeleteItem}
            onUpdateItem={handleUpdateItem}
            onUpdateNote={handleUpdateNote}
          />
        ))}

        <DragOverlay>
          {activeItem ? (
            <SetlistItemCard
              item={activeItem}
              songOrder={getSongOrder(sets, activeItem.id)}
              onDelete={() => {}}
              onUpdate={() => {}}
              dragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {editing && (
        <Button startIcon={<AddIcon />} onClick={handleAddSet} sx={{ mt: 1 }}>
          Add set
        </Button>
      )}

      {editing && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => setConfirmingDelete(true)}>
            Delete setlist
          </Button>
        </Box>
      )}

      <SongPickerDialog
        key={picker.open ? `picker-${picker.setId}` : 'picker-closed'}
        open={picker.open}
        onClose={() => setPicker({ open: false, setId: null })}
        onSelect={handlePickSong}
      />

      <SetlistPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        setlistName={name}
        sets={sets}
      />

      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)}>
        <DialogTitle>Delete setlist?</DialogTitle>
        <DialogContent>
          <DialogContentText>This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteSetlist}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
