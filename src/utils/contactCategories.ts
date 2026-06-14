import type { ChipProps } from '@mui/material/Chip'
import type { Contact } from '../types/entities.ts'

export type ContactCategory = 'press' | 'radio & tv' | 'booker' | 'promotion' | 'network'
export type AllContactCategory = ContactCategory | 'supplier'
type ChipColor = NonNullable<ChipProps['color']>

export const CONTACT_CATEGORIES: ContactCategory[] = ['press', 'radio & tv', 'booker', 'promotion', 'network']
export const SUPPLIER_CATEGORY = 'supplier' as const
export const ALL_CONTACT_CATEGORIES: AllContactCategory[] = [...CONTACT_CATEGORIES, SUPPLIER_CATEGORY]

export const CONTACT_CATEGORY_LABELS: Record<AllContactCategory, string> = {
  'press': 'Press',
  'radio & tv': 'Radio & TV',
  'booker': 'Booker',
  'promotion': 'Promotion',
  'network': 'Network',
  'supplier': 'Supplier',
}

export const CONTACT_CATEGORY_COLORS: Record<AllContactCategory, ChipColor> = {
  'press': 'default',
  'radio & tv': 'primary',
  'booker': 'secondary',
  'promotion': 'warning',
  'network': 'success',
  'supplier': 'info',
}

function isContactCategory(category: string | null | undefined): category is AllContactCategory {
  return category != null && category in CONTACT_CATEGORY_LABELS
}

/** Display label for a (possibly unknown/legacy) category string. */
export function contactCategoryLabel(category: string | null | undefined): string {
  return isContactCategory(category) ? CONTACT_CATEGORY_LABELS[category] : category ?? ''
}

/** MUI Chip color for a (possibly unknown/legacy) category string. */
export function contactCategoryColor(category: string | null | undefined): ChipColor {
  return isContactCategory(category) ? CONTACT_CATEGORY_COLORS[category] : 'default'
}

interface CategoryFilter {
  category?: string
  excludeCategory?: string
}

export function contactMatchesCategoryFilter(contact: Contact, { category, excludeCategory }: CategoryFilter = {}): boolean {
  if (category && contact.category !== category) return false
  if (excludeCategory && contact.category === excludeCategory) return false
  return true
}
