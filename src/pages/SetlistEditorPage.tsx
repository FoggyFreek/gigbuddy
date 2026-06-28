import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core'
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
} from '../api/setlists.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { useToast } from '../contexts/toastContext.ts'
import { formatDuration } from '../utils/formatDuration.ts'
import SaveStatusLabel from '../components/SaveStatusLabel.tsx'
import SongPickerDialog from '../components/SongPickerDialog.tsx'
import SetlistItemCard from '../components/setlist/SetlistItemCard.tsx'
import SetlistSetComponent from '../components/setlist/SetlistSet.tsx'
import SetlistPreviewModal from '../components/setlist/SetlistPreviewModal.tsx'
import { setDomId, parseDomId } from '../components/setlist/ids.ts'
import type { SetlistSet, SetlistItem, Song, Id } from '../types/entities.ts'

// Matches SetlistSet's local SetlistItemPatch (which allows null for nullable fields).
interface SetlistItemPatch {
  duration_seconds?: number
  label?: string | null
  linked_to_next?: boolean
  transition_note?: string | null
}

const PAUSE_DEFAULT_SECONDS = 60
const BREAK_DEFAULT_SECONDS = 600

// One indicator reflects every save on the page: the debounced name save plus
// the immediate set/item mutations. Saving wins, then error, then saved.
function combineStatus(a: string, b: string): string {
  if (a === 'saving' || b === 'saving') return 'saving'
  if (a === 'error' || b === 'error') return 'error'
  if (a === 'saved' || b === 'saved') return 'saved'
  return 'idle'
}

function computeTotal(sets: SetlistSet[]): number {
  return sets.reduce((total, s) => {
    if (!s.include_in_total) return total
    return total + (s.items ?? []).reduce((acc, it) => acc + (it.duration_seconds || 0), 0)
  }, 0)
}

// Reflect the server's authoritative segue auto-clear (reorder/delete return the
// ids whose links broke) by clearing those items' link state locally.
function applyClearedLinks(sets: SetlistSet[], ids: number[]): SetlistSet[] {
  if (!ids?.length) return sets
  const cleared = new Set(ids)
  return sets.map((s) => ({
    ...s,
    items: (s.items ?? []).map((it) =>
      cleared.has(Number(it.id)) ? { ...it, linked_to_next: false, transition_note: undefined } : it),
  }))
}

function getSongOrder(sets: SetlistSet[], itemId: number): number | null {
  let order = 0
  for (const s of sets) {
    for (const item of (s.items ?? [])) {
      if (item.item_type !== 'song') continue
      order += 1
      if (item.id === itemId) return order
    }
  }
  return null
}

function countSongsBeforeSet(sets: SetlistSet[], setIndex: number): number {
  return sets
    .slice(0, setIndex)
    .reduce((total, s) => total + (s.items ?? []).filter((it) => it.item_type === 'song').length, 0)
}

export default function SetlistEditorPage() {
  const { t } = useTranslation(['setlists', 'common'])
  const { id } = useParams()
  const setlistId = Number(id)
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const showToast = useToast()

  const [name, setName] = useState('')
  const [sets, setSets] = useState<SetlistSet[]>([])
  const [loading, setLoading] = useState(true)
  const [activeItem, setActiveItem] = useState<SetlistItem | null>(null)
  const [picker, setPicker] = useState<{ open: boolean; setId: number | null }>({ open: false, setId: null })
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

  const saveName = useCallback(async (patch: { name?: string }) => { await updateSetlist(setlistId, patch) }, [setlistId])
  const { schedule: scheduleName, flush: flushName, status: nameStatus } = useDebouncedSave(saveName)

  const reload = useCallback(() => {
    return getSetlist(setlistId).then((tree) => {
      const t = tree as { name?: string; sets?: SetlistSet[] }
      setName(t.name || '')
      setSets(t.sets || [])
    })
  }, [setlistId])

  // Wrap an immediate save: drive the saved indicator, and on failure surface a
  // toast and reload to discard the now-stale optimistic state.
  const runSave = useCallback(async (work: () => Promise<void>, errorMsg?: string) => {
    setOpStatus('saving')
    try {
      await work()
      setOpStatus('saved')
    } catch (err: unknown) {
      setOpStatus('error')
      showToast?.(errorMsg || (err instanceof Error ? err.message : null) || t($ => $.toast.generic))
      reload().catch(() => {})
    }
  }, [showToast, reload, t])

  // The debounced name save reports failure through its own status; mirror it as a toast.
  useEffect(() => {
    if (nameStatus === 'error') showToast?.(t($ => $.toast.saveName))
  }, [nameStatus, showToast, t])

  useEffect(() => {
    let cancelled = false
    getSetlist(setlistId)
      .then((tree) => {
        if (cancelled) return
        const t = tree as { name?: string; sets?: SetlistSet[] }
        setName(t.name || '')
        setSets(t.sets || [])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [setlistId])

  // ----- drag handlers -----

  function findContainer(domId: string | number): string | null {
    if (String(domId).startsWith('set:')) return String(domId)
    const numId = parseDomId(domId as string)
    const s = setsRef.current.find((st) => (st.items ?? []).some((it) => it.id === numId))
    return s ? setDomId(s.id!) : null
  }

  function handleDragStart(event: DragStartEvent) {
    const numId = parseDomId(String(event.active.id))
    for (const s of setsRef.current) {
      const found = (s.items ?? []).find((it) => it.id === numId)
      if (found) { setActiveItem(found); return }
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeC = findContainer(active.id as string)
    const overC = findContainer(over.id as string)
    if (!activeC || !overC || activeC === overC) return

    setSets((prev) => {
      const activeIdx = prev.findIndex((s) => setDomId(s.id!) === activeC)
      const overIdx = prev.findIndex((s) => setDomId(s.id!) === overC)
      if (activeIdx === -1 || overIdx === -1) return prev
      const activeNum = parseDomId(String(active.id))
      const moving = (prev[activeIdx].items ?? []).find((it) => it.id === activeNum)
      if (!moving) return prev

      const overItems = prev[overIdx].items ?? []
      let insertAt = overItems.length
      if (!String(over.id).startsWith('set:')) {
        const overNum = parseDomId(String(over.id))
        const oi = overItems.findIndex((it) => it.id === overNum)
        if (oi !== -1) insertAt = oi
      }

      const next = [...prev]
      next[activeIdx] = { ...prev[activeIdx], items: (prev[activeIdx].items ?? []).filter((it) => it.id !== activeNum) }
      const targetItems = [...(next[overIdx].items ?? [])]
      targetItems.splice(insertAt, 0, moving)
      next[overIdx] = { ...next[overIdx], items: targetItems }
      return next
    })
  }

  function persistOrder(nextSets: SetlistSet[]) {
    const order = nextSets.map((s) => ({ setId: s.id, itemIds: (s.items ?? []).map((it) => it.id) }))
    runSave(async () => {
      const res = await reorderItems(setlistId, order) as unknown as { clearedIds?: number[] } | null
      if (res?.clearedIds?.length) setSets((prev) => applyClearedLinks(prev, res.clearedIds!))
    }, t($ => $.toast.reorderItems))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveItem(null)
    if (!over) return
    const overC = findContainer(over.id as string)
    if (!overC) return

    // Compute from the live ref (handleDragOver may have already moved the item
    // across sets) rather than inside a setSets updater — the updater runs after
    // this function returns, so reading its result here would always be stale.
    const prev = setsRef.current
    const overIdx = prev.findIndex((s) => setDomId(s.id!) === overC)
    if (overIdx === -1) return
    const overItems = prev[overIdx].items ?? []
    const activeNum = parseDomId(String(active.id))
    const oldIndex = overItems.findIndex((it) => it.id === activeNum)
    if (oldIndex === -1) return
    let newIndex = overItems.length - 1
    if (!String(over.id).startsWith('set:')) {
      const overNum = parseDomId(String(over.id))
      const oi = overItems.findIndex((it) => it.id === overNum)
      if (oi !== -1) newIndex = oi
    }
    const next = [...prev]
    next[overIdx] = { ...prev[overIdx], items: arrayMove(overItems, oldIndex, newIndex) }
    setSets(next)
    persistOrder(next)
  }

  // ----- setlist + set + item operations -----

  function handleNameChange(value: string) {
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
    } catch (err: unknown) {
      showToast?.((err instanceof Error ? err.message : null) || t($ => $.toast.deleteSetlist))
    }
  }

  async function handleAddSet() {
    await runSave(async () => {
      const created = await addSet(setlistId, {}) as SetlistSet & { items?: SetlistItem[] }
      setSets((prev) => [...prev, { ...created, items: created.items || [] }])
    }, t($ => $.toast.addSet))
  }

  async function handleRenameSet(setId: number, newName: string) {
    setSets((prev) => prev.map((s) => (s.id === setId ? { ...s, name: newName } : s)))
    await runSave(async () => { await updateSet(setlistId, setId, { name: newName }) }, t($ => $.toast.renameSet))
  }

  async function handleToggleTotal(setId: number, value: boolean) {
    setSets((prev) => prev.map((s) => (s.id === setId ? { ...s, include_in_total: value } : s)))
    await runSave(async () => { await updateSet(setlistId, setId, { include_in_total: value }) }, t($ => $.toast.updateSet))
  }

  async function handleDeleteSet(setId: number) {
    setSets((prev) => prev.filter((s) => s.id !== setId))
    await runSave(() => deleteSet(setlistId, setId), t($ => $.toast.deleteSet))
  }

  async function handleMoveSet(index: number, dir: number) {
    const target = index + dir
    if (target < 0 || target >= sets.length) return
    const next = arrayMove(sets, index, target)
    setSets(next)
    await runSave(() => reorderSets(setlistId, next.map((s) => s.id!)), t($ => $.toast.reorderSets))
  }

  function appendItem(setId: number, item: SetlistItem) {
    setSets((prev) => prev.map((s) => (s.id === setId ? { ...s, items: [...(s.items ?? []), item] } : s)))
  }

  // Merge a partial update into a single item wherever it lives across the sets.
  function applyItemUpdate(itemId: number, partial: Partial<SetlistItem>) {
    const merge = (items: SetlistItem[]) => items.map((it) => (it.id === itemId ? { ...it, ...partial } : it))
    setSets((prev) => prev.map((s) => ({ ...s, items: merge(s.items ?? []) })))
  }

  async function handlePickSong(song: Song) {
    const setId = picker.setId
    setPicker({ open: false, setId: null })
    await runSave(async () => {
      const item = await addItem(setlistId, setId!, { item_type: 'song', song_id: song.id }) as SetlistItem
      appendItem(setId!, item)
    }, t($ => $.toast.addSong))
  }

  async function handleAddBreakLike(setId: number, itemType: string, durationSeconds: number) {
    await runSave(async () => {
      const item = await addItem(setlistId, setId, { item_type: itemType as 'song' | 'pause' | 'break', duration_seconds: durationSeconds }) as SetlistItem
      appendItem(setId, item)
    }, t($ => $.toast.addItem))
  }

  async function handleDeleteItem(itemId: Id) {
    const without = (items: SetlistItem[]) => items.filter((it) => it.id !== itemId)
    setSets((prev) => prev.map((s) => ({ ...s, items: without(s.items ?? []) })))
    await runSave(async () => {
      const res = await deleteItem(setlistId, itemId) as unknown as { clearedIds?: number[] } | null
      if (res?.clearedIds?.length) setSets((prev) => applyClearedLinks(prev, res.clearedIds!))
    }, t($ => $.toast.deleteItem))
  }

  async function handleUpdateItem(itemId: Id, patch: SetlistItemPatch) {
    await runSave(async () => {
      const updated = await updateItem(setlistId, itemId, patch as Partial<SetlistItem>) as SetlistItem
      applyItemUpdate(Number(itemId), updated)
    }, t($ => $.toast.saveChanges))
  }

  // Save the current member's personal note on a song. Trust the server's
  // canonical { my_note } (trimmed; null when cleared) over the raw typed value.
  async function handleUpdateNote(itemId: Id, note: string) {
    await runSave(async () => {
      const { my_note } = await saveItemNote(setlistId, itemId, note) as unknown as { my_note?: string }
      applyItemUpdate(Number(itemId), { my_note })
    }, t($ => $.toast.saveNote))
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
        <IconButton onClick={handleBack} aria-label={t($ => $.aria.back, { ns: 'common' })}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          {editing ? (
            <TextField
              variant="standard"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              slotProps={{ input: { sx: { fontSize: '1.5rem', fontWeight: 600 } }, htmlInput: { 'aria-label': t($ => $.editor.nameAria) } }}
              fullWidth
            />
          ) : (
            <Typography variant="h5" sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {name || t($ => $.editor.untitled)}
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <AccessTimeIcon fontSize="small" color="disabled" />
            <Typography variant="body2" color="text.secondary">
              {t($ => $.editor.total, { duration: formatDuration(total) || '0:00' })}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
              {canWritePlanning && (
                <Button
                  startIcon={editing ? <DoneIcon /> : <EditIcon />}
                  onClick={handleToggleEditing}
                  size="small"
                  variant={editing ? 'contained' : 'text'}
                >
                  {editing ? t($ => $.common.actions.done) : t($ => $.common.actions.edit)}
                </Button>
              )}
              <Button
                startIcon={<PlagiarismOutlinedIcon />}
                onClick={() => setPreviewOpen(true)}
                size="small"
              >
                {t($ => $.editor.preview)}
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
          <SetlistSetComponent
            key={String(s.id)}
            set={s}
            index={index}
            setCount={sets.length}
            editing={editing}
            songOrderStart={countSongsBeforeSet(sets, index)}
            onRename={(newName) => handleRenameSet(Number(s.id), newName)}
            onToggleTotal={(value) => handleToggleTotal(Number(s.id), value)}
            onDelete={() => handleDeleteSet(Number(s.id))}
            onAddSong={() => setPicker({ open: true, setId: Number(s.id) })}
            onAddPause={() => handleAddBreakLike(Number(s.id), 'pause', PAUSE_DEFAULT_SECONDS)}
            onAddBreak={() => handleAddBreakLike(Number(s.id), 'break', BREAK_DEFAULT_SECONDS)}
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
              songOrder={getSongOrder(sets, Number(activeItem.id))}
              onDelete={() => {}}
              onUpdate={() => {}}
              dragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {editing && (
        <Button startIcon={<AddIcon />} onClick={handleAddSet} sx={{ mt: 1 }}>
          {t($ => $.editor.addSet)}
        </Button>
      )}

      {editing && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => setConfirmingDelete(true)}>
            {t($ => $.editor.deleteSetlist)}
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
        <DialogTitle>{t($ => $.editor.deleteTitle)}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t($ => $.confirmation.cannotUndo, { ns: 'common' })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingDelete(false)}>{t($ => $.common.actions.cancel)}</Button>
          <Button color="error" variant="contained" onClick={handleDeleteSetlist}>{t($ => $.common.actions.delete)}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
