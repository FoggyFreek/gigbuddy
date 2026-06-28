import { useState } from 'react'
import type { PurchaseForm } from './purchaseFormHelpers.ts'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlined'
import DateEntryField from '../DateEntryField.tsx'
import SupplierAutocomplete from './SupplierAutocomplete.tsx'

interface PurchaseSupplierFieldsProps {
  form: PurchaseForm
  patchForm: (patch: Partial<PurchaseForm>) => void
  readOnly?: boolean
}

export default function PurchaseSupplierFields({ form, patchForm, readOnly }: PurchaseSupplierFieldsProps) {
  const { t } = useTranslation('purchases')
  const [dueOpen, setDueOpen] = useState(Boolean(form.due_date))

  function openDue() {
    setDueOpen(true)
    if (!form.due_date) patchForm({ due_date: form.receipt_date || null })
  }

  return (
    <>
      <Box sx={{ mb: 2 }}>
        <SupplierAutocomplete
          value={form.supplier_name}
          onChange={(patch) => patchForm(patch)}
          disabled={readOnly}
          label={t($ => $.labels.supplier)}
          autoFocus
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DateEntryField
              label={t($ => $.labels.receiptDate)}
              openPickerLabel={t($ => $.supplierFields.openReceiptDatePicker)}
              size="small"
              fullWidth
              value={form.receipt_date || ''}
              onChange={(e) => patchForm({ receipt_date: e.target.value })}
              disabled={readOnly}
              sx={{ flexGrow: 1 }}
            />

            {!dueOpen && (
              <Button size="small" startIcon={<AddCircleOutlineIcon />} onClick={openDue} disabled={readOnly}>
                {t($ => $.supplierFields.addDueDate)}
              </Button>
            )}
          </Box>
          {dueOpen && (
            <Box sx={{ mt: 2 }}>
              <DateEntryField
                label={t($ => $.labels.dueDate)}
                openPickerLabel={t($ => $.supplierFields.openDueDatePicker)}
                size="small"
                fullWidth
                value={form.due_date || ''}
                onChange={(e) => patchForm({ due_date: e.target.value })}
                disabled={readOnly}
                sx={{}}
              />
            </Box>
          )}
        </Box>

        <Box>
          <FormControl size="small" fullWidth disabled={readOnly}>
            <InputLabel>{t($ => $.labels.currency)}</InputLabel>
            <Select
              label={t($ => $.labels.currency)}
              value={form.currency || 'EUR'}
              onChange={(e) => patchForm({ currency: e.target.value })}
            >
              <MenuItem value="EUR">EUR</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>
    </>
  )
}
