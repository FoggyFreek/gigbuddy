import { parsePositiveId } from './common.js'

export const MAX_TASK_LIST_LIMIT = 500

export function parseTaskDoneFilter(value) {
  if (value === undefined) return undefined
  if (value === 'true' || value === true) return true
  if (value === 'false' || value === false) return false
  return null
}

export function parseTaskAssigneeFilter(value) {
  if (value === undefined) return undefined
  if (value === 'me') return 'me'
  return parsePositiveId(value)
}
