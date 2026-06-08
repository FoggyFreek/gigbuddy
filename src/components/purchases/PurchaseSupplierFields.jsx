import { useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlined'
import DateEntryField from '../DateEntryField.jsx'
import SupplierAutocomplete from './SupplierAutocomplete.jsx'

export default function PurchaseSupplierFields({ form, patchForm, readOnly }) {
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
          onChange={patchForm}
          disabled={readOnly}
          label="Supplier"
          autoFocus
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DateEntryField
              label="Receipt date"
              size="small"
              fullWidth
              value={form.receipt_date || ''}
              onChange={(e) => patchForm({ receipt_date: e.target.value })}
              disabled={readOnly}
              sx={{ flexGrow: 1 }}
            />
            {!dueOpen && (
              <Button size="small" startIcon={<AddCircleOutlineIcon />} onClick={openDue} disabled={readOnly}>
                Due
              </Button>
            )}
          </Box>
          {dueOpen && (
            <Box sx={{ mt: 2 }}>
              <DateEntryField
                label="Due date"
                size="small"
                fullWidth
                value={form.due_date || ''}
                onChange={(e) => patchForm({ due_date: e.target.value })}
                disabled={readOnly}
              />
            </Box>
          )}
        </Box>

        <Box>
          <FormControl size="small" fullWidth disabled={readOnly}>
            <InputLabel>Currency</InputLabel>
            <Select
              label="Currency"
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

PurchaseSupplierFields.propTypes = {
  form: PropTypes.object.isRequired,
  patchForm: PropTypes.func.isRequired,
  readOnly: PropTypes.bool,
}
