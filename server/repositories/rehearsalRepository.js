// Data-access helpers for rehearsals. Each query takes an `executor` (a pool or
// transaction client) so callers control transactions.

export async function listRehearsals(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM rehearsals WHERE tenant_id = $1 ORDER BY proposed_date ASC, id ASC',
    [tenantId],
  )
  return rows
}

export async function listUpcomingRehearsals(executor, tenantId, limit) {
  const { rows } = await executor.query(
    `SELECT * FROM rehearsals
     WHERE tenant_id = $1 AND status = 'planned' AND proposed_date >= CURRENT_DATE
     ORDER BY proposed_date ASC, id ASC
     LIMIT $2`,
    [tenantId, limit],
  )
  return rows
}

export async function listRehearsalsInRange(executor, tenantId, from, to) {
  const { rows } = await executor.query(
    `SELECT * FROM rehearsals
     WHERE tenant_id = $1 AND proposed_date BETWEEN $2 AND $3
     ORDER BY proposed_date ASC, id ASC`,
    [tenantId, from, to],
  )
  return rows
}

export async function fetchRehearsal(executor, rehearsalId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM rehearsals WHERE id = $1 AND tenant_id = $2',
    [rehearsalId, tenantId],
  )
  return rows[0] || null
}

export async function rehearsalExistsInTenant(executor, rehearsalId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM rehearsals WHERE id = $1 AND tenant_id = $2',
    [rehearsalId, tenantId],
  )
  return rowCount > 0
}

export async function loadParticipants(executor, rehearsalIds, tenantId) {
  if (!rehearsalIds.length) return new Map()
  const { rows } = await executor.query(
    `SELECT rp.rehearsal_id, rp.band_member_id, rp.vote,
            bm.name, bm.color, bm.position
     FROM rehearsal_participants rp
     JOIN band_members bm ON bm.id = rp.band_member_id AND bm.tenant_id = $2
     WHERE rp.rehearsal_id = ANY($1) AND rp.tenant_id = $2
     ORDER BY bm.sort_order ASC, bm.id ASC`,
    [rehearsalIds, tenantId],
  )
  const byRehearsal = new Map()
  for (const id of rehearsalIds) byRehearsal.set(id, [])
  for (const row of rows) {
    byRehearsal.get(row.rehearsal_id).push({
      band_member_id: row.band_member_id,
      name: row.name,
      color: row.color,
      position: row.position,
      vote: row.vote,
    })
  }
  return byRehearsal
}

export async function loadSongs(executor, rehearsalId, tenantId) {
  const { rows } = await executor.query(
    `SELECT rs.song_id, s.title, s.artist
     FROM rehearsal_songs rs
     JOIN songs s ON s.id = rs.song_id AND s.tenant_id = $2
     WHERE rs.rehearsal_id = $1 AND rs.tenant_id = $2
     ORDER BY s.title ASC, rs.song_id ASC`,
    [rehearsalId, tenantId],
  )
  return rows
}

export async function getBandMemberIdForUser(executor, userId, tenantId) {
  const { rows } = await executor.query(
    'SELECT id FROM band_members WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0]?.id ?? null
}

export async function getLeadMemberIds(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT id FROM band_members WHERE tenant_id = $1 AND position = 'lead'`,
    [tenantId],
  )
  return rows.map((r) => r.id)
}

export async function filterMemberIdsInTenant(executor, memberIds, tenantId) {
  if (!memberIds.length) return []
  const { rows } = await executor.query(
    'SELECT id FROM band_members WHERE id = ANY($1) AND tenant_id = $2',
    [memberIds, tenantId],
  )
  return rows.map((r) => r.id)
}

export async function insertRehearsal(executor, tenantId, data, createdByUserId) {
  const { rows } = await executor.query(
    `INSERT INTO rehearsals
       (tenant_id, proposed_date, start_time, end_time, location, notes, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      tenantId,
      data.proposed_date,
      data.start_time || null,
      data.end_time || null,
      data.location || null,
      data.notes || null,
      createdByUserId,
    ],
  )
  return rows[0]
}

export async function insertParticipant(executor, tenantId, rehearsalId, memberId, vote, updatedByUserId) {
  await executor.query(
    `INSERT INTO rehearsal_participants
       (tenant_id, rehearsal_id, band_member_id, vote, updated_by_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, rehearsalId, memberId, vote, updatedByUserId],
  )
}

export async function deleteParticipant(executor, rehearsalId, memberId, tenantId) {
  const { rowCount } = await executor.query(
    `DELETE FROM rehearsal_participants
     WHERE rehearsal_id = $1 AND band_member_id = $2 AND tenant_id = $3`,
    [rehearsalId, memberId, tenantId],
  )
  return rowCount > 0
}

export async function updateParticipantVote(executor, tenantId, rehearsalId, memberId, vote, updatedByUserId) {
  const { rows } = await executor.query(
    `UPDATE rehearsal_participants
     SET vote = $1, updated_by_user_id = $2, updated_at = NOW()
     WHERE rehearsal_id = $3 AND band_member_id = $4 AND tenant_id = $5
     RETURNING *`,
    [vote, updatedByUserId, rehearsalId, memberId, tenantId],
  )
  return rows[0] || null
}

// Locks the parent option before a response mutation. Every vote takes this
// lock, making the first-unavailable claim and incomplete -> complete check
// deterministic even when members respond concurrently.
export async function lockRehearsalOptionResponseState(executor, rehearsalId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, status, first_unavailable_notification_at
     FROM rehearsals
     WHERE id = $1 AND tenant_id = $2
     FOR UPDATE`,
    [rehearsalId, tenantId],
  )
  return rows[0] || null
}

export async function getRehearsalParticipantResponseState(executor, rehearsalId, memberId, tenantId) {
  const { rows } = await executor.query(
    `SELECT target.id AS participant_id, target.vote AS previous_vote,
            counts.total, counts.pending
     FROM rehearsal_participants target
     CROSS JOIN LATERAL (
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE vote IS NULL)::int AS pending
       FROM rehearsal_participants
       WHERE rehearsal_id = $1 AND tenant_id = $3
     ) counts
     WHERE target.rehearsal_id = $1 AND target.band_member_id = $2 AND target.tenant_id = $3`,
    [rehearsalId, memberId, tenantId],
  )
  return rows[0] || null
}

export async function markRehearsalFirstUnavailableNotified(executor, rehearsalId, tenantId) {
  await executor.query(
    `UPDATE rehearsals SET first_unavailable_notification_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND first_unavailable_notification_at IS NULL`,
    [rehearsalId, tenantId],
  )
}

// Counts of participants that haven't voted yes, used to gate the
// option → planned transition and the auto-demotion check.
export async function countVoteShortfall(executor, rehearsalId, tenantId) {
  const { rows } = await executor.query(
    `SELECT COUNT(*) FILTER (WHERE vote IS DISTINCT FROM 'yes')::int AS not_yes,
            COUNT(*)::int AS total
     FROM rehearsal_participants WHERE rehearsal_id = $1 AND tenant_id = $2`,
    [rehearsalId, tenantId],
  )
  return rows[0]
}

export async function getDemotionState(executor, rehearsalId, tenantId) {
  const { rows } = await executor.query(
    `SELECT r.status,
            BOOL_AND(rp.vote = 'yes') AS all_yes,
            COUNT(rp.id) AS n
     FROM rehearsals r
     LEFT JOIN rehearsal_participants rp
       ON rp.rehearsal_id = r.id AND rp.tenant_id = $2
     WHERE r.id = $1 AND r.tenant_id = $2
     GROUP BY r.status`,
    [rehearsalId, tenantId],
  )
  return rows[0] || null
}

export async function demoteToOption(executor, rehearsalId, tenantId) {
  await executor.query(
    `UPDATE rehearsals SET status = 'option', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [rehearsalId, tenantId],
  )
}

// Applies prebuilt SET fragments (placeholders $1..$N) to a rehearsal, appending
// updated_at and the WHERE bindings. Returns the updated row or null.
export async function updateRehearsalFields(executor, tenantId, rehearsalId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE rehearsals SET ${assignments.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *`,
    [...values, rehearsalId, tenantId],
  )
  return rows[0] || null
}

export async function touchRehearsal(executor, rehearsalId, tenantId) {
  await executor.query(
    'UPDATE rehearsals SET updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [rehearsalId, tenantId],
  )
}

export async function deleteRehearsal(executor, rehearsalId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM rehearsals WHERE id = $1 AND tenant_id = $2',
    [rehearsalId, tenantId],
  )
  return rowCount > 0
}

export async function insertRehearsalSong(executor, tenantId, rehearsalId, songId) {
  await executor.query(
    'INSERT INTO rehearsal_songs (tenant_id, rehearsal_id, song_id) VALUES ($1, $2, $3)',
    [tenantId, rehearsalId, songId],
  )
}

export async function deleteRehearsalSong(executor, rehearsalId, songId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM rehearsal_songs WHERE rehearsal_id = $1 AND song_id = $2 AND tenant_id = $3',
    [rehearsalId, songId, tenantId],
  )
  return rowCount > 0
}
