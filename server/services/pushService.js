// Web-push subscription domain logic. Route handlers stay thin and delegate
// here. Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns {}.
import { parseSubscription } from '../validators/pushValidators.js'
import {
  upsertSubscription,
  deleteSubscription,
  rotateEndpoint,
} from '../repositories/pushRepository.js'

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

export async function subscribe(db, userId, body) {
  const parsed = parseSubscription(body)
  if (parsed.error) return badRequest(parsed.error)
  await upsertSubscription(db, userId, parsed.endpoint, parsed.p256dh, parsed.auth)
  return {}
}

export async function unsubscribe(db, userId, body) {
  const { endpoint } = body || {}
  if (!endpoint) return badRequest('endpoint is required')
  await deleteSubscription(db, endpoint, userId)
  return {}
}

// Browser rotated the endpoint: update the matching old row in place, falling
// back to an upsert of the new endpoint when no old row matched.
export async function resubscribe(db, userId, body) {
  const parsed = parseSubscription(body)
  if (parsed.error) return badRequest(parsed.error)

  if (parsed.oldEndpoint) {
    const rotated = await rotateEndpoint(
      db, userId, parsed.endpoint, parsed.p256dh, parsed.auth, parsed.oldEndpoint,
    )
    if (rotated) return {}
  }
  await upsertSubscription(db, userId, parsed.endpoint, parsed.p256dh, parsed.auth)
  return {}
}
