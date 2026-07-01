import dayjs from 'dayjs'
import Alert from '@mui/material/Alert'

interface PastEventAlertProps {
  /** The event date (ISO date or datetime string). The event is "past" when this date is before today. */
  date?: string | Date | null
}

/**
 * Warning banner shown on detail pages for events whose date is in the past,
 * reminding users to be careful when editing a historical event.
 */
export default function PastEventAlert({ date }: Readonly<PastEventAlertProps>) {
  if (!date) return null
  const eventDay = dayjs(date)
  if (!eventDay.isValid()) return null
  if (!eventDay.isBefore(dayjs(), 'day')) return null

  return (
    <Alert severity="warning" sx={{ mb: 3 }}>
      This event has occurred in the past, be careful when making changes.
    </Alert>
  )
}
