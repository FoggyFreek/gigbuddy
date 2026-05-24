import FacebookIcon from '@mui/icons-material/Facebook'
import InstagramIcon from '@mui/icons-material/Instagram'
import YouTubeIcon from '@mui/icons-material/YouTube'
import BandsintownIcon from '../icons/BandsintownIcon.jsx'
import SpotifyIcon from '../icons/SpotifyIcon.jsx'
import TikTokIcon from '../icons/TikTokIcon.jsx'

export const SOCIALS = [
  { field: 'instagram_handle',       label: 'Instagram',              Icon: InstagramIcon,    prefix: 'instagram.com/' },
  { field: 'facebook_handle',        label: 'Facebook',               Icon: FacebookIcon,     prefix: 'facebook.com/' },
  { field: 'tiktok_handle',          label: 'TikTok',                 Icon: TikTokIcon,       prefix: 'tiktok.com/@' },
  { field: 'youtube_handle',         label: 'YouTube',                Icon: YouTubeIcon,      prefix: 'youtube.com/@' },
  { field: 'spotify_handle',         label: 'Spotify',                Icon: SpotifyIcon,      prefix: 'open.spotify.com/artist/' },
  { field: 'bandsintown_artist_name', label: 'Bandsintown artist name', Icon: BandsintownIcon, prefix: '' },
]

export const EMPTY_FORM = {
  band_name: '',
  bio: '',
  instagram_handle: '',
  facebook_handle: '',
  tiktok_handle: '',
  youtube_handle: '',
  spotify_handle: '',
  bandsintown_artist_name: '',
  formal_name: '',
  address_street: '',
  address_postal_code: '',
  address_city: '',
  address_country: 'Netherlands',
  kvk_number: '',
  iban: '',
  tax_id: '',
  tax_percentage: 9,
  applies_kor: false,
}

export function profileToForm(data) {
  return {
    band_name: data.band_name || '',
    bio: data.bio || '',
    instagram_handle: data.instagram_handle || '',
    facebook_handle: data.facebook_handle || '',
    tiktok_handle: data.tiktok_handle || '',
    youtube_handle: data.youtube_handle || '',
    spotify_handle: data.spotify_handle || '',
    bandsintown_artist_name: data.bandsintown_artist_name || '',
    formal_name: data.formal_name || '',
    address_street: data.address_street || '',
    address_postal_code: data.address_postal_code || '',
    address_city: data.address_city || '',
    address_country: data.address_country || 'Netherlands',
    kvk_number: data.kvk_number || '',
    iban: data.iban || '',
    tax_id: data.tax_id || '',
    tax_percentage: data.tax_percentage != null ? Number(data.tax_percentage) : 9,
    applies_kor: !!data.applies_kor,
  }
}
