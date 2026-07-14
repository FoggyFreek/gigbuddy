import type { InvoiceForm } from './invoiceFormHelpers.ts'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DateEntryField from '../DateEntryField.tsx'

const PAYMENT_TERMS = [7, 14, 30, 60]

interface InvoiceCustomerFieldsProps {
  form: InvoiceForm
  patchForm: (patch: Partial<InvoiceForm>) => void
  readOnly: boolean
  memoOpen: boolean
  setMemoOpen: (open: boolean) => void
}

export default function InvoiceCustomerFields({
  form, patchForm, readOnly, memoOpen, setMemoOpen,
}: Readonly<InvoiceCustomerFieldsProps>) {
  const { t } = useTranslation('invoices')
  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <DateEntryField
          label={t($ => $.customerFields.issueDate)}
          openPickerLabel={t($ => $.customerFields.openIssueDatePicker)}
          size="small"
          fullWidth
          value={form.issue_date || ''}
          onChange={(e) => patchForm({ issue_date: e.target.value })}
          disabled={readOnly}
          sx={{}}
        />
        <FormControl size="small" disabled={readOnly}>
          <InputLabel>{t($ => $.customerFields.paymentTerm)}</InputLabel>
          <Select
            label={t($ => $.customerFields.paymentTerm)}
            value={form.payment_term_days}
            onChange={(e) => patchForm({ payment_term_days: Number(e.target.value) })}
          >
            {PAYMENT_TERMS.map((days) => (
              <MenuItem key={days} value={days}>{t($ => $.customerFields.paymentTermDays, { count: days })}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>{t($ => $.labels.customer)}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <TextField
          label={t($ => $.customerFields.organisationName)}
          size="small"
          required
          value={form.customer_name}
          onChange={(e) => patchForm({ customer_name: e.target.value })}
          disabled={readOnly}
        />
        <TextField
          label={t($ => $.customerFields.email)}
          size="small"
          value={form.customer_email || ''}
          onChange={(e) => patchForm({ customer_email: e.target.value })}
          disabled={readOnly}
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            label={t($ => $.customerFields.title)}
            size="small"
            sx={{ width: 100 }}
            value={form.customer_contact_title || ''}
            onChange={(e) => patchForm({ customer_contact_title: e.target.value })}
            disabled={readOnly}
            placeholder={t($ => $.customerFields.titlePlaceholder)}
          />
          <TextField
            label={t($ => $.customerFields.givenName)}
            size="small"
            sx={{ flexGrow: 1 }}
            value={form.customer_contact_given_name || ''}
            onChange={(e) => patchForm({ customer_contact_given_name: e.target.value })}
            disabled={readOnly}
          />
          <TextField
            label={t($ => $.customerFields.familyName)}
            size="small"
            sx={{ flexGrow: 1 }}
            value={form.customer_contact_family_name || ''}
            onChange={(e) => patchForm({ customer_contact_family_name: e.target.value })}
            disabled={readOnly}
          />
        </Box>
        <TextField
          label={t($ => $.customerFields.streetAndNumber)}
          size="small"
          value={form.customer_address_street || ''}
          onChange={(e) => patchForm({ customer_address_street: e.target.value })}
          disabled={readOnly}
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            label={t($ => $.customerFields.postalCode)}
            size="small"
            sx={{ width: 140 }}
            value={form.customer_address_postal_code || ''}
            onChange={(e) => patchForm({ customer_address_postal_code: e.target.value })}
            disabled={readOnly}
          />
          <TextField
            label={t($ => $.customerFields.city)}
            size="small"
            sx={{ flexGrow: 1 }}
            value={form.customer_address_city || ''}
            onChange={(e) => patchForm({ customer_address_city: e.target.value })}
            disabled={readOnly}
          />
        </Box>
        <TextField
          label={t($ => $.customerFields.country)}
          size="small"
          value={form.customer_address_country || ''}
          onChange={(e) => patchForm({ customer_address_country: e.target.value })}
          disabled={readOnly}
        />
        <TextField
          label={t($ => $.customerFields.customerKvk)}
          size="small"
          value={form.customer_kvk || ''}
          onChange={(e) => patchForm({ customer_kvk: e.target.value })}
          disabled={readOnly}
        />
      </Box>

      {!memoOpen ? (
        <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={() => setMemoOpen(true)}>
          {t($ => $.customerFields.addMemo)}
        </Button>
      ) : (
        <TextField
          label={t($ => $.customerFields.memo)}
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
