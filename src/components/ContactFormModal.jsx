import { useCallback, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import { createContact, getContact, updateContact } from '../api/contacts.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.js'
import { ALL_CONTACT_CATEGORIES } from '../utils/contactCategories.js'
import { idProp } from '../propTypes/shared.js'
import ContactFields from './ContactFields.jsx'
import SaveStatusLabel from './SaveStatusLabel.jsx'

const REQUIRED_FIELDS = ['name']

const EMPTY_FORM = {
  name:     '',
  email:    '',
  phone:    '',
  category: 'press',
}

export default function ContactFormModal({
  mode,
  contactId,
  onClose,
  onDelete,
  initial,
  onCreated,
  categories = ALL_CONTACT_CATEGORIES,
  title,
  submitLabel,
}) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...initial }))
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const saveFn = useCallback(
    async (patch) => { await updateContact(contactId, patch) },
    [contactId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    if (mode !== 'edit') return
    getContact(contactId)
      .then((c) => {
        setForm({
          name:     c.name || '',
          email:    c.email || '',
          phone:    c.phone || '',
          category: c.category || 'press',
        })
      })
      .finally(() => setLoading(false))
  }, [mode, contactId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') {
      if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
      schedule({ [field]: value || null })
    }
  }

  async function handleCreate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }
    const contact = await createContact({
      name:     form.name.trim(),
      email:    form.email || null,
      phone:    form.phone || null,
      category: form.category,
    })
    onCreated?.(contact)
    onClose()
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>{title ?? (mode === 'create' ? 'Add contact' : 'Contact')}</DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <ContactFields
              form={form}
              onChange={handleChange}
              errors={mode === 'edit' ? { ...getRequiredErrors(form, REQUIRED_FIELDS), ...errors } : errors}
              categories={categories}
            />
          </Grid>
        </DialogContent>
      )}

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && <SaveStatusLabel status={saveStatus} />}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === 'create' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={handleCreate}>{submitLabel ?? 'Add contact'}</Button>
          </>
        ) : confirmingDelete ? (
          <>
            <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
              Delete this contact?
            </Typography>
            <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button color="error" variant="contained" onClick={onDelete}>Delete</Button>
          </>
        ) : (
          <>
            <Button color="error" onClick={() => setConfirmingDelete(true)}>Delete</Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button variant="contained" onClick={handleClose}>Close</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}

ContactFormModal.propTypes = {
  mode: PropTypes.oneOf(['create', 'edit']).isRequired,
  contactId: idProp,
  onClose: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  initial: PropTypes.shape({
    name: PropTypes.string,
    email: PropTypes.string,
    phone: PropTypes.string,
    category: PropTypes.string,
  }),
  onCreated: PropTypes.func,
  categories: PropTypes.arrayOf(PropTypes.string),
  title: PropTypes.string,
  submitLabel: PropTypes.string,
}
