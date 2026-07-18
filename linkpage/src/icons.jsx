// Inline SVG icons — no icon library, no external requests (the public page
// must stay fully self-hosted). All take a `size` prop and inherit color.

function Svg({ size = 24, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function InstagramIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M12 2.2c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16zm0 2.7a7.1 7.1 0 1 0 0 14.2 7.1 7.1 0 0 0 0-14.2zm0 2.7a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8zm7.3-2.9a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" />
    </Svg>
  )
}

export function FacebookIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.51 1.5-3.9 3.78-3.9 1.09 0 2.24.2 2.24.2v2.46H15.2c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
    </Svg>
  )
}

export function YoutubeIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z" />
    </Svg>
  )
}

export function TiktokIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </Svg>
  )
}

export function SpotifyIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.5 17.31a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.05 8.5-.6 11.66 1.34.35.22.47.68.25 1.03zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.98-8.15-2.56-11.97-1.4a.94.94 0 1 1-.55-1.79c4.37-1.33 9.8-.68 13.5 1.6.44.27.58.85.31 1.28zm.13-3.41C15.24 8.33 8.94 8.12 5.25 9.24a1.13 1.13 0 1 1-.65-2.15C8.83 5.8 15.86 6.05 20.31 8.7a1.13 1.13 0 0 1-1.16 1.93z" />
    </Svg>
  )
}

export function GlobeIcon({ size }) {
  return (
    <Svg size={size} fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9.2" />
      <path d="M2.8 12h18.4M12 2.8c2.6 2.4 3.9 5.6 3.9 9.2s-1.3 6.8-3.9 9.2c-2.6-2.4-3.9-5.6-3.9-9.2S9.4 5.2 12 2.8z" />
    </Svg>
  )
}

export function CalendarIcon({ size }) {
  return (
    <Svg size={size} fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 2.8v4M16 2.8v4" />
      <path d="M8 13.5h3v3.5H8z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function MusicIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M9 3v10.55A4 4 0 1 0 11 17V7h8v6.55A4 4 0 1 0 21 17V3H9z" />
    </Svg>
  )
}

export function ShopIcon({ size }) {
  return (
    <Svg size={size} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h16l-1.2 12a1.8 1.8 0 0 1-1.8 1.6H7a1.8 1.8 0 0 1-1.8-1.6L4 8z" />
      <path d="M8.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7" />
    </Svg>
  )
}

export function AppleIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M17.05 12.54c-.03-2.36 1.93-3.5 2.02-3.55-1.1-1.61-2.81-1.83-3.42-1.85-1.45-.15-2.84.86-3.58.86-.74 0-1.88-.84-3.09-.82-1.59.02-3.06.93-3.88 2.35-1.65 2.87-.42 7.12 1.19 9.45.79 1.14 1.73 2.42 2.96 2.37 1.19-.05 1.64-.77 3.08-.77s1.84.77 3.1.75c1.28-.02 2.09-1.16 2.87-2.31.9-1.32 1.28-2.6 1.3-2.67-.03-.01-2.5-.96-2.55-3.81zM14.7 5.6c.65-.79 1.09-1.89.97-2.99-.94.04-2.07.63-2.75 1.42-.6.7-1.13 1.81-.99 2.88 1.05.08 2.12-.53 2.77-1.31z" />
    </Svg>
  )
}

export function DeezerIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M18.8 5.2h4.1v2.4h-4.1zM18.8 8.9h4.1v2.4h-4.1zM12.9 8.9H17v2.4h-4.1zM18.8 12.6h4.1V15h-4.1zM12.9 12.6H17V15h-4.1zM7.1 12.6h4.1V15H7.1zM18.8 16.3h4.1v2.4h-4.1zM12.9 16.3H17v2.4h-4.1zM7.1 16.3h4.1v2.4H7.1zM1.2 16.3h4.1v2.4H1.2z" />
    </Svg>
  )
}

export function TidalIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M8 4 12 8 8 12 4 8zM16 4 20 8 16 12 12 8zM8 12l4 4 4-4 4 4-8 8-8-8z" />
    </Svg>
  )
}

export function SoundcloudIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M1 15.5h1.2v3.1H1zM3.4 14h1.2v4.6H3.4zM5.8 13h1.2v5.6H5.8zM8.2 11.5h1.2v7.1H8.2zM10.6 10.5h1.2v8.1h-1.2zM13 8.6c.5-.3 1.1-.5 1.7-.5 1.9 0 3.5 1.5 3.7 3.4.3-.1.6-.2 1-.2 1.4 0 2.6 1.2 2.6 2.6s-1.2 2.7-2.6 2.7H13z" />
    </Svg>
  )
}

export function BandcampIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm3.05 15.5H6.5l2.45-7h8.55z" />
    </Svg>
  )
}

// Platform button icons for release landing pages (detectPlatform ids).
export const PLATFORM_ICON_COMPONENTS = {
  spotify: SpotifyIcon,
  apple: AppleIcon,
  'youtube-music': YoutubeIcon,
  youtube: YoutubeIcon,
  deezer: DeezerIcon,
  tidal: TidalIcon,
  amazon: MusicIcon,
  soundcloud: SoundcloudIcon,
  bandcamp: BandcampIcon,
  other: MusicIcon,
}

export const LINK_ICON_COMPONENTS = {
  globe: GlobeIcon,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  youtube: YoutubeIcon,
  tiktok: TiktokIcon,
  spotify: SpotifyIcon,
  calendar: CalendarIcon,
  music: MusicIcon,
  shop: ShopIcon,
}
