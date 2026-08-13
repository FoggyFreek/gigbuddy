import { resolveEventEndDate, timeToMinutes } from '../../../shared/eventTimes.js'
import { validateTimeValues } from '../../platform/http/requestValidators.js'

export function normalizeSingleDayEventTiming(body, current, dateField) {
  const startDate = dateField in body ? body[dateField] : current?.[dateField]
  const startTime = 'start_time' in body ? body.start_time : current?.start_time
  const endTime = 'end_time' in body ? body.end_time : current?.end_time

  const timeError = validateTimeValues(startTime, endTime)
  if (timeError) return { error: timeError }
  if (startTime && endTime && timeToMinutes(startTime) === timeToMinutes(endTime)) {
    return { error: 'end_time must be after start_time' }
  }

  return {
    body: {
      ...body,
      end_date: resolveEventEndDate(startDate, startDate, startTime, endTime) || null,
    },
  }
}
