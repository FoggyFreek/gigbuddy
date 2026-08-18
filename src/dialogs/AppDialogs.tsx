import { useTrialDialogs } from '../commerce/billing/useTrialDialogs.ts'

// Host for app-level prompts that are raised by state rather than by a click.
// Rendered once at the composition root; each watcher hook decides for itself
// whether it has anything to say, and renders nothing.
export default function AppDialogs() {
  useTrialDialogs()
  return null
}
