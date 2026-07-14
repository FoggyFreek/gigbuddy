// Generic in-app tutorial system. Tutorials are informational, dismissible
// overlays defined by the frontend registry (src/tutorials/registry.tsx); this
// service only persists per-user dismissals so a tutorial isn't re-shown. Adding
// a tutorial is a frontend-only change — no key allow-list here (the validator
// bounds the key format).
import { dismissTutorial as dismissTutorialRow } from '../repositories/authRepository.js'

export async function dismissTutorial(db, userId, key) {
  await dismissTutorialRow(db, userId, key)
  return {}
}
