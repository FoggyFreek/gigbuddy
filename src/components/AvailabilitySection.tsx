import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import AvailabilityCalendar from './AvailabilityCalendar.tsx'
import { venueHeadline } from '../utils/venueDisplay.ts'
import {
  GIG_STATUS_COLORS,
  REHEARSAL_STATUS_COLORS,
  BAND_EVENT_COLOR,
  getMemberColor,
  normalizeIsoDate,
  toIsoDate,
} from '../utils/availabilityUtils.ts'
import AvailabilitySlotDialog from './AvailabilitySlotDialog.tsx'
import GigFormModal from './GigFormModal.tsx'
import RehearsalFormModal from './RehearsalFormModal.tsx'
import BandEventFormModal from './BandEventFormModal.tsx'
import { listMembers } from '../api/bandMembers.ts'
import { createSlot, deleteSlot, listAvailability, updateSlot } from '../api/availability.ts'
import { listGigs } from '../api/gigs.ts'
import { listRehearsals } from '../api/rehearsals.ts'
import { listBandEvents } from '../api/bandEvents.ts'
import { exportMonthToICS } from '../utils/shareUtils.ts'
import { useProfile } from '../contexts/profileContext.ts'
import CalendarFeedDialog from './appShell/CalendarFeedDialog.tsx'
import type { Gig, Member, BandEvent, Slot, Rehearsal, Id } from '../types/entities.ts'

interface AvailabilitySectionProps {
  basePath?: string
  eventReloadKey?: number
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function monthBounds(year: number, month: number) {
  const from = `${year}-${pad(month)}-01`
  const last = new Date(year, month, 0).getDate()
  const to = `${year}-${pad(month)}-${pad(last)}`
  return { from, to }
}

export default function AvailabilitySection({ basePath = '', eventReloadKey = 0 }: AvailabilitySectionProps = {}) {
  const isMobile = useCompactLayout()
  const { bandName } = useProfile()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const gigHref = (id: Id) => (basePath ? `${basePath}/gigs/${id}` : `/gigs/${id}`)
  const rehHref = (id: Id) => (basePath ? `${basePath}/rehearsals/${id}` : `/rehearsals/${id}`)
  const evHref = (id: Id) => (basePath ? `${basePath}/events/${id}` : `/events/${id}`)
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)
  const [members, setMembers] = useState<Member[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [gigs, setGigs] = useState<Gig[]>([])
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([])
  const [bandEvents, setBandEvents] = useState<BandEvent[]>([])
  const [selectionStart, setSelectionStart] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string>(toIsoDate(new Date()))
  const [dialog, setDialog] = useState<{ slot: Partial<Slot> } | null>(null)
  const [addMenu, setAddMenu] = useState<{ anchorEl: EventTarget & Element; date: string } | null>(null)
  const [createModal, setCreateModal] = useState<{ type: string; date: string } | null>(null)
  const [exportModal, setExportModal] = useState(false)
  const [calendarFeedOpen, setCalendarFeedOpen] = useState(false)
  const [exportOptions, setExportOptions] = useState({ gigs: true, rehearsals: true, bandEvents: true })
  const fabRef = useRef<HTMLButtonElement | null>(null)

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
    listGigs().then(setGigs).catch(() => {})
    listRehearsals().then(setRehearsals).catch(() => {})
    listBandEvents().then(setBandEvents).catch(() => {})
  }, [eventReloadKey])

  useEffect(() => {
    const { from, to } = monthBounds(viewYear, viewMonth)
    listAvailability({ from, to }).then(setSlots).catch(() => {})
  }, [viewYear, viewMonth])

  // Sync calendar focus to the item opened in the split-view detail pane
  // (URL is the source of truth; data may arrive async, hence the effect).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!basePath) return
    const escaped = basePath.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')
    const match = new RegExp(`^${escaped}/(gigs|rehearsals|events)/(\\d+)`).exec(pathname)
    if (!match) return
    const [, type, idStr] = match
    const id = Number(idStr)
    let dateStr: string | null = null
    if (type === 'gigs') {
      const g = gigs.find((x) => x.id === id)
      if (g) dateStr = normalizeIsoDate(g.event_date)
    } else if (type === 'rehearsals') {
      const r = rehearsals.find((x) => x.id === id)
      if (r) dateStr = normalizeIsoDate(r.proposed_date)
    } else if (type === 'events') {
      const ev = bandEvents.find((x) => x.id === id)
      if (ev) dateStr = normalizeIsoDate(ev.start_date)
    }
    if (!dateStr) return
    setSelectedDay(dateStr)
    const [yStr, mStr] = dateStr.split('-')
    setViewYear(Number(yStr))
    setViewMonth(Number(mStr))
  }, [pathname, basePath, gigs, rehearsals, bandEvents])
  /* eslint-enable react-hooks/set-state-in-effect */

  function handlePrev() {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12) }
    else setViewMonth((m) => m - 1)
  }

  function handleNext() {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1) }
    else setViewMonth((m) => m + 1)
  }

  function handleDayClick(dateStr: string, shiftKey: boolean, targetEl: EventTarget | null) {
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
      setAddMenu({ anchorEl: targetEl as EventTarget & Element, date: dateStr })
    }
  }

  function handleSlotClick(slot: Slot) {
    setDialog({ slot })
  }

  function handleFabClick(e: React.MouseEvent<HTMLButtonElement>) {
    const day = selectedDay || toIsoDate(new Date())
    setAddMenu({ anchorEl: e.currentTarget, date: day })
  }

  function handleMenuSelect(type: string) {
    const date = addMenu?.date
    setAddMenu(null)
    if (type === 'availability') {
      setDialog({ slot: { band_member_id: null, start_date: date, end_date: date, status: 'available', reason: '' } })
    } else {
      setCreateModal({ type, date: date ?? '' })
    }
  }

  async function handleSave(data: Partial<Slot>) {
    const { from, to } = monthBounds(viewYear, viewMonth)
    if (dialog?.slot?.id) {
      await updateSlot(dialog.slot.id, data)
    } else {
      await createSlot(data)
    }
    const updated = await listAvailability({ from, to })
    setSlots(updated)
    setDialog(null)
    setSelectionStart(null)
  }

  async function handleDelete(id: Id) {
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
    ? slots.filter((s) => selectedDay >= (s.start_date ?? '') && selectedDay <= (s.end_date ?? ''))
    : []

  return (
    <Box sx={{ mb: 3 }}>
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
        selectionStart={selectionStart ?? undefined}
        onDayClick={handleDayClick}
        onSlotClick={handleSlotClick}
        onGigClick={(gig) => navigate(gigHref(gig.id!))}
        onRehearsalClick={(reh) => navigate(rehHref(reh.id!))}
        onBandEventClick={(ev) => navigate(evHref(ev.id!))}
        onPrev={handlePrev}
        onNext={handleNext}
        onMonthJump={(y, m) => { setViewYear(y); setViewMonth(m) }}
        onExport={() => setExportModal(true)}
        onSubscribe={() => setCalendarFeedOpen(true)}
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
                <ListItemButton key={`g-${gig.id}`} onClick={() => navigate(gigHref(gig.id!))}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: GIG_STATUS_COLORS[gig.status as string] || 'grey.500',
                      mr: 1.5,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={gig.event_description || venueHeadline(gig.venue ?? gig.festival) || 'Gig'}
                    secondary={[venueHeadline(gig.venue ?? gig.festival), gig.status].filter(Boolean).join(' — ')}
                  />
                </ListItemButton>
              ))}
              {dayRehearsals.map((reh) => {
                const yes = reh.participants?.filter((p) => p.vote === 'yes').length ?? 0
                const total = reh.participants?.length ?? 0
                return (
                  <ListItemButton key={`r-${reh.id}`} onClick={() => navigate(rehHref(reh.id!))}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: REHEARSAL_STATUS_COLORS[reh.status as string] || 'grey.400',
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
                <ListItemButton key={`be-${ev.id}`} onClick={() => navigate(evHref(ev.id!))}>
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
        anchorEl={addMenu?.anchorEl as Element | null}
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
          gigId={undefined}
          initialDate={createModal.date}
          onClose={() => { setCreateModal(null); loadGigs() }}
        />
      )}

      {createModal?.type === 'rehearsal' && (
         
        <RehearsalFormModal
          mode="create"
          rehearsalId={undefined}
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

      <CalendarFeedDialog open={calendarFeedOpen} onClose={() => setCalendarFeedOpen(false)} />

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
                bandName || undefined,
              )
              setExportModal(false)
            }}
          >
            Export
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
