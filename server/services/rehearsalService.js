// Rehearsal domain logic. Route handlers stay thin and delegate here. Functions
// that can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function).
import pool from '../db/index.js'
import { sendPushToTenant } from '../utils/sendPush.js'
import {
  VALID_STATUSES,
  VALID_VOTES,
  buildRehearsalUpdateFields,
  normalizeExtraMemberIds,
} from '../validators/rehearsalValidators.js'
import {
  listRehearsals as listRehearsalRows,
  fetchRehearsal,
  rehearsalExistsInTenant,
  memberExistsInTenant,
  songExistsInTenant,
  loadParticipants,
  loadSongs,
  getBandMemberIdForUser,
  getLeadMemberIds,
  filterMemberIdsInTenant,
  insertRehearsal,
  insertParticipant,
  deleteParticipant,
  updateParticipantVote,
  countVoteShortfall,
  getDemotionState,
  demoteToOption,
  updateRehearsalFields,
  touchRehearsal,
  deleteRehearsal as deleteRehearsalRow,
  insertRehearsalSong,
  deleteRehearsalSong,
} from '../repositories/rehearsalRepository.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

// ---------- notifications ----------

function rehearsalDateStr(rehearsal) {
  return rehearsal.proposed_date?.toISOString?.().slice(0, 10) ?? String(rehearsal.proposed_date)
}

export function notifyRehearsalCreated(tenantId, rehearsal) {
  sendPushToTenant(tenantId, {
    title: 'New rehearsal option',
    body: [rehearsalDateStr(rehearsal), rehearsal.location].filter(Boolean).join(' · '),
    tag: 'rehearsal-new',
    url: '/rehearsals',
  }).catch((err) => console.error('[push] sendPushToTenant failed', err))
}

export function notifyRehearsalConfirmed(tenantId, rehearsal) {
  sendPushToTenant(tenantId, {
    title: 'Rehearsal confirmed!',
    body: rehearsalDateStr(rehearsal),
    tag: 'rehearsal-confirmed',
    url: '/rehearsals',
  }).catch((err) => console.error('[push] sendPushToTenant failed', err))
}

// ---------- internals ----------

async function withParticipants(db, rehearsal, tenantId) {
  const byRehearsal = await loadParticipants(db, [rehearsal.id], tenantId)
  return { ...rehearsal, participants: byRehearsal.get(rehearsal.id) || [] }
}

// A planned rehearsal falls back to 'option' when not every participant has
// voted yes (e.g. after adding a participant or changing a vote).
async function autoDemoteIfNeeded(db, rehearsalId, tenantId) {
  const state = await getDemotionState(db, rehearsalId, tenantId)
  if (!state) return
  if (state.status === 'planned' && (Number(state.n) === 0 || state.all_yes !== true)) {
    await demoteToOption(db, rehearsalId, tenantId)
  }
}

// ---------- reads ----------

export async function listRehearsals(db, tenantId) {
  const rehearsals = await listRehearsalRows(db, tenantId)
  if (!rehearsals.length) return []
  const byRehearsal = await loadParticipants(db, rehearsals.map((r) => r.id), tenantId)
  return rehearsals.map((r) => ({ ...r, participants: byRehearsal.get(r.id) || [] }))
}

export async function getRehearsal(db, tenantId, rehearsalId) {
  const rehearsal = await fetchRehearsal(db, rehearsalId, tenantId)
  if (!rehearsal) return NOT_FOUND
  const [byRehearsal, songs] = await Promise.all([
    loadParticipants(db, [rehearsalId], tenantId),
    loadSongs(db, rehearsalId, tenantId),
  ])
  return { rehearsal: { ...rehearsal, participants: byRehearsal.get(rehearsalId) || [], songs } }
}

// ---------- writes ----------

// Creates the rehearsal plus its initial participants (all lead members, valid
// extras, creator voting yes) in one transaction. The caller fires the
// created notification. Returns { error } | { rehearsal }.
export async function createRehearsal(tenantId, userId, body) {
  if (!body.proposed_date) {
    return { error: { status: 400, body: { error: 'proposed_date is required' } } }
  }
  const extras = normalizeExtraMemberIds(body.extra_member_ids)

  const client = await pool.connect()
  let rehearsal
  try {
    await client.query('BEGIN')

    rehearsal = await insertRehearsal(client, tenantId, body, userId)

    const leadIds = await getLeadMemberIds(client, tenantId)
    const extraIds = await filterMemberIdsInTenant(client, extras, tenantId)
    const memberIds = Array.from(new Set([...leadIds, ...extraIds]))
    const creatorMemberId = await getBandMemberIdForUser(client, userId, tenantId)

    for (const mid of memberIds) {
      const vote = mid === creatorMemberId ? 'yes' : null
      const updatedBy = mid === creatorMemberId ? userId : null
      await insertParticipant(client, tenantId, rehearsal.id, mid, vote, updatedBy)
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return { rehearsal: await withParticipants(pool, rehearsal, tenantId) }
}

// Validates and applies a rehearsal PATCH. Returns { error } or
// { rehearsal, confirmed } — `confirmed` is true when this PATCH set the
// status to planned; the caller fires the confirmed notification.
export async function patchRehearsal(db, tenantId, rehearsalId, body) {
  if ('status' in body) {
    if (!VALID_STATUSES.has(body.status)) {
      return { error: { status: 400, body: { error: 'Invalid status value' } } }
    }
    if (body.status === 'planned') {
      const { not_yes, total } = await countVoteShortfall(db, rehearsalId, tenantId)
      if (total === 0 || not_yes > 0) {
        return { error: { status: 400, body: { error: 'All required participants must vote yes' } } }
      }
    }
  }

  const built = buildRehearsalUpdateFields(body)
  if (!built.fields.length) {
    return { error: { status: 400, body: { error: 'No valid fields to update' } } }
  }

  const updated = await updateRehearsalFields(db, tenantId, rehearsalId, built.fields, built.values)
  if (!updated) return NOT_FOUND

  return {
    rehearsal: await withParticipants(db, updated, tenantId),
    confirmed: updated.status === 'planned' && body.status === 'planned',
  }
}

export async function deleteRehearsal(db, tenantId, rehearsalId) {
  const deleted = await deleteRehearsalRow(db, rehearsalId, tenantId)
  return deleted ? {} : NOT_FOUND
}

// ---------- participants ----------

export async function addParticipant(db, tenantId, userId, rehearsalId, memberId) {
  if (!(await memberExistsInTenant(db, memberId, tenantId))) {
    return { error: { status: 404, body: { error: 'band_member not found' } } }
  }
  if (!(await rehearsalExistsInTenant(db, rehearsalId, tenantId))) return NOT_FOUND

  const creatorMemberId = await getBandMemberIdForUser(db, userId, tenantId)
  const vote = memberId === creatorMemberId ? 'yes' : null
  const updatedBy = memberId === creatorMemberId ? userId : null

  try {
    await insertParticipant(db, tenantId, rehearsalId, memberId, vote, updatedBy)
  } catch (err) {
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'Already a participant' } } }
    }
    throw err
  }

  await touchRehearsal(db, rehearsalId, tenantId)
  await autoDemoteIfNeeded(db, rehearsalId, tenantId)

  const rehearsal = await fetchRehearsal(db, rehearsalId, tenantId)
  return { rehearsal: await withParticipants(db, rehearsal, tenantId) }
}

export async function removeParticipant(db, tenantId, rehearsalId, memberId) {
  const removed = await deleteParticipant(db, rehearsalId, memberId, tenantId)
  if (!removed) return NOT_FOUND
  await touchRehearsal(db, rehearsalId, tenantId)
  return {}
}

export async function setParticipantVote(db, tenantId, userId, rehearsalId, memberId, body) {
  if (!('vote' in body)) {
    return { error: { status: 400, body: { error: 'vote is required' } } }
  }
  const vote = body.vote
  if (vote !== null && !VALID_VOTES.has(vote)) {
    return { error: { status: 400, body: { error: 'Invalid vote value' } } }
  }

  const participant = await updateParticipantVote(db, tenantId, rehearsalId, memberId, vote, userId)
  if (!participant) return NOT_FOUND

  await touchRehearsal(db, rehearsalId, tenantId)
  await autoDemoteIfNeeded(db, rehearsalId, tenantId)

  const rehearsal = await fetchRehearsal(db, rehearsalId, tenantId)
  return { rehearsal: await withParticipants(db, rehearsal, tenantId) }
}

// ---------- songs ----------

export async function linkSong(db, tenantId, rehearsalId, songId) {
  if (!(await rehearsalExistsInTenant(db, rehearsalId, tenantId))) return NOT_FOUND
  if (!(await songExistsInTenant(db, songId, tenantId))) {
    return { error: { status: 404, body: { error: 'song not found' } } }
  }

  try {
    await insertRehearsalSong(db, tenantId, rehearsalId, songId)
  } catch (err) {
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'Song already linked' } } }
    }
    throw err
  }

  const rehearsal = await fetchRehearsal(db, rehearsalId, tenantId)
  const [byRehearsal, songs] = await Promise.all([
    loadParticipants(db, [rehearsalId], tenantId),
    loadSongs(db, rehearsalId, tenantId),
  ])
  return { rehearsal: { ...rehearsal, participants: byRehearsal.get(rehearsalId) || [], songs } }
}

export async function unlinkSong(db, tenantId, rehearsalId, songId) {
  const removed = await deleteRehearsalSong(db, rehearsalId, songId, tenantId)
  return removed ? {} : NOT_FOUND
}
