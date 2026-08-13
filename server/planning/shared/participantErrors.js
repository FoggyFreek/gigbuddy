import { conflict } from '../../platform/http/serviceErrors.js'

export const LAST_PARTICIPANT = conflict('An event must keep at least one participant', {
  code: 'last_participant',
})
