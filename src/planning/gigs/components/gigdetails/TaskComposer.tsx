import { useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Collapse from '@mui/material/Collapse'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import Stack from '@mui/material/Stack'
import AddIcon from '@mui/icons-material/Add'
import { TaskAssigneeControl, TaskDueControl } from './TaskMetaControls.tsx'
import type { Id, Member } from '../../../../types/entities.ts'

export interface TaskDraft {
  title: string
  due_date: string | null
  assigned_to: Id | null
}

interface Props {
  members?: Member[]
  onAdd: (draft: TaskDraft) => Promise<void> | void
}

// The add-task card: one line for the description, one for the optional due
// date and assignee. It mirrors the shape of a task card so the list reads as
// one column of cards.
export default function TaskComposer({ members = [], onAdd }: Readonly<Props>) {
  const { t } = useTranslation(['gigs', 'common'])
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [assignedTo, setAssignedTo] = useState<Id | null>(null)
  const [saving, setSaving] = useState(false)
  const [descriptionFocused, setDescriptionFocused] = useState(false)
  const [metaControlOpen, setMetaControlOpen] = useState(false)
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  const canSubmit = title.trim().length > 0 && !saving
  const expanded = descriptionFocused || metaControlOpen || title.length > 0 || dueDate !== null || assignedTo !== null

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      await onAdd({ title: title.trim(), due_date: dueDate, assigned_to: assignedTo })
      setTitle('')
      setDueDate(null)
      setAssignedTo(null)
      setMetaControlOpen(false)
      titleInputRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
    if (event.key === 'Escape') {
      setTitle('')
      setDueDate(null)
      setAssignedTo(null)
      setMetaControlOpen(false)
    }
  }

  return (
    <Card variant="outlined">
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, pl: 1, pr: 1.5, py: 0.5 }}>
        <IconButton
          aria-label={t($ => $.tasks.addTask)}
          color="primary"
          size="small"
          disabled={saving}
          onClick={() => titleInputRef.current?.focus()}
          sx={{ flexShrink: 0 }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
        <InputBase
          fullWidth
          value={title}
          disabled={saving}
          placeholder={t($ => $.tasks.addTask)}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={() => setDescriptionFocused(true)}
          onBlur={() => setDescriptionFocused(false)}
          onKeyDown={handleKeyDown}
          inputRef={titleInputRef}
          slotProps={{ input: { 'aria-label': t($ => $.tasks.taskLabel) } }}
          sx={{
            fontSize: (theme) => theme.typography.body2.fontSize,
            '& input::placeholder': { color: 'primary.main', opacity: 1 },
          }}
        />
      </Stack>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Divider />
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.25, px: 1, py: 0.5 }}>
          <TaskDueControl
            value={dueDate}
            label={t($ => $.tasks.setDueDate)}
            disabled={saving}
            onOpenChange={setMetaControlOpen}
            onChange={setDueDate}
          />
          <TaskAssigneeControl
            value={assignedTo}
            members={members}
            label={t($ => $.tasks.assign)}
            disabled={saving}
            onOpenChange={setMetaControlOpen}
            onChange={setAssignedTo}
          />
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="outlined"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {t($ => $.actions.add, { ns: 'common' })}
          </Button>
        </Stack>
      </Collapse>
    </Card>
  )
}
