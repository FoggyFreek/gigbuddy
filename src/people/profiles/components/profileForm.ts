import type { ComponentType } from 'react'
import FacebookIcon from '@mui/icons-material/Facebook'
import InstagramIcon from '@mui/icons-material/Instagram'
import YouTubeIcon from '@mui/icons-material/YouTube'
import BandsintownIcon from '../../../components/icons/BandsintownIcon.tsx'
import SpotifyIcon from '../../../components/icons/SpotifyIcon.tsx'
import TikTokIcon from '../../../components/icons/TikTokIcon.tsx'
import { TENANT_CAPABILITIES, type TenantCapability } from '../../../auth/tenantCapabilities.ts'

export interface SocialEntry {
  field: string
  label: string
  Icon: ComponentType<Record<string, unknown>>
  prefix: string
  capability?: TenantCapability
}

export const SOCIALS: SocialEntry[] = [
  { field: 'instagram_handle',        label: 'Instagram',               Icon: InstagramIcon,    prefix: 'instagram.com/' },
  { field: 'facebook_handle',         label: 'Facebook',                Icon: FacebookIcon,     prefix: 'facebook.com/' },
  { field: 'tiktok_handle',           label: 'TikTok',                  Icon: TikTokIcon,       prefix: 'tiktok.com/@' },
  { field: 'youtube_handle',          label: 'YouTube',                 Icon: YouTubeIcon,      prefix: 'youtube.com/' },
  { field: 'spotify_handle',          label: 'Spotify',                 Icon: SpotifyIcon,      prefix: 'open.spotify.com/artist/' },
  { field: 'bandsintown_artist_name', label: 'Bandsintown artist name', Icon: BandsintownIcon,  prefix: '', capability: TENANT_CAPABILITIES.BAND_PROMOTION_INTEGRATIONS },
  { field: 'bandsintown_artist_id',   label: 'Bandsintown artist ID',   Icon: BandsintownIcon,  prefix: 'bandsintown.com/a/', capability: TENANT_CAPABILITIES.BAND_PROMOTION_INTEGRATIONS },
]

/** The editable profile form shape. */
export interface ProfileForm {
  band_name: string
  short_bio: string
  bio: string
  instagram_handle: string
  facebook_handle: string
  tiktok_handle: string
  youtube_handle: string
  spotify_handle: string
  bandsintown_artist_name: string
  bandsintown_artist_id: string
}

export const EMPTY_FORM: ProfileForm = {
  band_name: '',
  short_bio: '',
  bio: '',
  instagram_handle: '',
  facebook_handle: '',
  tiktok_handle: '',
  youtube_handle: '',
  spotify_handle: '',
  bandsintown_artist_name: '',
  bandsintown_artist_id: '',
}

export function profileToForm(data: Record<string, unknown>): ProfileForm {
  return {
    band_name: String(data.band_name || ''),
    short_bio: String(data.short_bio || ''),
    bio: String(data.bio || ''),
    instagram_handle: String(data.instagram_handle || ''),
    facebook_handle: String(data.facebook_handle || ''),
    tiktok_handle: String(data.tiktok_handle || ''),
    youtube_handle: String(data.youtube_handle || ''),
    spotify_handle: String(data.spotify_handle || ''),
    bandsintown_artist_name: String(data.bandsintown_artist_name || ''),
    bandsintown_artist_id: String(data.bandsintown_artist_id || ''),
  }
}
