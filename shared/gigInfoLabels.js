// Labels for a gig's "Additional information" blocks.
//
// A block's label is either one of the canonical keys below — translated for
// display, so a Dutch reader sees "Kleedkamer" where an English one sees
// "Dressing room" — or a label the user typed themselves, stored verbatim.
// `label_is_custom` is the explicit discriminator; the `label` column holds a
// key in the first case and the literal text in the second. Keep this list in
// step with the CHECK constraint in migration 190 and with the `infoBlocks`
// section of the gigs i18n namespace.

export const GIG_INFO_LABEL_KEYS = Object.freeze([
  'remarks',
  'timetable',
  'hospitality',
  'catering',
  'technical_information',
  'dressing_room',
  'light',
  'merchandise',
  'backline',
  'invoice_info',
  'press',
  'guestlist',
  'recording',
])

// Every gig shows this block, whether or not it has been written to yet; it is
// also where migration 190 parked the old free-text `gigs.notes`.
export const DEFAULT_GIG_INFO_LABEL_KEY = 'remarks'

export const MAX_GIG_INFO_BLOCKS = 30
export const MAX_GIG_INFO_LABEL_LENGTH = 60
export const MAX_GIG_INFO_CONTENT_LENGTH = 20000

export function isGigInfoLabelKey(value) {
  return GIG_INFO_LABEL_KEYS.includes(value)
}
