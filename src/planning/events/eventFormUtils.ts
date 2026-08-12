import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

export function timeStringToDayjs(val: string | null | undefined): Dayjs | null {
  if (!val) return null
  const d = dayjs(val, 'HH:mm')
  return d.isValid() ? d : null
}

export function dayjsToTimeString(d: Dayjs | null | undefined): string {
  if (!d?.isValid()) return ''
  return d.format('HH:mm')
}

export function toDateInput(val: string | null | undefined): string {
  if (!val) return ''
  return String(val).slice(0, 10)
}

export function toTimeInput(val: string | null | undefined): string {
  if (!val) return ''
  return String(val).slice(0, 5)
}
