// Canonical on-site equipment catalogue, shared by the API validator and the UI.
// Adding an item is one entry here plus `detail.equipment.items.<key>` in both
// src/i18n/en/gigs.json and src/i18n/nl/gigs.json — the frontend union type makes
// a missing translation a compile error.
export const GIG_EQUIPMENT_ITEMS = Object.freeze({
  PA_SYSTEM: 'pa_system',
  DRUMKIT: 'drumkit',
  BASS_AMP: 'bass_amp',
  GUITAR_AMP: 'guitar_amp',
  STAGE_LIGHTS: 'stage_lights',
})

export const GIG_EQUIPMENT_ITEM_KEYS = Object.freeze(Object.values(GIG_EQUIPMENT_ITEMS))

// 'event' — already at the venue; 'band' — we bring it ourselves.
export const GIG_EQUIPMENT_PROVIDERS = Object.freeze(['event', 'band'])

export const DEFAULT_GIG_EQUIPMENT_PROVIDER = 'event'

export const MAX_GIG_EQUIPMENT_ITEMS = 60
