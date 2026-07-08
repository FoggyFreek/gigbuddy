// Shape shared by the per-language Terms & Conditions documents. Each language
// is a completely separate, self-contained document (en.ts / nl.ts) —
// deliberately NOT i18n resources: legal text is versioned as a whole document
// per language, not as parallel translation keys.
export interface TermsSection {
  heading: string
  paragraphs: string[]
}

export interface TermsDocument {
  /** Must equal TERMS_VERSION (shared/termsVersion.js) — what the user accepts. */
  version: string
  title: string
  /** Shown prominently while the text awaits legal review. */
  draftNotice: string
  intro: string[]
  sections: TermsSection[]
}
