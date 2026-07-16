// Task domain logic. Route handlers stay thin and delegate here. Functions that
// can fail with a specific HTTP outcome return { error: { status, body } };
// success returns { task } (or {} for deletes). Tasks may be linked to a gig or
// stand alone (gig_id null). The gig-nested routes in gigService delegate here so
// there is a single task implementation.
import {
  listTasks as listTaskRows,
  getTaskById,
  insertTask,
  updateTaskFields,
  deleteTaskById,
} from '../repositories/taskRepository.js'
import {
  gigExistsInTenant,
  getBandMemberIdForUser,
  getGigDescription,
} from '../repositories/gigRepository.js'
import { bandMemberExistsInTenant } from '../repositories/bandMemberRepository.js'
import { hasPermission, PERMISSIONS } from '../auth/permissions.js'
import { parseId, buildGigTaskUpdateFields } from '../validators/gigValidators.js'
import {
  MAX_TASK_LIST_LIMIT,
  parseTaskAssigneeFilter,
  parseTaskDoneFilter,
} from '../validators/taskValidators.js'
import { dispatchNotification } from './notificationService.js'
import { logger } from '../utils/logger.js'
import { badRequest, notFound } from './serviceErrors.js'
import { limitedCollectionWithTotal } from './limitedCollectionService.js'

const NOT_FOUND = notFound('Not found')

// ---------- notifications ----------

// Notifies the assignee that a task was assigned to them. Only the gig
// description read uses the caller's db — dispatchNotification deliberately
// runs on its own pool so it never joins the caller's transaction. An assignee
// who muted the band or the task-assigned type gets nothing (prefs apply).
async function notifyTaskAssignment(db, tenantId, task) {
  const description = task.gig_id ? await getGigDescription(db, task.gig_id, tenantId) : null
  const suffix = description ? ` (${description})` : ''
  await dispatchNotification({
    tenantId,
    type: 'task-assigned',
    title: 'Task assigned to you',
    body: `${task.title}${suffix}`,
    url: '/tasks',
    sourceType: 'task',
    sourceId: task.id,
    bandMemberId: task.assigned_to,
  }).catch((err) => logger.error('push.task_assignment_notify_failed', { err, tenantId, taskId: task.id }))
}

// ---------- internals ----------

// Validates assigned_to (when present) and returns a normalized copy of body with
// it parsed to an integer, leaving the input untouched. A null/absent assigned_to
// passes through unchanged (null clears the assignee). Returns
// { error } | { body: normalizedBody }.
async function resolveAssignee(db, tenantId, body) {
  if (!('assigned_to' in body) || body.assigned_to === null) return { body }
  const assignedTo = parseId(body.assigned_to)
  if (assignedTo === null) return { error: { status: 400, body: { error: 'Invalid assigned_to' } } }
  if (!(await bandMemberExistsInTenant(db, assignedTo, tenantId))) {
    return { error: { status: 404, body: { error: 'assigned_to not found' } } }
  }
  return { body: { ...body, assigned_to: assignedTo } }
}

// Readers (no planning.write) may only toggle `done` on a task assigned to their
// own band member. Any other field, an unassigned/foreign task, or an unlinked
// caller is rejected 403. Returns { error } on denial, or {} when allowed.
async function authorizeSelfPatch(db, tenantId, taskId, body, userId) {
  const forbidden = { error: { status: 403, body: { error: 'Forbidden' } } }
  const keys = Object.keys(body)
  const onlyDone = keys.length > 0 && keys.every((key) => key === 'done')
  if (!onlyDone) return forbidden

  const task = await getTaskById(db, taskId, tenantId)
  if (!task) return NOT_FOUND
  const callerMemberId = await getBandMemberIdForUser(db, userId, tenantId)
  if (callerMemberId == null || task.assigned_to !== callerMemberId) return forbidden
  return {}
}

// ---------- service API ----------

export async function listTasks(db, tenantId, userId, query = {}) {
  const done = parseTaskDoneFilter(query.done)
  if (done === null) return badRequest('done must be true or false')

  const assignee = parseTaskAssigneeFilter(query.assignee)
  if (assignee === null) return badRequest('assignee must be me or a positive member id')
  const assigneeId = assignee === 'me'
    ? await getBandMemberIdForUser(db, userId, tenantId)
    : assignee

  return limitedCollectionWithTotal(query.limit, (limit) =>
    listTaskRows(db, tenantId, { done, assigneeId, limit }), MAX_TASK_LIST_LIMIT)
}

// Creates a task. `title` is required. `gig_id` is optional — both absent and an
// explicit null mean "no gig"; only a non-null value is validated against the
// tenant's gigs. Fires the assignment push when assigned_to resolves.
export async function createTask(db, tenantId, body) {
  const { title, due_date, gig_id } = body
  if (!title) return { error: { status: 400, body: { error: 'title is required' } } }

  let gigId = null
  if (gig_id != null) {
    gigId = parseId(gig_id)
    if (gigId === null) return { error: { status: 400, body: { error: 'Invalid gig_id' } } }
    if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND
  }

  const assignee = await resolveAssignee(db, tenantId, body)
  if (assignee.error) return assignee

  const task = await insertTask(db, tenantId, {
    gigId,
    title,
    dueDate: due_date || null,
    assignedTo: assignee.body.assigned_to ?? null,
  })

  if (task.assigned_to) await notifyTaskAssignment(db, tenantId, task)
  return { task }
}

// Validates and applies a task PATCH. `caller` ({ role, isSuperAdmin, userId })
// gates the reader self-scope: holders of planning.write patch any field; readers
// only their own `done`. Returns { error } or { task }. Fires the assignment push
// when assigned_to is set.
export async function patchTask(db, tenantId, taskId, body, caller = {}) {
  if (!hasPermission(caller.role, PERMISSIONS.PLANNING_WRITE, { isSuperAdmin: caller.isSuperAdmin })) {
    const denial = await authorizeSelfPatch(db, tenantId, taskId, body, caller.userId)
    if (denial.error) return denial
  }

  const assignee = await resolveAssignee(db, tenantId, body)
  if (assignee.error) return assignee
  const normalizedBody = assignee.body

  const built = buildGigTaskUpdateFields(normalizedBody)
  if (!built.fields.length) return { error: { status: 400, body: { error: 'No valid fields to update' } } }

  const task = await updateTaskFields(db, tenantId, taskId, built.fields, built.values)
  if (!task) return NOT_FOUND

  if (normalizedBody.assigned_to) {
    await notifyTaskAssignment(db, tenantId, task)
  }
  return { task }
}

export async function removeTask(db, tenantId, taskId) {
  const deleted = await deleteTaskById(db, taskId, tenantId)
  return deleted ? {} : NOT_FOUND
}
