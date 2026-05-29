import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { listVenueContacts } from '../api/venues.js'
import {
  addGigContact,
  listGigContacts,
  removeGigContact,
  setGigContactPrimary,
} from '../api/gigs.js'
import ContactPicker from './ContactPicker.jsx'
import CopyIconButton from './CopyIconButton.jsx'

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  mb: 1,
  p: 1,
  pl: 1.5,
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
}

// One read-only contact inherited from the gig's venue or festival. Tagged with
// a source chip; email/phone are copyable; no link/unlink (it belongs to the
// venue/festival, edited there).
function InheritedRow({ contact, source, onOpen }) {
  return (
    <Box sx={rowSx}>
      <Chip label={source} size="small" color="default" sx={{ alignSelf: 'center' }} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>{contact.name}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          {contact.email && (
            <>
              <Typography variant="caption" color="text.secondary" noWrap>{contact.email}</Typography>
              <CopyIconButton value={contact.email} ariaLabel="copy email" />
            </>
          )}
          {contact.phone && (
            <>
              <Typography variant="caption" color="text.secondary" noWrap>{contact.phone}</Typography>
              <CopyIconButton value={contact.phone} ariaLabel="copy phone" />
            </>
          )}
        </Box>
      </Box>
      <Tooltip title="Open contact">
        <IconButton size="small" onClick={() => onOpen(contact.id)} aria-label="open contact">
          <OpenInNewIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

export default function GigContactsSection({ gigId, venueId, festivalId, flush }) {
  const navigate = useNavigate()
  const [linked, setLinked] = useState([])
  const [venueContacts, setVenueContacts] = useState([])
  const [festivalContacts, setFestivalContacts] = useState([])

  useEffect(() => {
    let active = true
    listGigContacts(gigId)
      .then((rows) => { if (active) setLinked(rows) })
      .catch(() => { if (active) setLinked([]) })
    return () => { active = false }
  }, [gigId])

  useEffect(() => {
    let active = true
    const load = venueId ? listVenueContacts(venueId) : Promise.resolve([])
    load
      .then((rows) => { if (active) setVenueContacts(rows) })
      .catch(() => { if (active) setVenueContacts([]) })
    return () => { active = false }
  }, [venueId])

  useEffect(() => {
    let active = true
    const load = festivalId ? listVenueContacts(festivalId) : Promise.resolve([])
    load
      .then((rows) => { if (active) setFestivalContacts(rows) })
      .catch(() => { if (active) setFestivalContacts([]) })
    return () => { active = false }
  }, [festivalId])

  async function openContact(contactId) {
    await flush?.()
    navigate(`/contacts/${contactId}`)
  }

  async function handleAddContact(contact) {
    if (linked.some((c) => c.id === contact.id)) return
    const created = await addGigContact(gigId, contact.id)
    setLinked((prev) => [...prev, created])
  }

  async function handleSetPrimary(contactId, isPrimary) {
    await setGigContactPrimary(gigId, contactId, isPrimary)
    setLinked((prev) =>
      prev.map((c) => ({ ...c, is_primary: c.id === contactId ? isPrimary : false })),
    )
  }

  async function handleRemoveContact(contactId) {
    await removeGigContact(gigId, contactId)
    setLinked((prev) => prev.filter((c) => c.id !== contactId))
  }

  const hasInherited = venueContacts.length > 0 || festivalContacts.length > 0

  return (
    <Box>
      {hasInherited && (
        <Box sx={{ mb: 1 }}>
          {venueContacts.map((c) => (
            <InheritedRow key={`v-${c.id}`} contact={c} source="Venue" onOpen={openContact} />
          ))}
          {festivalContacts.map((c) => (
            <InheritedRow key={`f-${c.id}`} contact={c} source="Festival" onOpen={openContact} />
          ))}
        </Box>
      )}

      {linked.map((c) => (
        <Box key={c.id} sx={rowSx}>
          <Chip label={c.category} size="small" variant="outlined" sx={{ alignSelf: 'center' }} />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {c.name}{c.email ? ` (${c.email})` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {c.phone || ' '}
            </Typography>
          </Box>
          <Tooltip title={c.is_primary ? 'Primary contact — click to unset' : 'Mark as primary'}>
            <IconButton
              size="small"
              color={c.is_primary ? 'warning' : 'default'}
              onClick={() => handleSetPrimary(c.id, !c.is_primary)}
              aria-label={c.is_primary ? 'unset primary' : 'set primary'}
            >
              {c.is_primary ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Open contact">
            <IconButton size="small" onClick={() => openContact(c.id)} aria-label="open contact">
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={() => handleRemoveContact(c.id)} aria-label="remove contact">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}

      <Box sx={{ mt: 1 }}>
        <ContactPicker
          onSelect={handleAddContact}
          excludeIds={linked.map((c) => c.id)}
        />
      </Box>
    </Box>
  )
}
