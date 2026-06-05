// Namespaced DnD ids so set ids and item ids never collide in the drag layer.
// setlist_sets.id and setlist_items.id are independent sequences.
export const itemDomId = (id) => `item:${id}`
export const setDomId = (id) => `set:${id}`
export const parseDomId = (domId) => Number(String(domId).split(':')[1])
