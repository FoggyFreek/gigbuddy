import {
  GIG_EQUIPMENT_ITEMS as ITEM_VALUES,
  GIG_EQUIPMENT_ITEM_KEYS as ITEM_KEYS,
  DEFAULT_GIG_EQUIPMENT_PROVIDER as DEFAULT_PROVIDER,
} from '../../shared/gigEquipment.js'

export { GIG_EQUIPMENT_ITEMS, MAX_GIG_EQUIPMENT_ITEMS } from '../../shared/gigEquipment.js'

// The literal union keeps `t($ => $.detail.equipment.items[key])` a compile-time
// completeness check, so a catalogue entry added without translations fails
// type-check rather than rendering a raw key.
export type GigEquipmentItemKey = (typeof ITEM_VALUES)[keyof typeof ITEM_VALUES]

export type GigEquipmentProvider = 'event' | 'band'

export const GIG_EQUIPMENT_ITEM_KEYS = ITEM_KEYS as readonly GigEquipmentItemKey[]

export const DEFAULT_GIG_EQUIPMENT_PROVIDER = DEFAULT_PROVIDER as GigEquipmentProvider
