import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import type { Member, Slot, Id } from '../types/entities.ts'
import DateEntryField from './DateEntryField.tsx'

interface AvailabilitySlotDialogProps {
  open: boolean
  slot?: Partial<Slot>
  members: Member[]
  onSave: (data: Partial<Slot>) => Promise<void>
  onDelete: (id: Id) => Promise<void>
  onClose: () => void
  /** User-owned calendar: the slot always belongs to the signed-in artist. */
  personal?: boolean
}

interface SlotForm {
  band_member_id: Id | null
  start_date: string
  end_date: string
  status: string
  reason: string
}

export default function AvailabilitySlotDialog({ open, slot, members, onSave, onDelete, onClose, personal = false }: Readonly<AvailabilitySlotDialogProps>) {
  const { t } = useTranslation(['availability', 'common'])
  const isEdit = !!slot?.id
  const [form, setForm] = useState<SlotForm>(() => slot ? {
    band_member_id: slot.band_member_id ?? null,
    start_date: slot.start_date ?? '',
    end_date: slot.end_date ?? '',
    status: slot.status ?? 'available',
    reason: slot.reason ?? '',
  } : {
    band_member_id: null,
    start_date: '',
    end_date: '',
    status: 'available',
    reason: '',
  })
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  function set(field: keyof SlotForm, value: SlotForm[keyof SlotForm]) {
    setForm((p) => ({ ...p, [field]: value }))
    setErrors((p) => ({ ...p, [field]: undefined }))
  }

  function validate() {
    const errs: Record<string, string> = {}
    if (!form.start_date) errs.start_date = t($ => $.slotDialog.required)
    if (!form.end_date) errs.end_date = t($ => $.slotDialog.required)
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      errs.end_date = t($ => $.slotDialog.endBeforeStart)
    }
    return errs
  }

  function handleSave() {
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSave({
      // Omitted for a user-owned slot; null means "whole band" only in band mode.
      ...(personal ? {} : { band_member_id: form.band_member_id ?? null }),
      start_date: form.start_date,
      end_date: form.end_date,
      status: form.status,
      reason: form.reason || null,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isEdit ? t($ => $.slotDialog.editTitle) : t($ => $.slotDialog.createTitle)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {!personal && (
            <TextField
              select
              label={t($ => $.slotDialog.member)}
              value={form.band_member_id === null ? '' : String(form.band_member_id)}
              onChange={(e) => set('band_member_id', e.target.value === '' ? null : Number(e.target.value))}
              fullWidth
              size="small"
            >
              <MenuItem value="">{t($ => $.slotDialog.wholeBand)}</MenuItem>
              {members.map((m) => (
                <MenuItem key={String(m.id)} value={String(m.id)}>{m.name}</MenuItem>
              ))}
            </TextField>
          )}

          <DateEntryField
            label={t($ => $.slotDialog.startDate)}
            value={form.start_date}
            onChange={(e) => set('start_date', e.target.value)}
            fullWidth
            size="small"
            error={!!errors.start_date}
            helperText={errors.start_date}
          />

          <DateEntryField
            label={t($ => $.slotDialog.endDate)}
            value={form.end_date}
            onChange={(e) => set('end_date', e.target.value)}
            fullWidth
            size="small"
            error={!!errors.end_date}
            helperText={errors.end_date}
          />

          <Stack spacing={0.5}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t($ => $.slotDialog.statusLabel)}</Typography>
            <ToggleButtonGroup
              exclusive
              value={form.status}
              onChange={(_e, val) => { if (val) set('status', val) }}
              size="small"
            >
              <ToggleButton value="available">{t($ => $.status.available)}</ToggleButton>
              <ToggleButton value="unavailable">{t($ => $.status.unavailable)}</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <TextField
            label={t($ => $.slotDialog.reason)}
            value={form.reason || ''}
            onChange={(e) => set('reason', e.target.value)}
            fullWidth
            size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {isEdit && (
          <Button color="error" onClick={() => onDelete(slot!.id!)} sx={{ mr: 'auto' }}>
            {t($ => $.common.actions.delete)}
          </Button>
        )}
        <Button onClick={onClose}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" onClick={handleSave}>
          {isEdit ? t($ => $.common.actions.save) : t($ => $.slotDialog.create)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
