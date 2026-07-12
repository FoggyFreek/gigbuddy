// Global user-administration domain logic. Route handlers stay thin and delegate
// here. Functions return { error: { status, body } } on expected failures and a
// domain payload on success. Audit events that need the request are returned as
// an `audit` { action, details } descriptor for the route to emit.
import {
  listUsersWithMemberships,
  getUserEmail,
  ownsAnyTenant,
  deleteUser as deleteUserRow,
} from '../repositories/adminUserRepository.js'
import { badRequest, notFound } from './serviceErrors.js'

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
  if (email === null) return notFound('User not found')

  if (email === process.env.ADMIN_EMAIL) {
    return {
      ...badRequest('Cannot delete the bootstrap admin user'),
      audit: deleteDenied(userId, email, 'bootstrap_admin'),
    }
  }
  if (userId === actingUserId) {
    return {
      ...badRequest('Cannot delete yourself'),
      audit: deleteDenied(userId, email, 'self_delete'),
    }
  }
  // tenants.owner_user_id is ON DELETE RESTRICT; surface a clear 409 instead
  // of an FK error — ownership must be reassigned (or the tenant deleted) first.
  if (await ownsAnyTenant(db, userId)) {
    return {
      error: {
        status: 409,
        body: { error: 'User owns one or more tenants', code: 'user_owns_tenants' },
      },
      audit: deleteDenied(userId, email, 'owns_tenants'),
    }
  }

  await deleteUserRow(db, userId)
  return { audit: { action: 'admin.user.delete', details: { targetUserId: userId, targetEmail: email } } }
}
