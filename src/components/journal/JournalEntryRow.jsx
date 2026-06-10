import { useCallback, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Typography from '@mui/material/Typography'
import DateEntryField from '../DateEntryField.jsx'
import StatusDot from '../StatusDot.jsx'
import JournalLineRow from './JournalLineRow.jsx'
import { buildJournalPayload, emptyLine, journalToForm } from './journalFormHelpers.js'
import useDebouncedSave from '../../hooks/useDebouncedSave.js'
import { updateJournal } from '../../api/journal.js'
import { accountShape, journalShape } from '../../propTypes/shared.js'

const STATUS_COLOR = { draft: 'secondary', approved: 'success' }

export default function JournalEntryRow({
  journal, accounts, selected, onToggleSelect, registerFlush,
}) {
  const [form, setForm] = useState(() => journalToForm(journal))
  const readOnly = form.status === 'approved'

  const save = useCallback((payload) => updateJournal(journal.id, payload), [journal.id])
  const { schedule, flush, status: saveStatus } = useDebouncedSave(save)

  // Resync from the server only when the entry's lifecycle state flips (e.g. a
  // reload after approve), never on every keystroke-driven parent re-render.
  // React's "store info from previous render" pattern — a guarded setState during
  // render, not an effect (avoids the cascading-render effect anti-pattern).
  const [prevStatus, setPrevStatus] = useState(journal.status)
  if (journal.status !== prevStatus) {
    setPrevStatus(journal.status)
    setForm(journalToForm(journal))
  }

  // Expose this row's pending-save flush to the page so "Approve all" can persist
  // edits before posting (useDebouncedSave does NOT flush on unmount).
  useEffect(() => {
    registerFlush(journal.id, flush)
    return () => registerFlush(journal.id, null)
  }, [journal.id, flush, registerFlush])

  const update = useCallback((next) => {
    setForm(next)
    if (next.status !== 'approved') schedule(buildJournalPayload(next))
  }, [schedule])

  const patchForm = (patch) => update({ ...form, ...patch })
  const patchLine = (i, patch) => update({
    ...form, lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)),
  })
  const addLine = () => update({ ...form, lines: [...form.lines, emptyLine(form.lines.length)] })
  const removeLine = (i) => update({ ...form, lines: form.lines.filter((_, j) => j !== i) })
  const duplicateLine = (i) => {
    const lines = [...form.lines]
    lines.splice(i + 1, 0, { ...form.lines[i] })
    update({ ...form, lines })
  }

  const lines = form.lines.length ? form.lines : [emptyLine(0)]

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        py: 1.5,
        bgcolor: selected ? 'action.selected' : 'transparent',
      }}
    >
      {/* left block: selection, J + number, date, status — centred on the same
          40px band as the first line row so all four read at one height */}
      <Box sx={{ width: 260, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 40 }}>
        <Checkbox
          size="small"
          checked={selected}
          disabled={readOnly}
          onChange={(e) => onToggleSelect(journal.id, e.target.checked)}
          slotProps={{ input: { 'aria-label': `select journal ${form.entry_number}` } }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2" fontWeight={700} color="text.secondary">J</Typography>
          <Typography variant="body2" fontWeight={700} sx={{ minWidth: 20 }}>{form.entry_number}</Typography>
        </Box>
        <DateEntryField
          label="Date"
          value={form.entry_date}
          disabled={readOnly}
          onChange={(e) => patchForm({ entry_date: e.target.value })}
          size="small"
          sx={{ width: 150 }}
        />
        <StatusDot color={STATUS_COLOR[form.status] || 'default'} label={form.status} />
      </Box>

      {/* right block: the lines + per-entry actions */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {lines.map((line, idx) => (
          <JournalLineRow
            key={idx}
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
        {!readOnly && (saveStatus === 'saving' || saveStatus === 'error') && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
            {saveStatus === 'saving' && <Typography variant="caption" color="text.secondary">Saving…</Typography>}
            {saveStatus === 'error' && <Typography variant="caption" color="error">Save failed</Typography>}
          </Box>
        )}
      </Box>
    </Box>
  )
}

JournalEntryRow.propTypes = {
  journal: journalShape.isRequired,
  accounts: PropTypes.arrayOf(accountShape),
  selected: PropTypes.bool,
  onToggleSelect: PropTypes.func.isRequired,
  registerFlush: PropTypes.func.isRequired,
}
