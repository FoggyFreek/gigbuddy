import PropTypes from 'prop-types'
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

function FinancialsEditForm({ form, onChange, onFormChange, schedule }) {
  function handleTaxPercentageChange(e) {
    const raw = e.target.value
    onFormChange((prev) => ({ ...prev, tax_percentage: raw }))
    if (raw === '') return
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      schedule({ tax_percentage: n })
    }
  }

  function handleTaxPercentageBlur() {
    if (form.tax_percentage === '' || form.tax_percentage == null) {
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
          inputProps={{ maxLength: 200 }}
          placeholder="As registered at the Chamber of Commerce"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label="KvK number"
          fullWidth
          value={form.kvk_number}
          onChange={(e) => onChange('kvk_number', e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputProps={{ maxLength: 8, inputMode: 'numeric', pattern: '[0-9]{8}' }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 8 }}>
        <TextField
          label="Street + number"
          fullWidth
          value={form.address_street}
          onChange={(e) => onChange('address_street', e.target.value)}
          inputProps={{ maxLength: 200 }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <TextField
          label="Postal code"
          fullWidth
          value={form.address_postal_code}
          onChange={(e) => onChange('address_postal_code', e.target.value)}
          inputProps={{ maxLength: 10 }}
          placeholder="1234 AB"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label="City"
          fullWidth
          value={form.address_city}
          onChange={(e) => onChange('address_city', e.target.value)}
          inputProps={{ maxLength: 200 }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label="Country"
          fullWidth
          value={form.address_country}
          onChange={(e) => onChange('address_country', e.target.value)}
          inputProps={{ maxLength: 200 }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          label="IBAN"
          fullWidth
          value={form.iban}
          onChange={(e) => onChange('iban', e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 34))}
          inputProps={{ maxLength: 34, style: { textTransform: 'uppercase' } }}
          helperText="e.g. NL91 ABNA 0417 1643 00"
        />
      </Grid>
      <Grid size={{ xs: 8, md: 4 }}>
        <TextField
          label="Tax ID (BTW)"
          fullWidth
          value={form.tax_id}
          onChange={(e) => onChange('tax_id', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14))}
          inputProps={{ maxLength: 14, style: { textTransform: 'uppercase' }, pattern: 'NL[0-9]{9}B[0-9]{2}' }}
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
          inputProps={{ min: 0, max: 100, step: 0.1 }}
          InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
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

FinancialsEditForm.propTypes = {
  form: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onFormChange: PropTypes.func.isRequired,
  schedule: PropTypes.func.isRequired,
}

function FinancialsView({ form }) {
  const taxPercentageDisplay = form.tax_percentage != null && form.tax_percentage !== ''
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

FinancialsView.propTypes = { form: PropTypes.object.isRequired }

export default function ProfileFinancialsTab({ form, isAdmin, editing, onToggleEditing, onChange, onFormChange, schedule }) {
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

ProfileFinancialsTab.propTypes = {
  form: PropTypes.object.isRequired,
  isAdmin: PropTypes.bool,
  editing: PropTypes.bool,
  onToggleEditing: PropTypes.func.isRequired,
  onChange: PropTypes.func.isRequired,
  onFormChange: PropTypes.func.isRequired,
  schedule: PropTypes.func.isRequired,
}
