// Rehearsal domain logic. Route handlers stay thin and delegate here. Functions
// that can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function).
import pool from '../db/index.js'
import { withTransaction } from '../db/withTransaction.js'
import { hasPermission, PERMISSIONS } from '../auth/permissions.js'
import { dispatchNotification } from './notificationService.js'
import { logger } from '../utils/logger.js'
import {
  VALID_STATUSES,
  VALID_VOTES,
  buildRehearsalUpdateFields,
  normalizeExtraMemberIds,
} from '../validators/rehearsalValidators.js'
import {
  listRehearsals as listRehearsalRows,
  fetchRehearsal,
  listNextPlannedRehearsal,
  listUpcomingRehearsals as listUpcomingRehearsalRows,
  listPastRehearsals as listPastRehearsalRows,
  listRehearsalsInRange as listRehearsalsInRangeRows,
  rehearsalExistsInTenant,
  loadParticipants,
  loadSongs,
  getBandMemberIdForUser,
  getLeadMemberIds,
  filterMemberIdsInTenant,
  insertRehearsal,
  insertParticipant,
  deleteParticipant,
  updateParticipantVote,
  lockRehearsalOptionResponseState,
  getRehearsalParticipantResponseState,
  markRehearsalFirstUnavailableNotified,
  countVoteShortfall,
  getDemotionState,
  demoteToOption,
  updateRehearsalFields,
  touchRehearsal,
  deleteRehearsal as deleteRehearsalRow,
  insertRehearsalSong,
  deleteRehearsalSong,
} from '../repositories/rehearsalRepository.js'
import { bandMemberExistsInTenant } from '../repositories/bandMemberRepository.js'
import { songExistsInTenant } from '../repositories/songRepository.js'
import { parseListCursor, parseLocalDate } from '../validators/common.js'
import { badRequest, notFound } from './serviceErrors.js'
import { limitedCollection, windowedCollection } from './limitedCollectionService.js'

const NOT_FOUND = notFound('Not found')
const INVALID_TODAY = 'today must be a valid ISO date (YYYY-MM-DD)'
const INVALID_CURSOR = 'cursorDate and cursorId must be provided together and valid'

// ---------- notifications ----------

function rehearsalDateStr(rehearsal) {
  return rehearsal.proposed_date?.toISOString?.().slice(0, 10) ?? String(rehearsal.proposed_date)
}

// Each notify* returns the dispatch promise so callers can await persistence
// (the in-app rows) without a failure ever reaching the HTTP response.
export function notifyRehearsalCreated(tenantId, rehearsal) {
  return dispatchNotification({
    tenantId,
    type: 'rehearsal-new',
    title: 'New rehearsal option',
    body: [rehearsalDateStr(rehearsal), rehearsal.location].filter(Boolean).join(' · '),
    url: '/rehearsals',
    sourceType: 'rehearsal',
    sourceId: rehearsal.id,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
}

export function notifyRehearsalConfirmed(tenantId, rehearsal) {
  return dispatchNotification({
    tenantId,
    type: 'rehearsal-confirmed',
    title: 'Rehearsal confirmed!',
    body: rehearsalDateStr(rehearsal),
    url: '/rehearsals',
    sourceType: 'rehearsal',
    sourceId: rehearsal.id,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
}

export function notifyRehearsalOptionUnavailable(tenantId, rehearsal) {
  return dispatchNotification({
    tenantId,
    type: 'option-member-unavailable',
    title: `One or more band members aren't available for option ${rehearsalDateStr(rehearsal)}`,
    body: [rehearsalDateStr(rehearsal), rehearsal.location].filter(Boolean).join(' · '),
    url: `/rehearsals/${rehearsal.id}`,
    sourceType: 'rehearsal',
    sourceId: rehearsal.id,
    requiredPermission: PERMISSIONS.PLANNING_WRITE,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
}

export function notifyRehearsalOptionResponsesComplete(tenantId, rehearsal) {
  return dispatchNotification({
    tenantId,
    type: 'option-all-responded',
    title: `All required band members have responded for option ${rehearsalDateStr(rehearsal)}`,
    body: [rehearsalDateStr(rehearsal), rehearsal.location].filter(Boolean).join(' · '),
    url: `/rehearsals/${rehearsal.id}`,
    sourceType: 'rehearsal',
    sourceId: rehearsal.id,
    requiredPermission: PERMISSIONS.PLANNING_WRITE,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
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

export async function getNextRehearsal(db, tenantId) {
  const rehearsal = await listNextPlannedRehearsal(db, tenantId)
  if (!rehearsal) return { rehearsal: null }
  return getRehearsal(db, tenantId, rehearsal.id)
}

async function attachParticipants(db, tenantId, rehearsals) {
  if (!rehearsals.length) return []
  const byRehearsal = await loadParticipants(db, rehearsals.map((r) => r.id), tenantId)
  return rehearsals.map((r) => ({ ...r, participants: byRehearsal.get(r.id) || [] }))
}

export async function listUpcomingRehearsals(db, tenantId, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  return limitedCollection(query.limit, async (limit) =>
    attachParticipants(db, tenantId, await listUpcomingRehearsalRows(db, tenantId, today, limit)))
}

export async function listPastRehearsals(db, tenantId, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)

  const result = await limitedCollection(query.limit, (limit) =>
    listPastRehearsalRows(db, tenantId, today, limit, parsedCursor.cursor))
  if (result.error) return result

  const items = await attachParticipants(db, tenantId, result.items)
  const last = items[items.length - 1]
  const nextCursor = last && items.length === result.meta.limit
    ? { date: rehearsalDateStr(last), id: last.id }
    : null
  return { items, meta: { ...result.meta, nextCursor } }
}

export async function listRehearsalsInRange(db, tenantId, query = {}) {
  return windowedCollection(query, async (range) =>
    attachParticipants(db, tenantId, await listRehearsalsInRangeRows(db, tenantId, range.from, range.to)))
}

export async function listRehearsals(db, tenantId) {
  return attachParticipants(db, tenantId, await listRehearsalRows(db, tenantId))
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

  const rehearsal = await withTransaction(async (client) => {
    const created = await insertRehearsal(client, tenantId, body, userId)

    const leadIds = await getLeadMemberIds(client, tenantId)
    const extraIds = await filterMemberIdsInTenant(client, extras, tenantId)
    const memberIds = Array.from(new Set([...leadIds, ...extraIds]))
    const creatorMemberId = await getBandMemberIdForUser(client, userId, tenantId)

    for (const mid of memberIds) {
      const vote = mid === creatorMemberId ? 'yes' : null
      const updatedBy = mid === creatorMemberId ? userId : null
      await insertParticipant(client, tenantId, created.id, mid, vote, updatedBy)
    }
    return created
  })

  // Post-commit read (on the pool): the created rehearsal with its participants.
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
  if (!(await bandMemberExistsInTenant(db, memberId, tenantId))) {
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

export async function setParticipantVote(db, tenantId, userId, rehearsalId, memberId, body, caller = {}) {
  if (!('vote' in body)) {
    return { error: { status: 400, body: { error: 'vote is required' } } }
  }
  const vote = body.vote
  if (vote !== null && !VALID_VOTES.has(vote)) {
    return { error: { status: 400, body: { error: 'Invalid vote value' } } }
  }

  // Readers (no planning.write) may only set their own participation vote.
  if (!hasPermission(caller.role, PERMISSIONS.PLANNING_WRITE, { isSuperAdmin: caller.isSuperAdmin })) {
    const callerMemberId = await getBandMemberIdForUser(db, userId, tenantId)
    if (callerMemberId == null || memberId !== callerMemberId) {
      return { error: { status: 403, body: { error: 'Forbidden' } } }
    }
  }

  return withTransaction(async (client) => {
    const option = await lockRehearsalOptionResponseState(client, rehearsalId, tenantId)
    if (!option) return NOT_FOUND

    const responseState = await getRehearsalParticipantResponseState(client, rehearsalId, memberId, tenantId)
    if (!responseState) return NOT_FOUND

    const participant = await updateParticipantVote(client, tenantId, rehearsalId, memberId, vote, userId)
    if (!participant) return NOT_FOUND

    const isOption = option.status === 'option'
    const firstUnavailable = isOption
      && vote === 'no'
      && option.first_unavailable_notification_at == null
    const allResponded = isOption
      && responseState.previous_vote == null
      && vote != null
      && responseState.total > 0
      && responseState.pending === 1

    if (firstUnavailable) {
      await markRehearsalFirstUnavailableNotified(client, rehearsalId, tenantId)
    }
    await touchRehearsal(client, rehearsalId, tenantId)
    await autoDemoteIfNeeded(client, rehearsalId, tenantId)

    const rehearsal = await fetchRehearsal(client, rehearsalId, tenantId)
    return {
      rehearsal: await withParticipants(client, rehearsal, tenantId),
      notifications: { firstUnavailable, allResponded },
    }
  }, { db })
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
