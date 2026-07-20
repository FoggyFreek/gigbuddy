import type { ComponentType } from 'react'
import FacebookIcon from '@mui/icons-material/Facebook'
import InstagramIcon from '@mui/icons-material/Instagram'
import YouTubeIcon from '@mui/icons-material/YouTube'
import BandsintownIcon from '../icons/BandsintownIcon.tsx'
import SpotifyIcon from '../icons/SpotifyIcon.tsx'
import TikTokIcon from '../icons/TikTokIcon.tsx'

export interface SocialEntry {
  field: string
  label: string
  Icon: ComponentType<Record<string, unknown>>
  prefix: string
}

export const SOCIALS: SocialEntry[] = [
  { field: 'instagram_handle',        label: 'Instagram',               Icon: InstagramIcon,    prefix: 'instagram.com/' },
  { field: 'facebook_handle',         label: 'Facebook',                Icon: FacebookIcon,     prefix: 'facebook.com/' },
  { field: 'tiktok_handle',           label: 'TikTok',                  Icon: TikTokIcon,       prefix: 'tiktok.com/@' },
  { field: 'youtube_handle',          label: 'YouTube',                 Icon: YouTubeIcon,      prefix: 'youtube.com/' },
  { field: 'spotify_handle',          label: 'Spotify',                 Icon: SpotifyIcon,      prefix: 'open.spotify.com/artist/' },
  { field: 'bandsintown_artist_name', label: 'Bandsintown artist name', Icon: BandsintownIcon,  prefix: '' },
  { field: 'bandsintown_artist_id',   label: 'Bandsintown artist ID',   Icon: BandsintownIcon,  prefix: 'bandsintown.com/a/' },
]

/** The editable profile form shape. */
export interface ProfileForm {
  band_name: string
  bio: string
  instagram_handle: string
  facebook_handle: string
  tiktok_handle: string
  youtube_handle: string
  spotify_handle: string
  bandsintown_artist_name: string
  bandsintown_artist_id: string
  formal_name: string
  address_street: string
  address_postal_code: string
  address_city: string
  address_country: string
  kvk_number: string
  registration_office: string
  legal_form: string
  directors: string
  iban: string
  tax_id: string
  tax_percentage: number
  applies_kor: boolean
  vat_country: string
}

export const EMPTY_FORM: ProfileForm = {
  band_name: '',
  bio: '',
  instagram_handle: '',
  facebook_handle: '',
  tiktok_handle: '',
  youtube_handle: '',
  spotify_handle: '',
  bandsintown_artist_name: '',
  bandsintown_artist_id: '',
  formal_name: '',
  address_street: '',
  address_postal_code: '',
  address_city: '',
  address_country: 'Netherlands',
  kvk_number: '',
  registration_office: '',
  legal_form: '',
  directors: '',
  iban: '',
  tax_id: '',
  tax_percentage: 9,
  applies_kor: false,
  vat_country: 'nl',
}

export function profileToForm(data: Record<string, unknown>): ProfileForm {
  return {
    band_name: String(data.band_name || ''),
    bio: String(data.bio || ''),
    instagram_handle: String(data.instagram_handle || ''),
    facebook_handle: String(data.facebook_handle || ''),
    tiktok_handle: String(data.tiktok_handle || ''),
    youtube_handle: String(data.youtube_handle || ''),
    spotify_handle: String(data.spotify_handle || ''),
    bandsintown_artist_name: String(data.bandsintown_artist_name || ''),
    bandsintown_artist_id: String(data.bandsintown_artist_id || ''),
    formal_name: String(data.formal_name || ''),
    address_street: String(data.address_street || ''),
    address_postal_code: String(data.address_postal_code || ''),
    address_city: String(data.address_city || ''),
    address_country: String(data.address_country || 'Netherlands'),
    kvk_number: String(data.kvk_number || ''),
    registration_office: String(data.registration_office || ''),
    legal_form: String(data.legal_form || ''),
    directors: String(data.directors || ''),
    iban: String(data.iban || ''),
    tax_id: String(data.tax_id || ''),
    tax_percentage: data.tax_percentage != null ? Number(data.tax_percentage) : 9,
    applies_kor: !!data.applies_kor,
    vat_country: String(data.vat_country || 'nl'),
  }
}
