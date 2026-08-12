// Data-access helpers for tasks. Each query takes an `executor` (a pool or
// transaction client) so callers control transactions. Every query is scoped by
// tenant_id. Tasks may be linked to a gig (gig_id) or stand alone (gig_id NULL).

// All open/done tasks across the tenant, enriched with gig + assignee context for
// the cross-gig task list. LEFT JOIN to gigs so gig-less tasks still appear (their
// event_description/event_date come back null).
const TASK_LIST_PROJECTION = `t.id, t.gig_id, t.title, t.done, t.due_date, t.created_at,
  (COUNT(*) OVER ())::int AS collection_total,
  g.event_description, g.event_date,
  t.assigned_to,
  bm.name AS assigned_to_name`
const TASK_LIST_ORDER = 't.done ASC, t.due_date ASC NULLS LAST, t.created_at ASC, t.id ASC'

export async function listTasks(executor, tenantId, { done, assigneeId, limit }) {
  const values = [tenantId]
  const predicates = ['t.tenant_id = $1']

  if (done !== undefined) {
    values.push(done)
    predicates.push(`t.done = $${values.length}`)
  }
  if (assigneeId !== undefined) {
    values.push(assigneeId)
    predicates.push(`t.assigned_to = $${values.length}`)
  }

  values.push(limit)
  const limitPlaceholder = `$${values.length}`

  const { rows } = await executor.query(
    `SELECT ${TASK_LIST_PROJECTION}
     FROM gig_tasks t
     LEFT JOIN gigs g ON g.id = t.gig_id AND g.tenant_id = t.tenant_id
     LEFT JOIN band_members bm ON bm.id = t.assigned_to AND bm.tenant_id = t.tenant_id
     WHERE ${predicates.join(' AND ')}
     ORDER BY ${TASK_LIST_ORDER}
     LIMIT ${limitPlaceholder}`,
    values,
  )
  return {
    items: rows.map(({ collection_total: _collectionTotal, ...task }) => task),
    total: rows[0]?.collection_total ?? 0,
  }
}

export async function listTasksAssignedToUserForMemberTenants(executor, userId, tenantIds, { done, limit }) {
  const values = [userId, tenantIds]
  const predicates = ["(source_tenant.kind = 'personal' OR bm.user_id = $1)", 't.tenant_id = ANY($2)']

  if (done !== undefined) {
    values.push(done)
    predicates.push(`t.done = $${values.length}`)
  }

  values.push(limit)
  const { rows } = await executor.query(
    `SELECT t.tenant_id, ${TASK_LIST_PROJECTION}
     FROM gig_tasks t
     JOIN tenants source_tenant ON source_tenant.id = t.tenant_id
     LEFT JOIN band_members bm ON bm.id = t.assigned_to AND bm.tenant_id = t.tenant_id
     LEFT JOIN gigs g ON g.id = t.gig_id AND g.tenant_id = t.tenant_id
     WHERE ${predicates.join(' AND ')}
     ORDER BY ${TASK_LIST_ORDER}
     LIMIT $${values.length}`,
    values,
  )
  return {
    items: rows.map(({ collection_total: _collectionTotal, ...task }) => task),
    total: rows[0]?.collection_total ?? 0,
  }
}

// Global-search read: matches tasks on their description (the `title` column).
// LEFT JOIN to gigs so standalone tasks are searchable too and gig-linked ones
// carry the context the caller needs to deep-link into the gig's task tab.
export async function searchTasks(executor, tenantId, like, limit) {
  const { rows } = await executor.query(
    `SELECT t.id, t.gig_id, t.title, t.done, t.due_date,
            g.event_description, g.event_date
       FROM gig_tasks t
       LEFT JOIN gigs g ON g.id = t.gig_id AND g.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1 AND t.title ILIKE $2
      ORDER BY t.done ASC, t.due_date ASC NULLS LAST, t.title ASC, t.id ASC
      LIMIT $3`,
    [tenantId, like, limit],
  )
  return rows
}

export async function findAssignedTaskTenantForMember(executor, userId, tenantIds, taskId) {
  const { rows } = await executor.query(
    `SELECT t.tenant_id, t.gig_id
       FROM gig_tasks t
       JOIN band_members bm ON bm.id = t.assigned_to AND bm.tenant_id = t.tenant_id
      WHERE t.id = $3 AND t.tenant_id = ANY($2) AND bm.user_id = $1`,
    [userId, tenantIds, taskId],
  )
  return rows[0] ?? null
}

export async function getTaskById(executor, taskId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM gig_tasks WHERE id = $1 AND tenant_id = $2',
    [taskId, tenantId],
  )
  return rows[0] || null
}

export async function insertTask(executor, tenantId, { gigId, title, dueDate, assignedTo }) {
  const { rows } = await executor.query(
    `INSERT INTO gig_tasks (tenant_id, gig_id, title, due_date, assigned_to)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, gigId ?? null, title, dueDate ?? null, assignedTo ?? null],
  )
  return rows[0]
}

export async function updateTaskFields(executor, tenantId, taskId, fields, values) {
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE gig_tasks SET ${fields.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *`,
    [...values, taskId, tenantId],
  )
  return rows[0] || null
}

export async function deleteTaskById(executor, taskId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM gig_tasks WHERE id = $1 AND tenant_id = $2',
    [taskId, tenantId],
  )
  return rowCount > 0
}
