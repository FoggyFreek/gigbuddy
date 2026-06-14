// Namespaced DnD ids so set ids and item ids never collide in the drag layer.
// setlist_sets.id and setlist_items.id are independent sequences.
import type { Id } from '../../types/entities.ts'

export const itemDomId = (id: Id): string => `item:${id}`
export const setDomId = (id: Id): string => `set:${id}`
export const parseDomId = (domId: string | number): number => Number(String(domId).split(':')[1])
