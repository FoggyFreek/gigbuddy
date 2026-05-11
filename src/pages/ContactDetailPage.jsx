import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { deleteContact, getContact, updateContact } from '../api/contacts.js'
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

export default function ContactDetailPage() {
  const { id } = useParams()
  const contactId = Number(id)
  const navigate = useNavigate()

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
    schedule({ [field]: value || null })
  }

  async function handleDelete() {
    await deleteContact(contactId)
    navigate(-1)
  }

  async function handleBack() {
    await flush()
    navigate(-1)
  }

  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <IconButton onClick={handleBack} aria-label="back">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={600}>Contact</Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
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
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        {confirmingDelete ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
              Delete this contact?
            </Typography>
            <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button color="error" variant="contained" onClick={handleDelete}>Delete</Button>
          </>
        ) : (
          <>
            <Button color="error" onClick={() => setConfirmingDelete(true)}>Delete</Button>
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" color={saveColor} sx={{ mr: 2 }}>{saveLabel}</Typography>
            <Button variant="contained" onClick={handleBack}>Close</Button>
          </>
        )}
      </Box>
    </Box>
  )
}
