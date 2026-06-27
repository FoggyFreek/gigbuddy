import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import { createContact, getContact, updateContact } from '../api/contacts.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import { ALL_CONTACT_CATEGORIES } from '../utils/contactCategories.ts'
import type { Id, Contact } from '../types/entities.ts'
import ContactFields from './ContactFields.tsx'
import SaveStatusLabel from './SaveStatusLabel.tsx'

const REQUIRED_FIELDS = ['name']

const EMPTY_FORM = {
  name:     '',
  email:    '',
  phone:    '',
  category: 'press',
}

interface ContactFormModalProps {
  mode: 'create' | 'edit'
  contactId?: Id
  onClose: () => void
  onDelete?: () => void
  initial?: Partial<Contact>
  onCreated?: (contact: Contact) => void
  categories?: string[]
  title?: string
  submitLabel?: string
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
}: ContactFormModalProps) {
  const { t } = useTranslation(['contacts', 'common'])
  const [form, setForm] = useState(() => ({
    name:     initial?.name ?? EMPTY_FORM.name,
    email:    initial?.email ?? EMPTY_FORM.email,
    phone:    initial?.phone ?? EMPTY_FORM.phone,
    category: initial?.category ?? EMPTY_FORM.category,
  }))
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [loading, setLoading] = useState(mode === 'edit')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { canWritePlanning: canWrite } = usePermissions()

  const saveFn = useCallback(
    async (patch: Record<string, unknown>) => {
      if (contactId == null) return
      await updateContact(contactId, patch)
    },
    [contactId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    if (mode !== 'edit') return
    if (contactId == null) return
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

  function handleChange(field: string, value: string) {
    if (mode === 'edit' && !canWrite) return
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') {
      if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
      schedule({ [field]: value || null })
    }
  }

  async function handleCreate() {
    const errs: Record<string, string> = {}
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
      <DialogTitle>{title ?? (mode === 'create' ? t($ => $.addContact) : t($ => $.detailTitle))}</DialogTitle>

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
              disabled={mode === 'edit' && !canWrite}
            />
          </Grid>
        </DialogContent>
      )}

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && <SaveStatusLabel status={saveStatus} sx={undefined} />}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {(() => {
          if (mode === 'create') {
            return (
              <>
                <Button onClick={onClose}>{t($ => $.common.actions.cancel)}</Button>
                <Button variant="contained" onClick={handleCreate}>{submitLabel ?? t($ => $.addContact)}</Button>
              </>
            )
          }
          if (confirmingDelete) {
            return (
              <>
                <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
                  {t($ => $.modal.confirmDelete)}
                </Typography>
                <Button onClick={() => setConfirmingDelete(false)}>{t($ => $.common.actions.cancel)}</Button>
                <Button color="error" variant="contained" onClick={onDelete}>{t($ => $.common.actions.delete)}</Button>
              </>
            )
          }
          return (
            <>
              {canWrite && <Button color="error" onClick={() => setConfirmingDelete(true)}>{t($ => $.common.actions.delete)}</Button>}
              <Box sx={{ flexGrow: 1 }} />
              <Button variant="contained" onClick={handleClose}>{t($ => $.common.actions.close)}</Button>
            </>
          )
        })()}
      </DialogActions>
    </Dialog>
  )
}
