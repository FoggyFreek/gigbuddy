import { useState } from 'react'
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

export default function AvailabilitySlotDialog({ open, slot, members, onSave, onDelete, onClose }) {
  const isEdit = !!slot?.id
  const [form, setForm] = useState(() => slot || {
    band_member_id: null,
    start_date: '',
    end_date: '',
    status: 'available',
    reason: '',
  })
  const [errors, setErrors] = useState({})

  function set(field, value) {
    setForm((p) => ({ ...p, [field]: value }))
    setErrors((p) => ({ ...p, [field]: undefined }))
  }

  function validate() {
    const errs = {}
    if (!form.start_date) errs.start_date = 'Required'
    if (!form.end_date) errs.end_date = 'Required'
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      errs.end_date = 'Must be on or after start date'
    }
    return errs
  }

  function handleSave() {
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSave({
      band_member_id: form.band_member_id ?? null,
      start_date: form.start_date,
      end_date: form.end_date,
      status: form.status,
      reason: form.reason || null,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isEdit ? 'Edit slot' : 'Add availability slot'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Member"
            value={form.band_member_id === null ? '' : String(form.band_member_id)}
            onChange={(e) => set('band_member_id', e.target.value === '' ? null : Number(e.target.value))}
            fullWidth
            size="small"
          >
            <MenuItem value="">Whole band</MenuItem>
            {members.map((m) => (
              <MenuItem key={m.id} value={String(m.id)}>{m.name}</MenuItem>
            ))}
          </TextField>

          <TextField
            label="Start date"
            type="date"
            value={form.start_date}
            onChange={(e) => set('start_date', e.target.value)}
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
            error={!!errors.start_date}
            helperText={errors.start_date}
          />

          <TextField
            label="End date"
            type="date"
            value={form.end_date}
            onChange={(e) => set('end_date', e.target.value)}
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
            error={!!errors.end_date}
            helperText={errors.end_date}
          />

          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">Status</Typography>
            <ToggleButtonGroup
              exclusive
              value={form.status}
              onChange={(_e, val) => { if (val) set('status', val) }}
              size="small"
            >
              <ToggleButton value="available">Available</ToggleButton>
              <ToggleButton value="unavailable">Unavailable</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <TextField
            label="Reason (optional)"
            value={form.reason || ''}
            onChange={(e) => set('reason', e.target.value)}
            fullWidth
            size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {isEdit && (
          <Button color="error" onClick={() => onDelete(slot.id)} sx={{ mr: 'auto' }}>
            Delete
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          {isEdit ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
