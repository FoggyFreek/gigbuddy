import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import StarIcon from '@mui/icons-material/Star'
import {
  addContactNote,
  addContactVenue,
  deleteContactNote,
  deleteContact,
  getContact,
  listContactVenues,
  removeContactVenue,
  updateContact,
} from '../api/contacts.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { getRequiredErrors, hasRequiredErrors } from '../utils/requiredFields.ts'
import { venueHeadline } from '../utils/venueDisplay.ts'
import { contactMatchesCategoryFilter } from '../utils/contactCategories.ts'
import ContactFields from '../components/ContactFields.tsx'
import SaveStatusLabel from '../components/SaveStatusLabel.tsx'
import VenuePicker from '../components/VenuePicker.tsx'
import type { Venue, Id } from '../types/entities.ts'

const REQUIRED_FIELDS = ['name']

interface ContactForm {
  [key: string]: unknown
  name: string
  email: string
  phone: string
  category: string
}

interface ContactNote {
  id?: Id
  note?: string
  created_at?: string
}

interface LinkedVenue extends Venue {
  is_primary?: boolean
}

export default function ContactDetailPage() {
  const { id } = useParams()
  const contactId = Number(id)
  const navigate = useNavigate()
  const { canWritePlanning: canWrite } = usePermissions()
  const outletCtx = (useOutletContext() || {}) as Record<string, unknown>
  const insideSplitView = !!outletCtx.insideSplitView
  const contactFilter = outletCtx.contactFilter as Record<string, string> | undefined
  const onClose = outletCtx.onClose as (() => void) | undefined
  const onContactUpdate = outletCtx.onContactUpdate as ((id: Id, patch: Partial<ContactForm>) => void) | undefined
  const onContactDelete = outletCtx.onContactDelete as ((id: Id) => void) | undefined

  const closeView = useCallback(() => {
    if (onClose) onClose()
    else navigate(-1)
  }, [navigate, onClose])

  const [form, setForm] = useState<ContactForm>({ name: '', email: '', phone: '', category: 'press' })
  const [notes, setNotes] = useState<ContactNote[]>([])
  const [newNote, setNewNote] = useState('')
  const [venues, setVenues] = useState<LinkedVenue[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const saveFn = useCallback(
    async (patch: Partial<ContactForm>) => { await updateContact(contactId, patch) },
    [contactId]
  )
  const handleSaved = useCallback((patch: Partial<ContactForm>) => {
    onContactUpdate?.(contactId, patch)
    const nextContact = { ...form, ...patch }
    if (
      'category' in patch &&
      contactFilter &&
      !contactMatchesCategoryFilter(nextContact, contactFilter)
    ) {
      closeView()
    }
  }, [closeView, contactFilter, contactId, form, onContactUpdate])
  const { schedule, flush, status: saveStatus } = useDebouncedSave(
    saveFn,
    600,
    handleSaved
  )

  useEffect(() => {
    getContact(contactId)
      .then((c) => {
        if (
          contactFilter &&
          !contactMatchesCategoryFilter(c, contactFilter)
        ) {
          closeView()
          return
        }
        setForm({
          name:     c.name || '',
          email:    c.email || '',
          phone:    c.phone || '',
          category: c.category || 'press',
        })
        setNotes((c as { notes?: ContactNote[] }).notes || [])
      })
      .finally(() => setLoading(false))
    listContactVenues(contactId).then((vs) => setVenues(vs as LinkedVenue[])).catch(() => setVenues([]))
  }, [closeView, contactFilter, contactId])

  async function handleAddVenue(venue: Venue) {
    if (!canWrite) return
    if (venues.some((v) => v.id === venue.id)) return
    const linked = await (addContactVenue(contactId, venue.id as Id) as unknown as Promise<LinkedVenue>)
    setVenues((prev) => [...prev, linked])
  }

  async function handleRemoveVenue(venueId: Id) {
    if (!canWrite) return
    await removeContactVenue(contactId, venueId)
    setVenues((prev) => prev.filter((v) => v.id !== venueId))
  }

  async function handleAddNote() {
    if (!canWrite) return
    const trimmed = newNote.trim()
    if (!trimmed) return
    const note = await addContactNote(contactId, trimmed)
    setNotes((prev) => [note as ContactNote, ...prev])
    setNewNote('')
  }

  async function handleDeleteNote(noteId: Id) {
    if (!canWrite) return
    await deleteContactNote(contactId, noteId)
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
  }

  function handleChange(field: string, value: string) {
    if (!canWrite) return
    setForm((prev) => ({ ...prev, [field]: value }))
    if (hasRequiredErrors({ ...form, [field]: value }, REQUIRED_FIELDS)) return
    schedule({ [field]: value || null } as Partial<ContactForm>)
  }

  async function handleDelete() {
    setConfirmingDelete(false)
    await deleteContact(contactId)
    onContactDelete?.(contactId)
    closeView()
  }

  async function handleBack() {
    await flush()
    closeView()
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Contact</Typography>
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
        <>
          <Grid container spacing={2}>
            <ContactFields
              form={form}
              onChange={handleChange}
              errors={getRequiredErrors(form, REQUIRED_FIELDS)}
              disabled={!canWrite}
            />
          </Grid>

          <Divider sx={{ my: 3 }} />

          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
            Venues &amp; festivals
          </Typography>

          {venues.map((v) => {
            const location = [v.city, v.region, v.country].filter(Boolean).join(', ')
            return (
              <Box
                key={String(v.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  mb: 1,
                  p: 1,
                  pl: 1.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              >
                <Chip
                  label={v.category === 'festival' ? 'festival' : 'venue'}
                  size="small"
                  variant="outlined"
                  sx={{ alignSelf: 'center' }}
                />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {venueHeadline(v) || '(unnamed)'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {location || ' '}
                  </Typography>
                </Box>
                {v.is_primary && (
                  <Tooltip title="This contact is the primary for this venue">
                    <StarIcon
                      color="warning"
                      fontSize="small"
                      titleAccess="primary contact for this venue"
                    />
                  </Tooltip>
                )}
                <Tooltip title="Open venue">
                  <IconButton
                    size="small"
                    onClick={async () => { await flush(); navigate(`/venues/${v.id}`) }}
                    aria-label="open venue"
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {canWrite && (
                  <IconButton
                    size="small"
                    onClick={() => v.id != null && handleRemoveVenue(v.id)}
                    aria-label="remove venue"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            )
          })}

          {canWrite && (
            <Box sx={{ mt: 1 }}>
              <VenuePicker
                onSelect={handleAddVenue}
                excludeIds={venues.map((v) => v.id).filter((id): id is Id => id != null)}
                label="Add venue / festival"
              />
            </Box>
          )}

          <Divider sx={{ my: 3 }} />

          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
            Notes
          </Typography>

          {canWrite && (
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                placeholder="Add a note…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <Button
                variant="contained"
                aria-label="Add note"
                disabled={!newNote.trim()}
                onClick={handleAddNote}
                sx={{ alignSelf: 'flex-end' }}
              >
                Add
              </Button>
            </Box>
          )}

          {notes.map((n) => (
            <Box
              key={String(n.id)}
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                mb: 1.5,
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                  {n.note}
                </Typography>
              </Box>
              {canWrite && (
                <IconButton size="small" onClick={() => n.id != null && handleDeleteNote(n.id)} aria-label="delete note">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          ))}
        </>
      )}

      {canWrite && (
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
          <SaveStatusLabel status={saveStatus} />
        </Box>
      )}

      {canWrite && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" variant="contained" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </Box>
      )}

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
