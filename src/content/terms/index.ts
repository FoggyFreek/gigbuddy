import type { TermsDocument } from './types.ts'
import { termsEn } from './en.ts'
import { termsNl } from './nl.ts'

// Picks the terms document for a UI language ('nl', 'nl-BE', …). Each language
// is a standalone document; English is the fallback for anything non-Dutch.
export function termsForLanguage(language: string): TermsDocument {
  return language.toLowerCase().startsWith('nl') ? termsNl : termsEn
}

export type { TermsDocument }
