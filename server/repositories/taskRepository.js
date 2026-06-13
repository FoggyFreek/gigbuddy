// Data-access helpers for gig tasks. Each query takes an `executor` (a pool or
// transaction client) so callers control transactions. Every query is scoped by
// tenant_id.

// All open/done tasks across the tenant's gigs, enriched with gig + assignee
// context for the cross-gig task list.
export async function listGigTasks(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT t.id, t.gig_id, t.title, t.done, t.due_date, t.created_at,
            g.event_description, g.event_date,
            t.assigned_to,
            bm.name AS assigned_to_name
     FROM gig_tasks t
     JOIN gigs g ON g.id = t.gig_id AND g.tenant_id = $1
     LEFT JOIN band_members bm ON bm.id = t.assigned_to AND bm.tenant_id = $1
     WHERE t.tenant_id = $1
     ORDER BY t.done ASC, t.due_date ASC NULLS LAST, t.created_at ASC`,
    [tenantId],
  )
  return rows
}
