import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
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
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { deleteVenue, getVenue, updateVenue } from '../api/venues.js'
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

export default function VenueDetailPage() {
  const { id } = useParams()
  const venueId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  function closeView() {
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  const [form, setForm] = useState({
    category: 'venue',
    name: '',
    city: '',
    country: '',
    province: '',
    address: '',
    website: '',
    contact_person: '',
    phone: '',
    email: '',
  })
  const [loading, setLoading] = useState(true)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const saveFn = useCallback(
    async (patch) => { await updateVenue(venueId, patch) },
    [venueId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    getVenue(venueId)
      .then((v) => {
        setForm({
          category: v.category || 'venue',
          name: v.name || '',
          city: v.city || '',
          country: v.country ? String(v.country).trim() : '',
          province: v.province ? String(v.province).trim() : '',
          address: v.address || '',
          website: v.website || '',
          contact_person: v.contact_person || '',
          phone: v.phone || '',
          email: v.email || '',
        })
      })
      .finally(() => setLoading(false))
  }, [venueId])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    schedule({ [field]: value || null })
  }

  async function handleDelete() {
    await deleteVenue(venueId)
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
        <Typography variant="h5" fontWeight={600}>Venue</Typography>
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
          <Grid size={4}>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                label="Category"
                value={form.category}
                onChange={(e) => handleChange('category', e.target.value)}
              >
                <MenuItem value="venue">Venue</MenuItem>
                <MenuItem value="festival">Festival</MenuItem>
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
              label="City"
              fullWidth
              value={form.city}
              onChange={(e) => handleChange('city', e.target.value)}
            />
          </Grid>
          <Grid size={3}>
            <TextField
              label="Country"
              fullWidth
              value={form.country}
              onChange={(e) => handleChange('country', e.target.value.slice(0, 2).toUpperCase())}
              slotProps={{ htmlInput: { maxLength: 2 } }}
              placeholder="NL"
            />
          </Grid>
          <Grid size={3}>
            <TextField
              label="Province"
              fullWidth
              value={form.province}
              onChange={(e) => handleChange('province', e.target.value.slice(0, 2).toUpperCase())}
              slotProps={{ htmlInput: { maxLength: 2 } }}
              placeholder="NH"
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Address"
              fullWidth
              value={form.address}
              onChange={(e) => handleChange('address', e.target.value)}
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Website"
              fullWidth
              value={form.website}
              onChange={(e) => handleChange('website', e.target.value)}
              placeholder="https://"
              slotProps={{
                input: {
                  endAdornment: form.website ? (
                    <InputAdornment position="end">
                      <Tooltip title="Open in new tab">
                        <IconButton
                          size="small"
                          edge="end"
                          tabIndex={-1}
                          component="a"
                          href={form.website}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ) : null,
                },
              }}
            />
          </Grid>
          <Grid size={6}>
            <TextField
              label="Contact Person"
              fullWidth
              value={form.contact_person}
              onChange={(e) => handleChange('contact_person', e.target.value)}
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
          <Grid size={12}>
            <TextField
              label="Email"
              fullWidth
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              slotProps={{ input: { endAdornment: <CopyAdornment value={form.email} /> } }}
            />
          </Grid>
        </Grid>
      )}

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        {confirmingDelete ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
              Delete this venue?
            </Typography>
            <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button color="error" variant="contained" onClick={handleDelete}>Delete</Button>
          </>
        ) : (
          <>
            <Button color="error" onClick={() => setConfirmingDelete(true)}>Delete</Button>
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" color={saveColor}>{saveLabel}</Typography>
          </>
        )}
      </Box>
    </Box>
  )
}
