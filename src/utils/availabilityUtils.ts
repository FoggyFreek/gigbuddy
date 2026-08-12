import type { Slot, Member } from '../types/entities.ts'

export const GIG_STATUS_COLORS: Record<string, string> = {
  option: 'grey.500',
  confirmed: 'primary.main',
  announced: 'success.main',
}

export const REHEARSAL_STATUS_COLORS: Record<string, string> = {
  option: 'grey.400',
  planned: 'secondary.main',
}

export const BAND_EVENT_COLOR = 'warning.main'

export const AVAILABILITY_STATUS_COLORS: Record<string, string> = {
  available: 'success.main',
  travel_margin: 'warning.main',
  unavailable: 'error.main',
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function normalizeIsoDate(val: string | Date | null | undefined): string {
  if (!val) return ''
  if (typeof val === 'string') {
    if (val.length >= 10 && val[4] === '-' && val[7] === '-' && !val.includes('T')) {
      return val.slice(0, 10)
    }
  }
  return toIsoDate(new Date(val))
}

export const UNASSIGNED_SLOT_COLOR = '#9e9e9e'

export function getMemberColor(
  slot: Slot,
  members: Member[],
  unassignedColor: string = UNASSIGNED_SLOT_COLOR,
): string {
  if (slot.band_member_id == null) return unassignedColor
  const m = members.find((member) => String(member.id) === String(slot.band_member_id))
  return m?.color || UNASSIGNED_SLOT_COLOR
}

export function canManageAvailabilityForMember(member: Member | null | undefined): boolean {
  return member != null && (
    member.user_id == null || member.availability_managed_by_band === true
  )
}
