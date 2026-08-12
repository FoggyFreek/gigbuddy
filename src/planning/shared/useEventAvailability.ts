import { useEffect, useRef, useState } from 'react'
import { evaluateEventAvailability } from '../availability/availability.ts'
import type { AvailabilitySummary, Id } from '../../types/entities.ts'

interface Options {
  eventDate?: string
  endDate?: string
  eventType?: 'gig' | 'rehearsal' | 'band_event'
  eventId?: Id
  startTime?: string | null
  endTime?: string | null
  participantIds?: Id[]
  onDataLoad?: (data: AvailabilitySummary | null) => void
}

export default function useEventAvailability({
  eventDate,
  endDate,
  eventType = 'band_event',
  eventId,
  startTime,
  endTime,
  participantIds,
  onDataLoad,
}: Readonly<Options>) {
  const [data, setData] = useState<AvailabilitySummary | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const participantKey = participantIds?.join(',') ?? null

  useEffect(() => {
    if (!eventDate) return

    clearTimeout(timerRef.current ?? undefined)
    timerRef.current = setTimeout(() => {
      if (endDate && endDate < eventDate) {
        setData(null)
        onDataLoad?.(null)
        return
      }
      evaluateEventAvailability({
        event_type: eventType,
        ...(eventId === undefined ? {} : { event_id: eventId }),
        start_date: eventDate,
        end_date: endDate || eventDate,
        start_time: startTime || null,
        end_time: endTime || null,
        ...(participantKey === null
          ? {}
          : { participant_ids: participantKey ? participantKey.split(',').map(Number) : [] }),
      })
        .then((result) => {
          setData(result)
          onDataLoad?.(result)
        })
        .catch(() => {
          setData(null)
          onDataLoad?.(null)
        })
    }, 300)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [eventDate, endDate, eventType, eventId, startTime, endTime, participantKey, onDataLoad])

  return data
}
