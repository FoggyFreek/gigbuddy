import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DateEntryField from '../DateEntryField.tsx'
import { listMemberPurchases } from '../../api/reimbursements.ts'
import { formatEur } from '../../utils/purchaseTotals.ts'
import type { MemberOutstanding, Purchase, Id } from '../../types/entities.ts'

interface ReimbursementBody {
  band_member_id: Id | undefined
  purchase_ids: Id[]
  paid_on: string
  memo: string | null
}

interface RegisterReimbursementDialogProps {
  member: MemberOutstanding
  onSubmit: (body: ReimbursementBody) => Promise<void>
  onClose: () => void
}

// Registers a reimbursement that settles whole member-paid purchases. Loads the
// member's outstanding purchases, lets you deselect some (all selected by
// default), shows the resulting total, and posts on submit. Amount is derived
// from the selection — never free-entered — so it always matches the cleared
// liability.
export default function RegisterReimbursementDialog({ member, onSubmit, onClose }: Readonly<RegisterReimbursementDialogProps>) {
  const { t } = useTranslation(['reimbursements', 'common'])
  const [purchases, setPurchases] = useState<Purchase[] | null>(null)
  const [selected, setSelected] = useState<Set<Id>>(() => new Set())
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (member.band_member_id == null) return
    let active = true
    listMemberPurchases(member.band_member_id)
      .then((rows: Purchase[]) => {
        if (!active) return
        setPurchases(rows)
        setSelected(new Set(rows.map((p) => p.id!)))
      })
      .catch((e: Error) => active && setError(e.message))
    return () => { active = false }
  }, [member.band_member_id])

  const total = useMemo(() => {
    if (!purchases) return 0
    return purchases.reduce((sum, p) => (selected.has(p.id!) ? sum + (p.total_cents ?? 0) : sum), 0)
  }, [purchases, selected])

  function toggle(id: Id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canSubmit = selected.size > 0 && Boolean(paidOn) && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    try {
      setBusy(true)
      setError(null)
      await onSubmit({
        band_member_id: member.band_member_id,
        purchase_ids: [...selected],
        paid_on: paidOn,
        memo: memo.trim() || null,
      })
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t($ => $.dialog.title, { name: member.band_member_name })}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {purchases === null && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {purchases && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {t($ => $.dialog.purchasesToSettle)}
            </Typography>
            {purchases.map((p) => (
              <FormControlLabel
                key={String(p.id)}
                sx={{ display: 'flex', mr: 0, justifyContent: 'space-between' }}
                labelPlacement="start"
                control={<Checkbox checked={selected.has(p.id!)} onChange={() => toggle(p.id!)} />}
                label={
                  <Box>
                    <Typography variant="body2">#{p.receipt_number} · {p.supplier_name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {p.description || ''} · {formatEur(p.total_cents)}
                    </Typography>
                  </Box>
                }
              />
            ))}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mt: 1, mb: 2 }}>
              <Typography variant="subtitle2">{t($ => $.dialog.total)}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatEur(total)}</Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <DateEntryField
                label={t($ => $.dialog.paidOn)}
                size="small"
                fullWidth
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                sx={undefined}
              />
            </Box>
            <TextField
              label={t($ => $.dialog.memo)}
              size="small"
              fullWidth
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={handleSubmit}>
          {t($ => $.dialog.submit)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
