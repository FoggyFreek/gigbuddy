import {
  GIG_INFO_LABEL_KEYS,
  MAX_GIG_INFO_LABEL_LENGTH,
} from '../../../shared/gigInfoLabels.js'

// Mirrors the runtime list in shared/gigInfoLabels.js, which owns it. The union
// is what keeps the dynamic selector index `t($ => $.detail.infoBlocks.labels[key])`
// a compile-time check, so a key without a translation fails the type gate.
export type GigInfoLabelKey =
  | 'remarks'
  | 'timetable'
  | 'hospitality'
  | 'catering'
  | 'technical_information'
  | 'dressing_room'
  | 'light'
  | 'merchandise'
  | 'backline'
  | 'invoice_info'
  | 'press'
  | 'guestlist'
  | 'recording'

const LABEL_KEYS = GIG_INFO_LABEL_KEYS as readonly GigInfoLabelKey[]

export type TranslateLabelKey = (key: GigInfoLabelKey) => string

export interface InfoBlockLabelOption {
  key: GigInfoLabelKey
  text: string
}

export interface InfoBlockLabelValue {
  label: string
  label_is_custom: boolean
}

/** The suggested labels, translated. A user may type anything else instead. */
export function buildLabelOptions(translateKey: TranslateLabelKey): InfoBlockLabelOption[] {
  return LABEL_KEYS.map((key) => ({ key, text: translateKey(key) }))
}

/**
 * What to show for a stored label: the user's own text, or the translated key.
 * `label` only holds a key when `label_is_custom` is false, which the backend
 * validates against the same list — hence the cast.
 */
export function labelTextOf(
  block: { label: string; label_is_custom: boolean },
  translateKey: TranslateLabelKey,
): string {
  if (block.label_is_custom) return block.label
  return block.label ? translateKey(block.label as GigInfoLabelKey) : ''
}

// Text the user typed rather than picked. Snapping it back onto a canonical key
// when it matches a suggestion keeps "picked Catering" and "typed Catering"
// stored identically — otherwise the same block would translate for one user
// and not for the next.
export function resolveTypedLabel(
  typed: string,
  options: InfoBlockLabelOption[],
): InfoBlockLabelValue | null {
  const text = typed.trim()
  if (!text) return null
  const match = options.find((option) => option.text.toLowerCase() === text.toLowerCase())
  if (match) return { label: match.key, label_is_custom: false }
  return { label: text.slice(0, MAX_GIG_INFO_LABEL_LENGTH), label_is_custom: true }
}
