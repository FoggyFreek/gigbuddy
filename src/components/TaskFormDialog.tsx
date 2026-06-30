import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { listMembers } from '../api/bandMembers.ts'
import { createTask, updateTask, deleteTask } from '../api/tasks.ts'
import type { Id, Member, Task } from '../types/entities.ts'
import DateEntryField from './DateEntryField.tsx'

interface TaskFormDialogProps {
  open: boolean
  task?: Task | null // absent/null = create mode
  onClose: () => void
  onSaved: () => void
  onDeleted?: () => void
}

function toDateInputValue(val: string | null | undefined): string {
  if (!val) return ''
  return String(val).slice(0, 10)
}

export default function TaskFormDialog({ open, task, onClose, onSaved, onDeleted }: TaskFormDialogProps) {
  const { t } = useTranslation(['tasks', 'common'])
  const isEdit = task != null
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [saving, setSaving] = useState(false)

  // Reset form state whenever the dialog opens (create) or its task changes (edit).
  useEffect(() => {
    if (!open) return
    setTitle(task?.title ?? '')
    setDueDate(toDateInputValue(task?.due_date))
    setAssignedTo(task?.assigned_to != null ? String(task.assigned_to) : '')
    setSaving(false)
  }, [open, task])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listMembers().then((rows) => { if (!cancelled) setMembers(rows) }).catch(() => {})
    return () => { cancelled = true }
  }, [open])

  const canSave = title.trim().length > 0 && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    const base: Partial<Task> = {
      title: title.trim(),
      due_date: dueDate || null,
      assigned_to: assignedTo === '' ? null : (assignedTo as Id),
    }
    try {
      if (isEdit) {
        await updateTask(task.id!, base)
      } else {
        // Tasks created here are standalone; linking to a gig is done from the
        // gig's own "create task" flow.
        await createTask(base)
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!isEdit) return
    setSaving(true)
    try {
      await deleteTask(task.id!)
      onDeleted?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const gigDisplay = task?.event_description || t($ => $.dialog.noGig)

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? t($ => $.dialog.editTitle) : t($ => $.dialog.createTitle)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t($ => $.dialog.titleLabel)}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
            fullWidth
          />
          <DateEntryField
            label={t($ => $.dialog.dueDateLabel)}
            openPickerLabel={t($ => $.dialog.openDueDatePicker)}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            fullWidth
          />
          <TextField
            select
            label={t($ => $.dialog.assigneeLabel)}
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            fullWidth
          >
            <MenuItem value="">
              <Box component="span" sx={{ color: 'text.secondary' }}>{t($ => $.unassigned)}</Box>
            </MenuItem>
            {members.map((m) => (
              <MenuItem key={String(m.id)} value={String(m.id)}>{m.name}</MenuItem>
            ))}
          </TextField>
          {isEdit && task?.gig_id != null && (
            // A task linked via the gig's "create task" flow: shown read-only
            // (the link is fixed at creation; the Tasks page never sets it).
            <TextField
              label={t($ => $.dialog.gigLabel)}
              value={gigDisplay}
              disabled
              fullWidth
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        <Box>
          {isEdit && (
            <Button color="error" onClick={handleDelete} disabled={saving}>
              {t($ => $.actions.delete, { ns: 'common' })}
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={saving}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
          <Button variant="contained" onClick={handleSave} disabled={!canSave}>
            {t($ => $.actions.save, { ns: 'common' })}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
