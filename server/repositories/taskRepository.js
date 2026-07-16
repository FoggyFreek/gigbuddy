// Data-access helpers for tasks. Each query takes an `executor` (a pool or
// transaction client) so callers control transactions. Every query is scoped by
// tenant_id. Tasks may be linked to a gig (gig_id) or stand alone (gig_id NULL).

// All open/done tasks across the tenant, enriched with gig + assignee context for
// the cross-gig task list. LEFT JOIN to gigs so gig-less tasks still appear (their
// event_description/event_date come back null).
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
    `SELECT t.id, t.gig_id, t.title, t.done, t.due_date, t.created_at,
            (COUNT(*) OVER ())::int AS collection_total,
            g.event_description, g.event_date,
            t.assigned_to,
            bm.name AS assigned_to_name
     FROM gig_tasks t
     LEFT JOIN gigs g ON g.id = t.gig_id AND g.tenant_id = t.tenant_id
     LEFT JOIN band_members bm ON bm.id = t.assigned_to AND bm.tenant_id = t.tenant_id
     WHERE ${predicates.join(' AND ')}
     ORDER BY t.done ASC, t.due_date ASC NULLS LAST, t.created_at ASC, t.id ASC
     LIMIT ${limitPlaceholder}`,
    values,
  )
  return {
    items: rows.map(({ collection_total: _collectionTotal, ...task }) => task),
    total: rows[0]?.collection_total ?? 0,
  }
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
