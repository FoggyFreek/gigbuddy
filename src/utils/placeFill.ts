// Typed frontend wrapper over the shared never-overwrite merge. The runtime
// values come from `shared/placeFields.js`, which the server imports directly, so
// frontend preview and backend enforcement can never drift. The plain `.js` source
// has no signature tsc can use, so the types are declared here.
import {
  PLACE_FILLABLE_FIELDS as FIELDS,
  pickFillableUpdates as pickFillableUpdatesImpl,
} from '../../shared/placeFields.js'

export type PlaceField = (typeof FIELDS)[number]

export const PLACE_FILLABLE_FIELDS: readonly PlaceField[] = FIELDS

/**
 * Returns only the keys where `current` is blank and `suggestion` has a value, so
 * spreading the result can never clobber existing data.
 *
 * Both sides are `object` rather than `Record<string, unknown>` so plain interfaces
 * (`PlaceSuggestion`, which has no index signature) can be passed directly.
 */
export function pickFillableUpdates(
  current: object | null | undefined,
  suggestion: object | null | undefined,
  fields: readonly string[] = FIELDS,
): Record<string, string> {
  return pickFillableUpdatesImpl(current, suggestion, fields) as Record<string, string>
}
