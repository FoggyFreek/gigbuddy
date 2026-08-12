// Data-access helpers for web-push subscriptions. Each query takes an `executor`
// (a pool or transaction client) so callers control transactions. Subscriptions
// are keyed by user, not tenant.

export async function upsertSubscription(executor, userId, endpoint, p256dh, auth) {
  await executor.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
    [userId, endpoint, p256dh, auth],
  )
}

export async function deleteSubscription(executor, endpoint, userId) {
  await executor.query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
    [endpoint, userId],
  )
}

// Rotates an existing subscription's endpoint (pushsubscriptionchange). Returns
// true when the (oldEndpoint, userId) pair matched a row.
export async function rotateEndpoint(executor, userId, newEndpoint, p256dh, auth, oldEndpoint) {
  const { rowCount } = await executor.query(
    `UPDATE push_subscriptions
       SET endpoint = $1, p256dh = $2, auth = $3
     WHERE endpoint = $4 AND user_id = $5`,
    [newEndpoint, p256dh, auth, oldEndpoint, userId],
  )
  return rowCount > 0
}
