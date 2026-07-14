import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import AccountAutocomplete from '../journal/AccountAutocomplete.tsx'
import { reclassifyLedgerEntry } from '../../api/ledger.ts'
import { listAccounts } from '../../api/accounts.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import type { Account, Id, Journal, LedgerLine } from '../../types/entities.ts'

interface ReclassifyDialogProps {
  entryId: Id
  lines: LedgerLine[]
  onClose: () => void
  onCreated: (journal: Journal) => void
}

// Moves one complete posted ledger line to another account. Confirming posts a
// two-line journal immediately (reverse on the source account, same side on the
// destination — gross, no VAT split); there is deliberately no editable draft
// phase. The generated note stays editable until the user touches it.
export default function ReclassifyDialog({ entryId, lines, onClose, onCreated }: Readonly<ReclassifyDialogProps>) {
  const { t } = useTranslation(['ledger', 'common'])
  const [accounts, setAccounts] = useState<Account[]>([])
  // Lines already tied to a reclassification can't start another one; a later
  // correction must start from the destination line in the posted journal.
  const eligibleLines = useMemo(() => lines.filter((l) => !l.reclassification), [lines])
  const [sourceLineId, setSourceLineId] = useState<Id | ''>(eligibleLines.length === 1 ? eligibleLines[0].id ?? '' : '')
  const [destinationCode, setDestinationCode] = useState('')
  const [note, setNote] = useState('')
  const [noteDirty, setNoteDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Without accounts the destination picker is empty and submission stays
  // disabled, so a load failure must surface with a retry — never silently.
  const [accountsFailed, setAccountsFailed] = useState(false)
  const [accountsAttempt, setAccountsAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    listAccounts()
      .then((all) => { if (!cancelled) setAccounts((all || []).filter((a) => a.is_active)) })
      .catch(() => { if (!cancelled) setAccountsFailed(true) })
    return () => { cancelled = true }
  }, [accountsAttempt])

  function retryAccounts() {
    setAccountsFailed(false)
    setAccountsAttempt((n) => n + 1)
  }

  const sourceLine = eligibleLines.find((l) => l.id === sourceLineId) ?? null
  // The destination is any other active account — the source account itself is
  // not offered (the server rejects it too).
  const destinationOptions = useMemo(
    () => accounts.filter((a) => a.code !== sourceLine?.account_code),
    [accounts, sourceLine?.account_code],
  )

  // Keep the generated note in sync with the selection until the user edits it.
  const generatedNote = sourceLine && destinationCode
    ? t($ => $.detail.reclassifyDialog.defaultNote, {
      source: sourceLine.account_code, destination: destinationCode, id: entryId,
    })
    : ''
  const noteValue = noteDirty ? note : generatedNote

  function lineLabel(line: LedgerLine) {
    const isDebit = (line.debit_cents ?? 0) > 0
    const sideLabel = isDebit ? t($ => $.detail.lines.debit) : t($ => $.detail.lines.credit)
    const amount = formatEur(isDebit ? (line.debit_cents ?? 0) : (line.credit_cents ?? 0))
    return `${line.account_code} · ${line.account_name || '-'} — ${sideLabel} ${amount}`
  }

  async function create() {
    if (!sourceLine?.id || !destinationCode) return
    setBusy(true)
    setError(null)
    try {
      const journal = await reclassifyLedgerEntry(entryId, {
        source_line_id: sourceLine.id,
        destination_account_code: destinationCode,
        note: noteValue.trim() || null,
      })
      onCreated(journal)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t($ => $.detail.reclassifyDialog.title)}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t($ => $.detail.reclassifyDialog.body)}
        </DialogContentText>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {accountsFailed && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={(
              <Button size="small" onClick={retryAccounts}>
                {t($ => $.detail.reclassifyDialog.retry)}
              </Button>
            )}
          >
            {t($ => $.detail.reclassifyDialog.accountsError)}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="reclassify-source-label">{t($ => $.detail.reclassifyDialog.sourceLine)}</InputLabel>
            <Select
              labelId="reclassify-source-label"
              label={t($ => $.detail.reclassifyDialog.sourceLine)}
              value={sourceLineId}
              disabled={busy}
              onChange={(e) => setSourceLineId(e.target.value as Id | '')}
            >
              {eligibleLines.map((line) => (
                <MenuItem key={String(line.id)} value={line.id}>{lineLabel(line)}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <AccountAutocomplete
            value={destinationCode}
            accounts={destinationOptions}
            label={t($ => $.detail.reclassifyDialog.destination)}
            disabled={busy || !sourceLine}
            onChange={setDestinationCode}
          />

          <TextField
            fullWidth
            multiline
            minRows={2}
            size="small"
            label={t($ => $.detail.reclassifyDialog.note)}
            value={noteValue}
            disabled={busy}
            onChange={(e) => { setNoteDirty(true); setNote(e.target.value) }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
        <Button
          variant="contained"
          onClick={create}
          disabled={busy || !sourceLine || !destinationCode}
        >
          {t($ => $.detail.reclassifyDialog.create)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
