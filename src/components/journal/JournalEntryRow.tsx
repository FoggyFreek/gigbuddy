import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, Journal, Id } from '../../types/entities.ts'
import type { SaveStatus } from '../../hooks/useDebouncedSave.ts'
import type { JournalForm, JournalFormLine } from './journalFormHelpers.ts'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Typography from '@mui/material/Typography'
import DateEntryField from '../DateEntryField.tsx'
import StatusDot from '../StatusDot.tsx'
import JournalLineRow from './JournalLineRow.tsx'
import { buildJournalPayload, emptyLine, journalToForm, nextLineKey } from './journalFormHelpers.ts'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import { updateJournal } from '../../api/journal.ts'

const STATUS_COLOR: Record<string, string> = { draft: 'secondary', approved: 'success' }

interface JournalEntryRowProps {
  journal: Journal
  accounts?: Account[]
  selected?: boolean
  onToggleSelect: (id: Id, checked: boolean) => void
  registerFlush: (id: Id, fn: (() => void) | null) => void
  onSaveStatus: (id: Id, status: SaveStatus | null) => void
}

export default function JournalEntryRow({
  journal, accounts, selected, onToggleSelect, registerFlush, onSaveStatus,
}: JournalEntryRowProps) {
  const { t } = useTranslation('journal')
  const [form, setForm] = useState<JournalForm>(() => journalToForm(journal))
  const readOnly = form.status === 'approved'

  const save = useCallback((payload: Partial<Journal>) => updateJournal(journal.id!, payload), [journal.id])
  const { schedule, flush, status: saveStatus } = useDebouncedSave(save)

  // Resync from the server only when the entry's lifecycle state flips (e.g. a
  // reload after approve), never on every keystroke-driven parent re-render.
  const [prevStatus, setPrevStatus] = useState(journal.status)
  if (journal.status !== prevStatus) {
    setPrevStatus(journal.status)
    setForm(journalToForm(journal))
  }

  // Expose this row's pending-save flush to the page so "Approve all" can persist
  // edits before posting (useDebouncedSave does NOT flush on unmount).
  useEffect(() => {
    registerFlush(journal.id!, flush)
    return () => registerFlush(journal.id!, null)
  }, [journal.id, flush, registerFlush])

  // Report the save status upward; the page shows it in the toolbar so the
  // indicator never adds/removes height inside the entry list (no jitter).
  useEffect(() => {
    onSaveStatus(journal.id!, saveStatus)
    return () => onSaveStatus(journal.id!, null)
  }, [journal.id, saveStatus, onSaveStatus])

  const update = useCallback((next: JournalForm) => {
    setForm(next)
    if (next.status !== 'approved') schedule(buildJournalPayload(next))
  }, [schedule])

  const patchForm = (patch: Partial<JournalForm>) => update({ ...form, ...patch })
  const patchLine = (i: number, patch: Partial<JournalFormLine>) => update({
    ...form, lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)),
  })
  const addLine = () => update({ ...form, lines: [...form.lines, emptyLine(form.lines.length)] })
  const removeLine = (i: number) => update({ ...form, lines: form.lines.filter((_, j) => j !== i) })
  const duplicateLine = (i: number) => {
    const lines = [...form.lines]
    lines.splice(i + 1, 0, { ...form.lines[i], _key: nextLineKey() })
    update({ ...form, lines })
  }

  const lines = form.lines.length ? form.lines : [emptyLine(0)]
  const { status } = form
  const statusLabel = status ? t($ => $.status[status]) : undefined

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        py: 0.5,
        bgcolor: selected ? 'action.selected' : 'transparent',
      }}
    >
      {/* left block: selection, J + number, date, status — centred on the same
          40px band as the first line row so all four read at one height */}
      <Box sx={{ width: 300, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 40 }}>
        <Checkbox
          size="small"
          checked={selected}
          disabled={readOnly}
          onChange={(e) => onToggleSelect(journal.id!, e.target.checked)}
          slotProps={{ input: { 'aria-label': t($ => $.entry.selectAria, { number: form.entry_number }) } }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} color="text.secondary">J</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 20 }}>{form.entry_number}</Typography>
        </Box>
        <StatusDot color={STATUS_COLOR[form.status ?? ''] || 'default'} label={statusLabel} />
        <DateEntryField
          label={t($ => $.entry.date)}
          value={form.entry_date}
          disabled={readOnly}
          onChange={(e) => patchForm({ entry_date: e.target.value })}
          size="small"
          sx={{ ml: 1 }}
        />
      </Box>

      {/* right block: the lines + per-entry actions */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {lines.map((line, idx) => (
          <JournalLineRow
            key={line._key}
            line={line}
            idx={idx}
            accounts={accounts}
            readOnly={readOnly}
            canDelete={lines.length > 1}
            patchLine={patchLine}
            addLine={addLine}
            removeLine={removeLine}
            duplicateLine={duplicateLine}
          />
        ))}
      </Box>
    </Box>
  )
}
