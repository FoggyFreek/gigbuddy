import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { updateLedgerNote, type LedgerNoteUpdate } from '../../api/ledger.ts'
import type { Id } from '../../types/entities.ts'

interface LedgerNoteSectionProps {
  entryId: Id
  note: string | null
  noteUpdatedAt: string | null
  noteUpdatedByName: string | null
  canEdit: boolean
  onSaved: (update: LedgerNoteUpdate) => void
}

// Free-text note on a ledger transaction. Finance viewers read it; finance
// managers edit it with explicit Save/Cancel (no autosave — a ledger annotation
// should be deliberate). The latest editor + time show under the note.
export default function LedgerNoteSection({
  entryId, note, noteUpdatedAt, noteUpdatedByName, canEdit, onSaved,
}: Readonly<LedgerNoteSectionProps>) {
  const { t } = useTranslation(['ledger', 'common'])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit() {
    setDraft(note ?? '')
    setError(null)
    setEditing(true)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const update = await updateLedgerNote(entryId, draft.trim() || null)
      onSaved(update)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
          {t($ => $.detail.note.title)}
        </Typography>
        {canEdit && !editing && (
          <Button size="small" onClick={startEdit}>
            {t($ => $.actions.edit, { ns: 'common' })}
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      {editing ? (
        <>
          <TextField
            fullWidth
            multiline
            minRows={2}
            size="small"
            placeholder={t($ => $.detail.note.placeholder)}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
            <Button size="small" onClick={() => setEditing(false)} disabled={busy}>
              {t($ => $.actions.cancel, { ns: 'common' })}
            </Button>
            <Button size="small" variant="contained" onClick={save} disabled={busy}>
              {t($ => $.actions.save, { ns: 'common' })}
            </Button>
          </Box>
        </>
      ) : (
        <>
          {note ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{note}</Typography>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t($ => $.detail.note.empty)}
            </Typography>
          )}
          {noteUpdatedAt && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
              {t($ => $.detail.note.lastEdited, {
                name: noteUpdatedByName || '-',
                date: new Date(noteUpdatedAt).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }),
              })}
            </Typography>
          )}
        </>
      )}
    </Paper>
  )
}
