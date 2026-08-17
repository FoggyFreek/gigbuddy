// Wiring: the domains that own entitlement-gated data, imported for their
// registration side effect. Adding a purgeable feature means adding its domain
// module to shared/entitlements.js, the owning domain, and this list.
//
// This is imported by entitlementPurgeService itself, NOT only by apiRouter.
// The purge runs from three entrypoints — the HTTP downgrade flow, the payment
// ingestion hook and the scheduler safety net — and the scheduler never touches
// the router. Registering as a side effect of some other module's import would
// make "was the data actually deleted?" depend on import order; importing it
// from the service makes registration unconditional wherever the purge runs.
import '../music/songs/songPurge.js'
import '../people/profiles/profilePurge.js'
import '../platform/integrations/integrationPurge.js'
import { assertPurgeHandlersRegistered } from '../entitlements/purgeRegistry.js'

// A purgeable feature with no owner would silently retain data a downgrade
// promised to delete, so the gap is fatal here rather than at purge time.
assertPurgeHandlersRegistered()
