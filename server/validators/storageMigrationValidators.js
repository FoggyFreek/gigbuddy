const ACTIONS = new Set(['inventory', 'copy', 'validate', 'delete_rustfs'])

export function validateStorageMigrationAction(action) {
  if (!ACTIONS.has(action)) {
    return { error: { status: 400, body: { error: 'Invalid storage migration action' } } }
  }
  return { value: action }
}

export function validateRustfsDeleteConfirmation(body, tenant) {
  if (body?.confirmationSlug !== tenant.slug || body?.confirmationPhrase !== 'DELETE RUSTFS COPIES') {
    return { error: { status: 400, body: { error: 'Storage deletion confirmation does not match' } } }
  }
  return { value: true }
}
