import { ACHIEVEMENT_DEFINITIONS } from '../achievements/definitions.js'
import { buildFacts } from '../achievements/factsBuilder.js'
import { fetchUnlocked, insertUnlocked } from '../repositories/achievementRepository.js'
import { dispatchNotification } from './notificationService.js'
import { logger } from '../utils/logger.js'

// Achievements are evaluated lazily on read: no scheduler, no cache while
// anything is still locked — a qualifying write is reflected on the very next
// read so the unlock (and its notification) feels immediate. The only cached
// state is the terminal one: once every definition is unlocked the payload can
// never change again (unlocks are permanent), so it is cached indefinitely.
// A deploy that ships new definitions restarts the process and clears it.
const fullyUnlockedCache = new Map() // tenantId -> payload

export function clearAchievementCache() {
  fullyUnlockedCache.clear()
}

function safeTest(definition, facts, unlockedKeys) {
  try {
    return definition.test(facts, unlockedKeys) === true
  } catch (err) {
    logger.warn('achievement.test_failed', { err, achievementKey: definition.key })
    return false
  }
}

function buildPayload(unlockedAtByKey) {
  return ACHIEVEMENT_DEFINITIONS.map((d) => ({
    key: d.key,
    category: d.category,
    cheers: d.cheers,
    unlocked_at: unlockedAtByKey.get(d.key) ?? null,
  }))
}

async function notifyUnlocked(tenantId, insertedRows) {
  for (const row of insertedRows) {
    const definition = ACHIEVEMENT_DEFINITIONS.find((d) => d.key === row.achievement_key)
    if (!definition) continue
    try {
      await dispatchNotification({
        tenantId,
        type: 'achievement-unlocked',
        title: `Achievement unlocked: ${definition.title}`,
        body: `Your band earned ${definition.cheers} cheers.`,
        url: '/achievements',
        sourceType: 'achievement',
        sourceId: row.id,
      })
    } catch (err) {
      logger.error('achievement.notify_failed', { err, tenantId })
    }
  }
}

export async function listAchievements(db, tenantId) {
  const cached = fullyUnlockedCache.get(tenantId)
  if (cached) return cached

  const unlockedRows = await fetchUnlocked(db, tenantId)
  const unlockedAtByKey = new Map(unlockedRows.map((r) => [r.achievement_key, r.unlocked_at]))
  // Baseline pass: a tenant with zero rows is being evaluated for the first
  // time (fresh tenant, or an existing tenant right after this feature
  // shipped). Whatever unlocks now reflects history, not a fresh event —
  // suppress notifications so members don't get a burst of stale pings.
  const isBaselinePass = unlockedRows.length === 0

  if (unlockedAtByKey.size < ACHIEVEMENT_DEFINITIONS.length) {
    const facts = await buildFacts(db, tenantId)
    const unlockedKeys = new Set(unlockedAtByKey.keys())
    const newKeys = []
    for (const definition of ACHIEVEMENT_DEFINITIONS) {
      if (unlockedKeys.has(definition.key)) continue
      if (safeTest(definition, facts, unlockedKeys)) {
        unlockedKeys.add(definition.key)
        newKeys.push(definition.key)
      }
    }
    if (newKeys.length) {
      const inserted = await insertUnlocked(db, tenantId, newKeys)
      for (const row of inserted) unlockedAtByKey.set(row.achievement_key, row.unlocked_at)
      if (!isBaselinePass) await notifyUnlocked(tenantId, inserted)
    }
  }

  const payload = buildPayload(unlockedAtByKey)
  if (unlockedAtByKey.size === ACHIEVEMENT_DEFINITIONS.length) {
    fullyUnlockedCache.set(tenantId, payload)
  }
  return payload
}
