// Typed re-export of the shared ISO 3166-1 list, so the frontend and the
// server's validation set cannot drift apart.
//
// Distinct from VAT_COUNTRY_CODES, which is the far narrower set of
// jurisdictions this app can do accounting for. A band can originate anywhere;
// a tenant cannot be booked anywhere.
import { COUNTRY_CODES as SHARED_COUNTRY_CODES, isKnownCountryCode } from '../../shared/countries.js'

export const COUNTRY_CODES: readonly string[] = SHARED_COUNTRY_CODES as readonly string[]

export { isKnownCountryCode }

/**
 * Localized country name from the 2-letter code, so the picker reads naturally
 * without hand-maintained i18n keys. Falls back to the bare code when the
 * runtime has no data for it.
 */
export function countryLabel(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase())
    return name && name !== code.toUpperCase() ? name : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}
