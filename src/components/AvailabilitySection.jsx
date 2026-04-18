import { useEffect, useState } from 'react'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import AvailabilityCalendar from './AvailabilityCalendar.jsx'
import AvailabilitySlotDialog from './AvailabilitySlotDialog.jsx'
import GigFormModal from './GigFormModal.jsx'
import { listMembers } from '../api/bandMembers.js'
import { createSlot, deleteSlot, listAvailability, updateSlot } from '../api/availability.js'
import { listGigs } from '../api/gigs.js'

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
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)
  const [members, setMembers] = useState([])
  const [slots, setSlots] = useState([])
  const [gigs, setGigs] = useState([])
  const [selectionStart, setSelectionStart] = useState(null)
  const [dialog, setDialog] = useState(null) // null | { slot }
  const [gigModalId, setGigModalId] = useState(null)

  useEffect(() => {
    listMembers().then(setMembers).catch(() => {})
    listGigs().then(setGigs).catch(() => {})
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

  function handleDayClick(dateStr, shiftKey) {
    if (shiftKey && selectionStart && dateStr >= selectionStart) {
      setDialog({ slot: { band_member_id: null, start_date: selectionStart, end_date: dateStr, status: 'available', reason: '' } })
      setSelectionStart(null)
    } else {
      setSelectionStart(dateStr)
      setDialog({ slot: { band_member_id: null, start_date: dateStr, end_date: dateStr, status: 'available', reason: '' } })
    }
  }

  function handleSlotClick(slot) {
    setDialog({ slot })
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

  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
        Availability
      </Typography>

      <AvailabilityCalendar
        year={viewYear}
        month={viewMonth}
        slots={slots}
        gigs={gigs}
        members={members}
        selectionStart={selectionStart}
        onDayClick={handleDayClick}
        onSlotClick={handleSlotClick}
        onGigClick={(gig) => setGigModalId(gig.id)}
        onPrev={handlePrev}
        onNext={handleNext}
      />

      {gigModalId && (
        <GigFormModal
          mode="edit"
          gigId={gigModalId}
          onClose={() => setGigModalId(null)}
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
    </Paper>
  )
}
