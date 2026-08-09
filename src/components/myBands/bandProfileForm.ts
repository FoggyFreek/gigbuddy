// Form shape and rules for a band profile, kept out of the component files so
// both the create dialog and the edit modal can share them.
import type { BandProfile } from '../../types/entities.ts'

export interface BandProfileForm {
  name: string
  countryCode: string
  spotifyUrl: string
  websiteUrl: string
  contactEmail: string
}

export const EMPTY_BAND_PROFILE_FORM: BandProfileForm = {
  name: '',
  countryCode: '',
  spotifyUrl: '',
  websiteUrl: '',
  contactEmail: '',
}

export const profileToForm = (profile: BandProfile): BandProfileForm => ({
  name: profile.name,
  countryCode: profile.countryCode,
  spotifyUrl: profile.spotifyUrl ?? '',
  websiteUrl: profile.websiteUrl ?? '',
  contactEmail: profile.contactEmail ?? '',
})

/**
 * A profile needs at least one link. Mirrors the server rule, which checks it
 * against the MERGED row — so this is a courtesy for the person typing, not the
 * authority.
 */
export const hasBandProfileLink = (form: BandProfileForm) =>
  form.spotifyUrl.trim() !== '' || form.websiteUrl.trim() !== ''
