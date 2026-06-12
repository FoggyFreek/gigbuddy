export const CONTACT_CATEGORIES = ['press', 'radio & tv', 'booker', 'promotion', 'network']
export const SUPPLIER_CATEGORY = 'supplier'
export const ALL_CONTACT_CATEGORIES = [...CONTACT_CATEGORIES, SUPPLIER_CATEGORY]

export const CONTACT_CATEGORY_LABELS = {
  'press': 'Press',
  'radio & tv': 'Radio & TV',
  'booker': 'Booker',
  'promotion': 'Promotion',
  'network': 'Network',
  'supplier': 'Supplier',
}

export const CONTACT_CATEGORY_COLORS = {
  'press': 'default',
  'radio & tv': 'primary',
  'booker': 'secondary',
  'promotion': 'warning',
  'network': 'success',
  'supplier': 'info',
}

export function contactMatchesCategoryFilter(contact, { category, excludeCategory } = {}) {
  if (category && contact.category !== category) return false
  if (excludeCategory && contact.category === excludeCategory) return false
  return true
}
