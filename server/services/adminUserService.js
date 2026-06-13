// Global user-administration domain logic. Route handlers stay thin and delegate
// here. Functions return { error: { status, body } } on expected failures and a
// domain payload on success. Audit events that need the request are returned as
// an `audit` { action, details } descriptor for the route to emit.
import {
  listUsersWithMemberships,
  getUserEmail,
  deleteUser as deleteUserRow,
} from '../repositories/adminUserRepository.js'

function badRequest(error) {
  return { status: 400, body: { error } }
}

function notFound(error) {
  return { status: 404, body: { error } }
}

function deleteDenied(targetUserId, targetEmail, reason) {
  return { action: 'admin.user.delete.denied', details: { targetUserId, targetEmail, reason } }
}

export async function listUsers(db) {
  return listUsersWithMemberships(db)
}

// Deletes a user, refusing the bootstrap admin and self-deletion. actingUserId
// is the caller; ADMIN_EMAIL identifies the protected bootstrap account.
export async function deleteUser(db, actingUserId, userId) {
  const email = await getUserEmail(db, userId)
  if (email === null) return { error: notFound('User not found') }

  if (email === process.env.ADMIN_EMAIL) {
    return {
      error: badRequest('Cannot delete the bootstrap admin user'),
      audit: deleteDenied(userId, email, 'bootstrap_admin'),
    }
  }
  if (userId === actingUserId) {
    return {
      error: badRequest('Cannot delete yourself'),
      audit: deleteDenied(userId, email, 'self_delete'),
    }
  }

  await deleteUserRow(db, userId)
  return { audit: { action: 'admin.user.delete', details: { targetUserId: userId, targetEmail: email } } }
}
