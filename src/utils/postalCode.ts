interface PostalCodeFormat {
  full: RegExp
  extract: RegExp
}

const POSTAL_CODE_FORMATS: Record<string, PostalCodeFormat> = {
  nl: {
    full: /^[1-9]\d{3}\s?[A-Z]{2}$/i,
    extract: /\b[1-9]\d{3}\s?[A-Z]{2}\b/gi,
  },
  be: {
    full: /^\d{4}$/,
    extract: /\b\d{4}\b/g,
  },
  de: {
    full: /^\d{5}$/,
    extract: /\b\d{5}\b/g,
  },
  fr: {
    full: /^\d{5}$/,
    extract: /\b\d{5}\b/g,
  },
  lu: {
    full: /^(?:L-?)?\d{4}$/i,
    extract: /\b(?:L-?)?\d{4}\b/gi,
  },
  at: {
    full: /^\d{4}$/,
    extract: /\b\d{4}\b/g,
  },
  es: {
    full: /^\d{5}$/,
    extract: /\b\d{5}\b/g,
  },
  it: {
    full: /^\d{5}$/,
    extract: /\b\d{5}\b/g,
  },
  ie: {
    full: /^(?:D6W|[AC-FHKNPRTV-Y]\d{2})\s?[0-9AC-FHKNPRTV-Y]{4}$/i,
    extract: /\b(?:D6W|[AC-FHKNPRTV-Y]\d{2})\s?[0-9AC-FHKNPRTV-Y]{4}\b/gi,
  },
  gb: {
    full: /^(?:GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-HJKPSTUW]?\s?\d[ABD-HJLNP-UW-Z]{2})$/i,
    extract: /\b(?:GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-HJKPSTUW]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/gi,
  },
}

function normalizedCountry(country: string | null | undefined) {
  const normalized = country?.trim().toLowerCase()
  return normalized === 'uk' ? 'gb' : normalized
}

function compact(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function clean(value: string) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function isCompletePostalCode(
  country: string | null | undefined,
  value: string | null | undefined,
) {
  const format = POSTAL_CODE_FORMATS[normalizedCountry(country) ?? '']
  return Boolean(format && value && format.full.test(value.trim()))
}

/**
 * Recover a complete postal code from provider display text when its structured
 * address field is truncated. A partial structured value acts as a guard: only
 * a candidate that extends that value is accepted.
 */
export function recoverPostalCode(
  country: string | null | undefined,
  structuredValue: string | null | undefined,
  sources: string | Array<string | null | undefined> | null | undefined,
): string | null {
  const fallback = structuredValue?.trim() || null
  const format = POSTAL_CODE_FORMATS[normalizedCountry(country) ?? '']
  if (!format || (fallback && format.full.test(fallback))) return fallback

  const sourceList = Array.isArray(sources) ? sources : [sources]
  const candidates = sourceList.flatMap((source) => (
    typeof source === 'string' ? Array.from(source.matchAll(format.extract), match => clean(match[0])) : []
  ))

  if (!candidates.length) return fallback
  if (!fallback) return candidates.at(-1) ?? null

  const partial = compact(fallback)
  return candidates.find(candidate => compact(candidate).startsWith(partial)) ?? fallback
}
