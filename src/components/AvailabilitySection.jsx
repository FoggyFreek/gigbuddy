import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListItemIcon from '@mui/material/ListItemIcon'
import Fab from '@mui/material/Fab'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import AddIcon from '@mui/icons-material/Add'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import MicIcon from '@mui/icons-material/Mic'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import GroupIcon from '@mui/icons-material/Group'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import AvailabilityCalendar from './AvailabilityCalendar.jsx'
import {
  GIG_STATUS_COLORS,
  REHEARSAL_STATUS_COLORS,
  BAND_EVENT_COLOR,
  getMemberColor,
  normalizeIsoDate,
  toIsoDate,
} from '../utils/availabilityUtils.js'
import AvailabilitySlotDialog from './AvailabilitySlotDialog.jsx'
import GigFormModal from './GigFormModal.jsx'
import RehearsalFormModal from './RehearsalFormModal.jsx'
import BandEventFormModal from './BandEventFormModal.jsx'
import { listMembers } from '../api/bandMembers.js'
import { createSlot, deleteSlot, listAvailability, updateSlot } from '../api/availability.js'
import { listGigs } from '../api/gigs.js'
import { listRehearsals } from '../api/rehearsals.js'
import { listBandEvents } from '../api/bandEvents.js'
import { exportMonthToICS } from '../utils/shareUtils.js'

function pad(n) {
  return String(n).padStart(2, '0')
}

function monthBounds(year, month) {
  const from = `${year}-${pad(month)}-01`
  const last = new Date(year, month, 0).getDate()
  const to = `${year}-${pad(month)}-${pad(last)}`
  return { from, to }
}

export default function AvailabilitySection() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const navigate = useNavigate()
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)
  const [members, setMembers] = useState([])
  const [slots, setSlots] = useState([])
  const [gigs, setGigs] = useState([])
  const [rehearsals, setRehearsals] = useState([])
  const [bandEvents, setBandEvents] = useState([])
  const [selectionStart, setSelectionStart] = useState(null)
  const [selectedDay, setSelectedDay] = useState(toIsoDate(new Date()))
  const [dialog, setDialog] = useState(null)
  const [addMenu, setAddMenu] = useState(null) // { anchorEl, date }
  const [createModal, setCreateModal] = useState(null) // { type, date }
  const [exportModal, setExportModal] = useState(false)
  const [exportOptions, setExportOptions] = useState({ gigs: true, rehearsals: true, bandEvents: true })
  const fabRef = useRef(null)

  function loadGigs() {
    listGigs().then(setGigs).catch(() => {})
  }

  function loadRehearsals() {
    listRehearsals().then(setRehearsals).catch(() => {})
  }

  function loadBandEvents() {
    listBandEvents().then(setBandEvents).catch(() => {})
  }

  useEffect(() => {
    listMembers().then(setMembers).catch(() => {})
    loadGigs()
    loadRehearsals()
    loadBandEvents()
  }, [])

  useEffect(() => {
    const { from, to } = monthBounds(viewYear, viewMonth)
    listAvailability({ from, to }).then(setSlots).catch(() => {})
  }, [viewYear, viewMonth])

  function handlePrev() {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12) }
    else setViewMonth((m) => m - 1)
  }

  function handleNext() {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1) }
    else setViewMonth((m) => m + 1)
  }

  function handleDayClick(dateStr, shiftKey, targetEl) {
    if (isMobile) {
      setSelectedDay(dateStr)
      return
    }
    if (shiftKey && selectionStart && dateStr >= selectionStart) {
      setDialog({ slot: { band_member_id: null, start_date: selectionStart, end_date: dateStr, status: 'available', reason: '' } })
      setSelectionStart(null)
    } else if (shiftKey) {
      setSelectionStart(dateStr)
    } else {
      setSelectionStart(dateStr)
      setAddMenu({ anchorEl: targetEl, date: dateStr })
    }
  }

  function handleSlotClick(slot) {
    setDialog({ slot })
  }

  function handleFabClick(e) {
    const day = selectedDay || toIsoDate(new Date())
    setAddMenu({ anchorEl: e.currentTarget, date: day })
  }

  function handleMenuSelect(type) {
    const date = addMenu?.date
    setAddMenu(null)
    if (type === 'availability') {
      setDialog({ slot: { band_member_id: null, start_date: date, end_date: date, status: 'available', reason: '' } })
    } else {
      setCreateModal({ type, date })
    }
  }

  async function handleSave(data) {
    const { from, to } = monthBounds(viewYear, viewMonth)
    if (dialog.slot?.id) {
      await updateSlot(dialog.slot.id, data)
    } else {
      await createSlot(data)
    }
    const updated = await listAvailability({ from, to })
    setSlots(updated)
    setDialog(null)
    setSelectionStart(null)
  }

  async function handleDelete(id) {
    await deleteSlot(id)
    setSlots((prev) => prev.filter((s) => s.id !== id))
    setDialog(null)
  }

  const dayGigs = selectedDay
    ? gigs.filter((g) => normalizeIsoDate(g.event_date) === selectedDay)
    : []
  const dayRehearsals = selectedDay
    ? rehearsals.filter((r) => normalizeIsoDate(r.proposed_date) === selectedDay)
    : []
  const dayBandEvents = selectedDay
    ? bandEvents.filter((ev) => {
        const start = normalizeIsoDate(ev.start_date)
        const end = normalizeIsoDate(ev.end_date) || start
        return selectedDay >= start && selectedDay <= end
      })
    : []
  const daySlots = selectedDay
    ? slots.filter((s) => selectedDay >= s.start_date && selectedDay <= s.end_date)
    : []

  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
      <AvailabilityCalendar
        year={viewYear}
        month={viewMonth}
        slots={slots}
        gigs={gigs}
        rehearsals={rehearsals}
        bandEvents={bandEvents}
        members={members}
        mobile={isMobile}
        selectedDay={selectedDay}
        selectionStart={selectionStart}
        onDayClick={handleDayClick}
        onSlotClick={handleSlotClick}
        onGigClick={(gig) => navigate(`/gigs/${gig.id}`)}
        onRehearsalClick={(reh) => navigate(`/rehearsals/${reh.id}`)}
        onBandEventClick={(ev) => navigate(`/events/${ev.id}`)}
        onPrev={handlePrev}
        onNext={handleNext}
        onMonthJump={(y, m) => { setViewYear(y); setViewMonth(m) }}
        onExport={() => setExportModal(true)}
      />

      {isMobile && selectedDay && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {new Date(selectedDay + 'T00:00:00').toLocaleDateString('en', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Typography>
          {dayGigs.length === 0 && dayRehearsals.length === 0 && dayBandEvents.length === 0 && daySlots.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No events.</Typography>
          ) : (
            <List dense disablePadding>
              {dayGigs.map((gig) => (
                <ListItemButton key={`g-${gig.id}`} onClick={() => navigate(`/gigs/${gig.id}`)}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: GIG_STATUS_COLORS[gig.status] || 'grey.500',
                      mr: 1.5,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={gig.event_description || gig.venue || 'Gig'}
                    secondary={[gig.venue, gig.status].filter(Boolean).join(' — ')}
                  />
                </ListItemButton>
              ))}
              {dayRehearsals.map((reh) => {
                const yes = reh.participants?.filter((p) => p.vote === 'yes').length ?? 0
                const total = reh.participants?.length ?? 0
                return (
                  <ListItemButton key={`r-${reh.id}`} onClick={() => navigate(`/rehearsals/${reh.id}`)}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: REHEARSAL_STATUS_COLORS[reh.status] || 'grey.400',
                        mr: 1.5,
                        flexShrink: 0,
                      }}
                    />
                    <ListItemText
                      primary={`Rehearsal — ${reh.status}`}
                      secondary={[reh.location, `${yes}/${total} yes`].filter(Boolean).join(' — ')}
                    />
                  </ListItemButton>
                )
              })}
              {dayBandEvents.map((ev) => (
                <ListItemButton key={`be-${ev.id}`} onClick={() => navigate(`/events/${ev.id}`)}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: BAND_EVENT_COLOR,
                      mr: 1.5,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={ev.title}
                    secondary={ev.location || null}
                  />
                </ListItemButton>
              ))}
              {daySlots.map((slot) => {
                const member = slot.band_member_id === null
                  ? null
                  : members.find((m) => m.id === slot.band_member_id)
                const name = slot.band_member_id === null ? 'Band' : member?.name || ''
                return (
                  <ListItemButton key={`s-${slot.id}`} onClick={() => handleSlotClick(slot)}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: getMemberColor(slot, members),
                        mr: 1.5,
                        flexShrink: 0,
                      }}
                    />
                    <ListItemText
                      primary={name}
                      secondary={[slot.status, slot.reason].filter(Boolean).join(' — ')}
                    />
                  </ListItemButton>
                )
              })}
            </List>
          )}
        </Box>
      )}

      {isMobile && (
        <Fab
          ref={fabRef}
          color="primary"
          aria-label="add event"
          onClick={handleFabClick}
          sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: (t) => t.zIndex.fab }}
        >
          <AddIcon />
        </Fab>
      )}

      <Menu
        open={Boolean(addMenu)}
        anchorEl={addMenu?.anchorEl}
        onClose={() => setAddMenu(null)}
        anchorOrigin={isMobile
          ? { vertical: 'top', horizontal: 'center' }
          : { vertical: 'center', horizontal: 'center' }
        }
        transformOrigin={isMobile
          ? { vertical: 'bottom', horizontal: 'center' }
          : { vertical: 'center', horizontal: 'center' }
        }
      >
        <MenuItem onClick={() => handleMenuSelect('availability')}>
          <ListItemIcon><EventAvailableIcon fontSize="small" /></ListItemIcon>
          Availability
        </MenuItem>
        <MenuItem onClick={() => handleMenuSelect('gig')}>
          <ListItemIcon><MicIcon fontSize="small" /></ListItemIcon>
          Gig
        </MenuItem>
        <MenuItem onClick={() => handleMenuSelect('rehearsal')}>
          <ListItemIcon><MusicNoteIcon fontSize="small" /></ListItemIcon>
          Rehearsal
        </MenuItem>
        <MenuItem onClick={() => handleMenuSelect('bandEvent')}>
          <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
          Band Event
        </MenuItem>
      </Menu>

      {createModal?.type === 'gig' && (
        <GigFormModal
          mode="create"
          initialDate={createModal.date}
          onClose={() => { setCreateModal(null); loadGigs() }}
        />
      )}

      {createModal?.type === 'rehearsal' && (
        <RehearsalFormModal
          mode="create"
          initialDate={createModal.date}
          onClose={() => { setCreateModal(null); loadRehearsals() }}
        />
      )}

      {createModal?.type === 'bandEvent' && (
        <BandEventFormModal
          mode="create"
          initialDate={createModal.date}
          onClose={() => { setCreateModal(null); loadBandEvents() }}
        />
      )}

      {dialog && (
        <AvailabilitySlotDialog
          open
          slot={dialog.slot}
          members={members}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setDialog(null); setSelectionStart(null) }}
        />
      )}

      <Dialog open={exportModal} onClose={() => setExportModal(false)}>
        <DialogTitle>Export calendar</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose which events to include in the .ics export for{' '}
            {new Date(viewYear, viewMonth - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })}.
          </Typography>
          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox
                  checked={exportOptions.gigs}
                  onChange={(e) => setExportOptions((o) => ({ ...o, gigs: e.target.checked }))}
                />
              }
              label="Gigs"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={exportOptions.rehearsals}
                  onChange={(e) => setExportOptions((o) => ({ ...o, rehearsals: e.target.checked }))}
                />
              }
              label="Rehearsals"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={exportOptions.bandEvents}
                  onChange={(e) => setExportOptions((o) => ({ ...o, bandEvents: e.target.checked }))}
                />
              }
              label="Band events"
            />
          </FormGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            Only confirmed and announced gigs and planned rehearsals are exported. Options are excluded.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportModal(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!exportOptions.gigs && !exportOptions.rehearsals && !exportOptions.bandEvents}
            onClick={() => {
              exportMonthToICS(
                exportOptions.gigs ? gigs.filter((g) => g.status !== 'option') : [],
                exportOptions.rehearsals ? rehearsals.filter((r) => r.status !== 'option') : [],
                exportOptions.bandEvents ? bandEvents : [],
                viewYear,
                viewMonth,
              )
              setExportModal(false)
            }}
          >
            Export
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
