import type { Dispatch, SetStateAction } from 'react'
import type { ProfileForm } from './profileForm.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Grid from '@mui/material/Grid'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import EditIcon from '@mui/icons-material/Edit'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

interface FinancialsEditFormProps {
  form: ProfileForm
  onChange: (field: keyof ProfileForm, value: unknown) => void
  onFormChange: Dispatch<SetStateAction<ProfileForm>>
  schedule: (patch: Partial<ProfileForm>) => void
}

function FinancialsEditForm({ form, onChange, onFormChange, schedule }: FinancialsEditFormProps) {
  function handleTaxPercentageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    onFormChange((prev) => ({ ...prev, tax_percentage: raw as unknown as number }))
    if (raw === '') return
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      schedule({ tax_percentage: n })
    }
  }

  function handleTaxPercentageBlur() {
    if (form.tax_percentage === ('' as unknown as number) || form.tax_percentage == null) {
      onFormChange((prev) => ({ ...prev, tax_percentage: 9 }))
      schedule({ tax_percentage: 9 })
    }
  }

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label="Formal name (KvK)"
          fullWidth
          value={form.formal_name}
          onChange={(e) => onChange('formal_name', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
          placeholder="As registered at the Chamber of Commerce"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label="KvK number"
          fullWidth
          value={form.kvk_number}
          onChange={(e) => onChange('kvk_number', e.target.value.replace(/\D/g, '').slice(0, 8))}
          slotProps={{ htmlInput: { maxLength: 8, inputMode: 'numeric', pattern: '[0-9]{8}' } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 8 }}>
        <TextField
          label="Street + number"
          fullWidth
          value={form.address_street}
          onChange={(e) => onChange('address_street', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <TextField
          label="Postal code"
          fullWidth
          value={form.address_postal_code}
          onChange={(e) => onChange('address_postal_code', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 10 } }}
          placeholder="1234 AB"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label="City"
          fullWidth
          value={form.address_city}
          onChange={(e) => onChange('address_city', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label="Country"
          fullWidth
          value={form.address_country}
          onChange={(e) => onChange('address_country', e.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label="IBAN"
          fullWidth
          value={form.iban}
          onChange={(e) => onChange('iban', e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 34))}
          slotProps={{ htmlInput: { maxLength: 34, style: { textTransform: 'uppercase' } } }}
          helperText="e.g. NL91 ABNA 0417 1643 00"
        />
      </Grid>
      <Grid size={{ xs: 8, md: 4 }}>
        <TextField
          label="Tax ID (BTW)"
          fullWidth
          value={form.tax_id}
          onChange={(e) => onChange('tax_id', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14))}
          slotProps={{ htmlInput: { maxLength: 14, style: { textTransform: 'uppercase' }, pattern: 'NL[0-9]{9}B[0-9]{2}' } }}
          helperText="Format: NL123456789B01"
        />
      </Grid>
      <Grid size={{ xs: 4, md: 2 }}>
        <TextField
          label="Tax %"
          fullWidth
          type="number"
          value={form.tax_percentage}
          onChange={handleTaxPercentageChange}
          onBlur={handleTaxPercentageBlur}
          slotProps={{
            htmlInput: { min: 0, max: 100, step: 0.1 },
            input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
          }}
        />
      </Grid>
      <Grid size={12}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <FormControlLabel
            control={(
              <Switch
                checked={!!form.applies_kor}
                onChange={(e) => onChange('applies_kor', e.target.checked)}
              />
            )}
            label="KOR"
          />
          <Tooltip title="kleineondernemingsregeling">
            <InfoOutlinedIcon fontSize="small" color="action" />
          </Tooltip>
        </Stack>
      </Grid>
    </Grid>
  )
}

interface FinancialsViewProps {
  form: ProfileForm
}

function FinancialsView({ form }: FinancialsViewProps) {
  const taxPercentageDisplay = form.tax_percentage != null && form.tax_percentage !== ('' as unknown as number)
    ? `${form.tax_percentage}%`
    : '—'
  const addressDisplay = [
    form.address_street,
    [form.address_postal_code, form.address_city].filter(Boolean).join(' '),
    form.address_country,
  ].filter(Boolean).join('\n') || '—'

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="caption" color="text.secondary">Formal name (KvK)</Typography>
        <Typography>{form.formal_name || '—'}</Typography>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="caption" color="text.secondary">KvK number</Typography>
        <Typography>{form.kvk_number || '—'}</Typography>
      </Grid>
      <Grid size={12}>
        <Typography variant="caption" color="text.secondary">Address</Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{addressDisplay}</Typography>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="caption" color="text.secondary">IBAN</Typography>
        <Typography sx={{ wordBreak: 'break-all' }}>{form.iban || '—'}</Typography>
      </Grid>
      <Grid size={{ xs: 8, md: 4 }}>
        <Typography variant="caption" color="text.secondary">Tax ID (BTW)</Typography>
        <Typography>{form.tax_id || '—'}</Typography>
      </Grid>
      <Grid size={{ xs: 4, md: 2 }}>
        <Typography variant="caption" color="text.secondary">Tax %</Typography>
        <Typography>{taxPercentageDisplay}</Typography>
      </Grid>
      <Grid size={12}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>KOR</Typography>
          <Typography>{form.applies_kor ? 'Yes' : 'No'}</Typography>
          <Tooltip title="kleineondernemingsregeling">
            <InfoOutlinedIcon fontSize="small" color="action" />
          </Tooltip>
        </Stack>
      </Grid>
    </Grid>
  )
}

interface ProfileFinancialsTabProps {
  form: ProfileForm
  isAdmin?: boolean
  editing?: boolean
  onToggleEditing: () => void
  onChange: (field: keyof ProfileForm, value: unknown) => void
  onFormChange: Dispatch<SetStateAction<ProfileForm>>
  schedule: (patch: Partial<ProfileForm>) => void
}

export default function ProfileFinancialsTab({ form, isAdmin, editing, onToggleEditing, onChange, onFormChange, schedule }: ProfileFinancialsTabProps) {
  const editable = editing && isAdmin
  return (
    <Box sx={{ p: 3 }}>
      {isAdmin && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            size="small"
            startIcon={editing ? <CheckIcon /> : <EditIcon />}
            onClick={onToggleEditing}
            variant={editing ? 'contained' : 'outlined'}
            aria-label={editing ? 'Done editing financial details' : 'Edit financial details'}
          >
            {editing ? 'Done' : 'Edit'}
          </Button>
        </Box>
      )}

      {editable
        ? <FinancialsEditForm form={form} onChange={onChange} onFormChange={onFormChange} schedule={schedule} />
        : <FinancialsView form={form} />}
    </Box>
  )
}
