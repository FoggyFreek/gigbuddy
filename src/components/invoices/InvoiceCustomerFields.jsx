import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'

const PAYMENT_TERMS = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
]

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
]

export default function InvoiceCustomerFields({
  form, patchForm, readOnly, isEdit, invoice, onStatusChange, memoOpen, setMemoOpen,
}) {
  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2, mb: 2 }}>
        <TextField
          label="Issue date"
          type="date"
          size="small"
          value={form.issue_date || ''}
          onChange={(e) => patchForm({ issue_date: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
          disabled={readOnly}
        />
        <FormControl size="small" disabled={readOnly}>
          <InputLabel>Payment term</InputLabel>
          <Select
            label="Payment term"
            value={form.payment_term_days}
            onChange={(e) => patchForm({ payment_term_days: Number(e.target.value) })}
          >
            {PAYMENT_TERMS.map((p) => (
              <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {isEdit && (
          <FormControl size="small">
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={invoice?.status || 'draft'}
              onChange={(e) => onStatusChange(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>Customer</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <TextField
          label="Organisation name"
          size="small"
          required
          value={form.customer_name}
          onChange={(e) => patchForm({ customer_name: e.target.value })}
          disabled={readOnly}
        />
        <TextField
          label="Email"
          size="small"
          value={form.customer_email || ''}
          onChange={(e) => patchForm({ customer_email: e.target.value })}
          disabled={readOnly}
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            label="Title"
            size="small"
            sx={{ width: 100 }}
            value={form.customer_contact_title || ''}
            onChange={(e) => patchForm({ customer_contact_title: e.target.value })}
            disabled={readOnly}
            placeholder="e.g. Dhr."
          />
          <TextField
            label="Given name"
            size="small"
            sx={{ flexGrow: 1 }}
            value={form.customer_contact_given_name || ''}
            onChange={(e) => patchForm({ customer_contact_given_name: e.target.value })}
            disabled={readOnly}
          />
          <TextField
            label="Family name"
            size="small"
            sx={{ flexGrow: 1 }}
            value={form.customer_contact_family_name || ''}
            onChange={(e) => patchForm({ customer_contact_family_name: e.target.value })}
            disabled={readOnly}
          />
        </Box>
        <TextField
          label="Street and number"
          size="small"
          value={form.customer_address_street || ''}
          onChange={(e) => patchForm({ customer_address_street: e.target.value })}
          disabled={readOnly}
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            label="Postal code"
            size="small"
            sx={{ width: 140 }}
            value={form.customer_address_postal_code || ''}
            onChange={(e) => patchForm({ customer_address_postal_code: e.target.value })}
            disabled={readOnly}
          />
          <TextField
            label="City"
            size="small"
            sx={{ flexGrow: 1 }}
            value={form.customer_address_city || ''}
            onChange={(e) => patchForm({ customer_address_city: e.target.value })}
            disabled={readOnly}
          />
        </Box>
        <TextField
          label="Country"
          size="small"
          value={form.customer_address_country || ''}
          onChange={(e) => patchForm({ customer_address_country: e.target.value })}
          disabled={readOnly}
        />
        <TextField
          label="Customer KVK (optional)"
          size="small"
          value={form.customer_kvk || ''}
          onChange={(e) => patchForm({ customer_kvk: e.target.value })}
          disabled={readOnly}
        />
      </Box>

      {!memoOpen ? (
        <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={() => setMemoOpen(true)}>
          Add memo
        </Button>
      ) : (
        <TextField
          label="Memo"
          multiline
          minRows={2}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
          value={form.memo || ''}
          onChange={(e) => patchForm({ memo: e.target.value })}
          disabled={readOnly}
        />
      )}
    </>
  )
}

InvoiceCustomerFields.propTypes = {
  form: PropTypes.object.isRequired,
  patchForm: PropTypes.func.isRequired,
  readOnly: PropTypes.bool.isRequired,
  isEdit: PropTypes.bool.isRequired,
  invoice: PropTypes.object,
  onStatusChange: PropTypes.func.isRequired,
  memoOpen: PropTypes.bool.isRequired,
  setMemoOpen: PropTypes.func.isRequired,
}
