import {
  findAssignedTaskTenantForMember,
  listTasksAssignedToUserForMemberTenants,
} from '../tasks/taskRepository.js'
import { patchTask } from '../tasks/taskService.js'
import { limitedCollectionWithTotal } from '../../platform/collections/limitedCollectionService.js'
import { badRequest, notFound } from '../../platform/http/serviceErrors.js'
import { MAX_TASK_LIST_LIMIT, parseTaskDoneFilter } from '../tasks/taskValidators.js'

const NOT_FOUND = notFound('Not found')

// Always assigned to the caller. A client-supplied assignee never widens the
// member-derived tenant and task scope.
export async function listMyTasks(db, userId, scope, query = {}) {
  const done = parseTaskDoneFilter(query.done)
  if (done === null) return badRequest('done must be true or false')

  const result = await limitedCollectionWithTotal(query.limit, (limit) =>
    listTasksAssignedToUserForMemberTenants(db, userId, scope.ids, { done, limit }),
  MAX_TASK_LIST_LIMIT)
  if (result.error) return result
  return { ...result, items: result.items.map(scope.label) }
}

export async function setMyTaskDone(db, userId, scope, taskId, body = {}) {
  if (Object.keys(body).length !== 1 || typeof body.done !== 'boolean') {
    return badRequest('Only done may be updated')
  }
  const source = await findAssignedTaskTenantForMember(db, userId, scope.ids, taskId)
  if (!source) return NOT_FOUND
  const result = await patchTask(db, source.tenant_id, taskId, body, {
    role: 'reader', isSuperAdmin: false, userId,
  })
  if (result.error) return result.error.status === 403 ? NOT_FOUND : result
  return { task: scope.label(result.task) }
}
