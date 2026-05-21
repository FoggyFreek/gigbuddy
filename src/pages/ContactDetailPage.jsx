import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import { deleteContact, getContact, updateContact } from '../api/contacts.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.js'
import ContactFields from '../components/ContactFields.jsx'

const REQUIRED_FIELDS = ['name']

export default function ContactDetailPage() {
  const { id } = useParams()
  const contactId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  function closeView() {
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  const [form, setForm] = useState({ name: '', email: '', phone: '', category: 'press' })
  const [loading, setLoading] = useState(true)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const saveFn = useCallback(
    async (patch) => { await updateContact(contactId, patch) },
    [contactId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
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
  }, [contactId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
    schedule({ [field]: value || null })
  }

  async function handleDelete() {
    await deleteContact(contactId)
    closeView()
  }

  async function handleBack() {
    await flush()
    closeView()
  }

  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" fontWeight={600}>Contact</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={handleBack} aria-label="close">
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          <ContactFields
            form={form}
            onChange={handleChange}
            errors={getRequiredErrors(form, REQUIRED_FIELDS)}
          />
        </Grid>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        <Typography variant="caption" color={saveColor}>{saveLabel}</Typography>
      </Box>

      <Box sx={{ mt: 4 }}>
        <Button color="error" variant="contained" onClick={() => setConfirmingDelete(true)}>
          Delete
        </Button>
      </Box>

      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)}>
        <DialogTitle>Delete contact?</DialogTitle>
        <DialogContent>
          <DialogContentText>This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
