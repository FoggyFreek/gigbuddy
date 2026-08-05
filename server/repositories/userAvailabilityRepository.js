// Data-access helpers for user-level availability. Unlike every other planning
// repository these queries are scoped by USER, not tenant: "busy on 14 March"
// is a fact about the person, and each band only ever reads a projection of it
// (redacted in the service — see availabilityProjection.js).
//
// The band-local `availability_slots` table still exists for band_members rows
// with `user_id IS NULL` (dep players, CRM-only entries); its queries live in
// availabilityRepository.js.

export async function listUserSlotsInRange(executor, userId, from, to) {
  const { rows } = await executor.query(
    `SELECT * FROM user_availability_slots
      WHERE user_id = $1 AND start_date <= $2 AND end_date >= $3
      ORDER BY start_date ASC, id ASC`,
    [userId, to, from],
  )
  return rows
}

// Slots for several musicians at once — the band-side grid reads every linked
// member in one statement instead of one query per member.
export async function listSlotsForUsersInRange(executor, userIds, from, to) {
  const { rows } = await executor.query(
    `SELECT * FROM user_availability_slots
      WHERE user_id = ANY($1) AND start_date <= $2 AND end_date >= $3
      ORDER BY start_date ASC, id ASC`,
    [userIds, to, from],
  )
  return rows
}

export async function fetchUserSlot(executor, slotId) {
  const { rows } = await executor.query(
    'SELECT * FROM user_availability_slots WHERE id = $1',
    [slotId],
  )
  return rows[0] || null
}

export async function insertUserSlot(executor, userId, {
  startDate, endDate, status, reason, createdByUserId, createdInTenantId,
}) {
  const { rows } = await executor.query(
    `INSERT INTO user_availability_slots
       (user_id, start_date, end_date, status, reason, created_by_user_id, created_in_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [userId, startDate, endDate, status, reason, createdByUserId, createdInTenantId],
  )
  return rows[0]
}

// The slot's owner is never patchable: a write either targets the caller's own
// calendar or a musician who delegated it, and both are resolved before this.
export async function updateUserSlotFields(executor, slotId, userId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE user_availability_slots SET ${assignments.join(', ')}
      WHERE id = $${whereIdx} AND user_id = $${whereIdx + 1} RETURNING *`,
    [...values, slotId, userId],
  )
  return rows[0] || null
}

export async function deleteUserSlot(executor, slotId, userId) {
  const { rowCount } = await executor.query(
    'DELETE FROM user_availability_slots WHERE id = $1 AND user_id = $2',
    [slotId, userId],
  )
  return rowCount > 0
}

// ---------- privacy and delegation ----------

export async function fetchAvailabilitySettings(executor, userId) {
  const { rows } = await executor.query(
    `SELECT availability_detail_visible, cross_band_gig_detail_visible
       FROM users WHERE id = $1`,
    [userId],
  )
  return rows[0] || null
}

export async function updateAvailabilitySettings(executor, userId, fields, values) {
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${whereIdx}
     RETURNING availability_detail_visible, cross_band_gig_detail_visible`,
    [...values, userId],
  )
  return rows[0] || null
}

// The per-band delegation list the musician manages from their own settings.
export async function listDelegations(executor, userId) {
  const { rows } = await executor.query(
    `SELECT m.tenant_id, t.display_name, m.availability_managed_by_band
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1 AND m.status = 'approved'
        AND t.archived_at IS NULL AND t.kind = 'band'
      ORDER BY t.display_name ASC, t.id ASC`,
    [userId],
  )
  return rows
}

// Only the musician themselves ever reaches this — the WHERE on user_id is the
// backstop for that, not merely a scope.
export async function setDelegation(executor, userId, tenantId, managed) {
  const { rows } = await executor.query(
    `UPDATE memberships SET availability_managed_by_band = $3
      WHERE user_id = $1 AND tenant_id = $2 AND status = 'approved'
     RETURNING tenant_id, availability_managed_by_band`,
    [userId, tenantId, managed],
  )
  return rows[0] || null
}

// Whether `userId` has let `tenantId` maintain their calendar. Read against the
// TARGET's membership row, never the writer's.
export async function isManagedByBand(executor, userId, tenantId) {
  const { rows } = await executor.query(
    `SELECT availability_managed_by_band FROM memberships
      WHERE user_id = $1 AND tenant_id = $2 AND status = 'approved'`,
    [userId, tenantId],
  )
  return rows[0]?.availability_managed_by_band === true
}

// The privacy flags of several musicians at once, for the band-side grid.
export async function fetchVisibilityForUsers(executor, userIds) {
  const { rows } = await executor.query(
    `SELECT id, availability_detail_visible, cross_band_gig_detail_visible
       FROM users WHERE id = ANY($1)`,
    [userIds],
  )
  return rows
}

// Bookings that make a musician busy without anyone entering a slot: gigs,
// rehearsals and band events in the OTHER tenants they are an approved member
// of. The tenant set is derived here from memberships — never supplied by a
// caller.
//
// `excludeTenantId` is the band doing the looking: its own gigs, rehearsals and
// events are already on its grid from their own endpoints, so projecting them
// again as busy blocks would render each one twice.
export async function listBookingsForUsersInRange(executor, userIds, from, to, excludeTenantId = null) {
  const { rows } = await executor.query(
    `WITH member_tenants AS (
       SELECT m.user_id, m.tenant_id, t.kind, bm.id AS band_member_id
         FROM memberships m
         JOIN tenants t ON t.id = m.tenant_id
         LEFT JOIN band_members bm ON bm.user_id = m.user_id AND bm.tenant_id = m.tenant_id
        WHERE m.user_id = ANY($1) AND m.status = 'approved' AND t.archived_at IS NULL
          AND t.deletion_status IS NULL
          AND ($4::int IS NULL OR m.tenant_id <> $4)
     )
     SELECT mt.user_id, 'gig' AS source, g.tenant_id, t.display_name AS tenant_name,
            g.id AS source_id, g.event_date AS start_date, g.event_date AS end_date,
            g.event_description AS title
       FROM member_tenants mt
       JOIN gigs g ON g.tenant_id = mt.tenant_id
       JOIN tenants t ON t.id = g.tenant_id
      WHERE g.event_date BETWEEN $2 AND $3 AND g.status <> 'option'
        AND (mt.kind = 'personal' OR EXISTS (
          SELECT 1 FROM gig_participants gp
           WHERE gp.tenant_id = g.tenant_id AND gp.gig_id = g.id
             AND gp.band_member_id = mt.band_member_id
        ))
     UNION ALL
     SELECT mt.user_id, 'rehearsal', r.tenant_id, t.display_name,
            r.id, r.proposed_date, r.proposed_date, r.location
       FROM member_tenants mt
       JOIN rehearsals r ON r.tenant_id = mt.tenant_id
       JOIN tenants t ON t.id = r.tenant_id
      WHERE r.proposed_date BETWEEN $2 AND $3 AND r.status <> 'option'
        AND (mt.kind = 'personal' OR EXISTS (
          SELECT 1 FROM rehearsal_participants rp
           WHERE rp.tenant_id = r.tenant_id AND rp.rehearsal_id = r.id
             AND rp.band_member_id = mt.band_member_id
        ))
     UNION ALL
     SELECT mt.user_id, 'band_event', e.tenant_id, t.display_name,
            e.id, e.start_date, e.end_date, e.title
       FROM member_tenants mt
       JOIN band_events e ON e.tenant_id = mt.tenant_id
       JOIN tenants t ON t.id = e.tenant_id
      WHERE e.start_date <= $3 AND e.end_date >= $2
        AND (mt.kind = 'personal' OR EXISTS (
          SELECT 1 FROM band_event_participants bep
           WHERE bep.tenant_id = e.tenant_id AND bep.band_event_id = e.id
             AND bep.band_member_id = mt.band_member_id
        ))`,
    [userIds, from, to, excludeTenantId],
  )
  return rows
}
