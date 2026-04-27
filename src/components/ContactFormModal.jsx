import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { createContact, getContact, updateContact } from '../api/contacts.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'

function CopyAdornment({ value }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  function handleCopy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <InputAdornment position="end">
      <Tooltip title={copied ? 'Copied!' : 'Copy'}>
        <IconButton size="small" edge="end" onClick={handleCopy} tabIndex={-1}>
          {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </InputAdornment>
  )
}

const VALID_CATEGORIES = ['press', 'radio & tv', 'booker', 'promotion', 'network']

const CATEGORY_LABELS = {
  'press':      'Press',
  'radio & tv': 'Radio & TV',
  'booker':     'Booker',
  'promotion':  'Promotion',
  'network':    'Network',
}

const EMPTY_FORM = {
  name:     '',
  email:    '',
  phone:    '',
  category: 'press',
}

export default function ContactFormModal({ mode, contactId, onClose, onDelete }) {
  const [form, setForm] = useState(EMPTY_FORM)
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
    if (mode === 'edit') schedule({ [field]: value || null })
  }

  async function handleCreate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }
    await createContact({
      name:     form.name.trim(),
      email:    form.email || null,
      phone:    form.phone || null,
      category: form.category,
    })
    onClose()
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>{mode === 'create' ? 'Add contact' : 'Contact'}</DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={4}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  label="Category"
                  value={form.category}
                  onChange={(e) => handleChange('category', e.target.value)}
                >
                  {VALID_CATEGORIES.map((cat) => (
                    <MenuItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={8}>
              <TextField
                label="Name"
                fullWidth
                required
                value={form.name}
                onChange={(e) => handleChange('name', e.target.value)}
                error={!!errors.name}
                helperText={errors.name}
              />
            </Grid>
            <Grid size={6}>
              <TextField
                label="Email"
                fullWidth
                type="email"
                value={form.email}
                onChange={(e) => handleChange('email', e.target.value)}
                slotProps={{ input: { endAdornment: <CopyAdornment value={form.email} /> } }}
              />
            </Grid>
            <Grid size={6}>
              <TextField
                label="Phone"
                fullWidth
                value={form.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                slotProps={{ input: { endAdornment: <CopyAdornment value={form.phone} /> } }}
              />
            </Grid>
          </Grid>
        </DialogContent>
      )}

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && (
          <Typography variant="caption" color={saveColor}>
            {saveLabel}
          </Typography>
        )}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === 'create' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={handleCreate}>Add contact</Button>
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
